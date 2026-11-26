# Kop Rekam Medis per cabang (logo, nama, alamat, telepon)

Permintaan Andri (26 Nov 2026): rekam medis harus tercetak sesuai cabang kunjungannya (mis. Kamo Pets Clinic Cimanggu), bukan kop tetap "KAMO PET CARE".

## Yang berubah
- **Database** (migrasi `20261215100000_cabang_identitas_dokumen.sql`, aditif, tanpa mengisi data): `public.branches` mendapat kolom `alamat`, `telepon`, `logo_path` (semua boleh kosong).
  Nama cabang tetap kolom `name` (diubah di Perusahaan > Cabang).
  - Menulis ketiga kolom hanya lewat `update_branch_identity(...)` (SECURITY DEFINER, hanya OWNER/ADMIN aktif, Admin Online ditolak, jejak ke `clinic_private.master_edit_audit`). Pemicu `a00_guard_branch_identity_edit` menolak penulisan langsung dari akun login (kebijakan `branches_update` memakai `USING true`).
  - Logo disimpan di bucket `dokumen`, awalan `cabang-logo/<id cabang>/`. Tiga kebijakan RESTRICTIVE hanya untuk awalan itu: unggah hanya OWNER/ADMIN dengan nama yang sah, hapus hanya OWNER/ADMIN, ubah ditolak. Baca tetap lewat `dokumen_read` (semua akun internal; Admin Online ditolak pagar lama). Kebijakan lama dan awalan lain tidak berubah.
- **Layar** Pengaturan > Cabang, bagian 01 "Identitas cabang di dokumen cetak": per cabang klinik ada alamat, telepon, logo (PNG/JPG/WEBP maks. 1 MB, pratinjau, hapus) dan pratinjau kop. Nama cabang: tautan ke Perusahaan > Cabang.
- **Dokumen** `/klinik/rekam-medis/[visitId]/dokumen`: kop memakai identitas CABANG KUNJUNGAN (bukan cabang yang sedang dipilih pengguna). Logo lewat tautan bertanda tangan dibuat di server (1 jam). Tanpa logo: logo cakar lama. Tanpa alamat/telepon: tagline lama. Kunjungan tanpa cabang (impor lama): "KAMO PET CARE". Gagal membaca identitas tidak pernah menggagalkan cetak. Ukuran logo dan kolom kop tidak berubah (tetap satu halaman A4).

## Dokumen klinik yang masih memakai kop lama
- Resep (`/klinik/rekam-medis/[visitId]/resep`) dan Formulir persetujuan (`/klinik/consent/[consentId]`): merek "KAMO PET CARE" tetap, nama cabang hanya baris kecil.
- Pesan WhatsApp rawat inap (`src/lib/inpatient.ts`) dan halaman booking publik masih menyebut "KAMO PET CARE".
- Faktur/struk/kwitansi klinik sudah memakai nama cabang penerbitnya (print-branch-heading), tanpa logo/alamat.

## Rollback
`ROLLBACK.sql` ada di folder cadangan (prod-backups/cabang-identitas-*). Menghapus kolom = alamat/telepon/logo yang sudah diisi hilang; berkas logo di storage tidak ikut terhapus. Kode aplikasi harus dikembalikan juga.
