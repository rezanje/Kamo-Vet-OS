-- Koreksi data: faktur pembelian langsung FB.2026.11.00031 (DC LOJI, 2026-11-11)
-- Baris "Pasir Markotop 5L" (item 935b1f59…) salah input; seharusnya "Pasir TOP 5ltr" (item 0230e3a6…),
-- qty 18 PCS @ Rp 23.520 (qty & harga tidak berubah). Diminta Reza (owner) atas laporan user klinik.
--
-- Kenapa tidak lewat "Batalkan & siapkan pengganti": 29 detik setelah faktur disimpan, seluruh barang
-- dikirim lewat permintaan PRM-20261110-0011 (DC LOJI -> Transit). Layer FIFO faktur sudah terpakai,
-- jadi pembatalan resmi ditolak ("Stok atau harga sudah berubah setelah faktur").
--
-- Kondisi saat koreksi (diverifikasi): faktur belum dibayar; permintaan berstatus Dikirim, belum diterima
-- cabang; item pengganti belum punya stok/layer/mutasi apa pun; metode FIFO, tanpa cost event average;
-- kedua barang satu kategori (akun persediaan sama) sehingga jurnal JRN-202611-10623 tidak berubah.
--
-- Yang ditukar item_id-nya (nilai, qty, tanggal tetap):
--   purchase_invoice_items 1 baris, stock_moves 3, stock_layers 2, stock 2 (DC LOJI qty 0, Transit qty 18),
--   stock_request_items 1, serta snapshot bukti pembatalan (purchase_invoice_postings.stock_moves,
--   purchase_invoice_layer_proofs.after_state) supaya pembatalan/koreksi resmi tetap konsisten.
-- Payload idempotensi asli (purchase_operations.payload, stock_requests.creation_payload) sengaja dibiarkan
-- sebagai jejak input awal.
do $$
declare
  v_old constant uuid := '935b1f59-2d73-4e11-bd49-4af689b83e30';
  v_new constant uuid := '0230e3a6-55dd-45a3-9ccd-ed12e458f096';
  v_inv constant uuid := 'ede4529c-718d-457c-b17e-43b9646df147';
  v_req constant uuid := '416a4111-8fe4-4893-821b-95de2c0b93ec';
  n int;
begin
  perform 1 from purchase_invoices where id=v_inv and voided_at is null and revision=0 for update;
  if not found then raise exception 'Faktur berubah'; end if;
  if coalesce((select sum(amount) from purchase_invoice_payments where invoice_id=v_inv),0)<>0 then raise exception 'Faktur sudah dibayar'; end if;
  perform 1 from stock_requests where id=v_req and status='Dikirim' for update;
  if not found then raise exception 'Status permintaan berubah'; end if;
  if exists(select 1 from stock_request_items where request_id=v_req and qty_diterima is not null) then raise exception 'Sudah diterima cabang'; end if;
  if exists(select 1 from stock where item_id=v_new) or exists(select 1 from stock_layers where item_id=v_new)
     or exists(select 1 from stock_moves where item_id=v_new) then raise exception 'Item pengganti sudah punya stok'; end if;
  if (select count(*) from stock_moves where item_id=v_old)<>3 then raise exception 'Mutasi item lama bertambah'; end if;

  update purchase_invoice_items set item_id=v_new, nama='Pasir TOP 5ltr'
   where id='78857322-97e5-424a-824e-571e7c1a8e65' and invoice_id=v_inv and item_id=v_old;
  get diagnostics n=row_count; if n<>1 then raise exception 'invoice item %',n; end if;

  update stock_moves set item_id=v_new where item_id=v_old and id in
   ('1716e5e1-60e0-4df0-850d-8c095c134fc8','68fcc0d6-7dc6-4d7c-8f63-663a3fd3c381','6a6b6e6e-eb4a-4217-aac8-f782e7f73c6b');
  get diagnostics n=row_count; if n<>3 then raise exception 'moves %',n; end if;

  update stock_layers set item_id=v_new where item_id=v_old and id in
   ('2fcfede5-462d-4bde-9a20-61550306f22d','57c1b6ff-7391-4c4c-8711-d41e7cf1bab8');
  get diagnostics n=row_count; if n<>2 then raise exception 'layers %',n; end if;

  update stock set item_id=v_new, updated_at=updated_at where item_id=v_old and id in
   ('8a517c1a-e7d7-48ae-9424-fd0ab5542869','decf1d06-7126-4071-8c33-b20e2563d665');
  get diagnostics n=row_count; if n<>2 then raise exception 'stock %',n; end if;

  update stock_request_items set item_id=v_new, nama='Pasir TOP 5ltr'
   where id='3096dbf2-acb5-40b2-85be-76f76efa4de8' and request_id=v_req and item_id=v_old;
  get diagnostics n=row_count; if n<>1 then raise exception 'request item %',n; end if;

  update purchase_invoice_postings set stock_moves=replace(stock_moves::text, v_old::text, v_new::text)::jsonb
   where invoice_id=v_inv;
  get diagnostics n=row_count; if n<>1 then raise exception 'posting %',n; end if;

  update purchase_invoice_layer_proofs set after_state=replace(after_state::text, v_old::text, v_new::text)::jsonb
   where invoice_id=v_inv and layer_id='2fcfede5-462d-4bde-9a20-61550306f22d';
  get diagnostics n=row_count; if n<>1 then raise exception 'proof %',n; end if;

  -- Konsistensi bukti: layer sekarang == after_state tersimpan (kecuali qty_left yang memang sudah terpakai).
  if (select to_jsonb(l)-'qty_left' from stock_layers l where id='2fcfede5-462d-4bde-9a20-61550306f22d')
     is distinct from ((select after_state from purchase_invoice_layer_proofs where layer_id='2fcfede5-462d-4bde-9a20-61550306f22d' and invoice_id=v_inv)-'qty_left')
  then raise exception 'Bukti layer tidak konsisten'; end if;
  if (select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from stock_moves m where source='faktur-langsung' and source_ref='FB.2026.11.00031')
     is distinct from (select stock_moves from purchase_invoice_postings where invoice_id=v_inv)
  then raise exception 'Snapshot mutasi faktur tidak konsisten'; end if;
end $$;
