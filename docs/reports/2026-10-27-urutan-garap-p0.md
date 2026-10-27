# Urutan garap 13 butir P0 yang belum tuntas — 27 Oktober 2026

Sumber: Google Sheet "KAMO — Checklist Feedback Meeting — 85 Butir" (tab Checklist) dicocokkan dengan kode di
main `31ababf2`. Status di bawah adalah hasil cek kode, bukan salinan sheet.

Catatan sheet: kolom "Yang sudah jadi" dan "Sisa/kendala" di banyak baris tidak sesuai butirnya (contoh M05 berisi
catatan komisi, R04 berisi catatan printer). Kolom status/checkbox tampak tetap sesuai ID. Perlu dirapikan pemegang sheet.

## Gelombang 1 — wajib sebelum 1 November (cutover)

| # | ID | Status nyata di kode | Sisa | Jenis hambatan | Ukuran |
|---|----|----------------------|------|----------------|--------|
| 1 | M02 Cutover | Impor rekam medis append-only + aman diulang (`klinik/rekam-medis/impor`); impor stok awal Accurate + posting OWNER (`pos/sku/impor`, `keuangan/persediaan-awal`) | Tidak ada runbook 28 Okt–1 Nov (urutan, freeze, total kontrol, rollback). Stok awal terkunci sekali posting (migrasi `20261021123000`) → keputusan: posting sekali 31 Okt, atau koreksi via opname. Belum pernah dijalankan dengan file nyata | Dokumen + keputusan + data | Kecil |
| 2 | M05 Saldo utang/piutang per faktur | **Belum ada sama sekali.** `keuangan/saldo-awal` hanya total per akun | Impor Excel per faktur → `purchase_invoices`/`sales_invoices` sebagai faktur pembuka, bisa dilunasi lewat `purchase_invoice_payments`/`sales_receipts`; cek duplikat nomor faktur; akun penyeimbang agar tidak dobel dengan saldo awal akun | Kode + keputusan finance | Sedang–besar |
| 3 | K03 Racikan wajib komposisi | Rawat jalan sudah wajib komposisi (#150), dokter boleh pilih bahan (#251, live 27 Okt), DB tolak racikan setelah invoice | Form rawat inap masih punya tombol "Ambil stok obat jadi" (`rawat-inap/[id]/catatan/CatatanForm.tsx:470`); belum ada guard DB racikan disimpan sebagai obat biasa; peran selain OWNER/ADMIN | Keputusan kecil + kode | Kecil |
| 4 | P01 Koreksi pembelian per peran | Semua koreksi dokumen terposting hanya OWNER + jejak alasan + jurnal balik. #248 (merge 27 Okt, migrasi sudah terpasang) menambah antrean permintaan koreksi + alert owner | Belum ada peran "manajer"; STAFF/FINANCE default tidak punya modul Pembelian sehingga tidak bisa mengajukan; permintaan hanya catatan | Keputusan matriks peran + UAT | Kecil |

## Gelombang 2 — minggu pertama operasional

| # | ID | Status nyata | Sisa | Hambatan | Ukuran |
|---|----|--------------|------|----------|--------|
| 5 | J03 Retur/refund | Petshop lengkap: tunai/transfer bebas dari metode awal, antrean transfer pending→selesai, anti dobel, stok kembali | **Refund klinik belum ada** (hanya preview SQL `preview_clinic_refund_source`, tidak dipakai). Transaksi berpoin ditolak (aturan pembalikan poin belum ada) | Kode + keputusan (admin fee, insentif, bahan racikan terpakai, poin) | Sedang–besar |
| 6 | K07 Serah terima konsul→ranap | Panel handoff menampilkan resep/racikan/tindakan + status ditagih/diserahkan/diberikan (#206, #208) | Lama inap yang sudah dibayar belum dihitung — draft #220 ada, perlu review + rename migrasi | Kode | Sedang |
| 7 | P08 Koreksi seluruh siklus pembelian | PO, uang muka (belum terpakai), faktur, faktur langsung, pembayaran, perintah bayar punya jalur koreksi + histori | **Penerimaan barang tidak bisa dikoreksi** (hanya via retur + PO baru); DP terpakai harus diurai manual | Kode | Sedang |
| 8 | K13 Riwayat lintas cabang | #137: riwayat lintas cabang tampil hanya untuk akun yang sudah punya akses kedua cabang | Dokter satu-cabang tetap tidak lihat (RLS). Perlu RPC berbasis ID pasien + migrasi. Draft #237 = desain saja | Keputusan akses/privasi → kode | Sedang |

## Gelombang 3 — sebelum tutup buku November (butuh keputusan finance)

| # | ID | Status nyata | Sisa | Hambatan | Ukuran |
|---|----|--------------|------|----------|--------|
| 9 | I02 Jurnal stok opname | Posting SO atomik + jurnal seimbang live; #215 cek jurnal vs akun 1301 | Kebijakan: selisih toko sekarang jadi piutang ke toko pusat, klinik jadi beban — mau disamakan? Mapping akun selisih; opname lama setengah-posting rekonsiliasi manual | Keputusan + UAT | Kecil |
| 10 | R04 Nilai stok historis | Snapshot bulanan, nilai per tanggal, banding GL 1301 per cabang (#210/#227/#231/#256) | Kebijakan stok minus (nilai jadi "tidak diketahui"); tidak ada histori biaya sebelum average aktif; cabang ikut gudang saat ini; GL 1301 dibaca live | Keputusan + UAT | Kecil–sedang |
| 11 | P02 Koreksi pembelian setelah barang terjual | Sistem menolak batal faktur bila barang sudah terpakai. `reprice_purchase_invoice_layers` ada di DB tapi tidak dipakai layar | Aturan untuk 70 yang sudah terjual (sesuaikan HPP / akun selisih / hitung ulang kartu stok) + pratinjau dampak. Draft #62 tidak menutup ini | Keputusan finance → kode | Besar |

## Gelombang 4 — sebelum payroll otomatis (payroll ditunda sesudah migrasi)

| # | ID | Status nyata | Sisa | Hambatan | Ukuran |
|---|----|--------------|------|----------|--------|
| 12 | H06 Insentif visit ranap | Visit dokter tercatat di `inpatient_daily_logs` (`log_kind='doctor_visit'`) + audit edit | Tidak ada kode komisi/payroll yang membacanya; aturan visit unik, duplikat, wajib tertagih atau tidak | Keputusan (tarif, ditagih vs dikerjakan) → kode | Sedang |
| 13 | H05 Paket vs komponen | Retail "Grup" sudah tidak dobel di komisi | Klinik: baris invoice tidak punya tanda asal paket; tidak ada saldo paket; kasus 3 bundle + 1 normal tidak terpisah | Keputusan model paket → kode | Besar |

## Keputusan yang dibutuhkan dari pemilik/finance

1. Stok final 31 Okt: posting stok awal sekali di 31 Okt (disarankan), atau posting lebih awal lalu koreksi via opname.
2. Akun penyeimbang saldo awal utang/piutang per faktur, dan format export Accurate yang dipakai.
3. Racikan jadi di rawat inap: tombol "Ambil stok obat jadi" dihapus juga (disarankan, konsisten dengan rawat jalan)?
4. Siapa selain OWNER boleh koreksi pembelian, dan siapa boleh mengajukan permintaan koreksi.
5. Refund klinik: biaya admin, insentif yang sudah dibayar, bahan racikan terpakai, dan poin — dikembalikan atau tidak.
6. Dokter satu cabang boleh lihat riwayat medis pasien dari cabang lain (baca saja)?
7. Selisih opname toko: beban (seperti klinik) atau tetap piutang ke toko pusat; kebijakan nilai stok minus.
8. Koreksi pembelian yang barangnya sudah terjual: selisih masuk HPP, akun selisih, atau hitung ulang.
9. Insentif visit ranap & paket klinik: tarif, dasar hitung, model paket.
