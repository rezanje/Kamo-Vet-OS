# Rekam medis di layar staf klinik (baca saja) — 20 Nov 2026

Pelapor: Aldi (grup Kamo Group - ERP Dev, 18.28): "rekam medis ini minta ditampilkan di menu frontend klinik
dan kasih akses lihat semua rekam medis tanpa akses edit".

## Temuan
- "Frontend klinik" = layar sambutan role STAFF (`StaffKlinikHome`, /klinik setelah mulai shift). Tile Rekam medis
  hanya ada di tile-grid admin (`ModuleHome`), jadi staf tidak punya pintu ke daftar rekam medis.
- Hak ubah rekam medis yang SUDAH tersimpan sudah terkunci untuk staf di database:
  `clinic_can_correct_record` (tombol Edit) mensyaratkan role DOCTOR aktif; adendum lewat `clinic_add_record_addendum`;
  impor rekam medis ditolak server untuk selain OWNER/ADMIN; "Perlu dilengkapi" dijaga `bolehKelolaKartuTertunda`.
- Form pemeriksaan untuk kunjungan yang sedang "Diperiksa" (alur antrian) TIDAK diubah — itu alur kerja harian.

## Perubahan
- `src/components/StaffKlinikHome.tsx`: kartu baru **REKAM MEDIS** → `/klinik/rekam-medis`
  ("Lihat riwayat rekam medis pasien (baca saja)"). Grid layar staf jadi 3 kolom (6 kartu = 2 baris).
- `src/app/(app)/klinik/rekam-medis/page.tsx`: untuk STAFF, tombol Perlu dilengkapi & Import disembunyikan dan
  diganti label "Baca saja". Peran dibaca sejajar dengan RPC daftar; gagal baca = tampilan lama (hanya tampilan,
  hak ubah tetap dijaga database).
- Tidak ada migrasi database.

## Cakupan "semua"
Staf melihat rekam medis cabang yang boleh ia akses (RLS `user_can_access_branch`), sama seperti sebelumnya.
Riwayat hasil impor (tanpa cabang) TIDAK ikut untuk staf — sesuai keputusan owner 9 Nov (migrasi
20261109100100: "Staf non-dokter TIDAK ikut"). Memperluasnya ke staf / lintas cabang butuh keputusan owner + migrasi RLS.

## Uji
- `src/components/__tests__/clinic-shift-entry.test.tsx` — kartu REKAM MEDIS di layar staf.
- `src/lib/__tests__/rekam-medis-staf-baca-saja.test.tsx` (baru) — STAFF: label Baca saja, tanpa Import/Perlu
  dilengkapi; OWNER/ADMIN/DOCTOR tidak berubah; peran gagal dibaca tidak menahan halaman.
- Seluruh vitest: 1039 file lulus (4 di-skip), 9859 tes lulus. `tsc --noEmit` bersih, eslint file terkait bersih.

## Belum diuji
- Belum dicoba di Production oleh staf langsung (UAT).
- Bila Akses Grup STAFF di Production membatasi sub-menu "Rekam medis", kartu akan mental — centang sub-menu itu.
