# K07 — kelengkapan jejak pemberian obat berprotokol

Sumber existing Obat Khusus membaca protokol/dosis tanpa checked pagination dan mengabaikan error, sehingga kegagalan read terlihat sebagai tidak ada obat. Perbaiki pembacaan dengan client/RLS yang sama, validasi parent rawat inap, pagination lengkap dan IN list terikat per200ID. Jika konteks tidak lengkap, tampilkan peringatan dan jangan menawarkan form berbasis riwayat kosong palsu.

Tidak menambah bukti penyerahan obat biasa, tidak menebak status pemberian dari pembayaran, dan tidak menghitung durasi inap terbayar. Tidak ada schema, permission atau mutation baru. RED komponen gagal-read, GREEN helper completeness/branch/error dan UI; focused checks, review dan build/type/lint. K07 tetap parsial sampai sumber/definisi yang belum ada diputuskan.
