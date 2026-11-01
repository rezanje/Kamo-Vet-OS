# POS back office: stok, HPP, dan finalisasi dalam satu transaksi database

Tanggal: 1 Nov 2026. Lanjutan dari insiden tutup shift tertahan (PR #397,
`docs/2026-11-01-insiden-tutup-shift-tertahan.md`).

## Masalah

Checkout `/pos/transaksi` untuk struk biasa (bukan pool kuantitas) berjalan dalam beberapa
permintaan terpisah:

1. kepala struk (`sales`, dengan `payment_plan`) dan baris (`sale_items`) disimpan;
2. `stockOut()` dipanggil sekali per baris. Tiap panggilan adalah RPC `sale_stock_out_fifo`
   yang langsung tersimpan;
3. baru kemudian `finalize_pos_sale` (pembayaran, poin, jurnal penjualan, jurnal HPP).

Kalau proses mati di antara langkah 2 dan 3, struk tertinggal belum final. Padahal
`stock_moves` sudah tercatat, lapisan FIFO sudah terpakai, dan `stock.qty` sudah turun, tetapi
jurnal HPP-nya tidak ada.

Jalur gagal yang eksplisit juga sama buruknya. Kepala struk dihapus setelah sebagian stok
keluar, dan tidak ada yang membalik mutasi itu: `stock_moves` tidak punya FK ke `sales`,
sedangkan `pos_sale_cancel_pending` hanya menyentuh `pos_sale_postings`. Akibatnya stok hilang
tanpa dokumen.

## Perubahan

- Migrasi `20261106030000_pos_backoffice_atomic.sql` menambah
  `public.pos_backoffice_post_atomic(p_sale_id uuid, p_warehouse_id uuid) returns jsonb`.
  Dalam SATU transaksi fungsi ini:
  - mengunci struk dan barisnya;
  - memanggil `sale_stock_out_fifo` per baris Persediaan dalam urutan stabil;
  - menulis HPP per baris;
  - memanggil `finalize_pos_sale`.

  Gagal di baris mana pun, atau di finalisasi, membatalkan semuanya.
- Fungsi ini SECURITY INVOKER dengan `search_path=''`, sama pola dengan
  `quantity_pool_post_backoffice_atomic`. Ia tidak menambah hak akses:
  - stok dan finalisasi tetap lewat RPC SECURITY DEFINER asli, yang masing-masing memeriksa
    kasir, cabang, shift, dan periode;
  - update HPP tetap tunduk pada RLS pemanggil.
- Tidak ada fungsi, policy, atau grant lama yang diganti. Uji Postgres membuktikan isi fungsi
  FIFO/finalisasi/pembatalan, grant, dan RLS identik sebelum dan sesudah migrasi.
- `src/app/(app)/pos/transaksi/actions.ts`:
  - loop `stockOut` per baris dan panggilan `finalize_pos_sale` terpisah diganti satu panggilan
    `pos_backoffice_post_atomic`;
  - jalur pool kuantitas tetap memakai `quantity_pool_post_backoffice_atomic`;
  - pembersihan eksplisit tetap ada: bila RPC gagal, aksi memeriksa dulu apakah transaksi
    sebenarnya sudah final (jawaban hilang). Kalau ya, kasir diarahkan ke struk; kalau tidak,
    kepala struk dihapus. Karena rollback atomik, struk yang dihapus tidak pernah membawa stok.

## Perilaku yang sengaja dipertahankan sama

- Hanya baris barang berjenis `Persediaan` yang memotong stok. Jasa, Non-Persediaan, dan Grup
  tidak memotong stok, dan HPP-nya tetap 0 seperti dulu.
- HPP per baris = biaya FIFO aktual baris itu. Dalam satu SKU, urutan keranjang
  (`source_position`) dipakai, jadi lapisan FIFO dimakan oleh baris yang sama seperti dulu.
- Tidak ada penolakan "jual di bawah HPP". Back office tetap hanya memberi peringatan (P03).
- Keranjang jasa saja tetap final, dengan 0 mutasi stok.
- Cabang tanpa gudang aktif tetap langsung `finalize_pos_sale` tanpa potong stok, sama seperti
  dulu.

Perbedaan kecil:

- pengeluaran stok berjalan dalam urutan SKU, untuk mencegah saling kunci antar transaksi;
- tiap `stock_moves` kini menyimpan `sale_line_id` baris sumbernya.

## Urutan rilis

1. Terapkan migrasi ke Production **lebih dulu**. Migrasi ini hanya menambah fungsi, jadi
   aplikasi lama tetap berjalan normal.
2. Baru deploy aplikasi.

Bila urutannya terbalik, transaksi back office di cabang yang punya gudang akan gagal dengan
pesan error sampai migrasi masuk. Tidak ada stok yang terpotong, tetapi kasir tidak bisa
menyimpan.

Pemeriksaan live:

```sql
select to_regprocedure('public.pos_backoffice_post_atomic(uuid,uuid)') is not null;
-- setelah satu penjualan back office berisi barang:
select count(*), count(sale_line_id) from stock_moves where source_ref = '<no_struk>' and source = 'sale';
```

Kedua angka hitungan harus sama; dulu `sale_line_id` kosong.

Rollback: cukup revert aplikasi. Fungsi baru boleh tetap ada karena tidak dipakai jalur lain.

## Bukti uji

Uji dijalankan dengan:

```
python3 scripts/test-pos-backoffice-atomic-postgres.py --pg-bin /usr/lib/postgresql/16/bin
```

Lingkungannya Postgres 16 sekali pakai: semua migrasi repo, lalu kandidat diterapkan terakhir.
Suite `supabase/tests/pos_backoffice_atomic.sql` membuktikan:

- **Paritas.** Hasil RPC atomik identik dengan *replay* harfiah jalur lama (per baris, lalu
  finalisasi, di-rollback). Yang dibandingkan: HPP per baris, `stock_moves` beserta
  `fifo_takes`, lapisan, `stock`, jurnal, dan poin. Kasusnya mencakup dua baris SKU yang sama
  melintasi dua lapisan FIFO, satuan box (faktor 2), jasa, Grup, Non-Persediaan, dan baris
  ketik manual.
- **Gagal di tengah.** Baris ketiga tanpa referensi HPP ditolak, setelah baris pertama dan
  kedua sempat dikeluarkan. Hasilnya: 0 `stock_moves`, lapisan dan `stock` tidak berubah,
  HPP tetap 0, tidak ada jurnal, struk masih belum final.
- **Gagal di finalisasi.** Akun pendapatan nonaktif setelah semua stok keluar: semuanya
  ter-rollback, dan struk masih bisa dihapus kasirnya.
- **Ulang setelah gagal.** Stok keluar tepat sekali; lapisan berkurang 2, bukan 4.
- **Ulang setelah sukses.** Ditolak, tanpa perubahan.
- **Struk lama yang sudah disentuh penulis per-baris.** Ditolak, tidak dikeluarkan dua kali.
- **Pengaman akses.** Gudang cabang lain atau nonaktif ditolak. Kasir cabang lain tidak bisa
  melihat struknya (RLS). Rekan satu cabang ditolak oleh pemeriksa pelaku asli.
- **Pembatalan.** Pembatalan Super Admin asli tetap bisa mengembalikan stok struk yang
  diposting dengan cara baru.

Uji mutasi:

- urutan tanpa `source_position` → paritas gagal;
- pengaman "stok sudah pernah diproses" dihapus → uji struk lama gagal.

Regresi yang lulus: `cashier_atomic_fifo_floor`, `pos_split_payments`, `pos_merchant_fees`,
`quantity_pool_pricing`, `pos_payment_method_corrections`, `sales_safe_posting`,
`c05_campaign_codes`, `c05_q01_followup`.

`p03_price_floor.sql` dan `posted_sale_cancellations.sql` sudah gagal di `main` tanpa migrasi
ini, karena fixture-nya tertinggal aturan klinik/gudang yang lebih baru. Keduanya tidak dipakai
sebagai regresi.

## Sisa kendala (tidak diubah di sini)

- **Paket (Grup) di back office tidak memotong stok komponennya.**
  - Back office tidak menyimpan snapshot komponen Grup seperti layar kasir, jadi HPP paket
    tercatat 0. Perilaku ini sudah ada sebelumnya dan dipertahankan sama.
  - Perbaikan butuh keputusan dan PR terpisah: menyimpan snapshot komponen, lalu memakai jalur
    `sale-group`.
- **Cabang tanpa gudang aktif** tetap menjual barang tanpa memotong stok, sama seperti dulu.
- **Struk terputus lama dengan mutasi stok** (dari sebelum rilis ini) tetap perlu rekonsiliasi
  manual. Pengaman di PR #397 yang menolak membuang struk seperti itu tetap benar dan tetap
  diperlukan.
