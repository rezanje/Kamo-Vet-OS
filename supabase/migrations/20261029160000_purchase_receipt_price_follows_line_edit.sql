-- Edit baris PO: harga di dokumen Penerimaan Barang ikut harga diterima yang dikoreksi.
--
-- Simulasi 28 Okt: setelah koreksi 40 -> 35 tube @180.000, PO dan faktur Rp 6.300.000 tetapi daftar
-- penerimaan masih 35 x 187.545 = Rp 6.564.075 (harga PO lama). Hanya fungsi privat edit baris PO yang
-- berubah: satu update harga rincian penerimaan aktif untuk baris yang dikoreksi. Tidak ada data diubah
-- saat migrasi; belum ada koreksi baris PO di produksi (preflight 28 Okt: 0 koreksi faktur).

create or replace function public.purchase_order_line_correction_run(
 p_po_item_id uuid,p_qty numeric,p_qty_terima numeric,p_harga numeric,p_tanggal date,p_reason text,
 p_request_key text,p_payload jsonb,p_preview boolean
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare
 po public.purchase_orders%rowtype;pi public.purchase_order_items%rowtype;ii public.purchase_invoice_items%rowtype;inv public.purchase_invoices%rowtype;
 v_path text;v_count integer;v_new_qty numeric;v_new_terima numeric;v_removed numeric;v_total numeric;v_old_total numeric;advances numeric;
 v_status text;closed date;inv_result jsonb;audit_id uuid:=gen_random_uuid();before_value jsonb;result jsonb;v_po_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then
  raise exception 'Edit baris PO hanya oleh Super Admin (OWNER)' using errcode='42501';end if;
 if p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then raise exception 'Alasan perubahan wajib diisi (minimal 3 huruf)';end if;
 if p_tanggal is null or not isfinite(p_tanggal) or p_tanggal>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal koreksi tidak valid atau di masa depan';end if;
 if p_harga is null or p_harga::text in ('NaN','Infinity','-Infinity') or p_harga<0 or p_harga>1e12 or p_harga<>round(p_harga,2) then
  raise exception 'Harga harus angka 0 atau lebih, maksimal 2 angka desimal';end if;

 select l.po_id into v_po_id from public.purchase_order_items l where l.id=p_po_item_id;
 if not found then raise exception 'Baris PO tidak ditemukan';end if;
 -- Urutan kunci sama dengan penerimaan/faktur/pembatalan: PO -> baris PO -> faktur -> stok -> lapisan.
 select * into po from public.purchase_orders where id=v_po_id for update;
 perform 1 from public.purchase_order_items where po_id=po.id order by id for update;
 select * into pi from public.purchase_order_items where id=p_po_item_id;
 perform public.purchase_assert_access('receipt',po.branch_id);
 if po.status='Batal' then raise exception 'PO sudah dibatalkan';end if;
 if exists(select 1 from public.purchase_order_receipt_closures where po_id=po.id) then
  raise exception 'Sisa PO ini sudah ditutup. Baris tidak bisa diedit lagi; gunakan Retur Pembelian atau PO baru';end if;
 if exists(select 1 from public.purchase_returns where po_id=po.id and voided_at is null) then
  raise exception 'PO ini punya retur pembelian aktif. Selesaikan lewat Retur Pembelian';end if;
 v_old_total:=po.total;
 before_value:=jsonb_build_object('mode','line','po',to_jsonb(po),'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.purchase_order_items i where i.po_id=po.id));

 if coalesce(pi.qty_terima,0)=0 and coalesce(pi.qty_rusak,0)=0 then
  -- ===== Belum diterima: Qty PO dan harga langsung =====
  v_path:='unreceived';
  if p_qty is null or p_qty::text in ('NaN','Infinity','-Infinity') or p_qty<=0 or p_qty>1e9 or p_qty*p_harga<>round(p_qty*p_harga,2) then
   raise exception 'Qty PO harus lebih dari 0';end if;
  if po.status not in ('Draft','Dipesan') then raise exception 'PO sudah selesai; baris yang belum diterima tidak bisa diubah langsung';end if;
  select closed_until into closed from public.accounting_locks where id for share;
  if closed is not null and po.tanggal<=closed then raise exception 'Periode PO sudah ditutup';end if;
  if p_qty=pi.qty and p_harga=pi.harga_beli then raise exception 'Tidak ada perubahan qty atau harga';end if;
  v_new_qty:=p_qty;v_new_terima:=0;v_removed:=0;
 else
  -- ===== Sudah diterima: koreksi lewat faktur, lalu PO ikut =====
  v_path:='invoice';
  if p_qty_terima is null or p_qty_terima::text in ('NaN','Infinity','-Infinity') or p_qty_terima<=0 then
   raise exception 'Qty diterima harus lebih dari 0. Untuk membatalkan seluruh penerimaan gunakan Batalkan faktur lalu Batalkan penerimaan';end if;
  if p_qty_terima>pi.qty_terima then
   raise exception 'Qty diterima hanya bisa dikurangi. Barang tambahan dicatat lewat Terima barang atau PO baru';end if;
  select count(*) into v_count from public.purchase_invoice_items x join public.purchase_invoices i on i.id=x.invoice_id
   where i.po_id=po.id and i.voided_at is null and x.po_item_id=pi.id;
  if v_count=0 then
   raise exception 'Barang ini sudah diterima tetapi belum ada faktur. Buat Faktur Pembelian dari PO ini dulu, lalu koreksi lewat Edit';end if;
  if v_count>1 then raise exception 'Barang ini ditagih di lebih dari satu faktur. Koreksi lewat masing-masing faktur';end if;
  select x.* into ii from public.purchase_invoice_items x join public.purchase_invoices i on i.id=x.invoice_id
   where i.po_id=po.id and i.voided_at is null and x.po_item_id=pi.id;
  select * into inv from public.purchase_invoices where id=ii.invoice_id;
  if coalesce(nullif(ii.faktor,0),1)<>coalesce(nullif(pi.faktor,0),1) or ii.qty<>pi.qty_terima then
   raise exception 'Faktur hanya menagih sebagian barang yang diterima. Koreksi lewat faktur %',inv.no_faktur;end if;
  -- Keputusan pemilik: faktur yang sudah dibayar tidak dikoreksi dari sini.
  if exists(select 1 from public.purchase_invoice_payments where invoice_id=inv.id and reversal_of is null and voided_at is null)
   or coalesce((select sum(amount) from public.purchase_invoice_payments where invoice_id=inv.id),0)<>0 then
   raise exception 'Faktur % sudah dibayar (termasuk dari uang muka). Batalkan pembayarannya dulu, baru edit baris ini',inv.no_faktur;end if;
  if exists(select 1 from public.payment_order_items b join public.payment_orders o on o.id=b.order_id where b.invoice_id=inv.id and o.status in ('draft','disetujui')) then
   raise exception 'Faktur % sedang dipesan perintah pembayaran. Batalkan atau ubah perintah bayarnya dulu',inv.no_faktur;end if;
  v_removed:=pi.qty_terima-p_qty_terima;
  if v_removed>0 and (select count(*) from public.goods_receipt_items gi join public.goods_receipts g on g.id=gi.receipt_id
    where g.voided_at is null and gi.po_item_id=pi.id and gi.qty_terima>0)<>1 then
   raise exception 'Barang ini diterima di lebih dari satu penerimaan. Koreksi jumlahnya lewat Retur Pembelian';end if;
  if p_qty_terima=pi.qty_terima and p_harga=ii.harga and p_harga=pi.harga_beli then
   raise exception 'Tidak ada perubahan qty atau harga';end if;
  if p_qty_terima<>ii.qty or p_harga<>ii.harga then
   inv_result:=public.purchase_invoice_line_correction_run(ii.id,p_qty_terima,p_harga,p_tanggal,
    'Edit baris PO '||coalesce(po.no_po,'')||': '||btrim(p_reason),'po-line:'||p_request_key,p_payload,false,true);
  end if;
  if v_removed>0 then
   update public.goods_receipt_items gi set qty_terima=gi.qty_terima-v_removed
    from public.goods_receipts g where g.id=gi.receipt_id and g.voided_at is null and gi.po_item_id=pi.id and gi.qty_terima>0;
  end if;
  -- Dokumen penerimaan ikut harga diterima yang benar, supaya nilai penerimaan = PO = faktur.
  update public.goods_receipt_items gi set harga=p_harga
   from public.goods_receipts g where g.id=gi.receipt_id and g.voided_at is null and gi.po_item_id=pi.id and gi.harga<>p_harga;
  -- Qty PO turun sebanyak barang yang dikeluarkan; sisa yang masih ditunggu (bila ada) tetap.
  -- greatest(): PO yang diterima lebih dari pesanan ikut turun ke qty diterima baru.
  v_new_qty:=greatest(pi.qty-v_removed,p_qty_terima);v_new_terima:=p_qty_terima;
 end if;

 update public.purchase_order_items set qty=v_new_qty,qty_terima=case when v_path='invoice' then v_new_terima else qty_terima end,harga_beli=p_harga where id=pi.id;
 select coalesce(sum(qty*harga_beli),0) into v_total from public.purchase_order_items where po_id=po.id;
 if v_total<=0 or v_total<>round(v_total,2) then raise exception 'Total PO harus positif dan maksimal 2 angka desimal';end if;
 -- Kapasitas DP: sama dengan koreksi harga PO, total tidak boleh turun di bawah DP aktif.
 insert into public.purchase_advance_capacity_locks(po_id) values(po.id) on conflict(po_id) do update set epoch=public.purchase_advance_capacity_locks.epoch+1;
 -- Bukti DP sama dengan koreksi harga PO (revise_purchase_order_prices).
 if exists(select 1 from public.purchase_advances where po_id=po.id and(status='batal' and not public.purchase_advance_refund_proven(id)
  or status='aktif' and(jumlah is null or jumlah<=0 or jumlah::text in('NaN','Infinity','-Infinity') or jumlah<>round(jumlah,2) or coalesce(terpakai,0)<>0))) then
  raise exception 'Bukti atau alokasi uang muka PO ini perlu direkonsiliasi dulu sebelum mengubah total PO';end if;
 select coalesce(sum(jumlah),0) into advances from public.purchase_advances where po_id=po.id and status='aktif';
 if v_total<advances then raise exception 'Total PO baru Rp % lebih kecil dari uang muka aktif Rp %. Batalkan uang mukanya dulu',
  to_char(v_total,'FM999G999G999G990D00'),to_char(advances,'FM999G999G999G990D00') using errcode='22003';end if;
 v_status:=case when po.status='Draft' then 'Draft' when (select bool_and(coalesce(qty_terima,0)>=qty) from public.purchase_order_items where po_id=po.id) then 'Diterima' else 'Dipesan' end;
 update public.purchase_orders set total=v_total,status=v_status::public.po_status,revision=revision+1 where id=po.id;
 insert into public.purchase_order_revisions(id,purchase_order_id,branch_id,action,reason,before_value,after_value,created_by)
 values(audit_id,po.id,po.branch_id,'edit',btrim(p_reason),before_value,
  jsonb_build_object('mode','line','po_item_id',pi.id,'po',(select to_jsonb(p) from public.purchase_orders p where id=po.id),
   'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.purchase_order_items i where i.po_id=po.id),'invoice',inv_result),auth.uid());

 result:=jsonb_build_object('po_id',po.id,'po_item_id',pi.id,'nama',pi.nama,'satuan',pi.satuan,'path',v_path,'revision',po.revision+1,'revision_id',audit_id,
  'action','edit','mode','line','tanggal',p_tanggal,
  'old_qty',pi.qty,'new_qty',v_new_qty,'old_qty_terima',coalesce(pi.qty_terima,0),'new_qty_terima',case when v_path='invoice' then v_new_terima else coalesce(pi.qty_terima,0) end,
  'old_harga',pi.harga_beli,'new_harga',p_harga,'old_total',v_old_total,'total',v_total,'old_status',po.status,'status',v_status,
  'invoice',inv_result,
  'no_faktur',inv.no_faktur,'old_harga_faktur',ii.harga,
  'removed_qty',round(coalesce((inv_result->>'removed_qty')::numeric,0),6),'sold_qty',round(coalesce((inv_result->>'sold_qty')::numeric,0),6),
  'remaining_qty',round(coalesce((inv_result->>'remaining_qty')::numeric,0),6),
  'removed_qty_base',coalesce((inv_result->>'removed_qty_base')::numeric,0),'sold_qty_base',coalesce((inv_result->>'sold_qty_base')::numeric,0),'ap_delta',coalesce((inv_result->>'ap_delta')::numeric,0),
  'ppn_delta',coalesce((inv_result->>'ppn_delta')::numeric,0),'inventory_delta',coalesce((inv_result->>'inventory_delta')::numeric,0),
  'hpp_delta',coalesce((inv_result->>'hpp_delta')::numeric,0));
 if p_preview then raise exception using errcode='VP004',message='purchase-po-line-preview',detail=result::text;end if;
 insert into public.purchase_order_requests(actor_id,request_key,purchase_order_id,payload,result,branch_id)
 values(auth.uid(),p_request_key,po.id,p_payload,result,po.branch_id);
 return result;
end$$;
revoke all on function public.purchase_order_line_correction_run(uuid,numeric,numeric,numeric,date,text,text,jsonb,boolean) from public,anon,authenticated,service_role;
