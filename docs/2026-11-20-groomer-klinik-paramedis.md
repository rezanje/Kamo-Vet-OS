# Isian Groomer di pendaftaran klinik: paramedis ikut ditawarkan (20 Nov 2026)

## Laporan
Anisa (grup klinik, 20 Nov 12.17): groomer Cimanggu **Ruliansyah** dan **Abdul Rafi** tidak ada di pilihan
"Groomer" pada Registrasi (poli Grooming), cabang `VET_CMGG`.

## Penyebab
Bukan data hilang dan bukan perubahan baru. Isian "Groomer" (`staffForService`) hanya menawarkan karyawan yang
**jabatan HRIS-nya memuat "Groomer"**. Keduanya aktif dan bertugas di `VET_CMGG`, tetapi jabatannya **Paramedis**:

| Karyawan | Jabatan | Cabang induk |
|---|---|---|
| RULIANSYAH SYAPUTRA (aa243b92-…) | Paramedis | VET_CMGG |
| ABDUL RAFI H (7c52f1eb-…) | Paramedis | VET_CMGG |

Tujuh nama yang muncul di tangkapan layar adalah groomer petshop ("Staff Toko - Groomer") yang ditugaskan lintas
cabang, bukan yang mengerjakan grooming di klinik Cimanggu.

## Bukti dari data Production (baca saja, 30 hari terakhir)
Kunjungan poli Grooming dan isi kolom Groomer saat pendaftaran (`visits.doctor_id`):

| Cabang | Kunjungan grooming | Groomer kosong | Terisi |
|---|---|---|---|
| VET_CMGG | 107 | 107 | 0 |
| VET_GRND | 70 | 66 | 4 |
| VET_CMS | 62 | 6 | 56 |
| VET_PDRY | 40 | 3 | 37 |
| VET_CIAW | 31 | 13 | 18 |
| VET_SRKN | 13 | 4 | 9 |

Pelaksana non-dokter pada baris tagihan kunjungan grooming (diisi kasir) didominasi paramedis di semua klinik:
VET_CMGG — Ruliansyah 40, Abdul Rafi 23, Faisal Maulana 15, Andhi Hardita 8, Agus Gunawan 5, M Ilham 3, Muamar 2;
VET_CMS — Engkos Kosasih 49, M Abdul Aziz 2; VET_GRND — M Abdul Gofur 23, Elo Supriyatna 8;
VET_PDRY — Eirwan 11, Nazwa 6; VET_CIAW — Aceng 9, Acep 3; VET_SRKN — Defan 3, Subhan 2
(angka = jumlah kunjungan). Jadi di klinik sebagian besar grooming dikerjakan paramedis.

## Perubahan kode
- `src/lib/clinical-staff.ts` → `staffForService(…, "Grooming")`: groomer tetap paling atas, **paramedis menyusul**.
  Dokter dan jabatan lain tetap tidak ditawarkan. Poli medis tidak berubah (paramedis bukan pilihan Dokter).
  Dipakai dua layar: Registrasi (isian "Groomer") dan Rekam Medis (isian PJ kunjungan grooming).
- `src/lib/groomer-kunjungan.ts` → `headerGroomer`: PJ kunjungan poli Grooming yang bukan dokter tampil sebagai
  "Groomer" di header Rekam Medis. Tanpa ini header menulis "belum diisi" padahal paramedis baru saja dipilih.
- `RegistrasiForm.tsx`: teks bantu isian Groomer menyebut "groomer atau paramedis".

## Sengaja TIDAK diubah
- **Cetakan** (struk 80 mm, invoice A4, struk rombongan): tetap per jabatan sesuai kesepakatan 3 Nov
  (`docs/2026-11-03-cetak-petugas-per-jabatan.md`). Paramedis yang dipilih sebagai groomer tercetak di baris
  **Staff**, sama seperti sekarang saat ia dipilih kasir sebagai pelaksana baris.
- **Pelaksana per baris di kasir** dan pagar database layanan berkategori "Grooming"
  (`enforce_branch_grooming_performers`): tidak disentuh. Catatan: 17 jasa grooming di master saat ini berkategori
  "Konsultasi", jadi pagar itu memang tidak pernah aktif dan kasir sudah bisa memilih paramedis.
- **Komisi / insentif**: tidak ada aturan yang bergeser. Tidak ada migrasi basis data. Jabatan HRIS tidak diubah.

## Tes
- `src/lib/clinical-staff.test.ts`, `src/lib/employee-occupation.test.ts` — urutan groomer → paramedis; poli medis tetap.
- `src/lib/groomer-kunjungan.test.ts` — paramedis PJ poli Grooming = Groomer; dokter PJ tidak; poli lain tetap.
- `src/app/(app)/klinik/registrasi/__tests__/dokter-pemeriksa.test.tsx` — isi dropdown Groomer di layar.
- Seluruh suite vitest (9.853 lulus), `tsc --noEmit`, eslint berkas terkait: lulus.

## Belum
- Belum dirilis ke Production saat catatan ini ditulis; belum dicek dengan akun klinik sungguhan.
- Groomer/paramedis yang dipilih saat pendaftaran **belum otomatis terisi** sebagai pelaksana baris di kasir
  (isian awal kasir hanya mengisi slot Dokter). Kasir masih memilih pelaksana per baris seperti biasa.
- Alternatif tanpa kode yang tidak diambil: HR mengubah jabatan menjadi "Paramedis - Groomer". Tidak dipilih karena
  harus dirawat per orang (17 paramedis tercatat menggroming sebulan terakhir) dan membuat mereka tercetak
  "Groomer" juga pada kunjungan medis.
