# 2026-11-01 — Kasir tidak menemukan pelanggan, stok Panduraya, reset login Super Admin

Laporan grup "Kamo Group - ERP Dev" (Andri, 01/11/26).

## 1. Kasir: "Customer tidak ditemukan" tapi tambah baru ditolak "No HP sudah terdaftar"
- Penyebab: daftar pelanggan kasir dibaca dengan satu permintaan; server database membatasi 10.000 baris
  per permintaan. Produksi punya 10.398 pelanggan (urut nama), jadi ±400 pelanggan terakhir (mis. "Yayan",
  089685270100) tidak pernah sampai ke layar kasir. Cek duplikat HP saat tambah baru berjalan di server
  (tanpa batas), sehingga menolak.
- Perbaikan: `src/app/kasir/page.tsx` membaca pelanggan per halaman sampai habis (`readCompleteList`,
  tanpa batas). Pola sama diterapkan di form Tambah Anabul (`crm/anabul/baru`).
- Sisa (belum dikerjakan): pemilih pelanggan back-office masih memakai batas 500/2.000
  (`penjualan/faktur/baru`, `pesanan`, `penawaran`, `uang-muka`, `online/baru`, `crm/voucher`). Perlu
  diganti ke pencarian di server. Ringkasan transaksi per pelanggan di kasir (`sales`, `invoices`) juga
  akan terpotong setelah 10.000 baris — saat ini 12 penjualan, belum berdampak.

## 2. "Stok kosong di Panduraya, takut masuk gudang online"
- Hasil cek produksi (baca saja): gudang toko WH_PDRY (RETAIL) berisi 346 barang / 7.835,5 unit dari
  impor saldo awal Accurate 31-10-2026; WH_ONLINE_PDRY kosong; klinik WH_VET_PDRY terpisah. Kasir dan
  posting penjualan memilih gudang RETAIL lebih dulu — 2 penjualan 01-11 sudah memotong WH_PDRY.
- Barang yang tampil 0 (mis. Aatas Can 400g) memang tidak punya saldo di data impor PDRY. Tidak ada
  perubahan kode/data. Bila barang fisik ada tapi stok 0 → perlu penyesuaian/opname per barang.

## 3. Super Admin bisa ganti email / reset password karyawan (U13)
- Server aplikasi tidak punya kunci admin Supabase, jadi dipakai fungsi database `owner_reset_akun_login`
  (SECURITY DEFINER, hanya OWNER aktif). Password di-hash bcrypt (`crypt(..., gen_salt('bf',10))`),
  email diganti di `auth.users` + `auth.identities`, sesi lama dihapus (karyawan wajib masuk ulang).
- Riwayat `user_login_resets` hanya mencatat pelaku/waktu/apa yang diubah — tanpa email & password.
- UI: Pengaturan → Pengguna → Edit → bagian "Reset login (Super Admin)"; hanya tampil untuk OWNER.
- Migrasi: `supabase/migrations/20261106010000_owner_reset_akun_login.sql`.
- Tes: `scripts/test-owner-reset-akun-postgres.py` (PostgreSQL sekali-pakai, skema auth tiruan, 20 cek),
  `src/lib/__tests__/owner-reset-login-action.test.ts`.

## 4. Lanjutan (PR kedua) — CRM Pelanggan "melebihi batas 10.000 baris"
- Laporan Andri 09.40: CRM → Pelanggan menampilkan "Pelanggan melebihi batas 10.000 baris". Halaman itu
  memakai `readCompleteList` dengan batas bawaan 10.000 → sekarang `maxRows: null`.
- Helper baru `src/lib/pelanggan-semua.ts` (`semuaPelanggan`) membaca semua pelanggan per halaman; dipakai
  di POS transaksi (klinik), voucher CRM, faktur jual baru, pesanan, penawaran, uang muka, order online
  (sebelumnya terpotong 500/2.000/10.000 nama pertama).
- Catatan kinerja: halaman-halaman ini mengirim seluruh daftar pelanggan ke browser. Aman untuk ~10–20 ribu,
  tapi jangka panjang perlu diganti pencarian di server.
