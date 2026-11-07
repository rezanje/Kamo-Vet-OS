# Order online: semua cabang & gudang + bukti order — 5 Nov 2026

Pelapor: Aldi Saputra (grup Kamo Group – ERP Dev):
- 16.22 "gudangnya kita sekarang pakai gudang petshop saja sama cabang petshop"
- 16.43 "sebelum import coba buat online bisa pilih cabang dan gudang semua dulu yah, biar bisa input manual dulu"
- 16.43 "sama bisa kasih attachment buat bukti orderan shopeenya gitu"

## Perubahan

1. **Migrasi `20261107030000_online_semua_gudang.sql`.** Fungsi `post_online_order` tidak lagi
   mewajibkan gudang bertipe `ONLINE`. Sekarang semua gudang aktif diterima, **kecuali** `EXPIRED`
   dan `TRANSIT`.
   - Cara pasangnya: menambal satu jangkar teks. Kalau definisi di database berbeda dari yang
     diharapkan, migrasi gagal keras (`ONLINE_WAREHOUSE_SCHEMA_DRIFT`). Kalau dijalankan ulang,
     tidak terjadi apa-apa.
   - Cabang transaksi = cabang gudang. Akses cabang tetap diperiksa `unit_posting_access`.
   - Stok, HPP FIFO, jurnal, dan piutang marketplace (Dr 130009) tidak berubah.
2. **Form Order Online Baru dan Impor Shopee.** Daftar gudang diambil dari
   `muatGudangOrderOnline` (`src/lib/online-gudang.ts`), memakai jenis `ONLINE/RETAIL/DC/VET` —
   sama dengan aturan di database.
   - Gudang ditampilkan per cabang (`<optgroup>`) dengan label jenisnya.
   - Validasi pratinjau impor ikut aturan yang sama.
   - Bawaan impor tetap gudang online Panduraya, kalau gudang itu hanya ada satu.
3. **Bukti order.** Form order manual sekarang punya `LampiranPicker` (folder `penjualan-online`).
   - Setelah `post_online_order` berhasil, lampiran dicatat ke `document_attachments`
     (modul `penjualan`, ref = id penjualan). Dengan begitu lampiran langsung tampil di panel
     Dokumen & Lampiran pada detail order.
   - Kirim ulang dengan kunci yang sama tidak membuat lampiran ganda.
   - Path di luar folder bukti diabaikan.
   - Kalau pencatatan lampiran gagal, order tetap sah. Pesan sukses memberi tahu operator untuk
     melampirkan ulang dari detail order.

## Catatan bisnis

- Order online dari gudang petshop tercatat di **cabang petshop itu**, dan masuk ke laporan cabang
  tersebut. Ini sesuai desain lama yang tertulis di `resolveUnitTypes`: "Cabang Online" hanya
  memuat cabang bertipe ONLINE.
- Retur order online mengembalikan stok ke gudang cabang menurut aturan retur yang sudah ada.
  Aturan ini tidak diubah.

## Uji

- `python3 -I scripts/test-online-semua-gudang-postgres.py` dijalankan di PostgreSQL 16 lokal
  sekali pakai, dengan 377 migrasi dan data fiktif. Hasil:
  - RED tanpa kandidat: gudang RETAIL ditolak.
  - Kandidat dijalankan ulang: tidak ada perubahan.
  - GREEN `supabase/tests/online_semua_gudang.sql`:
    - RETAIL & ONLINE diterima;
    - EXPIRED, TRANSIT, dan gudang nonaktif ditolak;
    - staf di cabang sendiri diterima, di cabang lain ditolak;
    - cabang, stok, dan jurnal piutang benar.
  - Regresi `online_return_unit_posting.sql` lulus.
- Vitest:
  - baru: `online-bukti-order.test.ts`, `online-gudang.test.ts`;
  - diperbarui: `shopee-import-actions.test.ts`, `shopee-import-pages.test.tsx`;
  - penuh: 822 file lulus.
- `tsc --noEmit`, `eslint` untuk berkas yang diubah, dan `next build` lulus.
- Belum diuji: migrasi di Production, klik di browser, dan UAT oleh tim online.
