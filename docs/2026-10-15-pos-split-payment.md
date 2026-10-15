# Pembayaran gabungan POS

## Perilaku

Satu transaksi POS dapat dibayar melalui 1–6 metode unik: Tunai, Transfer, Debit,
Kredit, QRIS, dan E-Wallet. Nama pilihan pada layar adalah **Bayar Gabungan**.
Jumlah bagian pembayaran harus tepat sama dengan total tagihan setelah seluruh
potongan. Server menghitung ulang harga, promo, dan potongan sebelum menyimpan.
Nominal uang memakai ketelitian paling banyak dua angka desimal.

Contoh tagihan Rp100.000:

| Bagian | Nilai penjualan | Pengaruh |
| --- | ---: | --- |
| Tunai | Rp20.000 | Penerimaan tunai pada shift bertambah Rp20.000 |
| Transfer | Rp80.000 | Penerimaan transfer dan akun bank yang dipetakan bertambah Rp80.000 |
| Total | Rp100.000 | Satu transaksi dan satu pendapatan Rp100.000, sebelum pemisahan pajak |

Jika pelanggan menyerahkan tunai Rp50.000 untuk bagian tunai Rp20.000,
kembaliannya Rp30.000. Alokasi transfer tetap Rp80.000. Uang diterima pada header
struk berjumlah Rp130.000 dan kembalian Rp30.000; penerimaan bersih tetap
Rp100.000. Hanya uang tunai yang dapat menghasilkan kembalian.

Transaksi bernilai nol tetap menggunakan metode biasa, tanpa alokasi uang fiktif.
Transaksi lama mempertahankan pembacaan metode tunggal yang sudah tersimpan.

## Cara mencoba

1. Masuk akun POS cabang, buka shift, pilih pelanggan, tenaga penjual, dan barang.
2. Aktifkan **Bayar Gabungan** pada bagian metode pembayaran.
3. Untuk tagihan Rp100.000, isi Tunai Rp20.000 dan Transfer Rp80.000. Pastikan
   status menunjukkan **Pembayaran pas**. Tombol bayar tetap nonaktif jika jumlah
   kurang, berlebih, atau uang tunai yang diterima belum mencukupi.
4. Bayar setelah uang benar-benar diterima. Struk menampilkan masing-masing
   bagian pembayaran. Transaksi selanjutnya kembali kosong setelah pengakuan
   struk yang sesuai dengan draft tersebut.
5. Periksa penjualan rinci: hanya satu penjualan Rp100.000 dengan rincian metode.
   Periksa shift: penerimaan Tunai Rp20.000 dan Transfer Rp80.000. Saldo kas/bank
   mengikuti pemetaan rekening yang berlaku saat transaksi dibuat.
6. Jika perlu menguji kembalian, ubah **Uang tunai diterima** menjadi Rp50.000.
   Kembalian tunai harus Rp30.000; penerimaan bersih tidak berubah.

Gunakan transaksi operasional yang benar di produksi. Pengujian otomatis dengan
penjualan, pengeluaran, dan retur fiktif dijalankan di database terisolasi dan
fixture browser lokal.

## Integritas penyimpanan dan laporan

- `sales.payment_plan` membedakan checkout baru yang belum selesai dari transaksi
  lama. `payments_finalized_at` adalah penanda penyelesaian checkout baru.
- `sale_payments` menyimpan metode, penerimaan bersih, dan snapshot rekening yang
  dipetakan server. Aplikasi tidak dapat menulis ulang alokasi tersebut langsung.
- Pada penyimpanan header, database memvalidasi actor/cabang/shift, periode,
  rekening, dan jumlah; menyimpan rencana jurnal secara privat tanpa menulis
  penerimaan ke buku besar. Baris barang dan HPP FIFO kemudian disimpan.
- `finalize_pos_sale` memeriksa subtotal rincian serta pembayaran dan memposting
  pendapatan, diskon, PPN, HPP, dan perubahan poin bersama dalam satu transaksi database. Struk
  hanya diterbitkan setelah finalisasi terkonfirmasi. Finalisasi ulang tidak
  menggandakan jurnal. Kegagalan checkout mempertahankan draft browser.
- Identitas checkout unik per kasir dan sidik jari pilihan pengguna memungkinkan
  respons yang hilang dipulihkan ke struk yang sama. Percobaan bersamaan tidak
  membuat header kedua. Harga/nama master yang berubah dan saldo poin yang sudah
  terpakai tidak mengubah identitas pilihan asli. Draft yang telah diedit tidak
  dikosongkan diam-diam; tersedia tautan eksplisit ke transaksi sebelumnya.
- Perhitungan desimal yang sama dipakai browser dan server, termasuk titik
  setengah sen. PPN untuk checkout baru dibulatkan dua desimal; struk dan laporan
  mempertahankan nominal sen yang diterima. Pajak transaksi lama tidak diubah.
- Laporan penjualan, pelanggan, komisi, struk, dan perhitungan shift mengabaikan
  checkout baru yang belum difinalisasi. Perincian metode menjumlahkan alokasi;
  jumlah transaksi tetap menghitung header sekali.
- Tutup shift ditolak selama pembayaran masih diproses. Setelah shift dikunci
  untuk ditutup, database memeriksa ulang seluruh rincian metode dan kas yang
  diharapkan agar pembayaran yang baru selesai tidak menghasilkan selisih palsu.
- Retur membagi pengembalian secara kumulatif menurut pembayaran asli, memakai
  snapshot rekening dan rincian pajak/diskon dari jurnal asal. Pembulatan sen
  deterministik dan pengembalian penuh menghabiskan setiap alokasi tepat sekali.
  Bagian pengembalian tunai saja yang mengurangi kas shift.

Checkout stok masih memakai rangkaian RPC FIFO yang sudah ada per baris; fitur
ini tidak mengubah seluruh checkout menjadi satu transaksi stok lintas baris.
Kegagalan yang terjadi sesudah mutasi stok tetap memerlukan pemeriksaan mutasi
terkait. Finalisasi pembukuan sendiri bersifat atomik.

## Verifikasi

- `npm test`: 237 berkas, 2.010 pengujian lulus.
- `npx tsc --noEmit`: lulus. `npm run lint`: nol error; 13 warning lama.
- `NEXT_TELEMETRY_DISABLED=1 npm run build -- --no-lint`: lulus.
- `python3 scripts/test-pos-split-payments-postgres.py`: seluruh 196 migrasi,
  acceptance split payment, regresi retur lama dan pengeluaran, serta empat
  pemeriksaan konkurensi lulus pada PostgreSQL 16 terisolasi. Tidak memakai URL
  database produksi; container dan volume dibersihkan.
- Chromium 151: 23 skenario dengan komponen POS, validasi, draft, dan penghapus
  draft asli lulus. Backend action/router/layar struk pada fixture browser memakai
  stub lokal yang dinyatakan secara eksplisit. Bukti browser tidak dimaksudkan
  sebagai bukti penulisan database, jurnal, stok, atau laporan.
- Review kode baru dan migrasi selesai tanpa blocker tersisa. Hasil produksi
  diperiksa setelah rilis melalui pembacaan skema dan layar tanpa memasukkan
  penjualan, pengeluaran, retur, atau perubahan shift fiktif.
