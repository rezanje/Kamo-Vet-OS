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
Migrasi aman untuk kode lama: menambah kolom/tabel/fungsi dan menyesuaikan 3 fungsi persediaan supaya harga
dari penerimaan yang dibatalkan tidak lagi dipakai sebagai patokan HPP; tidak mengubah data yang ada.

## File

| File | Menulis? | sha256 |
|---|---|---|
| `supabase/migrations/20261028190000_goods_receipt_cancellation.sql` | (isi dari 02) | `3805bfe42bf0fbfaa4a5521d8ee0841c73efd851032e14afa3dc771af6eb6baa` |
| `01-preflight-readonly.sql` | tidak | `2ee1d0bfa408e27f4455d579703217673c20413b5f420f095adb95d112824e22` |
| `02-apply.sql` | **ya** — migrasi persis + baris riwayat, satu transaksi | `64657b1b2cf3cad8dddec68e2e120b2ac816968201255f61abbb55485082a045` |
| `03-readback-readonly.sql` | tidak | `f4f22744983e44b777a1af2e2802440a9d238e395306e080d46c974d0532b76b` |
| `04-rollback-only-if-unused.sql` | **ya** — hanya bila diputuskan rollback, sebelum ada penerimaan dibatalkan; mengembalikan 4 fungsi yang disesuaikan persis seperti semula | `6a71a11c07a51b00ddbc3d1d6abbbe367d95f01c706522851e407a524a07aadf` |
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
