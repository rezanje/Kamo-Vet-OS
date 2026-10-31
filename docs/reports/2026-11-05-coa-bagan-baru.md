# Bagan akun (COA) baru KAMO — pemetaan yang diterapkan + panduan rilis

Sumber: berkas COA dari Reza (31 Okt 2026, 205 baris, kode 6 digit). Keputusan Reza: **opsi A** — celah diisi
developer dengan pilihan paling masuk akal dan ditandai *sementara* untuk dikoreksi Andri/finance.
Migrasi: `supabase/migrations/20261105010000_coa_bagan_baru.sql`. Rollback: `docs/rollback/2026-11-05-coa-bagan-baru.sql`.

## 1. Pola kode baru

| Awalan | Kelompok | Catatan |
|---|---|---|
| 1xxxxx | ASET | kas/bank, e-commerce, setara kas, piutang, uang muka, persediaan, aset lancar lain |
| 2xxxxx | ASET | aset tetap; 200012–200016 akumulasi penyusutan (kontra, Kredit) |
| 3xxxxx | LIABILITAS | |
| 4xxxxx | EKUITAS | 430000–430002 prive/dividen dibuat Debit (kontra ekuitas) |
| 5xxxxx | PENDAPATAN | 52xxxx retur/diskon/potongan = pengurang pendapatan (Debit) |
| 6xxxxx | BEBAN (HPP) | Laba Rugi & dashboard menghitung seluruh kelompok 6 sebagai HPP |
| 7xxxxx | BEBAN | |
| 80/81xxxx | PENDAPATAN di luar operasional | |
| 82xxxx | BEBAN di luar operasional | 820000 berdiri sendiri (tidak di bawah 800000 karena beda kelompok) |

Akun baru wajib 6 angka sesuai pola di atas. Kode lama 4–5 angka buatan pengguna yang masih tersisa tetap dibaca
dengan pola lama. Jatah kode rekening otomatis: kas 110023–119999, bank 120007–129999.

## 2. Perbaikan atas berkas

- Kode dobel dinomori urut sesuai urutan berkas: 22 akun kas 110001–110022, 6 rekening BCA 120001–120006.
- Saldo normal dibetulkan: 200011 Aset Tetap Dalam Pembangunan → Debit; 530000–530002 Pendapatan Lainnya → Kredit;
  800000 → Kredit; 430000–430002 Prive/Dividen → Debit.
- Ditambah 3 akun yang dipakai sistem tapi tidak ada di berkas: **130009 Piutang Marketplace**, **311003 Utang Barang
  Belum Difakturkan**, **740020 Beban Komisi Marketplace**.
- Total 207 akun, 39 akun induk; induk ditentukan dari pola kode (xxx000 → xx0000 → x00000).

## 3. Akun yang dipakai sistem: lama → baru

Akun lama **diganti kodenya di tempat**: id akun sama, sehingga seluruh riwayat jurnal ikut pindah.

| Lama | Dipakai untuk | Baru | Nama baru | |
|---|---|---|---|---|
| 1101 | Kas bawaan & selisih kas shift | 110003 | Kas Kecil | **sementara** |
| 1102 | Bank bawaan non-tunai | 120002 | Bank BCA Transaksi (4270086743) | **sementara** |
| 1105 | PPN Masukan | 182004 | PPN Masukan |  |
| 1201 | Piutang usaha | 150001 | Piutang Usaha |  |
| 1202 | Piutang marketplace | 130009 | Piutang Marketplace | **sementara** |
| 1203 | Piutang karyawan (kasbon) | 182001 | Cashbon Karyawan |  |
| 1301 | Persediaan | 170001 | Persediaan |  |
| 1302 | Persediaan dalam proses | 170003 | Persediaan Dalam Proses |  |
| 1303 | Uang muka pembelian | 160001 | Deposit Supplier |  |
| 1401 | Perlengkapan (seed) | 181001 | Perlengkapan Kantor |  |
| 1501 | Aset tetap | 200008 | Peralatan Kantor | **sementara** |
| 1509 | Akumulasi penyusutan | 200015 | Akumulasi Penyusutan Peralatan | **sementara** |
| 2101 | Hutang usaha | 311001 | Utang Supplier |  |
| 2102 | Hutang belum difakturkan | 311003 | Utang Barang Belum Difakturkan | **sementara** |
| 2103 | Uang muka penjualan | 314001 | Uang Muka Penjualan |  |
| 2201 | PPN Keluaran | 312005 | Utang PPN |  |
| 2301 | Hutang gaji (seed) | 312001 | Utang Gaji |  |
| 3101 | Modal / saldo awal | 410001 | Modal Pemilik |  |
| 3201 | Laba ditahan | 420001 | Saldo Laba Ditahan |  |
| 4101 | Penjualan produk | 510001 | Pendapatan Penjualan |  |
| 4102 | Diskon penjualan | 520002 | Diskon Penjualan |  |
| 4201 | Jasa klinik | 510002 | Pendapatan Jasa |  |
| 4301 | Bunga bank | 810001 | Pendapatan Bunga Bank | **sementara** |
| 4302 | Laba jual aset | 810003 | Keuntungan penjualan Aset Tetap |  |
| 4303 | Pendapatan lain / kelebihan kas / fee merchant | 810004 | Pendapatan Diluar Operasional Lain | **sementara** |
| 5101 | HPP | 600001 | HPP Penjualan Barang |  |
| 5201 | Gaji | 710001 | Beban Gaji dan Tunjangan |  |
| 5301 | Listrik & air | 720002 | Beban Listrik | **sementara** |
| 5302 | Perlengkapan | 740001 | Beban Perlengkapan Toko |  |
| 5303 | Transportasi | 740003 | Beban Transport |  |
| 5304 | Perawatan aset | 740007 | Beban Perbaikan Peralatan | **sementara** |
| 5305 | Komisi marketplace | 740020 | Beban Komisi Marketplace | **sementara** |
| 5401 | Operasional lain | 760003 | Beban Operasional Lain |  |
| 5501 | Admin bank | 740010 | Beban Admin Bank |  |
| 5601 | Penyusutan | 750004 | Beban Penyusutan Mesin dan Peralatan | **sementara** |
| 5602 | Rugi jual aset | 820004 | Kerugian Penjualan Aset Tetap |  |
| 5901 | Selisih kas | 760002 | Beban Selisih Kas |  |
| 5902 | Selisih persediaan | 720010 | Beban Selisih Stok |  |

Belum dihubungkan: 20 akun kas toko (110001–110022 selain 110003) dan 5 rekening BCA (selain 120002) sudah ada di
bagan akun, tetapi belum menjadi *rekening* di menu Kas & Bank (belum punya cabang/metode bayar). Kasir tetap memakai
110003 (Tunai) dan 120002 (non-tunai) sampai pemetaan rekening per cabang diatur.

## 4. Yang ikut diubah

- Database: kode akun di tempat; kolom yang menyimpan kode (rekening kas/bank, transaksi kas, anggaran, kebijakan
  demo klinik, alokasi pembayaran POS) ikut lewat ON UPDATE CASCADE; kolom teks/JSON (kas pelunasan, rekonsiliasi
  bank, kategori aset, snapshot rekening refund/pembayaran) diperbarui; semua fungsi database yang menyebut kode lama
  (literal, pesan, komentar) ditulis ulang; aturan impor COA ikut pola baru; cadangan bagan lama di
  `coa_bagan_baru_backup` untuk rollback.
- Aplikasi: semua kode akun keras, aturan kelompok dari kode, jatah rekening, petunjuk layar Bagan Akun, HPP di
  Laba Rugi/dashboard, contoh unduhan impor akun.

## 5. Panduan rilis (Wowo)

1. Jeda transaksi keuangan sebentar (kasir, klinik, pembelian, kas) — antara migrasi dan aplikasi baru live, aplikasi
   lama masih menulis kode lama dan sebagian jurnal bisa tidak tercatat.
2. Pasang migrasi `20261105010000_coa_bagan_baru.sql` (satu transaksi). Bila gagal dengan `COA_BARU_CONFLICT` /
   `COA_BARU_TYPE` / `COA_BARU_PARENT`, data produksi berbeda dari asumsi — STOP, kirim pesan errornya.
3. Kueri baca setelah pasang:

```sql
select 'akun6digit '||count(*) from coa_accounts where code ~ '^[1-8][0-9]{5}$';            -- 207 (+ akun 6 digit yang sudah ada sebelumnya)
select 'sisa_kode_lama '||count(*) from coa_accounts where code in('1101','1102','1301','2101','3101','4101','5101','5902'); -- 0
select 'fungsi_kode_lama '||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname not in('pg_catalog','information_schema') and p.prosrc ~ '(?<![0-9.])(1101|1102|1301|2101|2201|3101|4101|5101|5902)(?![0-9])'; -- 0
select 'opname '||stock_opname_account('inventory')||'/'||stock_opname_account('variance');  -- 170001/720010
select 'cadangan '||count(*) from coa_bagan_baru_backup;                                     -- = jumlah akun sebelum migrasi
```

4. Merge PR & tunggu Production; cek `/api/version` = SHA merge.
5. Lanjutkan transaksi. Cek Neraca & Laba Rugi tetap seimbang dan angka sama dengan sebelum migrasi (hanya kode/nama berubah).

Rollback (hanya bila perlu): jalankan `docs/rollback/2026-11-05-coa-bagan-baru.sql` bersamaan dengan rollback
aplikasi ke versi sebelum PR ini. Akun baru yang sudah sempat dipakai jurnal tidak dihapus (dilaporkan).

## 6. Untuk dicek Andri/finance (pilihan sementara)

1. Kas bawaan 1101 → 110003 Kas Kecil; bank bawaan 1102 → 120002 BCA Transaksi.
2. Aset tetap umum 1501 → 200008 Peralatan Kantor; akumulasi 1509 → 200015; penyusutan 5601 → 750004.
3. Bunga bank 4301 → 810001 (kelompok di luar operasional); 530001–530002 dibiarkan tidak dipakai sistem.
4. Pendapatan lain/kelebihan kas/fee merchant 4303 → 810004.
5. Listrik & air 5301 → 720002 Beban Listrik (720003 Air terpisah, belum dipakai otomatis); perawatan aset 5304 → 740007.
6. Akun baru 130009, 311003, 740020 — setujui atau ganti kode/nama.
7. Pemetaan rekening kas/bank per cabang (110001–110022, 120001–120006) untuk metode bayar kasir.
