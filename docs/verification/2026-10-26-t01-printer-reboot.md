# T01 — verifikasi printer kasir setelah restart

Status: **menunggu uji pada laptop dan printer kasir yang sama dengan uji cetak awal**. Cetak awal sudah dilaporkan berhasil dalam checklist; dokumen ini belum menjadi bukti cetak sesudah restart.

## Cara kerja yang perlu diuji

Struk kasir membuka dialog cetak browser. Tombol **Cetak Struk** memanggil `window.print()`; aplikasi tidak memasang atau menyalakan driver, layanan printer, maupun bridge lokal. Karena itu hasil setelah restart bergantung pada browser, antrean/driver sistem operasi, dan koneksi ke printer yang dipakai di kasir. Jangan menyimpulkan startup otomatis hanya karena dialog cetak terbuka.

## Langkah uji pada perangkat asli

1. Catat cabang, model printer, jenis koneksi (USB/jaringan), laptop/OS, browser, nama printer yang dipilih, ukuran kertas dan tanggal/waktu. Gunakan URL halaman struk dari transaksi tersimpan yang boleh dicetak ulang; jangan membuat pembayaran baru hanya untuk uji ini. Simpan URL tanpa parameter `print=1` agar pembukaan ulang tidak memicu cetak otomatis.
2. Sebelum restart, buka kembali URL struk yang sama dan klik **Cetak Struk** satu kali. Pastikan kertas benar-benar keluar dan nomor, total, serta lebar kertas sesuai jalur yang diuji. Catat apakah printer dipilih otomatis atau secara manual.
3. Tutup browser, matikan laptop dan printer, lalu nyalakan kembali keduanya. Tunggu sampai printer siap dan login ke OS serta aplikasi seperti staf pada pergantian shift. Jangan jalankan driver/bridge secara manual dulu.
4. Buka kembali **struk yang sama** dan klik **Cetak Struk** satu kali. Catat apakah dialog muncul, apakah printer yang benar tetap terpilih, status antrean sistem operasi, dan apakah kertas keluar dengan isi dan ukuran yang sama. Bila browser meminta izin pop-up atau perubahan tujuan cetak, catat langkahnya.
5. Jika belum keluar, cek koneksi dan status printer di OS. Catat apakah layanan/driver/bridge pihak ketiga yang memang digunakan di laptop itu berjalan. Jalankan atau buka komponen tersebut **hanya jika diketahui dari konfigurasi perangkat**, kemudian ulangi cetak struk yang sama. Jangan memasang driver baru atau mengubah konfigurasi produksi sebagai bagian uji tanpa penanggung jawab perangkat.
6. Restart lagi dan ulangi langkah 3–4 bila ada konfigurasi startup yang diperbaiki oleh pengelola perangkat. Catat hasil setiap percobaan, termasuk gagal. Jangan menyebut T01 lulus berdasarkan Save as PDF, preview, atau antrean berstatus terkirim tanpa kertas keluar.

Jalur cetak yang perlu dicatat: halaman struk kasir `/kasir/struk/[saleId]` memakai format 58 mm dari driver Windows; halaman `/pos/struk/[saleId]` memakai aturan 80 mm. Gunakan jalur yang sama dengan cetak awal, dan jangan menukar ukuran kertas untuk menyamakan hasil. ID pada URL berasal dari transaksi tersimpan; jangan menebaknya.

## Catatan hasil (isi setelah uji)

| Percobaan | Waktu/perangkat | Printer & koneksi | Driver/bridge setelah login | Dialog & pilihan printer | Kertas keluar dan nomor/total/lebar benar? | Tindakan tambahan | Bukti |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sebelum restart | — | — | — | — | — | — | — |
| Sesudah restart, tanpa intervensi | — | — | — | — | — | — | — |
| Sesudah langkah pemulihan, bila perlu | — | — | — | — | — | — | — |

Kesimpulan harus menyebut **startup otomatis** atau langkah manual yang benar-benar diperlukan pada perangkat tersebut. Lampirkan foto kertas/antrean dan catatan versi driver atau bridge jika ada; samarkan data pelanggan. Jika gagal, catat titik gagal yang terlihat (dialog browser, pemilihan printer, antrean OS, atau keluaran fisik) agar pemilik perangkat dapat menindaklanjuti tanpa mengubah transaksi.

## Batas verifikasi kode

Pembukaan ulang halaman struk dan tombol cetak tersedia di kedua jalur; hasil cetak fisik dan status driver sesudah restart tidak dapat disimulasikan dengan fixture aplikasi. Tidak ada perubahan pada alur pembayaran, printer default OS, atau izin produksi dalam batch ini.
