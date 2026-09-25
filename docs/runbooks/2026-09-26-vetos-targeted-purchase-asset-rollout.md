# VetOS: pemeriksaan dan rilis terarah PR #7/#8

Status per 26 September 2026: kode #7 (satuan faktur dari PO) dan #8 (pembelian aset tetap) ada di `main` dan aplikasi Vercel sudah dibangun, tetapi database produksi `koaglxcyjqfmgfzxszkj` belum memiliki `purchase_invoice_items.po_item_id` maupun lima fungsi baru yang dipakai kode tersebut. Pemeriksaan baca saja menemukan 14 tabel prasyarat. Riwayat migrasi terakhir yang terlihat adalah `20260901021000_harden_new_rpc_access`, walau beberapa fungsi September lain sudah ada. **Keduanya belum siap dipakai live.**

Backup harian terakhir yang terlihat: 25 September 2026 pukul 15:13:46 UTC. Point-in-Time Recovery belum aktif. Jangan menjalankan `supabase db push` atau menganggap riwayat migrasi sebagai gambaran lengkap skema. Di `main` ada 15 migrasi September, sebagian sudah ada di produksi tanpa entri riwayat, dan sebagian memuat reset simulasi.

## Sebelum perubahan produksi

1. Jalankan [query preflight](../../supabase/checks/vetos_20260926_purchase_asset_preflight.sql) secara baca saja di project yang benar. Simpan hasil tabel, kolom hilang, lima signature fungsi, dan definisi constraint. Hasil kolom hilang yang diharapkan untuk empat file ini hanya `po_item_id`; hentikan bila ada kolom prasyarat lain yang hilang atau object target sudah ada dengan definisi berbeda.
2. Ambil backup baru segera sebelum DDL dan uji bahwa backup dapat dibaca serta dipulihkan ke database **terisolasi**. Catat waktu, ukuran, metode, operator, dan bukti uji restore. Backup harian 25 September terlalu lama untuk mengembalikan transaksi yang lebih baru. Jangan berasumsi redeploy kode mengembalikan skema atau data.
3. Pada salinan database terisolasi, jalankan **hanya** empat file berurutan: `20260924120000_purchase_invoice_po_units.sql`, `20260924121000_atomic_purchase_layer_reprice.sql`, `20260924122000_atomic_po_invoice_and_stock_out.sql`, `20260924123000_atomic_fixed_asset_purchase.sql`. File pertama menambah kolom nullable, indeks parsial, dan komentar; tiga file berikutnya membuat lima fungsi. Keempat file tidak berisi backfill atau reset data.
4. Di salinan tersebut, jalankan tes SQL terkait PO, reprice/FIFO, dan aset; uji dua sesi PostgreSQL yang benar untuk PO sama dan transaksi stok bersamaan. Uji penolakan overbilling, biaya lapisan parsial, rollback saat jurnal gagal, dan jurnal aset seimbang. PGlite satu sesi tidak membuktikan race.
5. Bandingkan hasil postflight dan rencana rollback dengan keadaan produksi sebelum meminta izin migrasi **terarah**. Jangan menambah entri riwayat migrasi palsu untuk file September lain; rekonsiliasi ledger perlu audit terpisah.

## Pelaksanaan setelah persetujuan terarah

Jalankan keempat file dalam urutan di atas pada jendela perubahan yang disepakati, dengan backup baru dan hasil staging yang lulus. Validasi ulang preflight tepat sebelum eksekusi. Jika ada objek muncul di antaranya, hentikan dan audit definisinya; `CREATE OR REPLACE` dapat menimpa perubahan manual. Catat hasil tiap file dan riwayat yang benar-benar ditulis oleh alat yang dipakai. Postflight: kolom dan lima signature tersedia, role `authenticated` bisa menjalankan fungsi yang diperlukan, dan uji transaksi demo yang disetujui menghasilkan baris PO/satuan, lapisan stok, aset, serta jurnal yang seimbang. Baru setelah itu perbarui status Sheet #7/#8 berdasarkan bukti live.

## Pemulihan

Jika DDL gagal sebelum transaksi demo, hentikan rilis dan gunakan rollback transaksi DDL bila alat menjalankannya dalam satu transaksi. Jika sudah terpasang, tarik kode aplikasi ke versi yang kompatibel untuk menghentikan pemanggilan fungsi baru; verifikasi tidak ada transaksi yang memakai fungsi baru sebelum menghapus **hanya** lima fungsi target. Kolom `po_item_id` boleh dibiarkan nullable agar data/faktur yang mungkin sudah mengisinya tidak hilang. Jika transaksi telah memakai fungsi baru, jangan menghapus kolom/fungsi atau memulihkan seluruh backup secara buta; lakukan perbaikan maju atau pemulihan terisolasi berdasarkan jurnal dan transaksi yang tercatat. PITR belum aktif, sehingga backup penuh tidak menyediakan pemulihan ke detik sebelum kesalahan.
