-- N01/J01 (keputusan pemilik 29 Okt 2026): Retur Penjualan untuk Faktur Penjualan grosir/B2B.
--
-- Sebelumnya retur hanya ada untuk struk kasir (sales_returns → sales). Faktur grosir yang
-- barangnya dikembalikan pelanggan tidak punya dokumen: koreksi faktur hanya boleh mengubah
-- harga/tempo/catatan, dan perubahan qty "memerlukan rekonsiliasi pengiriman atau retur fisik".
--
-- Dokumen baru: wholesale_returns (+ wholesale_return_items), selalu menunjuk SATU faktur grosir
-- aktif yang sudah diposting dari pesanan (bukan saldo awal, bukan selisih opname).
--
-- Efek satu transaksi (post_wholesale_return):
--  * qty per baris ≤ qty faktur − qty yang sudah diretur (retur aktif);
--  * barang persediaan masuk lagi ke gudang pilihan (cabang faktur) lewat stock_in_fifo pada HPP
--    asal baris faktur (alokasi pengiriman), sama seperti retur struk kasir memulihkan modal;
--    pada mode moving average nilainya ikut tercampur ke rata-rata lewat mutasi yang sama;
--  * jurnal 'wholesale-return' seimbang: Dr 4101 pendapatan bruto, Cr 4102 diskon, Dr 2201 PPN,
--    Cr 1201 piutang (selama faktur masih punya sisa tagihan), Cr 2103 kredit pelanggan (bagian
--    yang sudah dibayar — mekanisme kredit pelanggan grosir yang sama dengan koreksi J01),
--    Dr 1301 persediaan / Cr 5101 HPP senilai modal yang kembali;
--  * piutang faktur berkurang lewat kolom sales_invoices.returned_ar (bukan baris penerimaan,
--    jadi kas/penerimaan tidak tercemar); status lunas dihitung ulang.
-- Nilai pendapatan/diskon/PPN dihitung kumulatif terhadap nilai jurnal faktur, sehingga retur
-- seluruh qty membalik persis jurnal fakturnya (tanpa selisih pembulatan).
--
-- Pembatalan (void_wholesale_return, OWNER/FINANCE): hanya bila lapisan stok retur masih utuh;
-- lapisan dinolkan, mutasi pembalik pada harga asal (moving average memperlakukannya seperti
-- pembatalan penerimaan), jurnal dibalik dengan jurnal baru, piutang/kredit dikembalikan.
--
-- Pengaman lain: faktur dengan retur aktif tidak bisa dibatalkan/diganti/diedit (trigger), jadi
-- koreksi lama tidak bisa diam-diam menagih ulang barang yang sudah kembali. Penerimaan
-- (receive_wholesale_payment/cancel_wholesale_receipt) ikut memperhitungkan returned_ar.
-- Idempoten per (aktor, kunci) lewat wholesale_operation_requests jenis 'return'/'return-void'.

-- ───────────────────────── 1. Skema ─────────────────────────
alter table public.sales_invoices
 add column returned_ar numeric(15,2) not null default 0 check(returned_ar>=0);
comment on column public.sales_invoices.returned_ar is
 'Pengurang piutang dari retur grosir aktif (wholesale_returns.ar_reduction). Sisa = total - carried_paid - returned_ar - penerimaan.';

create table public.wholesale_returns(
 id uuid primary key default gen_random_uuid(),
 no_retur varchar(30) not null unique,
 invoice_id uuid not null references public.sales_invoices(id),
 branch_id uuid references public.branches(id),
 customer_id uuid references public.customers(id),
 warehouse_id uuid references public.warehouses(id),
 tanggal date not null,
 alasan text not null check(length(btrim(alasan)) between 3 and 1000),
 -- Nilai jurnal (rupiah bulat, kumulatif terhadap jurnal faktur).
 gross numeric(15,2) not null check(gross>=0),
 diskon numeric(15,2) not null default 0 check(diskon>=0),
 ppn numeric(15,2) not null default 0 check(ppn>=0),
 total numeric(15,2) not null check(total>=0),
 ar_reduction numeric(15,2) not null check(ar_reduction>=0),
 customer_credit numeric(15,2) not null check(customer_credit>=0),
 hpp numeric(15,2) not null default 0 check(hpp>=0),
 status text not null default 'posted' check(status in ('posted','batal')),
 journal_id uuid not null unique references public.journal_entries(id),
 revision integer not null default 0,
 voided_at timestamptz, voided_on date, void_reason text,
 voided_by uuid references public.profiles(id),
 reversal_journal_id uuid unique references public.journal_entries(id),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 check(total=gross-diskon+ppn),
 check(ar_reduction+customer_credit=total),
 check((status='posted' and voided_at is null and reversal_journal_id is null)
  or (status='batal' and voided_at is not null and voided_on is not null and reversal_journal_id is not null and length(btrim(coalesce(void_reason,'')))>=3))
);
create index on public.wholesale_returns(invoice_id);
create index on public.wholesale_returns(customer_id);
create index on public.wholesale_returns(tanggal);

create table public.wholesale_return_items(
 id uuid primary key default gen_random_uuid(),
 return_id uuid not null references public.wholesale_returns(id),
 invoice_item_id uuid not null references public.sales_invoice_items(id),
 item_id uuid references public.items(id),
 nama varchar(160) not null,
 satuan varchar(20),
 faktor numeric not null check(faktor>0),
 qty numeric not null check(qty>0),
 harga numeric(15,2) not null check(harga>=0),
 -- Nilai baris persis (qty × harga dan porsi diskon baris); dasar pembulatan kumulatif.
 gross numeric(15,2) not null check(gross>=0),
 diskon numeric(15,2) not null default 0 check(diskon>=0),
 hpp numeric(15,2) not null default 0 check(hpp>=0),
 stocked boolean not null,
 exp_date date,
 unique(return_id,invoice_item_id)
);
create index on public.wholesale_return_items(invoice_item_id);

alter table public.wholesale_returns enable row level security;
alter table public.wholesale_return_items enable row level security;
revoke all on public.wholesale_returns,public.wholesale_return_items from public,anon,authenticated,service_role;
grant select on public.wholesale_returns,public.wholesale_return_items to authenticated;
-- Visibilitas mengikuti faktur sumbernya (RLS cabang sales_invoices), sama dengan koreksi grosir.
create policy wholesale_returns_read on public.wholesale_returns for select to authenticated
 using(exists(select 1 from public.sales_invoices i where i.id=invoice_id));
create policy wholesale_return_items_read on public.wholesale_return_items for select to authenticated
 using(exists(select 1 from public.wholesale_returns r where r.id=return_id));

-- Dokumen terposting tidak diubah selain transisi pembatalan resmi; baris tidak pernah berubah.
create function public.guard_wholesale_return_record() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_table_name='wholesale_return_items' or tg_op='DELETE' then
  raise exception 'Retur penjualan grosir terposting tidak dapat diubah atau dihapus; gunakan pembatalan retur' using errcode='42501';
 end if;
 if old.status<>'posted' or new.status<>'batal'
  or (to_jsonb(new)-array['status','revision','voided_at','voided_on','void_reason','voided_by','reversal_journal_id'])
   is distinct from (to_jsonb(old)-array['status','revision','voided_at','voided_on','void_reason','voided_by','reversal_journal_id']) then
  raise exception 'Retur penjualan grosir hanya dapat dibatalkan lewat proses resmi' using errcode='42501';
 end if;
 return new;
end$$;
revoke all on function public.guard_wholesale_return_record() from public,anon,authenticated,service_role;
create trigger wholesale_return_record_guard before update or delete on public.wholesale_returns
 for each row execute function public.guard_wholesale_return_record();
create trigger wholesale_return_item_guard before update or delete on public.wholesale_return_items
 for each row execute function public.guard_wholesale_return_record();

-- returned_ar hanya diubah proses retur (SECURITY DEFINER). Klien tidak boleh menyentuhnya,
-- termasuk pada faktur selisih opname yang memang boleh ditulis klien.
create function public.guard_wholesale_returned_ar() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon','service_role')
  and ((tg_op='INSERT' and new.returned_ar<>0) or (tg_op='UPDATE' and new.returned_ar is distinct from old.returned_ar)) then
  raise exception 'Pengurang piutang retur hanya melalui dokumen retur penjualan' using errcode='42501';
 end if;
 return new;
end$$;
revoke all on function public.guard_wholesale_returned_ar() from public,anon,authenticated,service_role;
create trigger wholesale_returned_ar_guard before insert or update of returned_ar on public.sales_invoices
 for each row execute function public.guard_wholesale_returned_ar();

-- Faktur yang punya retur aktif tidak boleh dibatalkan/diganti (koreksi harga, edit baris,
-- pembatalan tagihan). Kalau boleh, faktur pengganti akan menagih lagi barang yang sudah kembali.
create function public.guard_wholesale_invoice_with_return() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='batal' and old.status is distinct from 'batal'
  and exists(select 1 from public.wholesale_returns r where r.invoice_id=old.id and r.status='posted') then
  raise exception 'Faktur ini punya retur penjualan aktif. Batalkan returnya dulu sebelum mengoreksi, mengedit atau membatalkan faktur' using errcode='22023';
 end if;
 return new;
end$$;
revoke all on function public.guard_wholesale_invoice_with_return() from public,anon,authenticated,service_role;
create trigger wholesale_invoice_return_guard before update of status on public.sales_invoices
 for each row execute function public.guard_wholesale_invoice_with_return();

-- Jurnal dan mutasi stok retur grosir hanya lewat proses resmi.
create function public.guard_wholesale_return_effect() returns trigger
language plpgsql set search_path='' as $$
declare protected boolean:=false;
begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then
   protected:=coalesce(new.source in ('wholesale-return','wholesale-return-void'),false) or coalesce(old.source in ('wholesale-return','wholesale-return-void'),false);
  elsif tg_table_name='journal_lines' then
   protected:=exists(select 1 from public.journal_entries e where e.id in (new.entry_id,old.entry_id) and e.source in ('wholesale-return','wholesale-return-void'));
  else
   protected:=coalesce(new.source in ('wholesale-return','wholesale-return-void'),false) or coalesce(old.source in ('wholesale-return','wholesale-return-void'),false);
  end if;
  if protected then raise exception 'Jurnal/mutasi retur penjualan grosir hanya melalui proses resmi' using errcode='42501';end if;
 end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_wholesale_return_effect() from public,anon,authenticated,service_role;
create trigger wholesale_return_journal_guard before insert or update or delete on public.journal_entries
 for each row execute function public.guard_wholesale_return_effect();
create trigger wholesale_return_journal_line_guard before insert or update or delete on public.journal_lines
 for each row execute function public.guard_wholesale_return_effect();
create trigger wholesale_return_stock_move_guard before insert or update or delete on public.stock_moves
 for each row execute function public.guard_wholesale_return_effect();
create trigger wholesale_return_stock_layer_guard before insert or update or delete on public.stock_layers
 for each row execute function public.guard_wholesale_return_effect();

-- Idempotensi ikut tabel permintaan grosir yang sudah ada.
alter table public.wholesale_operation_requests drop constraint wholesale_operation_requests_kind_check;
alter table public.wholesale_operation_requests add constraint wholesale_operation_requests_kind_check
 check(kind in ('receipt','correction','line-edit','receipt-cancel','return','return-void'));

-- ───────────────────── 2. Tambalan fungsi berjalan ─────────────────────
-- Gaya jangkar eksak dan gagal tertutup, sama dengan 20261030120000_faktur_jual_edit_penerimaan.
do $patch$
declare p record; definition text; signature regprocedure; hits integer;
begin
 for p in select * from (values
 -- A. Sisa tagihan saat menerima pembayaran ikut dikurangi retur.
 ('public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text)',1,
  ' select inv.carried_paid+coalesce(sum(jumlah),0) into paid from public.sales_receipts where invoice_id=inv.id;',
  ' select inv.carried_paid+inv.returned_ar+coalesce(sum(jumlah),0) into paid from public.sales_receipts where invoice_id=inv.id;'),
 -- B. Status lunas setelah penerimaan dihapus ikut memperhitungkan retur.
 ('public.cancel_wholesale_receipt(uuid,integer,text,text)',1,
  ' select inv.carried_paid+coalesce(sum(jumlah),0) into paid from public.sales_receipts where invoice_id=inv.id;',
  ' select inv.carried_paid+inv.returned_ar+coalesce(sum(jumlah),0) into paid from public.sales_receipts where invoice_id=inv.id;'),
 -- C. "Periksa hasil terakhir" melayani retur (OWNER/ADMIN/FINANCE) dan pembatalannya (OWNER/FINANCE).
 ('public.get_wholesale_operation(uuid,text,text)',1,
  E'p_kind in (''correction'',''line-edit'',''receipt-cancel'')',
  E'p_kind in (''correction'',''line-edit'',''receipt-cancel'',''return-void'')'),
 ('public.get_wholesale_operation(uuid,text,text)',1,
  E'if p_kind not in (''receipt'',''correction'',''line-edit'',''receipt-cancel'') then',
  E'if p_kind not in (''receipt'',''correction'',''line-edit'',''receipt-cancel'',''return'',''return-void'') then'),
 -- D. Moving average: mutasi pembatalan retur mengeluarkan nilai pada harga asal retur.
 ('public.inventory_record_valuation()',1,
  E'new.source in(''purchase-invoice-void'',''purchase-receipt-void'')',
  E'new.source in(''purchase-invoice-void'',''purchase-receipt-void'',''wholesale-return-void'')')
 ) as patches(sig,expected,old_text,new_text) loop
  signature:=to_regprocedure(p.sig);
  if signature is null then raise exception 'Retur grosir: RPC wajib tidak ada: %',p.sig;end if;
  definition:=pg_get_functiondef(signature);
  hits:=(length(definition)-length(replace(definition,p.old_text,'')))/length(p.old_text);
  if hits<>p.expected then
   raise exception 'Retur grosir: jangkar harus muncul % kali di % (ketemu %); periksa definisi sebelum menerapkan',p.expected,p.sig,hits;
  end if;
  execute replace(definition,p.old_text,p.new_text);
 end loop;
end $patch$;

revoke all on function public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text) to authenticated;
revoke all on function public.cancel_wholesale_receipt(uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.cancel_wholesale_receipt(uuid,integer,text,text) to authenticated;
revoke all on function public.get_wholesale_operation(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_wholesale_operation(uuid,text,text) to authenticated;
revoke all on function public.inventory_record_valuation() from public,anon,authenticated,service_role;

-- ───────────────────── 3. Posting retur ─────────────────────
create function public.post_wholesale_return(
 p_request_key text,p_invoice_id uuid,p_tanggal date,p_warehouse_id uuid,p_alasan text,p_items jsonb
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare
 inv public.sales_invoices%rowtype;ord public.sales_orders%rowtype;prior public.wholesale_operation_requests%rowtype;
 line public.sales_invoice_items%rowtype;item record;r record;
 payload jsonb;result jsonb;lines jsonb;rows jsonb:='[]';v_doc uuid:=gen_random_uuid();v_no text;v_prefix text;v_digits integer;v_seq bigint;
 v_journal uuid;v_original uuid;v_order uuid;v_wh_branch uuid;v_type text;
 src_gross numeric;src_disc numeric;booked_gross numeric;booked_disc numeric;
 prev_qty numeric;prev_disc numeric;prev_hpp numeric;v_disc numeric;v_hpp numeric;v_base numeric;v_stocked boolean;v_count integer;
 prev_line_gross numeric;prev_line_disc numeric;prev_g numeric;prev_d numeric;prev_p numeric;
 cum_gross numeric;cum_disc numeric;g_after numeric;d_after numeric;p_after numeric;
 v_gross numeric:=0;v_disc_total numeric:=0;v_line_gross numeric:=0;v_line_disc numeric:=0;v_ppn numeric;v_total numeric;v_hpp_total numeric:=0;
 v_paid numeric;v_outstanding numeric;v_ar numeric;v_credit numeric;v_needs_wh boolean:=false;
begin
 select order_id into v_order from public.sales_invoices where id=p_invoice_id;
 -- Urutan kunci sama dengan penerimaan/koreksi grosir: pesanan → faktur.
 if v_order is not null then select * into ord from public.sales_orders where id=v_order for update;end if;
 select * into inv from public.sales_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Faktur grosir tidak ditemukan' using errcode='42501';end if;
 perform public.wholesale_access(inv.branch_id,false);
 if p_request_key is null or length(btrim(p_request_key)) not between 1 and 120 or p_request_key like 'preview:%'
  or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then
  raise exception 'Identitas atau rincian retur tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('invoice_id',p_invoice_id,'tanggal',p_tanggal,'warehouse_id',p_warehouse_id,'alasan',btrim(coalesce(p_alasan,'')),'items',p_items);
 perform pg_advisory_xact_lock(hashtextextended('kamo:wholesale:return:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.wholesale_operation_requests where actor_id=auth.uid() and kind='return' and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas retur dipakai untuk rincian berbeda' using errcode='22023';end if;
  return prior.result;
 end if;

 if inv.order_id is null or coalesce(inv.kategori,'penjualan')='selisih_stok' or inv.opening_batch_id is not null
  or ord.id is null or ord.branch_id is distinct from inv.branch_id or ord.customer_id is distinct from inv.customer_id then
  raise exception 'Retur hanya untuk faktur penjualan grosir dari pesanan (bukan saldo awal atau selisih stok)' using errcode='22023';end if;
 if inv.status='batal' then raise exception 'Faktur sudah dibatalkan; buat retur dari faktur penggantinya' using errcode='22023';end if;
 if exists(select 1 from public.sales_invoices where replaces_invoice_id=inv.id) then raise exception 'Faktur ini sudah diganti faktur lain; buka faktur terbaru' using errcode='22023';end if;
 if length(btrim(coalesce(p_alasan,''))) not between 3 and 1000 then raise exception 'Alasan retur wajib diisi (minimal 3 huruf)' using errcode='22023';end if;
 if p_tanggal is null or not isfinite(p_tanggal) then raise exception 'Tanggal retur tidak valid' using errcode='22023';end if;
 perform public.wholesale_period(inv.tanggal,p_tanggal);
 if p_tanggal<inv.tanggal then raise exception 'Tanggal retur mendahului tanggal faktur' using errcode='22023';end if;

 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item.value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item.value) k where k not in ('invoice_item_id','qty','exp_date')) then
   raise exception 'Rincian retur hanya baris faktur, qty dan tanggal kedaluwarsa' using errcode='22023';end if;
 end loop;
 select count(*),count(distinct x.invoice_item_id) into v_count,prev_qty from jsonb_to_recordset(p_items) as x(invoice_item_id uuid,qty numeric,exp_date date);
 if v_count<>prev_qty or exists(select 1 from jsonb_to_recordset(p_items) as x(invoice_item_id uuid) where x.invoice_item_id is null) then
  raise exception 'Pilih baris faktur dan jangan gandakan baris yang sama' using errcode='22023';end if;

 -- Bukti sumber: alokasi pengiriman/HPP baris faktur dan jurnal faktur harus utuh.
 if not exists(select 1 from public.sales_invoice_items where invoice_id=inv.id) or exists(
  select 1 from public.sales_invoice_items ii where ii.invoice_id=inv.id and (
   ii.qty<>(select coalesce(sum(a.qty),0) from public.sales_invoice_delivery_allocations a where a.invoice_item_id=ii.id)
   or coalesce(ii.hpp,0)<>(select coalesce(sum(a.hpp),0) from public.sales_invoice_delivery_allocations a where a.invoice_item_id=ii.id))) then
  raise exception 'Alokasi pengiriman/HPP faktur belum terbukti. Rekonsiliasi faktur dan pengiriman dahulu';end if;
 select coalesce(sum(qty*harga),0),coalesce(sum(coalesce(diskon,0)),0) into src_gross,src_disc from public.sales_invoice_items where invoice_id=inv.id;
 if inv.dpp is distinct from src_gross-src_disc or inv.total<>round(inv.dpp)+inv.ppn then
  raise exception 'Nilai baris/faktur tidak cocok dengan pembukuan; rekonsiliasi sumber dahulu';end if;
 booked_gross:=round(src_gross);booked_disc:=round(src_disc);
 lock table public.journal_entries in row exclusive mode;
 if (select count(*) from public.journal_entries where source='sales-invoice' and source_ref=inv.no_faktur)<>1 then raise exception 'Tautan jurnal faktur tidak unik; rekonsiliasi sumber dahulu';end if;
 select id into v_original from public.journal_entries where source='sales-invoice' and source_ref=inv.no_faktur;
 lines:=jsonb_build_array(jsonb_build_object('code','1201','debit',inv.total,'credit',0),jsonb_build_object('code','4101','debit',0,'credit',booked_gross));
 if src_disc>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','4102','debit',booked_disc,'credit',0));end if;
 if inv.ppn>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2201','debit',0,'credit',inv.ppn));end if;
 perform public.wholesale_assert_journal(v_original,'sales-invoice',inv.no_faktur,inv.tanggal,inv.branch_id,lines);

 -- Retur aktif sebelumnya pada faktur ini (sudah serial di bawah kunci faktur).
 select coalesce(sum(gross),0),coalesce(sum(diskon),0),coalesce(sum(ppn),0) into prev_g,prev_d,prev_p
  from public.wholesale_returns where invoice_id=inv.id and status='posted';
 select coalesce(sum(ri.gross),0),coalesce(sum(ri.diskon),0) into prev_line_gross,prev_line_disc
  from public.wholesale_return_items ri join public.wholesale_returns rt on rt.id=ri.return_id where rt.invoice_id=inv.id and rt.status='posted';

 for item in select * from jsonb_to_recordset(p_items) as x(invoice_item_id uuid,qty numeric,exp_date date) order by invoice_item_id loop
  select * into line from public.sales_invoice_items where id=item.invoice_item_id and invoice_id=inv.id;
  if not found then raise exception 'Baris retur bukan milik faktur ini' using errcode='22023';end if;
  if item.qty is null or item.qty<=0 or item.qty>1000000000 or item.qty::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Qty retur % tidak valid',line.nama using errcode='22023';end if;
  if item.exp_date is not null and not isfinite(item.exp_date) then raise exception 'Tanggal kedaluwarsa % tidak valid',line.nama using errcode='22023';end if;
  select coalesce(sum(ri.qty),0),coalesce(sum(ri.diskon),0),coalesce(sum(ri.hpp),0) into prev_qty,prev_disc,prev_hpp
   from public.wholesale_return_items ri join public.wholesale_returns rt on rt.id=ri.return_id
   where ri.invoice_item_id=line.id and rt.status='posted';
  if item.qty>line.qty-prev_qty then
   raise exception 'Qty retur % melebihi sisa yang bisa diretur (maksimal % %)',line.nama,
    trim(to_char(greatest(line.qty-prev_qty,0),'FM999999999990.######'),'.'),coalesce(line.satuan,'') using errcode='22003';end if;
  select line.item_id is not null and coalesce(i.item_type,'Persediaan')='Persediaan' into v_stocked from public.items i where i.id=line.item_id;
  v_stocked:=coalesce(v_stocked,false);
  if v_stocked and line.hpp is null then raise exception 'HPP baris % belum tersedia; rekonsiliasi faktur dahulu',line.nama;end if;
  if line.faktor is null or line.faktor<=0 then raise exception 'Faktor satuan baris % tidak valid; rekonsiliasi dahulu',line.nama;end if;
  -- Porsi diskon dan HPP dibulatkan kumulatif per baris: retur penuh = nilai baris persis.
  v_disc:=round(coalesce(line.diskon,0)*(prev_qty+item.qty)/line.qty,2)-prev_disc;
  v_hpp:=case when v_stocked then round(coalesce(line.hpp,0)*(prev_qty+item.qty)/line.qty,2)-prev_hpp else 0 end;
  if v_disc<0 or v_hpp<0 then raise exception 'Porsi diskon/HPP retur % tidak konsisten; rekonsiliasi dahulu',line.nama;end if;
  v_base:=item.qty*line.faktor;
  if v_stocked then v_needs_wh:=true;end if;
  v_line_gross:=v_line_gross+round(item.qty*line.harga,2);v_line_disc:=v_line_disc+v_disc;v_hpp_total:=v_hpp_total+v_hpp;
  rows:=rows||jsonb_build_array(jsonb_build_object('invoice_item_id',line.id,'item_id',line.item_id,'nama',line.nama,'satuan',line.satuan,
   'faktor',line.faktor,'qty',item.qty,'harga',line.harga,'gross',round(item.qty*line.harga,2),'diskon',v_disc,'hpp',v_hpp,
   'stocked',v_stocked,'exp_date',item.exp_date,'base',v_base));
 end loop;

 -- Nilai jurnal kumulatif terhadap jurnal faktur: retur seluruh qty = pembalik persis.
 cum_gross:=prev_line_gross+v_line_gross;cum_disc:=prev_line_disc+v_line_disc;
 g_after:=case when src_gross>0 then round(booked_gross*least(cum_gross,src_gross)/src_gross) else 0 end;
 d_after:=case when src_disc>0 then round(booked_disc*least(cum_disc,src_disc)/src_disc) else 0 end;
 p_after:=case when inv.ppn>0 and inv.dpp>0 then round(inv.ppn*least(cum_gross-cum_disc,inv.dpp)/inv.dpp) else 0 end;
 v_gross:=greatest(g_after-prev_g,0);v_disc_total:=greatest(d_after-prev_d,0);v_ppn:=greatest(p_after-prev_p,0);
 v_total:=v_gross-v_disc_total+v_ppn;
 if v_total<0 then raise exception 'Nilai retur negatif; rekonsiliasi diskon faktur dahulu';end if;
 if v_total=0 and v_hpp_total=0 then raise exception 'Nilai retur nol; tidak ada yang perlu dibukukan' using errcode='22023';end if;

 -- Piutang faktur dulu; kelebihan (faktur sudah dibayar) menjadi kredit pelanggan 2103.
 select inv.carried_paid+inv.returned_ar+coalesce(sum(jumlah),0) into v_paid from public.sales_receipts where invoice_id=inv.id;
 v_outstanding:=greatest(inv.total-v_paid,0);
 v_ar:=least(v_total,v_outstanding);v_credit:=v_total-v_ar;
 if v_credit>0 and inv.customer_id is null then raise exception 'Kredit pelanggan memerlukan identitas pelanggan; rekonsiliasi sumber dahulu';end if;

 if v_needs_wh then
  if p_warehouse_id is null then raise exception 'Pilih gudang penerima barang retur' using errcode='22023';end if;
  select branch_id into v_wh_branch from public.warehouses where id=p_warehouse_id and is_active
   and (inv.branch_id is null or branch_id=inv.branch_id) for share;
  if not found then raise exception 'Pilih gudang aktif pada cabang faktur untuk menerima barang retur' using errcode='22023';end if;
  perform public.sales_assert_access(v_wh_branch);
 end if;
 -- Retur jasa saja tidak menyentuh gudang; gudang yang dikirim formulir diabaikan (tidak disimpan).

 -- Nomor RJG (format bisa diatur di Penomoran Dokumen), unik lintas cabang.
 select pola,digit into v_prefix,v_digits from public.document_numbering where jenis='RJG';
 v_prefix:=coalesce(v_prefix,'RJG.{YYYY}.{MM}.');v_digits:=coalesce(v_digits,5);
 v_prefix:=replace(replace(replace(replace(v_prefix,'{YYYY}',to_char(p_tanggal,'YYYY')),'{YY}',to_char(p_tanggal,'YY')),'{MM}',to_char(p_tanggal,'MM')),'{DD}',to_char(p_tanggal,'DD'));
 if v_digits not between 1 and 8 or length(v_prefix)+v_digits>30 then raise exception 'Format nomor retur terlalu panjang';end if;
 perform pg_advisory_xact_lock(hashtextextended('kamo:wholesale:return-number:'||v_prefix,0));
 select coalesce(max(substring(no_retur from length(v_prefix)+1 for v_digits)::bigint),0)+1 into v_seq from public.wholesale_returns
  where left(no_retur,length(v_prefix))=v_prefix and substring(no_retur from length(v_prefix)+1 for v_digits)~'^[0-9]+$';
 if length(v_seq::text)>v_digits then raise exception 'Urutan nomor retur penuh';end if;
 v_no:=v_prefix||lpad(v_seq::text,v_digits,'0');

 lines:=jsonb_build_array(jsonb_build_object('code','4101','debit',v_gross,'credit',0));
 if v_disc_total>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','4102','debit',0,'credit',v_disc_total));end if;
 if v_ppn>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2201','debit',v_ppn,'credit',0));end if;
 if v_ar>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','1201','debit',0,'credit',v_ar));end if;
 if v_credit>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2103','debit',0,'credit',v_credit));end if;
 if v_hpp_total>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','1301','debit',v_hpp_total,'credit',0),jsonb_build_object('code','5101','debit',0,'credit',v_hpp_total));end if;
 v_journal:=public.wholesale_write_journal(p_tanggal,inv.branch_id,'wholesale-return',v_no,
  'Retur penjualan '||v_no||' atas '||inv.no_faktur||': '||btrim(p_alasan),lines);

 insert into public.wholesale_returns(id,no_retur,invoice_id,branch_id,customer_id,warehouse_id,tanggal,alasan,gross,diskon,ppn,total,
  ar_reduction,customer_credit,hpp,journal_id,created_by)
  values(v_doc,v_no,inv.id,inv.branch_id,inv.customer_id,case when v_needs_wh then p_warehouse_id end,p_tanggal,btrim(p_alasan),v_gross,v_disc_total,v_ppn,v_total,
  v_ar,v_credit,v_hpp_total,v_journal,auth.uid());
 -- Barang kembali ke gudang pada HPP asal; urutan per barang menjaga urutan kunci saldo stok.
 for r in select * from jsonb_to_recordset(rows) as x(invoice_item_id uuid,item_id uuid,nama text,satuan text,faktor numeric,qty numeric,harga numeric,
   gross numeric,diskon numeric,hpp numeric,stocked boolean,exp_date date,base numeric) order by item_id nulls last,invoice_item_id loop
  insert into public.wholesale_return_items(return_id,invoice_item_id,item_id,nama,satuan,faktor,qty,harga,gross,diskon,hpp,stocked,exp_date)
   values(v_doc,r.invoice_item_id,r.item_id,r.nama,r.satuan,r.faktor,r.qty,r.harga,r.gross,r.diskon,r.hpp,r.stocked,r.exp_date);
  if r.stocked then
   perform public.stock_in_fifo(p_warehouse_id,r.item_id,r.base,r.hpp/r.base,'wholesale-return',v_no,p_tanggal,r.exp_date);
  end if;
 end loop;

 update public.sales_invoices set returned_ar=returned_ar+v_ar,
  status=case when v_paid+v_ar>=total then 'lunas' else 'berjalan' end,revision=revision+1 where id=inv.id;
 -- Periksa ulang hak akses setelah semua kunci, sama dengan proses grosir lain.
 perform public.wholesale_access(inv.branch_id,false);
 result:=jsonb_build_object('return_id',v_doc,'document_no',v_no,'invoice_id',inv.id,'journal_id',v_journal,
  'total',v_total,'ar_reduction',v_ar,'customer_credit',v_credit,'hpp',v_hpp_total);
 insert into public.wholesale_operation_requests(actor_id,kind,request_key,invoice_id,payload,result)
  values(auth.uid(),'return',p_request_key,inv.id,payload,result);
 return result;
end$$;
revoke all on function public.post_wholesale_return(text,uuid,date,uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.post_wholesale_return(text,uuid,date,uuid,text,jsonb) to authenticated;

-- ───────────────────── 4. Pembatalan retur ─────────────────────
create function public.void_wholesale_return(p_return_id uuid,p_expected_revision integer,p_request_key text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare
 ret public.wholesale_returns%rowtype;inv public.sales_invoices%rowtype;prior public.wholesale_operation_requests%rowtype;
 r record;payload jsonb;result jsonb;lines jsonb;moves jsonb;layers jsonb;v_invoice uuid;v_order uuid;v_reversal uuid;v_paid numeric;
 today date:=(now() at time zone 'Asia/Jakarta')::date;
 consumed constant text:='Barang dari retur ini sudah terpakai atau keluar dari gudang, jadi retur tidak bisa dibatalkan otomatis. Minta keuangan merekonsiliasi.';
begin
 select invoice_id into v_invoice from public.wholesale_returns where id=p_return_id;
 if not found then raise exception 'Retur penjualan tidak ditemukan' using errcode='42501';end if;
 -- Urutan kunci sama dengan posting retur: pesanan → faktur → retur.
 select order_id into v_order from public.sales_invoices where id=v_invoice;
 if v_order is not null then perform 1 from public.sales_orders where id=v_order for update;end if;
 select * into inv from public.sales_invoices where id=v_invoice for update;
 select * into ret from public.wholesale_returns where id=p_return_id for update;
 perform public.wholesale_access(inv.branch_id,true);
 if p_request_key is null or length(btrim(p_request_key)) not between 1 and 120 or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Identitas atau alasan pembatalan retur tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('return_id',p_return_id,'revision',p_expected_revision,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('kamo:wholesale:return-void:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.wholesale_operation_requests where actor_id=auth.uid() and kind='return-void' and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas pembatalan dipakai untuk rincian berbeda' using errcode='22023';end if;
  return prior.result;
 end if;
 if ret.status<>'posted' then raise exception 'Retur ini sudah dibatalkan';end if;
 if ret.revision<>p_expected_revision then raise exception 'Retur sudah berubah. Muat ulang sebelum membatalkan' using errcode='40001';end if;
 perform public.wholesale_period(ret.tanggal,today);

 -- Jurnal retur harus persis seperti dokumennya sebelum dibalik.
 lock table public.journal_entries in row exclusive mode;
 lines:=jsonb_build_array(jsonb_build_object('code','4101','debit',ret.gross,'credit',0),
  jsonb_build_object('code','4102','debit',0,'credit',ret.diskon),jsonb_build_object('code','2201','debit',ret.ppn,'credit',0),
  jsonb_build_object('code','1201','debit',0,'credit',ret.ar_reduction),jsonb_build_object('code','2103','debit',0,'credit',ret.customer_credit),
  jsonb_build_object('code','1301','debit',ret.hpp,'credit',0),jsonb_build_object('code','5101','debit',0,'credit',ret.hpp));
 perform public.wholesale_assert_journal(ret.journal_id,'wholesale-return',ret.no_retur,ret.tanggal,inv.branch_id,lines);
 if inv.returned_ar<ret.ar_reduction then raise exception 'Pengurang piutang faktur tidak cocok dengan retur; rekonsiliasi dahulu';end if;

 -- Stok: lapisan retur harus utuh dan saldo cukup; kunci saldo agregat sebelum lapisan.
 if exists(select 1 from public.wholesale_return_items where return_id=ret.id and stocked) then
  for r in select distinct item_id from public.wholesale_return_items where return_id=ret.id and stocked order by item_id loop
   perform 1 from public.stock where warehouse_id=ret.warehouse_id and item_id=r.item_id for update;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.item_id,m.id),'[]') into moves from public.stock_moves m
   where m.warehouse_id=ret.warehouse_id and m.source='wholesale-return' and m.source_ref=ret.no_retur;
  perform 1 from public.stock_layers l where l.warehouse_id=ret.warehouse_id and l.source='wholesale-return' and l.source_ref=ret.no_retur order by l.id for update;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.item_id,l.id),'[]') into layers from public.stock_layers l
   where l.warehouse_id=ret.warehouse_id and l.source='wholesale-return' and l.source_ref=ret.no_retur;
  for r in select ri.item_id,sum(ri.qty*ri.faktor) expected,
    coalesce((select sum((x->>'qty')::numeric) from jsonb_array_elements(moves) x where (x->>'item_id')::uuid=ri.item_id),0) moved,
    coalesce((select sum((x->>'qty_in')::numeric) from jsonb_array_elements(layers) x where (x->>'item_id')::uuid=ri.item_id),0) layered,
    coalesce((select bool_and((x->>'qty_left')::numeric=(x->>'qty_in')::numeric) from jsonb_array_elements(layers) x where (x->>'item_id')::uuid=ri.item_id),true) untouched
   from public.wholesale_return_items ri where ri.return_id=ret.id and ri.stocked group by ri.item_id order by ri.item_id loop
   if r.moved<>r.expected then raise exception 'Mutasi stok retur tidak cocok dengan dokumennya; rekonsiliasi dahulu';end if;
   if r.layered<>r.moved or not r.untouched then raise exception '%',consumed;end if;
  end loop;
  update public.stock_layers set qty_left=0 where id in (select (x->>'id')::uuid from jsonb_array_elements(layers) x);
  for r in select (x->>'item_id')::uuid item_id,sum((x->>'qty')::numeric) qty,sum((x->>'qty')::numeric*(x->>'unit_cost')::numeric) val
    from jsonb_array_elements(moves) x group by 1 order by 1 loop
   update public.stock set qty=qty-r.qty,updated_at=now() where warehouse_id=ret.warehouse_id and item_id=r.item_id and qty>=r.qty;
   if not found then raise exception '%',consumed;end if;
   insert into public.stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref)
    values(today,ret.warehouse_id,r.item_id,-r.qty,r.val/r.qty,'wholesale-return-void',ret.no_retur);
  end loop;
 end if;

 select jsonb_agg(jsonb_build_object('code',a.code,'debit',l.credit,'credit',l.debit)) into lines
  from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=ret.journal_id;
 v_reversal:=public.wholesale_write_journal(today,inv.branch_id,'wholesale-return-void',ret.id::text,
  'Pembatalan retur '||ret.no_retur||' atas '||inv.no_faktur||': '||btrim(p_reason),lines);
 update public.wholesale_returns set status='batal',voided_at=now(),voided_on=today,void_reason=btrim(p_reason),voided_by=auth.uid(),
  reversal_journal_id=v_reversal,revision=revision+1 where id=ret.id;
 select inv.carried_paid+(inv.returned_ar-ret.ar_reduction)+coalesce(sum(jumlah),0) into v_paid from public.sales_receipts where invoice_id=inv.id;
 update public.sales_invoices set returned_ar=returned_ar-ret.ar_reduction,
  status=case when status='batal' then status when v_paid>=total then 'lunas' else 'berjalan' end,revision=revision+1 where id=inv.id;
 perform public.wholesale_access(inv.branch_id,true);
 result:=jsonb_build_object('return_id',ret.id,'document_no',ret.no_retur,'invoice_id',inv.id,'reversal_journal_id',v_reversal,
  'ar_restored',ret.ar_reduction,'credit_reversed',ret.customer_credit,'tanggal',today);
 insert into public.wholesale_operation_requests(actor_id,kind,request_key,invoice_id,payload,result)
  values(auth.uid(),'return-void',p_request_key,inv.id,payload,result);
 return result;
end$$;
revoke all on function public.void_wholesale_return(uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.void_wholesale_return(uuid,integer,text,text) to authenticated;

-- ───────────────────── 5. Log aktivitas (A01) ─────────────────────
insert into public.activity_log_sources
 (entity,module_id,label_key,value_keys,scope_kind,identity_keys,branch_columns,scope_parents,metadata_only,parent_entity,parent_key,reader_roles)
values
 ('wholesale_returns','penjualan','no_retur',array['tanggal','total','ar_reduction','customer_credit','hpp','status','voided_on','revision'],
  'refs',array['id'],array['branch_id'],'[{"entity":"sales_invoices","key":"invoice_id"}]',false,null,null,array['OWNER','ADMIN']),
 ('wholesale_return_items','penjualan',null,array['qty','harga','gross','diskon','hpp'],
  'refs',array['id'],'{}','[{"entity":"wholesale_returns","key":"return_id"},{"entity":"sales_invoice_items","key":"invoice_item_id"}]',false,'wholesale_returns','return_id',array['OWNER','ADMIN'])
on conflict (entity) do nothing;
create trigger a01_activity_change after insert or update on public.wholesale_returns for each row execute function public.capture_activity_log();
create trigger a01_activity_delete before delete on public.wholesale_returns for each row execute function public.capture_activity_log();
create trigger a01_activity_change after insert or update on public.wholesale_return_items for each row execute function public.capture_activity_log();
create trigger a01_activity_delete before delete on public.wholesale_return_items for each row execute function public.capture_activity_log();
