# U03 / U05 — selector Permintaan Barang dan Pemindahan POS

Slice independen dari PR105; dependency hanya integrasi PR103 `a58c5e1`. Tidak ada migration, loader/access/financial/stock action yang diubah. Main merge PR103 ditolak oleh approval review menurut laporan parent; batch ini tidak mencoba merge ulang, direct main atau target migration. Ready PR baru hanya menyediakan perubahan kode independen untuk koordinasi release lane, bukan jalan alternatif menjalankan merge yang ditolak.

Dua kontrol yang terbukti masih menggabungkan kode dan nama kini memakai SearchableItemPicker existing: Permintaan Barang POS dan Pemindahan. Nama tampil utama, kode terpisah; pilihan memakai exact ID walau nama sama. Search lebih dari 50 hasil memakai show-more existing. Katalog Persediaan dan batas cabang/role mengikuti loader existing.

Qty, satuan, faktor ekuivalensi, catatan, warehouse stock hint dan transfer request key tetap dipertahankan. Draf legacy label gabungan ditampilkan dengan nama tanpa menulis ulang payload pada restore. Hint stok dan opsi unit didasarkan pada item ID, bukan teks display. Layout membungkus kontrol pada lebar sempit memakai pola yang sama dengan kandidat online.

Bukti: RED tiga tes sebelum perubahan; **29 tes / 5 file lulus**, termasuk form transaksi, unit, warehouse stock, draf legacy dan picker. Lint scoped, build dan typecheck sesudah build lulus, tanpa gate yang dilonggarkan. Review independen tanpa P1/P2, **23 tes / 5 file** dijalankan reviewer. [RED](../evidence/2026-10-23-pos-item-selectors/red.log), [tes](../evidence/2026-10-23-pos-item-selectors/focus.log), [build](../evidence/2026-10-23-pos-item-selectors/build.log), [typecheck](../evidence/2026-10-23-pos-item-selectors/typecheck.log), [lint](../evidence/2026-10-23-pos-item-selectors/lint.log), [review](../evidence/2026-10-23-pos-item-selectors/review.txt), [hash](../evidence/2026-10-23-pos-item-selectors/source-sha256.json).

Tidak menjalankan ulang broad suite, browser/live UAT atau simulasi workflow. Assertion unit/warehouse existing tidak dihapus; hanya query fixture transfer diganti dari datalist ke combobox yang baru. Tidak mengklaim uji mobile aktual untuk batch ini.

U03/U05 global tetap parsial. Remaining literal code/name di formulir substitusi/group SKU, anggota keluarga varian, pengecualian diskon golongan CRM dan display output resep produksi belum diubah di batch ini; kode akun/cabang dan aria-label pembeda bukan nama SKU visual yang harus dihapus. U04 loaders global juga belum diklaim selesai. PR103/105 dipertahankan terpisah; tidak ada klaim semua74 selesai.

Release lane menangani main/deploy setelah blocker merge teratasi. Tidak ada target migration untuk batch ini. Rollback melalui revert source commit saja. Parent mengelola Sheet; UAT tetap deferred sesuai instruksi user.
