# S04 — komisi jasa dua pelaksana: aturan masing-masing, mulai 1 Nov 2026

Paket untuk pemegang akses Supabase production. **Belum ada yang dijalankan ke production.**
Jangan menulis ID project, jumlah data, atau keluaran production ke repo/PR.

Migrasi `20261026002000_service_commission_policy.sql` sudah ada di `main` (dan aplikasinya sudah terdeploy),
tetapi **belum diterapkan di production**. Selama tabelnya belum ada, aplikasi menganggap "belum ada keputusan":
baris jasa dengan dua pelaksana ditahan dan memblokir penggajian. Tidak ada perubahan kode aplikasi di paket ini.

**Perubahan sebelum diterapkan (review 28 Okt):** isi migrasi 20261026002000 diubah agar menyimpan kebijakan
**hanya OWNER** (sebelumnya OWNER/ADMIN), sejalan dengan keputusan H04 (konfigurasi gaji = OWNER). Versi tetap
20261026002000 karena migrasi ini belum pernah diterapkan di production. Form di layar Komisi juga hanya tampil untuk OWNER.

Keputusan pemilik 28 Okt 2026: dua pelaksana jasa = **masing-masing memakai aturan komisinya sendiri**
(mode `personal_rules`, dasar penuh untuk keduanya), berlaku **2026-11-01**, **semua cabang**.

Urutan (berhenti bila hasil tidak sesuai):

1. `preflight.sql` (hanya baca) — SUMMARY harus `0 failed`. Termasuk cek **tepat satu OWNER aktif**: baris
   kebijakan dicatat atas nama OWNER itu (kolom `created_by` wajib terisi, dan di SQL editor tidak ada login aplikasi).
2. `apply.sql` (menulis, satu transaksi, wajib role `postgres`) — migrasi apa adanya (sha256 di kepala file)
   + baris riwayat, lalu **satu pernyataan terpisah** yang menyimpan kebijakan di atas. Pernyataan itu tidak
   menambah baris kembar bila sudah ada.
3. `readback.sql` (hanya baca) — SUMMARY harus `0 failed`. Sebelum apply file ini memang berhenti dengan galat
   "relation … does not exist".
4. Cek di aplikasi: *Penjualan → Komisi*, bagian kebijakan dua pelaksana menampilkan
   "Aturan khusus karyawan · dasar penuh keduanya", berlaku 2026-11-01, semua cabang.

Catatan penting: dengan mode ini, satu baris jasa dua pelaksana baru dihitung bila **kedua** pelaksana punya
aturan komisi khusus atas namanya sendiri (aturan umum/kelompok tidak dipakai). Kalau salah satu belum punya,
baris itu tetap tertahan ("Aturan aktif belum cocok untuk setiap pelaksana") — perilaku aplikasi yang sudah ada.
Finance perlu memastikan aturan khusus per karyawan sudah diisi sebelum penggajian November. Kebijakan bisa diganti kapan saja dari
layar Komisi (tabel append-only; baris baru dengan tanggal sama/lebih baru menggantikan).

Mundur: `rollback.sql` menghapus tabel kebijakan (aplikasi kembali ke "ditahan"). Pakai hanya sebelum ada
penggajian yang memakai kebijakan ini; kalau sudah dipakai, lebih aman simpan kebijakan baru "Ditahan" dari layar Komisi.
Rollback **menolak sendiri** (tanpa menghapus apa pun) bila tabel berisi baris selain baris yang ditanam apply.sql;
hanya jalan bila OWNER sengaja mengaktifkan baris `set_config('kamo.s04_rollback_confirm', ...)` di file itu.

Dilatih ujung-ke-ujung di cluster sementara PostgreSQL 17.11 dan 16.14 (Homebrew): preflight → readback (galat,
tabel belum ada) → apply → readback → apply kedua ditolak → rollback ditolak saat ada baris lain → rollback
dengan flag owner → apply ulang → rollback tanpa flag (hanya baris tanam) → apply ulang → readback. Log: `../rehearsal-pg17.log`, `../rehearsal-pg16.log`. Suite RLS/hak akses S04:
`../s04-policy-suite-pg17.log`.
