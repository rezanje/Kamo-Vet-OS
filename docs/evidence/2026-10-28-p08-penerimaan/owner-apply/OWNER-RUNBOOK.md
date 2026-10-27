# P08 — pembatalan penerimaan barang (paket migrasi production)

Ringkas: Super Admin (OWNER) bisa membatalkan dokumen penerimaan barang yang salah, **hanya kalau aman**:
PO belum punya faktur pembelian aktif, belum ada retur/tutup sisa, dan barang dari penerimaan itu belum ada
yang terpakai atau keluar gudang (aturan sama dengan pembatalan faktur). Stok, jurnal persediaan, dan sisa PO
dibalik dalam satu transaksi; dokumen asli tetap ada dengan status **Dibatalkan** + jejak audit.
Kalau tidak aman, sistem menolak dan mengarahkan ke **Retur Pembelian**.
**Belum ada yang dijalankan ke production.** Berhenti di langkah mana pun yang hasilnya tidak sesuai.

Repo ini bisa terbaca pihak lain: jangan menulis ID project, waktu backup, jumlah data, atau keluaran query
production ke repo/PR.

## Urutan: migrasi dulu, baru merge kode

Layar penerimaan versi baru membaca kolom status batal. Kalau kode live sebelum migrasi, halaman penerimaan
gagal dimuat. Jadi: **01 → 02 → 03 → baru merge PR → tunggu deploy → cek layar.**
Migrasi aman untuk kode lama (hanya menambah kolom/tabel/fungsi; tidak mengubah data yang ada).

## File

| File | Menulis? | sha256 |
|---|---|---|
| `supabase/migrations/20261028120000_goods_receipt_cancellation.sql` | (isi dari 02) | `087abef2b035fe2982729c2e8f66b81228401861ed0bb64df576d03078b9ab28` |
| `01-preflight-readonly.sql` | tidak | `fd5a337318201d7f2ee9e7c0d2e43563bb6ad3224c72a23cb5d5ea5135fc929e` |
| `02-apply.sql` | **ya** — migrasi persis + baris riwayat, satu transaksi | `12a00e68e1da6ed0d766bc7ff095b934a1025dd0f813b5d864881ecd43ed11e4` |
| `03-readback-readonly.sql` | tidak | `e5750ecb65596a877019545b0208cee7f09a0926780addec3546b267754c69bc` |
| `04-rollback-only-if-unused.sql` | **ya** — hanya bila diputuskan rollback, sebelum ada penerimaan dibatalkan | `f50736e3ef4240d90df79eb515be9f3318395e4df964b6f6a902c0b8b11f548b` |
| `05-freeze-if-used.sql` | **ya** — menghentikan pembatalan baru, riwayat tetap | `e06cc7a9ece088ad0f837e898f97cdef735010390f08f3334abb31cbeaf7d7a5` |

`02` dihasilkan `build-and-verify.py`; jangan diedit tangan. Gladi lengkap (PostgreSQL 16, data fiktif):
`rehearsal-pg16.log`.

## Langkah (Supabase SQL editor, sebagai postgres)

1. Backup/PITR tersedia (catat di catatan privat).
2. Jalankan `01` (pilih hanya pernyataan `with checks … ;`). Baris terakhir harus `0 failed`.
3. Jalankan seluruh `02`. Kalau ada error, tidak ada yang berubah — berhenti dan laporkan.
4. Jalankan `03`. Baris terakhir harus `0 failed`.
5. Merge PR, tunggu deploy Production, lalu buka satu dokumen penerimaan sebagai Super Admin: tombol
   "Batalkan penerimaan (Super Admin)" muncul; sebagai peran lain tidak muncul.

## Kalau ada masalah

- Belum ada penerimaan yang dibatalkan → `04` (mengembalikan database ke kondisi sebelum 02).
- Sudah ada yang dibatalkan → `04` akan menolak; pakai `05` (hanya menutup tombol di sisi database).
