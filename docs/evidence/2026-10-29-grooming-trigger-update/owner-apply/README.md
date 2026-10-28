# Perbaikan pengaman grooming saat UBAH baris — paket langkah database untuk owner

Belum ada yang dijalankan ke production. Jalankan dengan akses owner Supabase, **sebelum** merge PR.
Tidak ada perubahan aplikasi, jadi urutan deploy tidak berpengaruh; berhenti bila ada hasil yang tidak sesuai.

| Urutan | File | Menulis? | Isi |
|---|---|---|---|
| 1 | `preflight.sql` | tidak | md5 isi fungsi harus `019ceed5f3e0951a00cd97c7e22e984a` (= isi production dibaca 29 Okt 2026, sama dengan migrasi `20261025040000`); 3 trigger `zz_grooming_requirement` aktif |
| 2 | `apply.sql` | ya | isi persis migrasi `20261029130000_fix_grooming_trigger_update.sql` dalam satu transaksi; hanya mau jalan bila md5 lama/baru cocok; aman diulang |
| 3 | `readback.sql` | tidak | md5 baru `f9630a9197f26870696f688e6eee6d7b` = `true`, 3 trigger tidak berubah, tidak ada hak EXECUTE untuk anon/authenticated/service_role |
| — | `rollback.sql` | ya | hanya bila diputuskan mundur: kembali ke isi lama byte-per-byte (bug ikut kembali) |

## Masalah

`enforce_branch_grooming_performers()` memeriksa `new.sale_id` di satu ekspresi IF dengan `tg_table_name = 'sale_items'`.
PL/pgSQL tetap membaca semua field NEW/OLD di ekspresi itu walau syarat pertama salah, sehingga setiap UPDATE
`prescription_items` / `invoice_items` gagal dengan `record "new" has no field "sale_id"`; UPDATE `sale_items` yang
mengganti `sale_id`/`item_id` (mis. barang master dihapus → `ON DELETE SET NULL`) gagal dengan `... "invoice_id"`.

Dampak nyata di production sejak 25 Okt 2026: mengubah petunjuk pemakaian racikan setelah tersimpan
(sinkronisasi ke resep = UPDATE `prescription_items`) gagal. Cek baca-saja 29 Okt: 2 racikan berpetunjuk,
0 yang tidak sinkron (tidak ada data rusak). Log Postgres 24 jam terakhir: tidak ada error ini.
Alur koreksi/reissue invoice klinik, refund J03, BMHP K02 dan pembayaran tidak memakai UPDATE baris (hapus+sisip),
dan update HPP `sale_items` di kasir keluar lebih awal, jadi tidak terdampak.

## Perbaikan

Pemeriksaan UPDATE dipisah per tabel (IF bersarang). Aturan grooming, pesan error, perilaku INSERT,
definisi trigger dan hak akses tidak berubah.

## Gladi bersih

`LC_ALL=en_US.UTF-8 python3 scripts/test-grooming-trigger-update-postgres.py [bin PostgreSQL]` — semua migrasi →
preflight → rollback (isi lama: tes baru dan tes petunjuk racikan **gagal** dengan error production) → apply → readback →
apply ulang → tes baru + regresi. Log: `../native-pg16.log`, `../native-pg17.log`.
