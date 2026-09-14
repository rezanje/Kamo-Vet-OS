# Panduan trial operasional VetOS

Status: DEMO/TRIAL TERBATAS; belum siap operasional penuh dan belum ada kelulusan
pengguna/cabang. Gunakan akun serta data uji yang disetujui penanggung jawab
cabang. Jangan memakai pelanggan, pasien, stok, poin, atau nomor WhatsApp nyata
sebelum skenario terkait dinyatakan lulus.

Teks siap kirim ke user: [Pesan trial untuk user](./PESAN-TRIAL-UNTUK-USER.md).

## Mulai dari sini

Urutan trial yang paling aman:

1. Buka dashboard dan halaman riwayat secara baca saja. Pastikan cabang yang dipilih benar.
2. Coba maintenance dengan alat uji berlabel `SIMULASI QA`.
3. Coba transfer anabul uji yang punya dua pemilik fiktif. Pastikan riwayat tetap ada dan transfer dari tab lama ditolak.
4. Coba registrasi, antrian, rekam medis, dan catatan rawat inap dengan data uji. Jangan lanjut pembayaran dulu.
5. Setelah itu baru uji import, stok, akses cabang, loyalty, dan cetakan secara didampingi.
6. WhatsApp dan performa diuji paling akhir karena butuh konfigurasi pengirim/penerima dan pengukuran khusus.

Setiap langkah dicatat sebagai `LULUS`, `GAGAL`, atau `TERTUNDA`. Status
`TERTUNDA` bukan bug; artinya prasyarat bisnis atau konfigurasi belum tersedia.

## 1. Import → penjualan → kartu stok

Status: bisa diuji dengan data uji terpisah; belum terbukti end-to-end di produksi.

1. Buka https://kamo-vet-os.vercel.app/pos/sku/impor.
2. Unduh template barang dari https://kamo-vet-os.vercel.app/pos/sku/impor/template.
3. Isi satu produk uji berkode unik. Satuan dasar pcs; satu box berisi 12 pcs.
   Isi harga per satuan sesuai template. Jangan menamai ulang laporan Nilai
   Persediaan menjadi Barang & Jasa; keduanya berbeda isi dan kegunaan.
4. Pilih cabang/gudang yang benar. Periksa pratinjau, kode, satuan, dan harga.
   Baris salah harus diperbaiki sebelum import. Import master tidak membuktikan
   stok awal sudah masuk; lanjutkan alur saldo awal yang tersedia.
5. Masukkan saldo awal 24 pcs untuk produk uji. Cocokkan daftar stok dan kartu stok.
6. Jual 1 box. Hasil yang diharapkan: stok berkurang 12 pcs menjadi 12 pcs,
   harga transaksi memakai harga box, kartu stok menunjukkan keluar 12 pcs.
7. Jual 2 pcs. Stok akhir 10 pcs. Bukti transaksi dan kartu stok harus cocok.
8. Uji kode sama, format angka salah, gudang salah, jumlah melebihi stok,
   dan pengiriman form dua kali. Catat hasil, jangan mengasumsikan semuanya lolos.
9. Cek cabang kedua: transaksi/stok cabang pertama tidak boleh terlihat oleh
   staf tanpa akses. Master barang global tidak sama dengan stok per gudang.

Stok: https://kamo-vet-os.vercel.app/pos/stok

Kartu stok: https://kamo-vet-os.vercel.app/pos/kartu-stok

## 2. Import rekam medis

Status: bisa diuji dengan arsip uji; hasil import dan deduplikasi belum dinyatakan lulus.

https://kamo-vet-os.vercel.app/klinik/rekam-medis/impor

Pilih satu arsip uji → cek pratinjau pemilik/hewan/tanggal → import → buka riwayat.
Cocokkan jumlah kunjungan, tanggal, diagnosis, tindakan dan obat terhadap arsip.
Coba file dengan sel kosong dan import ulang; catat penolakan/duplikasi.

## 3. Transfer anabul

Status: fitur dan perlindungan tab lama sudah terbukti dengan data simulasi; preservasi
tagihan/poin pada data historis masih perlu diuji dengan fixture yang sesuai.

https://kamo-vet-os.vercel.app/crm/pelanggan

Pilih hewan uji dengan riwayat → Transfer pemilik → pilih pemilik tujuan →
konfirmasi. Hewan hilang dari daftar asal dan muncul pada pemilik baru dengan
identitas serta rekam medis sama. Tagihan dan poin asal tidak berubah.
Riwayat mencatat pemilik asal/tujuan, petugas dan waktu. Ulangi dari tab lama:
permintaan basi harus ditolak. Akun staf tidak boleh melakukan transfer.

## 4. Rawat inap, persetujuan, dan cetakan

Status: alur dasar bisa dicoba; billing otomatis tertunda sampai tarif resmi tersedia,
dan persetujuan tertunda sampai template resmi cabang tersedia.

Rawat inap: https://kamo-vet-os.vercel.app/klinik/rawat-inap

Template persetujuan: https://kamo-vet-os.vercel.app/klinik/persetujuan

Rekam medis: https://kamo-vet-os.vercel.app/klinik/rekam-medis

Daftarkan pasien uji → catat masuk/keluar → cocokkan lama inap serta tarif.
Periksa biaya tidak terduplikasi saat halaman dibuka kembali.
Tindakan wajib persetujuan harus tertahan sampai form ditandatangani.
Cetak invoice, struk, dan dokumen medis memakai Save as PDF dulu; cocokkan
nama cabang/pasien, tanggal, rincian, total, tanda tangan, lebar kertas, dan
pemisahan halaman. Hasil printer fisik perlu konfirmasi pengguna.

## 5. Maintenance, dokter cabang, dan loyalty

Status: maintenance sudah dicoba dengan data fiktif; dokter lintas cabang, batas akses,
dan expiry/downgrade loyalty masih perlu uji terarah.

https://kamo-vet-os.vercel.app/klinik/maintenance

Tambahkan alat uji → jadwal → catat servis → cek riwayat dan jatuh tempo berikutnya.

https://kamo-vet-os.vercel.app/hris/karyawan

Tetapkan dokter pada dua cabang → periksa pilihan dokter pada registrasi kedua
cabang; cabang tanpa penugasan tidak menawarkan dokter itu.

https://kamo-vet-os.vercel.app/pengaturan/tier

Uji expiry dan downgrade dengan data terpisah. Jangan menjalankan penutupan poin
seluruh pelanggan untuk trial. Cocokkan perubahan dengan riwayat poin.

## 6. WhatsApp

Status: mesin dan tujuh trigger tersedia; pengiriman produksi belum aktif.

https://kamo-vet-os.vercel.app/pengaturan/wa-engine

Pengiriman menggunakan Fonnte. Akun pengirim dan nomor penerima uji harus
disetujui. Status koneksi hanya menandakan konfigurasi tersedia, bukan bukti
pesan diterima. Jalankan satu kasus uji, cocokkan log dengan pesan pada telepon.
Uji setelah transfer: reminder hewan ditujukan kepada pemilik sekarang.
Jangan menjalankan pengiriman massal sebagai tes.

## 7. Performa dan versi baru

Status: perbaikan pemuatan menu, pemberitahuan versi, dan tanggal catatan WIB sudah
dirilis; keluhan lemot belum dinyatakan selesai sebelum pengukuran 1 versus 10 tab
dilakukan.

Bedakan tab menu dalam aplikasi dan tab browser. Tab menu menyimpan alamat,
bukan sepuluh halaman aktif sekaligus. Login tetap memakai sesi.
Ukur waktu membuka pelanggan, rekam medis, dan stok dengan 1 lalu 10 tab browser.
Catat perangkat, koneksi, cabang, jumlah data, durasi, serta gejala.
Sesudah rilis berikutnya, tab aktif akan memeriksa versi berkala dan menawarkan
pembaruan. Simpan formulir dahulu; aplikasi tidak memuat ulang otomatis.
Pemberitahuan versi bukan sinkronisasi data realtime antarpetugas.

## Catatan hasil dan kriteria selesai

Untuk setiap skenario tulis: tanggal, cabang, peran, kode data uji, langkah,
hasil diharapkan, hasil aktual, bukti, lulus/gagal, dan petugas pemeriksa.
Pemakaian 10+ cabang dibuktikan per cabang dengan transaksi yang disetujui,
hasil pencocokan stok/tagihan, dan konfirmasi petugas. Daftar nama cabang atau
screenshot menu saja bukan bukti pemakaian.

Pajak, AI adendum dan penutupan data klien tetap ditunda sesuai kesepakatan.
