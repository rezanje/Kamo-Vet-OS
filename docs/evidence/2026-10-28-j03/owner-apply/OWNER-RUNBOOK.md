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
   refund/permintaan refund klinik, atau refund petshop yang sudah mengubah poin.

## Yang berubah di database

- Tabel baru: `clinic_refunds`, `clinic_refund_items`, `clinic_refund_requests` (RLS; tujuan rekening hanya lewat RPC).
- RPC: `post_clinic_refund`, `claim/complete/cancel_clinic_refund_request`, `get_clinic_refund_requests`, `get_clinic_refund_result`.
- Patch teks (dengan cek asal, seperti migrasi petshop J03): sumber refund klinik menerima baris jasa/tindakan(BMHP)/racikan
  sebagai "uang saja"; refund petshop tidak lagi menolak transaksi berpoin (poin dipakai dikembalikan, poin didapat dipotong,
  proporsional); kolom `sales_refund_payouts.point_restored`; nilai belanja pelanggan dikurangi refund klinik.
- Pengaman: invoice yang sudah direfund/diproses refund tidak bisa diedit/void; pengeluaran payout refund dan dokumen refund tidak bisa diubah.

## Gladi

`rehearsal-pg17.log`: PostgreSQL 17.11 lokal, 276 migrasi repo → preflight → apply → readback → apply ulang → readback →
rollback → preflight → apply → readback. Semua readback `0 failed`; sidik jari 4 fungsi yang di-patch sesudah rollback identik
dengan sebelum apply, dan tidak ada objek J03 tersisa.

| File | sha256 |
|---|---|
| `supabase/migrations/20261028140000_j03_clinic_refund.sql` | `6ecca79fb03b4bd5b94113399671298175c1b91737faedd2c224e28cd715548b` |
| `apply.sql` | `ed35718f97e265aee9b4cc9745cfc13c2baf2e4ede07c0c7dc7af8c217ffc42a` |
| `preflight.sql` | `818b20b7693baf33c9a7ed2da79da423f2305303d253fafc5d6e37bdb2c84365` |
| `readback.sql` | `4cddea36c0c2f6b55239a902bcb1e47507b3d0f6445859a86bee62cabfddf09f` |
| `rollback.sql` | `b294804ccb6f3bf04aaf6135b74ea4ed5338710f80f88b855e0e933e90ba380f` |
