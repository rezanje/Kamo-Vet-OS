# Pasien rawat inap sudah lunas tapi masih "Bayar" di Antrian (4 Nov 2026)

## Laporan
Grup klinik, 4 Nov 16.47 WIB. **Anisa (TKI):** CHLOE (Kak Cindy Melosa, TKI-A003, daftar 1 Nov) dan
CHEETOZ (Ibu Ria, TKI-A001, daftar 2 Nov) masih berstatus Pembayaran dengan tombol Bayar di bagian
"Belum selesai dari hari sebelumnya", padahal sudah lunas. Layar yang sama juga menampilkan durasi mentah
seperti "Tunggu 6.916766666667 mnt".

## Data produksi (baca-saja, 4 Nov)
- CHLOE: INV-202611-0125 Rp919.000 Lunas (kwitansi KWT-202611-0008, 2 Nov 17.06 WIB). Pulang (sembuh)
  6 menit kemudian, 17.12 WIB.
- CHEETOZ: INV-202611-0088 Rp630.000 Lunas (2 Nov). Pulang (RIP) 4 Nov 10.51 WIB. Lalu "Simpan & bayar"
  KWT-202611-0021 Rp150.000 → INV-202611-0243 Lunas, 4 Nov 16.34 WIB.
- Total 8 kunjungan, semuanya rawat inap, sudah pulang, seluruh tagihan aktif Lunas, tetapi kunjungannya
  masih Pembayaran: TKI 2 (CHLOE, CHEETOZ), Cimanggu 6 (Milo 29 Okt, Keripik tempe 1 Nov, Pipi 2 Nov,
  Mocha, Jenggo, woolly 3 Nov).
- Tiga di antaranya (CHLOE, Mocha, Keripik tempe) punya baris rekam medis yang tidak tertagih. Semuanya
  baris yang dikeluarkan kasir dari keranjang (`billing_withdrawn_at`, "Konfirmasi keranjang rawat inap"),
  jadi bukan utang pemilik.
- Tidak ada kunjungan rawat jalan yang mengalami ini.

## Penyebab
Penutupan kunjungan rawat inap hanya ada di `clinic_receive_visit_payment` dan mensyaratkan pasien sudah
pulang. Dua jalur lolos dari situ:
1. **Bayar lunas sebelum pulang** (CHLOE, Keripik tempe, Pipi, Mocha). Saat bayar, rawat inap masih aktif,
   jadi tidak ditutup. `clinic_change_inpatient_condition`, satu-satunya penulis `discharged_at`, tidak
   menyentuh status kunjungan.
2. **"Simpan & bayar" sesudah pulang** (`clinic_bill_and_pay_inpatient`; Milo, CHEETOZ, Jenggo, woolly).
   Kwitansi diterima lebih dulu saat tahap baru belum terbit. Karena tidak ada tagihan yang belum lunas,
   uangnya menjadi uang muka pemilik dan langkah itu tidak melunasi tagihan apa pun. Tahap baru lalu terbit
   dan dilunasi dari uang muka itu, tetapi tidak ada langkah yang menutup kunjungan.

Antrian menyaring rawat inap yang masih aktif. Begitu pasien pulang, kunjungan yang tetap Pembayaran muncul
dengan tombol Bayar.

## Perbaikan
Migrasi `20261106530000_ranap_kunjungan_lunas_ditutup.sql`:
- `clinic_private.close_settled_visit(visit)` adalah satu aturan penutupan. Status menjadi `Selesai` hanya bila:
  - kunjungan belum Selesai dan tidak diarsipkan;
  - tidak ada rawat inap yang belum pulang;
  - minimal ada satu tagihan aktif, semuanya Lunas, dan tidak ada yang menunggu koreksi;
  - tidak ada baris rekam medis yang belum ditagih. Baris yang dikeluarkan kasir tidak dihitung, memakai
    predikat yang sama dengan `inpatient_payment_quote`. Jadi tarif rawat inap otomatis yang dibuat saat
    pulang tetap muncul di Bayar sampai ditagih.

  `checked_out_at` tidak diubah, sama seperti penutupan yang sudah ada di penerimaan pembayaran. Fungsi
  ini tidak bisa dipanggil langsung oleh aplikasi.
- Fungsi ini dipanggil di akhir `clinic_change_inpatient_condition` (hanya saat pulang) dan di akhir
  `clinic_bill_and_pay_inpatient`, sebelum hasilnya disimpan.
- Tambalan memakai jangkar teks dan gagal keras (`RANAP_CLOSE_DRIFT`) bila definisinya berubah. Bila
  tambalan sudah terpasang, ia dilewati, jadi migrasi aman dijalankan ulang. Kedua jangkar sudah dicek tepat
  satu kali terhadap definisi Production (baca-saja, 4 Nov).
- Pemulihan data: kunjungan yang punya rawat inap dan sudah memenuhi aturan di atas ditutup. Simulasi
  baca-saja di Production memilih tepat 8 kunjungan di atas.

Antrian: durasi Tunggu/Layanan dibulatkan ke menit di layar (`fmtMenit`). Rata-rata di laporan
operasional tetap memakai nilai mentah.

## Uji
- PostgreSQL 16 lokal (tabel minimum + fungsi dengan jangkar yang sama persis dengan Production), migrasi
  dijalankan dua kali, 15 skenario hijau:
  - tambalan terpasang tepat satu kali, termasuk sesudah dijalankan ulang;
  - pemulihan menutup kunjungan rawat inap lunas dan tidak menyentuh kunjungan rawat jalan; pada jalan
    ulang 0 kunjungan;
  - bayar saat masih dirawat: tetap terbuka, lalu tertutup saat pulang;
  - ganti kondisi tanpa pulang: tetap terbuka;
  - "Simpan & bayar" yang melunasi baris terakhir: tertutup;
  - baris belum tertagih, tagihan DP, koreksi tertunda, tanpa tagihan, diarsipkan, atau masih ada rawat
    inap aktif: tetap terbuka;
  - tagihan batal diabaikan;
  - aplikasi tidak bisa memanggil fungsi pembantu.
- Baru: `src/lib/__tests__/ranap-kunjungan-lunas-ditutup-sql.test.ts` (teks migrasi).
- `queue-carry-over.test.tsx`: kasus durasi CHEETOZ menjadi "Tunggu 7 mnt · Layanan 26 mnt". Kasus ini
  merah di kode lama.

## Sisa
- Migrasi harus diterapkan ke Production supaya 8 kunjungan itu hilang dari Antrian. Kode aplikasinya
  hanya mengubah tampilan menit.
- Belum ditangani: kunjungan rawat inap yang dipulangkan dengan tagihan masih DP/Belum Lunas. Kunjungan itu
  tetap muncul di Bayar, sesuai desain tagihan berjalan.
