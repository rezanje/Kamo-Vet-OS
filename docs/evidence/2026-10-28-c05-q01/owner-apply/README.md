# C05 + Q01 — paket langkah database untuk owner

Belum ada yang dijalankan ke production. Jalankan dengan akses owner Supabase yang sudah ada, **sebelum**
merge/deploy aplikasi, dan berhenti bila ada baris yang hasilnya `false`.

| Urutan | File | Menulis? | Isi |
|---|---|---|---|
| 1 | `preflight.sql` | tidak | 6 cek: titik tambal dua fungsi lama masih sama, daftar jenis quest, kolom belum dipakai |
| 2 | `apply.sql` | ya | gabungan dua migrasi `20261028180000_q01_new_customer_quest.sql` + `20261028181000_c05_campaign_codes.sql` dalam satu transaksi; aman diulang |
| 3 | `readback.sql` | tidak | 10 cek: tabel, trigger, hak akses, dua fungsi tertambal |
| — | `rollback.sql` | ya | hanya bila diputuskan mundur: kedua fungsi kembali persis seperti semula, trigger/fungsi baru dihapus. Tabel/kolom yang sudah berisi data **tidak dihapus** tapi diganti nama `*_archived_c05q01`; hapus permanen hanya bila owner menjalankan dulu `select set_config('vetos.rollback_drop_data', 'yes', false);` di sesi yang sama |

`apply.sql` sha256 tercatat di akhir `rehearsal-pg16.log`. Gladi bersih (PostgreSQL 16.14 lokal, data fiktif):
semua migrasi lama → preflight → apply → readback → apply ulang → rollback tanpa flag (data diarsip) → apply → rollback dengan flag owner (fungsi identik byte-per-byte
dengan sebelum apply) → preflight → apply → readback → tes C05 & Q01. Ulangi dengan:

```
LC_ALL=en_US.UTF-8 python3 docs/evidence/2026-10-28-c05-q01/owner-apply/build-and-rehearse.py
```

Urutan rilis: langkah database dulu, baru deploy aplikasi. Aplikasi baru tetap aman bila database belum
diterapkan (voucher biasa jalan; kode kampanye dianggap tidak dikenal), tapi fitur C05/Q01 baru aktif setelah apply.
