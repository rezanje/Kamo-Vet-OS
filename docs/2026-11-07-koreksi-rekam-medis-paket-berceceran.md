# Paket berceceran di tagihan sesudah koreksi rekam medis — 7 November 2026

**Pelapor:** Anisa (grup Kamo Group – ERP Dev, 19.51–19.53). "Pas input kimia darah kan dia grouping ya. Itu di
invoicenya malah berceceran. Bukan yang inputannya 1 kimia darah gitu."

## Temuan di Production

Kunjungan `799e9ae0…` (CMGG-A007, Kamo Pets Clinic Cimanggu, dokter Novia):

| Waktu (UTC) | Kejadian |
| --- | --- |
| 12:21:07 | Rekam medis disimpan; paket Kimia Darah Lengkap dipilih dokter (5 isi, harga hasil pembagian paket). |
| 12:26:44 | Dokter mengoreksi rekam medis (alasan "koreksi rekmed", menambah diagnosis) → 5 baris isi paket di-*update*. |
| 12:51 | Video Anisa: kasir rawat inap menampilkan isi paket sebagai baris-baris biasa. |
| 13:01:12 | Kasir (Nabilla) mengonfirmasi keranjang rawat inap: 5 baris lama ditarik ("Konfirmasi keranjang rawat inap"), 5 baris baru dengan asal paket dibuat. Invoice `eac25e03…` akhirnya tersimpan dengan asal paket. |

Semua 5 baris yang tersimpan 12:21 kini `package_item_id = NULL`. Kunjungan lain sejak 3 Nov yang memilih paket ini
tanpa koreksi tetap membawa asal paket — masalahnya khusus jalur koreksi.

## Akar masalah

Form koreksi lengkap rekam medis (`?edit=`) memuat baris resep tersimpan ke keranjang, tetapi:

- `page.tsx` tidak membaca `package_item_id` / `package_qty` / nama paket dari `prescription_items`;
- `RekamForm` tidak memetakan asal paket ke `paket_id/paket_nama/paket_qty` keranjang.

Saat disimpan, `clinic_edit_queued_record` meng-*update* setiap baris lama dengan
`package_item_id = nullif(row->>'package_item_id','')` → asal paket terhapus. Database bekerja sesuai kontrak
(asal paket hanya dari niat eksplisit, tidak ditebak dari harga) — yang hilang adalah kiriman dari form.

## Perubahan (aplikasi saja, tanpa migrasi)

- `src/app/(app)/klinik/rekam-medis/[visitId]/page.tsx`: bacaan resep tersimpan ikut membawa `package_item_id`,
  `package_qty`, dan nama paket (`items!prescription_items_package_item_id_fkey`).
- `src/lib/clinical-correction.ts`: tipe baris koreksi ditambah asal paket; fungsi `savedPackageOrigin` mengubah asal
  paket tersimpan menjadi isian paket keranjang (racikan / qty rusak tetap baris biasa).
- `RekamForm`: keranjang koreksi memakai `savedPackageOrigin` → paket tampil satu baris (komponen `BarisPaket`) dan
  asal paket terkirim lagi lewat jalur `clinicPackageOriginInput` yang sudah ada.

## Data

Invoice kunjungan di atas sudah benar (diperbaiki kasir saat konfirmasi). Tidak ada perbaikan data yang diperlukan.
Baris yang tertarik (12:21) tetap sebagai jejak dan tidak ikut tagihan.

## Tes

- `src/components/__tests__/koreksi-rekam-medis-paket.test.tsx` (baru): pemetaan asal paket (relasi objek/larik,
  qty teks/angka, racikan & qty tidak sah), koreksi menampilkan satu baris paket dan mengirim ulang asal paket.
  Tes ini gagal tanpa perubahan `RekamForm`.
- Regresi: seluruh suite `npm test` (849 file lulus), `npm run lint` (0 error, 12 peringatan lama), `tsc --noEmit`,
  `npm run build`.

## Batasan

- Belum diuji ulang di Production oleh dokter/kasir (butuh kunjungan nyata dengan paket + koreksi).
- Baris yang **sudah** kehilangan asal paket sebelum perbaikan ini tidak dikenali ulang otomatis; kasir bisa
  menandainya lewat "Asal paket" atau memilih ulang paket (seperti yang dilakukan kasir 7 Nov).
