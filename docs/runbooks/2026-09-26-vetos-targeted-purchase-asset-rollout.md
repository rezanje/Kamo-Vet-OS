# VetOS: pemeriksaan dan rilis terarah PR #7/#8

Status pasca tindakan terarah 26 September 2026 (dilaporkan dari SQL Editor dan query ulang produksi oleh task lokal): kolom `purchase_invoice_items.po_item_id` tersedia; empat fungsi `create_purchase_invoice_from_po`, `stock_in_fifo`, `stock_out_fifo`, `create_fixed_asset_purchase` tersedia; versi `20260924120000`, `20260924122000`, `20260924123000` tercatat. Keempat fungsi `SECURITY INVOKER`, role `anon` tidak mempunyai `EXECUTE`, `authenticated` mempunyai `EXECUTE`. Migrasi `20260924121000_atomic_purchase_layer_reprice` **sengaja tidak dipasang** karena tidak dipanggil aplikasi dan memperlebar akses perubahan stok. Ini bukti skema, **bukan** bukti transaksi PO/aset sukses dan pembukuannya benar. Jangan tandai #7/#8 selesai sebelum uji bisnis end-to-end.

Sebelum tindakan tersebut, audit baca saja menemukan 14 tabel prasyarat dan ketiadaan kolom/kelima fungsi, sementara riwayat migrasi September tidak lengkap karena beberapa fungsi lain telah dibuat manual. Karena itu jalur mass `supabase db push` tetap tidak aman.

Backup harian terakhir yang terlihat: 25 September 2026 pukul 15:13:46 UTC. Point-in-Time Recovery belum aktif. Jangan menjalankan `supabase db push` atau menganggap riwayat migrasi sebagai gambaran lengkap skema. Di `main` ada 15 migrasi September, sebagian sudah ada di produksi tanpa entri riwayat, dan sebagian memuat reset simulasi.

## Catatan keputusan dan verifikasi lanjutan

1. Jalankan [query postflight baca saja](../../supabase/checks/vetos_20260926_purchase_asset_preflight.sql) untuk memeriksa empat signature yang dipakai aplikasi, kolom/constraint, dan memastikan fungsi kelima yang dikecualikan tidak tiba-tiba muncul. Catat hasilnya tanpa mengubah status migrasi September yang lain.
2. Pada staging terisolasi, uji dua sesi PostgreSQL untuk PO yang sama dan pemotongan stok bersamaan. Uji penolakan overbilling, biaya lapisan parsial, rollback saat jurnal gagal, serta jurnal aset seimbang. PGlite satu sesi tidak membuktikan race. Pengujian `reprice_purchase_invoice_layers` **di luar cakupan rilis ini**.
3. Untuk bukti live, gunakan transaksi demo yang disetujui: PO dalam dua satuan → faktur parsial → penerimaan, lalu pembelian aset → buku besar. Cocokkan angka stok dasar, lapisan, saldo, dan jurnal. Catat nomor dokumen/hasil tanpa mengekspos data pribadi. Jangan menganggap keberadaan RPC sebagai bukti transaksi berhasil.

## Perubahan lebih lanjut

Jangan menjalankan empat file lagi. Untuk perubahan selanjutnya, audit drift terhadap skema aktual, backup baru yang dapat dipulihkan ke staging, hasil uji dua sesi, dan izin migrasi terarah. `CREATE OR REPLACE` pada fungsi yang sudah terpasang dapat menimpa perubahan manual. Jangan memalsukan riwayat file September lain. Backup harian terakhir yang diketahui sebelum tindakan adalah 25 September 2026 15:13:46 UTC dan PITR belum aktif; status backup saat pemasangan tidak disimpulkan oleh runbook ini.

## Pemulihan

Jika uji transaksi menemukan masalah, hentikan jalur PO/aset dan audit transaksi yang telanjur dibuat sebelum mempertimbangkan rollback kode/fungsi. Jangan hapus kolom `po_item_id` yang mungkin sudah terisi, jangan pulihkan seluruh backup secara buta, dan jangan menghapus fungsi tanpa memastikan transaksi yang memakainya. PITR belum aktif menurut audit awal, sehingga backup penuh tidak menyediakan pemulihan ke detik sebelum kesalahan.
