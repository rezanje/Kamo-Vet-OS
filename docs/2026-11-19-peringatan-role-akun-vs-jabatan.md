# Peringatan role akun vs jabatan HRIS (19 Nov 2026)

## Laporan
HR mengganti jabatan karyawan (Amalia Nurhalida) dari Dokter ke Paramedis, tetapi menu login tidak berubah.

## Penyebab
Jabatan HRIS (`employees.jabatan`) dan role akun login (`profiles.role`) memang terpisah; menu mengikuti role.
Akun Amalia dibuat dengan role **ADMIN** (bukan DOCTOR) dan tidak pernah diubah (`user_account_edits` kosong).

## Perbaikan data (19 Nov, atas persetujuan Reza)
- `profiles.role` Amalia (810772bc-…) ADMIN → STAFF, langsung di database. Cabang tidak diubah
  (Garuda, Gerlong, TKI, Pejuang). Karena tidak lewat RPC `edit_user_account`, perubahan ini
  **tidak tercatat** di `user_account_edits`; catatan ini sebagai jejaknya.

## Perubahan kode
- `src/lib/peran-vs-jabatan.ts`: aturan jabatan klinis → role lazim (Dokter → DOCTOR; Paramedis/Groomer → STAFF).
  Jabatan non-klinis tidak dinilai.
- HRIS → profil karyawan: banner peringatan + tautan ke edit akun bila role tidak cocok.
- Pengaturan → Pengguna: penanda kecil di kolom Role untuk akun yang tidak cocok.
- Tidak ada perubahan database / hak akses; hanya tampilan.

## Temuan lain (belum diubah, menunggu keputusan pemilik)
Akun aktif yang ditandai aturan ini per 19 Nov: Santhi Yanithasari (Paramedis, ADMIN),
Amanda Novita Sukmana (Paramedis, ADMIN). Aldiansyah Trisaputra (CEO, DOCTOR) tidak dinilai aturan,
tapi tampak tidak lazim.
