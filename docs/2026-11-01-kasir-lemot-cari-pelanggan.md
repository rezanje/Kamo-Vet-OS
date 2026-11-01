# 2026-11-01 — Kasir lemot setelah rilis "cari semua pelanggan"

## Kejadian
- 08:19–08:20 WIB: impor ±9.000 pelanggan → total 10.425 pelanggan (>10.000 = batas baris per permintaan database).
- 09:33 WIB: rilis #386 — kasir petshop membaca **seluruh** pelanggan per halaman (21 permintaan × join golongan/ulasan, `count=exact`)
  setiap kali layar kasir dibuka/di-refresh. Payload pelanggan saja ±1,7 MB per buka (diukur di DB produksi), di atas
  katalog barang + seluruh tabel `sales` & `invoices` lunas (untuk ringkasan transaksi per pelanggan).
- 09:40–09:56 WIB: laporan tim — "lemot banget", "ga bisa proses sama sekali", tablet loading terus.
- Bukti di data: transaksi petshop ±1 tiap 3–5 menit sebelum 09:33; **kosong 09:46–10:22**.
- 10:05 WIB: rilis #387 — pola yang sama dipasang di CRM Pelanggan (±5,8 MB: pelanggan + hewan), POS backoffice
  (pelanggan + hewan), faktur, pesanan, penawaran, uang muka, order online, voucher.
- Statistik DB: query pelanggan kasir 1.891 panggilan, rata-rata 244 ms, maks 6,9 dtk. DB sendiri tidak down
  (instance compute kecil, CPU bersama).

## Tindakan darurat
- ±10:35 WIB: Production dipromosikan kembali ke deployment 09:20 (`dpl_BGC6PyPCv42zYEY98ksPD8Xttd6U`, commit 4dc0a20).
  Rollback otomatis Vercel ditolak di paket Hobby ("rollback further than previous"), jadi dipakai `promote`.
  Efek sampingan selama rollback: pelanggan urutan nama >10.000 tidak muncul di cari kasir, CRM Pelanggan error batas
  10.000, fitur reset login Super Admin (U13) tidak tampil — migrasi DB-nya tetap ada dan tidak dipakai kode lama.

## Perbaikan permanen (PR ini)
- `src/lib/kasir-pelanggan.ts`: `cariBarisPelanggan` — 2 query kecil (nama `ILIKE`, HP regex toleran pemisah/+62),
  masing-masing `limit 25`, disaring ulang dengan aturan cocok lama (`cocokPelanggan`), urut nama, maks 5 hasil.
  Ringkasan transaksi (penjualan selesai + faktur klinik lunas) dihitung hanya untuk ID hasil.
- Kasir petshop: `cariCustomerKasir` / `ambilCustomerKasir` (server action). Layar kasir tidak lagi menerima
  `customers`; pencarian ditunda 250 ms, jawaban lama yang telat diabaikan. Draf kasir menyimpan ID pelanggan; ID tetap
  ikut terkirim walau data pelanggan belum termuat (tidak hilang diam-diam).
- Halaman kasir tidak lagi membaca seluruh `customers`, `sales`, dan `invoices`.
- POS backoffice (`/pos/transaksi`): pola yang sama (`cariPelangganPosAction` / `ambilPelangganPosAction`, hewan ikut);
  aturan diskon dimuat untuk semua golongan **aktif** (bukan hanya golongan pelanggan yang termuat).
- Ikon mata pada kolom password (login, ubah password, tambah pengguna) — permintaan tim toko.

## Belum dikerjakan (lanjutan)
- CRM Pelanggan masih membaca semua pelanggan + hewan (±5,8 MB) lalu membagi halaman di layar. Perlu dipindah ke
  pencarian & paging di server (termasuk angka ringkasan tier/member via count).
- Pemilih pelanggan back-office (faktur, pesanan, penawaran, uang muka, order online, voucher, tambah anabul) masih
  memuat semua pelanggan kolom ringkas (id, nama, HP ±0,7 MB). Kandidat dipindah ke komponen cari server yang sama.
- Pertimbangkan naik compute Supabase bila lemot masih terasa setelah rilis ini.
