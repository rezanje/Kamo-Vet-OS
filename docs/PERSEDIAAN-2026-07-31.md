# Persediaan — tindak lanjut masukan klien (2026-07-31)

Sumber: masukan Aldi Saputra soal menu persediaan. Tiga hal yang belum ada
dikerjakan di sini; sisanya sudah jalan sejak migrasi 0063/0058.

## Yang sudah ada sebelum ini (tidak diubah)

- **Satuan berjenjang** (`item_units`, migrasi 0063). `items.unit` = satuan dasar
  & satu-satunya satuan stok; turunan punya faktor + harga sendiri.
- **HPP FIFO** dari penerimaan nyata (`stock_layers`, migrasi 0058).
  `items.buy_price` **bukan** HPP — cuma acuan PO.
- **Akun perkiraan** otomatis lewat `lib/posting.ts` (COA per transaksi).
- **Stok per gudang** (`/pos/stok`) & **Pemindahan Barang** (`/pos/pemindahan`).

## 1. Harga jual per cabang — migrasi 0073

Tabel `item_branch_prices (item_id, branch_id, unit, sell_price)` menyimpan
**hanya pengecualian**. Tidak ada baris = cabang ikut harga pusat
(`items.sell_price` / `item_units.sell_price`). Dipilih begini supaya tidak
lahir ribuan baris kembar untuk barang × cabang yang harganya sebenarnya sama.

- Menu baru: `/pos/harga` (Persediaan → Harga Jual). Pilih "Semua Cabang" untuk
  mengubah harga pusat, atau satu cabang untuk mengisi pengecualian. Kolom
  dikosongkan = pengecualian dihapus.
- Resolusi harga: `lib/harga-cabang.ts` (`loadHargaCabang`, `hargaCabang`,
  `applyHargaCabang`).
- Dipasang di: kasir petshop (`/kasir`), POS admin (`/pos/transaksi`), rekam
  medis, catatan rawat inap.
- **Harga ditetapkan ulang di server** saat checkout (`kasir/checkout.ts`,
  `pos/transaksi/actions.ts`) — layar yang sudah lama terbuka tidak boleh
  menentukan harga sendiri.
- Tidak dipasang di penjualan online: harganya memang diketik bebas per order
  (harga marketplace ≠ harga toko).

## 2. Kartu stok / mutasi barang — migrasi 0074

Tabel `stock_moves`: satu baris per mutasi, `qty` positif masuk / negatif
keluar, selalu dalam satuan dasar. Ditulis dari `lib/inventory.ts`
(`stockIn`/`stockOut`) — satu-satunya pintu mutasi stok di repo ini, jadi tidak
ada mutasi yang lolos tanpa jejak.

- Menu baru: `/pos/kartu-stok`. Filter barang + gudang + rentang tanggal;
  menampilkan saldo awal, riwayat masuk/keluar dengan saldo berjalan, dan
  saldo per gudang pada tanggal akhir.
- Perhitungan saldo: `lib/kartu-stok.ts` (dites di `kartu-stok.test.ts`).
- Gagal mencatat jejak **tidak** membatalkan mutasinya — stok benar lebih
  penting daripada kartu stok lengkap; kegagalan muncul di log server.
- Riwayat mulai dari migrasi ini: stok yang sudah ada masuk sebagai satu baris
  `saldo-awal`. Mutasi sebelum ini memang tidak pernah tercatat.

## 3. Reminder stok minimum + PO otomatis — migrasi 0075

`items.min_stock` sudah ada sejak 0001 tapi angkanya tidak pernah dibandingkan
dengan stok nyata. Kolom baru di `items`:

| kolom | guna |
|---|---|
| `supplier_id` | pemasok utama → satu draft PO per pemasok |
| `buy_unit` | satuan saat memesan (box/dus) |
| `min_buy` | minimum pesan pemasok, jadi lantai qty usulan |
| `min_sell_qty` | minimum jual per transaksi |
| `default_discount` | diskon default (%) saat masuk keranjang |
| `substitute_item_id` | barang pengganti saat stok kosong |

- Menu baru: `/pos/stok-minimum` (Persediaan → Barang Stok Minimum). Menampilkan
  barang di bawah batas, dikelompokkan per pemasok, dengan usulan qty; tombol
  membuat **draft** PO (bukan langsung "Dipesan" — angka usulan tetap harus
  dilihat pembeli).
- Perhitungan: `lib/reorder.ts` (dites di `reorder.test.ts`). Kekurangan
  dibulatkan **ke atas** ke satuan beli; `min_buy` jadi lantai, bukan pengganti.
- Minimum jual & diskon default terpasang di kasir petshop. Minimum jual juga
  ditegakkan di server (`kasir/checkout.ts`).

## Belum dikerjakan

- **Harga / diskon grosir bertingkat** (qty ≥ N → harga lain). Butuh tabel
  sendiri + perubahan urutan kalkulasi di `lib/pos-calc.ts`. Sengaja ditunda,
  bukan terlewat.
