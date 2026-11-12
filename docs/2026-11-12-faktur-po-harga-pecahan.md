# Faktur PO ditolak "Qty dan harga faktur tidak valid" (PO-20261102-DC-0004)

## Laporan
Anisa (12 Nov): PO-20261102-DC-0004 (Toko Obat Era Baru) tidak bisa difakturkan. Muncul
"Qty dan harga faktur tidak valid".

## Penyebab (dicek di Production, baca-saja)
- 2 dari ±100 baris PO punya harga beli lebih dari 2 desimal:
  - Imboost Kids 60Ml — 360 1ML @ Rp 541,666667 → nilai baris 195.000,00012
  - Vitamin C IPI — 225 TAB @ Rp 222,225 → nilai baris 50.000,625
- Pembuatan PO (`create_purchase_order_atomic`) dan revisi PO (`revise_purchase_order`) tidak menolak harga seperti
  itu, padahal koreksi harga PO / edit baris PO sudah membatasi 2 desimal, dan faktur menuntut `qty × harga` tepat sen
  (`create_purchase_invoice_from_po`: "Qty dan harga faktur tidak valid", lalu "Harga atau satuan PO memerlukan
  rekonsiliasi" untuk harga PO-nya).
- Akibatnya PO tersimpan dan diterima (TB.2026.11.00023, 12 Nov), jurnal penerimaan JRN-202611-12222 bernilai
  14.545.999,85512 (tidak bulat sen), lapisan stok 541,666667 & 222,225 — tapi faktur tidak bisa dibuat.
- Hanya PO ini yang kena (cek semua baris PO non-batal di Production). Barang kedua baris belum bergerak sejak diterima.
- Bukan karena "PO diubah": riwayat revisi PO kosong; harga pecahan sudah ada sejak PO dibuat (8 Nov).

## Pencegahan (branch ini)
1. Migrasi `20261117100000_harga_po_maksimal_2_desimal.sql`: trigger `purchase_order_item_price_cents` di
   `purchase_order_items` (insert, atau update saat `harga_beli`/`qty` berubah) menolak harga > 2 desimal dan
   `qty × harga` yang tidak tepat sen. Berlaku untuk semua jalur tulis baris PO. Baris lama yang harganya tidak
   berubah tetap bisa di-update (qty diterima dsb.).
2. Form Buat PO dan Ubah PO: peringatan per baris + tombol simpan nonaktif, pesan mengarahkan ke satuan botol/box.
   Aturan bersama di `src/lib/purchase-price-cents.ts`.

## Hasil uji
- vitest: `src/lib/__tests__/purchase-price-cents.test.ts` + suite pembelian & komponen PO (27 file, 133 tes) lulus.
- `tsc --noEmit` bersih; eslint file yang diubah bersih.
- PostgreSQL 16 native (data fiktif): `test-purchase-order-line-correction-postgres.py` lulus (FIFO & average) dengan
  421 migrasi termasuk migrasi baru; uji trigger terfokus: harga 6/3 desimal & qty pecahan ditolak, harga sen
  diterima, baris lama tetap bisa di-update, baris lama boleh dibetulkan ke 2 desimal.
- Suite `purchase-order-lifecycle`, `purchase-invoice-lifecycle`, `purchase-advance` tidak jalan di container ini
  (butuh Postgres TCP/Docker) — belum diuji.

## Perbaikan data PO-20261102-DC-0004 (BELUM dikerjakan — menunggu harga nota)
Pencegahan tidak membetulkan PO yang sudah terlanjur. Rencana: koreksi langsung terkendali (satu transaksi,
dicatat di `purchase_order_revisions`) untuk 2 baris itu — baris PO, baris penerimaan, lapisan stok & mutasi stok,
jurnal JRN-202611-12222, total PO — mengikuti harga di nota pemasok. Dua pilihan bentuk:
- **Per botol** (bila nota per botol, mis. Imboost 6 BTL, Vitamin C 5 BTL): nilai pas ke rupiah nota. Faktor satuan
  BTL di master sudah ada (60 ml, 45 tab).
- **Per ml/tab dibulatkan** (541,67 & 222,22/222,23): cepat, selisih ± Rp 1 dari nota.
Setelah itu Anisa cukup buka ulang Buat Faktur Pembelian dan simpan.
