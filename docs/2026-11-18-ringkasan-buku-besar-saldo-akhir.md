# Ringkasan Buku Besar: kolom saldo = saldo akhir (18 Nov 2026)

Laporan Mba Anisa (grup, 18 Nov 11.16): Bank BCA Gudang (120003) di Ringkasan Buku Besar 2.830.825, di rincian akun
3.203.092. Saldo di Transfer Bank juga 3.203.092 (benar).

## Penyebab

Ringkasan difilter periode (mis. 1–30 Nov). `getAccountBalances` hanya menjumlah mutasi DI DALAM periode, jadi kolom
"Saldo" = debit − kredit periode, tanpa saldo sebelum periode. Rincian akun memulai saldo berjalan dari
`getAccountOpening` (saldo sebelum `dari`). Selisihnya = jurnal saldo awal rekening JRN-202610-0021 tgl 31 Okt,
debit 372.267 (2.830.825 + 372.267 = 3.203.092). Datanya benar, cuma tampilan ringkasannya yang tidak menghitung saldo awal.

Cek Production: total semua jurnal akun 120003 = D 632.726.033 / K 629.522.940,9 → saldo 3.203.092; ringkasan periode
November = D 632.353.766 (tanpa 372.267).

## Perbaikan

- `src/lib/ledger.ts`: `getOpeningBalances(supabase, filter)` — saldo semua akun sebelum `from`, satu panggilan agregat
  `ledger_account_totals` (p_to = sehari sebelum `from`, filter cabang sama), sisi saldo normal.
- `src/app/(app)/keuangan/buku-besar/page.tsx`: bila tanggal "dari" diisi, ringkasan menampilkan kolom **Saldo Awal**,
  Debit/Kredit (mutasi periode), dan **Saldo Akhir** = saldo awal + mutasi, sama dengan saldo berjalan terakhir di rincian.
  Tanpa "dari", tampilan tetap seperti sebelumnya. Total debit/kredit + status Seimbang tetap atas mutasi periode.
- Tes: `src/lib/__tests__/ledger.test.ts` (kasus baru saldo awal semua akun).

Halaman lain yang memakai `getAccountBalances` (Neraca Saldo, Neraca, Laba Rugi, dll.) tidak diubah.
