# M05 lanjutan — tanggal faktur & jatuh tempo boleh kosong (paket migrasi production)

Ringkas: checklist M05 meminta tanggal faktur dan jatuh tempo diisi **"bila tersedia"**, tetapi versi M05 yang
sudah live menolak baris yang tanggalnya kosong. Paket ini membuat **faktur saldo awal** boleh tanpa salah satu atau
kedua tanggal itu — disimpan kosong, **tidak diganti tanggal lain** (bukan tanggal cutover, bukan hari ini + 30).
Tanggal yang terisi tetap harus valid. Faktur biasa (pembelian/penjualan sehari-hari) tetap wajib dua-duanya.
**Belum ada yang dijalankan ke production.** Berhenti di langkah mana pun yang hasilnya tidak sesuai.

Repo ini bisa terbaca pihak lain: **jangan menulis ID project, waktu backup, jumlah data, atau keluaran query
production ke repo/PR.** Catat di catatan rilis privat.

## Urutan: kode dulu, baru migrasi (kebalikan dari M05 pertama)

Kode PR ini aman dengan database lama (layar tetap jalan, belum ada faktur tanpa tanggal). Sebaliknya, kalau
migrasi dipasang **sebelum** kode baru live lalu ada impor tanpa tanggal, layar lama salah membaca faktur itu
(umur "> 90 hari", tanggal "Invalid Date", layar Piutang bisa gagal dimuat). Jadi:
**merge PR → tunggu deploy live → 01 → 02 → 03 → cek layar.** Harus selesai sebelum impor cutover (31 Okt).

## File

| File | Menulis? | sha256 |
|---|---|---|
| `supabase/migrations/20261027210000_opening_invoice_optional_dates.sql` | (isi dari 02) | `247e3dfd8b7e3ab38342be20a82963a9d010265b6588a5327ba0840f8aa2cc07` |
| `01-preflight-readonly.sql` | tidak | `66338b4584befd9646e96eba52e1fe79e949f78f7ba9f1e9b31fae889dcbca14` |
| `02-apply.sql` | **ya** — migrasi persis + baris riwayat, satu transaksi | `cef4c8e975af5ebe7ad4e2bcec5aba186cb7c7a4a14c67235a1d3a935e9fe96d` |
| `03-readback-readonly.sql` | tidak | `a3826dbbfca7d8e25827fea418124ed35b43e748d5151a0725a0a399620858e0` |
| `04-rollback-only-if-unused.sql` | **ya** — hanya pada keputusan rollback, sebelum ada faktur tanpa tanggal | `98eebaa6f2658ad605b8dc87ca926bf4e27b2db175976f4ce52947437c297300` |

`02` dan `04` dihasilkan `build-and-verify.py` (dari file migrasi dan dari migrasi M05 asli); jangan diedit tangan.

## Dampak migrasi

- **Kolom:** `tanggal` dan `jatuh_tempo` di `purchase_invoices`, `sales_invoices`, dan `opening_invoice_lines` tidak
  lagi `NOT NULL`. Nilai default faktur biasa (hari ini / hari ini + 30) **tetap**.
- **Pengaman baru:** constraint `purchase_invoices_tanggal_wajib_check` dan `sales_invoices_tanggal_wajib_check` —
  hanya faktur saldo awal (`opening_batch_id` terisi) yang boleh tanpa tanggal. Semua jalur faktur lain tetap
  ditolak database kalau tanggalnya kosong. Saat dipasang, constraint memeriksa seluruh baris faktur sekali.
- **Validasi impor** (`opening_invoice_review`, dipakai periksa & posting): sel kosong = "tidak tersedia" dan
  diterima; sel terisi yang bukan tanggal valid, tanggal faktur sesudah tanggal saldo, atau jatuh tempo sebelum
  tanggal faktur tetap ditolak. Aturan lain (pihak, nomor ganda, rupiah, total kontrol, periode tertutup, hak akses,
  posting OWNER, idempoten) **tidak berubah**. Hak akses fungsi tetap: hanya `postgres`.
- **Tidak berubah:** posting, jurnal (tetap satu jurnal per batch pada tanggal saldo), pembayaran, pelindung faktur
  saldo awal, trigger. **Tidak ada baris yang diubah atau dihapus** — dibuktikan di latihan: sidik jari 8 tabel
  (faktur, batch, baris batch, pembayaran, penerimaan, jurnal) identik sebelum dan sesudah apply.
- Kunci: `ALTER TABLE` mengambil kunci eksklusif singkat di `purchase_invoices`, `sales_invoices`,
  `opening_invoice_lines`. `lock_timeout 5s`, `statement_timeout 60s`; kalau kunci tidak didapat, semuanya batal dan
  bisa diulang. Backup penuh tidak menjadi syarat; backup rutin platform tetap sebagai jaga-jaga umum.

## Langkah

Jalankan dengan `psql -X -v ON_ERROR_STOP=1 -f <file>` (disarankan). Di SQL editor Supabase: `02`/`04` dijalankan
utuh; untuk `01`/`03` pilih dan jalankan hanya statement `with checks … select …`.

0. Pastikan PR ini sudah di-merge dan deploy production berstatus sukses (lihat urutan di atas).
1. **`01-preflight-readonly.sql`** — baris terakhir `SUMMARY | 0 failed`. Membuktikan: berjalan sebagai `postgres`;
   PostgreSQL 16+; M05 `20261027180000` sudah tercatat dan paket ini belum; 6 kolom tanggal masih `NOT NULL`; nama
   constraint baru belum dipakai; fungsi validasi production **persis** versi M05 di repo (md5 isi fungsi); constraint
   "jatuh tempo ≥ tanggal faktur" masih ada. Baris `info` menunjukkan berapa batch sudah terposting (isinya tidak
   disentuh). Bila ada baris gagal: **berhenti**, belum ada yang berubah.
2. **`02-apply.sql`** sekali. Sukses = tanpa error. Error yang mungkin: `M05D_ALREADY_APPLIED` (sudah terpasang →
   lanjut ke langkah 3), `M05D_PREREQUISITE_MISSING`, "must run as postgres", lock timeout (ulang nanti). Error
   apa pun = tidak ada yang terpasang.
3. **`03-readback-readonly.sql`** — `SUMMARY | 0 failed`: riwayat tercatat, 6 kolom boleh kosong, default faktur biasa
   tetap, 2 constraint baru tervalidasi, constraint jatuh tempo tetap, fungsi validasi versi baru (md5) dengan
   pemilik/hak akses yang sama, RPC periksa/posting tetap bisa dipanggil user login (anon tidak), dan **tidak ada
   faktur biasa tanpa tanggal**.
4. Cek layar (user OWNER): Saldo Awal per Faktur, Hutang Usaha, Piutang Usaha, Faktur Pembelian, Faktur Penjualan,
   Perintah Pembayaran, dan Buku Besar Pembantu hutang/piutang tampil normal.

## Rollback (hanya bila diputuskan)

`04-rollback-only-if-unused.sql` mengembalikan `NOT NULL`, menghapus 2 constraint baru, memasang kembali fungsi
validasi M05 **persis** (diambil dari migrasi M05), dan menghapus baris riwayat — **hanya selama belum ada satu pun
faktur saldo awal tanpa tanggal**. Kalau sudah ada, skrip menolak (`M05D_ROLLBACK_REFUSED`) tanpa perubahan apa pun:
faktur itu catatan keuangan, dan tanggal tidak boleh dikarang hanya supaya rollback bisa jalan. Kode PR ini tetap
aman setelah rollback (tidak perlu revert kode).

## Latihan (data fiktif)

`python3 docs/evidence/2026-10-27-m05-optional-dates/owner-apply/build-and-verify.py <bin-postgres>` membuat ulang
`02`/`04`, gagal bila berbeda dari yang di-commit, lalu berlatih di cluster sementara (`scripts/native_postgres.py`:
unix socket saja, tanpa Docker, tanpa URL database, dihapus setelahnya) dengan seluruh migrasi repo + riwayat migrasi
tiruan: rollback saat belum ada faktur tanpa tanggal (kembali ke basis M05) → suite tanggal-opsional **gagal** di basis
M05 (bukti tes mendeteksi perubahan) → suite M05 lulus → data M05 fiktif di-commit sebagai "transaksi lama" dan
disidik-jari → preflight `0 failed` → apply → readback `0 failed` → transaksi lama identik → apply kedua ditolak →
suite tanggal-opsional lulus → batch fiktif tanpa tanggal di-commit → rollback ditolak, data utuh, readback tetap
`0 failed`. Log: `rehearsal-pg*.log`.

Lulus di PostgreSQL **16.15** dan **17.6 — versi yang sama dengan production** (`rehearsal-pg16.15.log`,
`rehearsal-pg17.6.log`; biner 17.6 dari paket npm `@embedded-postgres/linux-x64@17.6.0-beta.15`, hanya untuk
latihan lokal). Suite SQL M05 + tanggal-opsional juga lulus di keduanya lewat
`scripts/test-opening-invoices-postgres.py --pg-bin <bin>`.
