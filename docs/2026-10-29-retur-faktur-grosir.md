# Retur Faktur Penjualan grosir (N01/J01) — catatan teknis

Keputusan pemilik 29 Okt 2026: dokumen retur untuk Faktur Penjualan grosir/B2B, terikat ke satu
faktur grosir terposting. Retur struk kasir (`sales_returns`) tidak berubah.

## Dokumen dan alur

- Migrasi `supabase/migrations/20261101130000_n01_retur_faktur_grosir.sql`.
- Tabel `wholesale_returns` (+ `wholesale_return_items`), nomor `RJG.{YYYY}.{MM}.#####` (bisa diatur di
  Pengaturan → Penomoran Dokumen, jenis `RJG`). Kolom baru `sales_invoices.returned_ar`.
- RPC `post_wholesale_return(request_key, invoice_id, tanggal, warehouse_id, alasan, items)`:
  OWNER/ADMIN/FINANCE aktif + akses modul Penjualan + akses cabang faktur (sama dengan penerimaan grosir).
  Hanya faktur dari pesanan (bukan saldo awal, bukan selisih opname), belum batal/diganti.
  Qty per baris ≤ qty faktur − retur aktif. Barang persediaan masuk ke gudang pilihan (cabang faktur)
  lewat `stock_in_fifo` pada HPP asal baris faktur (alokasi pengiriman), dibulatkan kumulatif per baris.
- Jurnal `wholesale-return` (satu jurnal, seimbang): Dr 4101 bruto, Cr 4102 diskon, Dr 2201 PPN,
  Cr 1201 bagian yang mengurangi sisa piutang, Cr 2103 sisanya sebagai kredit pelanggan (mekanisme kredit
  grosir yang sama dengan koreksi J01), Dr 1301 / Cr 5101 modal yang kembali. Nilai bruto/diskon/PPN
  kumulatif terhadap jurnal faktur → retur seluruh qty = pembalik persis faktur.
- `void_wholesale_return(return_id, revision, request_key, alasan)`: OWNER/FINANCE (setara koreksi J01).
  Ditolak bila lapisan stok retur sudah tersentuh. Lapisan dinolkan, mutasi `wholesale-return-void` pada
  harga asal (moving average memperlakukannya seperti pembatalan penerimaan), jurnal dibalik dengan jurnal
  `wholesale-return-void`, `returned_ar` dan status lunas dihitung ulang.
- Idempoten per (aktor, kunci) di `wholesale_operation_requests` jenis `return`/`return-void`;
  "Periksa hasil terakhir" lewat `get_wholesale_operation`.
- Kunci: pesanan → faktur (→ retur), sama dengan penerimaan/koreksi grosir.

## Pengaman yang ikut berubah

- `receive_wholesale_payment` dan `cancel_wholesale_receipt` memperhitungkan `returned_ar` (jangkar eksak).
- Trigger: faktur dengan retur aktif tidak bisa berstatus batal (koreksi harga, edit baris, batal tagihan).
- Tulisan langsung klien ke dokumen retur, `returned_ar`, jurnal/mutasi/lapisan bersumber retur ditolak.
- A01: kedua tabel terdaftar di `activity_log_sources` + trigger change/delete.

## Tautan dokumen

- Faktur → retur: bagian "Retur penjualan" di halaman faktur, `DocumentLink` jenis `sales-return-wholesale`
  dari `wholesale_returns.invoice_id`. Retur → faktur: `RelatedDocuments` dari kolom yang sama.
- Rute: `/penjualan/retur-grosir`, `/penjualan/retur-grosir/[id]`, `/penjualan/retur-grosir/baru?faktur=…`.

## Laporan

- Omzet kanal Grosir (#317): `tarikTransaksi` (transaksi per cabang/hari) dan Penjualan Rinci mengurangi
  total retur aktif dari faktur sumbernya (tanpa batas tanggal retur, sama dengan retur struk kasir),
  berdampingan dengan pengurangan refund klinik (R02/J03) pada invoice asalnya.
- Sisa piutang (faktur, daftar Faktur Penjualan, Piutang, Laporan Penjual, dashboard) dan buku pembantu
  piutang ikut `returned_ar`. Kredit pelanggan dari retur tampil di daftar kredit Faktur Penjualan.

## Belum dikerjakan / batasan

- Laporan Penjualan per Barang tidak mengurangi retur (retur struk kasir juga belum), riwayat akuisisi/
  retensi dan total penjualan dashboard memakai nilai faktur bruto.
- Komisi penjual grosir tidak dikurangi retur dan epoch penggajian tidak dinaikkan oleh retur — perlu
  keputusan pemilik bila komisi harus bersih setelah retur.
- Kredit pelanggan (2103) belum bisa dipakai otomatis untuk melunasi faktur lain atau dikembalikan; sama
  dengan kredit dari koreksi J01, penyelesaiannya ditinjau keuangan.
- Registry A01 kini 203 sumber (201 + dua tabel retur); `activity_audit_coverage.sql` mengecualikan
  secara eksplisit jejak koreksi `stock_request_shipment_cancellations` (#320) dan
  `clinic_payment_corrections`/`clinic_payment_correction_requests` (J02).

## Verifikasi

`python3 scripts/test-wholesale-returns-postgres.py --pg-bin /usr/lib/postgresql/16/bin`
(atau tanpa `--pg-bin` untuk Docker): suite `supabase/tests/wholesale_returns.sql`, regresi
`sales_safe_posting.sql` + `wholesale_corrections.sql`, dan balapan dua sesi.
