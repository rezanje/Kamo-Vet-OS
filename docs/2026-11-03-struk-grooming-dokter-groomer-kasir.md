# Struk & invoice grooming: Dokter Pemeriksa, Groomer, Kasir

Permintaan Babibu (grup klinik, 3 Nov 2026), foto struk gabungan Kamo Pets Clinic Ciomas:
"Ini untuk grooming, di INV apakah bisa tertulis: 1. Nama dokter pemeriksa 2. Groomer 3. Kasir —
kalau saat ini nama groomernya tertulis sebagai Dr PJ."

## Akar masalah

Sejak 29 Okt (permintaan Andri, `docs/2026-10-29-laporan-tenaga-penjual.md`) dokumen cetak klinik
hanya menyebut satu nama kepala: "Dokter PJ" = orang di `visits.doctor_id`. Pada registrasi poli
Grooming, kolom itu berlabel **Groomer** dan hanya menawarkan karyawan berjabatan groomer — jadi
groomer tercetak sebagai "Dokter PJ", dan dokter pemeriksanya tidak tercetak sama sekali.

## Perubahan

`src/lib/petugas-cetak.ts` — `petugasCetak(poli, dokterPJ, barisTagihan)`:

| Kunjungan | Yang dicetak (urut) |
|---|---|
| Poli Grooming | **Dokter Pemeriksa** = `doctor_name` unik dari cuplikan `invoice_items.service_performers`; **Groomer** = `staff_name` unik di baris layanan Grooming, atau (data lama tanpa cuplikan) orang dari registrasi; lalu **Kasir** |
| Poli lain | **Dokter PJ** seperti sebelumnya; **Groomer** ditambahkan hanya bila tagihan memuat layanan Grooming; lalu **Kasir** |

Baris layanan Grooming = `items.tindakan_kategori = 'Grooming'` (lewat `invoice_items_item_id_fkey`)
atau `prescription_items.kategori = 'Grooming'` (lewat `invoice_items_prescription_item_id_fkey`) —
aturan yang sama dengan trigger `enforce_branch_grooming_performers`, yang mewajibkan groomer (dan
dokter di cabang KLINIK/BOTH) pada baris itu. Nama diambil dari cuplikan saat transaksi, bukan
dibaca ulang dari data karyawan hari ini.

Kolom tambahan ikut dibaca di kueri rincian yang sudah ada (tidak ada kueri baru):
- `klinik/pembayaran/[visitId]/struk` (80 mm)
- `klinik/pembayaran/[visitId]/invoice` (A4)
- `klinik/pembayaran/[visitId]/struk-rombongan` (per hewan)

Pelaksana per baris item tetap **tidak** dicetak (keputusan Andri tetap berlaku). Tidak ada migrasi.

## Tes

- `src/lib/__tests__/petugas-cetak.test.ts` — aturan grooming / data lama / kategori resep / non-grooming.
- `src/components/__tests__/clinic-service-performer-receipts.test.tsx` — tiga dokumen: grooming
  mencetak Dokter Pemeriksa → Groomer → Kasir dan tidak lagi berlabel "Dokter PJ"; data lama
  grooming melabeli orang registrasi sebagai Groomer.
- Seluruh vitest (6541 lulus), `tsc --noEmit`, eslint (0 error), `next build` lulus.

## Belum diuji

- Cetak nyata di Production dengan data Ciomas (perlu dicek setelah deploy: buka struk gabungan
  kunjungan grooming, pastikan tiga nama tampil).
