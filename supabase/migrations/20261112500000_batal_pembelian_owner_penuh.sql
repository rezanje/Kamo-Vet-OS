-- Batalkan pembelian ala Accurate (Owner akses penuh): penerimaan barang, faktur, pembayaran, uang muka.
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).
--
-- Fondasi pembatalan sudah ada (cancel_goods_receipt, cancel_purchase_invoice, cancel_purchase_payment,
-- cancel_purchase_advance_cascade; dokumen asli tetap tersimpan, jurnal dibalik, stok/lapisan dibalik, kunci permintaan
-- idempoten). Migrasi ini TIDAK menulis ulang fungsi-fungsi itu: setiap perubahan adalah tambalan berjangkar
-- (patch_once, tepat satu kecocokan atau migrasi berhenti) pada definisi yang berjalan.
--
-- Gembok yang ditutup (ditemukan lewat audit + skenario native PG17, lihat laporan ship-batal-pembelian):
--  1. Aturan "ada barang keluar sesudahnya" di cancel_goods_receipt dan cancel_purchase_invoice menolak SETIAP pengeluaran
--     SKU yang sama, walau yang terpakai hanya lapisan lama. Pada FIFO (metode produksi) bukti sebenarnya adalah keadaan
--     lapisan: lapisan penerimaan/faktur yang masih utuh (qty_left = qty_in, nilai sama seperti saat faktur) tetap aman
--     dibalik, yang sudah terpakai tetap ditolak. Aturan lama tetap berlaku utuh pada metode rata-rata bergerak.
--  2. Retur pembelian yang sudah dibatalkan masih memblokir pembatalan penerimaan: kini hanya retur aktif.
--  3. Tutup sisa PO (bukti tidak bisa diubah) menutup pembatalan penerimaan selamanya: RPC baru
--     reopen_purchase_order_remainder mengarsipkan bukti tutup sisa (tabel arsip tidak bisa diubah), melepas penutupnya dan
--     membuka PO lagi. Penerimaan tidak dibuat/dihapus.
--  4. PO yang semua penerimaan/fakturnya sudah dibatalkan tidak bisa dibatalkan (void) karena dokumen turunan yang sudah
--     batal ikut dihitung: kini hanya dokumen aktif yang menghalangi; ganti-total baris tetap ditolak (kunci asing ke riwayat)
--     dengan petunjuk Edit baris atau Batalkan PO.
--  5. Izin (kapabilitas) pembatalan per peran, bawaan MATI untuk selain Owner: empat tindakan baru di katalog Akses Grup
--     (pembelian.batalkan_penerimaan / _faktur / _pembayaran / _uang_muka). Owner tidak pernah terkunci:
--     purchase_cancel_allowed menjawab true untuk OWNER aktif sebelum membaca kebijakan apa pun.
--  6. preview_goods_receipt_cancellation: pratinjau baca-saja yang menyebut PERSIS apa yang menghalangi dan dokumen mana
--     yang harus dibatalkan lebih dulu (pembayaran > faktur > penerimaan), dalam bahasa biasa.
-- Tidak ada baris data yang diubah. Tidak ada tabel lama yang diubah strukturnya.
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtextextended('vetos:batal-pembelian-owner-penuh',0));

create function pg_temp.patch_once(p_def text, p_old text, p_new text, p_label text, p_times integer default 1) returns text
language plpgsql as $$
declare n integer;
begin
 if p_old is null or length(p_old)=0 then raise exception 'BATAL_PEMBELIAN_ANCHOR_EMPTY %',p_label; end if;
 n:=(length(p_def)-length(replace(p_def,p_old,'')))/length(p_old);
 if n<>p_times then raise exception 'BATAL_PEMBELIAN_ANCHOR % ditemukan % kali (seharusnya %); migrasi dihentikan',p_label,n,p_times; end if;
 return replace(p_def,p_old,p_new);
end $$;

-- 1. Katalog tindakan Akses Grup (default MATI untuk selain Owner: tindakan "hanya-izin", bukan "bawaan-boleh").
insert into role_settings_private.action_catalog(id,label,"group",enforced) values
('pembelian.batalkan_penerimaan','Batalkan penerimaan barang — Pembelian','Pembelian',true),
('pembelian.batalkan_faktur','Batalkan faktur pembelian — Pembelian','Pembelian',true),
('pembelian.batalkan_pembayaran','Batalkan pembayaran faktur pembelian — Pembelian','Pembelian',true),
('pembelian.batalkan_uang_muka','Batalkan uang muka pembelian — Pembelian','Pembelian',true);
insert into role_settings_private.action_modules(id,module_id) values
('pembelian.batalkan_penerimaan','pembelian'),('pembelian.batalkan_faktur','pembelian'),
('pembelian.batalkan_pembayaran','pembelian'),('pembelian.batalkan_uang_muka','pembelian');

-- 2. Izin pembatalan. OWNER aktif selalu true (dibaca lebih dulu, tanpa menyentuh kebijakan). Peran lain hanya bila
--    kebijakan tindakan tersimpan secara eksplisit memuat tindakannya; tidak ada kebijakan / galat baca = tidak boleh.
create function public.purchase_cancel_allowed(p_action text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v_role text; v_allowed text[];
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then return false; end if;
 select role::text into v_role from public.profiles where id=auth.uid() and is_active;
 if v_role is null then return false; end if;
 if v_role='OWNER' then return true; end if;
 if p_action is null or p_action not in ('pembelian.batalkan_penerimaan','pembelian.batalkan_faktur','pembelian.batalkan_pembayaran','pembelian.batalkan_uang_muka') then return false; end if;
 select allowed into v_allowed from role_settings_private.action_policies where role::text=v_role;
 return found and p_action=any(v_allowed);
exception when others then
 -- Selain Owner: gagal-tertutup. Owner sudah dijawab true di atas, jadi galat kebijakan tidak pernah mengunci Owner.
 return coalesce(v_role='OWNER',false);
end $$;
revoke all on function public.purchase_cancel_allowed(text) from public,anon,service_role;
grant execute on function public.purchase_cancel_allowed(text) to authenticated;

create function public.get_my_purchase_cancel_access() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'batalkan_penerimaan',public.purchase_cancel_allowed('pembelian.batalkan_penerimaan'),
  'batalkan_faktur',public.purchase_cancel_allowed('pembelian.batalkan_faktur'),
  'batalkan_pembayaran',public.purchase_cancel_allowed('pembelian.batalkan_pembayaran'),
  'batalkan_uang_muka',public.purchase_cancel_allowed('pembelian.batalkan_uang_muka'));
$$;
revoke all on function public.get_my_purchase_cancel_access() from public,anon,service_role;
grant execute on function public.get_my_purchase_cancel_access() to authenticated;

-- 3. Tambalan berjangkar pada fungsi yang berjalan.
do $patch$
declare v text;
begin
 -- cancel_goods_receipt
 v:=pg_get_functiondef('public.cancel_goods_receipt(uuid,text,text,date)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and role = 'OWNER' and is_active) then$a$,
  $b$if auth.uid() is null or not public.purchase_cancel_allowed('pembelian.batalkan_penerimaan') then$b$,'receipt owner gate 1');
 v:=pg_temp.patch_once(v,$a$if not exists (select 1 from public.profiles where id = auth.uid() and role = 'OWNER' and is_active) then$a$,
  $b$if not public.purchase_cancel_allowed('pembelian.batalkan_penerimaan') then$b$,'receipt owner gate 2');
 v:=pg_temp.patch_once(v,$a$'Pembatalan penerimaan barang hanya oleh Super Admin (OWNER)'$a$,
  $b$'Pembatalan penerimaan barang hanya oleh Super Admin (OWNER) atau peran yang diberi izin Batalkan penerimaan di Akses Grup'$b$,'receipt owner message',2);
 v:=pg_temp.patch_once(v,$a$if exists (select 1 from public.purchase_returns rt where rt.po_id = po.id) then$a$,
  $b$if exists (select 1 from public.purchase_returns rt where rt.po_id = po.id and rt.voided_at is null) then$b$,'receipt active returns only');
 v:=pg_temp.patch_once(v,$a$if exists (select 1 from public.stock_moves m where m.warehouse_id = v_wh and m.item_id = any (v_items)$a$,
  $b$if public.inventory_is_average() and exists (select 1 from public.stock_moves m where m.warehouse_id = v_wh and m.item_id = any (v_items)$b$,'receipt outflow rule average-only');
 v:=pg_temp.patch_once(v,$a$jadi penerimaan tidak bisa dibatalkan. Gunakan Retur Pembelian untuk barang yang dikembalikan ke pemasok.'$a$,
  $b$jadi penerimaan tidak bisa dibatalkan. Batalkan dulu transaksi yang memakainya (penjualan, pemakaian, atau pemindahan), atau gunakan Retur Pembelian untuk barang yang dikembalikan ke pemasok. Stok tidak dibuat minus diam-diam.'$b$,'receipt consumed message');
 v:=pg_temp.patch_once(v,$a$'Sisa PO ini sudah ditutup, jadi penerimaannya tidak bisa dibatalkan. Gunakan Retur Pembelian untuk barang yang dikembalikan.'$a$,
  $b$'Sisa PO ini sudah ditutup. Buka kembali sisa PO dulu (tombol Buka kembali sisa PO di halaman PO), lalu batalkan penerimaannya.'$b$,'receipt closure message');
 execute v;

 -- cancel_purchase_invoice
 v:=pg_get_functiondef('public.cancel_purchase_invoice(uuid,integer,text,text,date)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$if not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then raise exception 'Pembatalan faktur hanya oleh OWNER' using errcode='42501';end if;$a$,
  $b$if not public.purchase_cancel_allowed('pembelian.batalkan_faktur') then raise exception 'Pembatalan faktur hanya oleh OWNER atau peran yang diberi izin Batalkan faktur di Akses Grup' using errcode='42501';end if;$b$,'invoice owner gate',3);
 v:=pg_temp.patch_once(v,$a$if exists(select 1 from public.stock_moves m where m.warehouse_id=proof.warehouse_id and m.item_id in(select item_id from public.purchase_invoice_items where invoice_id=inv.id) and m.qty<0 and m.source<>'purchase-invoice-void'$a$,
  $b$if public.inventory_is_average() and exists(select 1 from public.stock_moves m where m.warehouse_id=proof.warehouse_id and m.item_id in(select item_id from public.purchase_invoice_items where invoice_id=inv.id) and m.qty<0 and m.source<>'purchase-invoice-void'$b$,'invoice outflow rule average-only');
 execute v;

 -- cancel_purchase_payment
 v:=pg_get_functiondef('public.cancel_purchase_payment(uuid,integer,text,text)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$perform 1 from public.profiles where id=auth.uid() and is_active and role='OWNER' for share;
 if not found then raise exception 'Hanya Owner aktif dapat membatalkan pembayaran' using errcode='42501';end if;$a$,
  $b$perform 1 from public.profiles where id=auth.uid() and is_active for share;
 if not found or not public.purchase_cancel_allowed('pembelian.batalkan_pembayaran') then raise exception 'Hanya Owner aktif (atau peran yang diberi izin Batalkan pembayaran di Akses Grup) dapat membatalkan pembayaran' using errcode='42501';end if;$b$,'payment owner gate');
 execute v;

 -- cancel_purchase_advance_cascade
 v:=pg_get_functiondef('public.cancel_purchase_advance_cascade(uuid,text,text,text)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$if not exists (select 1 from public.profiles where id = auth.uid() and role = 'OWNER' and is_active) then$a$,
  $b$if not public.purchase_cancel_allowed('pembelian.batalkan_uang_muka') then$b$,'advance owner gate',2);
 v:=pg_temp.patch_once(v,$a$'Pembatalan uang muka beserta pembayarannya hanya oleh Super Admin (OWNER)'$a$,
  $b$'Pembatalan uang muka beserta pembayarannya hanya oleh Super Admin (OWNER) atau peran yang diberi izin Batalkan uang muka di Akses Grup'$b$,'advance owner message',2);
 execute v;

 -- Pembaca pratinjau / pemulihan "periksa hasil terakhir" memakai izin yang sama dengan penulisnya.
 v:=pg_get_functiondef('public.preview_purchase_advance_cascade(uuid)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and role = 'OWNER' and is_active) then$a$,
  $b$if auth.uid() is null or not public.purchase_cancel_allowed('pembelian.batalkan_uang_muka') then$b$,'advance preview gate');
 v:=pg_temp.patch_once(v,$a$'Pembatalan uang muka beserta pembayarannya hanya oleh Super Admin (OWNER)'$a$,
  $b$'Pembatalan uang muka beserta pembayarannya hanya oleh Super Admin (OWNER) atau peran yang diberi izin Batalkan uang muka di Akses Grup'$b$,'advance preview message');
 execute v;
 v:=pg_get_functiondef('public.get_purchase_payment_cancellation(uuid,text)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') then raise exception 'Hanya Owner aktif dapat memeriksa koreksi' using errcode='42501';end if;$a$,
  $b$if not public.purchase_cancel_allowed('pembelian.batalkan_pembayaran') then raise exception 'Hanya Owner aktif (atau peran yang diberi izin Batalkan pembayaran di Akses Grup) dapat memeriksa koreksi' using errcode='42501';end if;$b$,'payment lookup gate');
 execute v;
 v:=pg_get_functiondef('public.get_purchase_invoice_cancellation(uuid,text)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$if not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then raise exception 'Pembatalan faktur hanya oleh OWNER' using errcode='42501';end if;$a$,
  $b$if not public.purchase_cancel_allowed('pembelian.batalkan_faktur') then raise exception 'Pembatalan faktur hanya oleh OWNER atau peran yang diberi izin Batalkan faktur di Akses Grup' using errcode='42501';end if;$b$,'invoice lookup gate',2);
 execute v;

 -- revise_purchase_order: hanya dokumen turunan AKTIF yang menghalangi pembatalan PO (void); ganti-total baris tetap ditolak.
 v:=pg_get_functiondef('public.revise_purchase_order(text,uuid,integer,text,jsonb,jsonb,text)'::regprocedure);
 v:=pg_temp.patch_once(v,$a$or exists(select 1 from public.purchase_invoices where po_id=v_po.id)$a$,
  $b$or exists(select 1 from public.purchase_invoices where po_id=v_po.id and (p_action<>'void' or voided_at is null))$b$,'revise invoices');
 v:=pg_temp.patch_once(v,$a$or exists(select 1 from public.purchase_returns where po_id=v_po.id)$a$,
  $b$or exists(select 1 from public.purchase_returns where po_id=v_po.id and (p_action<>'void' or voided_at is null))$b$,'revise returns');
 v:=pg_temp.patch_once(v,$a$or exists(select 1 from public.purchase_advances where po_id=v_po.id) then raise exception 'PO sudah memiliki transaksi turunan dan tidak bisa dikoreksi'; end if;$a$,
  $b$or exists(select 1 from public.purchase_advances where po_id=v_po.id and (p_action<>'void' or status='aktif')) then
    raise exception '%',case when p_action='void'
      then 'PO masih memiliki transaksi turunan yang aktif (penerimaan, faktur, retur, atau uang muka). Batalkan dokumen itu dulu, baru PO bisa dibatalkan.'
      else 'PO sudah memiliki transaksi turunan (termasuk yang sudah dibatalkan), jadi seluruh barisnya tidak bisa diganti. Ubah jumlah atau harga lewat Edit baris, atau Batalkan PO lalu buat PO baru.' end;
  end if;$b$,'revise message');
 execute v;
end $patch$;

-- 4. Pratinjau pembatalan penerimaan (baca-saja). Aturannya mencerminkan cancel_goods_receipt; tes diferensial membuktikan
--    "bisa dibatalkan" di sini <=> pembatalan sungguhan berhasil, dan setiap penolakan sungguhan punya penghalang di sini.
create function public.preview_goods_receipt_cancellation(p_receipt_id uuid, p_tanggal date default (now() at time zone 'Asia/Jakarta')::date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 gr public.goods_receipts%rowtype; po public.purchase_orders%rowtype;
 b jsonb:='[]'::jsonb; r record; v_wh uuid; v_ref text; v_items uuid[]; moves jsonb; layers jsonb;
 v_closed date; v_inv_closed date; v_total numeric; v_jcount integer; v_jid uuid; v_avg boolean;
 stock_lines jsonb:='[]'::jsonb; consumed_items jsonb:='[]'::jsonb; outflows jsonb:='[]'::jsonb; unclear boolean:=false; was_consumed boolean:=false;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 select * into gr from public.goods_receipts where id=p_receipt_id;
 if not found then raise exception 'Penerimaan barang tidak ditemukan'; end if;
 select * into po from public.purchase_orders where id=gr.po_id;
 perform public.purchase_assert_access('receipt',po.branch_id);
 v_avg:=public.inventory_is_average();
 if gr.voided_at is not null then
  b:=b||jsonb_build_array(jsonb_build_object('code','sudah_dibatalkan','message','Penerimaan ini sudah dibatalkan. Tidak ada yang perlu dilakukan.','docs','[]'::jsonb));
  return jsonb_build_object('receipt_id',gr.id,'no_terima',gr.no_terima,'po_id',po.id,'no_po',po.no_po,'tanggal',gr.tanggal,'already_cancelled',true,'can_cancel',false,'blockers',b,'effects','{}'::jsonb,'average',v_avg);
 end if;
 if po.status='Batal' then
  b:=b||jsonb_build_array(jsonb_build_object('code','po_batal','message','PO sudah dibatalkan; penerimaannya tidak bisa dibatalkan dari sini. Gunakan Retur Pembelian.','docs',jsonb_build_array(jsonb_build_object('kind','purchase-order','id',po.id,'label','PO '||coalesce(po.no_po,'')))));
 end if;
 if exists(select 1 from public.purchase_order_receipt_closures c where c.po_id=po.id) then
  b:=b||jsonb_build_array(jsonb_build_object('code','sisa_ditutup','message','Sisa PO ini sudah ditutup. Buka kembali sisa PO dulu (tombol Buka kembali sisa PO di halaman PO), lalu batalkan penerimaannya.','docs',jsonb_build_array(jsonb_build_object('kind','purchase-order','id',po.id,'label','PO '||coalesce(po.no_po,'')))));
 end if;
 -- Faktur aktif yang menagih penerimaan ini (dan pembayarannya).
 for r in select i.id,i.no_faktur,coalesce((select sum(p.amount) from public.purchase_invoice_payments p where p.invoice_id=i.id),0) paid
          from public.purchase_invoice_receipts l join public.purchase_invoices i on i.id=l.invoice_id
          where l.goods_receipt_id=gr.id and i.voided_at is null order by i.no_faktur loop
  b:=b||jsonb_build_array(jsonb_build_object('code','faktur_aktif','message','Penerimaan ini sudah ditagih di faktur '||r.no_faktur||
    case when r.paid<>0 then ' yang sudah dibayar Rp '||replace(to_char(r.paid,'FM999,999,999,990'),',','.')||'. Batalkan pembayarannya dulu, lalu batalkan fakturnya.' else '. Batalkan fakturnya dulu.' end,
    'docs',jsonb_build_array(jsonb_build_object('kind','purchase-invoice','id',r.id,'label','Faktur '||r.no_faktur)),'paid',r.paid));
 end loop;
 for r in select i.id,i.no_faktur,coalesce((select sum(p.amount) from public.purchase_invoice_payments p where p.invoice_id=i.id),0) paid
          from public.purchase_invoices i where i.po_id=po.id and i.voided_at is null
           and not exists(select 1 from public.purchase_invoice_receipts l where l.invoice_id=i.id) order by i.no_faktur loop
  b:=b||jsonb_build_array(jsonb_build_object('code','faktur_aktif','message','PO ini punya faktur aktif lama '||r.no_faktur||' tanpa catatan penerimaan'||
    case when r.paid<>0 then ' dan sudah dibayar Rp '||replace(to_char(r.paid,'FM999,999,999,990'),',','.')||'. Batalkan pembayarannya dulu, lalu batalkan fakturnya.' else '. Batalkan fakturnya dulu.' end,
    'docs',jsonb_build_array(jsonb_build_object('kind','purchase-invoice','id',r.id,'label','Faktur '||r.no_faktur)),'paid',r.paid));
 end loop;
 for r in select rt.id,rt.no_retur from public.purchase_returns rt where rt.po_id=po.id and rt.voided_at is null order by rt.no_retur loop
  b:=b||jsonb_build_array(jsonb_build_object('code','retur_aktif','message','PO ini punya retur pembelian aktif '||r.no_retur||'. Batalkan returnya dulu atau lanjutkan lewat Retur Pembelian.',
    'docs',jsonb_build_array(jsonb_build_object('kind','purchase-return','id',r.id,'label','Retur '||r.no_retur))));
 end loop;
 -- Periode terkunci.
 select closed_until into v_closed from public.accounting_locks where id;
 if v_closed is not null and (gr.tanggal<=v_closed or p_tanggal<=v_closed) then
  b:=b||jsonb_build_array(jsonb_build_object('code','periode_tertutup','message','Periode akuntansi sampai '||to_char(v_closed,'DD-MM-YYYY')||' sudah dikunci. Lepas atau geser kuncinya dulu di Keuangan > Tutup Buku, lalu coba lagi.','docs','[]'::jsonb));
 end if;
 select closed_through into v_inv_closed from public.inventory_costing_settings where id;
 if v_inv_closed is not null and (gr.tanggal<=v_inv_closed or p_tanggal<=v_inv_closed) then
  b:=b||jsonb_build_array(jsonb_build_object('code','periode_persediaan_tertutup','message','Periode persediaan sampai '||to_char(v_inv_closed,'DD-MM-YYYY')||' sudah ditutup (Closing HPP). Buka dulu di Keuangan > Closing HPP, lalu coba lagi.','docs','[]'::jsonb));
 end if;
 if p_tanggal is null or p_tanggal<gr.tanggal then
  b:=b||jsonb_build_array(jsonb_build_object('code','tanggal_tidak_valid','message','Tanggal pembatalan tidak boleh sebelum tanggal penerimaan.','docs','[]'::jsonb));
 end if;

 -- Bukti stok dan jurnal (sama dengan cancel_goods_receipt, tanpa kunci).
 v_wh:=po.to_warehouse_id; v_ref:=coalesce(po.no_po,po.id::text);
 select array_agg(distinct gi.item_id order by gi.item_id) into v_items from public.goods_receipt_items gi where gi.receipt_id=gr.id and gi.qty_terima>0;
 v_items:=coalesce(v_items,'{}');
 if exists(select 1 from public.goods_receipts g where g.po_id=po.id and g.id<>gr.id and g.created_at=gr.created_at)
    or exists(select 1 from public.goods_receipt_items gi where gi.receipt_id=gr.id and (gi.qty_terima>0 or gi.qty_rusak>0) and (gi.po_item_id is null or gi.item_id is null)) then
  unclear:=true;
 end if;
 select coalesce(jsonb_agg(to_jsonb(m) order by m.item_id,m.id),'[]') into moves from public.stock_moves m
  where m.warehouse_id=v_wh and m.source='purchase' and m.source_ref=v_ref and m.created_at=gr.created_at and m.tanggal=gr.tanggal;
 select coalesce(jsonb_agg(to_jsonb(l) order by l.item_id,l.id),'[]') into layers from public.stock_layers l
  where l.warehouse_id=v_wh and l.source='purchase' and l.source_ref=v_ref and l.created_at=gr.created_at and l.tanggal=gr.tanggal;
 if exists(select 1 from public.purchase_invoice_layer_proofs pr join public.purchase_invoices i on i.id=pr.invoice_id
           where i.voided_at is null and pr.layer_id in (select (x->>'id')::uuid from jsonb_array_elements(layers) x)) then
  b:=b||jsonb_build_array(jsonb_build_object('code','faktur_aktif','message','Nilai stok penerimaan ini sudah dipakai faktur pembelian aktif. Batalkan fakturnya dulu.','docs','[]'::jsonb));
 end if;
 if exists(select 1 from jsonb_array_elements(moves) x where not ((x->>'item_id')::uuid=any(v_items)) or (x->>'qty')::numeric<=0)
    or exists(select 1 from jsonb_array_elements(layers) x where not ((x->>'item_id')::uuid=any(v_items))) then
  unclear:=true;
 end if;
 for r in
  select gi.item_id,max(i.name) nama,sum(gi.qty_terima*pi.faktor) expected,
   bool_and(coalesce(i.item_type,'Persediaan')='Persediaan') stocked,
   coalesce((select sum((x->>'qty')::numeric) from jsonb_array_elements(moves) x where (x->>'item_id')::uuid=gi.item_id),0) moved,
   coalesce((select sum((x->>'qty_in')::numeric) from jsonb_array_elements(layers) x where (x->>'item_id')::uuid=gi.item_id),0) layered,
   coalesce((select sum((x->>'qty_left')::numeric) from jsonb_array_elements(layers) x where (x->>'item_id')::uuid=gi.item_id),0) remaining,
   coalesce((select bool_and((x->>'qty_left')::numeric=(x->>'qty_in')::numeric) from jsonb_array_elements(layers) x where (x->>'item_id')::uuid=gi.item_id),true) untouched
  from public.goods_receipt_items gi join public.purchase_order_items pi on pi.id=gi.po_item_id join public.items i on i.id=gi.item_id
  where gi.receipt_id=gr.id and gi.qty_terima>0 group by gi.item_id
 loop
  if r.moved<>r.expected and not (r.moved=0 and not r.stocked) then unclear:=true; end if;
  if r.moved>0 and (r.layered<>r.moved or not r.untouched) then
   was_consumed:=true;
   consumed_items:=consumed_items||jsonb_build_array(jsonb_build_object('item_id',r.item_id,'nama',r.nama,'qty_diterima',r.moved,'qty_masih_utuh',r.remaining,'qty_terpakai',r.moved-r.remaining));
  end if;
  stock_lines:=stock_lines||jsonb_build_array(jsonb_build_object('item_id',r.item_id,'nama',r.nama,'qty',r.moved));
 end loop;
 if v_avg and exists(select 1 from public.stock_moves m where m.warehouse_id=v_wh and m.item_id=any(v_items) and m.qty<0 and m.created_at>=gr.created_at
                     and m.source not in ('purchase-receipt-void','purchase-invoice-void')) then
  was_consumed:=true;
 end if;
 if was_consumed then
  select coalesce(jsonb_agg(jsonb_build_object('source',x.source,'source_ref',x.source_ref,'tanggal',x.tanggal,'qty',-x.qty) order by x.created_at desc),'[]') into outflows
   from (select m.source,m.source_ref,m.tanggal,m.qty,m.created_at from public.stock_moves m
         where m.warehouse_id=v_wh and m.item_id=any(v_items) and m.qty<0 and m.created_at>=gr.created_at
           and m.source not in ('purchase-receipt-void','purchase-invoice-void') order by m.created_at desc limit 10) x;
  b:=b||jsonb_build_array(jsonb_build_object('code','barang_terpakai','message','Barang dari penerimaan ini sudah terpakai atau keluar dari gudang, jadi stoknya tidak bisa ditarik kembali. '||
    'Batalkan dulu transaksi yang memakainya (penjualan, pemakaian, atau pemindahan), atau gunakan Retur Pembelian bila barang dikembalikan ke pemasok. Stok tidak akan pernah dibuat minus diam-diam.',
    'docs','[]'::jsonb,'items',consumed_items,'keluar',outflows));
 end if;
 select coalesce(sum(gi.qty_terima*gi.harga),0) into v_total from public.goods_receipt_items gi where gi.receipt_id=gr.id;
 select count(*),min(e.id::text)::uuid into v_jcount,v_jid from public.journal_entries e where e.source='purchase' and e.source_ref=gr.no_terima;
 if v_total>0 then
  if v_jcount<>1 or exists(select 1 from public.journal_entries e where e.id=v_jid and e.voided_at is not null)
     or (select count(*) from public.journal_lines l where l.entry_id=v_jid)<>2
     or not exists(select 1 from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=v_jid and a.code='170001' and l.debit=v_total and l.credit=0)
     or not exists(select 1 from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=v_jid and a.code='311003' and l.credit=v_total and l.debit=0) then
   unclear:=true;
  end if;
 elsif v_jcount<>0 then unclear:=true;
 end if;
 if unclear then
  b:=b||jsonb_build_array(jsonb_build_object('code','bukti_tidak_cocok','message','Bukti stok atau jurnal penerimaan ini tidak cocok dengan dokumennya, jadi tidak bisa dibatalkan otomatis. Gunakan Retur Pembelian atau minta rekonsiliasi.','docs','[]'::jsonb));
 end if;
 -- Faktur aktif lain di PO ini tidak boleh menagih lebih dari yang tersisa bila penerimaan ini dibatalkan.
 if exists(select 1 from public.purchase_order_items pi where pi.po_id=po.id
    and (select coalesce(sum(ii.qty*ii.faktor),0) from public.purchase_invoice_items ii join public.purchase_invoices i on i.id=ii.invoice_id
         where i.po_id=po.id and i.voided_at is null and ii.po_item_id=pi.id)
        > (coalesce(pi.qty_terima,pi.qty)-coalesce((select sum(gi.qty_terima) from public.goods_receipt_items gi where gi.receipt_id=gr.id and gi.po_item_id=pi.id),0))*pi.faktor) then
  b:=b||jsonb_build_array(jsonb_build_object('code','faktur_menagih_lebih','message','Faktur pembelian aktif di PO ini menagih lebih banyak dari barang yang tersisa bila penerimaan ini dibatalkan. Batalkan atau koreksi fakturnya dulu.','docs','[]'::jsonb));
 end if;
 return jsonb_build_object('receipt_id',gr.id,'no_terima',gr.no_terima,'po_id',po.id,'no_po',po.no_po,'tanggal',gr.tanggal,'already_cancelled',false,
  'can_cancel',jsonb_array_length(b)=0,'blockers',b,'average',v_avg,
  'effects',jsonb_build_object('total',v_total,'stock',stock_lines,'po_status_after','Dipesan'));
end $$;
revoke all on function public.preview_goods_receipt_cancellation(uuid,date) from public,anon,service_role;
grant execute on function public.preview_goods_receipt_cancellation(uuid,date) to authenticated;

-- 5. Buka kembali sisa PO yang sudah ditutup (arsip bukti tutup tidak bisa diubah/dihapus).
create table public.purchase_order_receipt_closure_reopenings (
 id uuid primary key default gen_random_uuid(),
 po_id uuid not null references public.purchase_orders(id),
 branch_id uuid references public.branches(id),
 actor_id uuid not null references public.profiles(id),
 request_key text not null check(length(request_key) between 1 and 120),
 payload jsonb not null,
 reason text not null check(length(btrim(reason)) between 3 and 1000),
 closure jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(actor_id,request_key)
);
alter table public.purchase_order_receipt_closure_reopenings enable row level security;
revoke all on public.purchase_order_receipt_closure_reopenings from public,anon,authenticated,service_role;
grant select(id,po_id,branch_id,actor_id,reason,closure,result,created_at) on public.purchase_order_receipt_closure_reopenings to authenticated;
create policy purchase_order_receipt_closure_reopening_read on public.purchase_order_receipt_closure_reopenings for select to authenticated
 using(exists(select 1 from public.purchase_orders po where po.id=po_id) and (branch_id is null or public.user_can_access_branch(branch_id)));
create function public.guard_po_receipt_reopening_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Bukti pembukaan kembali sisa PO tidak dapat diubah atau dihapus' using errcode='42501'; end $$;
revoke all on function public.guard_po_receipt_reopening_immutable() from public,anon,authenticated,service_role;
create trigger po_receipt_reopening_immutable before update or delete on public.purchase_order_receipt_closure_reopenings
 for each row execute function public.guard_po_receipt_reopening_immutable();
create trigger po_receipt_reopening_no_truncate before truncate on public.purchase_order_receipt_closure_reopenings
 for each statement execute function public.guard_po_receipt_reopening_immutable();

-- Bukti tutup sisa tetap tidak bisa diubah dari klien; hanya fungsi pembuka resmi (pemilik fungsi, bukan peran klien) yang
-- boleh menghapus SATU baris setelah arsipnya tersimpan, lewat tanda sesi lokal transaksi.
do $guard$
declare v text;
begin
 v:=pg_get_functiondef('public.guard_po_receipt_closure_immutable()'::regprocedure);
 v:=pg_temp.patch_once(v,$a$begin raise exception 'Bukti tutup sisa penerimaan tidak dapat diubah atau dihapus'using errcode='42501';end$a$,
  $b$begin
 if tg_op='DELETE' and current_user not in ('authenticated','anon','service_role') and current_setting('vetos.reopen_closure',true)='on' then return old; end if;
 raise exception 'Bukti tutup sisa penerimaan tidak dapat diubah atau dihapus'using errcode='42501';end$b$,'closure guard');
 execute v;
end $guard$;

create function public.reopen_purchase_order_remainder(p_po_id uuid, p_request_key text, p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 po public.purchase_orders%rowtype; cl public.purchase_order_receipt_closures%rowtype; prior public.purchase_order_receipt_closure_reopenings%rowtype;
 v_reason text:=btrim(coalesce(p_reason,'')); payload jsonb; result jsonb; v_complete boolean; v_status text;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 if p_po_id is null or p_request_key is null or p_request_key<>btrim(p_request_key) or length(p_request_key) not between 1 and 120 then
  raise exception 'Identitas pembukaan tidak valid. Muat ulang halaman' using errcode='22023'; end if;
 if length(v_reason) not between 3 and 1000 then raise exception 'Alasan wajib diisi (3 sampai 1.000 karakter)' using errcode='22023'; end if;
 payload:=jsonb_build_object('po_id',p_po_id,'reason',v_reason);
 perform pg_advisory_xact_lock(hashtextextended('purchase-closure-reopen:'||auth.uid()::text||':'||p_request_key,0));
 select * into po from public.purchase_orders where id=p_po_id for update;
 if not found then raise exception 'PO tidak ditemukan'; end if;
 if not public.purchase_cancel_allowed('pembelian.batalkan_penerimaan') then
  raise exception 'Membuka kembali sisa PO hanya oleh Super Admin (OWNER) atau peran yang diberi izin Batalkan penerimaan di Akses Grup' using errcode='42501'; end if;
 perform public.purchase_assert_access('receipt',po.branch_id);
 select * into prior from public.purchase_order_receipt_closure_reopenings where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Kunci pembukaan sudah dipakai dengan rincian berbeda. Muat ulang halaman' using errcode='22023'; end if;
  return prior.result;
 end if;
 select * into cl from public.purchase_order_receipt_closures where po_id=p_po_id for update;
 if not found then raise exception 'Sisa PO ini tidak sedang ditutup. Muat ulang halaman'; end if;
 if po.status='Batal' then raise exception 'PO sudah dibatalkan; tidak ada sisa yang bisa dibuka kembali'; end if;
 perform 1 from public.purchase_order_items where po_id=po.id order by id for update;
 select bool_and(coalesce(qty_terima,0)>=qty) into v_complete from public.purchase_order_items where po_id=po.id;
 v_status:=case when coalesce(v_complete,false) then 'Diterima' else 'Dipesan' end;
 result:=jsonb_build_object('po_id',po.id,'no_po',po.no_po,'status_sebelum',po.status,'status_sesudah',v_status,'closed_at',cl.closed_at,'reopened',true);
 insert into public.purchase_order_receipt_closure_reopenings(po_id,branch_id,actor_id,request_key,payload,reason,closure,result)
  values(po.id,po.branch_id,auth.uid(),p_request_key,payload,v_reason,to_jsonb(cl)-'request_key'-'payload',result);
 perform set_config('vetos.reopen_closure','on',true);
 delete from public.purchase_order_receipt_closures where po_id=po.id;
 perform set_config('vetos.reopen_closure','off',true);
 if v_status<>po.status::text then update public.purchase_orders set status=v_status::public.po_status where id=po.id; end if;
 return result;
end $$;
revoke all on function public.reopen_purchase_order_remainder(uuid,text,text) from public,anon,service_role;
grant execute on function public.reopen_purchase_order_remainder(uuid,text,text) to authenticated;
