# Gap Menu Accurate → VetOS (audit 2026-07-28)

Sumber spek: `Dokumen/UI ERP KAMO 2026.pdf` (18 hal). Tile bertanda ✗ di PDF **tidak dihitung**.
Dibandingkan dengan: `src/lib/nav.ts` + route nyata di `src/app/(app)/`.

> Konteks: `docs/RINGKASAN-KLONING-ACCURATE-2026-07.md` menyatakan paritas **mesin akuntansi & inventori**
> sudah tutup — itu masih benar (FIFO, jurnal, tutup buku, PPN, opname 2-dokumen, dst).
> Yang diaudit di sini beda: **kelengkapan menu & dokumen** ala Accurate. Mesinnya ada, permukaannya belum.

**Skor kasar: ±30 dari 81 tile wajib = 37%.**

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

## 4. Kas & Bank (4 wajib) — 1/4 ⚠️ MODUL HILANG

Modul "Kas & Bank" **tidak ada** di VetOS. Cuma satu halamannya yang nyempil di modul Keuangan.

| Tile | Status |
|---|---|
| Rekonsiliasi Bank | ✅ `/keuangan/rekonsiliasi` |
| Pembayaran | ❌ |
| Penerimaan | ❌ |
| Transfer Bank | ❌ |

Plus permintaan PDF: menu integrasi & pengaturan **payment gateway** (rules beda dari Accurate).

## 5. Penjualan (10 wajib) — 2/10 ⚠️ GAP TERBESAR

| Tile | Status |
|---|---|
| Penjualan online / SmartLink e-Commerce | ✅ `/penjualan/online` |
| Retur Penjualan | ✅ `/penjualan/retur` |
| Penawaran Penjualan | ❌ |
| Pesanan Penjualan | ❌ |
| Pengiriman Pesanan | ❌ |
| Uang Muka Penjualan | ❌ |
| Faktur Penjualan | ❌ |
| Penerimaan Penjualan | ❌ |
| Komisi Penjual | ❌ |
| Target Penjualan | ❌ |

Klausul tambahan dari PDF (bukan clone polos Accurate):
- **Komisi Penjual**: insentif % dari jumlah sales karyawan · insentif tetap per produk per karyawan · insentif per kategori target. Pembuatan boleh **import Excel** (klausulnya banyak).
- **Target Penjualan**: target per kategori produk · per cabang · per karyawan.

## 6. Pembelian (9 wajib) — 5/9

| Tile | Status | Catatan |
|---|---|---|
| Pesanan Pembelian | 🔌 | `/pembelian` + `/pembelian/baru` jalan, tile-nya belum di-link |
| Faktur Pembelian | ✅ | `/pembelian/faktur` |
| Pembayaran Pembelian | ✅ | `/keuangan/hutang` |
| Retur Pembelian | ✅ | `/pembelian/retur` (tile-nya kedobel di nav) |
| Pemasok | 🔌 | Tab di dalam `/pembelian`; field cuma nama/kontak/telp/alamat (belum NPWP, termin, bank) |
| Penerimaan Barang | ⚠️ | Bukan dokumen sendiri — status PO → "Diterima" langsung stok masuk + jurnal 1301/2102. Belum bisa terima sebagian, catat rusak/selisih, atau punya nomor GR |
| Uang Muka Pembelian | ❌ | |
| Kategori Pemasok | ❌ | Kolom kategori di tabel `suppliers` tidak ada |
| Perintah Pembayaran | ❌ | |

## 7. Persediaan (14 wajib) — 9/14

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
| Satuan Barang | ✅ per barang lewat satuan berjenjang (`item_units`), bukan master global |
| Kategori Barang | ⚠️ tabel & dropdown ada, halaman CRUD-nya belum |
| Merek Barang | ✅ `/pos/merek` |
| Barang Stok Minimum | ❌ (tile "Reorder alert" ada tapi belum jadi) |

PDF: *"database barang dan jasa dibuat formatnya serupa dengan accurate agar saat migrasi mudah"* →
**4 master data terakhir itu blocker migrasi**, bukan nice-to-have.

## 8. Aset Tetap (6 wajib) — 1/6

| Tile | Status |
|---|---|
| Aset Tetap | ✅ `/keuangan/aset` (+ penyusutan otomatis) |
| Kategori Aset | ❌ |
| Kategori Aset Tetap Pajak | ❌ |
| Perubahan Aset Tetap | ❌ |
| Disposisi Aset Tetap | ❌ |
| Pindah Aset | ❌ |

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

### CRM (4 wajib) — 2/4
| Sub menu | Status |
|---|---|
| Promo | ✅ `/crm/promo` |
| Pelanggan | ✅ `/crm/pelanggan` (+ anabul, rekam medis) |
| Kategori Pelanggan (membership & strata) | ⚠️ `/pengaturan/tier` punya tier New→VIP, belum jadi menu CRM sendiri |
| Retention (WA automation + history pesan) | ❌ 7 trigger sudah dispesifikasi di PDF; kode follow-up ada tapi mati karena `FONNTE_TOKEN` kosong |

### HRIS (5 wajib) — 3/5
| Sub menu | Status |
|---|---|
| Karyawan | ✅ `/hris/karyawan` |
| Absensi | ✅ `/hris/absensi` |
| Menu Karyawan (self-service) | ⚠️ `/me` — cuti, absen, KPI ada; **reimburse & kasbon belum**; absen wajib radius 500 m dari titik koordinat cabang belum ada |
| Jadwal (shift & jam kantor) | ❌ PDF minta scheduler warna-warni per karyawan per hari |
| Slip Gaji | ⚠️ `/hris/penggajian` ada; **komponen berjenjang belum** (contoh PDF: potongan keterlambatan Rp10rb per 5 menit, batas bawah 1 menit, batas atas 1000 menit → Rp2 jt) |

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

1. **Master data & kategori** — Satuan Barang, Kategori Barang, Merek Barang, Kategori Pemasok, Kategori Pelanggan, Kategori Aset. Murah, dan PDF bilang ini syarat migrasi data dari Accurate lancar.
2. **Modul Kas & Bank** — Pembayaran, Penerimaan, Transfer Bank. Satu modul penuh yang hilang.
3. **Rantai dokumen Penjualan** — Penawaran → Pesanan → Pengiriman → Uang Muka → Faktur → Penerimaan.
4. **Sisa Pembelian** — Uang Muka, Perintah Pembayaran, Penerimaan Barang jadi dokumen sendiri (terima sebagian).
5. **Komisi & Target Penjualan** — banyak klausul, siapkan import Excel.
6. **HRIS Jadwal + komponen gaji berjenjang + reimburse/kasbon + absen radius 500 m.**
7. **Aset Tetap lengkap** (kategori, perubahan, disposisi, pindah).
8. **CRM Retensi** — begitu `FONNTE_TOKEN` masuk. Sekalian struk WA & WA rawat inap.
9. **Anggaran, SmartLink Tax, Daftar Laporan/SPT** — paling akhir; PDF sendiri bilang belum dipakai.
