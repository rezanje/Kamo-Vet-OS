# K13 + K01 — langkah DB owner

Urutan (Supabase SQL editor, project produksi):

1. `preflight.sql` — hanya baca. Semua baris `ok = true`.
2. `apply.sql` — satu transaksi, aman diulang. Isinya sama persis dengan
   `supabase/migrations/20261028110000_clinic_record_addenda.sql` dan
   `20261028110100_clinic_patient_history_rpc.sql`.
3. `readback.sql` — hanya baca. Semua baris `ok = true`.
4. Rollback (`rollback.sql`) hanya bila diputuskan; menghapus semua adendum yang sudah ditulis.

Urutan rilis: kode boleh di-merge/deploy sebelum atau sesudah langkah DB.
Sebelum DB diterapkan: riwayat tetap memakai akses cabang lama, bagian adendum tersembunyi.
Sesudah DB diterapkan: riwayat lintas cabang + adendum aktif otomatis.

Diuji pada PostgreSQL 16 dan 17 lokal (lihat `../native-pg16.log`, `../native-pg17.log`):
semua migrasi repo + migrasi ini dua kali (idempoten) + tes + readback → rollback → preflight → apply → readback → tes.
