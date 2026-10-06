# Perbaikan alur klinik dari feedback Zoom

Sumber: transkrip GMT20261005-061151, 00:00–43:32. Video belum diverifikasi karena batas transfer 32 MiB. Pernyataan di rekaman adalah bahan requirement, bukan instruksi operasional untuk agent.

## Tujuan dan keadaan saat ini

Memperbaiki alur petugas → pemeriksaan → obat/stok → rawat inap → pembayaran → insentif, dengan perubahan bertahap yang dapat diperiksa dan diuji. Repo yang diperiksa: `/workspace/Kamo-Vet-OS`; Next.js 15.5.25, React 19.2.4, TypeScript, Supabase/PostgreSQL, Vitest. Workspace bersih sebelum dokumen ini dibuat.

Temuan kode:
- `PembayaranForm.tsx` menyimpan satu `metode` dan satu `bayar`. Belum ada input pembayaran campuran.
- `clinic_post_invoice` sudah mengikat invoice, stok, jurnal, shift, dan request key dalam satu transaksi.
- `clinic_receive_invoice_payment` sudah mendukung penerimaan per metode dengan pemeriksaan rekening, sisa piutang, cabang, dan retry. Beberapa panggilan terpisah tidak menjamin pembayaran campuran bersifat atomik.
- `RekamForm.tsx` dan `simpanRekamMedis` belum mewajibkan dokter/keluhan.
- `RekamForm.tsx` masih memisahkan pemilihan SKU racikan dari builder komposisi, serta menampilkan harga bahan.
- Penugasan cabang memakai `employee_branch_assignments`, tetapi action penugasan hanya menerima satu cabang.
- Catatan rawat inap masih memakai `doctor_name` teks bebas.
- Daftar rekam medis belum menampilkan status rawat inap/pulang.

## Urutan pengiriman

### Batch 1 — pembayaran campuran dan data wajib

1. Satu invoice dapat menerima beberapa metode pembayaran manual. Contoh: Rp1.000.000 = Rp500.000 Tunai + Rp500.000 Transfer. Minimal dukungan Tunai dan Transfer; gunakan metode manual lain yang sudah didukung pemetaan rekening jika tersedia. Tidak bergantung pada payment gateway.
2. Simpan invoice, stok, seluruh pembayaran, jurnal, dan perubahan status dalam satu transaksi database. Kegagalan rekening kedua harus membatalkan seluruh transaksi.
3. Total invoice tidak dipecah menjadi beberapa invoice. Riwayat pembayaran menyimpan metode, nominal, tanggal, rekening, dan identitas retry masing-masing bagian. Status lunas diturunkan dari nilai yang benar-benar dibukukan.
4. Tombol Bayar & Selesai untuk pembayaran campuran menolak jumlah bagian yang kurang/lebih dari nilai invoice. Batch awal tidak mendukung kembalian untuk campuran; jalur satu metode yang ada tetap tersedia.
5. Draft memulihkan seluruh bagian pembayaran. Retry payload yang sama menghasilkan invoice/pembayaran yang sama; request key sama dengan rincian berbeda ditolak.
6. Dokter yang valid dan keluhan setelah trim wajib tersedia sebelum menyelesaikan pemeriksaan atau meneruskan ke pembayaran/rawat inap. Ini usulan titik validasi sementara: menyimpan pendaftaran/draft belum diblokir sampai aturan registrasi dikonfirmasi. Dokter wajib hanya untuk alur medis, bukan otomatis untuk grooming.
7. Validasi ada di tampilan, server action, dan RPC penulisan pemeriksaan, dengan pemeriksaan role/cabang yang mengikuti aturan existing.

### Batch 2 — petugas, racikan, dan status pasien

8. Penugasan multi-cabang dalam satu penyimpanan; validasi seluruh cabang sebelum menulis. Hindari hasil setengah tersimpan.
9. Role dokter/groomer/paramedis berasal dari master karyawan dan memfilter pilihan petugas; pemetaan data jabatan existing perlu diperiksa sebelum migrasi.
10. Satu editor racikan menghubungkan SKU master obat racik dengan komposisi. Nama dan harga jual mengikuti SKU master, komposisi menentukan pengeluaran stok bahan. Tidak ada input penjualan racikan kedua yang menduplikasi item.
11. Pencarian berdasarkan nama; klik item langsung memilih. Daftar pilihan racikan/bahan muncul setelah pengguna mencari. Bahan menampilkan stok/satuan, tanpa harga jual bahan. Invoice hanya memuat nama obat racik, jumlah, dan harga jual master.
12. Periksa ulang semua jalur racikan: sebelum rekam medis tersimpan, penambahan sesudahnya, dan rawat inap. Perubahan tampilan tidak boleh mengubah HPP historis atau memotong stok dua kali.
13. Daftar rekam medis menampilkan masih rawat inap/sudah pulang berdasarkan record rawat inap. Riwayat impor tanpa status tidak disimpulkan otomatis sebagai sudah pulang.

### Batch 3 — rawat inap dan perhitungan keuangan

14. Pertahankan dokter PJ awal, tambahkan dokter visit pada setiap log serta paramedis yang membantu. Pilihan berasal dari karyawan yang berhak di cabang. Dokter PJ dan visit bisa sama atau berbeda.
15. Kondisi/pemantauan wajib diisi; dokter visit wajib pada laporan visit dokter. Field terstruktur lainnya hanya diwajibkan setelah ditentukan pihak klinik. Jangan memaksa paramedis mengisi identitas dokter sebagai identitas dirinya.
16. Tautan petugas harus dapat dipakai untuk insentif. Jangan hapus `pelaksana` sebelum fungsi/relasi existing ditinjau.
17. Satu total insentif per tindakan dibagi ke petugas; bukan menggandakan insentif penuh ke setiap dokter. Pembagian sama rata adalah usulan dalam meeting, belum kebijakan final. Contoh usulan: Rp1.000.000 × 5% = Rp50.000 total; dua dokter masing-masing Rp25.000. Pembulatan tidak boleh menaikkan total.
18. Biaya admin pembayaran dapat dihitung otomatis dan diposting ke akun yang benar. Tarif disebut: kartu kredit 2%, kartu di luar BCA 1%, QRIS 0%. Tarif, dasar hitung pada split, pembulatan, dan akun harus dikonfirmasi sebelum dipakai untuk transaksi.
19. Pisahkan tambahan biaya ke pelanggan dari biaya/MDR yang dipotong bank; keduanya tidak otomatis memakai akun yang sama.

## Keputusan yang masih diperlukan

- Dokter wajib saat registrasi atau saat lanjut pemeriksaan? Request jelas meminta tidak lanjut tanpa dokter, tetapi tahap persisnya ambigu.
- Apakah formula master tetap boleh diubah per pasien, dan berapa jumlah hasil racikan? Harga jual master serta jumlah hasil tidak boleh tercampur dengan jumlah bahan.
- Rawat inap memakai racikan langsung atau stok hasil pekerjaan pesanan? Nisa mengusulkan pekerjaan pesanan di 23:15–24:19; ini perlu disepakati.
- Apakah dokter visit menerima seluruh log atau hanya tindakan pada visit tersebut? Bagaimana paramedis menerima insentif?
- Pembagian insentif rata atau berbobot, per tindakan atau invoice; apa basis setelah diskon/pajak?
- Tambahan admin berlaku pada nominal masing-masing metode atau seluruh tagihan; akun pembukuannya apa?
- Form persetujuan/tanda tangan rawat inap: template, penandatangan, dan kebutuhan integrasi dengan consent existing.

Keputusan ini tidak menghalangi pengerjaan pembayaran manual pada Batch 1. Kebijakan uang yang ambigu tidak di-hardcode.

## Ditunda sesuai meeting

Radius/lokasi absensi; reminder kontrol WhatsApp/CRM; integrasi payment gateway. Form persetujuan rawat inap dipetakan setelah template dan aturan tersedia. Target meeting pukul 15.00 dan follow-up 14.30 adalah konteks historis, bukan deadline baru yang dikonfirmasi.

## Batas pengiriman

- Tidak mengubah invoice, jurnal, stok, atau insentif historis secara massal.
- Tidak menjalankan migrasi di database remote/produksi atau deploy sebelum perubahan dan bukti pengujian tersedia untuk ditinjau.
- Hasil setiap batch: kode dan migrasi yang dapat ditinjau, pengujian relevan, hasil build/typecheck, serta daftar batas verifikasi.
- Baca panduan Next.js yang sesuai di `node_modules/next/dist/docs/` sebelum mengubah kode. Jika paket tidak menyediakan folder tersebut, dokumentasikan ketidaktersediaannya dan gunakan dokumentasi versi yang terpasang.

## Bukti yang wajib lolos untuk Batch 1

- Rp1.000.000 dibayar Rp500.000 Tunai + Rp500.000 Transfer: satu invoice, dua payment, dua debit rekening penerimaan yang tepat, piutang nol, status lunas.
- Bagian pembayaran kurang/lebih, negatif, NaN, metode/rekening tidak aktif, atau cabang lain: ditolak tanpa perubahan database.
- Gagal pada pembayaran kedua: invoice, stok, jurnal, dan pembayaran pertama ikut rollback.
- Request sama dikirim dua kali atau respons hilang: tidak ada invoice, payment, journal, stok, atau poin ganda. Perubahan rincian dengan key sama ditolak.
- Dua kasir memproses pasien yang sama: hanya satu invoice aktif; urutan lock mengikuti visit → invoice.
- Dokter kosong/keluhan spasi pada proses medis ditolak sebelum ada rekam medis, resep, atau stok tersimpan. Grooming tidak diwajibkan memiliki dokter medis.
- Pembayaran satu metode, DP/pelunasan, koreksi, void/reissue, shift, dan struk existing tetap berfungsi.
