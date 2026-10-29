# Penjualan per Tenaga Penjual + struk tanpa nama tenaga penjual — catatan teknis

Tanggal: 29 Oktober 2026 · Layar: **Laporan → Penjualan per Tenaga Penjual** (`/laporan/penjual`)
dan seluruh dokumen cetak klinik & kasir.

Permintaan Andri:

1. "Laporan penjualan per tenaga penjual itu belum ada" — yang dia butuhkan: siapa menjual apa,
   di semua kanal, dengan memisahkan Dokter dan Non-dokter yang tercatat di tiap baris.
2. "Di struk ga perlu ditampilkan siapa nama tenaga penjualnya. Cukup dokter PJ saja yang ditampilkan."

---

## 1. Laporan

### Sumber dokumen (persis sama dengan laporan omzet)

| Kanal | Tabel | Saringan tanggal | Yang tidak ikut |
|---|---|---|---|
| Petshop | `sale_items` → `sales` | `sales.created_at` dalam jendela WIB | `voided_at` terisi; rencana bayar belum diselesaikan (`isCompletedSale`) |
| Klinik | `invoice_items` → `invoices` | `invoices.created_at` dalam jendela WIB | `voided_at` terisi |
| Grosir | `sales_invoice_items` → `sales_invoices` | `sales_invoices.tanggal` | `fakturGrosirOmzet`: batal, void, faktur pengganti (`replaces_invoice_id`), saldo awal, kategori `selisih_stok` |

Baris rawat inap tidak punya dokumen penjualan sendiri — semuanya mengalir ke `invoice_items`
tagihan kunjungannya, jadi sudah tercakup lewat kanal Klinik. Sudah diperiksa di basis data:
tidak ada tabel penjualan rawat inap terpisah.

Basis klinik adalah **tanggal terbit tagihan** (akrual), sama seperti laporan omzet, BUKAN
tanggal pelunasan yang dipakai laporan Komisi. Ini perbedaan yang disengaja dan ditulis di
catatan kaki laporan.

### Nilai per baris

`src/lib/alokasi-potongan.ts` → `alokasiPotonganDokumen(kotorPerBaris, totalDokumen)`:

```
potongan  = max(0, Σ kotor − total dokumen)
neto(i)   = kotor(i) − potongan × kotor(i) / Σ kotor
```

Fungsi ini **dipakai bersama** `src/lib/komisi-data.ts` (ketiga kanalnya ikut diubah supaya
memanggil fungsi yang sama), jadi pembagian potongan kepala dokumen di laporan ini identik
dengan laporan Komisi. Diuji langsung: `src/app/(app)/laporan/penjual/data.test.ts`
membandingkan hasil `ambilTenagaPenjual` dengan `kumpulkanBarisKomisi` untuk tagihan yang sama.

Dasar `totalDokumen` per kanal: struk = `total − merchant_fee_total` (fee merchant bukan omzet
penjual); klinik = `invoices.total`; grosir = `nilaiBarisGrosir` per baris (jumlahnya = DPP).

Bagian total dokumen yang tidak melekat ke baris mana pun (pajak / biaya kepala dokumen)
dihitung terpisah sebagai `selisihDokumen` dan ditulis di catatan kaki, tidak dibagikan diam-diam.
Pemeriksaan Production 29 Okt 2026: nol untuk semua dokumen yang ada.

### Siapa pemilik baris

Urutan, per baris:

1. `service_performers.doctor_id` → peran **Dokter**; `service_performers.staff_id` → peran **Non-dokter**.
   Baris berdua masuk ke **dua** orang, masing-masing nilai penuh.
2. Kalau tidak ada `service_performers`: isian penjual lama → peran **Penjual (dokumen lama)**.
   - klinik: `invoice_items.salesperson_id` lalu `invoices.salesperson_id` (bekas isian "Penjual SKU")
   - petshop: `sales.salesperson_id` lalu karyawan pemilik `sales.cashier_id`
   - grosir: karyawan pemilik `sales_invoices.created_by`
3. Tagihan klinik lama tanpa keduanya → `visits.doctor_id` (dokter PJ), dihitung sebagai peran **Dokter**.
4. Tidak ada satu pun → baris **"Tanpa tenaga penjual"**.

Pemeriksaan Production 29 Okt 2026: 27 baris klinik punya atribusi per baris, 16 punya penjual
lama, 0 kosong; 4 baris kasir punya atribusi, 38 punya penjual lama, 0 kosong; 7 faktur grosir
semuanya punya pembuat yang terhubung ke kartu karyawan.

### Total perusahaan vs jumlah per orang

`rekapTenagaPenjual` menyimpan `Set` id baris untuk akumulator perusahaan, jadi baris yang
dikerjakan dua orang dihitung **sekali** di total perusahaan dan **dua kali** kalau baris per
orang dijumlahkan sendiri. Keduanya ditampilkan terpisah (baris `tfoot` "Total perusahaan")
dan dijelaskan di catatan kaki.

### Retur & pembatalan

- Retur kasir: dikurangkan dari **struk asalnya**, berapa pun tanggal returnya — aturan yang
  sama dengan Rincian Penjualan per Transaksi. Nilainya diskalakan terhadap
  `merchandise/total` supaya fee merchant pelanggan tidak ikut dipotong dari omzet penjual.
  Baris retur mewarisi pemilik baris asalnya lewat `source_line_id`.
  Retur yang `source_line_id`-nya kosong **pada struk yang punya atribusi per baris** tidak
  ditebak pemiliknya: masuk "Tanpa tenaga penjual" dan nilainya disebut di catatan kaki.
- Refund klinik (J03): membalik porsi `qty` dari baris invoice asalnya, pemiliknya mengikuti
  baris itu. Tabel `clinic_refunds` yang belum termigrasi ditangani seperti di `komisi-data`
  (kode galat `PGRST205` / `42P01` → dianggap tidak ada refund).
- Grosir tidak punya dokumen retur: koreksinya lewat faktur pengganti, sudah tersaring
  `fakturGrosirOmzet`.

### Cocok silang dengan laporan omzet

Rentang 1–31 Oktober 2026 (Production, baca-saja):

| | Nilai |
|---|---|
| Petshop (barang, setelah fee) | 3.342.500 |
| Retur petshop | −7.500 |
| Klinik | 10.300.000 |
| Grosir (DPP) | 1.429.000 |
| **Total netto laporan ini** | **15.064.000** |

Rincian Penjualan per Transaksi untuk filter yang sama: Total tagihan 15.071.500 − Retur 7.500
= **Tagihan bersih 15.064.000**. Cocok.

Catatan: grosir dihitung pada DPP (sebelum PPN), sedangkan kartu "Total tagihan" laporan omzet
memakai total faktur. Saat ini seluruh faktur grosir berPPN nol sehingga angkanya sama persis;
begitu ada faktur berPPN, selisihnya adalah PPN dan itu memang bukan omzet penjual.

### Saringan & akses

Periode (rentang tanggal WIB), cabang, kanal, peran, karyawan (pemilih ketik-cari `EmployeePicker`
dari PR #313), dan jenis. Saringan peran/karyawan bekerja pada **pasangan** (baris × orang),
bukan pada baris — memilih "Non-dokter" menyisakan sisi non-dokter dari baris berdua, bukan
membuang barisnya.

Akses cabang memakai `allowedBranchIds`: baris dan pilihan cabang di luar penempatan pengguna
tidak pernah sampai ke layar maupun unduhan. Akses layar sendiri mengikuti modul `laporan`,
sama seperti laporan penjualan lain.

Unduhan Excel/CSV/PDF memakai `UnduhLaporan` bawaan `LaporanPage` (seluruh tabel di halaman,
termasuk tabel rincian di dalam panel per orang).

---

## 2. Dokumen cetak

`src/lib/dokter-pj.ts` menyediakan `namaDokterPJ` + `bacaNamaDokter`. Nama diambil dari kartu
karyawan yang ditunjuk `visits.doctor_id`; kunjungan lama yang hanya menyimpan teks
`visits.dokter` memakai teks itu; kunjungan tanpa keduanya tidak mencetak barisnya.

| Dokumen | Perubahan |
|---|---|
| `klinik/pembayaran/[visitId]/struk` (80 mm) | nama pelaksana per baris dihapus; baris kepala "Dokter PJ" |
| `klinik/pembayaran/[visitId]/invoice` (A4) | nama pelaksana per baris dihapus; "Dokter PJ" kini dari `doctor_id`, hilang bila kosong (dulu selalu tercetak "-") |
| `klinik/pembayaran/[visitId]/struk-rombongan` | nama pelaksana per baris dihapus; "Dokter PJ" per hewan, karena tiap hewan punya kunjungannya sendiri |
| `pos/struk/[saleId]` (cetak ulang back office) | nama pelaksana per baris + catatan layarnya dihapus |
| `kasir/struk/[saleId]` (58 mm) | nama pelaksana per baris + catatan layarnya dihapus |

Struk petshop **tidak pernah** mencetak baris dokter: tabel `sales` tidak punya kaitan ke
`visits` (tidak ada kolom visit), jadi tidak ada dokter PJ yang bisa disebut tanpa mengarang.

Layar kerja staf tetap menampilkan pelaksana per baris: layar pembayaran klinik, rekam medis,
serah terima rawat inap, dan laporan penjualan per barang. Kolom `service_performers` tidak
dihapus dari basis data dan tidak ada migrasi di pekerjaan ini.
