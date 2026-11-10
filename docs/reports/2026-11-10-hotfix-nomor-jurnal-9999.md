# Hotfix 10 Nov 2026 — "Urutan nomor dokumen penuh" di kasir

## Gejala
Kasir (laporan Cimanggu, 15:57 WIB) tidak bisa menyimpan transaksi: banner "Urutan nomor dokumen penuh".

## Akar masalah
Nomor jurnal bulanan berformat `JRN-YYYYMM-NNNN` (4 digit, dipakai bersama semua cabang/modul).
Per 10 Nov 2026 November sudah 10.094 jurnal (± 4.167 penjualan + 4.128 HPP kasir, 1.250+ klinik, dst.),
nomor tertinggi `JRN-202611-9999`. `sales_next_number('JRN')` menolak saat urutan > 4 digit, sehingga
`finalize_pos_sale`, faktur/pengiriman grosir, kas, koreksi, dll. yang menulis jurnal lewat jalur ini gagal.
Jalur klinik (`clinic_write_journal`) sudah boleh 5 digit dan memang sudah memakai `JRN-202611-10000`+.

Dua jalur lain lebih parah: `create_purchase_invoice_from_po_internal` dan
`create_fixed_asset_purchase_internal` memformat `lpad(seq,4)` → 10000 terpotong jadi `1000`
(sudah terpakai) dan loop retry unique_violation tidak pernah selesai.

## Perbaikan (sudah diterapkan ke Production)
| Versi migrasi | Isi |
|---|---|
| `20261110090624_nomor_jurnal_lebih_dari_9999` | `sales_next_number`: seri JRN membaca semua digit depan sufiks dan boleh tumbuh ke 5+ digit. Seri DO/FJ/FJK/SO tidak berubah. |
| `20261110090739_nomor_jurnal_9999_pembelian_aset` | Tambal teks dua fungsi pembelian/aset dengan aturan yang sama (tiap pola wajib cocok tepat sekali). |

## Verifikasi live
- `sales_next_number('JRN','2026-11-10')` → `JRN-202611-10009`; Oktober tetap `JRN-202610-0025`; FJ tetap `FJ.2026.11.00013`.
- Transaksi kasir nyata tersimpan 16:06 WIB (`JRN-202611-10009` sale, `-10010` sale-hpp).
- Tidak ada penjualan kasir yang nyangkut setengah jalan sejak 15:40 WIB (transaksi yang gagal ter-rollback utuh;
  kasir perlu input ulang yang tadi gagal).

## Sisa
- `src/lib/no-dokumen.ts` `urutanBerikutnya` mengurutkan nomor secara teks, jadi untuk jalur JS (shift, sebagian
  pengeluaran) nomor > 9999 jatuh ke nomor bersuffix acak (`JRN-202611-10000-XXXX`). Tidak memblokir, tapi rapikan.
- Belum ada tes otomatis Postgres khusus untuk batas 9999.
