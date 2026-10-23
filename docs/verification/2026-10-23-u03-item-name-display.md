# U03 — nama barang dan kode referensi terpisah

Code-complete untuk surface yang disebut di bawah, dengan slice U04/U05 terkait. U03/U04/U05 global belum dinyatakan selesai. Dasar main `9a43263` (PR100) digabung normal; pembatas `selectable` C01 tetap dipertahankan. Tidak ada migration baru, target write, atau implementasi ulang rilis PR100/101.

## Cakupan nyata

| Surface | Hasil |
| --- | --- |
| Shared SearchableItemPicker | Input terpilih berisi nama; kode pada bagian referensi tersendiri. Pencarian nama/kode, ID, keyboard dan pilihan lama tetap bekerja. Hasil dapat ditambah melewati50; popup tidak terpotong tabel scroll dan mengikuti posisi input. Berlaku pada filter Kartu Stok, permintaan kasir dan faktur pembelian langsung existing. Tidak mengubah kalkulasi atau action server ketiga consumer ini. |
| CRM/shared SearchableMultiSelect | Nama menjadi teks utama hasil/chip, kode terpisah. Hidden IDs, kategori, pembatas target C01, pilih/lepas hasil dan accessible label existing tetap dipertahankan. |
| Permintaan klinik | Picker nama/kode mengganti native label gabungan; exact item ID, satuan dan draf dipertahankan. Layout sempit membungkus kontrol tanpa overflow halaman. |
| Billing klinik | Pilih SKU eksplisit berdasarkan ID, walau nama sama; nama tidak diawali kode. Ketikan nama ambigu tidak lagi diam-diam memasangkan SKU terakhir. Ketikan nama unik atau label legacy persis tetap dikenali. Deskripsi bebas, qty, harga, unit dan provenance resep/racikan mengikuti alur existing; racikan tersimpan tetap read-only. |
| Katalog racikan resmi | Tautan SKU dan bahan memakai searchable picker; SKU lama tidak tersedia tetap dipertahankan sampai diganti eksplisit. Kode resep ditampilkan terpisah dari nama. Catalog bahan kini checked pagination lengkap dengan filter aktif/Persediaan/bahan yang sama, mengganti limit1000. Identitas formula/versi, unit, qty dan action penerbitan tidak diubah. |

Tidak memotong kode dari string master/deskripsi secara heuristik, tidak mengganti nama master atau deskripsi transaksi/resep historis. Nama yang memang berisi angka/kode tetap utuh. Invoice/struk/resep existing tetap memakai deskripsi tersimpan.

## Validasi dijalankan

- RED: dua tes shared picker, empat tes klinik (termasuk salah asosiasi nama sama), satu tes kelengkapan katalog dan satu tes markup multiselect membuktikan gap sebelum fix. [Bukti picker](../evidence/2026-10-23-u03/picker-red.log), [klinik](../evidence/2026-10-23-u03/clinic-red.log), [katalog](../evidence/2026-10-23-u03/catalog-red.log), [multiselect](../evidence/2026-10-23-u03/multiselect-red.log).
- 37 tes fokus / 9 file dan 4 regresi draf permintaan kasir lulus. Full suite akhir 2.664 tes / 349 file lulus. Empat kegagalan awal berasal dari fixture kasir mencari popup di tbody; query disesuaikan ke listbox portal, seluruh assertion ID/unit/draf tetap dipertahankan. [Fokus](../evidence/2026-10-23-u03/focused.log), [kasir](../evidence/2026-10-23-u03/cashier-regression.log), [suite](../evidence/2026-10-23-u03/full-tests.log).
- Build, typecheck sesudah build dan lint scoped lulus. Warning img pada PembayaranForm dan warning dependency/build existing tetap dicatat. [Build](../evidence/2026-10-23-u03/build.log), [typecheck](../evidence/2026-10-23-u03/typecheck.log), [lint](../evidence/2026-10-23-u03/lint.log).
- Chromium1280/390 memakai komponen nyata dan fixture fiktif: popup tabel terlihat, nama/kode terpisah, pemilihan nama sama lewat ID, ketikan ambigu, pencarian item ke1205, lebih50 hasil, draf permintaan pulih dengan ID/unit, tanpa overflow halaman/runtime error/request eksternal/live write. [Hasil](../evidence/2026-10-23-u03/browser.json), [mobile popup](../evidence/2026-10-23-u03/names-390-popup.png), [desktop](../evidence/2026-10-23-u03/names-1280.png).
- Review independen tanpa P1/P2, termasuk integrasi C01 dan layout responsif. [Review](../evidence/2026-10-23-u03/review.txt), [hash source](../evidence/2026-10-23-u03/source-sha256.json).

## Sisa dan rilis

Native/datalist lain seperti BarisJualForm, OnlineForm dan ResepForm produksi masih memakai label gabungan; belum diubah atau diklaim selesai di sini. Belum semua loader/selector global diperiksa. C03: repo berisi template impor barang, bukan template bulk promo; pencarian metadata Drive `promo`, `template`, `KAMO` dan folder KAMO yang tersedia tidak menemukan contoh Excel promo. Pertanyaan tunggal sudah diajukan: tautan file Excel promo bulanan yang menjadi acuan kolom satuan dan diskon per SKU. Tidak menebak format impor. K06 tidak diubah; K07 tetap parsial.

Lane rilis mengelola ready/merge/deploy; UAT lengkap tetap ditunda. Rollback melalui revert commit source U03, tanpa rollback database atau penulisan ulang transaksi. Sheet dikelola parent.
