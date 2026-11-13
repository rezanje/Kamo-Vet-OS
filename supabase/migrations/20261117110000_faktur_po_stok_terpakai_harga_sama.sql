-- Faktur dari PO tetap bisa disimpan walau sebagian barang PO sudah terpakai / dikirim ke cabang,
-- ASALKAN harga faktur sama dengan harga PO (biaya per satuan dasar tidak berubah).
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).
--
-- Latar (13 Nov, PO-20261102-DC-0004): DC menerima barang lalu langsung mengirimnya ke klinik lewat Permintaan Barang.
-- create_purchase_invoice_from_po menuntut seluruh qty faktur masih utuh di lapisan stok penerimaan
-- ("Stok PO sudah terpakai atau asal biaya tidak lengkap"), padahal lapisan itu hanya perlu disentuh bila biaya
-- berubah. Bila harga faktur = harga PO: GRNI dibalik ke hutang dengan nilai yang sama, nilai persediaan dan HPP yang
-- sudah tercatat tetap benar, jadi barang yang sudah keluar tidak perlu dinilai ulang.
--
-- Aturan baru (satu tambalan berjangkar pada definisi yang berjalan, fungsi lain tidak disentuh):
--  * Lapisan yang masih utuh tetap dialokasikan seperti sebelumnya (bukti lapisan & pembatalan faktur tidak berubah).
--  * Sisa qty yang tidak punya lapisan utuh hanya diterima bila biaya baru = biaya PO DAN barang memang pernah masuk dari
--    PO ini sebanyak itu (jumlah qty_in lapisan PO >= qty faktur). Selain itu tetap ditolak, kini dengan penjelasan.
--  * Harga beda + barang sudah keluar tetap ditolak (perlu koreksi HPP; belum otomatis).
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtextextended('vetos:faktur-po-stok-terpakai',0));

create function pg_temp.patch_once(p_def text, p_old text, p_new text, p_label text) returns text
language plpgsql as $$
declare n integer;
begin
 n:=(length(p_def)-length(replace(p_def,p_old,'')))/length(p_old);
 if n<>1 then raise exception 'FAKTUR_PO_TERPAKAI_ANCHOR % ditemukan % kali (seharusnya 1); migrasi dihentikan',p_label,n; end if;
 return replace(p_def,p_old,p_new);
end $$;

do $patch$
declare v text;
begin
 v:=pg_get_functiondef('public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid)'::regprocedure);
 v:=pg_temp.patch_once(v,
  $a$  if remaining>0 then raise exception 'Stok PO sudah terpakai atau asal biaya tidak lengkap. Rekonsiliasi sebelum faktur';end if;$a$,
  $b$  if remaining>0 and (r.new_cost<>r.old_cost
    or (select coalesce(sum(l.qty_in),0) from public.stock_layers l where l.warehouse_id=po.to_warehouse_id and l.item_id=r.item_id and l.source='purchase' and l.source_ref=po.no_po and l.unit_cost=r.old_cost)<r.qty) then
   raise exception 'Sebagian barang ini (%) sudah terpakai atau dikirim sebelum difakturkan, jadi harga fakturnya harus sama dengan harga PO. Simpan dengan harga PO, selisih harga dicatat lewat koreksi',
    (select i.nama from public.purchase_order_items i where i.po_id=p_po_id and i.item_id=r.item_id order by i.id limit 1);
  end if;$b$,'remaining check');
 execute v;
end $patch$;
