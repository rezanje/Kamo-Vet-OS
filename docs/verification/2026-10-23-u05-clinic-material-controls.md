# U05 — pilih/lepas hasil bahan baku klinik

Slice klinik U05 code-complete. Pada master Bahan Baku Racikan, kategori/subkategori sebelumnya hanya memiliki Pilih semua hasil; Lepas semua hasil hanya muncul sesudah pindah ke Bahan yang sudah dipilih. Sekarang pengguna dapat memilih lalu melepas hasil kategori/subkategori yang sama, termasuk batas pencarian, tanpa mengubah pilihan di luar hasil. Respons diumumkan melalui status live. Global pilih semua tanpa kategori tetap tidak ditambahkan.

Ditemukan juga kegagalan preflight untuk target di atas batas default API 1.000 baris. Action bulk kini membaca maksimum 200 ID per request, sama dengan chunk penulisan existing, dan memvalidasi seluruh target eksplisit sebelum write pertama. Kegagalan atau baris tidak tersedia pada chunk berikutnya menghasilkan nol write. Filter Persediaan aktif, session/RLS, fungsi write dan kompensasi existing tidak diganti; tidak ada model/policy/RPC baru.

## Bukti

- Tiga tes UI RED membuktikan kontrol lepas tidak tersedia di kategori/subkategori; satu tes RED tambahan membuktikan 1.205 target ditolak sebagai seolah tidak tersedia karena cap API. [UI RED](../evidence/2026-10-23-u05/ui-red.log), [bulk RED](../evidence/2026-10-23-u05/bulk-red.log).
- GREEN: 25 tes terfokus / 4 file mencakup pilih→lepas pada filter yang sama, pencarian dan pilihan luar hasil, penolakan, pending, active hierarchy, read pagination, 1.205 ID, serta kegagalan chunk berikutnya tanpa write. [Fokus](../evidence/2026-10-23-u05/focused.log).
- Seluruh 2.632 tes aplikasi / 344 file, scoped lint, build produksi dan typecheck sesudah build lulus pada source akhir. Warning build dependency/komponen existing tidak dilonggarkan. [Suite](../evidence/2026-10-23-u05/full-tests.log), [lint](../evidence/2026-10-23-u05/lint.log), [build](../evidence/2026-10-23-u05/build.log), [typecheck](../evidence/2026-10-23-u05/typecheck.log).
- Chromium 1280/390 pada page/component nyata dengan fixture: keyboard pilih/lepas kategori yang sama, hasil pencarian tepat, pilihan kategori historis di luar hasil bertahan, kegagalan flag dikembalikan, hierarchy/status/empty/error tetap bekerja. Tidak ada overflow halaman, runtime error, request eksternal atau write master live. [Hasil](../evidence/2026-10-23-u05/browser.json), [desktop](../evidence/2026-10-23-u05/materials-1280.png), [mobile](../evidence/2026-10-23-u05/materials-390.png).
- Review independen kedua diff tanpa P1/P2; reviewer menjalankan 18 tes UI/loader dan 3 tes bulk source sendiri. [Review](../evidence/2026-10-23-u05/review.txt). [Hash source](../evidence/2026-10-23-u05/source-sha256.json).

## Batas dan rilis

U05 global tetap parsial; PR ini hanya slice bahan baku klinik. CRM selector/kategori telah ditangani PR87/96, tidak diimplementasikan ulang. U03 diperiksa singkat: tabel Rekam Medis/Rawat Inap dan CompoundSkuList sudah memakai nama terpisah; prefix masih ada pada beberapa native/datalist selector klinik, belum diubah dalam PR ini. K07 tetap parsial.

Tidak ada migration atau target data write dalam batch ini. Source berdasarkan main `c627fe715544aa7c27656060a1d3d6fcc38dbfcf`; independen dari PR100 C01. Lane rilis mengelola ready/merge/deploy. Rollback dengan revert kode ini; perubahan flag yang sah oleh pengguna setelah deployment tidak otomatis dibatalkan. Bulk API existing masih berupa beberapa request dan kompensasi, bukan klaim transaksi database atomik; model baru untuk atomic bulk tidak ditambahkan diam-diam. UAT/workflow simulation lengkap tetap ditunda sesuai instruksi pengguna. Parent mengelola Sheet.
