# Usulan E3 — akses khusus Penjualan Online per akun (meeting 12 Nov 2026)

Status: **usulan desain, menunggu keputusan Reza.** Belum ada kode/migrasi.

## Kondisi sekarang (hasil investigasi)
- Hak buka menu diatur **per peran** (5 peran tetap: OWNER, ADMIN, FINANCE, STAFF, DOCTOR) lewat Akses Grup:
  modul (`role_modules`) + sub-menu (`role_settings_private.submenu_policies`) + tindakan bisnis (`action_policies`).
  Satu tempat keputusan di aplikasi: `src/lib/akses.ts` (dipakai sidebar & middleware).
- Penjualan Online = sub-menu `penjualan.online` (`/penjualan/online`, termasuk impor Shopee) di modul **Penjualan**.
- Penyimpanan pesanan online (`post_online_order`, pencairan) **tidak** memeriksa peran di database — hanya login aktif
  dan akses cabang/gudang. Jadi pembatasan "siapa boleh buka Penjualan Online" murni di level menu/halaman.
- Akun ↔ karyawan sudah terhubung (`employees.profile_id`) — insentif tetap jalan apa pun aksesnya.
- STAFF bawaan hanya modul Klinik; memberi modul Penjualan ke peran STAFF = **semua** staff ikut dapat (masalah di to-do).

## Pilihan desain
**A. Akses khusus per akun (saran).** Di halaman akun pengguna, Owner memilih salah satu mode:
1. *Ikuti peran* (bawaan, perilaku sekarang);
2. *Peran + tambahan*: akses peran ditambah modul/sub-menu yang dicentang khusus untuk akun ini;
3. *Hanya akses khusus*: akun ini hanya bisa membuka modul/sub-menu yang dicentang (mis. hanya Penjualan › Penjualan Online),
   akses peran untuk menu diabaikan.

Aturan: hanya Owner yang mengatur; tiap perubahan tercatat (siapa, kapan, sebelum/sesudah); tidak bisa memberi akses yang
memang dijaga database untuk peran tertentu (tindakan bisnis tetap mengikuti peran); akses cabang tetap lewat pengaturan
cabang akun yang sudah ada; akun tetap terhubung ke data karyawan.

**B. Peran baru "ONLINE".** Sederhana di layar, tetapi peran adalah tipe tetap di database yang dipakai ratusan aturan
(mis. pengecekan OWNER/ADMIN/STAFF). Menambah peran berisiko tinggi dan lambat diuji. Tidak disarankan.

**C. Batasi sub-menu peran STAFF.** Tidak menyelesaikan masalah: semua STAFF ikut berubah.

## Perubahan teknis bila A disetujui
- Migrasi: tabel privat `role_settings_private.user_access_overrides(profile_id, mode, modules jsonb, updated_by, …)`
  + RPC baca `get_my_access_override()` + RPC simpan atomik khusus Owner (dengan riwayat), pola sama dengan Akses Grup.
- `akses.ts`/middleware/sidebar: hitung akses efektif = peran ⊕ override akun (mode 2: gabung, mode 3: ganti); gagal baca
  override = ikuti peran (tidak pernah memperluas akses karena galat).
- Layar: bagian "Akses khusus akun ini" di halaman Pengaturan › Akun Pengguna (daftar modul & sub-menu sama dengan Akses Grup).
- Tes: matriks mode × peran, gagal baca, middleware & sidebar sinkron, audit.
- Perkiraan: 1–1,5 hari kerja termasuk tes database lokal.

## Keputusan yang dibutuhkan
1. Desain: **A** (saran) / B / C.
2. Peran dasar akun staf online: **STAFF** (saran; aman, hak tindakan minimal) / ADMIN.
3. Mode yang disediakan: **ketiganya** (saran) / hanya "Hanya akses khusus".
