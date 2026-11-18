# Peran "Admin Online" (ADMIN_ONLINE)

Permintaan Andri (17-18 Nov 2026): akun khusus yang **hanya** bisa memasukkan penjualan marketplace online.

## Yang bisa dan tidak bisa
- Bisa: membuka satu layar, **Penjualan → Online → Impor pesanan Shopee** (`/penjualan/online/impor`): unggah ekspor Shopee, lihat pratinjau, simpan. Setelah login langsung ke layar ini.
- Tidak bisa: Dashboard/angka keuangan, Kasir/POS, Klinik, CRM, HRIS, Pengaturan, Perusahaan, Buku Besar, Kas & Bank, Pembelian, Persediaan, Laporan, Keuangan, input online manual (`/penjualan/online/baru`), mengubah harga/master, membatalkan (void), pelanggan, faktur, mengganti peran.
- Cakupan: cabang yang ditugaskan ke akun (Pengaturan → Pengguna), gudang **Online atau Toko/Petshop** aktif cabang itu (gudang utama cabang seperti aturan impor Shopee). Channel marketplace saja (Shopee/Tokopedia/TikTok Shop; layar v1 hanya Shopee), tanpa pelanggan, nomor pesanan wajib dan tidak boleh ganda.

## Membuat akunnya
Pengaturan → Pengguna → Tambah: pilih **Admin Online**, pilih karyawan HRIS, **cabang wajib**. Ubah peran akun yang ada lewat Edit akun. Menu tidak bisa diatur di Akses Grup (baris "Terkunci").

## Penegakan (berlapis)
1. Aplikasi: `src/lib/admin-online.ts` (daftar putih jalur), `lib/akses.ts` (langit-langit sebelum aturan lain), middleware (303), layout (cangkang tanpa menu), `/mulai` + login, aksi impor memakai RPC khusus.
2. Database (migrasi `20261130100000` enum + `20261130100100` isi): RLS RESTRICTIVE baca di semua tabel (kecuali profil/penugasan sendiri) + Storage; pemicu tulis di semua tabel (hanya transaksi `post_online_order` yang punya izin); gerbang di `post_online_order`; RPC baca-terbatas (tanpa HPP/harga beli); penjaga `deny_admin_online()` di 287 fungsi SECURITY DEFINER; penanda `role_modules`.
3. Tes: `scripts/test-admin-online-postgres.py` (native PG17, 84 assertion, 19 mutan), `src/lib/__tests__/admin-online*.test.ts` (menu, matriks rute, snapshot peran lain, aksi impor).

Fungsi SECURITY DEFINER **baru** yang ditambahkan nanti harus ikut diberi `perform admin_online_private.deny_admin_online();` di baris pertama (atau masuk daftar pengecualian beralasan); tes native gagal bila tidak. Rollback: `ROLLBACK.sql` di folder bukti rilis.
