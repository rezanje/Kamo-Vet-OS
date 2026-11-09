# 2026-11-09 — Insiden: Kas & Bank "Application error", Daftar Laporan lambat

## Gejala
±15.08 WIB (laporan Andri di grup): `/kas-bank` menampilkan "Application error: a server-side exception"
(digest 3799993080). Daftar Laporan terasa lambat.

## Penyebab
`getAccountBalances` (src/lib/ledger.ts) — dipakai Kas & Bank, Rekening, Transfer, Kas masuk/keluar, Dashboard,
Neraca, Laba Rugi, Buku Besar, Neraca Saldo, Tutup Buku, Rekonsiliasi — membaca SEMUA `journal_lines` sejak awal
lewat `completeReportQuery` (500 baris per permintaan, `count: exact` di setiap permintaan, RLS `jl_all` per baris),
lalu menjumlah di aplikasi. Production 9 Nov: 19.210 baris jurnal → ±39 permintaan per buka halaman, masing-masing
menghitung ulang seluruh tabel di bawah RLS (terukur 0,67 s hanya untuk `count` sebagai STAFF satu cabang; lebih berat
untuk OWNER/FINANCE). Hasilnya melewati batas waktu, atau `readReportRows` melempar "data berubah selama pembacaan"
karena kasir memposting jurnal di tengah pembacaan. Tidak ada error boundary di `(app)` → layar error bawaan Next.
Beban yang sama dari Dashboard (dibuka tiap login) membebani instance Micro — dugaan kuat penyebab halaman lain lambat
(belum diverifikasi dengan log).

## Perbaikan (PR #479)
- Migrasi `20261109084230_saldo_akun_agregat`: RPC `ledger_account_totals(p_from, p_to, p_branch_ids)` → jsonb total
  debit/kredit per akun, satu query. SECURITY DEFINER; hak baca setara RLS je_all/jl_all (cabang dicek sekali per cabang).
  + indeks `journal_entries(tanggal)`, `journal_lines(account_id)`.
- `getAccountBalances` memakai RPC; kembali ke pembaca lama hanya bila fungsi belum ada.
- `src/app/(app)/error.tsx`: pesan + tombol muat ulang.

## Verifikasi Production (9 Nov 2026, setelah migrasi dipasang, baca-saja, transaksi di-rollback)
- Riwayat migrasi: `20261109084230 saldo_akun_agregat`.
- Kesetaraan: hasil RPC == agregat tabel langsung di bawah RLS untuk 1 pengguna aktif tiap role
  (OWNER, ADMIN, FINANCE, STAFF, DOCTOR) × 3 periode (semua, tahun berjalan, s/d 31 Okt) = 15/15 identik.
- Kecepatan: RPC sebagai OWNER (semua cabang, 19.210 baris) 20 ms.
- Uji lokal: `python3 scripts/test-saldo-akun-agregat-postgres.py` (147 kombinasi hak baca/filter, 60.800 baris).

## Sisa
- Kode aplikasi baru aktif setelah PR #479 di-merge dan Vercel deploy `main`.
- Jalur lain yang masih membaca baris jurnal penuh: `getAccountLedger` (rincian Buku Besar), arus kas 7 hari Dashboard.
- Kelambatan Daftar Laporan dicek ulang setelah rilis.
