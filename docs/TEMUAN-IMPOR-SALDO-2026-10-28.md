# Temuan: saldo stok hasil impor tidak pernah masuk (28 Okt 2026)

Keluhan: "yang udah diimport gak muncul, cuma notifnya doang".

## Fakta dari database live

| Batch saldo awal | Gudang | Status | Kenapa tertahan |
|---|---|---|---|
| ff8e3053 (28 Okt, 343 baris, Rp107,1 jt) | WH PDRY (Petshop Panduraya) | previewed | GL 1301 lain ada; barang sudah punya stok (saldo awal 21 Okt sudah masuk: 359 barang) |
| 22bff686, fa342ea0, 58d7ca27, 929f6a90 (22 Okt, 304 baris, Rp38,7 jt) | WH VET PDRY (Klinik Panduraya) | previewed | nilai tidak tepat 2 desimal; GL 1301 lain ada; 10 dari 304 barang sudah punya riwayat stok |
| 069e49ba (21 Okt) | WH PDRY | posted | satu-satunya yang masuk (jalur lama, sebelum review Keuangan) |

Master barang (kind `master_accurate`) semuanya `posted` — barang & jasanya masuk, yang hilang hanya saldo stok.

## Akar masalah

1. Impor di `/pos/sku/impor` hanya **menyiapkan** batch saldo. Posting stok + jurnal ada di halaman lain
   (`/keuangan/persediaan-awal`): OWNER pilih akun ekuitas, isi alasan, centang konfirmasi. Layar impor
   tidak menyatakan dengan tegas bahwa stok belum masuk, jadi pemakai mengira impor sudah selesai.
2. Walaupun dibawa ke halaman posting, `preview_accurate_inventory_accounting` memblokir **semua** batch:
   - blocker "GL persediaan/saldo awal lain sudah ada" menyala bila ada jurnal apa pun yang menyentuh akun 1301
     di cabang mana pun, tanggal berapa pun. Sejak 21 Okt sudah ada 57 jurnal harian normal
     (sale-hpp 31, klinik-hpp 9, purchase 8, purchase-invoice 4, opname 3, dll.). Artinya sejak toko jalan,
     saldo awal untuk gudang mana pun **tidak mungkin** diposting lagi.
   - blocker "Barang sudah memiliki stok/layer/riwayat" berlaku untuk seluruh batch bila satu barang saja
     sudah punya transaksi di gudang itu (Klinik: 10 dari 304).
   - batch Klinik juga dibuat tanpa centang pembulatan 2 desimal.

## Gudang yang belum punya saldo awal sama sekali

WH VET PDRY, WH CMGG, DC LOJI, WH B2C (+ GRND bila ada gudangnya). Hanya WH PDRY yang sudah.

## Opsi perbaikan

- A (disarankan): cek GL dipersempit ke saldo awal gudang/cabang yang sama (bukan semua jurnal 1301);
  barang yang sudah punya transaksi di gudang itu dilewati & dilaporkan (diselesaikan lewat opname), sisanya
  boleh diposting. Plus layar impor menyatakan jelas "stok BELUM masuk" dan menampilkan alasan tahan dalam
  bahasa biasa, langsung di layar impor.
- B: tanpa ubah aturan; saldo awal gudang sisa dimasukkan lewat stok opname per gudang.
- C: hanya perjelas pesan; aturan blokir tetap.

Opsi A mengubah aturan pengaman Keuangan (M04), perlu persetujuan pemilik.

## Keputusan & perbaikan (29 Okt 2026)

Reza memilih opsi A. Perubahan:

- Migrasi `20261029140000_initial_stock_per_warehouse.sql` (patch berjangkar, gagal total bila isi fungsi live beda):
  - blocker GL hanya untuk jurnal `saldo-awal` yang menyentuh 1301 di cabang yang sama atau global;
  - blocker baru: gudang yang sudah punya layer `saldo-awal-accurate` dari batch lain;
  - `prepare_accurate_initial_stock` melewati (status `skipped` + alasan) barang yang sudah punya
    stock_moves/stock_layers/stock≠0 di gudang tujuan; kalau semua barang terlewati → error jelas (arahkan ke Stok Opname).
- Kunci batch naik ke `v7-per-warehouse` supaya file lama bisa disiapkan ulang dengan aturan baru.
- Layar impor: kotak kuning "Stok BELUM masuk — tinggal 1 langkah" + tombol "Posting stok sekarang";
  pemeriksaan awal sudah menandai barang yang akan dilewati.
- Persediaan Awal: alasan tahan diterjemahkan ke bahasa operasional.

Langkah pemakai setelah rilis: impor ulang file Klinik Panduraya (centang pembulatan 2 desimal) → Posting stok sekarang
→ pilih akun Modal → isi alasan → Posting. 10 barang klinik yang sudah bertransaksi masuk lewat Stok Opname.
Petshop Panduraya tidak perlu impor ulang (saldo awal 21 Okt sudah masuk).

Catatan: saldo awal WH PDRY 21 Okt (batch 069e49ba) masuk lewat jalur lama tanpa jurnal 1301 — selisih Neraca
persediaan cabang itu perlu keputusan Keuangan terpisah.

Tes: `scripts/test-initial-stock-per-warehouse-postgres.py` (suite baru + 6 suite Accurate lama),
`scripts/test-reviewed-inventory-import-postgres.py` lulus. `scripts/test-m04-technical-e2e-postgres.py` sudah gagal
di main sebelum perubahan ini (JSONDecodeError di runner), tidak terkait.

## Simulasi file "STOK VET GRND (1).xlsx" (29 Okt 2026)

- Isi file: 201 baris saldo, 232 barang; sumber tertulis **VET CIAW / WH VET CIAW** (Klinik Ciawi), bukan Petshop Granada
  walau nama filenya "GRND". Aplikasi otomatis mengarahkan ke Kamo Pets Clinic Ciawi / WH VET CIAW.
- Data produksi (dibaca saja): 201 kode ada, aktif, tipe Persediaan, tanpa kode ganda; WH VET CIAW belum punya stok/riwayat.
- Simulasi di DB lokal (semua migrasi produksi + data barang yang sama), lewat fungsi asli:
  1. siapkan tanpa pembulatan → ditolak (nilai < 1 sen) — wajib centang pembulatan 2 desimal;
  2. dengan pembulatan → 201 baris siap; cek Keuangan bisa posting; nilai Rp29.427.901,38;
  3. posting **gagal "Bukti berubah"** — total qty 16569.4200000000000001 terpotong jadi 16569.42 di JavaScript,
     sehingga laporan yang dikirim balik dari browser tidak pernah sama dengan database. Berlaku untuk semua file
     dengan angka Excel berpresisi tinggi.
- Perbaikan: migrasi `20261029150000_inventory_review_exact_transport.sql` (pembungkus teks preview/posting) dan server
  action posting membaca ulang teks persis dari database, mencocokkannya dengan laporan yang ditinjau, lalu posting dengan teks itu.
- Simulasi ulang: posting OK, 201 barang bertambah stok di WH VET CIAW, layer = jurnal Dr 1301 = Cr 3101 = Rp29.427.901,38;
  impor ulang file yang sama ditolak (tidak dobel).
