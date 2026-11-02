# Rawat inap lunas tertahan di "Pembayaran" + label "Tunai" di faktur rawat inap (2 Nov 2026)

## Laporan
Anisa (Klinik TKI), 2 Nov 17.57 WIB, minta dicek transaksi **Chloe** (Kak Cindy Melosa).
Saat dicek, ada dua temuan, lalu Anisa mengonfirmasi bahwa pelanggan membayar dengan **debit**, bukan tunai.

## Data produksi (baca-saja, 2 Nov)
- Kunjungan TKI-A003, daftar 1 Nov 16.23 WIB. drh. Handitya. Masuk rawat inap 16.42.
- INV-202611-0125 (tagihan bertahap), Rp919.000, **Lunas** 2 Nov 17.06. Isinya termasuk rawat inap 7 × Rp95.000;
  klinik mengonfirmasi memang 7 hari. Kwitansi KWT-202611-0008, bagian "Kredit" → 120002 Bank BCA Transaksi.
  Uangnya menjadi uang muka UMK-202611-0008, lalu dipakai untuk melunasi invoice tersebut.
- Pulang "sembuh" 17.12, **setelah** dibayar. Status kunjungan tetap "Pembayaran".
- Satu baris resep (Injeksi Non Antibiotik) ditarik kasir dari tagihan (`billing_withdrawn_at`), jadi tidak ada sisa
  yang belum ditagih.
- Tutup shift sudah benar: uang dihitung dari bagian kwitansi (non-tunai), tidak dari label invoice.

## Penyebab 1 — kunjungan tidak tertutup
Penutupan kunjungan (`status='Selesai'`) hanya ada di `clinic_receive_visit_payment`. Fungsi itu mensyaratkan
(a) pasien sudah pulang saat uang diterima, dan (b) uangnya melunasi tagihan yang sudah ada. Dua urutan nyata
tidak memenuhinya:
1. **Bayar dulu, baru pulang** (Chloe): saat bayar, pasien masih dirawat. Fungsi pulang
   (`clinic_change_inpatient_condition`) tidak pernah menutup kunjungan.
2. **Pulang dulu, baru bayar lewat kasir rawat inap** (`clinic_bill_and_pay_inpatient`): kwitansi diterima lebih dulu
   dan masuk sebagai uang muka, lalu tagihan tahap baru diterbitkan dan dilunasi dari uang muka itu. Syarat (b) tidak
   pernah terjadi. Terbukti merah di uji baseline.

Produksi 2 Nov: ada 16 kunjungan rawat inap yang pasiennya sudah pulang tetapi statusnya masih "Pembayaran".
15 di antaranya memang masih punya tagihan belum lunas atau biaya yang belum ditagih. Hanya Chloe yang memenuhi
syarat penutupan.

## Perbaikan 1 — migrasi `20261106070000_ranap_pulang_tutup_kunjungan_lunas.sql`
- `clinic_private.tutup_kunjungan_ranap_lunas(visit)` menjadi satu-satunya aturan penutupan. Kunjungan ditutup
  bila memenuhi semua syarat ini:
  - punya rawat inap, dan semua rawat inapnya sudah pulang;
  - punya ≥1 tagihan aktif, dan semua tagihan aktif Lunas;
  - tidak ada baris rekam medis yang belum ditagih. Baris yang ditarik kasir tidak dihitung.
  Fungsi ini tidak bisa dipanggil langsung oleh pengguna (dicabut dari public/anon/authenticated/service_role).
- `clinic_change_inpatient_condition` memanggilnya saat pasien pulang (sembuh, rip, pulang_paksa).
  `clinic_bill_and_pay_inpatient` memanggilnya di akhir, sebelum hasil disimpan. Teks kedua fungsi diambil dari
  produksi (`docs/evidence/2026-11-02-ranap-pulang-lunas/produksi-*.sql`). Rangkaian migrasi tanpa kandidat
  menghasilkan teks yang identik (diuji). Perubahannya hanya penambahan baris panggilan.
- Rapikan data: aturan yang sama dijalankan untuk kunjungan yang pasiennya sudah pulang. Di produksi, yang
  tertutup hanya Chloe.
- Tidak ada perubahan pada uang, jurnal, stok, kwitansi, hak akses, maupun perhitungan tagihan.
- Tarif rawat inap yang ditambahkan otomatis saat pasien pulang tetap dihitung sebagai biaya belum ditagih, jadi
  kunjungannya tetap terbuka untuk ditagih.

## Penyebab 2 — label "Tunai"
Tagihan bertahap diterbitkan dengan `metode_bayar='Tunai'` sebagai label pengisi (`clinic_bill_and_pay_inpatient`
dan aksi "Tagih sekarang"). Uangnya masuk belakangan lewat kwitansi, dan label itu tidak pernah diperbarui.
Akibatnya struk, invoice, ringkasan dokumen rekam medis, dan Laporan Penjualan Rinci menulis "Tunai". Pada 2 Nov,
9 tagihan bertahap Lunas yang dibayar non-tunai terkena. Uang, jurnal, dan tutup shift tidak terdampak.

## Perbaikan 2 — tampilan saja
- `src/lib/metode-bayar-tagihan.ts` menelusuri cara bayar sebenarnya untuk tagihan `stage_billing`, dari dua sumber:
  - bayar langsung, dihitung bersih per metode;
  - penerapan uang muka yang belum dilepas → uang muka → kwitansi aktif → metode bagian kwitansi.
  Hasilnya satu metode, atau "Campuran" bila lebih dari satu. Bila tidak bisa ditelusuri atau gagal dibaca,
  dipakai label kepala seperti sebelumnya.
- Dipakai di struk, invoice, ringkasan dokumen rekam medis, dan Laporan Penjualan Rinci. Invoice biasa tidak berubah.
- Kolom `invoices.metode_bayar` tidak diubah. Invoice yang sudah diposting dijaga `guard_posted_clinic_invoice`,
  dan label kepala juga dipakai koreksi pembayaran rawat jalan.
- Tidak disentuh: header kasir rawat jalan (`/klinik/pembayaran/[visitId]`, yang hanya untuk rawat jalan) dan baris
  "DP awal" di layar tagihan rawat inap (DP kepala memang dibayar dengan label itu).

## Uji
- `scripts/test-ranap-pulang-tutup-kunjungan-postgres.py`, skema penuh dari nol, RPC publik asli, pengguna fiktif:
  - baseline (363 migrasi): 7 PASS / **3 FAIL**. Ketiga bug tereproduksi: bayar→pulang sembuh, bayar→pulang RIP,
    pulang→bayar lewat kasir rawat inap. Teks kedua fungsi identik dengan produksi.
  - kandidat (364 migrasi): **12 PASS / 0 FAIL**. Kasus yang tetap terbuka:
    - belum ada tagihan;
    - ada biaya baru yang belum ditagih;
    - ada tagihan aktif belum lunas;
    - perubahan kondisi biasa (bukan pulang).
    Rapikan data menutup kunjungan yang tertahan dan tidak pernah menutup pasien yang masih dirawat.
  - Bukti: `docs/evidence/2026-11-02-ranap-pulang-lunas/{baseline,kandidat}.json`.
- Regresi SQL dengan kandidat terpasang:
  - `test-inpatient-cashier-cart` 17/0;
  - `test-inpatient-cashier-history` 14/0;
  - `test-inpatient-cashier-tax-stale` 1/0;
  - `test-dp-lanjut-ranap` 28/0;
  - `test-ranap-racikan` 39/0.
  Yang tidak bisa dijalankan di lingkungan ini:
  - `test-inpatient-continuation` butuh Docker;
  - `test-ranap-mitigasi` gagal di jangkar migrasi lamanya sendiri, sebelum menyentuh kandidat.
- Vitest:
  - `metode-bayar-tagihan.test.ts`;
  - `clinic-stage-invoice-payment-label.test.tsx`: struk/invoice tagihan bertahap mencetak "Kredit". Tanpa perbaikan
    halaman, 2 kasus merah.
  - Suite penuh: 736 berkas lulus, 2 dilewati; 6.110 uji lulus, 10 dilewati.
- Typecheck, ESLint berkas yang diubah (0 error), `git diff --check`: lulus.

## Rilis
1. Aplikasi (label) aman dirilis kapan saja. Tidak bergantung pada migrasi.
2. Terapkan migrasi `20261106070000` ke Production. Sebelumnya, pastikan md5 `pg_get_functiondef` kedua fungsi
   masih sama dengan berkas bukti; bila berbeda, ada perubahan lain di produksi dan migrasi perlu disusun ulang.
   - `clinic_change_inpatient_condition` = `b1e381d5bd27ddb9c57c642f27c8603b`
   - `clinic_bill_and_pay_inpatient` = `0ed1d3abf471fae035a4b5a9a0f921ee`
3. Setelah terpasang, cek status kunjungan TKI-A003 Chloe = Selesai.
4. Rollback: `create or replace` kedua fungsi dari berkas bukti produksi, lalu `drop function
   clinic_private.tutup_kunjungan_ranap_lunas(uuid)`. Status kunjungan yang sudah ditutup tidak perlu dibuka lagi.
