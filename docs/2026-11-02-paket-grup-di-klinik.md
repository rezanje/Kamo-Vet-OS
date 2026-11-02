# Paket (barang Grup) bisa dipilih di klinik — 2 November 2026

Laporan: Andri (grup klinik, 15.07) — "item grouping belum muncul di klinik, baik pas pembayaran / isi rekam
medis". Anisa (15.08) — "item grouping munculin di obat ya, jadi jangan minta BMHP lagi".

## Akar masalah

- Rekam medis: daftar Obat hanya berisi barang `Persediaan`; barang bertipe `Grup` tidak pernah tampil.
  Bila Grup ada di kategori JASA/TINDAKAN, ia malah ikut daftar jasa/tindakan dan akan ditolak saat bayar.
- Pembayaran: Grup ikut daftar master obat, tetapi posting klinik (`clinic_post_invoice`) hanya menerima baris
  obat bertipe `Persediaan` dan baris jasa bertipe `Jasa` → memilih Grup langsung berakhir `ITEM_INVALID`.
  Satu-satunya jalur paket klinik (H05) adalah menandai baris isi satu per satu lewat "Asal paket".

## Perubahan (aplikasi saja, tanpa migrasi database)

- `src/lib/paket-klinik.ts` (baru): memecah paket jadi baris isi (Persediaan → obat, Jasa → jasa,
  Non-Persediaan dilewati), membagi harga paket ke baris-barisnya sebanding harga normal (total persis harga
  paket), stok paket = berapa paket bisa dibuat dari stok isinya, dan pengenalan ulang paket di pembayaran.
  - Satuan resep dipakai bila qty-nya bulat, selain itu satuan dasar; barang yang muncul dua kali di resep
    digabung dalam satuan dasar (guard H05 membandingkan total per barang). Isi yang tidak bulat bahkan di
    satuan dasar ditolak dengan pesan untuk memperbaiki resep paket (baris tagihan klinik wajib bilangan bulat).
- `loadClinicPackages` sekarang membawa resep lengkap (`resep`); paket dengan isi nonaktif tidak ditawarkan.
- `splitClinicItems` mengeluarkan Grup ke daftar `paket` sendiri (tidak lagi jatuh ke jasa/tindakan).
- Rekam medis (`RekamForm`): paket tampil di tab Obat (stok = jumlah paket yang bisa dibuat). Dipilih →
  isinya masuk keranjang sekaligus dengan label "paket …", tanpa kotak BMHP. Memilih lagi menambah jumlah paket;
  menghapus satu isi menghapus seluruh paket; qty isi dikunci mengikuti jumlah paket.
- Pembayaran (`PembayaranForm`):
  - Paket muncul di pemilih Obat sebagai "Paket · …". Dipilih → baris itu diganti isi paket (jasa masuk tabel
    Jasa), semuanya ditandai asal paket (H05) dengan jumlah paket 1. Mengubah "Jml paket" di salah satu baris
    menyesuaikan semua isi paket itu di kedua tabel.
  - Baris dari rekam medis yang persis isi paket (qty = k × resep dan total harga = k × harga paket) otomatis
    ditandai asal paketnya; kasir tetap bisa mengubah pilihan "Asal paket".
  - Grup tanpa resep utuh, dan semua Grup saat koreksi tagihan, tidak ditawarkan (tidak bisa ditagih).

Stok isi paket dipotong saat tagihan disimpan lewat jalur posting yang sudah ada; batas harga/HPP (P03),
komisi dan omzet paket mengikuti aturan H05 yang sudah ada.

## Batasan

- Rekam medis tidak punya kolom asal paket; pengenalan di pembayaran memakai kecocokan qty + harga. Bila isi
  paket diubah harga/qty-nya sebelum bayar, baris diperlakukan sebagai penjualan biasa (batas harga per baris).
- Form "Tambah item susulan" dan Obat Khusus rawat inap belum menampilkan paket (bukan bagian laporan).
- Belum diuji dengan data paket asli Kamo di Production; tes memakai data fiksi.

## Tes

- `src/lib/__tests__/paket-klinik.test.ts` — pemecahan, pembagian harga, stok paket, pengenalan paket.
- `src/components/__tests__/clinic-paket-obat.test.tsx` — rekam medis (pilih paket, tanpa BMHP, tambah jumlah,
  hapus), pembayaran (pemilih menyerahkan paket, penandaan otomatis dari rekam medis).

## Lanjutan 2 Nov malam — paket tampil satu baris (Anisa 20.29–20.30)

Masukan Anisa setelah mencoba "Kimia Darah Lengkap": keranjang menampilkan tiap isi paket dengan harga hasil pembagian
(terbaca seperti HPP). Diminta tampil seperti tindakan: satu baris harga paket (mis. Rp800.000), isi kecil dengan qty saja.

- Rekam medis (`RekamForm`, komponen `BarisPaket`): satu baris per paket — nama, label "paket", "Rp … / paket", pelaksana
  (diisi sekali untuk semua isi), kotak "ISI PAKET" berisi `nama × qty satuan` tanpa harga, input jumlah paket, subtotal,
  hapus paket. Baris isi yang dikirim ke server tidak berubah.
- Pembayaran (`PembayaranForm`, komponen `PaketTagihan`): satu baris per paket — harga per paket, jumlah paket (menyesuaikan
  semua isi), diskon % berlaku untuk semua isi, pelaksana sekali, kotak "ISI PAKET", tombol "Bukan paket" untuk melepas
  penandaan yang keliru, hapus paket. Isi berjenis jasa ikut tabel Obat (jenisnya tetap `jasa` saat dikirim) supaya paket
  tidak tampil dua kali.
- Belum berubah: struk/invoice cetak dan detail rekam medis tersimpan masih menampilkan baris isi.
