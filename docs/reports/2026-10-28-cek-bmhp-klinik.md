# Cek input BMHP klinik — 28 Okt 2026

Pemicu: Aldi (11.26) melapor "beberapa major bug, khususnya input BMHP klinik". Pemeriksaan dilakukan
pada `main` @ `a4b59cc` sebelum meeting siang. Belum ada akses ke database Production dari sesi ini,
jadi data master/stok Production tidak diperiksa.

## Yang sudah dicek dan aman

- Alur BMHP di rekam medis rawat jalan dan catatan harian rawat inap: pilih tindakan → isi BMHP →
  masuk keranjang → simpan → stok dipotong saat tagihan diposting.
- Semua perubahan database setelah K02 (salesperson, H05 paket, C05 kampanye, J03 refund, U07, K03)
  menempel pada versi fungsi yang sudah ber-BMHP; tidak ada yang menimpa logika BMHP.
- Tes database BMHP dijalankan ulang di PostgreSQL 16 dengan **seluruh 303 migrasi** di `main`:
  `clinic_procedure_bmhp` (FIFO + moving average), `clinic_invoice_post`, `clinic_billing_lifecycle`,
  `clinic_compound_issue`, `clinic_manual_invoice_units`, `clinic_inpatient_action_category`,
  `official_compound_catalog`, `compound_catalog_sku_binding` — semua lulus.
- Tes aplikasi BMHP (75 tes) dan seluruh suite vitest (4110 tes) lulus.

## Diperbaiki di branch ini

1. **Pesan galat BMHP tidak jelas.** Penolakan database `BMHP_INVALID` / `BMHP_POSTED` tidak dipetakan,
   sehingga dokter hanya melihat "Rekam medis belum tersimpan. Periksa data dan coba lagi." Sekarang
   alasannya ikut tampil, mis. "BMHP tindakan ditolak: satuan BMHP tidak ditemukan".
2. **Kolom jumlah BMHP memakan angka 0 di depan.** Mengetik `0.5` tampil `.5` (nilai benar tapi
   membingungkan). Kolom sekarang menyimpan teks yang diketik.

Diuji di Chromium (Playwright) dengan komponen asli: `0.5` → 0.5, `1.5`, `10`, kosongkan lalu ketik
ulang, ganti satuan, tambah ke keranjang.

## Belum diperbaiki — perlu keputusan / data

- **Koma desimal.** Di Chromium headless, mengetik `0,5` di kolom angka mana pun (bukan hanya BMHP)
  terbaca `05` = 5. Di browser dengan bahasa Indonesia biasanya koma diterima, tapi belum dipastikan
  di perangkat klinik. Risiko: stok terpotong 10x.
- **BMHP salah ketik tidak bisa dikoreksi sebelum bayar.** BMHP di baris tindakan terkunci setelah
  rekam medis disimpan; kasir tidak melihat BMHP di layar pembayaran. Salah satuan (mis. `box`
  bukan `pcs`) baru ketahuan saat stok kurang di kasir atau setelah terposting.
- **Stok BMHP baru dicek saat kasir memposting**, bukan saat dokter mengisi. Stok kosong/HPP kosong
  (mis. setelah migrasi data) muncul sebagai "Stok tidak cukup: <barang>" atau "HPP historis bahan
  tidak tersedia: <barang>" di kasir.
- **Daftar pilihan BMHP** hanya berisi barang persediaan aktif di luar kategori JASA/TINDAKAN.
  Barang habis pakai yang ditaruh di kategori TINDAKAN atau bertipe non-persediaan tidak akan muncul.
  Perlu cek data master Production.
