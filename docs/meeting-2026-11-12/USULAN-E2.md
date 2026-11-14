# E2 — Bundling / promo paket di impor Shopee (usulan, 14 Nov 2026)

P2. Menyentuh posting stok penjualan online → **menunggu keputusan Reza**. Belum ada perubahan kode/database.

## Kondisi sekarang
- Kasir petshop sudah mendukung **barang Grup** (produk virtual berisi resep komponen; harga di baris Grup, stok & HPP dari
  komponennya).
- Penjualan online (Impor Shopee dan Penjualan Online → Baru) **menolak barang Grup** di database ("Grup tidak didukung pada
  online"). Jadi paket Shopee (mis. "Bundling 2 pcs + mangkok") sekarang harus dipecah manual atau dicocokkan ke satu barang saja.

## Pilihan
- **A (saran): pakai barang Grup yang sudah ada.** Buat Grup di master untuk tiap bundling Shopee (SKU Shopee = kode Grup), lalu
  impor mencocokkan SKU ke Grup seperti barang biasa. Saat disimpan, stok komponen keluar dari gudang cabang (aturan E4) dengan
  HPP komponen; omzet tetap satu baris bundling sesuai harga Shopee. Perlu ubah fungsi posting online (ikut cara kasir) +
  pratinjau impor menampilkan isi paket & cek stok komponen. Retur online untuk Grup ikut dikembalikan per komponen.
- **B: pecah di layar impor tanpa ubah database.** Admin memilih komponen untuk baris bundling dan harga dibagi otomatis
  (proporsional harga jual). Cepat, tapi laporan penjualan per barang memecah harga paket dan rawan beda tiap admin.
- **C: tunda** sampai pola bundling Shopee yang sering dipakai jelas (minta contoh 3–5 paket dari tim online).

Pertanyaan: bundling Shopee biasanya tetap (isi selalu sama) atau berubah-ubah per kampanye? Kalau tetap → A paling rapi.
