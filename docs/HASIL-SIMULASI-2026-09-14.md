# Hasil simulasi produksi — 14 September 2026

Status: pengujian berlangsung; bukan pernyataan siap operasional penuh.
Tarif simulasi disepakati setelah Reza mengizinkan angka perkiraan: Rp100.000/hari.
Angka ini hanya fixture uji, bukan estimasi pasar atau tarif klinik resmi.
Belum diaktifkan di master produksi: pemilihan tarif otomatis masih global,
sehingga label SIMULASI saja tidak mencegah pemakaian oleh pasien nyata.
Reza mengizinkan cabang mana pun dengan data uji terpisah. Dipilih Klinik Panduraya.
Tidak menjalankan SQL produksi; perubahan SQL tetap diserahkan ke Reza.

## Bukti yang sudah diamati

- `npm test`: 114 berkas, 1.109 tes lulus (23.44 WIB), checkout release.
- Produksi WA: pengiriman belum siap, master nonaktif, riwayat kosong. Tidak mengirim pesan.
- Dua pelanggan fiktif dibuat lewat form produksi: SIMULASI QA 1409 PEMILIK A dan B, nomor dummy nol.
- Anabul SIMULASI QA MOCHI 1409 dibuat pada A, ditransfer ke B lewat form konfirmasi.
- Setelah reload, pemilik B dan satu audit A → B tetap terbaca (23.45.55 WIB).
- Transfer awal ini belum memiliki riwayat kunjungan/tagihan/poin, sehingga belum membuktikan preservasi data tersebut di produksi.
- Registrasi kemudian mengenali nomor B dan anabul yang sama. Satu kunjungan simulasi Klinik Panduraya berhasil masuk antrian dan detail medis.
- Alat SIMULASI QA ALAT 1409 (QA-1409-ONLY) tersimpan di Klinik Panduraya.
- Maintenance bertanggal 2026-09-14, biaya Rp0, hasil fiktif tersimpan; jadwal berikutnya terbaca 2026-10-14.

## Identitas data uji untuk kelanjutan dan penanganan

- Pemilik A: fd6cedfa-029d-401c-a638-f9c2d1236918.
- Pet: 59feadf0-7a81-45bd-ae7a-192c9211621c.
- Kunjungan: c799e7fc-f912-43d5-907f-cc30538d8273.
- Data uji masih disimpan. Label bukan mekanisme otomatis untuk mengecualikan laporan. Jangan anggap angka produksi bersih dari simulasi.
- Tidak mengubah pelanggan/pasien asli. Tidak ada penjualan atau pembayaran nyata.

## Belum lulus / belum diuji penuh

- Import barang → saldo awal → penjualan multisatuan → kartu stok.
- Import arsip medis dan deduplikasi.
- Transfer dengan riwayat terisi, tagihan/poin, stale request dan akses staf.
- Rawat inap, billing, consent, cetakan.
- Dokter multi-cabang dan batas akses akun per cabang.
- Expiry/downgrade poin (jangan menjalankan penutupan massal produksi).
- WhatsApp tujuh trigger sampai diterima: masih membutuhkan konfigurasi pengirim dan penerima uji yang disetujui.
- Ukuran performa 1 vs 10 tab dan pembaruan versi lintas deployment.
- Printer fisik dan penerimaan pengguna.

## Hasil lanjutan dan hambatan nyata

- Transfer B → A setelah kunjungan tersimpan berhasil. Riwayat satu kunjungan masih dapat dibuka melalui pet yang sama, dengan isi anamnesis/diagnosis simulasi. Header riwayat masih menyebut pemilik historis B; identitas pemilik sekarang pada transfer adalah A.
- Kirim ulang transfer dari tab lama ditolak: kepemilikan sudah berubah, harus muat ulang. Audit hanya dua transfer sah.
- Rawat inap fiktif berhasil dibuat, ID e5230256-d193-4001-af2b-386aea3cf8f4.
- Catatan harian berhasil tersimpan, ID 6e5ae467-9af3-4338-a32b-f98b0ada4c1b. Kolom pemantauan kosong tampil belum dicatat, bukan nol.
- BLOCKED billing: produksi menunjukkan tidak ada master tarif kategori Rawat Inap. Kode memilih tarif aktif global pertama berdasarkan nama, bukan tarif khusus data uji/cabang. Jangan membuat tarif fiktif aktif untuk melewati hambatan: bisa memengaruhi pasien lain.
- BLOCKED consent: tidak ada template aktif di cabang uji. Isi persetujuan resmi perlu berasal dari klinik. Tidak ada tanda tangan nyata yang dibuat.
- BUG tanggal: input 14 September pukul 23.50 pada catatan tampil tanggal 15 September di daftar. Reproduksi dengan zona waktu server UTC menghasilkan waktu 15 September pukul 06.50 WIB.
- Perbaikan LOKAL: input tanggal/jam diberi zona WIB eksplisit pada simpan/edit; daftar menggunakan tanggal laporan dan jam WIB. Tidak mengoreksi data lama massal.
- Verifikasi perbaikan lokal: 115 berkas / 1.115 tes lulus; build lulus; diff check bersih. Belum commit/push/deploy, belum verifikasi perbaikan tanggal di produksi.
- Simpan rekam medis sebelum status pemeriksaan ditolak pada tahap penyelesaian, tetapi sebagian catatan tampaknya telah tersimpan. Perlu audit atomicity dan pencegahan pengulangan sebelum mengklaim alur gagal aman sepenuhnya.

Data simulasi tetap tersimpan (termasuk rawat inap berstatus stabil), bukan data nyata. Belum ada transaksi stok, pembayaran, pengiriman WA, SQL produksi, atau perubahan akses. Penanganan data uji perlu dicatat sebelum rilis operasional.

Metode: menggunakan skill anthropic-skills:systematic-debugging untuk pelacakan sumber bug serta anthropic-skills:test-driven-development untuk pengujian perbaikan tanggal. Skill webapp-testing hanya dibaca, tidak digunakan karena pengujian produksi melalui kontrol browser yang tersedia.
