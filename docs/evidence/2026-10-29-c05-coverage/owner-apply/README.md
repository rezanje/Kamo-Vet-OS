# C05 lanjutan (rombongan + POS back-office) — paket langkah database untuk owner

Belum ada yang dijalankan ke production. Syarat: langkah C05 dasar (`20261028181000_c05_campaign_codes.sql`,
paket `docs/evidence/2026-10-28-c05-q01/owner-apply/`) **sudah** diterapkan. Jalankan dengan akses owner Supabase
yang sudah ada, **sebelum** merge/deploy aplikasi, dan berhenti bila ada baris yang hasilnya `false`.

| Urutan | File | Menulis? | Isi |
|---|---|---|---|
| 1 | `preflight.sql` | tidak | 12 baris: C05 dasar sudah ada, 8 titik tambal di 3 fungsi masih persis sama, nama kolom/constraint/index belum dipakai pihak lain, info jumlah invoice berkode |
| 2 | `apply.sql` | ya | isi migrasi `20261029154000_c05_campaign_rombongan_backoffice.sql` dalam satu transaksi; aman diulang |
| 3 | `readback.sql` | tidak | 7 baris: kolom grup + constraint + index, cara hitung pemakaian, penjaga trigger, posting klinik, hak akses tidak berubah |
| — | `rollback.sql` | ya | hanya bila diputuskan mundur: tiga fungsi + trigger kembali persis seperti sebelum apply. Kolom `invoices.campaign_group` yang sudah berisi data **tidak dihapus** tapi diganti nama `campaign_group_archived_c05cov`; hapus permanen hanya bila owner menjalankan dulu `select set_config('vetos.rollback_drop_data', 'yes', false);` di sesi yang sama |

`apply.sql` sha256 tercatat di akhir `rehearsal-pg16.log`. Gladi bersih (PostgreSQL 16.15 lokal, data fiktif):
semua migrasi lama → preflight → apply → readback → apply ulang (fungsi identik byte-per-byte) → data rombongan →
rollback tanpa flag (fungsi + trigger identik dengan sebelum apply, data diarsip) → preflight → apply → rollback
dengan flag owner → preflight → apply → readback → tes SQL C05. Ulangi dengan (Linux, sebagai root):

```
python3 docs/evidence/2026-10-29-c05-coverage/owner-apply/build-and-rehearse.py /usr/lib/postgresql/16/bin
```

Catatan untuk owner:
- **Jangan menjalankan ulang `apply.sql` C05 dasar setelah paket ini.** File lama itu menulis ulang dua fungsi
  C05 ke versi awalnya dan menghapus tambalan ini. Bila terlanjur, jalankan lagi `apply.sql` paket ini (aman
  diulang) lalu `readback.sql`.
- Bila rollback dilakukan setelah ada pembayaran rombongan berkode, invoice rombongan itu kembali dihitung satu
  pemakaian per invoice; kode berbatas bisa tampak melewati batasnya (pemakaian baru tetap ditolak).
- Urutan rilis: langkah database dulu, baru deploy aplikasi. Bila aplikasi baru terlanjur jalan tanpa langkah ini,
  database lama mengabaikan kunci grup: kode di rombongan tetap tercatat dan batasnya tetap dijaga, tetapi tiap
  invoice hewan dihitung satu pemakaian (aturan lama), sehingga hewan berikutnya bisa ditolak saat batas habis.
  Tidak pernah ada potongan tanpa catatan. POS back-office tidak butuh langkah ini (cukup C05 dasar).
