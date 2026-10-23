# C02 + category-only CRM U05 — kategori informasi promo dan selector

Feedback C02: “Kategori barang membantu tampilan/daftar promo lebih rapi dan mudah dicari.” Acceptance: pengguna dapat menemukan dan mengenali promo berdasarkan kategori tanpa membaca seluruh daftar.

## Scope dan perilaku

- `/crm/promo` menampilkan kolom kategori dan filter daftar berdasarkan pemetaan `promo_items → items.category_id → item_categories` yang sudah tersimpan. Kategori mengikuti master saat ini; bukan snapshot kategori transaksi lama dan bukan aturan promo baru.
- Dropdown bertingkat memakai jalur kategori existing `labelPath`, menandai kategori/ancestor nonaktif, kategori kosong, kategori tidak tersedia, dan hierarki legacy yang tidak lengkap. Filter induk mencakup keturunan; filter tidak dikenal menampilkan error dan nol hasil, tidak diam-diam menjadi semua kategori.
- Promo yang tidak punya target barang tersimpan tetap **Semua barang / Semua kategori** dan muncul pada setiap filter kategori valid. Promo dengan target eksplisit yang tidak tersedia tetap ditandai tidak tersedia; tidak pernah ditafsirkan sebagai promo semua barang.
- Selector PR87 `SearchableMultiSelect` menerima kategori opsional hanya untuk barang promo. Kategori + pencarian kode/nama bekerja bersama. Pemilihan seluruh hasil dan pelepasan seluruh hasil mencakup semua hasil cocok yang aktif, termasuk di luar 50 baris pertama; ID yang sudah dipilih di luar filter tetap disimpan. Filter mengatur tampilan saja; kontrak hidden IDs dan validasi pilihan yang hilang tidak berubah.
- Active-only selector tetap membaca barang/Jasa aktif. Metadata barang nonaktif lama dibaca hanya untuk ID target promo tersimpan yang belum ada di selector, dalam batch200 melalui sesi/RLS yang sama. Metadata itu tidak dimasukkan kembali ke opsi pemilihan. Kategori yang nonaktif tetap diberi label; status kategori tidak dijadikan kebijakan eligibility baru.
- Pembacaan kategori, promo dan relasi target memakai `readCompleteList` dengan count, urutan ID stabil dan verifikasi halaman. Kunci gabungan `promo_id:item_id` menjadi identitas relasi yang diperiksa; hasil terpotong/gagal tidak pernah dianggap daftar lengkap. Kegagalan metadata atau target menghentikan render dengan pesan pemuatan, sehingga tidak mengklaim kategori/target yang belum terbukti.
- Native select dan combobox memiliki label terpisah, reset highlight ketika filter berubah, Enter tidak mengirim form saat memilih barang, serta batas lebar/wrapping untuk mobile. GET filter daftar terpisah dari form pembuatan; draf barang/cabang tetap memakai pemulihan existing.

Tidak ada perubahan tindakan create/toggle promo, rumus diskon, eligibility, master data, data historis, auth, role, policy, schema, RPC atau migration. Batch ini tidak mengubah PR94 atau mencoba ready/merge yang sedang menunggu penyelesaian approval. Cakupan U05 hanya kategori pada selector barang promo CRM; bukan penyelesaian seluruh selector global/CRM.

## Tes dan bukti

Bukti ada di [checks](../evidence/2026-10-23-c02/checks.json), [fokus](../evidence/2026-10-23-c02/focused.log), [browser](../evidence/2026-10-23-c02/browser.json), [suite proyek](../evidence/2026-10-23-c02/full-tests.log), [build](../evidence/2026-10-23-c02/build.log), [types](../evidence/2026-10-23-c02/typecheck.log), [lint](../evidence/2026-10-23-c02/lint.log).

- Baseline fokus sebelum perubahan: 17 tes/4 file lulus. RED selector kategori: dua assertion gagal karena kontrol kategori belum ada. RED halaman: lima assertion gagal karena informasi/filter kategori dan load-failure handling belum ada; [selector RED](../evidence/2026-10-23-c02/category-red.log), [halaman RED](../evidence/2026-10-23-c02/page-red.log).
- GREEN fokus: 24 tes/6 file, termasuk pemilihan >1000, kategori >1000, parent/child, kosong/nonaktif/unavailable, target lama, filter invalid, count/error handling, retained IDs, keyboard, draf per akun dan aturan promo existing.
- Browser Chromium mengeksekusi halaman dan komponen asli dengan katalog/action fiktif pada loopback. Lebar1280 dan390; pilih/lepas seluruh1204 hasil kategori, pilihan di luar filter, kode setelah1000, keyboard, failed-save, GET navigation+draft restoration, kategori parent/listing global, tidak ada overflow dokumen/runtime error/request eksternal/live write. Ini pemeriksaan UI fixture terfokus, bukan simulasi transaksi atau UAT target.
- Percobaan browser awal tertahan oleh field wajib `suggest` yang belum diisi harness; harness diperbaiki untuk mengisi form valid, tanpa perubahan validasi produk. Run final lulus.
- Build awal menemukan TS7022 pada inferensi tipe variabel traversal kategori; ditangani dengan anotasi `KategoriRow` eksplisit. Typecheck dan24 tes fokus setelah anotasi lulus; run build akhir dicatat terpisah dari [error awal](../evidence/2026-10-23-c02/build-initial-type-error.log). Perubahan ini hanya anotasi tipe; suite proyek dijalankan kembali pada source akhir.
- Review independen Sol6.1 high: tidak ada P1/P2; reviewer read-only dan menjalankan10 tes fokus secara independen. Hasil akhir suite/build/type/lint dicatat berdasarkan run aktual.

Screenshot: [desktop](../evidence/2026-10-23-c02/promo-categories-1280.png), [mobile](../evidence/2026-10-23-c02/promo-categories-390.png). Sudah diperiksa visual; tabel lebar memakai area scroll internal existing pada mobile.

## Rilis dan rollback

Candidate draft PR dari current main, normal push, tanpa migration. Parent mengoordinasikan ready/merge/deploy sesudah approval yang sedang pending; batch ini berhenti pada draft PR. Rollback aplikasi cukup revert commit batch ini; tidak ada rollback database atau perubahan data.

Status code-complete/pushed dibedakan dari merged/deployed/UAT. Tidak mengklaim semua selector U05 selesai; tidak membuat kategori promo baru atau menyimpan kategori pada dokumen historis.
