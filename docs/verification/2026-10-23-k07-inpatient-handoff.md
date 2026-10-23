# K07 — handoff konsultasi/resep ke rawat inap (cakupan parsial)

Sumber: checklist 70 butir, tab Checklist baris 68/K07, dibaca 23 Oktober 2026. [Sheet canonical](https://docs.google.com/spreadsheets/d/1opWVBMSQ3RHdtwrDefsSBM4Quc9H5zJg1RUNkr0zTFQ/edit#gid=831947777). Parent mengelola status Sheet; batch ini tidak mengedit Sheet. Prioritas P0. Permintaan: dokter rawat inap dapat melihat konsultasi, obat/racikan/tindakan dan status yang relevan sebelum catatan visit, tanpa mengandalkan informasi verbal atau menginput ulang.

## Yang terbukti dan diperbaiki

Main sebelum batch menampilkan identitas pasien, rencana/kondisi, papan harian, Obat Khusus dan jejak dosis, tetapi tidak membaca/merangkum konsultasi serta resep kunjungan pada detail rawat inap. K07 bukan dianggap selesai hanya karena panel obat/protokol sudah ada.

Pada detail `/klinik/rawat-inap/[id]`, panel baru sebelum papan/catatan harian menampilkan:

- Dokter kunjungan, anamnesis, diagnosis dan catatan resep yang tersimpan saat ini pada kunjungan yang sama. Setiap record memiliki waktu pencatatan; label sebelum/pada-setelah admission hanya perbandingan timestamp faktual, bukan bukti bahwa isi record belum pernah dikoreksi.
- Obat/tindakan, qty/satuan, aturan pakai dan waktu pencatatan. Semua medical records kunjungan dibaca, tidak mengambil satu record terakhir lalu menghilangkan record lama.
- Racikan, hasil/volume, bentuk, aturan pakai dan status farmasi pending/ready/handed_over/void. Nomor/tautan sumber membuka kunjungan rekam medis dan racikan yang benar. Tidak mengurangi stok atau membuat tagihan baru.
- Status/qty dari faktur melalui FK `invoice_items.prescription_item_id` atau `compound_recipe_id` saja. Faktur Lunas aktif dan faktur lama Dibatalkan tetap dibedakan. Tidak mencocokkan nama/SKU atau menganggap item baru tercakup oleh faktur lama. Qty yang ditampilkan adalah qty faktur sumber, bukan klaim seluruh qty resep sudah dibayar.
- Daftar faktur kunjungan tetap informatif jika baris legacy belum punya FK; “Belum ada tautan tagihan per baris” tidak disamakan dengan “belum ditagih”. Faktur lama ditampilkan sebagai label, dengan tautan terpisah “Buka pembayaran kunjungan”. Route pembayaran existing tidak memilih invoice lewat queryparam, sehingga tidak dibuat tautan palsu `?invoice=id`.

Guard halaman memakai sesi aktif dan akses cabang existing sebelum membaca data klinis tambahan. Reader memakai client pengguna/RLS yang sama, memverifikasi visit+branch, kemudian membatasi child read ke ID MR/invoice yang sudah terbaca. Seluruh daftar memakai checked pagination/order ID stabil dan batch IN maksimal 200. Kegagalan baca/daftar terpotong menampilkan ringkasan belum dapat dimuat lengkap, bukan riwayat kosong atau status palsu. Tidak ada service key, log payload rekam medis, schema, migration, policy, permission atau mutasi data.

## Batas bisnis/data — K07 belum selesai penuh

1. Status **diresepkan**, **diserahkan farmasi**, **lunas**, dan **diberikan ke pasien** tetap terpisah. Handed-over racikan tidak diklaim sebagai dosis yang sudah diberikan. Jejak pemberian berprotokol existing ditautkan ke Obat Khusus. Belum ada relasi tersimpan yang dapat membuktikan penyerahan/pemberian tiap resep obat biasa; panel menyebut batas ini, tidak merekonstruksinya.
2. Lama inap terbayar/sisa durasi belum dapat dihitung secara andal dari model yang tersedia. Tanggal masuk, qty jasa bertuliskan rawat inap, atau status Lunas sebuah invoice tidak dipakai untuk menebak coverage malam/hari. Dibutuhkan definisi hari/cutoff dan mapping tagihan→periode yang disepakati sebelum perhitungan baru.
3. Record konsultasi yang tampil merupakan nilai tersimpan saat ini, bukan snapshot admission yang immutable. Tidak menambahkan histori lama seolah sudah dicatat. Tambahan selama ranap ikut tampil dan dibedakan lewat timestamp faktual; tidak mengarang hubungan resep→catatan harian tanpa FK.
4. Tidak mengubah K06 eligibility paid/closed→admission, timing stock deduction K02/K03, prosedur koreksi K01 atau payroll/insentif H06/S01. Itu memerlukan batas bisnis yang belum disepakati; tidak dibuka lewat panel read-only ini.
5. Route faktur lama klinik yang berdiri sendiri belum ada; label faktur lama tidak diubah menjadi link ke faktur aktif. Integrasi rute finansial tetap lane rilis/finance.

## Bukti verifikasi

Lihat [checks](../evidence/2026-10-23-k07/checks.json), [tes fokus](../evidence/2026-10-23-k07/focused.log), [browser](../evidence/2026-10-23-k07/browser.json), [suite proyek](../evidence/2026-10-23-k07/full-tests.log), [build](../evidence/2026-10-23-k07/build.log), [types](../evidence/2026-10-23-k07/typecheck.log), [lint](../evidence/2026-10-23-k07/lint.log).

- RED empat tes halaman: panel belum ada, status belum terlihat, akses tambahan belum dipagari, kegagalan baca belum dijelaskan. RED tambahan memeriksa route palsu `?invoice=`; implementasi diperbaiki menjadi label dan tautan kunjungan yang jujur. Log RED berisi assertion asli dengan markup SSR panjang dipangkas dari arsip.
- GREEN fokus 36 tes/4 file: enam tes baru + checked-list/inpatient/obat-inap existing. Mencakup anonim/cross-branch rejection sebelum child read, sumber FK dan scope visit/MR, >1000 resep, invoice lama/aktif/tambahan tidak tertaut, error baca aman, urutan panel dan tautan. Review independen Sol6.1 high tidak menemukan P1/P2, dan menjalankan 6 tes halaman secara independen.
- Browser Chromium lokal komponen panel asli pada 1280/390: sumber rekam medis/racikan, keyboard details, status pembayaran/farmasi terpisah, gap durasi, tidak ada route invoice palsu/overflow dokumen/runtime error/request eksternal/live write. [Desktop](../evidence/2026-10-23-k07/handoff-1280.png), [mobile](../evidence/2026-10-23-k07/handoff-390.png).
- Sebelum pemeriksaan akhir, branch di-fast-forward normal ke main `57e5e6a4747835d4c6e8beca34681e8a69b87f3b` (PR94/95/96 yang diintegrasikan lane rilis). Tidak mengulang migration rilis; tidak menulis target. Tidak menjalankan simulasi workflow lengkap/UAT target.

## Rilis dan rollback

Satu candidate aplikasi read-only; lane rilis/parent mengelola merge/deploy. Tidak ada migration dan tidak ada target read/write dalam batch. Rollback cukup revert commit aplikasi K07; tidak ada data yang perlu dihapus/ditulis ulang. Code/push/PR dibedakan dari merged/deployed/UAT.

Batch berikut yang masuk akal: cek K05/U07 terhadap guard admission dan feedback submit existing; kemudian C01 edit promo dengan histori dan validasi existing. Jangan menganggap unchecked berarti belum ada kode. K02/K03/K06 dan aturan insentif/durasi yang belum terdefinisi dicatat sebagai keputusan bisnis, bukan diimplementasikan dari dugaan.
