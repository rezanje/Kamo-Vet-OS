# U11 — OWNER membuat cabang baru

Paket untuk pemegang akses Supabase production. **Belum ada yang dijalankan ke production.**
Jangan menulis ID project, jumlah data, atau keluaran production ke repo/PR.

Urutan (berhenti bila hasil tidak sesuai):

1. `preflight.sql` (hanya baca) — SUMMARY harus `0 failed`. Termasuk cek **tidak ada kode cabang kembar beda
   huruf besar/kecil** (mis. `PDRY` dan `pdry`), karena migrasi memasang index unik `lower(code)`. Kalau cek ini
   gagal, jalankan QUERY B di file yang sama, rapikan kodenya dengan keputusan bisnis, lalu ulangi preflight.
   Apply juga akan gagal aman (semua di-rollback) bila duplikat masih ada.
2. `apply.sql` (menulis, satu transaksi, wajib role `postgres`) — isi migrasi
   `supabase/migrations/20261028131000_u11_owner_create_branch.sql` apa adanya + baris riwayat.
3. `readback.sql` (hanya baca) — SUMMARY harus `0 failed`.
4. Deploy aplikasi U11 setelah langkah 3 lolos. Tanpa langkah DB, tombol "Tambah cabang" akan menampilkan
   "Cabang belum dapat disimpan" (tidak ada data yang rusak).

Mundur: `rollback.sql` menghapus fungsi `create_branch`, index `branches_code_lower_key`, dan baris riwayatnya. Cabang yang sudah dibuat
**tidak** dihapus. Revert commit aplikasi U11 sesudahnya.

Dilatih ujung-ke-ujung di cluster sementara PostgreSQL 17.11 (Homebrew) dengan seluruh migrasi repo:
preflight menolak kode kembar → apply ditolak saat kembar → preflight → apply → readback → rollback → preflight → apply ulang → readback → suite U11. Log: `rehearsal-pg17.log`.
