# Uji alur lintas modul — 2026-08-04

Simulasi satu cerita bisnis penuh di lingkungan pengembangan, dari uang keluar ke pemasok
sampai laporan laba rugi, untuk memastikan modul-modul yang dibangun terpisah benar-benar
tersambung. Seluruh data uji dan jurnalnya dihapus balik setelah selesai (dicek: total jurnal
kembali persis ke angka semula).

## Skenario

| # | Langkah | Hasil |
|---|---|---|
| 1 | Uang muka ke pemasok Rp 2.000.000 | Dr 1303 / Cr 1102 — jadi hak tagih, bukan beban |
| 2 | PO 20 pcs @ Rp 210.000 = Rp 4.200.000 | Status Draft |
| 3 | Terima barang penuh | Dokumen `TB.2026.08.00001`, stok 0 → 20, Dr 1301 / Cr 2102 Rp 4.200.000 |
| 4 | Faktur pembelian | Jatuh tempo terisi otomatis dari termin pemasok (30 hari → 2026-09-01) |
| 5 | Bayar Rp 2.000.000 pakai uang muka | Dr 2101 / Cr 1303 — **kas tidak keluar lagi** |
| 6 | Sisa Rp 2.200.000 lewat Perintah Bayar | Diajukan → disetujui → dibayar |
| 7 | Penawaran 10 pcs @ Rp 300.000 → jadikan pesanan | `SQ` → `SO` |
| 8 | Kirim 10 pcs | Stok 20 → 10, Dr 5101 / Cr 1301 Rp 2.100.000 |
| 9 | Terbitkan faktur | Dr 1201 / Cr 4101 Rp 3.000.000, pesanan jadi "selesai" |
| 10 | Uang muka pelanggan Rp 1.000.000 | Dr 1102 / Cr 2103 — jadi kewajiban, bukan pendapatan |
| 11 | Terima pelunasan Rp 3.000.000 | Dr 1102 Rp 2.000.000 + Dr 2103 Rp 1.000.000 / Cr 1201 Rp 3.000.000 |

## Yang terbukti nyambung

- **Saldo akun bersih di kedua ujung.** Setelah alur beli selesai: Hutang Usaha 0, Hutang Belum
  Difakturkan 0, Uang Muka Pembelian 0. Setelah alur jual selesai: Piutang 0, Uang Muka
  Penjualan 0. Tidak ada saldo menggantung.
- **Uang tidak dihitung dua kali.** Porsi yang diambil dari uang muka — di sisi beli maupun
  jual — tidak menyentuh kas lagi.
- **Stok & modal bergerak di dokumen yang benar.** Stok naik saat penerimaan barang, turun saat
  pengiriman; modal (HPP) diakui saat barang keluar, pendapatan saat faktur.
- **Laporan Laba Rugi cocok dengan jurnal**: pendapatan Rp 3.280.000, HPP Rp 2.260.000,
  laba kotor Rp 1.020.000, penyusutan Rp 822.083, **laba bersih Rp 197.917** — persis sama
  dengan selisih aset di neraca (Rp 197.917), jadi neraca seimbang.
- **Jurnal seimbang di setiap langkah** (total debit = total kredit sepanjang uji).
- **Monitor Anggaran menangkap HPP** dari penjualan reseller sebagai realisasi berjalan.

## Temuan: yang BELUM nyambung

Rantai dokumen penjualan (migrasi 0098) adalah aliran pendapatan **ketiga**, di samping struk
kasir (`sales`) dan tagihan klinik (`invoices`). Layar-layar lama hanya membaca dua yang lama.

| # | Temuan | Bukti dari uji |
|---|---|---|
| 1 | **Penjualan reseller tidak masuk Komisi & Target Penjualan** | Target Rp 5.000.000 menunjukkan realisasi Rp 280.000 (struk kasir saja), padahal ada penjualan Rp 3.000.000. Komisi Rp 0. |
| 2 | **Tidak masuk omzet Dashboard** | `lib/dashboard.ts` hanya membaca `sales` + `invoices`. |
| 3 | **Piutang reseller tidak muncul di layar Piutang** | `/keuangan/piutang` khusus tagihan klinik. Piutangnya ada, tapi hanya terlihat di layar Faktur Penjualan. |

Akibat praktisnya: kalau penjualan B2B dipakai beneran, **omzet perusahaan terlihat lebih kecil
dari yang sebenarnya** di dashboard dan di target, dan sales yang menggarap reseller tidak
dapat komisi.

## Temuan lama (bukan dari pekerjaan ini)

Stok `Collar Kucing S` di WH CIAW **minus 8**, dari struk `POS-20260802-0001` (2 Agustus):
barang terjual padahal stoknya tidak pernah dicatat masuk. Perlu penyesuaian persediaan atau
pencatatan stok awal.
