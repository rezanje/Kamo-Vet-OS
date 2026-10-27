# P01 — pengajuan koreksi pembelian untuk semua yang bisa membuka dokumen

Paket untuk pemegang akses Supabase production. **Belum ada yang dijalankan ke production.**
Syarat: paket A02 (`docs/evidence/2026-10-27-a02-correction-requests/owner-apply`) sudah terpasang.
Jangan menulis ID project, jumlah data, atau keluaran production ke repo/PR.

Urutan (berhenti bila hasil tidak sesuai):

1. `preflight.sql` (hanya baca) — baris SUMMARY harus `0 failed`.
2. `apply.sql` (menulis, satu transaksi, wajib role `postgres`) — isi migrasi
   `supabase/migrations/20261028130000_p01_correction_request_any_reader.sql` apa adanya + baris riwayat.
3. `readback.sql` (hanya baca) — SUMMARY harus `0 failed`.
4. Deploy aplikasi P01 setelah langkah 3 lolos. Aplikasi lama tetap jalan dengan DB baru
   (hanya syarat pengaju yang dilonggarkan).

Mundur: `rollback.sql` mengembalikan dua fungsi persis seperti A02 dan menghapus baris riwayat; request
yang sudah tersimpan tidak disentuh. Revert commit aplikasi P01 sesudahnya.

Dilatih ujung-ke-ujung di cluster sementara PostgreSQL 17.11 (Homebrew) dengan seluruh migrasi repo:
preflight → apply → readback → rollback → preflight → apply ulang → readback → suite A02/P01. Log: `rehearsal-pg17.log`.
