# 2026-11-10 — Kasir petshop: stok tidak boleh minus

## Laporan
Andri (grup KAMO, 10.51 WIB): kartu stok satu barang di WH_CMGG (satuan 1/2KG) turun 2 → 0 → −4 lewat
"Faktur Penjualan" kasir (POS-20261110-0010 lalu POS-20261110-0022). Di klinik barang stok 0 sudah tidak bisa
diproses, tapi kasir petshop masih lolos.
Keputusan grup (Aldi, Reza): **barang stok 0 tidak bisa ditransaksikan**. Saldo yang terlanjur minus
**dibiarkan dulu**, dicek manual oleh tim (tidak ada data yang diubah).

## Penyebab
- Semua jalur kasir/POS mengeluarkan stok lewat `sale_stock_out_fifo` → `stock_out_fifo`. `stock_out_fifo` sengaja
  mengizinkan kekurangan (shortfall, HPP perkiraan dari harga terakhir) — dipakai juga jalur lain.
- Layar kasir (`/kasir`) hanya memberi peringatan oranye "Boleh dilanjut kalau barangnya memang ada di rak";
  komentar `checkout.ts`: "owner boleh melanjutkan transaksi". Jadi transaksi tetap jalan dan saldo jadi minus.

## Perbaikan
1. Migrasi `20261110043627_kasir_kunci_stok_minus.sql`
   - Fungsi baru `sale_stock_assert_available(gudang, barang, qty)` (SECURITY DEFINER, tidak bisa dipanggil
     langsung oleh authenticated/anon): kunci baris `stock` (FOR UPDATE), tolak bila `qty < butuh`.
     Pesan: `Stok gudang cabang tidak cukup: <nama> butuh <n> <satuan>, tersedia <n> <satuan>` (saldo minus
     ditampilkan 0), errcode 55000.
   - `sale_stock_out_fifo` ditambal (jangkar eksak, gagal tertutup, penanda `KASIR_KUNCI_STOK`) supaya memanggil
     fungsi itu sebelum `stock_out_fifo`. Satu gerbang ini menutup semua jalur kasir:
     `cashier_post_stock_atomic` (kasir, termasuk komponen paket Grup), `pos_post_promo_atomic`,
     `quantity_pool_post_backoffice_atomic`, dan `stockOut` POS back-office.
   - Urutan kunci sama dengan `stock_out_fifo` (saldo dulu, baru lapisan); `cashier_post_stock_atomic` sudah
     mengurutkan per `item_id`, jadi tidak ada kunci terbalik antar-kasir. Dua kasir yang menjual stok terakhir
     bersamaan: yang kedua menunggu, lalu membaca saldo terbaru dan ditolak.
   - Tidak berubah: `stock_out_fifo` (klinik, pemindahan, produksi, koreksi punya penjagaan sendiri), penjualan
     daring/marketplace (channel tidak null, ditolak `sale_stock_out_fifo` sejak awal), grosir, Jasa/Non-Persediaan.
2. Layar kasir (`src/app/kasir/KasirClient.tsx`, `src/lib/stok-kasir.ts`): barang yang jumlahnya melebihi stok
   (dijumlahkan per barang dalam satuan dasar, termasuk beda satuan pcs/dus) memunculkan kotak merah dan
   **tombol Bayar mati**. Angka stok layar diambil saat barang masuk keranjang; database tetap penentu akhir.
3. Popup "Stok tidak cukup" (`src/lib/stok-kurang.ts`) mengenali pesan baru, termasuk awalan
   `keluarkan stok: ` dari POS back-office; POS back-office (`/pos/transaksi`) kini ikut menampilkan popup.

## Pengujian
- `python3 scripts/test-kasir-kunci-stok-postgres.py` (PostgreSQL 16 native, data fiktif, 400 migrasi):
  A. sebelum migrasi bug terulang (jual 4 dari stok 2 → saldo −2);
  B. migrasi terpasang, pasang ulang gagal tertutup, hak akses helper tertutup;
  C. pas stok lolos; stok 0 & saldo minus ditolak tanpa jejak stok/jurnal/HPP; saldo minus lama tidak diubah;
     dua baris barang sama dijumlah; komponen Grup kurang ditolak; jasa tetap boleh;
  D. POS back-office lewat gerbang yang sama; E. `stock_out_fifo` non-kasir tidak berubah.
- Uji SQL lama yang menyentuh kasir: `cashier_atomic_fifo_floor.sql`, `p03_price_floor.sql` (fixture ditambah
  baris saldo `stock` yang selama ini hanya berisi lapisan), `quantity_pool_pricing.sql`,
  `negative_stock_hpp.sql` (gerbang kasir dimatikan hanya di transaksi uji itu supaya regresi penilaian HPP
  kekurangan tetap teruji), `scripts/test-promo-package-fifo-floor-postgres.py` — lulus.
- Tidak bisa dijalankan di sesi ini (bukan karena perubahan ini): `test-promo-syarat-hasil-postgres.py` butuh
  PostgreSQL 17; `test-quantity-pool-postgres.py` sudah gagal di migrasi 20261106500000 (PROMO_SH_DRIFT) sebelum
  migrasi ini; uji SQL lain yang butuh prelude Docker.
- vitest penuh 8.215 lulus, lint 0 error, `tsc --noEmit`, `next build` lulus.

## Rilis
- Migrasi harus dipasang di Production **bersama/sebelum** deploy aplikasi. Kode layar tanpa migrasi tetap aman
  (hanya penahan layar), migrasi tanpa kode layar juga aman (database menolak, popup sudah ada di kasir).
- Pemeriksaan sebelum pasang (baca-saja): `select pg_get_functiondef('public.sale_stock_out_fifo(uuid,uuid,numeric,text,text,date,uuid)'::regprocedure)`
  harus memuat persis satu baris `return query select * from public.stock_out_fifo(...)` dan belum memuat
  `KASIR_KUNCI_STOK`.
- Setelah pasang: daftar barang dengan saldo minus untuk dicek tim (Aldi):
  `select w.code, i.code, i.name, s.qty from stock s join items i on i.id=s.item_id join warehouses w on w.id=s.warehouse_id where s.qty<0 order by w.code, i.name;`
  Barang ini tidak bisa dijual sampai stoknya dibetulkan (Stok Opname / penerimaan).

## Pemasangan Production (10 Nov 2026)
- Pra-pemeriksaan (baca-saja): migrasi tertinggi live `20261109100100`; jangkar `sale_stock_out_fifo` tepat 1,
  penanda belum ada, helper belum ada, `stock_qty_text` ada. Konsistensi saldo: 5.412 pasangan gudang×barang
  berlapis — 0 saldo `stock` lebih kecil dari sisa lapisan, 0 lapisan tanpa saldo (tidak ada barang yang akan
  tertahan keliru).
- Dipasang via Supabase `apply_migration` → versi live `20261110043627 kasir_kunci_stok_minus` (nama file repo
  disamakan).
- Verifikasi pasca-pasang (transaksi di-rollback, tidak ada data berubah): penanda `KASIR_KUNCI_STOK` ada;
  helper tidak bisa dipanggil authenticated; `sale_stock_out_fifo` tetap untuk authenticated, tidak untuk anon.
  Uji gerbang pada data asli: Life Cat Tuna WH_CMGG (saldo −4) ditolak "butuh 1 1/2KG, tersedia 0 1/2KG";
  barang lain dijual pas sebanyak saldonya lolos; saldo+1 ditolak.
- Saldo minus saat pemasangan (dibiarkan, dicek tim): WH_BTKM Cat Choize Tuna adult −1; WH_CIAW Whiskas Pouch
  Grilled Saba 80gr New −2; WH_CMGG Life Cat Tuna −4; WH_GRND Furlove Pouch Chicken −1; WH_GRND Gesekids FD Egg
  Yolk 20gr −1; WH_MUAR Meo Pouch Kitten −2.

## Sisa
- Saldo minus yang sudah ada tidak diubah (keputusan grup). Barangnya terkunci sampai dikoreksi.
- Stok di layar kasir bisa basi bila halaman lama terbuka; penolakan database tetap menahan, dengan popup.
