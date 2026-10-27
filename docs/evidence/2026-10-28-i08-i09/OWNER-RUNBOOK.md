# I08/I09 — paket DB untuk owner

Belum ada yang dijalankan ke production. Jalankan hanya setelah keputusan rilis, dengan akses owner yang
sudah ada, di SQL editor Supabase production, berurutan; berhenti bila ada langkah yang tidak sesuai.

| Langkah | File | Menulis? | sha256 |
|---|---|---|---|
| 1 | `preflight.sql` | tidak | `3fb5353b8ca6450f3a0c450380fd5c26d9c08908071b176a939fe80144dce0b5` |
| 2 | `apply.sql` (= tiga migrasi `20261028200000`, `…201000`, `…202000`, satu transaksi, aman diulang) | ya | `72c3fba63f864867e244d67191b7ae74cc0951ed400b90f9d54627e5eada65b4` |
| 3 | `readback.sql` | tidak | `79aaba0ef8b78a3ce329f1a8198fb2648c1bccc4f9200a42a189a36b20b72b69` |
| — | `rollback.sql` (hanya bila diputuskan mundur) | ya | `79cdba8567773198251a3533aa183f2e12b17f676b9c27ff42698e0bf8922595` |

1. `preflight.sql`: enam baris pertama harus `ok = true`. Baris informasi terakhir hanya dicatat
   (metode biaya, jumlah produksi, apakah RPC jejak sudah ada).
2. `apply.sql`: satu transaksi. Gagal = database tetap seperti sebelumnya. Penjaga asal-usul menolak
   bila isi fungsi produksi di production berbeda dari main.
3. `readback.sql`: semua baris `ok = true`.
4. Deploy aplikasi sesudah langkah 3. Urutan sebaliknya aman: layar jejak racikan menampilkan "belum
   dapat diperiksa" dan panel pekerjaan→penyelesaian produksi baru muncul setelah DB diterapkan.

Rollback: mengembalikan isi fungsi tepat seperti sebelum apply (diuji dengan sidik md5), menghapus RPC
jejak racikan. Tidak menyentuh baris data. Menolak bila metode average aktif dan ada produksi berjalan.

Gladi: `python3 docs/evidence/2026-10-28-i08-i09/build-and-rehearse.py` (pakai runner Docker repo; tanpa
Docker lewat pembungkus native). Hasil: `rehearsal-pg16.log`, `rehearsal-pg17.log` — preflight → apply →
readback → apply ulang → rollback (isi fungsi kembali persis) → preflight → apply → readback → suite SQL
produksi + jejak I08/I09.
