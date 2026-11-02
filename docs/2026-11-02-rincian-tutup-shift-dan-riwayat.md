# Rincian Tutup Shift + Riwayat Tutup Shift (2 Nov 2026)

## Permintaan (2 VN pemilik toko ke Reza, 2 Nov 2026 14.05 & 14.07 + gambar contoh)

1. **Laporan tutup shift dilengkapi** sesuai gambar contoh: omset, pembayaran tunai lalu non-tunai
   (dirinci per metode), pengeluaran, total kas seharusnya, kas fisik yang dihitung toko, selisih kas.
   Tambahan: ringkasan omset bulan vs target bulanan dan pencapaian target harian. "Yang penting closingan
   hari ini sudah ada total penjualan biar anak toko nggak bingung."
2. **Akses melihat riwayat tutup shift.** Selama ini anak toko memfoto layar tutup shift ke grup; foto bisa
   tidak terunduh dan riwayatnya hilang. Minta menu riwayat yang kalau diklik membuka tampilan yang sama.

## Yang dibuat

| Bagian | Lokasi |
|---|---|
| Rumus murni (pecah tunai/non-tunai, target cabang, pencapaian bulanan/harian) | `src/lib/rincian-tutup-shift.ts` |
| Pemuat data satu shift (dipakai layar kasir & backoffice) | `src/lib/rincian-tutup-shift-server.ts` |
| Kartu tampilan (mengikuti gambar contoh) | `src/components/RincianTutupShift.tsx` |
| Layar kasir sesudah tutup shift (yang difoto ke grup) | `src/app/kasir/tutup/[shiftId]/page.tsx` |
| Laporan satu shift dari backoffice (bisa dicetak / PDF) | `src/app/(app)/pos/shift/[id]/page.tsx` |
| **Baru:** Riwayat Tutup Shift (filter cabang, jenis, rentang tanggal; 30 per halaman) | `src/app/(app)/pos/shift/riwayat/page.tsx` |
| Menu "Riwayat Tutup Shift" di grup POS dan Laporan; tombol "Lihat semua riwayat" di Shift Kasir | `src/lib/nav.ts`, `src/app/(app)/pos/shift/page.tsx` |

## Definisi angka

- **Omset shift ini** = jumlah rekap metode bayar yang dikunci saat shift ditutup (`closing_breakdown`):
  tunai + semua non-tunai. Dibuka ulang dari riwayat → angka sama dengan yang difoto.
- **Pengeluaran** = pengeluaran tunai shift (yang mengurangi laci). Pengeluaran yang dibayar dari rekening
  ditampilkan sebagai catatan kecil, tidak ikut mengurangi kas seharusnya — sama seperti rumus tutup shift.
- **Total kas seharusnya / kas fisik / selisih** = nilai tersimpan di shift (tidak dihitung ulang).
- **Omset bulan ini** = total struk penjualan petshop yang selesai (tidak dibatalkan, pembayaran berjadwal
  sudah final) di cabang itu, dari awal bulan (batas periode WIB yang sama dengan komisi/target) sampai jam
  shift ditutup. Semua kasir cabang itu ikut dihitung.
- **Penjualan hari ini** = bagian omset bulan yang jatuh di tanggal (WIB) shift ditutup, sampai jam tutup.
  Kalau sehari ada dua shift, shift sore menampilkan total sehari penuh.
- **Target bulan** = baris Target Penjualan periode itu yang cakupannya persis cabang tersebut
  (tanpa karyawan, tanpa kategori), diukur dari omzet. Target seluruh perusahaan **tidak** dipakai sebagai
  target cabang. Tidak ada target → kartu menulis "Target bulan ini belum diatur" (tanpa persen palsu).
- **Target harian** = target bulan ÷ jumlah hari kalender bulan itu.
- Bagian target hanya untuk shift **petshop** yang sudah ditutup. Shift klinik memakai kartu yang sama
  dengan judul "Uang masuk shift ini" tanpa bagian target.
- Kalau data penjualan bulan ini gagal dibaca, bagian target diganti pesan "belum dapat dibaca" — tidak
  pernah menampilkan angka nol yang menyesatkan.

Catatan: realisasi di layar Target Penjualan memakai rumus komisi (neto setelah potongan & retur, termasuk
klinik), jadi persennya bisa sedikit berbeda dari kartu ini yang memakai total struk toko.

## Akses

- Layar kasir sesudah tutup shift: hanya pemilik laci (tidak berubah).
- Riwayat & laporan per shift (`/pos/shift/...`): OWNER, ADMIN, FINANCE (jalur tambahan bawaan), dan peran
  lain yang diberi modul POS lewat Akses Grup. Daftar riwayat dibatasi cabang yang boleh dilihat akun itu;
  laporan satu shift dijaga aturan akses cabang basis data.
- Akun STAFF bawaan tidak punya akses backoffice. Kalau pelapor memakai akun STAFF, aksesnya diberikan
  lewat Pengaturan → Akses Grup (modul POS) atau dengan mengganti perannya — keputusan pemilik.

## Tes

- `src/lib/__tests__/rincian-tutup-shift.test.ts` — angka contoh (5 jt, 4 jt/1 jt, 10%, sisa 45 jt,
  1.666.667/hari, 300%), target cabang saja, tanpa target, bulan 28/29/30 hari.
- `src/components/__tests__/rincian-tutup-shift.test.tsx` — layar kasir, laporan backoffice (petshop & klinik),
  struk batal / belum final / sesudah jam tutup / cabang lain tidak dihitung, riwayat dibatasi cabang.

## Lanjutan 2 Nov malam — klinik disamakan (Reza 21.42)

Laporan Anisa (21.41): layar sesudah tutup shift **klinik** masih kartu lama (Kas dari invoice / QRIS "tidak masuk laci"),
petshop sudah kartu baru. Diminta klinik sama.

- `src/app/(app)/klinik/shift/[shiftId]/page.tsx` sekarang memakai `muatRincianTutupShift` + `RincianTutupShift` — kartu
  yang sama dengan `/kasir/tutup/[shiftId]` (uang masuk shift, modal awal, tunai, non-tunai per metode, pengeluaran, kas
  seharusnya, kas fisik, selisih). Hak lihat sama: hanya pemilik laci; atasan lewat Riwayat Tutup Shift.
- Bagian omset bulan vs target kini juga untuk shift klinik yang sudah ditutup. **Omset klinik** = total tagihan klinik
  (`invoices`, tidak dibatalkan) kunjungan di cabang itu, dari awal bulan sampai jam tutup shift, dipatok tanggal tagihan
  dibuat; "penjualan hari ini" = bagiannya di tanggal tutup shift. Target = baris Target Penjualan cabang itu (sama seperti
  petshop). Catatan kecil di kartu menjelaskan sumber angkanya.
- Catatan: untuk cabang BOTH, kartu petshop menghitung struk toko saja dan kartu klinik tagihan klinik saja.
- Tes: `src/components/__tests__/rincian-tutup-shift.test.tsx` — layar kasir klinik (kartu sama, tagihan batal / sesudah
  jam tutup / cabang lain tidak dihitung, hak lihat) dan laporan riwayat klinik dengan ringkasan omset.
