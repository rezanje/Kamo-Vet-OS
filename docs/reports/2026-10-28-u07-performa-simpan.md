# U07 — Performa simpan / proses klinik (2026-10-28)

## Ringkasan
Lambatnya simpan rekam medis dan "lanjut" bukan karena database penuh (data produksi masih
kecil: 28 kunjungan, 20 rekam medis, 3.613 barang). Penyebabnya **antrean perjalanan
server ⇄ database yang dijalankan satu per satu**, ditambah halaman rekam medis yang ikut
dirender ulang (dan kadang dua kali) setiap kali simpan. Server aplikasi ada di Seoul (icn1),
jadi tiap perjalanan ke database berbiaya puluhan milidetik; puluhan perjalanan berurutan
= beberapa detik.

## Akar masalah & perbaikan

| # | Titik lambat | Sebelum (perjalanan berurutan, perkiraan) | Sesudah |
|---|---|---|---|
| 1 | Simpan rekam medis — bacaan sebelum RPC simpan (dokter, kunjungan, berat hewan, satuan barang, cek BMHP) | hingga 5 tahap + 1 RPC | 1 tahap paralel + 1 RPC |
| 2 | Halaman rekam medis setelah tersimpan (ikut dirender di respons simpan) | ±12 tahap (user, kunjungan, RM, resep, racikan, cek koreksi, invoice, rawat inap+referral, izin racik, consent, aturan consent, saudara) | 2 tahap (+1 hanya saat mode koreksi) |
| 3 | "Simpan & Lanjut Rawat Inap" — halaman yang sama dirender **dua kali** (respons simpan + navigasi ke URL yang sama) | 2× render halaman | 1× (navigasi ke URL yang sama dilewati karena halaman sudah segar) |
| 4 | Form pemeriksaan (sebelum simpan) — muat katalog barang | daftar barang 8 halaman berurutan + detail stok/satuan/harga 19 batch berurutan + ±10 bacaan lain berurutan ≈ 35+ tahap | daftar barang: 1 + 2 gelombang paralel; detail: 4 gelombang; bacaan lain paralel ≈ 8–10 tahap |
| 5 | Semua layar yang memakai pembaca daftar lengkap (`readCompleteList`) | 1 perjalanan per 500 baris, berurutan | halaman pertama, lalu sisa halaman 6 sekaligus (tetap dicek jumlah & urutan) |
| 6 | Bayar & Selesai — kirim struk WA (3 akses log + panggilan penyedia WA) menahan kasir | ditunggu sebelum layar lanjut | dikirim setelah respons (`after()`); hasilnya memang tidak ditampilkan, idempotensi tetap via log `receipt:<no invoice>` |

Angka "tahap" = jumlah tunggu berurutan ke database; bukan hasil ukur produksi (log
query tidak dibaca di sesi ini). Estimasi kasar: 1 tahap ≈ 30–80 ms dari icn1, jadi simpan
& lanjut rawat inap turun dari ±30 tahap menjadi ±4–5 tahap.

## Klik dobel & retry
- Tombol sudah terkunci selama server memproses (sudah ada). Celahnya: begitu server
  menjawab, tombol **aktif lagi** selama halaman berikutnya dimuat. Sekarang tombol tetap
  terkunci dengan label "Tersimpan, membuka halaman…" sampai halaman berganti (pengaman
  buka otomatis 20 detik).
- Pengiriman kedua selagi yang pertama masih jalan diabaikan di klien.
- Retry tidak membuat duplikat: RPC simpan rekam medis memakai kunci permintaan unik
  (`submission_key`, index unik) + hash isi — kirim ulang dengan kunci sama mengembalikan
  rekam medis yang sama. Pembayaran memakai kunci permintaan yang sama dengan jalur replay.
  Keduanya sudah ada; tidak diubah.
- Galat master satuan barang dulu lolos sebagai error mentah (layar bilang "periksa
  koneksi"), sekarang tampil sebagai pesan jelas di halaman.

## Index database (opsional, langkah owner)
Advisor performa Supabase menandai kolom yang difilter di halaman ini tanpa index:
`visit_referrals.visit_id`, `visits.customer_id` (+cabang, tanggal), `visits.pet_id`,
`follow_ups.visit_id`. Dengan data sekarang dampaknya kecil; ini pencegahan.
- Migrasi: `supabase/migrations/20261028090000_u07_clinic_read_indexes.sql`
- Paket owner: `docs/evidence/2026-10-28-u07-save-perf/owner-apply/u07-clinic-read-indexes.sql`
- Kode **tidak bergantung** pada index ini; boleh dirilis sebelum/sesudah. Belum diterapkan ke produksi.

## Yang belum dikerjakan
- ~~Jalur pembayaran (`bayarVisit`) masih ±15 tahap berurutan sebelum posting.~~ Dikerjakan
  di PR lanjutan `claude/u07-payment-speed` (lihat bagian di bawah).
- Halaman rawat inap & catatan rawat inap belum diaudit sedalam rekam medis.
- Form pemeriksaan masih mengirim seluruh katalog (±3.600 barang beserta satuan) ke browser;
  ukuran kirim besar. Solusi sebenarnya = pencarian barang di server (perubahan UX, di luar U07).
- 58 kebijakan RLS memanggil `auth.*()` per baris (advisor `auth_rls_initplan`), beberapa di
  tabel klinik; belum disentuh karena menyangkut keamanan akses.
- Belum ada pengukuran waktu nyata di produksi sebelum/sesudah; perlu dicek setelah deploy.

## Lanjutan: jalur pembayaran (branch `claude/u07-payment-speed`)
- `bayarVisit`: bacaan sebelum posting dimulai bersamaan dalam 2 gelombang
  (gelombang 1: user+shift, gate consent, invoice aktif, periode, kunjungan, pajak, aturan DEMO;
  gelombang 2 setelah kunjungan: promo/voucher/golongan, poin, kode akun kas per metode,
  salesperson). ±15 tahap berurutan → ±3 tahap sebelum RPC posting.
- Setiap hasil tetap ditunggu & divalidasi **di posisi lama** (helper `mulai`), jadi urutan
  validasi dan pesan galat identik. Bacaan yang gagal membuat proses berhenti sebelum posting
  (fail closed); bacaan yang ditinggal karena redirect lebih awal tidak jadi galat liar.
- `recomputeCustomerTier` (statistik turunan, best effort) pindah ke `after()` bersama struk WA.
  `catatPoinKlinik` tetap sebelum respons (nilai uang).
- `bayarRombongan`: bacaan awal paralel; persiapan tagihan tiap hewan berjalan bersamaan lalu
  dipakai berurutan (urutan nota, "dilewati", dan galat sama). Posting nota tetap satu per satu.
- Log waktu: `console.info("[u07:bayarVisit] <visit> baca1=..ms baca2=..ms posting=..ms pasca=..ms total=..ms")`
  (rombongan: `baca`, `posting`). Dipakai untuk ukur produksi setelah deploy.
