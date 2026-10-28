# I08/I09 — paket DB untuk owner

Belum ada yang dijalankan ke production. Jalankan hanya setelah keputusan rilis, dengan akses owner yang
sudah ada, di SQL editor Supabase production, berurutan; berhenti bila ada langkah yang tidak sesuai.

| Langkah | File | Menulis? | sha256 |
|---|---|---|---|
| 1 | `preflight.sql` | tidak | `9c605810649f958234d61feb23fd4709268e89820cf8b564cf94a45d7516fe37` |
| 2 | `apply.sql` (= tiga migrasi `20261028200000`, `…201000`, `…202000`, satu transaksi, aman diulang) | ya | `c608a78fb88709e83440f129a9de49f41dbb314d46233ea0325a174b0db11cfb` |
| 3 | `readback.sql` | tidak | `1a94c3d1fbc2849286e8a19973e6fe4e8e1c05c2b03ba210766b735d6cbff46e` |
| — | `rollback.sql` (hanya bila diputuskan mundur) | ya | `1dc3c876b94fa490d9a430981c0120cd2c88a31242a0114d48163aec2da839da` |

Sidik isi fungsi (md5 `pg_get_functiondef`) — sama di production (PostgreSQL 17.6, dicek baca-saja
28 Okt) dan di PG16/PG17 lokal:

| Fungsi | main (sebelum) | sesudah apply |
|---|---|---|
| `post_production_atomic` | `9081430156be400a3e9d562dea6c3e5d` | `75af6e84a3f76468b8ef300029094b88` |
| `post_production_adhoc_atomic` | `7281aba74319c810720a6df1389a1be0` | `dcb556e965cb59dedb11ccb5867577ec` |
| `read_production_atomic_sources` | `ceeacc6fb3d31d67e5fc21b1f8da4f33` | `f905d9ae280797512058d7184883190f` |

1. `preflight.sql`: enam baris pertama harus `ok = true` (sidik persis "main" atau persis "sudah
   diterapkan"; selain itu `false`). Baris informasi terakhir hanya dicatat.
2. `apply.sql`: satu transaksi. Gagal = database tetap seperti sebelumnya. Migrasi menolak bila sidik
   fungsi bukan main/hasilnya sendiri, dan memeriksa sidik hasil patch.
3. `readback.sql`: semua baris `ok = true` (sidik persis "sesudah apply").
4. Deploy aplikasi sesudah langkah 3. Urutan sebaliknya aman: layar jejak racikan menampilkan "belum
   dapat diperiksa" dan panel pekerjaan→penyelesaian produksi baru muncul setelah DB diterapkan.

Rollback: mengembalikan isi fungsi persis main (dicek sidik md5 di dalam transaksi), menghapus RPC jejak
racikan, tidak menyentuh baris data. **Selalu menolak bila metode persediaan sudah moving average** —
main memblokir semua produksi di mode average dan aktivasi average tidak bisa dibatalkan, jadi mundur
akan menghentikan produksi permanen. Di kondisi itu perbaiki maju dengan migrasi baru.

Gladi: `python3 docs/evidence/2026-10-28-i08-i09/build-and-rehearse.py` (runner Docker repo; tanpa Docker
lewat pembungkus native). Hasil: `rehearsal-pg16.log`, `rehearsal-pg17.log` — fungsi yang diubah satu
karakter ditolak preflight & apply → preflight → apply → readback → apply ulang → rollback ditolak saat
average aktif → rollback (isi fungsi kembali persis) → preflight → apply → readback → suite SQL produksi
+ jejak I08/I09.
