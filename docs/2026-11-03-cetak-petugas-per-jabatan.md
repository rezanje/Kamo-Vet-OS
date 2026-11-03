# Cetakan klinik: petugas per jabatan (Dokter / Groomer / Staff) — catatan teknis

Tanggal: 3 November 2026 · Dokumen: struk 80 mm, invoice A4, struk rombongan klinik.

## Latar

Grup klinik (Babibu, Aldi, Andri; disetujui Reza): kunjungan poli **Grooming** menyimpan groomer
sebagai PJ kunjungan (`visits.doctor_id`, pilihan "Groomer" di registrasi). Cetakan lalu menulis
"Dokter PJ: <groomer>". Pelanggan pernah salah menuduh dokter karena nama di struk tidak sesuai.
Kesepakatan: di cetakan, tampilkan petugas sesuai jabatan —

```
Dokter  : ...
Groomer : ...
Staff   : ...   (selain dokter & groomer: paramedis, kasir, kepala toko, dll.)
```

## Perubahan

`src/lib/petugas-cetak.ts` → `petugasCetak(visit, lines, kartu)` menggantikan `namaDokterPJ` di:

| Dokumen | Sebelum | Sesudah |
|---|---|---|
| `klinik/pembayaran/[visitId]/struk` | satu baris "Dokter PJ" | baris Dokter / Groomer / Staff |
| `klinik/pembayaran/[visitId]/invoice` | satu baris "Dokter PJ" | baris Dokter / Groomer / Staff |
| `klinik/pembayaran/[visitId]/struk-rombongan` | "Dokter PJ" per hewan | Dokter / Groomer / Staff per hewan |

Sumber orang: PJ kunjungan + `invoice_items.service_performers` (`doctor_id`, `staff_id`). Satu orang
sekali saja; kelompok kosong tidak dicetak; urutan tetap Dokter → Groomer → Staff. Nama per baris
tetap **satu blok di kepala dokumen**, bukan per baris (sejalan dengan keputusan 29 Okt).

Kelompok dari jabatan kartu karyawan (`employees.jabatan`, aturan `clinicalRoles` yang sama dengan
pemilih pelaksana): dokter → Dokter; groomer → Groomer; jabatan lain → Staff. Jabatan kosong atau
kartu tak terbaca → slot asal: slot dokter → Dokter, slot non-dokter → Staff, PJ kunjungan → Groomer
bila poli Grooming, selain itu Dokter. Kunjungan lama (hanya teks `visits.dokter`) ikut aturan slot PJ.

Nama: baris per item memakai nama tersimpan saat transaksi (`doctor_name`/`staff_name`), PJ memakai
kartu karyawan seperti sebelumnya. Gagal baca kartu → dokumen tidak dicetak (galat), sama dengan
perilaku `bacaNamaDokter`.

Tidak ada migrasi basis data. Struk petshop (`kasir/struk`, `pos/struk`) **tidak** diubah —
masih tanpa nama petugas sesuai keputusan 29 Okt.

## Tes

- `src/lib/petugas-cetak.test.ts` — pengelompokan, urutan, dedup, jatuh ke slot, nama tersimpan.
- `src/components/__tests__/clinic-service-performer-receipts.test.tsx` — ketiga dokumen: kunjungan
  biasa, kunjungan grooming (groomer PJ tidak pernah tercetak sebagai Dokter), data lama, tanpa petugas.
- Seluruh suite vitest, `tsc --noEmit`, eslint berkas terkait, `next build`: lulus.

## Belum

- Belum dicek di Production dengan data nyata.
- Registrasi poli Grooming masih menyimpan groomer sebagai PJ. Andri: "setiap poli wajib ke dokter";
  Babibu setuju alternatif "grooming tetap pilih poli umum dulu". Cetakan sudah benar untuk kedua cara.
  **Keputusan Reza 3 Nov 2026: opsi A — registrasi tidak diubah**, petugas boleh pakai poli Grooming
  atau Poli Umum.
