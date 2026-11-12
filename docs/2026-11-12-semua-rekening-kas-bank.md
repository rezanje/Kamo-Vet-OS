# Semua akun Kas & Bank muncul di pilihan rekening (12 Nov 2026)

Pelapor: Reza (Terima / periksa piutang di Faktur Penjualan: "rekening transfernya cuma ada Bank BCA, gak ada
detail ke rekening mana") dan Mba Anisa (Kas Keluar: "tolong dimunculin semua akun kas & bank"; admin Bu Fitri:
"gak ada atas nama aku?").

## Penyebab

Bagan akun baru (`20261105010000_coa_bagan_baru`) membuat 22 akun kas (110001–110022) dan 6 rekening BCA
(120001–120006). Yang terdaftar sebagai *rekening* di Kas & Bank hanya:

- bawaan lama 110003 (nama rekening masih "Kas") dan 120002 (nama rekening masih "Bank BCA"),
- Kas Toko per cabang 110004–110021 (`20261107010000`).

Semua pilihan rekening di aplikasi (penerimaan piutang, uang muka penjualan/pembelian, pembayaran hutang,
gaji, pengajuan staf, aset, beban, kas masuk/keluar, transfer, refund, rekonsiliasi) membaca daftar rekening,
dan RPC penerimaan/pembayaran hanya menerima rekening terdaftar. Akibatnya 110001 Kas Blu BCA,
110002 Kas Kecil Gudang (Bu Fitri), 110022, dan BCA 120001/120003–120006 tidak bisa dipilih sama sekali, dan
satu-satunya bank terbaca "Bank BCA" tanpa nomor rekening.

## Perbaikan

1. Migrasi `supabase/migrations/20261115610000_semua_akun_kas_bank_jadi_rekening.sql` (idempoten):
   - setiap akun aktif bukan-induk tipe ASET berkode `11xxxx`/`12xxxx` yang belum punya rekening didaftarkan:
     nama = nama akun, jenis Kas/Bank dari kode, **tanpa cabang** (bisa dipakai semua cabang), bank "BCA" bila
     nama memuat BCA, no. rekening dari angka dalam kurung;
   - rekening bawaan yang namanya masih bawaan diberi nama akunnya: "Kas" → "Kas Kecil",
     "Bank BCA" → "Bank BCA Transaksi (4270086743)";
   - no. rekening Bank yang kosong diisi dari nama akun.
   - Tidak menyentuh rekening yang sudah ada / dinonaktifkan / diganti nama oleh finance. Tidak membuat atau
     memindah jurnal. Peta Rekening Pembayaran tidak berubah (default "— ikut peta —" tetap sama).
2. `src/components/PilihRekening.tsx`: pilihan menampilkan `kode · nama · no. rekening`, dikelompokkan Kas / Bank.
   Lebar dropdown penerimaan piutang (Faktur Penjualan, Keuangan → Piutang) dan uang muka penjualan diperlebar.
   Layar Kas Masuk/Keluar memakai nama rekening, jadi otomatis ikut lengkap setelah migrasi.

## Verifikasi lokal

- `python3 -I scripts/test-semua-rekening-kas-bank-postgres.py` — PostgreSQL 16 sekali pakai, 413 migrasi;
  keadaan produksi sebelum rilis direka ulang (hanya 110003/120002 + pengaturan manual fiktif). Hasil: semua
  akun Kas/Bank aktif jadi rekening, 6 BCA lengkap dengan no. rekening, nama bawaan diganti, rekening
  nonaktif / bernama manual tidak berubah, akun induk/nonaktif/non-kas tidak ikut, terapkan ulang = tanpa
  perubahan, tanpa jurnal.
- Vitest baru `src/components/__tests__/pilih-rekening.test.tsx`; `npx vitest run` (919 file lulus),
  `npm run lint` (0 error), `tsc --noEmit`, `next build` lulus.

## Rilis

1. Terapkan migrasi `20261115610000_semua_akun_kas_bank_jadi_rekening.sql` ke Production (Supabase SQL editor,
   satu transaksi). Aman dijalankan sebelum atau sesudah aplikasi baru live.
2. Kueri baca sesudah pasang:

```sql
select coa_code, jenis, nama, bank_nama, no_rekening, is_active, branch_id is null as semua_cabang
  from cash_accounts order by jenis, coa_code;
-- harus memuat 110001, 110002 (Bu Fitri), 120001–120006 dengan no. rekening
select count(*) from coa_accounts a where a.code ~ '^1[12][0-9]{4}$' and a.is_active and not a.is_header
  and a.type='ASET' and not exists (select 1 from cash_accounts c where c.coa_code=a.code);  -- 0
```

3. Merge PR, tunggu Production, cek Faktur Penjualan → Terima / periksa dan Kas & Bank → Kas Keluar.

Rollback (bila perlu): nonaktifkan rekening yang tidak diinginkan di Kas & Bank → Daftar Rekening (jangan dihapus
bila sudah dipakai transaksi); nama bawaan bisa diganti lewat SQL `update cash_accounts set nama=... where coa_code=...`.

## Catatan untuk finance

- Rekening baru berlaku untuk semua cabang. Kalau ada yang khusus cabang (mis. kas Bu Fitri hanya gudang),
  ikatkan cabangnya — belum ada layar ubah cabang rekening, minta developer.
- Akun kas/bank baru sebaiknya ditambah lewat Kas & Bank → Daftar Rekening (otomatis membuat akun + rekening).
  Akun yang ditambah langsung di Bagan Akun belum otomatis jadi rekening.
