# SOAP wajib di rekam medis poli (10 Nov 2026)

## Laporan
Andri (grup klinik): pasien Nala (VET_CMGG, Poli Umum, drh. Zakiy) masuk rawat inap dengan anamnesa & diagnosa
kosong — "bukannya dulu dikunci?". Permintaan klinik: komponen SOAP tidak boleh terlewat karena rekam medis
dibaca dokter lain saat pasien kembali.

## Akar masalah
- Kunci yang ada sejak 5 Okt (`clinic_required_fields`) hanya **dokter PJ + keluhan** (UI, server action,
  dan RPC `clinic_save_initial_record`). Keluhan sudah diisi admin saat registrasi → syarat terpenuhi.
- Kesiapan rawat inap (`clinicAdmissionReadiness` / `clinic_admit_inpatient`) hanya mengecek rekam medis ada,
  dokter, dan persetujuan rawat inap — tidak memeriksa isi anamnesa/diagnosa.
- Jadi bukan regresi; anamnesa memang belum pernah wajib.

## Aturan baru (poli medis; grooming & penitipan dikecualikan)
| SOAP | Field | Wajib |
|---|---|---|
| S | Keluhan | ya (sudah ada) |
| S | Anamnesa | ya |
| O | Gejala klinis / temuan pemeriksaan fisik | ya (berat, suhu, penunjang tetap opsional) |
| A | Diagnosa | ya |
| P | Terapi / tindakan | ya, **kecuali** sudah ada obat/jasa/tindakan/racikan di keranjang atau follow up |

Teks hanya-spasi dianggap kosong.

## Perubahan
- `src/lib/clinic-required-fields.ts`: `validateSoapCompletion` + `SOAP_MESSAGES`.
- `simpanRekamMedis`: validasi SOAP setelah dokter/keluhan, sebelum RPC apa pun (tidak ada tulisan bila ditolak).
- `RekamForm`: atribut `required` + tanda `*` pada anamnesa, gejala klinis, diagnosa; terapi `required` selama
  keranjang & follow up kosong. Berlaku juga di layar koreksi/edit (field tidak bisa dikosongkan lewat UI;
  rekam medis lama yang kosong harus dilengkapi saat dikoreksi).

## Uji
- Baru: `src/lib/__tests__/clinic-soap-wajib.test.ts`; tambahan di `clinic-form-save-results.test.ts`
  dan `clinic-pos-categories.test.tsx`.
- Fixture form simpan lama ditambah isi SOAP (perilaku lain tidak berubah).
- `npm test` 882 file lulus; `tsc --noEmit` bersih; `npm run lint` 0 error; `npm run build` sukses.

## Belum dikerjakan / catatan
- Tidak ada perubahan database. Kunci level database (RPC `clinic_save_initial_record`) masih hanya dokter+keluhan;
  bisa ditambah migrasi patch-anchor terpisah bila perlu pertahanan berlapis (butuh akses Supabase untuk pasang).
- Server action koreksi (`koreksiRekamMedis`, `koreksiRekamMedisLengkap`) belum memvalidasi SOAP di server;
  penjagaan koreksi saat ini lewat form.
- Rekam medis lama (termasuk Nala) tidak diubah otomatis; dokter melengkapi lewat koreksi/adendum.
- Catatan harian rawat inap tidak termasuk cakupan ini.
