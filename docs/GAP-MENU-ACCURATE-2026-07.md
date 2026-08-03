# Gap Menu Accurate → VetOS (audit 2026-07-28)

Sumber spek: `Dokumen/UI ERP KAMO 2026.pdf` (18 hal). Tile bertanda ✗ di PDF **tidak dihitung**.
Dibandingkan dengan: `src/lib/nav.ts` + route nyata di `src/app/(app)/`.

> Konteks: `docs/RINGKASAN-KLONING-ACCURATE-2026-07.md` menyatakan paritas **mesin akuntansi & inventori**
> sudah tutup — itu masih benar (FIFO, jurnal, tutup buku, PPN, opname 2-dokumen, dst).
> Yang diaudit di sini beda: **kelengkapan menu & dokumen** ala Accurate. Mesinnya ada, permukaannya belum.

**Skor kasar: ±49 dari 81 tile wajib = 60%.**
_(diperbarui 2026-08-03 — Kas & Bank, HRIS, Pembelian, Aset Tetap, dan Penjualan semuanya tutup penuh; migrasi 0098)_

Legenda: ✅ jalan · ⚠️ ada sebagian / beda bentuk · ❌ belum ada · 🔌 halaman ada tapi tile-nya belum di-link

---

## 1. Pengaturan (6 wajib) — 1/6
PDF: *"menu pengaturan umumnya mengikuti aturan dari pihak developer"* → paling longgar, boleh beda.

| Tile | Status | Catatan |
|---|---|---|
| Preferensi | ❌ | |
| Akses Grup | ⚠️ | Role hardcoded di `allowedModules()`, bukan editor grup |
| Pengguna | ✅ | `/pengaturan/pengguna` |
| Penomoran | ❌ | Nomor dokumen masih hardcoded pola per modul |
| Desain Cetakan | ❌ | |
| Penyetuju Transaksi | ❌ | |

Ekstra VetOS (di luar Accurate): Pajak/Mode PKP, Konfigurasi loyalty, Cabang & gudang.

## 2. Perusahaan (7 wajib) — 2/7

| Tile | Status | Catatan |
|---|---|---|
| Cabang | ✅ | `/perusahaan/cabang` |
| Transaksi Berulang | 🔌 | Halaman ada di `/keuangan/jurnal-berulang`, tile Perusahaan belum di-link |
| Proses Akhir Bulan | ❌ | Ada `/keuangan/tutup-buku` (mirip tapi beda: PDF minta auto tiap tgl 1 + closing payroll) |
| Transaksi Favorit | ❌ | |
| Persetujuan (Approval) | ❌ | |
| Kalender | ❌ | PDF: dipakai sebagai reminder |
| Log Aktifitas | ⚠️ | `/buku-besar/log` khusus jurnal, bukan log seluruh sistem |

## 3. Buku Besar (9 wajib) — 6/9

| Tile | Status |
|---|---|
| Akun Perkiraan | ✅ `/keuangan/coa` |
| Pencatatan Beban | ✅ `/buku-besar/beban` |
| Pencatatan Gaji | ✅ `/hris/penggajian` |
| Jurnal Umum | ✅ `/keuangan/jurnal` |
| Histori Akun | ✅ `/keuangan/buku-besar` |
| Log Aktifitas Jurnal | ✅ `/buku-besar/log` |
| Anggaran | ❌ |
| Monitor Anggaran | ❌ |
| Transfer Anggaran | ❌ |

PDF: *"Menu anggaran belum dipakai tapi ada rencana dimanfaatkan untuk efisiensi cost"* → prioritas rendah.

## 4. Kas & Bank (4 wajib) — 4/4 ✅ SELESAI 2026-08-02

| Tile | Status |
|---|---|
| Rekonsiliasi Bank | ✅ `/keuangan/rekonsiliasi` — per rekening (dulu terkunci ke BCA) |
| Pembayaran | ✅ `/keuangan/hutang` (bayar faktur) + `/kas-bank/kas-keluar` |
| Penerimaan | ✅ `/keuangan/piutang` + `/kas-bank/kas-masuk` |
| Transfer Bank | ✅ `/kas-bank/transfer` |

Ditambah di luar daftar Accurate: master `/kas-bank/rekening` + **buku mutasi per rekening**,
dan `/kas-bank/peta` (peta metode bayar → rekening) yang menghapus asumsi lama "semua non-tunai
masuk satu akun Bank".

Plus permintaan PDF: menu integrasi & pengaturan **payment gateway** (rules beda dari Accurate).

## 5. Penjualan (10 wajib) — 10/10 ✅ SELESAI 2026-08-03

| Tile | Status |
|---|---|
| Penjualan online / SmartLink e-Commerce | ✅ `/penjualan/online` |
| Retur Penjualan | ✅ `/penjualan/retur` |
| Penawaran Penjualan | ✅ `/penjualan/penawaran` — bisa langsung dijadikan pesanan |
| Pesanan Penjualan | ✅ `/penjualan/pesanan` (+ halaman detail: kirim & tagih bertahap) |
| Pengiriman Pesanan | ✅ `/penjualan/pengiriman` — stok keluar FIFO, modal diakui di sini |
| Uang Muka Penjualan | ✅ `/penjualan/uang-muka` — akun 2103, dipotong otomatis saat faktur dilunasi |
| Faktur Penjualan | ✅ `/penjualan/faktur` — piutang & pendapatan, PPN keluaran ikut kalau PKP |
| Penerimaan Penjualan | ✅ Pelunasan faktur dari layar yang sama, boleh memotong uang muka |
| Komisi Penjual | ✅ `/penjualan/komisi` — aturan persen/nominal, basis omzet atau laba, cakupan berlapis, ambang cair, dan insentif dokter dari tagihan klinik (migrasi 0092) |
| Target Penjualan | ✅ `/penjualan/target` — per perusahaan/cabang/karyawan/kategori + monitor realisasi |

Klausul tambahan dari PDF (bukan clone polos Accurate):
- **Komisi Penjual**: insentif % dari jumlah sales karyawan · insentif tetap per produk per karyawan · insentif per kategori target. Pembuatan boleh **import Excel** (klausulnya banyak).
- **Target Penjualan**: target per kategori produk · per cabang · per karyawan.

## 6. Pembelian (9 wajib) — 9/9 ✅ SELESAI 2026-08-03

| Tile | Status | Catatan |
|---|---|---|
| Pesanan Pembelian | ✅ | `/pembelian` + `/pembelian/baru` |
| Faktur Pembelian | ✅ | `/pembelian/faktur` |
| Pembayaran Pembelian | ✅ | `/keuangan/hutang` — bisa memotong uang muka |
| Retur Pembelian | ✅ | `/pembelian/retur` |
| Pemasok | ✅ | Tab di dalam `/pembelian`; field masih nama/kontak/telp/alamat (NPWP, termin, bank menyusul) |
| Penerimaan Barang | ✅ | `/pembelian/penerimaan` — dokumen bernomor TB per kiriman, terima sebagian, catat rusak/ditolak, tanda terima bisa dicetak |
| Uang Muka Pembelian | ✅ | `/pembelian/uang-muka` — akun 1303, dipotongkan otomatis saat melunasi faktur |
| Kategori Pemasok | ✅ | `/pembelian/kategori-pemasok` + kolom & dropdown di daftar pemasok |
| Perintah Pembayaran | ✅ | `/pembelian/perintah-bayar` — diajukan → disetujui → dibayar, faktur terkunci dari pengajuan ganda |

## 7. Persediaan (14 wajib) — 10/14

| Tile | Status |
|---|---|
| Permintaan Barang | ✅ `/pos/permintaan` |
| Pemindahan Barang | ✅ `/pos/pemindahan` |
| Perintah Stok Opname | ✅ `/pos/opname` |
| Hasil Stok Opname | ✅ `/pos/opname` |
| Barang & Jasa | ✅ `/pos/sku` — form bertab ala Accurate: jenis barang, kode wajib, UPC, merek, min stok |
| Gudang | ✅ `/pengaturan/cabang` |
| Penambahan Bahan Baku | ⚠️ `/klinik/bahan-baku` (khusus klinik) |
| Penyesuaian Persediaan | ❌ |
| Pekerjaan Pesanan | ❌ |
| Penyelesaian Pesanan | ❌ |
| Satuan Barang | ✅ `/pos/satuan` — master global; satuan dipilih dari daftar, tidak lagi teks bebas |
| Kategori Barang | ✅ `/pos/kategori` — CRUD bertingkat 2 tingkat (induk → anak) |
| Merek Barang | ✅ `/pos/merek` |
| Barang Stok Minimum | ❌ (tile "Reorder alert" ada tapi belum jadi) |

PDF: *"database barang dan jasa dibuat formatnya serupa dengan accurate agar saat migrasi mudah"* →
**4 master data terakhir itu blocker migrasi**, bukan nice-to-have.

## 8. Aset Tetap (6 wajib) — 6/6 ✅ SELESAI 2026-08-03

| Tile | Status |
|---|---|
| Aset Tetap | ✅ `/keuangan/aset` (+ penyusutan otomatis, halaman detail per aset) |
| Kategori Aset | ✅ `/keuangan/kategori-aset` — umur & akun jurnal per kategori; jurnal penyusutan pecah per kategori |
| Kategori Aset Tetap Pajak | ✅ `/keuangan/kategori-aset-pajak` — golongan fiskal UU PPh Ps.11, garis lurus & saldo menurun, tabel penyusutan fiskal per aset |
| Perubahan Aset Tetap | ✅ Tambah nilai (perbaikan besar, berjurnal) & revisi umur ekonomis, lengkap dengan riwayat |
| Disposisi Aset Tetap | ✅ Jual atau hapus — akumulasi penyusutan ikut dihapus, laba/rugi pelepasan masuk akun 4302/5602 |
| Pindah Aset | ✅ Pindah cabang dengan jejak asal & tujuan (tanpa jurnal — perusahaannya sama) |

## 9. SmartLink Tax (3 wajib) — 0/3
e-Faktur CTAS · Email Faktur Pajak · e-Faktur Legacy.
PDF: *"belum dipakai, pelaporan pajak masih manual, tapi boleh jika tidak sulit"* → prioritas paling rendah.
Sejalan dengan keputusan boss 2026-07-28: PT sudah PKP & pungut PPN, **tapi lapor manual karena ada adjustment**.

## 10. Daftar Laporan (4 wajib) — 0/4
Daftar Laporan (hub) · SPT PPN/PPNBM · SPT PPh Ps.21 · Bukti Potong PPh Ps.21.
Laporan VetOS sudah banyak tapi tersebar di modul Keuangan, belum ada halaman hub-nya.
PDF: form SPT/Bupot *"digunakan hanya untuk unduh formulir"*.

---

## Tambahan di luar Accurate

### CRM (4 wajib) — 3/4
| Sub menu | Status |
|---|---|
| Promo | ✅ `/crm/promo` |
| Pelanggan | ✅ `/crm/pelanggan` (+ anabul, rekam medis) |
| Kategori Pelanggan (membership & strata) | ✅ `/crm/kategori-pelanggan` — golongan bisa dibuat sendiri + diskon persen otomatis di kasir; strata belanja tetap terpisah di `/pengaturan/tier` |
| Retention (WA automation + history pesan) | ❌ 7 trigger sudah dispesifikasi di PDF; kode follow-up ada tapi mati karena `FONNTE_TOKEN` kosong |

### HRIS (5 wajib) — 5/5 ✅ SELESAI 2026-08-02
| Sub menu | Status |
|---|---|
| Karyawan | ✅ `/hris/karyawan` |
| Absensi | ✅ `/hris/absensi` — wajib dari radius koordinat cabang |
| Menu Karyawan (self-service) | ✅ `/me` — cuti, absen, KPI, lembur, kasbon, reimburse |
| Jadwal (shift & jam kantor) | ✅ `/hris/shift` + `/hris/jadwal` — papan bulanan berwarna per karyawan |
| Slip Gaji | ✅ `/hris/penggajian` — otomatis dari absensi, lembur, komponen, kasbon, komisi; potongan telat berblok dengan batas bawah & atas |

### Frontend Petshop — hampir penuh
Mulai shift ✅ · Kasir ✅ · Pengeluaran ✅ · Pemesanan/Penerimaan ✅ · Closing ✅
Belum: **struk otomatis kirim ke WA** · **popup notif promosi berjalan di menu kasir** · input nomor HP pelanggan belum wajib.

### Frontend Klinik — penuh
Rawat jalan ✅ · rawat inap ✅ · resep & racik ✅ · consent ttd online ✅ · invoice ✅
Belum: **WA laporan rawat inap ke customer** (nunggu `FONNTE_TOKEN`).

---

## Sudah dikerjakan 2026-07-28: penggolongan menu ikut Accurate

`src/lib/nav.ts` ditulis ulang mengikuti struktur PDF. Yang berubah:

- Sidebar sekarang: Dashboard · Klinik · CRM · HRIS (khusus VetOS) lalu **10 modul Accurate**
  persis urutan sidebar-nya: Pengaturan · Perusahaan · Buku Besar · Kas & Bank · Penjualan ·
  Pembelian · Persediaan · Aset Tetap · Pajak · Daftar Laporan.
- Modul baru (halaman modul + tile, isi menyusul): **Kas & Bank**, **Aset Tetap**, **Pajak**, **Daftar Laporan**.
- Modul lama **"POS & Inventori" → "Persediaan"** (id route `pos` dipertahankan, jadi `/pos/*` tidak pindah).
- Modul lama **"Keuangan" dibongkar** — isinya disebar ke Buku Besar / Kas & Bank / Aset Tetap /
  Pajak / Daftar Laporan sesuai Accurate. `/keuangan` sekarang redirect ke `/laporan`;
  seluruh route anak `/keuangan/*` tetap jalan dan tidak dipindah.
- Urutan tile di tiap modul disamakan dengan PDF; tile khusus VetOS ditaruh di akhir grup.
- `FINANCE_MODULES` + `FINANCE_ALLOWED` (middleware) diperbarui agar role FINANCE tetap
  kebagian Kas & Bank / Aset Tetap / Pajak / Daftar Laporan. Piutang & hutang sengaja
  ditaruh di Kas & Bank (ala Accurate: Penerimaan = terima piutang, Pembayaran = bayar hutang).
- 4 bug menu ikut beres: "Pesanan Pembelian" & "Pemasok" & "Transaksi Berulang" sekarang
  punya `href`, dan "Retur Pembelian" tidak lagi kedobel.

Angka gap di atas **tidak berubah** — yang berubah cuma penggolongan & label, bukan jumlah fitur jadi.

## Usulan urutan garap

1. ~~**Master data & kategori**~~ — **SELESAI 2026-07-28** (migrasi 0066). Satuan global, Kategori Barang bertingkat, Merek, Kategori Pemasok, Kategori Pelanggan + diskon, Kategori Aset. Sisa: Kategori Aset Tetap **Pajak** — pindah ke butir 7.
2. **Modul Kas & Bank** — Pembayaran, Penerimaan, Transfer Bank. Satu modul penuh yang hilang.
3. ~~**Rantai dokumen Penjualan**~~ — **SELESAI 2026-08-03** (migrasi 0098). Penawaran → Pesanan →
   Pengiriman → Faktur → Penerimaan, plus Uang Muka Penjualan.
4. ~~**Sisa Pembelian**~~ — **SELESAI 2026-08-03** (migrasi 0093–0096). Penerimaan Barang jadi
   dokumen bernomor dengan catatan barang rusak, Uang Muka Pembelian, dan Perintah Pembayaran.
5. ~~**Komisi & Target Penjualan**~~ — **SELESAI 2026-08-03** (migrasi 0091 & 0092, termasuk
   insentif dokter dari tagihan klinik). Sisa: import Excel aturan/target.
6. ~~**HRIS Jadwal + komponen gaji + reimburse/kasbon + absen radius**~~ — **SELESAI 2026-08-02**
   (migrasi 0087–0090).
7. ~~**Aset Tetap lengkap**~~ — **SELESAI 2026-08-03** (migrasi 0097).
8. **CRM Retensi** — begitu `FONNTE_TOKEN` masuk. Sekalian struk WA & WA rawat inap.
9. **Anggaran, SmartLink Tax, Daftar Laporan/SPT** — paling akhir; PDF sendiri bilang belum dipakai.
