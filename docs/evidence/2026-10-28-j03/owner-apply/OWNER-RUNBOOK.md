# J03 Refund klinik — paket DB untuk owner

Ringkas: satu migrasi (`supabase/migrations/20261028140000_j03_clinic_refund.sql`). **Belum dijalankan ke production.**
Jalankan sebelum merge PR J03 (aplikasi sudah aman bila DB belum diterapkan: panel refund klinik tidak muncul,
antrean finance petshop tetap jalan, laporan komisi tetap terbaca).

## Langkah

1. `preflight.sql` (hanya baca) — semua baris `ok = true`, baris terakhir `SUMMARY: 0 failed`.
   Dua cek lingkungan (akun 4201/4102/2201/1301/5101/5902 aktif, metode Tunai terpetakan ke akun Kas aktif)
   memang `false` di database uji kosong; di production harus `true`.
2. `apply.sql` — isi sama persis dengan file migrasi, dalam satu transaksi. Aman dijalankan dua kali.
3. `readback.sql` (hanya baca) — `SUMMARY: 0 failed`.
4. `rollback.sql` — hanya bila diputuskan mundur **sebelum** ada refund klinik dipakai. Menolak sendiri bila sudah ada
   refund/permintaan refund klinik, atau refund petshop yang sudah memotong poin.

## Yang berubah di database

- Tabel baru: `clinic_refunds`, `clinic_refund_items`, `clinic_refund_requests` (RLS; tujuan rekening hanya lewat RPC).
- RPC: `post_clinic_refund`, `claim/complete/cancel_clinic_refund_request`, `get_clinic_refund_requests`, `get_clinic_refund_result`.
- Patch teks (dengan cek asal, seperti migrasi petshop J03): sumber refund klinik menerima baris jasa/tindakan(BMHP)/racikan
  sebagai "uang saja"; refund petshop tidak lagi menolak transaksi berpoin (poin dipotong proporsional); nilai belanja
  pelanggan dikurangi refund klinik.
- Pengaman: invoice yang sudah direfund/diproses refund tidak bisa diedit/void; pengeluaran payout refund dan dokumen refund tidak bisa diubah.

## Gladi

`rehearsal-pg17.log`: PostgreSQL 17.11 lokal, 276 migrasi repo → preflight → apply → readback → apply ulang → readback →
rollback → preflight → apply → readback. Semua readback `0 failed`; preflight setelah rollback kembali sama seperti awal.

| File | sha256 |
|---|---|
| `supabase/migrations/20261028140000_j03_clinic_refund.sql` | `dcf9bf9e37e16383b775c477d2ccc596c329d0d01f39e6345444a707a20cb56e` |
| `apply.sql` | `e5c8f43e5498b6b9a47c91c73708135df8b9145e42abed1b27e954021c605aee` |
| `preflight.sql` | `818b20b7693baf33c9a7ed2da79da423f2305303d253fafc5d6e37bdb2c84365` |
| `readback.sql` | `531aad4fb1b6c6dbcd5ffb97ab778a2076240a88bf9eb74c75458ea05092ea81` |
| `rollback.sql` | `a6c0ec9b576730bdd6bcf5726764438e772c657f3614c8d83ea8139ec613bf6a` |
