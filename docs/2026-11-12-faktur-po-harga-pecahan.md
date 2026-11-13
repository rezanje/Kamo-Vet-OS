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

## Perbaikan data PO-20261102-DC-0004 (SUDAH, Production, 13 Nov)
Reza memilih opsi "per botol". Harga per botol diturunkan dari isian awal (541,666667 × 60 = 32.500,00002;
222,225 × 45 = 10.000,125) → **Imboost 6 BTL @ 32.500**, **Vitamin C IPI 5 BTL @ 10.000** — perlu dicocokkan ke nota.
- Satu blok transaksi, didahului uji kering (di-rollback) yang lolos semua trigger penjaga. Setiap UPDATE dikunci ke nilai
  lama (gagal bila data bergeser) dan memeriksa tepat 1 baris.
- Diubah: 2 baris `purchase_order_items` (qty 6/5, qty_terima 6/5, satuan BTL, faktor 60/45, harga), 2 baris
  `goods_receipt_items` (qty, harga, satuan, batches), 2 lapisan `stock_layers` + 2 `stock_moves` (unit_cost =
  harga/faktor, qty dasar tetap 360/225), `purchase_orders.total` 14.545.999,85512 → 14.545.999,23 (revisi +1),
  jurnal JRN-202611-12222 debit/kredit ke 14.545.999,23. Jejak: 1 baris `purchase_order_revisions` (before/after, alasan).
- Barang kedua baris belum bergerak dari lapisan PO (pemakaian sejak 12 Nov ada di gudang klinik lain).
- Verifikasi sesudah: 108 baris PO, 0 harga/nilai bukan sen, 0 faktor tidak cocok master, total PO = nilai terima = jurnal.

## Penghalang kedua: barang PO sudah dikirim ke klinik sebelum difakturkan
Simulasi faktur (di-rollback) sesudah perbaikan data masih ditolak: "Stok PO sudah terpakai atau asal biaya tidak
lengkap". 10 baris PO ini (mis. Needle 26 habis via PRM-20261112-0002, alkohol, Bioplacenton, Nephrolit …) sudah sebagian
dikirim lewat Permintaan Barang. `create_purchase_invoice_from_po` menuntut seluruh qty faktur masih utuh di lapisan
penerimaan, padahal lapisan hanya perlu dinilai ulang bila harga faktur ≠ harga PO. 6 PO lain (Production, 13 Nov) dalam
keadaan serupa: PO-20261109-DC-0001, PO-20261109-VET_GRLG-0001, PO-20261109-VET_CMGG-0002, PO-20261107-VET_CMS-0002,
PO-20261105-VET_CMS-0001.

Perbaikan: migrasi `20261117110000_faktur_po_stok_terpakai_harga_sama.sql` (tambalan berjangkar satu baris):
- Sisa qty tanpa lapisan utuh diterima bila **biaya baru = biaya PO** dan qty_in lapisan PO ≥ qty faktur. Lapisan utuh
  tetap dialokasikan seperti dulu. Jurnal: GRNI → hutang dengan nilai sama, nilai persediaan/HPP tidak berubah.
- Harga beda + barang sudah keluar tetap ditolak, dengan nama barang dan arahan (simpan harga PO, koreksi selisih).
- Uji: `supabase/tests/faktur_po_stok_terpakai.sql` + runner `scripts/test-faktur-po-stok-terpakai-postgres.py`
  (GREEN/RED + suite tetangga dengan vs tanpa kandidat).

Hasil (PostgreSQL 16 native, 422 migrasi, data fiktif):
- GREEN lulus; RED (tambalan dibalik + trigger dilepas) gagal dengan pesan lama → tes memang menguji perilaku baru.
- Suite tetangga identik dengan vs tanpa kandidat. Lulus kedua arah: goods_receipt_cancellation, n01_purchase_invoice_receipts,
  purchase_invoice_line_correction, purchase_order_line_correction, average_purchase_corrections (disusun seperti runner
  aslinya), purchase_short_close, purchase_correction_requests. Gagal **sama** di kedua arah karena kebutuhan harness
  masing-masing (bukan kandidat): purchase_order_lifecycle, purchase_invoice_lifecycle, purchase_recovery — artinya
  suite faktur-lifecycle penuh belum terbukti di harness ini.
- Simulasi di Production (satu blok, tambalan dipasang lalu di-rollback lewat RAISE): faktur seluruh 108 baris PO-20261102-DC-0004
  tersimpan, total 14.545.999,23, jurnal D = K = 14.545.999,23. Dicek sesudahnya: aturan lama masih berlaku, 0 faktur
  tercipta, nomor simulasi tidak terpakai.

## Status Production (13 Nov)
- Perbaikan data PO: **sudah**.
- Migrasi `20261117100000` (harga 2 desimal) dan `20261117110000` (faktur saat barang sudah keluar): **belum dipasang**,
  menunggu persetujuan Reza. Sampai dipasang, PO ini (dan 6 PO serupa) masih ditolak saat difakturkan.
