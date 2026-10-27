# U11 — OWNER membuat cabang baru

Paket untuk pemegang akses Supabase production. **Belum ada yang dijalankan ke production.**
Jangan menulis ID project, jumlah data, atau keluaran production ke repo/PR.

Urutan (berhenti bila hasil tidak sesuai):

1. `preflight.sql` (hanya baca) — SUMMARY harus `0 failed`.
2. `apply.sql` (menulis, satu transaksi, wajib role `postgres`) — isi migrasi
   `supabase/migrations/20261028131000_u11_owner_create_branch.sql` apa adanya + baris riwayat.
3. `readback.sql` (hanya baca) — SUMMARY harus `0 failed`.
4. Deploy aplikasi U11 setelah langkah 3 lolos. Tanpa langkah DB, tombol "Tambah cabang" akan menampilkan
   "Cabang belum dapat disimpan" (tidak ada data yang rusak).

Mundur: `rollback.sql` menghapus fungsi `create_branch` dan baris riwayatnya. Cabang yang sudah dibuat
**tidak** dihapus. Revert commit aplikasi U11 sesudahnya.

Dilatih ujung-ke-ujung di cluster sementara PostgreSQL 17.11 (Homebrew) dengan seluruh migrasi repo:
preflight → apply → readback → rollback → preflight → apply ulang → readback → suite U11. Log: `rehearsal-pg17.log`.
