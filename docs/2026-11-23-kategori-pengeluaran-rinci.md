# Kategori pengeluaran rinci → akun beban (23 Nov 2026)

## Laporan
Anisa (keuangan): pengeluaran yang diinput di toko "semuanya masuk ke beban operasional" (buku besar 760003
Beban Operasional Lain), padahal kasir input per kategori.

## Temuan (data 1–23 Nov, sebelum perubahan)
- Pemetaan kategori→akun sudah ada (`public.expense_account_code`): Listrik & Air→720002, Perlengkapan→740001,
  Transportasi→740003, Perawatan→740007. Hanya Operasional, Lain-lain, Sewa Gedung → 760003.
- Tetapi ±67% transaksi (±Rp16 jt dari ±Rp27,7 jt) diinput sebagai Operasional/Lain-lain → menumpuk di 760003.
- "Listrik & Air" seluruhnya ke Beban Listrik; Beban Air 720003 tidak pernah terpakai.
- Temuan samping: 13 pengeluaran klinik tgl 1–2 Nov (±Rp1,27 jt) tampak tanpa jurnal karena `journal_entry_id`
  kosong. Pemeriksaan lanjut: jurnalnya **sudah ada** (`source='expense'`, `source_ref`=id pengeluaran, nominal dan
  akun benar; kredit 110003 sama seperti semua pengeluaran sebelum kas per cabang 6 Nov). Yang hilang hanya tautan.
  Disambungkan oleh migrasi `20261123085116_sambung_jurnal_pengeluaran_klinik_awal_nov.sql` (disetujui pemilik,
  diterapkan ke Production 23 Nov) — tidak ada jurnal/angka yang dibuat atau diubah. Sesudahnya: 0 pengeluaran aktif
  tanpa tautan jurnal.

## Perubahan
- Kategori baru (rincian dari Anisa) dan akunnya:

| Kategori | Akun |
|---|---|
| Listrik | 720002 Beban Listrik |
| Air | 720003 Beban Air |
| Internet | 720004 Beban Internet dan Telpon |
| Tips Ongkir | 740017 Beban Tips / Ongkir |
| Bensin, Parkir & Toll | 740005 Beban Bensin, Parkir dan Tol |
| Perawatan Peralatan | 720008 Beban Perbaikan dan Renovasi (sesuai tabel Anisa; bukan 740007 Beban Perbaikan Peralatan) |
| Uang Makan | 740021 Beban Uang Makan |
| Kebutuhan RT | 740016 Beban Kebutuhan RT |
| Marketing | 730002 Beban Marketing Kit |
| Kebersihan | 720005 Beban Kebersihan |
| Keamanan | 720006 Beban Keamanan |
| IPL | 720009 Beban Pengelolaan Lingkungan / IPL |
| ATK | 740002 Beban ATK |
| Print dan FC | 740014 Beban Print dan Fotocopy |
| Kebutuhan Grooming | 740013 Beban Kebutuhan Grooming |
| Kresek dan Thermal | 740022 Beban Kresek dan Thermal |
| Ekspedisi | 740012 Beban Ekspedisi |
| Lain-lain (cadangan) | 760003 Beban Operasional Lain |

- Back office (Persediaan → Pengeluaran, Pencatatan Beban) juga menawarkan "Sewa Gedung" (tetap 760003 seperti dulu).
- Kategori lama (Operasional, Listrik & Air, Perlengkapan, Transportasi, Perawatan, Perawatan Aset) tidak ditawarkan
  lagi untuk input baru, tetapi tetap sah di database dengan akun yang sama (data lama, koreksi, retry permintaan
  yang sama) dan tetap muncul di filter daftar klinik.
- Database: migrasi `20261123084004_kategori_pengeluaran_rinci.sql` mengganti `expense_account_code` (satu-satunya
  pemetaan; dipakai `post_expense_atomic` dan `revise_expense_atomic`). Memeriksa semua akun tujuan ada & aktif.
  **Sudah diterapkan ke Production 23 Nov 2026** (kompatibel mundur: aplikasi lama tetap jalan).
- Aplikasi: satu sumber daftar `src/lib/kategori-pengeluaran.ts` dipakai form kasir petshop, klinik, back office,
  Pencatatan Beban, dan edit detail pengeluaran.
- Pengeluaran lama TIDAK direklasifikasi (kategorinya terlalu umum untuk dipindah otomatis).

## Tes
- `src/lib/__tests__/kategori-pengeluaran.test.ts`: peta aplikasi = peta SQL (dibaca dari file migrasi), daftar
  persis tabel Anisa, kategori umum tidak ditawarkan, filter memuat kategori lama, Pencatatan Beban sinkron.
- Uji coba fungsi di Production dalam transaksi yang dibatalkan sebelum diterapkan; sesudah diterapkan:
  `Air`→720003, `Operasional`→760003, `authenticated` tetap tanpa hak eksekusi langsung.
- Vitest penuh, typecheck, lint berkas yang diubah, `next build`: lulus.
