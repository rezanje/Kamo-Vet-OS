# Q01 progres quest atomik — paket langkah database untuk owner

Belum ada yang dijalankan ke production. Jalankan dengan akses owner Supabase yang sudah ada,
**sesudah** paket C05 + Q01 (`docs/evidence/2026-10-28-c05-q01/owner-apply`) dan **sebelum**
merge/deploy aplikasi. Berhenti bila ada baris yang hasilnya `false`.

| Urutan | File | Menulis? | Isi |
|---|---|---|---|
| 1 | `preflight.sql` | tidak | 4 cek (Q01 sudah terpasang, titik tambal fungsi efek staf masih sama, belum ada objek bentrok) + 4 baris `info:` — termasuk **jumlah klaim customer baru yang progresnya tidak pernah tercatat** dan daftar strukturnya, serta struk lunas 30 hari terakhir tanpa efek staf (kasir vs back office) |
| 2 | `apply.sql` | ya | isi persis migrasi `20261029153000_q01_quest_progress_atomic.sql` dalam satu transaksi; aman diulang |
| 3 | `readback.sql` | tidak | 5 cek (fungsi internal privat, RPC lama tetap sama hak aksesnya, trigger aktif dan urutannya setelah klaim, jalur void utuh) + 1 baris `info:` |
| — | `rollback.sql` | ya | hanya bila diputuskan mundur: fungsi `apply_sale_staff_effects` kembali persis seperti sebelum apply (diuji md5), trigger dan dua fungsi baru dihapus. Efek staf yang sudah tercatat tetap ada dan tetap bisa dibalik lewat void. **Aplikasi juga harus dikembalikan** ke build yang masih memanggil RPC sesudah bayar |

`apply.sql` sha256 `d5901b34bd3ad1ca297795f25d96b396dfd9eb2485765e06b49f1dd7486c26bc` (juga di akhir `rehearsal-pg16.log`).

Gladi bersih (PostgreSQL 16.15 lokal sekali pakai, data fiktif): semua migrasi lama → 2 struk dibayar tanpa
pemanggilan progres (meniru temuan audit) → preflight → apply → readback → apply ulang → rollback (fungsi identik
byte-per-byte) → preflight → apply → readback → tes Q01 atomik & Q01 lama. Ulangi dengan:

```
python3 docs/evidence/2026-10-29-q01-atomic/owner-apply/build-and-rehearse.py [/usr/lib/postgresql/16/bin]
```

Catatan untuk owner:
- **Urutan rilis wajib: database dulu, baru aplikasi.** Aplikasi baru tidak lagi memanggil pencatatan progres
  terpisah; kalau aplikasi tayang sebelum `apply.sql`, struk /kasir tidak menambah progres sampai apply dijalankan.
  Aplikasi lama tetap aman setelah apply (panggilannya menjadi tanpa efek, tidak menghitung dua kali).
- Klaim/struk lama yang progresnya hilang **tidak** diisi ulang otomatis: progres harian/bulanan, streak dan urutan
  pembatalan bergantung pada waktu transaksi, jadi pengisian mundur akan masuk ke periode hari ini. Angkanya
  terlihat di baris `info:` preflight untuk diputuskan owner.
- Setelah apply, struk dari /pos/transaksi (back office) juga mencatat efek staf. Akibatnya aturan void yang
  sudah berlaku untuk /kasir ikut berlaku di back office: pembatalan per kasir harus dari struk terakhir dulu
  (atau rekonsiliasi hadiah staf).
