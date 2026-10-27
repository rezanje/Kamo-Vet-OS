-- P02: koreksi harga (dan qty turun) baris faktur pembelian setelah barang sebagian terjual.
--
-- Aturan pemilik (docs/reports/2026-10-28-keputusan-default.md, P02):
-- - OWNER aktif saja, selalu lewat pratinjau dampak.
-- - Selisih untuk sisa stok faktur ini masuk nilai persediaan (rata-rata ulang / lapisan baru).
-- - Selisih untuk bagian yang sudah keluar masuk HPP periode berjalan lewat jurnal.
-- - Hutang (2101) ikut berubah; ditolak bila total baru < pembayaran yang sudah tercatat.
-- - Qty hanya boleh turun dan hanya sebanyak sisa stok faktur ini. Hapus/batal faktur tetap
--   ditolak bila barang sudah terpakai (cancel_purchase_invoice tidak diubah).
--
-- Satu RPC atomik: correct_purchase_invoice_line. Pratinjau memakai jalur yang sama persis lalu
-- dibatalkan (subtransaksi), sehingga angka pratinjau = angka yang akan diposting.
-- Idempoten per (aktor, request_key). Riwayat lama -> baru disimpan di purchase_invoice_corrections.

create table if not exists public.purchase_invoice_corrections(
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.purchase_invoices(id),
 invoice_item_id uuid not null references public.purchase_invoice_items(id),
 item_id uuid not null references public.items(id),
 actor_id uuid not null references public.profiles(id),
 request_key text not null check (length(request_key) between 1 and 160),
 payload jsonb not null,
 tanggal date not null,
 reason text not null check (length(btrim(reason)) between 3 and 1000),
 old_qty numeric not null, new_qty numeric not null,
 old_harga numeric not null, new_harga numeric not null,
 faktor numeric not null,
 old_unit_cost numeric not null, new_unit_cost numeric not null,
 remaining_qty numeric not null, sold_qty numeric not null, removed_qty numeric not null,
 old_total numeric not null, new_total numeric not null,
 ap_delta numeric not null, dpp_delta numeric not null, ppn_delta numeric not null,
 inventory_delta numeric not null, hpp_delta numeric not null,
 cost_method text not null,
 journal_id uuid references public.journal_entries(id),
 result jsonb not null,
 created_at timestamptz not null default now(),
 unique(actor_id,request_key)
);
create index if not exists purchase_invoice_corrections_invoice on public.purchase_invoice_corrections(invoice_id,created_at);

-- Lapisan stok yang dipensiunkan/dibuat oleh koreksi, agar koreksi berikutnya tahu sisa stok faktur.
create table if not exists public.purchase_invoice_correction_layers(
 correction_id uuid not null references public.purchase_invoice_corrections(id),
 invoice_id uuid not null references public.purchase_invoices(id),
 item_id uuid not null references public.items(id),
 layer_id uuid not null references public.stock_layers(id),
 role text not null check (role in ('retired','created')),
 primary key(correction_id,layer_id,role)
);

alter table public.purchase_invoice_corrections enable row level security;
alter table public.purchase_invoice_correction_layers enable row level security;
revoke all on public.purchase_invoice_corrections,public.purchase_invoice_correction_layers from public,anon,authenticated,service_role;
grant select on public.purchase_invoice_corrections to authenticated;
drop policy if exists purchase_invoice_corrections_read on public.purchase_invoice_corrections;
-- Riwayat terbaca oleh siapa pun yang boleh membaca fakturnya (RLS faktur ikut berlaku).
create policy purchase_invoice_corrections_read on public.purchase_invoice_corrections for select to authenticated
 using (exists(select 1 from public.purchase_invoices i where i.id=invoice_id));

create or replace function public.guard_purchase_invoice_correction_journal() returns trigger
language plpgsql set search_path='' as $$
declare protected boolean;begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then protected:=coalesce(new.source='purchase-inv-correction',false) or coalesce(old.source='purchase-inv-correction',false);
  else select exists(select 1 from public.journal_entries where id in(new.entry_id,old.entry_id) and source='purchase-inv-correction') into protected;end if;
  if protected then raise exception 'Riwayat jurnal koreksi faktur dilindungi' using errcode='42501';end if;
 end if;return coalesce(new,old);
end$$;
revoke all on function public.guard_purchase_invoice_correction_journal() from public,anon,authenticated,service_role;
drop trigger if exists purchase_invoice_correction_journal_guard on public.journal_entries;
create trigger purchase_invoice_correction_journal_guard before insert or update or delete on public.journal_entries for each row execute function public.guard_purchase_invoice_correction_journal();
drop trigger if exists purchase_invoice_correction_journal_lines_guard on public.journal_lines;
create trigger purchase_invoice_correction_journal_lines_guard before insert or update or delete on public.journal_lines for each row execute function public.guard_purchase_invoice_correction_journal();

-- Inti koreksi. p_preview=true: kerjakan semuanya lalu lempar VP002 berisi hasil (dibatalkan pemanggil).
create or replace function public.purchase_invoice_line_correction_run(
 p_line_id uuid,p_qty numeric,p_harga numeric,p_tanggal date,p_reason text,p_request_key text,p_payload jsonb,p_preview boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 li public.purchase_invoice_items%rowtype;inv public.purchase_invoices%rowtype;proof public.purchase_invoice_postings%rowtype;
 cfg record;st public.stock%rowtype;layer public.stock_layers%rowtype;r record;
 v_po uuid;v_avg boolean;v_faktor numeric;v_old_cost numeric;v_new_cost numeric;v_count integer;
 v_qty_base numeric;v_new_qty_base numeric;v_remaining numeric;v_sold numeric;v_removed numeric;v_take numeric;v_left numeric;
 v_old_dpp numeric;v_old_ppn numeric;v_new_total numeric;v_new_dpp numeric;v_ap numeric;v_dpp numeric;v_ppn numeric;
 v_paid numeric;v_reserved numeric;v_before numeric;v_after numeric;v_target numeric;v_adj numeric;v_inv numeric;v_hpp numeric;
 v_cut date;v_new_layer uuid;v_takes jsonb:='[]';v_retired uuid[]:='{}';v_set uuid[];v_created uuid[]:='{}';
 v_lines jsonb;v_journal uuid;v_correction uuid:=gen_random_uuid();result jsonb;
begin
 perform public.inventory_assert_open_date(p_tanggal);
 perform public.purchase_assert_access('invoice',null);
 if not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then raise exception 'Koreksi harga faktur hanya oleh OWNER' using errcode='42501';end if;
 if p_qty is null or p_harga is null or p_qty::text in ('NaN','Infinity','-Infinity') or p_harga::text in ('NaN','Infinity','-Infinity')
  or p_qty<=0 or p_qty>1e9 or p_harga<0 or p_harga>1e12 or p_qty*p_harga<>round(p_qty*p_harga,2) then raise exception 'Qty atau harga koreksi tidak valid';end if;
 if p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then raise exception 'Alasan koreksi wajib diisi (minimal 3 huruf)';end if;
 select ii.invoice_id into r from public.purchase_invoice_items ii where ii.id=p_line_id;
 if not found then raise exception 'Baris faktur tidak ditemukan';end if;
 -- Urutan kunci sama dengan pembatalan/pembayaran faktur: PO -> faktur -> stok -> lapisan.
 select i.po_id into v_po from public.purchase_invoices i where i.id=r.invoice_id;
 if v_po is not null then perform 1 from public.purchase_orders where id=v_po for update;end if;
 perform 1 from public.purchase_invoices i where i.po_id=v_po or i.id=r.invoice_id order by i.id for update;
 select * into inv from public.purchase_invoices where id=r.invoice_id;
 select * into li from public.purchase_invoice_items where id=p_line_id;
 select * into proof from public.purchase_invoice_postings where invoice_id=inv.id;
 if inv.voided_at is not null then raise exception 'Faktur sudah dibatalkan';end if;
 if inv.opening_batch_id is not null then raise exception 'Faktur saldo awal tidak punya baris barang untuk dikoreksi';end if;
 if proof.invoice_id is null then raise exception 'Bukti asal nilai faktur lama belum lengkap. Rekonsiliasi manual diperlukan';end if;
 perform public.purchase_invoice_scope(proof.branch_id,proof.warehouse_id,inv.supplier_id);
 perform public.purchase_invoice_source_active(inv.id);
 perform public.purchase_payment_period(inv.tanggal,p_tanggal);
 if p_tanggal<inv.tanggal then raise exception 'Tanggal koreksi mendahului tanggal faktur';end if;
 if li.item_id is null or not exists(select 1 from public.items where id=li.item_id and coalesce(item_type,'Persediaan')='Persediaan') then raise exception 'Koreksi harga hanya untuk barang persediaan';end if;
 if exists(select 1 from public.purchase_invoice_items where invoice_id=inv.id and item_id=li.item_id and id<>li.id) then
  raise exception 'Barang ini muncul di lebih dari satu baris faktur. Asal stok tidak bisa dipisah dengan aman; rekonsiliasi manual';end if;
 if inv.po_id is not null and exists(select 1 from public.purchase_returns where voided_at is null and po_id=inv.po_id) then
  raise exception 'PO faktur ini punya retur aktif. Rekonsiliasi retur sebelum koreksi harga';end if;
 if p_qty>li.qty then raise exception 'Qty faktur hanya bisa dikurangi lewat koreksi. Tambahan barang dicatat sebagai pembelian baru';end if;
 if p_qty<li.qty and inv.po_id is not null then raise exception 'Qty faktur dari PO dikurangi lewat Retur Pembelian. Koreksi ini hanya mengubah harga';end if;
 if p_qty=li.qty and p_harga=li.harga then raise exception 'Tidak ada perubahan qty atau harga';end if;

 -- PPN: hitung ulang DPP dengan aturan yang sama seperti saat faktur dibuat.
 select coalesce(mode_pkp,false) mode_pkp,ppn_rate into cfg from public.company_settings where id for share;
 select proof.dpp+coalesce(sum(c.dpp_delta),0),proof.ppn+coalesce(sum(c.ppn_delta),0) into v_old_dpp,v_old_ppn
 from public.purchase_invoice_corrections c where c.invoice_id=inv.id;
 if (case when cfg.mode_pkp then least(inv.total,round(inv.total*100/(100+cfg.ppn_rate))) else inv.total end) is distinct from v_old_dpp then
  raise exception 'Mode atau tarif PPN berubah sejak faktur dibuat. Rekonsiliasi pajak manual sebelum koreksi';end if;
 v_ap:=p_qty*p_harga-li.qty*li.harga;
 v_new_total:=inv.total+v_ap;
 if v_new_total<=0 then raise exception 'Total faktur setelah koreksi harus lebih dari 0. Untuk membatalkan seluruh faktur gunakan pembatalan';end if;
 v_new_dpp:=case when cfg.mode_pkp then least(v_new_total,round(v_new_total*100/(100+cfg.ppn_rate))) else v_new_total end;
 v_dpp:=v_new_dpp-v_old_dpp;v_ppn:=v_ap-v_dpp;
 if v_ppn<>0 and date_trunc('month',inv.tanggal)<>date_trunc('month',p_tanggal) then
  raise exception 'PPN faktur sudah melewati masa asal. Rekonsiliasi pajak sebelum koreksi';end if;

 -- Hutang: total baru tidak boleh di bawah yang sudah dibayar / dipesan perintah bayar.
 select coalesce(sum(amount),0) into v_paid from public.purchase_invoice_payments where invoice_id=inv.id;
 if v_new_total<v_paid then
  raise exception 'Total faktur baru Rp % lebih kecil dari pembayaran yang sudah tercatat Rp %. Balikkan pembayaran yang berlebih terlebih dahulu',
   to_char(v_new_total,'FM999G999G999G990D00'),to_char(v_paid,'FM999G999G999G990D00');end if;
 select coalesce(sum(b.jumlah),0) into v_reserved from public.payment_order_items b join public.payment_orders o on o.id=b.order_id
  where b.invoice_id=inv.id and o.status in ('draft','disetujui');
 if v_new_total<v_paid+v_reserved then raise exception 'Total faktur baru lebih kecil dari pembayaran + perintah bayar yang masih memesan faktur ini. Ubah/batalkan perintah bayar dulu';end if;

 -- Stok dan lapisan milik baris ini.
 insert into public.stock(warehouse_id,item_id,qty) values(proof.warehouse_id,li.item_id,0) on conflict(warehouse_id,item_id) do nothing;
 select * into st from public.stock where warehouse_id=proof.warehouse_id and item_id=li.item_id for update;
 select coalesce(array_agg(x.id order by x.id),'{}') into v_set from (
  select l.id from public.stock_layers l where inv.po_id is null and l.warehouse_id=proof.warehouse_id and l.item_id=li.item_id and l.source='faktur-langsung' and l.source_ref=inv.no_faktur
  union select p.layer_id from public.purchase_invoice_layer_proofs p join public.stock_layers l on l.id=p.layer_id where p.invoice_id=inv.id and p.allocated and l.item_id=li.item_id
  union select c.layer_id from public.purchase_invoice_correction_layers c where c.invoice_id=inv.id and c.item_id=li.item_id and c.role='created'
 ) x where not exists(select 1 from public.purchase_invoice_correction_layers c where c.layer_id=x.id and c.role='retired');
 perform 1 from public.stock_layers l where l.id =any(v_set) order by l.id for update;

 v_faktor:=coalesce(nullif(li.faktor,0),1);
 select c.new_unit_cost into v_old_cost from public.purchase_invoice_corrections c where c.invoice_item_id=li.id order by c.created_at desc,c.id desc limit 1;
 if v_old_cost is null then
  select count(distinct l.unit_cost),min(l.unit_cost) into v_count,v_old_cost from public.stock_layers l where l.id =any(v_set);
  if v_count=0 and inv.po_id is null then
   select count(distinct m.unit_cost),min(m.unit_cost) into v_count,v_old_cost from public.stock_moves m
   where m.source='faktur-langsung' and m.source_ref=inv.no_faktur and m.item_id=li.item_id and m.qty>0;
  end if;
  if v_count<>1 then raise exception 'Harga pokok asal baris faktur tidak tunggal atau tidak ditemukan. Rekonsiliasi manual';end if;
 end if;
 v_qty_base:=li.qty*v_faktor;v_new_qty_base:=p_qty*v_faktor;
 select coalesce(sum(l.qty_left),0) into v_remaining from public.stock_layers l where l.id =any(v_set);
 if v_remaining>v_qty_base then raise exception 'Sisa stok asal faktur melebihi qty faktur. Rekonsiliasi manual';end if;
 v_sold:=v_qty_base-v_remaining;
 v_removed:=v_qty_base-v_new_qty_base;
 if v_removed>v_remaining then
  raise exception 'Qty hanya bisa dikurangi sebanyak sisa stok faktur ini (% %); sisanya sudah terjual/terpakai',
   trim(to_char(v_remaining/v_faktor,'FM999999999990.######'),'.'),li.satuan;end if;
 if v_removed>st.qty then raise exception 'Stok gudang tidak cukup untuk mengurangi qty faktur';end if;
 v_new_cost:=p_harga/v_faktor*v_new_dpp/v_new_total;
 v_avg:=public.inventory_is_average();

 v_before:=case when v_avg then case when st.qty=0 then 0 else st.qty*coalesce(st.average_cost,0) end
  else (select coalesce(sum(l.qty_left*l.unit_cost),0) from public.stock_layers l where l.warehouse_id=proof.warehouse_id and l.item_id=li.item_id) end;

 -- 1) Qty turun: keluarkan barang dari lapisan faktur ini sendiri.
 if v_removed>0 then
  v_left:=v_removed;
  for layer in select l.* from public.stock_layers l where l.id =any(v_set) and l.qty_left>0
   order by l.exp_date nulls last,l.tanggal,l.created_at,l.id loop
   exit when v_left<=0;
   v_take:=least(v_left,layer.qty_left);
   update public.stock_layers set qty_left=qty_left-v_take where id=layer.id;
   v_takes:=v_takes||jsonb_build_array(jsonb_build_object('id',layer.id,'qty',v_take,'unit_cost',layer.unit_cost,'exp_date',layer.exp_date));
   v_left:=v_left-v_take;
  end loop;
  update public.stock set qty=qty-v_removed,updated_at=now() where id=st.id;
  insert into public.stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref,fifo_takes)
  values(p_tanggal,proof.warehouse_id,li.item_id,-v_removed,case when v_avg then coalesce(st.average_cost,v_old_cost) else v_old_cost end,'purchase-correction',inv.no_faktur,v_takes);
 end if;

 -- 2) Sisa stok faktur pindah ke lapisan baru berharga baru (lapisan lama dipensiunkan, riwayat utuh).
 select greatest(coalesce((select closed_until from public.accounting_locks where id),'-infinity'::date),
  coalesce((select closed_through from public.inventory_costing_settings where id),'-infinity'::date)) into v_cut;
 if v_new_cost<>v_old_cost then
  for layer in select l.* from public.stock_layers l where l.id =any(v_set) and l.qty_left>0 order by l.id loop
   update public.stock_layers set qty_left=0 where id=layer.id;
   insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source,source_ref,exp_date,batch_no)
   values(layer.warehouse_id,layer.item_id,case when layer.tanggal>v_cut then layer.tanggal else p_tanggal end,layer.qty_left,layer.qty_left,v_new_cost,'purchase-correction',inv.no_faktur,layer.exp_date,layer.batch_no)
   returning id into v_new_layer;
   v_retired:=array_append(v_retired,layer.id);v_created:=array_append(v_created,v_new_layer);
  end loop;
 end if;

 -- 3) Average: sisa stok faktur dinilai ulang ke harga baru (rata-rata ulang gudang).
 if v_avg then
  select * into st from public.stock where id=st.id;
  v_target:=(v_remaining-v_removed)*v_new_cost-v_remaining*v_old_cost;
  v_adj:=v_target-((case when st.qty=0 then 0 else st.qty*coalesce(st.average_cost,0) end)-v_before);
  if v_adj<>0 and st.qty>0 and st.average_cost is not null then
   perform public.inventory_apply_cost_adjustment(proof.warehouse_id,li.item_id,v_adj,p_tanggal,'purchase-correction',inv.no_faktur);
  end if;
  select * into st from public.stock where id=st.id;
  v_after:=case when st.qty=0 then 0 else st.qty*coalesce(st.average_cost,0) end;
 else
  v_after:=(select coalesce(sum(l.qty_left*l.unit_cost),0) from public.stock_layers l where l.warehouse_id=proof.warehouse_id and l.item_id=li.item_id);
 end if;

 -- 4) Jurnal: persediaan = perubahan nilai stok yang benar-benar terjadi; HPP = sisa selisih DPP.
 v_inv:=round(v_after-v_before,2);
 v_hpp:=v_dpp-v_inv;
 select coalesce(jsonb_agg(x order by x.ord),'[]') into v_lines from (
  select 1 ord,'1301' code,greatest(v_inv,0) debit,greatest(-v_inv,0) credit
  union all select 2,'5101',greatest(v_hpp,0),greatest(-v_hpp,0)
  union all select 3,'1105',greatest(v_ppn,0),greatest(-v_ppn,0)
  union all select 4,'2101',greatest(-v_ap,0),greatest(v_ap,0)
 ) x where x.debit<>0 or x.credit<>0;
 v_journal:=public.clinic_write_journal(p_tanggal,left('Koreksi faktur pembelian '||inv.no_faktur||' ('||li.nama||'): '||btrim(p_reason),500),
  'purchase-inv-correction',inv.no_faktur,proof.branch_id,(select coalesce(jsonb_agg(x.value-'ord'),'[]') from jsonb_array_elements(v_lines) x));

 update public.purchase_invoice_items set qty=p_qty,harga=p_harga where id=li.id;
 update public.purchase_invoices set total=v_new_total,revision=revision+1 where id=inv.id;

 result:=jsonb_build_object(
  'correction_id',v_correction,'invoice_id',inv.id,'no_faktur',inv.no_faktur,'line_id',li.id,'item_id',li.item_id,'nama',li.nama,'satuan',li.satuan,'faktor',v_faktor,
  'cost_method',case when v_avg then 'moving_average' else 'fifo' end,'tanggal',p_tanggal,
  'old_qty',li.qty,'new_qty',p_qty,'old_harga',li.harga,'new_harga',p_harga,
  'old_unit_cost',round(v_old_cost,6),'new_unit_cost',round(v_new_cost,6),
  'remaining_qty',v_remaining/v_faktor,'sold_qty',v_sold/v_faktor,'removed_qty',v_removed/v_faktor,
  'remaining_qty_base',v_remaining,'sold_qty_base',v_sold,'removed_qty_base',v_removed,
  'old_total',inv.total,'new_total',v_new_total,'paid',v_paid,
  'ap_delta',v_ap,'dpp_delta',v_dpp,'ppn_delta',v_ppn,'inventory_delta',v_inv,'hpp_delta',v_hpp,
  'journal_id',v_journal,'no_jurnal',(select no_jurnal from public.journal_entries where id=v_journal),
  'lines',(select coalesce(jsonb_agg(jsonb_build_object('code',x.value->>'code','name',a.name,'debit',(x.value->>'debit')::numeric,'credit',(x.value->>'credit')::numeric) order by (x.value->>'ord')::int),'[]')
   from jsonb_array_elements(v_lines) x left join public.coa_accounts a on a.code=x.value->>'code'));
 insert into public.purchase_invoice_corrections(id,invoice_id,invoice_item_id,item_id,actor_id,request_key,payload,tanggal,reason,old_qty,new_qty,old_harga,new_harga,faktor,
  old_unit_cost,new_unit_cost,remaining_qty,sold_qty,removed_qty,old_total,new_total,ap_delta,dpp_delta,ppn_delta,inventory_delta,hpp_delta,cost_method,journal_id,result)
 values(v_correction,inv.id,li.id,li.item_id,auth.uid(),p_request_key,p_payload,p_tanggal,btrim(p_reason),li.qty,p_qty,li.harga,p_harga,v_faktor,
  v_old_cost,v_new_cost,v_remaining,v_sold,v_removed,inv.total,v_new_total,v_ap,v_dpp,v_ppn,v_inv,v_hpp,result->>'cost_method',v_journal,result);
 insert into public.purchase_invoice_correction_layers(correction_id,invoice_id,item_id,layer_id,role)
 select v_correction,inv.id,li.item_id,unnest(v_retired),'retired' union all select v_correction,inv.id,li.item_id,unnest(v_created),'created';
 -- Periksa ulang hak akses setelah semua kunci (sama dengan pola faktur lain).
 perform public.purchase_invoice_scope(proof.branch_id,proof.warehouse_id,inv.supplier_id);
 if not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then raise exception 'Koreksi harga faktur hanya oleh OWNER' using errcode='42501';end if;
 if p_preview then raise exception using errcode='VP002',message='purchase-inv-correction-preview',detail=result::text;end if;
 return result;
end$$;
revoke all on function public.purchase_invoice_line_correction_run(uuid,numeric,numeric,date,text,text,jsonb,boolean) from public,anon,authenticated,service_role;

create or replace function public.preview_purchase_invoice_line_correction(p_line_id uuid,p_qty numeric,p_harga numeric,p_tanggal date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_detail text;begin
 begin
  perform public.purchase_invoice_line_correction_run(p_line_id,p_qty,p_harga,p_tanggal,'Pratinjau koreksi','preview:'||gen_random_uuid()::text,'{}'::jsonb,true);
 exception when sqlstate 'VP002' then
  get stacked diagnostics v_detail=pg_exception_detail;
  return v_detail::jsonb-'correction_id'-'journal_id'-'no_jurnal';
 end;
 raise exception 'Pratinjau koreksi tidak menghasilkan dampak';
end$$;
revoke all on function public.preview_purchase_invoice_line_correction(uuid,numeric,numeric,date) from public,anon,service_role;
grant execute on function public.preview_purchase_invoice_line_correction(uuid,numeric,numeric,date) to authenticated;

create or replace function public.correct_purchase_invoice_line(
 p_request_key text,p_line_id uuid,p_expected_revision integer,p_qty numeric,p_harga numeric,p_tanggal date,p_reason text,p_expected jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb;prior public.purchase_invoice_corrections%rowtype;result jsonb;k text;v_revision integer;begin
 perform public.purchase_assert_access('invoice',null);
 if not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then raise exception 'Koreksi harga faktur hanya oleh OWNER' using errcode='42501';end if;
 if p_request_key is null or length(btrim(p_request_key)) not between 8 and 120 or p_request_key like 'preview:%' then raise exception 'Identitas koreksi tidak valid';end if;
 if jsonb_typeof(p_expected) is distinct from 'object' then raise exception 'Buka pratinjau dampak sebelum menyimpan koreksi';end if;
 payload:=jsonb_build_object('line_id',p_line_id,'revision',p_expected_revision,'qty',p_qty,'harga',p_harga,'tanggal',p_tanggal,'reason',btrim(coalesce(p_reason,'')));
 perform pg_advisory_xact_lock(hashtextextended('purchase-inv-correction:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.purchase_invoice_corrections where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Kunci koreksi sudah dipakai dengan rincian berbeda';end if;
  return prior.result;
 end if;
 select i.revision into v_revision from public.purchase_invoice_items ii join public.purchase_invoices i on i.id=ii.invoice_id where ii.id=p_line_id;
 if v_revision is distinct from p_expected_revision then raise exception 'Faktur sudah berubah sejak pratinjau. Muat ulang pratinjau';end if;
 result:=public.purchase_invoice_line_correction_run(p_line_id,p_qty,p_harga,p_tanggal,p_reason,p_request_key,payload,false);
 if (select revision from public.purchase_invoices where id=(result->>'invoice_id')::uuid) is distinct from p_expected_revision+1 then
  raise exception 'Faktur sudah berubah sejak pratinjau. Muat ulang pratinjau';end if;
 foreach k in array array['remaining_qty','sold_qty','removed_qty','ap_delta','ppn_delta','inventory_delta','hpp_delta'] loop
  if (p_expected->>k)::numeric is distinct from (result->>k)::numeric then
   raise exception 'Dampak koreksi berubah sejak pratinjau (stok atau nilai bergerak). Buka pratinjau ulang';end if;
 end loop;
 return result;
end$$;
revoke all on function public.correct_purchase_invoice_line(text,uuid,integer,numeric,numeric,date,text,jsonb) from public,anon,service_role;
grant execute on function public.correct_purchase_invoice_line(text,uuid,integer,numeric,numeric,date,text,jsonb) to authenticated;

comment on function public.correct_purchase_invoice_line(text,uuid,integer,numeric,numeric,date,text,jsonb) is
 'P02: OWNER-only atomic purchase invoice line price/qty-down correction; remaining stock revalued, sold part to HPP, AP adjusted, history kept.';
