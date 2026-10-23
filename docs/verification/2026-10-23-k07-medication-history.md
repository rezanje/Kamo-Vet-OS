# K07 — riwayat pemberian obat berprotokol yang lengkap

Slice reliability K07 code-complete; K07 keseluruhan tetap parsial. Sumber existing Obat Khusus mengabaikan error dan memakai batas API default saat membaca protokol/dosis. RED membuktikan error read terlihat sebagai “Belum ada obat berprotokol” dan masih menawarkan form tambah obat. Perbaikan memastikan kegagalan tidak disajikan sebagai riwayat kosong atau progres pasti.

- Helper memakai client/session/RLS existing dan memeriksa akses parent `inpatient_records` lebih dahulu. Parent tidak ditemukan/tidak dapat diakses menghentikan read anak. Tidak memakai definer/service client, query lintas kunjungan atau pencocokan nama.
- Protokol dibatasi exact inpatient ID, dibaca lengkap dengan count dan ordering stabil. Dosis dibaca hanya untuk ID protokol yang berhasil dimuat, daftar IN maksimal 200 ID dan checked pagination per chunk. Fixture 1.003 protokol/1.205 dosis melewati cap 1.000 tanpa kehilangan nama pemberi atau bukti pembatalan.
- Error, count tidak terverifikasi atau respons terpotong menghasilkan peringatan dan menyembunyikan form pada konteks yang belum lengkap. Riwayat kosong terverifikasi tetap memakai alur existing. Perhitungan progres, bukti dosis dibatalkan, role/cabang, aturan/pencatatan pemberian dan harga/stock tidak diganti.

## Validasi yang dijalankan

24 tes fokus / 4 file serta seluruh 2.661 tes aplikasi / 348 file lulus. Cakupan: parent tidak dapat diakses, foreign parent, protokol/dosis melewati 1.000, IN terikat, error chunk berikutnya, count/truncation, empty terverifikasi dan UI tidak memberi konteks kosong palsu. [RED](../evidence/2026-10-23-k07-history/red.log), [fokus](../evidence/2026-10-23-k07-history/focused.log), [suite](../evidence/2026-10-23-k07-history/full-tests.log).

Build, typecheck sesudah build dan scoped lint lulus; warning build existing tetap tercatat. Review independen tanpa P1/P2 dan menjalankan sendiri 24 tes / 4 file. [Build](../evidence/2026-10-23-k07-history/build.log), [typecheck](../evidence/2026-10-23-k07-history/typecheck.log), [lint](../evidence/2026-10-23-k07-history/lint.log), [review](../evidence/2026-10-23-k07-history/review.txt), [hash source](../evidence/2026-10-23-k07-history/source-sha256.json).

Tes memakai fixture/mock, termasuk render komponen server untuk pesan gagal. Tidak menjalankan browser/UAT autentik baru, target read/write, simulation workflow lengkap atau migration. Bukan bukti UAT klinis selesai.

## Sisa dan rilis

Tidak menambahkan bukti penyerahan obat biasa atau mengartikan pembayaran/penyerahan farmasi sebagai pemberian ke pasien. Durasi inap terbayar masih membutuhkan definisi dan provenance. Status-status itu tetap terpisah seperti PR97; K06 tidak diubah. Tidak ada schema/policy/mutasi baru dan K07 tidak dicentang keseluruhan.

Base main `9a43263`. Rollback melalui revert source dua file; tidak membutuhkan rollback database atau mengubah riwayat dosis. Publikasi candidate menunggu penegasan scope setelah auto-review menolak publikasi PR U03 sebagai di luar A01; tidak menggunakan jalur alternatif. Setelah diterima, lane rilis menangani ready/merge/deploy. Parent mengelola Sheet.
