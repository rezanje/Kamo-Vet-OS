# Penyelesaian Fitur Klinik DEMO

Pengguna meminta perbaikan teruji dirilis, status Google Sheet diperbarui, kemudian pekerjaan berikutnya dilanjutkan. Aplikasi masih demo/percobaan; data, tarif dan template contoh diizinkan tanpa menunggu perusahaan. Eksekusi inline, pengujian sebelum rilis, dan update status berdasarkan bukti tetap berlaku.

## Rilis awal yang selesai

PR #46 merge ke main pada commit 01900682; deployment Production 7007030596 sukses. Enam baris Report telah diperbarui dan dibaca ulang, termasuk REQ-2 dan MEET-06 menjadi siap digunakan untuk DEMO. Status data historis dan fitur belum tersedia tidak ditutup.

## Consent khusus rawat inap

- Gunakan template dan tanda tangan existing; tambah kategori template dan snapshot kategori dokumen. Default template lama tetap Umum.
- Contoh baru berlabel DEMO Rawat Inap, berlaku seluruh cabang; signatory pemilik contoh, persetujuan sebelum masuk rawat inap.
- Admission baru membutuhkan consent Rawat Inap yang sudah ditandatangani pada kunjungan/cabang yang sama dan sesuai template default jika dikonfigurasi. Consent tindakan lain tidak cukup.
- Admission, penetapan PJ dan status log disimpan atomik melalui satu RPC. Pertahankan admission/riwayat lama tanpa menebak jenis consent.
- Isi dan identitas consent yang sudah ditandatangani tidak dapat diubah/dihapus; perubahan template berikutnya tidak mengubah snapshot. Validasi template aktif/cabang ada pada server/database.
- Pembayaran memverifikasi consent admission yang ditautkan; guard tidak mengubah invoice lunas historis.

## Aturan keuangan DEMO

- Pengaturan baru OWNER/ADMIN, bertanda DEMO dan berversi. Versi transaksi tidak berubah ketika pengaturan diperbarui.
- Contoh insentif: 5% dari nilai jasa setelah diskon, sebelum pajak, tanpa biaya admin. Satu total per invoice dibagi rata kepada petugas eligible yang dipilih saat checkout. Sisa rupiah dibagikan deterministik berdasarkan employee ID; jumlah bagian persis total.
- Pilihan petugas berasal dari dokter/provider kunjungan dan petugas log rawat inap, diverifikasi terhadap status, jabatan, cabang dan tanggal penugasan. Tidak ada nama bebas.
- Pengaturan fee contoh: Tunai 0%, Transfer 1%, QRIS 0%; metode manual lain 0% sampai dikonfigurasi. Per bagian pembayaran, pembulatan ke rupiah terdekat. Tidak dihitung berulang atas tambahan fee sendiri.
- Biaya ditanggung pelanggan: tambahan setelah pajak tagihan, dicatat sebagai baris admin dan pendapatan admin terpisah. Biaya ditanggung perusahaan: tagihan tetap, fee menjadi beban administrasi dan mengurangi penerimaan metode terkait; tidak menjadi pendapatan.
- Penggunaan aturan DEMO opt-in pada checkout baru, otomatis dipilih untuk pemilik berlabel DEMO. Jalur DP/koreksi existing tetap tersedia tanpa aturan baru; tahap DEMO otomatis mencakup checkout lunas awal satu metode atau campuran. UI menjelaskan batas pembayaran tersebut.
- Satu RPC menghitung ulang fee server, menyimpan invoice/receipts/jurnal/aturan/insentif atomik dengan sumber dan request key existing. Payload sama replay tanpa efek; payload berbeda dengan key sama ditolak.
- Insentif disimpan sebagai snapshot setelah lunas. Laporan komisi dan payroll memakai bagian yang sama, mengecualikan invoice tersebut dari komisi klinik lama agar tidak dihitung dua kali. Void mengecualikan hak; reissue membawa snapshot dan tidak menggandakan hak/penerimaan.
- Struk/invoice menampilkan pokok, biaya per metode, penanggung biaya dan pembayaran aktual. Fee tidak masuk basis insentif atau HPP.
- Aturan/akun di atas contoh demo; kebijakan operasional final masih perlu keputusan perusahaan.

## Batas dan verifikasi

- Tidak mereset riwayat lama, menebak HPP Snowy atau mengirim pesan kepada pihak lain. Pengujian live memakai identitas DEMO dan kanal pesan harus dipastikan nonaktif sebelum checkout.
- Uji consent salah kategori/template/cabang, snapshot dan dua tanda tangan bersamaan, admission retry/rollback.
- Uji insentif satu/tiga petugas, duplikat, ineligible, pembulatan, snapshot versi, void/reissue dan integrasi payroll.
- Uji fee single/split, nol, diskon/pajak, kedua penanggung biaya, under/over, rekening salah, rollback dan retry.
- SQL PostgreSQL nyata, unit/action/browser, full suite, TypeScript/lint/build dan satu review independen sebelum setiap rilis. Migrasi/seed konfigurasi sebelum deployment frontend; baca hasil deployment dan smoke test.

Dokumentasi Next.js yang dirujuk AGENTS.md (`node_modules/next/dist/docs/`) tidak tersedia pada Next.js 15.5.25 terpasang. Ikuti pola App Router/server action repo dan verifikasi build/typecheck.
