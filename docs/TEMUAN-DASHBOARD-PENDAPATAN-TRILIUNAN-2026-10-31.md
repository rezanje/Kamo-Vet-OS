# Temuan: dashboard pendapatan Rp 8.113 M (31 Okt 2026)

Keluhan (screenshot Reza): Dashboard → Keuangan menampilkan Pendapatan Rp 8113,26 M dan
Laba bersih Rp 8113,24 M, margin 100%.

## Fakta dari database live (dibaca saja)

Pendapatan tahun berjalan per akun (jurnal aktif):

| Akun | Saldo |
|---|---|
| 4303 Pendapatan Lain-lain | Rp 8.113.221.339.271 |
| 4201 Pendapatan Jasa Klinik | Rp 22.464.000 |
| 4101 Pendapatan Penjualan Produk | Rp 14.570.000 |
| 4102 Diskon Penjualan | −Rp 153.000 |

Seluruh lonjakan berasal dari jurnal **"Kelebihan kas tutup shift"** (Dr Kas / Cr 4303). Uang fisik
yang diketik saat tutup shift tidak masuk akal, dan sistem menjurnal selisihnya otomatis:

| Jurnal | Tanggal | Cabang | Target kas | Uang fisik diketik | Kas lebih |
|---|---|---|---|---|---|
| JRN-202610-0314 | 31 Okt | Petshop Panduraya | 20.000 | 8.098.098.980.809 | 8.098.098.960.809 |
| JRN-202610-0099 | 27 Okt | Petshop Panduraya | 1.000.000 | 12.233.342.452 | 12.232.342.452 |
| JRN-202610-0166-J6YM | 30 Okt | Petshop Panduraya | 25.111 | 1.000.000.000 | 999.974.889 |
| JRN-202610-0096 | 27 Okt | Petshop Panduraya | 201.000 | 1.000.000.000 | 999.799.000 |
| JRN-202610-0001-3OJ7 | 27 Okt | Petshop Ciawi | 10.000 | 879.877.887 | 879.867.887 |

Kelima shift dibuka akun **Owner** (pola uji coba). Lima jurnal ini = Rp 8.113,17 M. Tanpa itu,
pendapatan tahun berjalan ±Rp 36,9 jt.

Selisih lain yang lebih kecil tapi juga berpola uji (semua akun Owner): kas lebih 6.955.000, 1.923.123,
1.000.000, 500.000, 10.000, 1.111; kas kurang −7.053.500 (Klinik Panduraya, jadi kasbon "Owner"
lewat 1203), −1.380.000, −1.125.500, −1.085.000, −993.000, dll. Belum disentuh — perlu keputusan.

Dashboard sendiri benar: ia membaca buku besar apa adanya. Masalahnya data masuk tanpa penyaring.

## Akar masalah

`tutupShift` (`src/lib/tutup-shift.ts`) menerima angka uang fisik berapa pun. Kasir buta (tidak
melihat target), jadi salah ketik tidak terlihat, dan selisihnya langsung:
- kas lebih → Dr Kas / Cr 4303 Pendapatan Lain-lain (masuk laba);
- kas kurang → kasbon atas nama kasir (dipotong gaji) atau 5901 Selisih Kas.

Catatan: `revise_manual_journal` menolak baris > 1e12, jadi JRN-202610-0314 tidak bisa dibatalkan
lewat layar koreksi jurnal biasa — pembersihan perlu jalur khusus (pembalik dengan audit).

## Perbaikan (branch `claude/stoic-clarke-d933pc`)

- `BATAS_SELISIH_KAS = Rp 5.000.000` dan `cekKasFisikWajar()` di `tutupShift`: bila |uang fisik − target|
  melebihi batas (atau angka negatif/tidak valid), shift **tidak ditutup** dan tidak ada jurnal/kasbon.
  Pesan tidak menyebut target kas (kasir buta tetap berlaku). Berlaku di ketiga pintu tutup shift
  (kasir petshop, POS backoffice, klinik). Tutup paksa supervisor (tanpa hitung fisik) tidak terpengaruh.
- Tes: `src/lib/__tests__/tutup-shift.test.ts` (+4 kasus: kas lebih triliunan/miliaran, kas kurang 7 jt,
  tepat di batas, pesan tanpa angka). Suite penuh vitest 5708 lulus, tsc & eslint bersih.

## Belum dikerjakan (menunggu keputusan pemilik)

Pembersihan data: membuat jurnal pembalik untuk 5 jurnal di atas (dan opsional selisih uji yang
kecil) supaya dashboard kembali ke angka sebenarnya. Mengubah buku besar produksi → perlu persetujuan.
