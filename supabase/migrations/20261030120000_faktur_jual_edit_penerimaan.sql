-- Faktur Penjualan (grosir/reseller) — permintaan Andri (keuangan/admin) via Telegram, 28 Okt 2026.
--
-- Yang ditambahkan, mengikuti apa yang sudah ada di Pembelian:
--  1. Edit faktur per baris (qty, harga, diskon) + header tanggal/jatuh tempo/catatan lewat pop-up,
--     dengan pratinjau dampak persis seperti edit baris PO (VP002 preview → dibatalkan pemanggil).
--  2. Faktur yang masih punya Penerimaan tidak bisa diedit: penerimaannya dihapus dulu.
--  3. Hapus (balik) Penerimaan Penjualan dengan alasan wajib: jurnal dibalik dengan jurnal pembalik
--     (tidak ada baris jurnal yang dihapus), pemakaian uang muka dikembalikan, dan baris penerimaan
--     negatif dicatat sebagai lawan dari aslinya — pola yang sama dengan cancel_purchase_payment.
--
-- Prinsip akuntansi yang dipertahankan:
--  * Stok dan HPP grosir lahir di PENGIRIMAN (sales-delivery), bukan di faktur. Mengubah faktur
--    tidak mengembalikan barang, jadi stock_moves/stock_layers TIDAK disentuh di sini. Yang ikut
--    berubah adalah alokasi HPP per baris faktur (sales_invoice_delivery_allocations) supaya
--    laporan HPP per faktur tetap cocok dengan qty yang benar-benar ditagih.
--  * Piutang, pendapatan, diskon penjualan (4102) dan PPN keluaran diposting ulang dengan pola
--    balik-dan-terbitkan-ulang yang sudah dipakai correct_wholesale_invoice: faktur lama dibalik
--    jurnalnya lalu ditandai 'batal', faktur pengganti terbit dengan nomor baru dan jurnal baru.
--  * Edit hanya untuk faktur yang belum menerima uang sama sekali, jadi tidak ada kredit pelanggan,
--    tidak ada carried_paid, dan tidak ada uang yang perlu ditebak.

-- ───────────────────────── 1. Skema ─────────────────────────

-- Diskon per baris faktur (Accurate: diskon penjualan adalah kontra-pendapatan 4102, bukan
-- potongan harga satuan, supaya pendapatan bruto dan diskon tetap terbaca terpisah di Laba Rugi).
alter table public.sales_invoice_items
 add column diskon numeric(15,2) not null default 0 check(diskon>=0);
comment on column public.sales_invoice_items.diskon is
 'Diskon nilai (rupiah) baris faktur. Nilai baris = qty*harga - diskon; diskon diposting ke 4102.';

-- Penerimaan penjualan jadi gerakan bertanda seperti pembayaran hutang: pembatalan menambah baris
-- lawan bernilai negatif, bukan menghapus baris. Semua penjumlahan sum(jumlah) yang sudah ada
-- (sisa tagihan, status lunas, counter uang muka) otomatis benar tanpa diubah.
alter table public.sales_receipts
 add column revision integer not null default 0,
 add column voided_at timestamptz,
 add column void_reason text,
 add column reversal_of uuid unique references public.sales_receipts(id);
alter table public.sales_receipts drop constraint if exists sales_receipts_jumlah_check;
alter table public.sales_receipts drop constraint if exists sales_receipts_dari_uang_muka_check;
do $batas$
declare c record;
begin
 -- Sapuan cadangan bila nama batas di production berbeda dari bawaan Postgres.
 for c in select conname,pg_get_constraintdef(oid) def from pg_constraint
  where conrelid='public.sales_receipts'::regclass and contype='c' loop
  if c.def ~ '^CHECK \(\(jumlah > |^CHECK \(\(dari_uang_muka >= ' then
   execute format('alter table public.sales_receipts drop constraint %I',c.conname);
  end if;
 end loop;
 if exists(select 1 from pg_constraint where conrelid='public.sales_receipts'::regclass and contype='c'
  and pg_get_constraintdef(oid) ~ '(jumlah > |dari_uang_muka >= )') then
  raise exception 'Faktur jual: batas nilai penerimaan lama tidak dikenali; periksa production sebelum apply';
 end if;
end $batas$;
alter table public.sales_receipts add constraint sales_receipt_signed_amount check(
 (reversal_of is null and jumlah>0 and dari_uang_muka between 0 and jumlah)
 or (reversal_of is not null and jumlah<0 and dari_uang_muka between jumlah and 0));

-- Audit koreksi grosir yang sudah ada dipakai ulang; kolom kind memisahkan koreksi harga lama
-- dari edit per baris supaya layar audit bisa menjelaskan keduanya.
alter table public.wholesale_invoice_corrections
 add column kind text not null default 'harga' check(kind in ('harga','baris'));

-- Idempotensi edit baris & hapus penerimaan ikut tabel permintaan grosir yang sudah ada.
alter table public.wholesale_operation_requests drop constraint if exists wholesale_operation_requests_kind_check;
do $kind$
declare c record;
begin
 -- Sapuan cadangan bila nama batas di production berbeda dari bawaan Postgres.
 for c in select conname,pg_get_constraintdef(oid) def from pg_constraint
  where conrelid='public.wholesale_operation_requests'::regclass and contype='c' loop
  if c.def like '%kind%' and c.def not like '%line-edit%' then
   execute format('alter table public.wholesale_operation_requests drop constraint %I',c.conname);
  end if;
 end loop;
 if exists(select 1 from pg_constraint where conrelid='public.wholesale_operation_requests'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%kind%' and pg_get_constraintdef(oid) not like '%line-edit%') then
  raise exception 'Faktur jual: batas jenis permintaan grosir tidak dikenali; periksa production sebelum apply';
 end if;
end $kind$;
alter table public.wholesale_operation_requests add constraint wholesale_operation_requests_kind_check
 check(kind in ('receipt','correction','line-edit','receipt-cancel'));

create table public.sales_receipt_cancellations(
 id uuid primary key,
 receipt_id uuid not null unique references public.sales_receipts(id),
 reversal_receipt_id uuid not null unique references public.sales_receipts(id),
 invoice_id uuid not null references public.sales_invoices(id),
 reason text not null, tanggal date not null, before_value jsonb not null,
 original_journal_id uuid not null references public.journal_entries(id),
 reversal_journal_id uuid not null references public.journal_entries(id),
 advance_id uuid references public.sales_advances(id),
 advance_restored numeric(15,2) not null default 0 check(advance_restored>=0),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create index on public.sales_receipt_cancellations(invoice_id);
alter table public.sales_receipt_cancellations enable row level security;
revoke all on public.sales_receipt_cancellations from public,anon,authenticated,service_role;
grant select on public.sales_receipt_cancellations to authenticated;
-- Visibilitas mengikuti fakturnya, sama dengan wholesale_invoice_corrections.
create policy sales_receipt_cancellations_read on public.sales_receipt_cancellations for select to authenticated
 using(exists(select 1 from public.sales_invoices i where i.id=invoice_id));

-- ───────────────────── 2. Tambalan fungsi berjalan ─────────────────────
-- Gaya jangkar eksak dan gagal tertutup (lihat 20261030090000_line_performers_all_items.sql):
-- definisi berjalan diambil apa adanya, jangkar wajib muncul sebanyak yang diharapkan,
-- selain itu migrasi berhenti tanpa mengubah apa pun.
do $patch$
declare p record; definition text; signature regprocedure; hits integer;
begin
 for p in select * from (values
 -- A. Jurnal pembalik penerimaan ikut keluarga jurnal grosir yang dilindungi dari tulisan klien.
 ('public.guard_wholesale_journal()',3,
  E'''sales-invoice'',''sales-delivery'',''sales-receipt'',''wholesale-invoice-void'',''wholesale-credit''',
  E'''sales-invoice'',''sales-delivery'',''sales-receipt'',''sales-receipt-void'',''wholesale-invoice-void'',''wholesale-credit'''),
 -- B. Pemulihan hasil ("Periksa hasil terakhir") melayani dua jenis operasi baru, hak akses
 --    setara koreksi (OWNER/FINANCE) karena keduanya mengubah pembukuan.
 ('public.get_wholesale_operation(uuid,text,text)',1,
  E'perform public.wholesale_access(inv.branch_id,p_kind=''correction'');',
  E'perform public.wholesale_access(inv.branch_id,p_kind in (''correction'',''line-edit'',''receipt-cancel''));'),
 ('public.get_wholesale_operation(uuid,text,text)',1,
  E'if p_kind not in (''receipt'',''correction'') then',
  E'if p_kind not in (''receipt'',''correction'',''line-edit'',''receipt-cancel'') then'),
 -- C. Koreksi harga lama (J01) tetap jalan berdampingan dengan diskon per baris dan dengan
 --    penerimaan yang sudah dibalik.
 --    C1. Ruang variabel untuk nilai bruto/diskon.
 ('public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb)',1,
  E'dpp numeric:=0;tax numeric:=0;',
  E'dpp numeric:=0;gross numeric:=0;disc numeric:=0;src_gross numeric;src_disc numeric;tax numeric:=0;'),
 --    C2. Baris penerimaan yang sudah dihapus (dan baris lawannya) bukan bukti uang berjalan.
 ('public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb)',1,
  E' ) select rc.* from public.sales_receipts rc where invoice_id in(select id from lineage) order by id for share loop',
  E' ) select rc.* from public.sales_receipts rc where invoice_id in(select id from lineage) and rc.voided_at is null and rc.reversal_of is null order by id for share loop'),
 --    C3. DPP faktur = bruto dikurangi diskon baris.
 ('public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb)',1,
  E' if inv.dpp is distinct from (select sum(qty*harga) from public.sales_invoice_items where invoice_id=inv.id)',
  E' if inv.dpp is distinct from (select sum(qty*harga-coalesce(diskon,0)) from public.sales_invoice_items where invoice_id=inv.id)'),
 --    C4. Jurnal sumber dibandingkan dengan pendapatan bruto + diskon 4102 (faktur tanpa diskon
 --        menghasilkan baris yang sama persis seperti sebelumnya).
 ('public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb)',1,
  E' lines:=jsonb_build_array(jsonb_build_object(''code'',''1201'',''debit'',inv.total,''credit'',0),jsonb_build_object(''code'',''4101'',''debit'',0,''credit'',round(inv.dpp)));',
  E' select coalesce(sum(qty*harga),0),coalesce(sum(diskon),0) into src_gross,src_disc from public.sales_invoice_items where invoice_id=inv.id;\n lines:=jsonb_build_array(jsonb_build_object(''code'',''1201'',''debit'',inv.total,''credit'',0),jsonb_build_object(''code'',''4101'',''debit'',0,''credit'',round(src_gross)));\n if src_disc>0 then lines:=lines||jsonb_build_array(jsonb_build_object(''code'',''4102'',''debit'',round(src_disc),''credit'',0));end if;'),
 --    C5. Harga pengganti dihitung atas nilai bersih; diskon baris dibawa apa adanya.
 ('public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb)',1,
  E'   dpp:=dpp+r.qty*item.harga;',
  E'   gross:=gross+r.qty*item.harga;disc:=disc+coalesce(r.diskon,0);dpp:=dpp+r.qty*item.harga-coalesce(r.diskon,0);'),
 ('public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb)',1,
  E'  if dpp<=0 or dpp<>round(dpp) then',
  E'  if dpp<=0 or dpp<>round(dpp) or gross<>round(gross) or disc<>round(disc) then'),
 ('public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb)',1,
  E'   insert into public.sales_invoice_items(id,invoice_id,order_item_id,item_id,nama,satuan,faktor,qty,harga,hpp)\n    select new_line,new_invoice,order_item_id,item_id,nama,satuan,faktor,qty,item.harga,hpp from public.sales_invoice_items where id=item.id;',
  E'   insert into public.sales_invoice_items(id,invoice_id,order_item_id,item_id,nama,satuan,faktor,qty,harga,diskon,hpp)\n    select new_line,new_invoice,order_item_id,item_id,nama,satuan,faktor,qty,item.harga,diskon,hpp from public.sales_invoice_items where id=item.id;'),
 --    C6. Jurnal pengganti memisahkan pendapatan bruto dari diskon penjualan.
 ('public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb)',1,
  E'  lines:=jsonb_build_array(jsonb_build_object(''code'',''1201'',''debit'',dpp+tax,''credit'',0),jsonb_build_object(''code'',''4101'',''debit'',0,''credit'',dpp));',
  E'  lines:=jsonb_build_array(jsonb_build_object(''code'',''1201'',''debit'',dpp+tax,''credit'',0),jsonb_build_object(''code'',''4101'',''debit'',0,''credit'',gross));\n  if disc>0 then lines:=lines||jsonb_build_array(jsonb_build_object(''code'',''4102'',''debit'',disc,''credit'',0));end if;')
 ) as patches(sig,expected,old_text,new_text) loop
  signature:=to_regprocedure(p.sig);
  if signature is null then raise exception 'Faktur jual: RPC wajib tidak ada: %',p.sig;end if;
  definition:=pg_get_functiondef(signature);
  hits:=(length(definition)-length(replace(definition,p.old_text,'')))/length(p.old_text);
  if hits<>p.expected then
   raise exception 'Faktur jual: jangkar harus muncul % kali di % (ketemu %); periksa definisi sebelum menerapkan',p.expected,p.sig,hits;
  end if;
  execute replace(definition,p.old_text,p.new_text);
 end loop;
end $patch$;

-- ACL tetap seperti definisi aslinya.
revoke all on function public.guard_wholesale_journal() from public,anon,authenticated,service_role;
revoke all on function public.get_wholesale_operation(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_wholesale_operation(uuid,text,text) to authenticated;
revoke all on function public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb) to authenticated;

do $periksa$
begin
 if position('sales-receipt-void' in pg_get_functiondef('public.guard_wholesale_journal()'::regprocedure))=0
  or position('receipt-cancel' in pg_get_functiondef('public.get_wholesale_operation(uuid,text,text)'::regprocedure))=0
  or position('4102' in pg_get_functiondef('public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb)'::regprocedure))=0 then
  raise exception 'Faktur jual: tambalan fungsi berjalan tidak lengkap';
 end if;
end $periksa$;

-- ─────────────── 3. Edit faktur penjualan per baris ───────────────
-- Inti edit. p_preview=true: kerjakan semuanya lalu lempar VP002 berisi hasil; pemanggil
-- membatalkan transaksinya, jadi pratinjau memakai jalur yang persis sama dengan simpan.
create function public.wholesale_invoice_line_edit_run(
 p_invoice_id uuid,p_tanggal date,p_jatuh_tempo date,p_catatan text,p_items jsonb,
 p_reason text,p_request_key text,p_payload jsonb,p_preview boolean
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare
 inv public.sales_invoices%rowtype;ord public.sales_orders%rowtype;line public.sales_invoice_items%rowtype;
 oi public.sales_order_items%rowtype;item record;ship record;
 new_line uuid;new_invoice uuid:=gen_random_uuid();new_no text;audit uuid:=gen_random_uuid();
 original uuid;reversal uuid;replacement uuid;before_value jsonb;lines jsonb;alloc jsonb;result jsonb;
 src_gross numeric;src_disc numeric;src_hpp numeric;gross numeric:=0;disc numeric:=0;dpp numeric:=0;tax numeric:=0;rate numeric:=0;
 v_left numeric;v_take numeric;v_cost numeric;v_avail numeric;v_avail_hpp numeric;v_hpp numeric;v_kept integer:=0;v_type text;
begin
 -- Urutan kunci sama dengan correct_wholesale_invoice: pesanan → faktur → baris pesanan → jurnal.
 select o.* into ord from public.sales_orders o join public.sales_invoices i on i.order_id=o.id where i.id=p_invoice_id for update of o;
 select * into inv from public.sales_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Faktur grosir tidak ditemukan' using errcode='42501';end if;
 perform public.wholesale_access(inv.branch_id,true);
 if inv.order_id is null or coalesce(inv.kategori,'penjualan')='selisih_stok' or inv.opening_batch_id is not null
  or ord.id is null or ord.branch_id is distinct from inv.branch_id or ord.customer_id is distinct from inv.customer_id then
  raise exception 'Faktur ini bukan faktur penjualan dari pesanan (saldo awal atau selisih stok); edit baris tidak tersedia';end if;
 if inv.status='batal' then raise exception 'Faktur sudah dibatalkan; buka faktur penggantinya';end if;
 if exists(select 1 from public.sales_invoices where replaces_invoice_id=inv.id) then raise exception 'Faktur ini sudah diganti faktur lain; buka faktur terbaru';end if;
 if ord.status='batal' then raise exception 'Pesanan dibatalkan. Rekonsiliasi pengiriman dan faktur diperlukan';end if;

 if p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then raise exception 'Alasan perubahan wajib diisi (minimal 3 huruf)' using errcode='22023';end if;
 if p_tanggal is null or not isfinite(p_tanggal) then raise exception 'Tanggal koreksi tidak valid' using errcode='22023';end if;
 perform public.wholesale_period(inv.tanggal,p_tanggal);
 if p_tanggal<inv.tanggal then raise exception 'Tanggal koreksi mendahului tanggal faktur' using errcode='22023';end if;
 if p_jatuh_tempo is null or not isfinite(p_jatuh_tempo) or p_jatuh_tempo<p_tanggal then raise exception 'Jatuh tempo pengganti tidak valid' using errcode='22023';end if;
 if length(coalesce(p_catatan,''))>1000 then raise exception 'Catatan terlalu panjang' using errcode='22023';end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Rincian baris tidak valid' using errcode='22023';end if;

 -- Uang yang sudah masuk tidak boleh ditebak ulang: hapus penerimaannya dulu.
 if inv.carried_paid<>0 or exists(select 1 from public.sales_receipts where invoice_id=inv.id and voided_at is null and reversal_of is null) then
  raise exception 'Faktur ini sudah punya penerimaan. Hapus penerimaan dulu (Aksi → Hapus penerimaan) sebelum mengubah faktur' using errcode='22023';end if;

 -- Penggajian adalah konsumen komisi faktur reseller; bekukan seperti koreksi harga.
 lock table public.payrolls in share mode;
 if exists(select 1 from public.payrolls where periode in(to_char(inv.tanggal,'YYYY-MM'),to_char(p_tanggal,'YYYY-MM'))) then raise exception 'Penggajian sudah memakai periode ini; rekonsiliasi komisi dahulu';end if;
 insert into public.wholesale_payroll_epochs(periode,epoch)
  select distinct p,1 from unnest(array[to_char(inv.tanggal,'YYYY-MM'),to_char(p_tanggal,'YYYY-MM')]) p order by p
  on conflict(periode) do update set epoch=public.wholesale_payroll_epochs.epoch+1;

 -- Bukti sumber: alokasi pengiriman, HPP dan counter pesanan harus utuh sebelum diposting ulang.
 perform 1 from public.sales_order_items where order_id=ord.id order by id for update;
 if not exists(select 1 from public.sales_invoice_items where invoice_id=inv.id) or exists(
  select 1 from public.sales_invoice_items ii left join public.sales_order_items soi on soi.id=ii.order_item_id
  where ii.invoice_id=inv.id and (soi.id is null or soi.order_id<>ord.id or soi.item_id is distinct from ii.item_id
   or soi.satuan is distinct from ii.satuan or soi.faktor is distinct from ii.faktor
   or ii.qty<>(select coalesce(sum(a.qty),0) from public.sales_invoice_delivery_allocations a where a.invoice_item_id=ii.id)
   or coalesce(ii.hpp,0)<>(select coalesce(sum(a.hpp),0) from public.sales_invoice_delivery_allocations a where a.invoice_item_id=ii.id))) then
  raise exception 'Alokasi pengiriman/HPP sumber belum terbukti. Rekonsiliasi faktur dan pengiriman dahulu';end if;
 if (select count(distinct order_item_id) from public.sales_invoice_items where invoice_id=inv.id)
  <>(select count(*) from public.sales_invoice_items where invoice_id=inv.id) then
  raise exception 'Satu baris pesanan muncul lebih dari sekali pada faktur ini; rekonsiliasi sumber dahulu';end if;
 if exists(select 1 from public.sales_order_items soi where soi.order_id=ord.id and (
   soi.qty_kirim<>(select coalesce(sum(di.qty),0) from public.sales_delivery_items di join public.sales_deliveries sd on sd.id=di.delivery_id where di.order_item_id=soi.id and sd.order_id=ord.id)
   or soi.qty_faktur<>(select coalesce(sum(ii.qty),0) from public.sales_invoice_items ii join public.sales_invoices si on si.id=ii.invoice_id where ii.order_item_id=soi.id and si.order_id=ord.id and si.status<>'batal')
   or soi.qty_faktur>soi.qty_kirim)) then raise exception 'Counter/alokasi pengiriman fisik tidak konsisten. Rekonsiliasi dahulu; stok tidak dibalik dari faktur';end if;
 select coalesce(sum(qty*harga),0),coalesce(sum(diskon),0),coalesce(sum(hpp),0) into src_gross,src_disc,src_hpp
  from public.sales_invoice_items where invoice_id=inv.id;
 if inv.dpp is distinct from src_gross-src_disc or inv.total<>round(inv.dpp)+inv.ppn then
  raise exception 'Nilai baris/faktur tidak cocok dengan pembukuan; rekonsiliasi sumber dahulu';end if;

 -- Jurnal faktur sumber harus persis seperti nilai fakturnya sebelum dibalik.
 lock table public.journal_entries in row exclusive mode;
 if (select count(*) from public.journal_entries where source='sales-invoice' and source_ref=inv.no_faktur)<>1 then raise exception 'Tautan jurnal faktur tidak unik; rekonsiliasi sumber dahulu';end if;
 select id into original from public.journal_entries where source='sales-invoice' and source_ref=inv.no_faktur;
 lines:=jsonb_build_array(jsonb_build_object('code','1201','debit',inv.total,'credit',0),jsonb_build_object('code','4101','debit',0,'credit',round(src_gross)));
 if src_disc>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','4102','debit',round(src_disc),'credit',0));end if;
 if inv.ppn>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2201','debit',0,'credit',inv.ppn));end if;
 perform public.wholesale_assert_journal(original,'sales-invoice',inv.no_faktur,inv.tanggal,inv.branch_id,lines);

 -- Rincian pengganti: semua baris sumber wajib disebut tepat sekali, hanya qty/harga/diskon.
 if jsonb_array_length(p_items)<>(select count(*) from public.sales_invoice_items where invoice_id=inv.id)
  or jsonb_array_length(p_items)<>(select count(distinct x.id) from jsonb_to_recordset(p_items) as x(id uuid,qty numeric,harga numeric,diskon numeric)) then
  raise exception 'Semua baris faktur wajib disebut tepat sekali' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if exists(select 1 from jsonb_object_keys(item.value) k where k not in ('id','qty','harga','diskon')) then
   raise exception 'Edit baris hanya mengubah qty, harga dan diskon' using errcode='22023';end if;
 end loop;
 for item in select * from jsonb_to_recordset(p_items) as x(id uuid,qty numeric,harga numeric,diskon numeric) order by id loop
  select * into line from public.sales_invoice_items where id=item.id and invoice_id=inv.id;
  if not found then raise exception 'Baris pengganti bukan milik faktur ini' using errcode='22023';end if;
  if item.qty is null or item.qty<0 or item.qty>1000000000 or item.qty::text in ('NaN','Infinity','-Infinity') then raise exception 'Qty baris % tidak valid',line.nama using errcode='22023';end if;
  if item.harga is null or item.harga<0 or item.harga>1000000000 or item.harga::text in ('NaN','Infinity','-Infinity') or item.harga<>round(item.harga,2) then raise exception 'Harga baris % tidak valid',line.nama using errcode='22023';end if;
  if coalesce(item.diskon,0)<0 or coalesce(item.diskon,0)>1000000000000 or coalesce(item.diskon,0)::text in ('NaN','Infinity','-Infinity') or coalesce(item.diskon,0)<>round(coalesce(item.diskon,0),2) then raise exception 'Diskon baris % tidak valid',line.nama using errcode='22023';end if;
  if coalesce(item.diskon,0)>item.qty*item.harga then raise exception 'Diskon baris % melebihi nilai barisnya',line.nama using errcode='22023';end if;
  select * into oi from public.sales_order_items where id=line.order_item_id;
  if not found then raise exception 'Baris pesanan sumber tidak ditemukan; rekonsiliasi dahulu';end if;
  if item.qty>oi.qty_kirim-oi.qty_faktur+line.qty then
   raise exception 'Qty % melebihi barang yang sudah dikirim dan belum ditagih (maksimal %)',line.nama,
    trim(to_char(oi.qty_kirim-oi.qty_faktur+line.qty,'FM999999999990.######'),'.') using errcode='22003';end if;
  gross:=gross+item.qty*item.harga;disc:=disc+coalesce(item.diskon,0);
  if item.qty>0 then v_kept:=v_kept+1;end if;
 end loop;
 dpp:=gross-disc;
 if v_kept=0 then raise exception 'Faktur harus menyisakan minimal satu baris. Untuk menghapus seluruh tagihan gunakan pembatalan faktur' using errcode='22023';end if;
 if dpp<=0 or dpp<>round(dpp) or gross<>round(gross) or disc<>round(disc) then
  raise exception 'Nilai faktur harus rupiah bulat dan lebih dari 0 agar jurnal dan piutang konsisten' using errcode='22023';end if;
 if inv.ppn>0 then
  select coalesce(nullif(ppn_rate,0),11) into rate from public.company_settings where id for share;
  if round(inv.dpp*rate/100)<>inv.ppn then raise exception 'Tarif pajak sumber tidak dapat dibuktikan; rekonsiliasi dahulu';end if;
  tax:=round(dpp*rate/100);
 end if;
 if not exists(select 1 from jsonb_to_recordset(p_items) as x(id uuid,qty numeric,harga numeric,diskon numeric)
   join public.sales_invoice_items ii on ii.id=x.id
   where ii.qty<>x.qty or ii.harga<>x.harga or ii.diskon<>coalesce(x.diskon,0))
  and p_jatuh_tempo=inv.jatuh_tempo and coalesce(btrim(p_catatan),'')=coalesce(inv.catatan,'') then
  raise exception 'Tidak ada perubahan qty, harga, diskon, jatuh tempo atau catatan' using errcode='22023';end if;

 before_value:=jsonb_build_object('invoice',to_jsonb(inv),
  'items',(select jsonb_agg(to_jsonb(ii) order by id) from public.sales_invoice_items ii where invoice_id=inv.id),
  'allocations',(select jsonb_agg(to_jsonb(a) order by a.invoice_item_id,a.delivery_item_id) from public.sales_invoice_delivery_allocations a join public.sales_invoice_items ii on ii.id=a.invoice_item_id where ii.invoice_id=inv.id),
  'receipts',(select coalesce(jsonb_agg(to_jsonb(rc) order by id),'[]') from public.sales_receipts rc where invoice_id=inv.id));

 -- Balik jurnal faktur lama, lalu faktur lama ditandai batal (riwayatnya tetap).
 select jsonb_agg(jsonb_build_object('code',a.code,'debit',l.credit,'credit',l.debit)) into lines
  from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=original;
 reversal:=public.wholesale_write_journal(p_tanggal,inv.branch_id,'wholesale-invoice-void',inv.id::text,'Pembalik '||inv.no_faktur||': '||btrim(p_reason),lines);
 update public.sales_invoices set status='batal',voided_on=p_tanggal,void_reason=btrim(p_reason),revision=revision+1 where id=inv.id;
 update public.sales_order_items soi set qty_faktur=qty_faktur-x.qty
  from (select order_item_id,sum(qty) qty from public.sales_invoice_items where invoice_id=inv.id group by order_item_id) x
  where soi.id=x.order_item_id;

 -- Faktur pengganti: nomor baru, baris baru, alokasi HPP dihitung ulang dari pengiriman.
 select type::text into v_type from public.branches where id=inv.branch_id;
 new_no:=public.sales_next_number(case when v_type='KLINIK' then 'FJK' else 'FJ' end,p_tanggal);
 insert into public.sales_invoices(id,no_faktur,order_id,customer_id,branch_id,tanggal,jatuh_tempo,dpp,ppn,total,status,catatan,created_by,carried_paid,replaces_invoice_id)
  values(new_invoice,new_no,inv.order_id,inv.customer_id,inv.branch_id,p_tanggal,p_jatuh_tempo,dpp,tax,dpp+tax,'berjalan',nullif(btrim(coalesce(p_catatan,'')),''),inv.created_by,0,inv.id);
 for item in select x.id,x.qty,x.harga,x.diskon,ii.order_item_id,ii.item_id,ii.nama,ii.satuan,ii.faktor
   from jsonb_to_recordset(p_items) as x(id uuid,qty numeric,harga numeric,diskon numeric)
   join public.sales_invoice_items ii on ii.id=x.id and ii.invoice_id=inv.id order by ii.id loop
  continue when item.qty<=0;
  new_line:=gen_random_uuid();v_left:=item.qty;v_hpp:=0;alloc:='[]';
  for ship in select di.id,di.qty,di.hpp,
     coalesce((select sum(a.qty) from public.sales_invoice_delivery_allocations a join public.sales_invoice_items ai on ai.id=a.invoice_item_id
       join public.sales_invoices av on av.id=ai.invoice_id where a.delivery_item_id=di.id and av.status<>'batal'),0) allocated_qty,
     coalesce((select sum(a.hpp) from public.sales_invoice_delivery_allocations a join public.sales_invoice_items ai on ai.id=a.invoice_item_id
       join public.sales_invoices av on av.id=ai.invoice_id where a.delivery_item_id=di.id and av.status<>'batal'),0) allocated_hpp
    from public.sales_delivery_items di join public.sales_deliveries sd on sd.id=di.delivery_id
    where di.order_item_id=item.order_item_id and sd.order_id=ord.id order by sd.tanggal,sd.created_at,sd.id,di.id loop
   exit when v_left<=0;
   v_avail:=ship.qty-ship.allocated_qty;v_avail_hpp:=coalesce(ship.hpp,0)-ship.allocated_hpp;
   if v_avail<0 or v_avail_hpp<0 then raise exception 'Alokasi HPP pengiriman % tidak konsisten. Minta keuangan meninjau.',item.nama;end if;
   continue when v_avail=0;
   v_take:=least(v_left,v_avail);
   -- Alokasi terakhir membawa sisa sen supaya HPP baris dan HPP pengiriman cocok persis.
   v_cost:=case when v_take=v_avail then v_avail_hpp else least(v_avail_hpp,round(v_take*coalesce(ship.hpp,0)/ship.qty,2)) end;
   v_hpp:=v_hpp+v_cost;v_left:=v_left-v_take;
   alloc:=alloc||jsonb_build_array(jsonb_build_object('delivery_item_id',ship.id,'qty',v_take,'hpp',v_cost));
  end loop;
  if v_left>0 then raise exception 'Rincian pengiriman % tidak cukup untuk alokasi HPP.',item.nama using errcode='22003';end if;
  insert into public.sales_invoice_items(id,invoice_id,order_item_id,item_id,nama,satuan,faktor,qty,harga,diskon,hpp)
   values(new_line,new_invoice,item.order_item_id,item.item_id,item.nama,item.satuan,item.faktor,item.qty,item.harga,coalesce(item.diskon,0),round(v_hpp,2));
  insert into public.sales_invoice_delivery_allocations(invoice_item_id,delivery_item_id,qty,hpp)
   select new_line,a.delivery_item_id,a.qty,a.hpp from jsonb_to_recordset(alloc) as a(delivery_item_id uuid,qty numeric,hpp numeric);
  update public.sales_order_items set qty_faktur=qty_faktur+item.qty where id=item.order_item_id;
 end loop;
 lines:=jsonb_build_array(jsonb_build_object('code','1201','debit',dpp+tax,'credit',0),jsonb_build_object('code','4101','debit',0,'credit',gross));
 if disc>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','4102','debit',disc,'credit',0));end if;
 if tax>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2201','debit',0,'credit',tax));end if;
 replacement:=public.wholesale_write_journal(p_tanggal,inv.branch_id,'sales-invoice',new_no,'Pengganti '||inv.no_faktur,lines);
 update public.sales_orders set status=case when not exists(select 1 from public.sales_order_items where order_id=ord.id and (qty_kirim<qty or qty_faktur<qty_kirim)) then 'selesai' else 'diproses' end where id=ord.id;

 insert into public.wholesale_invoice_corrections(id,invoice_id,replacement_id,action,kind,reason,tanggal,before_value,after_value,
  original_journal_id,reversal_journal_id,replacement_journal_id,credit_journal_id,paid_preserved,customer_credit,created_by)
  values(audit,inv.id,new_invoice,'replace','baris',btrim(p_reason),p_tanggal,before_value,
  (select to_jsonb(si) from public.sales_invoices si where id=new_invoice),original,reversal,replacement,null,0,0,auth.uid());
 -- Periksa ulang hak akses setelah semua kunci, sama dengan koreksi grosir yang sudah ada.
 perform public.wholesale_access(inv.branch_id,true);
 result:=jsonb_build_object(
  'correction_id',audit,'invoice_id',inv.id,'no_faktur',inv.no_faktur,'replacement_id',new_invoice,'replacement_no',new_no,
  'tanggal',p_tanggal,'jatuh_tempo',p_jatuh_tempo,'reversal_journal_id',reversal,'replacement_journal_id',replacement,
  'old_gross',src_gross,'new_gross',gross,'old_diskon',src_disc,'new_diskon',disc,'old_dpp',inv.dpp,'new_dpp',dpp,
  'old_ppn',inv.ppn,'new_ppn',tax,'old_total',inv.total,'new_total',dpp+tax,
  'ar_delta',dpp+tax-inv.total,'revenue_delta',gross-src_gross,'diskon_delta',disc-src_disc,'ppn_delta',tax-inv.ppn,
  'old_hpp',src_hpp,'new_hpp',(select coalesce(sum(hpp),0) from public.sales_invoice_items where invoice_id=new_invoice),
  'lines',(select coalesce(jsonb_agg(jsonb_build_object('nama',ii.nama,'satuan',ii.satuan,
     'old_qty',ii.qty,'new_qty',x.qty,'old_harga',ii.harga,'new_harga',x.harga,
     'old_diskon',ii.diskon,'new_diskon',coalesce(x.diskon,0),
     'old_subtotal',ii.qty*ii.harga-ii.diskon,'new_subtotal',x.qty*x.harga-coalesce(x.diskon,0)) order by ii.id),'[]')
   from jsonb_to_recordset(p_items) as x(id uuid,qty numeric,harga numeric,diskon numeric)
   join public.sales_invoice_items ii on ii.id=x.id));
 if p_preview then raise exception using errcode='VP002',message='wholesale-line-edit-preview',detail=result::text;end if;
 insert into public.wholesale_operation_requests(actor_id,kind,request_key,invoice_id,payload,result)
  values(auth.uid(),'line-edit',p_request_key,inv.id,p_payload,result);
 return result;
end$$;
revoke all on function public.wholesale_invoice_line_edit_run(uuid,date,date,text,jsonb,text,text,jsonb,boolean) from public,anon,authenticated,service_role;

create function public.preview_wholesale_invoice_lines(p_invoice_id uuid,p_tanggal date,p_jatuh_tempo date,p_catatan text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_detail text;begin
 begin
  perform public.wholesale_invoice_line_edit_run(p_invoice_id,p_tanggal,p_jatuh_tempo,p_catatan,p_items,
   'Pratinjau edit faktur','preview:'||gen_random_uuid()::text,'{}'::jsonb,true);
 exception when sqlstate 'VP002' then
  get stacked diagnostics v_detail=pg_exception_detail;
  return v_detail::jsonb-'correction_id'-'replacement_id'-'replacement_no'-'reversal_journal_id'-'replacement_journal_id';
 end;
 raise exception 'Pratinjau edit faktur tidak menghasilkan dampak';
end$$;
revoke all on function public.preview_wholesale_invoice_lines(uuid,date,date,text,jsonb) from public,anon,service_role;
grant execute on function public.preview_wholesale_invoice_lines(uuid,date,date,text,jsonb) to authenticated;

create function public.correct_wholesale_invoice_lines(
 p_request_key text,p_invoice_id uuid,p_expected_revision integer,p_tanggal date,p_jatuh_tempo date,
 p_catatan text,p_items jsonb,p_reason text,p_expected jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb;prior public.wholesale_operation_requests%rowtype;result jsonb;k text;v_revision integer;begin
 if p_request_key is null or length(btrim(p_request_key)) not between 8 and 120 or p_request_key like 'preview:%' then raise exception 'Identitas edit tidak valid' using errcode='22023';end if;
 if jsonb_typeof(p_expected) is distinct from 'object' then raise exception 'Buka pratinjau dampak sebelum menyimpan perubahan' using errcode='22023';end if;
 if p_expected_revision is null or p_expected_revision<0 then raise exception 'Revisi faktur tidak valid' using errcode='22023';end if;
 -- Hak akses diperiksa sebelum identitas permintaan dibaca, sama dengan koreksi grosir yang sudah ada.
 perform public.wholesale_access((select branch_id from public.sales_invoices where id=p_invoice_id),true);
 payload:=jsonb_build_object('invoice_id',p_invoice_id,'revision',p_expected_revision,'tanggal',p_tanggal,
  'jatuh_tempo',p_jatuh_tempo,'catatan',p_catatan,'items',p_items,'reason',btrim(coalesce(p_reason,'')));
 perform pg_advisory_xact_lock(hashtextextended('kamo:wholesale:line-edit:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.wholesale_operation_requests where actor_id=auth.uid() and kind='line-edit' and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas edit dipakai untuk rincian berbeda' using errcode='22023';end if;
  return prior.result;
 end if;
 select revision into v_revision from public.sales_invoices where id=p_invoice_id;
 if v_revision is distinct from p_expected_revision then raise exception 'Faktur sudah berubah sejak pratinjau. Muat ulang lalu periksa dampaknya lagi' using errcode='40001';end if;
 result:=public.wholesale_invoice_line_edit_run(p_invoice_id,p_tanggal,p_jatuh_tempo,p_catatan,p_items,p_reason,p_request_key,payload,false);
 foreach k in array array['new_gross','new_diskon','new_dpp','new_ppn','new_total','ar_delta','old_total','new_hpp'] loop
  if (p_expected->>k)::numeric is distinct from (result->>k)::numeric then
   raise exception 'Dampak perubahan berbeda dari pratinjau. Buka pratinjau ulang sebelum menyimpan' using errcode='40001';end if;
 end loop;
 return result;
end$$;
revoke all on function public.correct_wholesale_invoice_lines(text,uuid,integer,date,date,text,jsonb,text,jsonb) from public,anon,service_role;
grant execute on function public.correct_wholesale_invoice_lines(text,uuid,integer,date,date,text,jsonb,text,jsonb) to authenticated;

-- ─────────────── 4. Hapus (balik) Penerimaan Penjualan ───────────────
-- Uang yang sudah tercatat tidak dihapus: baris penerimaan lawan bernilai negatif ditambahkan,
-- jurnal aslinya dibalik dengan jurnal baru, dan pemakaian uang muka dikembalikan. Pola sama
-- dengan cancel_purchase_payment di sisi Pembelian.
create function public.cancel_wholesale_receipt(p_receipt_id uuid,p_expected_revision integer,p_request_key text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare rc public.sales_receipts%rowtype;inv public.sales_invoices%rowtype;adv public.sales_advances%rowtype;
 prior public.wholesale_operation_requests%rowtype;payload jsonb;result jsonb;before_value jsonb;lines jsonb;
 original uuid;reversal uuid;audit uuid:=gen_random_uuid();reversal_receipt uuid:=gen_random_uuid();
 cash_code text;paid numeric;v_invoice uuid;v_order uuid;v_no text;
 today date:=(now() at time zone 'Asia/Jakarta')::date;
begin
 select invoice_id into v_invoice from public.sales_receipts where id=p_receipt_id;
 if not found then raise exception 'Penerimaan tidak ditemukan' using errcode='42501';end if;
 -- Urutan kunci sama dengan receive_wholesale_payment: pesanan → faktur → penerimaan.
 select order_id into v_order from public.sales_invoices where id=v_invoice;
 if v_order is not null then perform 1 from public.sales_orders where id=v_order for update;end if;
 select * into inv from public.sales_invoices where id=v_invoice for update;
 perform 1 from public.sales_receipts where invoice_id=inv.id order by id for update;
 select * into rc from public.sales_receipts where id=p_receipt_id;
 perform public.wholesale_access(inv.branch_id,true);
 if p_request_key is null or length(btrim(p_request_key)) not between 1 and 120 or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Identitas atau alasan penghapusan tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('receipt_id',p_receipt_id,'revision',p_expected_revision,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('kamo:wholesale:receipt-cancel:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.wholesale_operation_requests where actor_id=auth.uid() and kind='receipt-cancel' and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas penghapusan dipakai untuk rincian berbeda' using errcode='22023';end if;
  return prior.result;
 end if;
 if rc.reversal_of is not null then raise exception 'Baris ini adalah pembalik penerimaan, bukan penerimaan' using errcode='22023';end if;
 if rc.voided_at is not null or exists(select 1 from public.sales_receipts where reversal_of=rc.id) then raise exception 'Penerimaan ini sudah dihapus';end if;
 if rc.revision<>p_expected_revision then raise exception 'Penerimaan sudah berubah. Muat ulang sebelum menghapus' using errcode='40001';end if;
 -- Penerimaan pada faktur yang sudah dibatalkan sudah terbawa ke faktur penggantinya.
 if inv.status='batal' or exists(select 1 from public.sales_invoices where replaces_invoice_id=inv.id) then
  raise exception 'Faktur ini sudah dibatalkan atau diganti; hapus penerimaan dari faktur terbaru';end if;
 perform public.wholesale_period(rc.tanggal,today);

 if rc.journal_id is null then raise exception 'Jurnal penerimaan lama tidak punya tautan pasti; rekonsiliasi dahulu';end if;
 if (select count(*) from public.journal_entries where source='sales-receipt' and source_ref=rc.no_terima)<>1 then raise exception 'Tautan jurnal penerimaan tidak unik; rekonsiliasi dahulu';end if;
 select id into original from public.journal_entries where source='sales-receipt' and source_ref=rc.no_terima;
 if original is distinct from rc.journal_id then raise exception 'Tautan jurnal penerimaan tidak cocok; rekonsiliasi dahulu';end if;
 lock table public.journal_entries in row exclusive mode;
 select min(a.code) into cash_code from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
  where l.entry_id=original and a.code not in ('1201','2103');
 lines:=jsonb_build_array(jsonb_build_object('code','1201','debit',0,'credit',rc.jumlah));
 if rc.dari_uang_muka>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2103','debit',rc.dari_uang_muka,'credit',0));end if;
 if rc.jumlah>rc.dari_uang_muka then
  if cash_code is null then raise exception 'Akun kas penerimaan belum terbukti; rekonsiliasi dahulu';end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('code',cash_code,'debit',rc.jumlah-rc.dari_uang_muka,'credit',0));
  -- Rekonsiliasi bank membekukan saldo rekening sampai tanggal rekeningnya.
  if exists(select 1 from public.bank_reconciliations br join public.cash_accounts a on a.id=br.cash_account_id
    where br.voided_at is null and coalesce(br.bank_coa_code,a.coa_code)=cash_code and rc.tanggal<=br.tanggal) then
   raise exception 'Penerimaan sudah direkonsiliasi bank; tinjau rekonsiliasi dahulu';end if;
 end if;
 perform public.wholesale_assert_journal(original,'sales-receipt',rc.no_terima,rc.tanggal,inv.branch_id,lines);
 if rc.dari_uang_muka>0 then
  if rc.advance_id is null then raise exception 'Bukti uang muka penerimaan tidak lengkap; rekonsiliasi dahulu';end if;
  select * into adv from public.sales_advances where id=rc.advance_id for update;
  if not found or adv.terpakai<rc.dari_uang_muka
   or adv.terpakai is distinct from (select coalesce(sum(dari_uang_muka),0) from public.sales_receipts where advance_id=adv.id) then
   raise exception 'Alokasi uang muka sudah berubah; rekonsiliasi diperlukan';end if;
 end if;

 before_value:=jsonb_build_object('receipt',to_jsonb(rc),'invoice',to_jsonb(inv),
  'journal',(select to_jsonb(j) from public.journal_entries j where id=original),
  'lines',(select jsonb_agg(to_jsonb(l) order by id) from public.journal_lines l where entry_id=original),
  'advance',to_jsonb(adv));
 select jsonb_agg(jsonb_build_object('code',a.code,'debit',l.credit,'credit',l.debit)) into lines
  from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=original;
 reversal:=public.wholesale_write_journal(today,inv.branch_id,'sales-receipt-void',audit::text,
  'Pembalik penerimaan '||rc.no_terima||' atas '||inv.no_faktur||': '||btrim(p_reason),lines);
 v_no:=left(rc.no_terima,28)||'.B';
 insert into public.sales_receipts(id,no_terima,invoice_id,tanggal,jumlah,dari_uang_muka,advance_id,metode,account_id,catatan,created_by,journal_id,reversal_of)
  values(reversal_receipt,v_no,inv.id,today,-rc.jumlah,-rc.dari_uang_muka,rc.advance_id,rc.metode,rc.account_id,btrim(p_reason),auth.uid(),reversal,rc.id);
 if rc.dari_uang_muka>0 then update public.sales_advances set terpakai=terpakai-rc.dari_uang_muka where id=adv.id;end if;
 update public.sales_receipts set voided_at=now(),void_reason=btrim(p_reason),revision=revision+1 where id=rc.id;
 select inv.carried_paid+coalesce(sum(jumlah),0) into paid from public.sales_receipts where invoice_id=inv.id;
 if paid<0 then raise exception 'Saldo penerimaan faktur menjadi negatif; rekonsiliasi diperlukan';end if;
 update public.sales_invoices set status=case when paid>=total then 'lunas' else 'berjalan' end,revision=revision+1 where id=inv.id;
 insert into public.sales_receipt_cancellations(id,receipt_id,reversal_receipt_id,invoice_id,reason,tanggal,before_value,
  original_journal_id,reversal_journal_id,advance_id,advance_restored,created_by)
  values(audit,rc.id,reversal_receipt,inv.id,btrim(p_reason),today,before_value,original,reversal,rc.advance_id,rc.dari_uang_muka,auth.uid());
 perform public.wholesale_access(inv.branch_id,true);
 result:=jsonb_build_object('cancellation_id',audit,'receipt_id',rc.id,'invoice_id',inv.id,'reversal_journal_id',reversal,
  'reversal_receipt_id',reversal_receipt,'document_no',v_no,'advance_restored',rc.dari_uang_muka,'sisa',inv.total-paid);
 insert into public.wholesale_operation_requests(actor_id,kind,request_key,invoice_id,payload,result)
  values(auth.uid(),'receipt-cancel',p_request_key,inv.id,payload,result);
 return result;
end$$;
revoke all on function public.cancel_wholesale_receipt(uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.cancel_wholesale_receipt(uuid,integer,text,text) to authenticated;
