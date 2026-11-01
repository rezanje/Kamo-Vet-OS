# 2026-11-01 — Kasir & CRM lambat / sempat tidak bisa dibuka

## Gejala
Laporan 1 Nov 2026 siang: aplikasi lambat, kasir sempat tidak bisa dibuka.

## Penyebab (dicek di produksi, baca saja)
- Produksi punya 10.426 pelanggan (impor 1 Nov). PR #386/#387 pagi itu membuat kasir, POS klinik,
  CRM Pelanggan, voucher, faktur/pesanan/penawaran/uang muka, order online, dan form anabul memuat
  **semua** pelanggan per halaman 500 baris (±21 permintaan, masing-masing `count=exact`) lalu
  mengirim seluruh daftar ke browser.
- `pg_stat_statements`: query pelanggan kasir 2.592 kali, rata-rata 268 ms, maks 6,9 detik — beban
  database terbesar ke-3 (setelah replikasi realtime internal & katalog zona waktu). Role `authenticated`
  dibatasi 8 detik per statement, jadi saat ramai halaman bisa gagal.
- Kasir juga membaca SELURUH tabel `sales` dan `invoices` tiap dibuka hanya untuk ringkasan transaksi
  satu pelanggan terpilih.
- CRM Pelanggan memuat 10.000+ pelanggan **beserta semua anabulnya** sekaligus.

## Perbaikan
- `GET /api/pelanggan` (`src/app/api/pelanggan/route.ts`): `?q=` cari nama/no. HP (maks. 8 hasil),
  `?id=&untuk=dasar|kasir|pos` muat satu pelanggan. Sesi pengguna + RLS tetap berlaku.
- `src/lib/pelanggan-cari.ts`: filter PostgREST — nama `ilike` (nilai dikutip), no. HP `match` regex
  per angka dengan satu pemisah opsional (`\D?`) sehingga "0812-1002-7879", "+62 858-…", 08…/62…
  tetap ketemu. `\D*` ±30x lebih lambat (backtracking) — jangan dipakai. Diuji di produksi: ±11–15 ms.
- `src/lib/pelanggan-server.ts`: `muatPelangganKasir` (golongan, ulasan, ringkasan transaksi
  HANYA pelanggan itu), `muatPelangganPos` (golongan + anabul).
- `src/components/useCariPelanggan.ts` (debounce 250 ms, batalkan permintaan lama) dan
  `src/components/PelangganPicker.tsx` (pengganti `<select>` semua pelanggan; input tersembunyi
  `customer_id` ikut draf transaksi lewat `data-draft-state`, nama dimuat ulang saat draf dipulihkan;
  wajib-isi lewat `setCustomValidity`).
- Kasir petshop & POS klinik: cari di server; pelanggan dimuat saat dipilih / saat draf dipulihkan
  (id tetap tersimpan di draf selama memuat). Kasir tidak lagi membaca `customers`, `sales`, `invoices`.
- POS klinik: aturan diskon disiapkan untuk semua golongan aktif (dulu dari golongan seluruh pelanggan).
- CRM Pelanggan: 50 baris per halaman (`readListPage`), pencarian `?cari=` dijalankan database,
  ringkasan tier/member dihitung `count` di database. Pelanggan terpilih tetap tampil saat ganti halaman.
- Voucher, faktur jual baru, pesanan, penawaran, uang muka, tambah anabul, transfer anabul (pemilik lama
  dikecualikan), order online (pelanggan order sumber dimuat satu baris): `PelangganPicker`.
- Helper `semuaPelanggan` dihapus.

## Sisa / belum dikerjakan
- Belum diukur di produksi setelah deploy (perlu dicek waktu buka kasir & CRM).
- Layar lain yang memuat banyak data (katalog barang kasir ±3.600 barang) tidak diubah.
- Impor rekam medis (`klinik/rekam-medis/impor`), cek duplikat impor, `wa-engine`, dan cron loyalti
  memang membaca semua pelanggan di server — bukan layar harian, tidak diubah.
- Draf order online lama yang menyimpan teks pelanggan: pelanggan perlu dipilih ulang.
