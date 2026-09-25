# VetOS: cakupan BUG-04/05/06 dan laporan HPP

Audit kode `main` pada 26 September 2026. Ini inventaris pekerjaan, bukan bukti fitur siap produksi. BUG-08 dikerjakan terpisah dan definisi jumlah pengulangannya menunggu keputusan pemilik. REQ-4 (akses HPP dokter) juga menunggu keputusan pemilik; jangan mengubah haknya secara tersirat lewat laporan baru.

## BUG-04 — satuan di dokumen

| Alur | Keadaan kode | Verifikasi berikutnya |
| --- | --- | --- |
| PO pembelian | `pembelian/baru/POForm.tsx` memilih satuan SKU dan menyimpan faktor. | PR #7 memerlukan kolom `purchase_invoice_items.po_item_id` serta RPC yang belum terpasang di produksi. Uji PO → faktur → penerimaan dengan dua satuan SKU sama setelah migrasi terarah. |
| Faktur langsung | `pembelian/faktur/langsung/FakturLangsungForm.tsx` memilih satuan dan harga beli. | Uji konversi stok, lapisan, dan jurnal pada cabang demo. |
| Faktur dari PO dan penerimaan | Satuan mengikuti baris PO, bukan pilihan bebas baru; sisa/tagihan dihitung dalam satuan PO. | Uji baris PO sama dengan satuan berbeda dan faktur parsial. |
| Penawaran/pesanan penjualan | `penjualan/BarisJualForm.tsx` dipakai keduanya, memilih satuan, faktor, dan harga dari master. | Uji konversi penawaran → pesanan → pengiriman/faktur dengan SKU dua satuan. |
| Permintaan barang | `pos/permintaan/baru/PermintaanForm.tsx` memilih satuan master; penyimpanan tetap perlu diuji end-to-end. | Uji persetujuan/penerimaan dan stok dasar. |
| POS/shift kasir | `pos/transaksi/PosClient.tsx` dan `kasir/KasirClient.tsx` punya pilihan satuan. | Uji campuran box dan pcs barang sama, termasuk stok dan HPP. |

Kesimpulan: beberapa form sudah menyediakan satuan, jadi jangan membuat ulang UI secara menyeluruh. BUG-04 tetap terbuka sampai alur per dokumen dan dependensi basis data #7 lulus uji. Periksa juga formulir dokumen lain yang disebut pelapor dengan contoh konkret bila cakupan bertambah.

## BUG-05 — transaksi gagal simpan

`src/lib/pos-draft.ts` menyimpan keranjang POS dan kasir pada `sessionStorage` selama 24 jam. State dipulihkan ketika halaman dibuka lagi dan dihapus pada halaman struk. Ini membantu menyelamatkan input di tab yang sama, tetapi bukan status transaksi `pending` di server. Draft tidak berlaku lintas perangkat atau sesudah sesi browser hilang.

Risiko integritas: `pos/transaksi/actions.ts` memasukkan `sales`, lalu `sale_items`, mengeluarkan stok via beberapa pemanggilan, dan membuat jurnal terpisah. Kesalahan sesudah insert pertama bisa meninggalkan baris parsial; retry dari draft dapat menggandakan sale. `kasir/checkout.ts` juga memasukkan sale dahulu, lalu stok/baris/snapshot; pada kegagalan ia mencoba menghapus sale, tetapi mutasi stok sebelumnya tidak otomatis di-rollback. Pembaruan poin dan jurnal menyusul secara terpisah. Label `pending` di UI saja tidak membuat transaksi aman.

Tahap implementasi yang diperlukan: definisikan status bisnis (draft lokal, percobaan posting, atau sale belum selesai); tambahkan kunci idempotensi yang tahan retry dan posting database atomik untuk setiap jalur checkout; hanya hapus draft setelah konfirmasi commit; tampilkan penanganan kegagalan yang bisa diulang aman. Uji kegagalan pada tiap tahap, dua submit bersamaan, dan rekonsiliasi sale–stok–jurnal. Jangan menambahkan status global sebelum skema serta aturan pembatalan ditetapkan.

## BUG-06 — ekspor laporan

Menu `src/lib/nav.ts` punya 19 laporan operasional nyata di `/laporan/*` dan 11 tautan laporan keuangan (`laba-rugi`, `neraca`, `neraca-saldo`, `laba-ditahan`, `buku-besar`, `arus-kas`, rincian arus kas, piutang/pembantu, hutang/pembantu), ditambah tile `Laporan HPP` yang belum memiliki route. Halaman `/laporan/*` belum menyediakan CSV, Excel, PDF, atau tombol cetak. Komponen cetak/PDF browser ada untuk dokumen lain, tetapi bukan ekspor laporan. Beberapa laporan menggunakan pagination/batas baris, sehingga ekspor tabel yang sedang terlihat saja dapat menghilangkan data.

Tahap yang dapat ditinjau: tetapkan kontrak ekspor untuk satu laporan rinci (filter, kolom, grain, jumlah baris, izin akses, zona waktu, total), buat endpoint server dengan pagination lengkap serta CSV yang aman untuk spreadsheet, lalu verifikasi baris dan total terhadap UI. Setelah pola itu lulus, terapkan bertahap pada laporan lain. Excel/PDF memerlukan format, tata letak, dan batas ukuran tersendiri. Jangan menyebut “semua laporan” selesai hanya karena ada tombol umum yang mencetak halaman.

## REQ-1/3 — HPP dan racikan

`stock_layers.qty_left × unit_cost` menyediakan nilai persediaan FIFO saat ini per barang/gudang; `stock.qty` adalah kuantitas operasional. Laporan nilai stok harus menunjukkan selisih kedua sumber, bukan menyamarkannya, dan memutuskan perlakuan stok negatif/lapisan historis. REQ-3 perlu menghubungkan versi formula resmi, resep terbit, komponen dan HPP yang benar-benar dikeluarkan, invoice dan dokter; penjualan dan penerbitan racikan bisa terjadi di waktu berbeda. Keduanya menunggu fondasi posting klinik atomik PR #6 dan katalog resmi PR #9 untuk klaim akuntansi yang benar. Hak lihat modal tetap menunggu REQ-4.
