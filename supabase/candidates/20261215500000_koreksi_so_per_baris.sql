-- KOREKSI-SO-PER-BARIS (Andri 26 Nov 2026: 'Go koreksi SO per baris').
-- Apply as ONE transaction (seluruh file satu transaksi; file ini sengaja tanpa begin/commit sendiri).
--
-- MASALAH. stock_correction_plan memutar ulang SEMUA baris dokumen (membalik lalu memosting ulang walau jumlahnya tidak berubah) dan setiap
--  pemeriksaan ketergantungan melempar galat untuk SELURUH dokumen. Satu baris yang lapisannya sudah terpakai (OPR.00009: Pelontar obat Vet) menutup
--  koreksi baris lain (TH4 Disinfektan, Shampoo Grooming 3in1 20L) yang lapisannya utuh.
--
-- ATURAN BARU (per baris; keputusan dan alasan: DESIGN.md)
--  1. Baris yang jumlahnya TIDAK diubah tidak disentuh (tidak dibalik, tidak diposting ulang, tidak dinilai ulang) dan tidak memblokir apa pun.
--  2. Baris yang diubah memakai semua pemeriksaan lama, tetapi per baris: gagal -> baris itu 'tertahan' (nama barang + alasan), baris lain jalan.
--     Semua baris yang diubah tertahan -> galat berisi daftar alasan; tidak ada yang ditulis.
--  3. Jurnal tetap dokumen-lebar: pembalik persis seluruh jurnal sumber + SATU jurnal pengganti neto atas SEMUA baris (baris tidak disentuh bernilai asli).
--  4. Beban ke karyawan: baris yang diubah dan berdampak pada beban aktif ditahan dengan pesan yang menyebut karyawan, nominal, dan tempat membatalkan;
--     trigger guard_opname_correction_charge tetap sebagai pagar terakhir (hanya lolos bila plan sudah memeriksa beban).
--  5. Revisi lanjutan: pembandingan lapisan/mutasi per BARANG baris yang diubah (dulu: seluruh barang dokumen); baris tidak disentuh membawa sumber efeknya
--     (src/src_ref) pada after_state agar rantai revisi tetap bisa dibaca.
--  Fungsi baru: stock_correction_charge_note (internal, tanpa EXECUTE klien). Fungsi diganti: stock_correction_plan, correct_stock_document,
--  preview_stock_document_correction, guard_opname_correction_charge. ACL/DEFINER/search_path sama seperti sebelumnya.
--
-- ROLLBACK: ROLLBACK.sql (pasang ulang 4 definisi lama + drop function stock_correction_charge_note). Koreksi yang sudah tersimpan tetap ada (data).

do $pre$ begin
 if to_regprocedure('public.stock_correction_plan(text,uuid,jsonb)') is null
  or to_regprocedure('public.correct_stock_document(text,uuid,jsonb,text,text,text)') is null
  or to_regprocedure('public.preview_stock_document_correction(text,uuid,jsonb)') is null
  or to_regprocedure('public.guard_opname_correction_charge()') is null
  or to_regprocedure('public.stock_correction_source(text,uuid)') is null
  or to_regprocedure('public.opname_surplus_cost(uuid,uuid,numeric)') is null
  or to_regclass('public.opname_variance_charges') is null
  or to_regclass('public.opname_posting_receipts') is null
 then raise exception 'KOREKSI_PER_BARIS_SOURCE_CHANGED: prasyarat tidak lengkap'; end if;
 -- Kontrak sumber: definisi yang ditinjau (sidik md5 sama dengan Production 26 Nov); gagal tertutup bila berbeda.
 if md5(pg_get_functiondef('public.stock_correction_plan(text,uuid,jsonb)'::regprocedure)) is distinct from '20035ece6dd227e76d4a6f3a1ba0ed17'
  or md5(pg_get_functiondef('public.correct_stock_document(text,uuid,jsonb,text,text,text)'::regprocedure)) is distinct from '944ef107af28fb6b15fecff1d72d14e8'
  or md5(pg_get_functiondef('public.preview_stock_document_correction(text,uuid,jsonb)'::regprocedure)) is distinct from '2342e719d164cefd6b02f60f54bf4908'
  or md5(pg_get_functiondef('public.guard_opname_correction_charge()'::regprocedure)) is distinct from '40992eb286dd0a971acb296d47e0d9b1'
  or md5(pg_get_functiondef('public.stock_correction_source(text,uuid)'::regprocedure)) is distinct from '7501fad7b607e9ea6a8259ebb61bd996'
 then raise exception 'KOREKSI_PER_BARIS_SOURCE_CHANGED: definisi fungsi koreksi stok berbeda dari yang ditinjau'; end if;
 if to_regprocedure('public.stock_correction_charge_note(uuid)') is not null then raise exception 'KOREKSI_PER_BARIS_SOURCE_CHANGED: stock_correction_charge_note sudah ada'; end if;
end $pre$;

CREATE OR REPLACE FUNCTION public.stock_correction_charge_note(p_result_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.opname_variance_charges%rowtype;names text;
begin
  perform admin_online_private.deny_admin_online();
  select * into c from public.opname_variance_charges where result_id = p_result_id and cancelled_at is null order by created_at desc limit 1;
  if not found then return null;end if;
  select string_agg(coalesce(e.nama, 'karyawan tanpa nama') || ' (Rp ' || trim_scale(x.amount)::text || ')', ', ' order by e.nama, x.employee_id) into names
    from jsonb_to_recordset(c.lines) x(employee_id uuid, amount numeric) left join public.employees e on e.id = x.employee_id;
  return format('Selisih opname %s sudah dibebankan ke karyawan: %s; total beban Rp %s, dicatat %s. Batalkan beban karyawan dulu di halaman hasil opname %s (bagian Riwayat beban karyawan, tombol Batalkan beban), lalu koreksi baris ini.',
    c.no_hasil, coalesce(names, '-'), trim_scale(c.total)::text, to_char(c.tanggal, 'DD-MM-YYYY'), c.no_hasil);
end $function$
;

CREATE OR REPLACE FUNCTION public.stock_correction_plan(p_kind text, p_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare state jsonb;canonical jsonb;rows jsonb;wh uuid;branch uuid;r record;m record;l record;t record;
 moves jsonb;journals jsonb;layers jsonb;all_moves jsonb;virtual jsonb;lines jsonb:='[]';newrows jsonb:='[]';
 original numeric:=0;replacement numeric:=0;old_diff numeric;new_diff numeric;current_qty numeric;newqty numeric;
 cost numeric;needed numeric;take numeric;takes jsonb;restored numeric;buy numeric;value numeric;entry record;expiry date;
 count_rows integer;changed boolean:=false;result jsonb;inventory numeric:=0;contra numeric:=0;
 proof public.stock_document_issue_proofs%rowtype;
 original_in numeric:=0;original_out numeric:=0;
 -- KOREKSI-SO-PER-BARIS: status per baris (baris yang tidak diubah tidak disentuh; baris yang diubah dan gagal pemeriksaan ditahan).
 blocked jsonb:='[]';applied integer:=0;reason text;rsrc text;rref text;is_changed boolean;old_value numeric;pre_block jsonb:='{}';
 charge public.opname_variance_charges%rowtype;charge_note text;price_rows jsonb;price numeric;later record;msg text;blocked_count integer;
 jr_in numeric:=0;jr_out numeric:=0;ch_old_in numeric:=0;ch_old_out numeric:=0;ch_new_in numeric:=0;ch_new_out numeric:=0;new_in numeric;new_out numeric;
begin
 -- Take the existing costing-mode shared lock before document/stock/ledger locks.
 if public.inventory_is_average() then raise exception 'Koreksi historis FIFO tidak tersedia saat HPP average aktif. Rekonsiliasi melalui Finance diperlukan';end if;
 state:=public.stock_correction_source(p_kind,p_id);wh:=(state->>'warehouse_id')::uuid;rows:=state->'rows';
 select branch_id into branch from public.warehouses where id=wh;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>10000 then raise exception 'Rincian koreksi tidak valid';end if;
 select jsonb_agg(jsonb_build_object('item_id',x.item_id,'qty',x.qty) order by x.item_id),count(*) into canonical,count_rows from jsonb_to_recordset(p_rows)x(item_id uuid,qty numeric);
 if count_rows<>(select count(distinct x.item_id) from jsonb_to_recordset(canonical)x(item_id uuid,qty numeric))
  or exists(select 1 from jsonb_to_recordset(canonical)x(item_id uuid,qty numeric) where x.item_id is null or x.qty is null or x.qty<0 or x.qty>1e9 or x.qty::text in('NaN','Infinity','-Infinity'))
  or (select jsonb_agg(x->'item_id' order by x->>'item_id') from jsonb_array_elements(canonical)x) is distinct from
     (select jsonb_agg(x->'item_id' order by x->>'item_id') from jsonb_array_elements(rows)x) then raise exception 'Isi jumlah valid untuk seluruh barang pada dokumen asal';end if;
 if (state->>'invoice_id') is not null then raise exception 'Hasil opname memiliki faktur tagihan. Selesaikan rekonsiliasi faktur/piutang asal melalui Finance sebelum koreksi stok; jalur ini tidak membatalkan tagihan';end if;
 perform 1 from public.accounting_locks where id for share;
 if not found then raise exception 'Status tutup buku tidak tersedia. Koreksi dihentikan';end if;
 perform public.purchase_payment_period((state->>'date')::date,(now() at time zone 'Asia/Jakarta')::date);
 for r in select x.* from jsonb_to_recordset(rows)x(item_id uuid) order by item_id loop
  perform 1 from public.items where id=r.item_id and is_active and coalesce(item_type,'Persediaan')='Persediaan' for share;
  if not found then pre_block:=pre_block||jsonb_build_object(r.item_id::text,'Barang sumber tidak aktif atau bukan persediaan');end if;
  perform 1 from public.stock where warehouse_id=wh and item_id=r.item_id for update;
  if not found then pre_block:=pre_block||jsonb_build_object(r.item_id::text,'Saldo stok sumber tidak lengkap. Rekonsiliasi diperlukan');end if;
 end loop;
 perform 1 from public.stock_layers where warehouse_id=wh and item_id in(select (x->>'item_id')::uuid from jsonb_array_elements(rows)x) order by item_id,id for update;
 select coalesce(jsonb_agg(to_jsonb(layer_row) order by layer_row.item_id,layer_row.id),'[]') into layers from public.stock_layers layer_row where warehouse_id=wh and item_id in(select (x->>'item_id')::uuid from jsonb_array_elements(rows)x);
 select coalesce(jsonb_agg(to_jsonb(move_row) order by move_row.item_id,move_row.id),'[]') into all_moves from public.stock_moves move_row where warehouse_id=wh and item_id in(select (x->>'item_id')::uuid from jsonb_array_elements(rows)x);
 select coalesce(jsonb_agg(to_jsonb(move_row) order by move_row.item_id,move_row.id),'[]') into moves from public.stock_moves move_row where warehouse_id=wh and (source,source_ref) in(select distinct coalesce(x.src,state->>'source'),coalesce(x.src_ref,state->>'ref') from jsonb_to_recordset(rows)x(src text,src_ref text));
 if exists(select 1 from jsonb_to_recordset(moves)x(item_id uuid) where not exists(select 1 from jsonb_to_recordset(rows)y(item_id uuid) where x.item_id=y.item_id)) then raise exception 'Mutasi sumber di luar rincian dokumen. Rekonsiliasi diperlukan';end if;
 perform 1 from public.journal_entries where source=state->>'source' and source_ref=state->>'ref' order by id for update;
 perform 1 from public.journal_lines where entry_id in(select id from public.journal_entries where source=state->>'source' and source_ref=state->>'ref') order by id for update;
 select coalesce(jsonb_agg(jsonb_build_object('entry',to_jsonb(e),'lines',(select jsonb_agg(to_jsonb(j) order by j.id) from public.journal_lines j where j.entry_id=e.id)) order by e.id),'[]') into journals from public.journal_entries e where e.source=state->>'source' and e.source_ref=state->>'ref';
 for entry in select e.* from public.journal_entries e where e.source=state->>'source' and e.source_ref=state->>'ref' loop
  perform public.purchase_payment_period(entry.tanggal,(now() at time zone 'Asia/Jakarta')::date);
  if entry.voided_at is not null or entry.branch_id is distinct from branch
   or (select coalesce(sum(debit-credit),1) from public.journal_lines where entry_id=entry.id)<>0 then raise exception 'Jurnal sumber tidak utuh atau tidak seimbang. Rekonsiliasi diperlukan';end if;
 end loop;
 if exists(select 1 from public.journal_lines j join public.coa_accounts a on a.id=j.account_id where j.entry_id in(select id from public.journal_entries where source=state->>'source' and source_ref=state->>'ref') and
  (a.code not in('170001','720010','810004') or j.debit<0 or j.credit<0 or j.debit::text in('NaN','Infinity','-Infinity') or j.credit::text in('NaN','Infinity','-Infinity'))) then raise exception 'Jurnal sumber memiliki dependensi keuangan lain. Rekonsiliasi diperlukan';end if;
 -- Beban ke karyawan aktif dibaca di bawah kunci dokumen yang sama dengan pencatatan beban (stock_correction_source mengunci opname_results).
 if p_kind='opname' then
  select * into charge from public.opname_variance_charges c where c.result_id=p_id and c.cancelled_at is null;
  if found then
   charge_note:=public.stock_correction_charge_note(p_id);
   select source_snapshot->'price_report'->'rows' into price_rows from public.opname_posting_receipts where result_id=p_id;
  end if;
 end if;
 for r in select x.* from jsonb_to_recordset(rows)x(item_id uuid,name text,qty_sistem numeric,qty numeric,selisih numeric,exp_date date,src text,src_ref text,value numeric) order by item_id loop
  select x.qty into newqty from jsonb_to_recordset(canonical)x(item_id uuid,qty numeric) where x.item_id=r.item_id;
  if newqty<>r.qty then changed:=true;end if;
  is_changed:=newqty<>r.qty;rsrc:=coalesce(r.src,state->>'source');rref:=coalesce(r.src_ref,state->>'ref');
  old_diff:=r.qty-r.qty_sistem;new_diff:=newqty-r.qty_sistem;
  if old_diff is distinct from r.selisih or old_diff::text in('NaN','Infinity','-Infinity') or r.qty<0 or r.qty_sistem<0 then raise exception 'Angka sumber tidak konsisten. Rekonsiliasi diperlukan';end if;
  if (select count(*) from jsonb_to_recordset(moves)x(item_id uuid,source text,source_ref text) where x.item_id=r.item_id and x.source=rsrc and x.source_ref=rref)<>(case when old_diff=0 then 0 else 1 end) then raise exception 'Bukti mutasi sumber tidak lengkap. Rekonsiliasi diperlukan';end if;
  select * into m from jsonb_to_recordset(moves)x(id uuid,item_id uuid,source text,source_ref text,qty numeric,unit_cost numeric,fifo_takes jsonb,fifo_shortfall numeric,created_at timestamptz) where x.item_id=r.item_id and x.source=rsrc and x.source_ref=rref;
  if old_diff<>0 and (m.qty is distinct from old_diff or m.unit_cost<0 or m.unit_cost::text in('NaN','Infinity','-Infinity')) then raise exception 'Nilai mutasi sumber tidak konsisten. Rekonsiliasi diperlukan';end if;
  -- Nilai baris menurut jurnal sumber: revisi 0 = aturan posting (opname: lebih dibulatkan 2 desimal per baris, kurang apa adanya; penyesuaian: 2 desimal); revisi lanjutan = nilai tercatat koreksi terakhir.
  if (state->>'revision')::integer>0 then
   if r.value is null then raise exception 'Nilai baris koreksi terakhir tidak tercatat. Rekonsiliasi diperlukan';end if;
   old_value:=r.value;
   if abs(old_value-coalesce(old_diff*m.unit_cost,0))>0.0051 then raise exception 'Nilai baris koreksi terakhir tidak cocok dengan mutasi stok. Rekonsiliasi diperlukan';end if;
  elsif p_kind='opname' and old_diff<0 then old_value:=round(coalesce(old_diff*m.unit_cost,0),9);
  else old_value:=round(coalesce(old_diff*m.unit_cost,0),2);end if;
  original:=original+old_value;original_in:=original_in+greatest(old_value,0);original_out:=original_out+greatest(-old_value,0);
  if not is_changed then
   replacement:=replacement+old_value;
   newrows:=newrows||jsonb_build_array(jsonb_build_object('item_id',r.item_id,'name',r.name,'qty_sistem',r.qty_sistem,'qty',r.qty,'selisih',old_diff,'value',old_value,'exp_date',r.exp_date)||case when old_diff<>0 then jsonb_build_object('src',rsrc,'src_ref',rref) else '{}'::jsonb end);
   continue;
  end if;
  reason:=null;virtual:='[]';takes:='[]';cost:=0;value:=0;needed:=0;buy:=null;expiry:=r.exp_date;
  begin
   if pre_block ? r.item_id::text then raise exception '%',pre_block->>r.item_id::text using errcode='KR001';end if;
   if p_kind='opname' and new_diff<0 and exists(select 1 from public.warehouses w join public.branches b on b.id=w.branch_id where w.id=wh and w.type<>'VET' and (w.type='RETAIL' or b.type<>'KLINIK')) then raise exception using errcode='KR001',message='Selisih kurang opname gudang ini memerlukan faktur tagihan. Gunakan rekonsiliasi opname dan piutang melalui Finance';end if;
   select qty into current_qty from public.stock where warehouse_id=wh and item_id=r.item_id;
   if current_qty<0 or current_qty::text in('NaN','Infinity','-Infinity') or current_qty is distinct from
    (select coalesce(sum(x.qty_left),0) from jsonb_to_recordset(layers)x(item_id uuid,qty_left numeric) where x.item_id=r.item_id) then raise exception using errcode='KR001',message='Saldo dan lapisan FIFO tidak cocok. Rekonsiliasi stok diperlukan';end if;
   -- Revisi lanjutan: lapisan dan mutasi BARANG INI harus sama persis dengan keadaan koreksi terakhir (dulu: seluruh barang dokumen).
   if (state->>'revision')::integer>0 and (
    (select coalesce(jsonb_agg(x order by x->>'id'),'[]') from jsonb_array_elements(layers)x where x->>'item_id'=r.item_id::text) is distinct from
    (select coalesce(jsonb_agg(x order by x->>'id'),'[]') from jsonb_array_elements(coalesce(state->'last_layers','[]'::jsonb))x where x->>'item_id'=r.item_id::text) or
    (select coalesce(jsonb_agg(x order by x->>'id'),'[]') from jsonb_array_elements(all_moves)x where x->>'item_id'=r.item_id::text) is distinct from
    (select coalesce(jsonb_agg(x order by x->>'id'),'[]') from jsonb_array_elements(coalesce(state->'last_moves','[]'::jsonb))x where x->>'item_id'=r.item_id::text))
   then raise exception using errcode='KR001',message='Stok sudah terpakai, terjual, diretur atau berpindah setelah koreksi terakhir. Rekonsiliasi dependensi sebelum koreksi berikutnya';end if;
   if old_diff<0 and m.fifo_takes is null then
    select * into proof from public.stock_document_issue_proofs where move_id=m.id and kind=p_kind and document_id=p_id and item_id=r.item_id;
    if found then
    if (proof.source_document-'nilai_masuk'-'nilai_keluar') is distinct from ((state->'source_snapshot'->'document')-'nilai_masuk'-'nilai_keluar') or
     (p_kind='adjustment' and proof.source_line is distinct from (select to_jsonb(i) from public.inventory_adjustment_items i where adjustment_id=p_id and item_id=r.item_id)) or
     (p_kind='opname' and proof.source_line is distinct from (select to_jsonb(i) from public.opname_result_items i where result_id=p_id and item_id=r.item_id)) then raise exception 'Dokumen pengeluaran asal berubah sejak diposting. Rekonsiliasi diperlukan';end if;
    if proof.move_snapshot is distinct from (select to_jsonb(sm) from public.stock_moves sm where sm.id=m.id) or
     exists(select 1 from jsonb_array_elements(proof.layers_after)x where x is distinct from (select to_jsonb(sl) from public.stock_layers sl where sl.id=(x->>'id')::uuid)) then raise exception using errcode='KR001',message='Lapisan FIFO sumber sudah terpakai atau berubah. Rekonsiliasi diperlukan';end if;
     m.fifo_takes:=proof.takes;m.fifo_shortfall:=0;
    end if;
   end if;
    -- Later revisions already compare every layer and movement to their recorded
    -- after-state. A zero-effect replacement has no own move/timestamp; falling
    -- back to the original date would mistake its prior reversals for dependencies.
   if (state->>'revision')::integer=0 or r.src is not null then
    select other.source,other.tanggal,other.qty into later from public.stock_moves other where other.warehouse_id=wh and other.item_id=r.item_id and other.created_at>coalesce(m.created_at,(state->'source_snapshot'->'document'->>'created_at')::timestamptz) and other.source_ref is distinct from rref order by other.created_at desc limit 1;
    if found then raise exception using errcode='KR001',message='Stok sudah terpakai, terjual, diretur atau dipindahkan. Rekonsiliasi dokumen lanjutan terlebih dahulu'||format(' (mutasi terakhir sesudah SO: %s %s jumlah %s)',later.source,later.tanggal,trim_scale(later.qty)::text);end if;
   end if;
   virtual:='[]';expiry:=r.exp_date;
   for l in select x.* from jsonb_to_recordset(layers)x(id uuid,item_id uuid,qty_in numeric,qty_left numeric,unit_cost numeric,source text,source_ref text,exp_date date,tanggal date,created_at timestamptz) where x.item_id=r.item_id order by exp_date nulls last,tanggal,created_at,id loop
    restored:=l.qty_left;
    if old_diff>0 and l.source=rsrc and l.source_ref=rref then
     if l.qty_in<>old_diff or l.qty_left<>l.qty_in or l.unit_cost<>m.unit_cost then raise exception using errcode='KR001',message='Lapisan sumber sudah terpakai atau nilai berubah. Rekonsiliasi diperlukan'||format(' (lapisan hasil SO: masuk %s, tersisa %s; barang ini sudah terpakai, terjual atau berpindah)',trim_scale(l.qty_in)::text,trim_scale(l.qty_left)::text);end if;
     restored:=0;expiry:=l.exp_date;
    elsif old_diff<0 then
    if m.fifo_takes is null or m.fifo_shortfall is distinct from 0::numeric then raise exception using errcode='KR001',message='Bukti FIFO stok keluar lama tidak lengkap. Rekonsiliasi sumber diperlukan; saldo tidak boleh dibalik dengan perkiraan';end if;
     select coalesce(sum(x.qty),0) into take from jsonb_to_recordset(m.fifo_takes)x(id uuid,qty numeric,unit_cost numeric) where x.id=l.id and x.unit_cost=l.unit_cost;
     restored:=restored+take;
     if restored>l.qty_in then raise exception using errcode='KR001',message='Lapisan FIFO sumber berubah. Rekonsiliasi diperlukan';end if;
    end if;
    if l.unit_cost<0 or l.unit_cost::text in('NaN','Infinity','-Infinity') then raise exception using errcode='KR001',message='Nilai lapisan FIFO tidak valid';end if;
   virtual:=virtual||jsonb_build_array(jsonb_build_object('id',l.id,'qty',restored,'unit_cost',l.unit_cost,'exp_date',l.exp_date));
   end loop;
  if old_diff>0 and (select count(*) from jsonb_to_recordset(layers)x(item_id uuid,source text,source_ref text) where x.item_id=r.item_id and x.source=rsrc and x.source_ref=rref)<>1 then raise exception using errcode='KR001',message='Asal lapisan stok masuk tidak lengkap. Rekonsiliasi diperlukan';end if;
   if old_diff<0 and (m.fifo_takes is null or m.fifo_shortfall is distinct from 0::numeric or
   (select sum(x.qty) from jsonb_to_recordset(m.fifo_takes)x(qty numeric)) is distinct from -old_diff or
   (select sum((x->>'qty')::numeric) from jsonb_array_elements(virtual)x) is distinct from current_qty-old_diff) then raise exception using errcode='KR001',message='Bukti FIFO stok keluar lama tidak lengkap. Rekonsiliasi sumber diperlukan';end if;
   if current_qty+newqty-r.qty<0 then raise exception using errcode='KR001',message='Stok tidak cukup untuk koreksi. Barang sudah terpakai/terjual; rekonsiliasi dependensi dahulu'||format(' (stok sekarang %s, perlu dikurangi %s)',trim_scale(current_qty)::text,trim_scale(r.qty-newqty)::text);end if;
   takes:='[]';cost:=0;needed:=greatest(-new_diff,0);
   for t in select x.* from jsonb_to_recordset(virtual)x(id uuid,qty numeric,unit_cost numeric,exp_date date) loop
    exit when needed<=0;take:=least(needed,t.qty);
   if take>0 then cost:=cost+take*t.unit_cost;needed:=needed-take;takes:=takes||jsonb_build_array(jsonb_build_object('id',t.id,'qty',take,'unit_cost',t.unit_cost,'exp_date',t.exp_date));end if;
   end loop;
   if needed>0 then raise exception using errcode='KR001',message='Lapisan FIFO tidak cukup untuk koreksi'||format(' (kurang %s dari %s yang perlu dikurangi; barang sudah terpakai/terjual)',trim_scale(needed)::text,trim_scale(greatest(-new_diff,0))::text);end if;
   if new_diff<0 and exists(select 1 from jsonb_to_recordset(takes)x(unit_cost numeric) where x.unit_cost=0) then raise exception using errcode='KR001',message=format('Selisih kurang koreksi untuk %s memakai stok tanpa harga modal. Koreksi tidak menilai 0 diam-diam; rekonsiliasi harga lewat Finance dulu.',r.name);end if;
   select buy_price into buy from public.items where id=r.item_id;
   if buy is null or buy<0 or buy>1e12 or buy::text in('NaN','Infinity','-Infinity') then raise exception using errcode='KR001',message='Harga modal barang tidak valid';end if;
   if new_diff>0 and p_kind='opname' then select c.unit_cost into buy from public.opname_surplus_cost(wh,r.item_id,buy) c;end if;
   value:=case when new_diff>0 then new_diff*buy else -cost end;
  exception when sqlstate 'KR001' then reason:=sqlerrm;
  end;
  if reason is null and charge.id is not null then
   price:=null;
   if jsonb_typeof(price_rows)='array' then select (e->>'harga_jual_cabang')::numeric into price from jsonb_array_elements(price_rows)e where e->>'item_id'=r.item_id::text limit 1;end if;
   if price is null or price<>0 or old_value<>0 or round(value,2)<>0 then reason:=charge_note;end if;
  end if;
  if reason is not null then
   blocked:=blocked||jsonb_build_array(jsonb_build_object('item_id',r.item_id,'name',r.name,'old_qty',r.qty,'new_qty',newqty,'reason',reason));
   replacement:=replacement+old_value;
   newrows:=newrows||jsonb_build_array(jsonb_build_object('item_id',r.item_id,'name',r.name,'qty_sistem',r.qty_sistem,'qty',r.qty,'selisih',old_diff,'value',old_value,'exp_date',r.exp_date)||case when old_diff<>0 then jsonb_build_object('src',rsrc,'src_ref',rref) else '{}'::jsonb end);
   continue;
  end if;
  applied:=applied+1;
  ch_old_in:=ch_old_in+greatest(old_value,0);ch_old_out:=ch_old_out+greatest(-old_value,0);ch_new_in:=ch_new_in+greatest(round(value,2),0);ch_new_out:=ch_new_out+greatest(-round(value,2),0);
  replacement:=replacement+round(value,2);
  newrows:=newrows||jsonb_build_array(jsonb_build_object('item_id',r.item_id,'name',r.name,'qty_sistem',r.qty_sistem,'qty',newqty,'selisih',new_diff,'value',round(value,2),'exp_date',expiry));
  lines:=lines||jsonb_build_array(jsonb_build_object('item_id',r.item_id,'name',r.name,'old_qty',r.qty,'new_qty',newqty,'stock_before',current_qty,'stock_after',current_qty+newqty-r.qty,'delta',newqty-r.qty,'old_diff',old_diff,'new_diff',new_diff,'old_move',case when old_diff<>0 then to_jsonb(m) end,'restored_layers',virtual,'takes',takes,'unit_cost',buy,'exp_date',expiry,'value',round(value,2)));
 end loop;
 if not changed then raise exception 'Jumlah koreksi sama dengan hasil saat ini';end if;
 if applied=0 then
  select string_agg((b.x->>'name')||': '||(b.x->>'reason'),'; ' order by b.ord) into msg from jsonb_array_elements(blocked) with ordinality b(x,ord) where b.ord<=8;
  blocked_count:=jsonb_array_length(blocked);
  raise exception '%',left('Koreksi tidak bisa disimpan: semua baris yang diubah tertahan. '||coalesce(msg,'')||case when blocked_count>8 then format(' (dan %s baris lain)',blocked_count-8) else '' end,2000);
 end if;
 select coalesce(sum(j.debit-j.credit) filter(where a.code='170001'),0),coalesce(sum(j.debit-j.credit) filter(where a.code in('720010','810004')),0) into inventory,contra from public.journal_lines j join public.coa_accounts a on a.id=j.account_id where j.entry_id in(select id from public.journal_entries where source=state->>'source' and source_ref=state->>'ref');
 select coalesce(sum(j.debit) filter(where a.code='170001'),0),coalesce(sum(j.credit) filter(where a.code='170001'),0) into jr_in,jr_out from public.journal_lines j join public.coa_accounts a on a.id=j.account_id where j.entry_id in(select id from public.journal_entries where source=state->>'source' and source_ref=state->>'ref');
 if abs(inventory-original)>0.000001 or abs(contra+original)>0.000001 then raise exception 'Nilai jurnal dan stok sumber tidak cocok. Rekonsiliasi sumber diperlukan';end if;
 if exists(select 1 from (values('170001'::text,array['170001']),('720010'::text,array['720010','810004'])) a(code,codes) where (
  abs((select coalesce(sum(j.debit),0) from public.journal_lines j where j.account_id in(select c.id from public.coa_accounts c where c.code=any(a.codes)) and j.entry_id in(select id from public.journal_entries where source=state->>'source' and source_ref=state->>'ref'))-(case a.code when '170001' then original_in else original_out end))>0.000001 or
  abs((select coalesce(sum(j.credit),0) from public.journal_lines j where j.account_id in(select c.id from public.coa_accounts c where c.code=any(a.codes)) and j.entry_id in(select id from public.journal_entries where source=state->>'source' and source_ref=state->>'ref'))-(case a.code when '170001' then original_out else original_in end))>0.000001)) then raise exception 'Rincian debit/kredit sumber tidak cocok dengan mutasi stok. Rekonsiliasi diperlukan';end if;
 if p_kind='adjustment' and (state->>'revision')::integer=0 and
  ((state->'source_snapshot'->'document'->>'nilai_masuk')::numeric is distinct from original_in or
   (state->'source_snapshot'->'document'->>'nilai_keluar')::numeric is distinct from original_out) then raise exception 'Nilai header dokumen asal belum lengkap atau berbeda dari FIFO. Rekonsiliasi diperlukan';end if;
 perform 1 from public.coa_accounts where code in('170001','720010','810004') and is_active and not is_header order by code for share;
 if (select count(*) from public.coa_accounts where code in('170001','720010','810004') and is_active and not is_header)<>3 then raise exception 'Akun persediaan/selisih/pendapatan lain-lain tidak aktif';end if;
 -- Jurnal pengganti: jurnal sumber persis (debit/kredit 170001) hanya dikoreksi oleh selisih baris yang diterapkan; baris yang tidak disentuh tetap persis seperti jurnal asal.
 new_in:=greatest(jr_in-ch_old_in+ch_new_in,0);new_out:=greatest(jr_out-ch_old_out+ch_new_out,0);
 if new_in<0.000001 then new_in:=0;end if;if new_out<0.000001 then new_out:=0;end if;
 result:=jsonb_build_object('kind',p_kind,'document_id',p_id,'warehouse_id',wh,'branch_id',branch,'revision',state->'revision','rows',newrows,'lines',lines,'before',state,'moves',moves,'layers',layers,'all_moves',all_moves,'journals',journals,'value_before',round(original,2),'value_after',round(replacement,2),'value_delta',round(replacement,2)-round(original,2),'replacement_in',new_in,'replacement_out',new_out,'date',(now() at time zone 'Asia/Jakarta')::date,'blocked',blocked,'applied',applied,'charge_checked',true);
 return result||jsonb_build_object('token',md5(result::text));
end$function$;

CREATE OR REPLACE FUNCTION public.correct_stock_document(p_kind text, p_id uuid, p_rows jsonb, p_reason text, p_request_key text, p_preview_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare state jsonb;payload jsonb;prior public.stock_document_correction_requests%rowtype;plan jsonb;
 correction_id uuid:=gen_random_uuid();r record;t record;j record;rev uuid;replacement uuid;reversals uuid[]:='{}';
 wh uuid;branch uuid;date date:=(now() at time zone 'Asia/Jakarta')::date;cost record;after_state jsonb;result jsonb;
begin
  perform admin_online_private.deny_admin_online();
 -- Take the existing costing-mode shared lock before document/stock/ledger locks.
 if public.inventory_is_average() then raise exception 'Koreksi historis FIFO tidak tersedia saat HPP average aktif. Rekonsiliasi melalui Finance diperlukan';end if;
 if auth.uid() is null then raise exception 'Hanya Super Admin aktif yang dapat mengoreksi stok' using errcode='42501';end if;
 if p_request_key is null or length(btrim(p_request_key))<1 or length(p_request_key)>120 or p_reason is null or length(btrim(p_reason))<3 or length(p_reason)>1000 then raise exception 'Identitas permintaan dan alasan koreksi wajib diisi';end if;
 perform pg_advisory_xact_lock(hashtextextended('vetos:stock-correction:'||auth.uid()::text||':'||p_request_key,0));
 state:=public.stock_correction_source(p_kind,p_id);
 payload:=jsonb_build_object('kind',p_kind,'id',p_id,'rows',p_rows,'reason',btrim(p_reason),'preview',p_preview_token);
 select * into prior from public.stock_document_correction_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas permintaan sudah digunakan dengan isi berbeda. Periksa hasil terakhir';end if;
  return prior.result;
 end if;
 plan:=public.stock_correction_plan(p_kind,p_id,p_rows);
 if p_preview_token is null or p_preview_token is distinct from plan->>'token' then raise exception 'Preview berubah atau kedaluwarsa. Periksa dampak koreksi lagi sebelum menyimpan';end if;
 wh:=(plan->>'warehouse_id')::uuid;branch:=(plan->>'branch_id')::uuid;
 for r in select x.* from jsonb_to_recordset(plan->'lines')x(item_id uuid,old_diff numeric,new_diff numeric,old_move jsonb,restored_layers jsonb,takes jsonb,unit_cost numeric,exp_date date) order by item_id loop
  if r.old_diff<>0 then
   for t in select x.* from jsonb_to_recordset(r.restored_layers)x(id uuid,qty numeric) loop update public.stock_layers set qty_left=t.qty where id=t.id;end loop;
   update public.stock set qty=qty-r.old_diff,updated_at=now() where warehouse_id=wh and item_id=r.item_id;
   insert into public.stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values(date,wh,r.item_id,-r.old_diff,(r.old_move->>'unit_cost')::numeric,'stock-correct-reverse',correction_id::text);
  end if;
  if r.new_diff>0 then perform public.stock_in_fifo(wh,r.item_id,r.new_diff,r.unit_cost,'stock-correction',correction_id::text,date,r.exp_date);
  elsif r.new_diff<0 then
   select * into cost from public.stock_out_fifo(wh,r.item_id,-r.new_diff,'stock-correction',correction_id::text,date);
   if cost.shortfall<>0 or cost.takes is distinct from r.takes then raise exception 'FIFO berubah saat koreksi; seluruh perubahan dibatalkan';end if;
   update public.stock_moves set fifo_takes=cost.takes,fifo_shortfall=cost.shortfall where warehouse_id=wh and item_id=r.item_id and source='stock-correction' and source_ref=correction_id::text;
  end if;
 end loop;
 for j in select x.* from jsonb_array_elements(plan->'journals')x loop
  rev:=gen_random_uuid();
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(rev,'SCV.'||left(replace(rev::text,'-',''),20),date,'Pembalikan koreksi stok '||p_id::text,'stock-correct-reverse',correction_id::text,branch);
  insert into public.journal_lines(entry_id,account_id,debit,credit) select rev,(l->>'account_id')::uuid,(l->>'credit')::numeric,(l->>'debit')::numeric from jsonb_array_elements(j.value->'lines')l;
  reversals:=array_append(reversals,rev);
 end loop;
 if (plan->>'replacement_in')::numeric<>0 or (plan->>'replacement_out')::numeric<>0 then
  replacement:=gen_random_uuid();
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(replacement,'SCR.'||left(replace(replacement::text,'-',''),20),date,'Pengganti koreksi stok '||p_id::text||' — '||btrim(p_reason),'stock-correction',correction_id::text,branch);
  declare pos numeric;neg numeric;off numeric;
  begin
   pos:=(plan->>'replacement_in')::numeric;neg:=(plan->>'replacement_out')::numeric;
   off:=least(pos,neg);
   insert into public.journal_lines(entry_id,account_id,debit,credit)
    select replacement,a.id,v.d,v.c from (values('170001'::text,pos,0::numeric),('170001',0::numeric,neg),('720010',neg,0::numeric),('720010',0::numeric,off),('810004',0::numeric,pos-off)) v(code,d,c)
    join public.coa_accounts a on a.code=v.code where v.d<>0 or v.c<>0;
  end;
 end if;
 after_state:=jsonb_build_object('charge_checked',(plan->>'charge_checked')::boolean,'rows',plan->'rows','layers',(select coalesce(jsonb_agg(to_jsonb(layer_row) order by layer_row.item_id,layer_row.id),'[]') from public.stock_layers layer_row where warehouse_id=wh and item_id in(select (x->>'item_id')::uuid from jsonb_array_elements(plan->'rows')x)),
  'all_moves',(select coalesce(jsonb_agg(to_jsonb(move_row) order by move_row.item_id,move_row.id),'[]') from public.stock_moves move_row where warehouse_id=wh and item_id in(select (x->>'item_id')::uuid from jsonb_array_elements(plan->'rows')x)));
 insert into public.stock_document_corrections(id,kind,document_id,branch_id,warehouse_id,revision,reason,source_snapshot,before_state,after_state,reversal_journal_ids,replacement_journal_id,created_by)
 values(correction_id,p_kind,p_id,branch,wh,(plan->>'revision')::integer+1,btrim(p_reason),state->'source_snapshot',jsonb_build_object('rows',state->'rows','journals',plan->'journals','moves',plan->'moves'),after_state,reversals,replacement,auth.uid());
 result:=jsonb_build_object('correction_id',correction_id,'revision',(plan->>'revision')::integer+1,'document_id',p_id,'applied',plan->'applied','blocked',plan->'blocked');
 insert into public.stock_document_correction_requests(actor_id,request_key,kind,document_id,payload,result) values(auth.uid(),p_request_key,p_kind,p_id,payload,result);
 return result;
end$function$;

CREATE OR REPLACE FUNCTION public.preview_stock_document_correction(p_kind text, p_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare plan jsonb;begin
  perform admin_online_private.deny_admin_online();
 plan:=public.stock_correction_plan(p_kind,p_id,p_rows);
 return jsonb_build_object('token',plan->'token','revision',plan->'revision','lines',plan->'lines','value_before',plan->'value_before','value_after',plan->'value_after','value_delta',plan->'value_delta','applied',plan->'applied','blocked',plan->'blocked');
end$function$;

CREATE OR REPLACE FUNCTION public.guard_opname_correction_charge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.kind = 'opname' then
    -- Kunci yang sama dengan pencatatan beban (opname_results) supaya keduanya berurutan.
    perform 1 from public.opname_results where id = new.document_id for update;
    -- Pagar terakhir: bila ada beban aktif, koreksi hanya sah bila stock_correction_plan sudah memeriksa beban itu
    -- (baris yang berdampak ke beban ditahan di sana). Tanda hilang = ditolak (gagal tertutup).
    if exists (select 1 from public.opname_variance_charges c where c.result_id = new.document_id and c.cancelled_at is null)
       and coalesce(new.after_state->>'charge_checked', '') <> 'true' then
      raise exception '%', public.stock_correction_charge_note(new.document_id);
    end if;
  end if;
  return new;
end $function$
;

revoke all on function public.stock_correction_charge_note(uuid) from public,anon,authenticated,service_role;
-- create or replace mempertahankan ACL; ditegaskan ulang sesuai migrasi asal.
revoke all on function public.stock_correction_plan(text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.correct_stock_document(text,uuid,jsonb,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.correct_stock_document(text,uuid,jsonb,text,text,text) to authenticated;
revoke all on function public.preview_stock_document_correction(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.preview_stock_document_correction(text,uuid,jsonb) to authenticated;
revoke all on function public.guard_opname_correction_charge() from public,anon,authenticated,service_role;

do $check$
begin
 if position('KR001' in pg_get_functiondef('public.stock_correction_plan(text,uuid,jsonb)'::regprocedure))=0
  or position('charge_checked' in pg_get_functiondef('public.stock_correction_plan(text,uuid,jsonb)'::regprocedure))=0
  or position('charge_checked' in pg_get_functiondef('public.correct_stock_document(text,uuid,jsonb,text,text,text)'::regprocedure))=0
  or position('charge_checked' in pg_get_functiondef('public.guard_opname_correction_charge()'::regprocedure))=0
  or position('off:=least(pos,neg)' in pg_get_functiondef('public.correct_stock_document(text,uuid,jsonb,text,text,text)'::regprocedure))=0
  or position('blocked' in pg_get_functiondef('public.preview_stock_document_correction(text,uuid,jsonb)'::regprocedure))=0 then
  raise exception 'KOREKSI_PER_BARIS marker missing after patch';end if;
 if has_function_privilege('anon','public.stock_correction_charge_note(uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.stock_correction_charge_note(uuid)','EXECUTE')
  or has_function_privilege('anon','public.stock_correction_plan(text,uuid,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.stock_correction_plan(text,uuid,jsonb)','EXECUTE')
  or has_function_privilege('anon','public.correct_stock_document(text,uuid,jsonb,text,text,text)','EXECUTE')
  or has_function_privilege('anon','public.preview_stock_document_correction(text,uuid,jsonb)','EXECUTE')
  or not has_function_privilege('authenticated','public.correct_stock_document(text,uuid,jsonb,text,text,text)','EXECUTE')
  or not has_function_privilege('authenticated','public.preview_stock_document_correction(text,uuid,jsonb)','EXECUTE') then
  raise exception 'KOREKSI_PER_BARIS: ACL salah';end if;
end $check$;

-- Pagar Admin Online (#549): idempotent.
select admin_online_private.guard_all();
select admin_online_private.fence_all();
