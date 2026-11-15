# Dashboard stok: Slow moving / berlebih dan Harus order

Permintaan Pak Andri (13 Nov 2026): item slow moving dan item harus order, dari riwayat penjualan, rata-rata **semua gudang digabung**.
Contoh Pak Andri: penjualan sebulan Rp2 jt, nilai stok Rp10 jt => cukup 5 bulan => berlebih.

Hanya baca. Tidak mengubah uang, stok, atau data lain.

## Di mana
- Dashboard (tampilan Keuangan dan Operasional): dua kartu, hanya OWNER/ADMIN/FINANCE yang halamannya boleh dibuka.
- `/laporan/stok-slow-moving` dan `/laporan/stok-harus-order` (Daftar Laporan). Filter gudang (bawaan: semua digabung), kategori, cari. Unduh Excel.
- Akses Grup: sub-menu `laporan.stok-slow-moving` dan `laporan.stok-harus-order` (modul Daftar Laporan). Peran tanpa pembatasan sub-menu otomatis boleh;
  peran yang laporannya dipilih satu-satu (mis. ADMIN) dicentang Owner. Baris katalognya dipasang migrasi `20261117100000` SEBELUM aplikasi.

## Sumber data
Fungsi SQL `public.laporan_stok_analisis(gudang, jendela_hari, hari_ini)` (STABLE, SECURITY INVOKER, search_path kosong, hanya `authenticated`):
satu agregasi, tanpa N+1. Hak baca dan batas cabang/gudang (RLS) mengikuti pemanggil.

- **Pemakaian** = `stock_moves` (satuan DASAR, sudah dikali faktor satuan) dengan sumber: `sale`, `sale-group`, `sale-online`, `sales-delivery`
  (kasir, online, faktur grosir), `klinik`, `klinik-bmhp`, `klinik-edit`, `racik`, `racik-koreksi`, `racik-kembali` (klinik, BMHP, racikan),
  ditambah pembaliknya `sale-void`, `retur-jual`, `retur-jual-group`, `retur-klinik`, `wholesale-return`, `wholesale-return-void`.
  Struk batal dan retur MENGURANGI pemakaian. Tidak dihitung: pembelian, mutasi dan permintaan antar gudang, produksi, opname, penyesuaian.
- **Nilai stok** = `stock_layers` (FIFO): `qty_left x unit_cost`, semua gudang. Stok = `stock.qty`.
- `sale_items.hpp` adalah total modal baris (qty x faktor x biaya), BUKAN per satuan; jangan dikali qty lagi. Laporan ini tidak memakainya:
  modal terjual diambil dari `stock_moves.unit_cost`.

## Definisi (semua angka di `KONFIG_STOK`, `src/lib/stok-analisis.ts`)
| Nama | Isi |
|---|---|
| Jendela | 90 hari terakhir, atau sejak ada penjualan bila lebih pendek; pembagi minimal 14 hari |
| Terjual/bulan | barang keluar di jendela ÷ hari × 30 (satuan dasar) |
| Cukup untuk (bulan) | stok ÷ terjual/bulan (per barang); semua stok = nilai stok ÷ modal terjual per bulan |
| Berlebih | cukup lebih dari 3 bulan (tepat 3 = aman) |
| Tidak laku | tidak ada barang keluar 60 hari (stok lama; stok yang baru masuk tidak dihitung) |
| Mati | 120 hari |
| Belum laku | belum pernah keluar sejak riwayat ada, sementara riwayat < 60 hari: SEMENTARA, bukan vonis |
| Modal tertahan | seluruh nilai stok untuk tidak laku/mati/belum laku; kelebihan di atas 3 bulan untuk berlebih |
| Harus order | barang aktif, jenis Persediaan: stok <= minimum (aturan lama, per barang semua gudang digabung) ATAU cukup kurang dari 14 hari |
| Saran order | isi sampai 30 hari penjualan (atau minimum bila lebih besar) dikurangi stok, dibulatkan ke atas ke satuan beli dan minimum beli pemasok (`hitungUsulan`), per pemasok (`kelompokPemasok`) |
| Tidak ikut order | nonaktif, jasa/paket, dibuang; barang tanpa penjualan DAN tanpa minimum |

## Riwayat pendek
Riwayat penjualan Kamo baru mulai 1 Nov 2026. Selama riwayat < 60 hari setiap kartu dan halaman menulis "riwayat baru N hari" dan
menyebut angkanya sementara; barang yang belum pernah keluar diberi status "Belum laku", bukan "Tidak laku". Perkiraan 13 hari tidak boleh dibaca sebagai pasti.

## Buat PO
Tidak ada pembuatan PO baru di sini. Tautan ke halaman yang sudah ada: Draft PO dari Stok Minimum (`/pos/stok-minimum`, hanya barang di bawah minimum)
dan Pesanan Pembelian (`/pembelian`), masing-masing hanya tampil bila peran boleh membukanya.

## Pengujian
Vitest: `src/lib/__tests__/stok-analisis*.test.ts`, `src/components/__tests__/kartu-stok.test.tsx`, `src/app/(app)/laporan/stok-*/*.test.*`.
Native PG17: `scripts/test-stok-slow-order-postgres.py` (`--baseline` RED, biasa GREEN, `--mutants`), dengan
`flock /opt/data/kamo-heavy-test.lock python3 -I ... --pg-bin /opt/data/kamo-pg-harness/bin`.
