# K13 + K01 — langkah DB owner

Urutan (Supabase SQL editor, project produksi):

1. `preflight.sql` — hanya baca. Semua baris `ok = true`.
2. `apply.sql` — satu transaksi, aman diulang. Isinya sama persis dengan
   `supabase/migrations/20261028110000_clinic_record_addenda.sql` dan
   `20261028110100_clinic_patient_history_rpc.sql`.
3. `readback.sql` — hanya baca. Semua baris `ok = true`.
4. Rollback (`rollback.sql`) hanya bila diputuskan. Otomatis **batal** kalau sudah ada adendum atau log akses;
   ekspor dulu, lalu aktifkan baris `set_config` di file itu secara sadar.

Jejak audit: setiap kali riwayat menampilkan kunjungan dari cabang yang tidak bisa dibuka akun tersebut,
satu baris dicatat (siapa, kapan, pasien, cabang) dan muncul di log aktivitas OWNER/ADMIN. Tanpa isi medis.

Urutan rilis: kode boleh di-merge/deploy sebelum atau sesudah langkah DB.
Sebelum DB diterapkan: riwayat tetap memakai akses cabang lama, bagian adendum tersembunyi.
Sesudah DB diterapkan: riwayat lintas cabang + adendum aktif otomatis.

Diuji pada PostgreSQL 16 dan 17 lokal (lihat `../native-pg16.log`, `../native-pg17.log`):
semua migrasi repo + migrasi ini dua kali (idempoten) + tes + readback → rollback ditolak saat ada data → rollback dengan izin owner → preflight → apply → readback → tes.
