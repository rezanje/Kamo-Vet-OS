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

## Implementasi (keputusan Reza: A, 14 Nov 2026) — belum dipasang di Production

Migrasi `supabase/migrations/20261118650000_e2_grup_penjualan_online.sql` (satu transaksi, tambalan jangkar persis pada
definisi live; gagal tanpa perubahan bila definisi berbeda). Cek dulu (read-only): `docs/runbooks/e2-grup-online/01-preflight-readonly.sql`.
Rollback: `docs/runbooks/e2-grup-online/rollback.sql`.

Database:
- `post_online_order` menerima barang Grup: satuan dasar paket saja (satuan lain ditolak "hanya bisa dijual per … (satuan dasar
  paket)"), paket wajib punya isi aktif. Cek stok per barang isi (qty paket × qty isi × faktor isi), digabung dengan baris barang
  biasa yang sama; kekurangan menyebut nama isi, kebutuhan, dan stok. Pesan barang biasa tidak berubah ("Stok tidak cukup").
- Fungsi internal baru `online_post_group_line` (tidak bisa dipanggil klien): satu baris paket di penjualan (harga Shopee = omzet),
  snapshot isi paket (`sale_item_group_components`, sama dengan kasir), stok keluar per isi dari gudang order (sumber `sale-online`,
  FIFO atau moving average), mutasi dihubungkan ke baris paket, HPP isi & HPP paket, jurnal HPP online dari isi.
- `assert_sale_group_cost_links` ikut membaca mutasi online yang terhubung ke baris paket → Batalkan order online berisi paket
  mengembalikan stok tiap isi ke lapisan FIFO asal dan membalik jurnal HPP.
- Retur: order online memang tidak bisa diretur (aturan lama, tidak diubah); koreksi = Batalkan oleh Owner.
- Tidak ada pagar harga minimum (jual di bawah HPP) untuk paket online — sama seperti barang online biasa.

Aplikasi:
- Impor Shopee: barang Grup ikut dicocokkan (SKU Shopee = kode Grup, sama seperti barang biasa; di pilihan barang bertanda
  "(paket)"). Pratinjau menampilkan isi paket, kebutuhan per isi, stok, dan "(kurang)"; peringatan stok isi digabung dengan baris
  lain. Satuan paket tidak bisa diganti. Paket tanpa isi / isi nonaktif memblokir simpan.
- Order Online Baru (manual): paket bisa dipilih seperti barang lain; satuan dibatasi satuan dasar paket.

Tes: `python3 -I scripts/test-e2-grup-online-postgres.py` (41/41; `--baseline` 15/15 kasus fitur RED, 6/6 regresi tetap lulus;
termasuk FIFO, moving average, batal, rollback, dan 7 suite tetangga dengan hasil sama tanpa/dengan migrasi). Vitest impor Shopee.

Cara pakai untuk tim online: buat barang Grup di master untuk tiap bundling (kode = SKU Shopee, isi = barang di dalam bundling),
lalu impor seperti biasa.
