# Kop Rekam Medis per cabang (logo, nama, alamat, telepon)

Permintaan Andri (26 Nov 2026): rekam medis harus tercetak sesuai cabang kunjungannya (mis. Kamo Pets Clinic Cimanggu), bukan kop tetap "KAMO PET CARE".

## Yang berubah
- **Database** (migrasi `20261213050000_cabang_identitas_dokumen.sql`, aditif, tanpa mengisi data): `public.branches` mendapat kolom `alamat`, `telepon`, `logo_path` (semua boleh kosong).
  Nama cabang tetap kolom `name` (diubah di Perusahaan > Cabang).
  - Menulis ketiga kolom hanya lewat `update_branch_identity(...)` (SECURITY DEFINER, hanya OWNER/ADMIN aktif, Admin Online ditolak, jejak ke `clinic_private.master_edit_audit`). Pemicu `a00_guard_branch_identity_edit` menolak penulisan langsung dari akun login (kebijakan `branches_update` memakai `USING true`).
  - Logo disimpan di bucket `dokumen`, awalan `cabang-logo/<id cabang>/`. Tiga kebijakan RESTRICTIVE hanya untuk awalan itu: unggah hanya OWNER/ADMIN dengan nama yang sah, hapus hanya OWNER/ADMIN, ubah ditolak. Baca tetap lewat `dokumen_read` (semua akun internal; Admin Online ditolak pagar lama). Kebijakan lama dan awalan lain tidak berubah.
- **Layar** Pengaturan > Cabang, bagian 01 "Identitas cabang di dokumen cetak": per cabang klinik ada alamat, telepon, logo (PNG/JPG/WEBP maks. 1 MB, pratinjau, hapus) dan pratinjau kop. Nama cabang: tautan ke Perusahaan > Cabang.
- **Dokumen** `/klinik/rekam-medis/[visitId]/dokumen`: kop memakai identitas CABANG KUNJUNGAN (bukan cabang yang sedang dipilih pengguna). Logo lewat tautan bertanda tangan dibuat di server (1 jam). Tanpa logo: logo cakar lama. Tanpa alamat/telepon: tagline lama. Kunjungan tanpa cabang (impor lama): "KAMO PET CARE". Gagal membaca identitas tidak pernah menggagalkan cetak. Ukuran logo dan kolom kop tidak berubah (tetap satu halaman A4).

## Dokumen klinik yang memakai kop cabang (lanjutan, aplikasi saja, tanpa migrasi)
Satu aturan untuk semua: `src/lib/cabang-identitas-server.ts` (`bacaIdentitasKop`) dan tampilan `src/components/KopCabang.tsx`.
- **Invoice klinik** (`/klinik/pembayaran/[id]/invoice?invoice_id=...`): kiri logo + nama cabang + "alamat · Telp. telepon" milik cabang kunjungan INVOICE itu (bukan cabang yang sedang dipilih); kanan tetap INVOICE, nomor, tanggal, status. Tanpa logo: logo cakar. Tanpa alamat/telepon: baris itu dihilangkan. Cabang invoice tidak tercatat: "Cabang belum tercatat" seperti semula. A4, margin 14 mm, tombol "Cetak Invoice" tidak berubah.
- **Resep** (`/klinik/rekam-medis/[id]/resep`) dan **Formulir persetujuan** (`/klinik/consent/[id]`): kop yang sama dengan rekam medis (logo cabang, nama cabang, alamat/telepon; "KAMO PET CARE" hanya bila kunjungan tanpa cabang).
- Gagal membaca identitas atau gagal membuat tautan logo tidak pernah menggagalkan cetak: dokumen tetap tercetak dengan nama cabang.

## Dokumen yang sengaja belum memakai kop ini
- Struk/kwitansi klinik termal 80 mm (struk, struk rombongan, kwitansi rawat inap) dan struk petshop/kasir: kertas sempit, keputusan logo/alamat di struk menunggu Andri.
- Faktur penjualan (grosir/petshop), surat jalan permintaan stok dan pemindahan: cabang petshop belum bisa mengisi identitas (layar Pengaturan > Cabang hanya menampilkan cabang klinik).
- Pesan WhatsApp rawat inap (`src/lib/inpatient.ts`) dan halaman booking publik masih menyebut "KAMO PET CARE".

## Rollback
`ROLLBACK.sql` ada di folder cadangan (prod-backups/cabang-identitas-*). Menghapus kolom = alamat/telepon/logo yang sudah diisi hilang; berkas logo di storage tidak ikut terhapus. Kode aplikasi harus dikembalikan juga.
