# Peringatan role akun vs jabatan HRIS (19 Nov 2026)

## Laporan
HR mengganti jabatan karyawan (Amalia Nurhalida) dari Dokter ke Paramedis, tetapi menu login tidak berubah.

## Penyebab
Jabatan HRIS (`employees.jabatan`) dan role akun login (`profiles.role`) memang terpisah; menu mengikuti role.
Akun Amalia dibuat dengan role **ADMIN** (bukan DOCTOR) dan tidak pernah diubah (`user_account_edits` kosong).

## Perbaikan data (19 Nov, atas persetujuan pemilik)
- `profiles.role` Amalia (810772bc-…) ADMIN → STAFF, langsung di database. Cabang tidak diubah
  (Garuda, Gerlong, TKI, Pejuang). Karena tidak lewat RPC `edit_user_account`, perubahan ini
  **tidak tercatat** di `user_account_edits`; catatan ini sebagai jejaknya.

## Perubahan kode
- `src/lib/peran-vs-jabatan.ts`: aturan jabatan klinis → role lazim (Dokter → DOCTOR; Paramedis/Groomer → STAFF).
  Jabatan non-klinis tidak dinilai.
- HRIS → profil karyawan: banner peringatan + tautan ke edit akun bila role tidak cocok.
- Pengaturan → Pengguna: penanda kecil di kolom Role untuk akun yang tidak cocok.
- Tidak ada perubahan database / hak akses; hanya tampilan.

## Temuan lain dan tindak lanjut
Aturan ini juga menandai Santhi Yanithasari dan Amanda Novita Sukmana (Paramedis, ADMIN). Atas persetujuan
pemilik (19 Nov), keduanya diubah ADMIN → STAFF dengan cara yang sama (langsung di database, cabang tidak diubah,
tidak tercatat di `user_account_edits`). Aldiansyah Trisaputra (CEO, DOCTOR) tidak dinilai aturan dan tidak diubah.

## Ralat 20 Nov 2026 — Santhi dan Amanda dikembalikan ke ADMIN
Laporan klinik (20 Nov pagi): tim manajemen klinik kehilangan akses semua cabang.

- Penyebab: perubahan ADMIN → STAFF di atas (19 Nov 09:24 UTC). Jabatan HRIS keduanya memang Paramedis, tetapi
  pekerjaan hariannya adalah pembelian dan stok untuk semua klinik + DC (log aktivitas 30 Okt–19 Nov: ribuan
  baris `purchase_orders`, `purchase_invoices`, `goods_receipts`, `stock_transfers`, `stock_requests` di DC,
  PEJUANG, dan seluruh `VET_*`). Role STAFF hanya membuka modul klinik dan hanya cabang di `user_branches`
  (tanpa DC), jadi keduanya tidak bisa bekerja sejak perubahan itu; tidak ada aktivitas tercatat setelahnya.
- Perbaikan: `profiles.role` Santhi (ea4977ad-…) dan Amanda (bb847b92-…) STAFF → ADMIN, langsung di database
  (20 Nov 03:05 UTC), sama seperti kondisi sebelum 19 Nov. `user_branches` tidak diubah. Tidak tercatat di
  `user_account_edits`; catatan ini sebagai jejaknya. Amalia tetap STAFF (memang bertugas sebagai paramedis).
- Pelajaran: sebelum menurunkan role karena penanda "role tidak cocok jabatan", periksa dulu log aktivitas akun
  itu. Jabatan HRIS bisa tertinggal dari pekerjaan nyata; penanda adalah petunjuk, bukan perintah.
- Belum dikerjakan: jabatan HRIS Santhi dan Amanda masih "Paramedis", jadi penanda tetap muncul di HRIS dan
  Pengaturan → Pengguna. Perlu diputuskan HR/pemilik (ubah jabatan di HRIS, atau kecualikan dari aturan).

## Catatan terpisah 20 Nov — akun "Owner" hanya bisa Ciawi
Bukan akibat perubahan role. Akun bersama "Owner" punya shift klinik terbuka di VET_CIAW sejak 18 Nov 08:18 UTC
(dan shift petshop terbuka di CIAW sejak 19 Nov 12:18 UTC). Selama shift terbuka, pemilih cabang mengunci cabang
lain (`/mulai/cabang` + middleware, perilaku sejak sebelum 9 Nov). Menutup shift mengembalikan semua cabang.
