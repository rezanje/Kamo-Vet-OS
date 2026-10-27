# Runbook cutover KAMO: Accurate → VetOS (28 Oktober – 1 November 2026)

Checklist: **M02** (dengan dependensi M03, M04, M05, M01). Dokumen ini urutan kerja, bukan bukti pelaksanaan.
Setiap langkah dicentang dengan nama pelaksana, jam, dan total kontrol yang dicatat di lembar kontrol (bagian 7).

## 0. Keputusan yang dipakai runbook ini

| Topik | Keputusan | Alasan |
|---|---|---|
| Stok final | Persediaan awal diposting **sekali**, 31 Okt malam, setelah Accurate ditutup | Posting persediaan awal terkunci setelah diposting (migrasi `20261021123000`); koreksi sesudahnya hanya lewat stok opname |
| Utang/piutang | Diimpor **per faktur** (M05), bukan total per akun | Pembayaran Desember dst. harus bisa dicocokkan ke faktur lama |
| Saldo akun lain | Lewat Buku Besar › Saldo Awal, **kecuali** persediaan, utang usaha, piutang usaha, kas/bank | Masing-masing punya jalur sendiri; saldo global persediaan diblokir sistem setelah bridge persediaan dipakai |
| Tanggal saldo | **31 Oktober 2026** untuk semua saldo pembuka | Transaksi VetOS mulai 1 November |
| Rekam medis | Batch awal 28 Okt, delta 28–31 Okt diimpor terpisah dan **ditambahkan**, tidak menimpa | Impor rekam medis hanya menambah; baris dengan kunci sumber sama dilewati sehingga aman diulang |
| Jalur impor | Upload normal lewat aplikasi; impor langsung ke database hanya fallback dengan persetujuan pemilik | Jejak audit dan validasi aplikasi tetap berlaku |

## 1. Peran

| Peran | Tugas |
|---|---|
| Koordinator cutover (KAMO) | Memutuskan go/no-go, menandatangani lembar kontrol |
| Finance KAMO | Export Accurate, total kontrol, review & posting saldo (akun OWNER) |
| Admin klinik tiap cabang | Rekam medis batch awal + delta, cek sampel pasien |
| Tim VetOS (Gentanala) | Mendampingi impor, membaca error, memperbaiki bila ada blocker; tidak memposting atas nama klien |

Posting persediaan awal, saldo awal, dan saldo utang/piutang memerlukan akun **OWNER aktif**.

## 2. Prasyarat (paling lambat 28 Okt pagi)

- [ ] Semua rilis gelombang 1 sudah live di Production: K03 (PR264), M05 (impor saldo utang/piutang per faktur) beserta paket migrasinya.
- [ ] **Data uji coba di Production sudah dipastikan.** Selama fase develop, Production berisi akun dan transaksi uji. Sebelum saldo pembuka diposting, koordinator dan tim VetOS harus menyepakati: transaksi uji mana yang ada, apakah dibatalkan lewat fitur aplikasi, dan bahwa laporan Oktober tidak tercampur. **Tidak ada reset/hapus data tanpa persetujuan tertulis pemilik.**
- [ ] Master cabang, gudang, pengguna/peran, rekening kas-bank, bagan akun sudah final.
- [ ] Master pemasok dan pelanggan B2B lengkap, karena impor utang/piutang **menolak** pihak yang belum ada di master (tidak membuat pihak otomatis).
- [ ] Master barang (SKU) lengkap dengan Jenis Barang (INV/SVC/NON/GROUP), satuan dan konversi. Impor stok menolak file tanpa jenis barang.
- [ ] Folder bersama dibuat: `01-batch-awal-rekam-medis`, `02-delta-28-31-okt`, `03-export-accurate-31-okt`, `04-bukti-posting`.

## 3. Rabu 28 Oktober: batch awal rekam medis

1. Admin klinik export rekam medis dari sistem lama sampai tanggal batch, simpan di `01-batch-awal-rekam-medis`.
2. Klinik › Impor rekam medis: upload per cabang. Batas 5 MB per file, 30 MB per batch; pecah file bila lebih.
3. Baca pratinjau:
   - Pemilik/hewan yang cocok otomatis ditampilkan dengan referensi tetap.
   - **Nomor HP sama tetapi nama pemilik berbeda** dan **nama hewan kembar pada pemilik yang sama** wajib dipilih manual atau dilewati. Aplikasi tidak menebak.
4. Simpan. Catat di lembar kontrol: jumlah baris file, jumlah kunjungan masuk, jumlah dilewati beserta alasannya.
5. Cek sampel minimal 5 pasien per cabang, termasuk 1 pasien yang pernah berobat di dua cabang. Riwayat harus utuh dan tertaut ke pemilik yang benar.

Kalau impor gagal di tengah, ulangi file yang sama. Baris yang sudah masuk dilewati, tidak dobel.

## 4. 28–31 Oktober: operasional tetap di Accurate, delta dikumpulkan

- Kunjungan baru setelah batch awal dicatat seperti biasa di sistem lama, lalu export delta disimpan di `02-delta-28-31-okt`, **terpisah** dari batch awal.
- Jangan input transaksi riil di VetOS sebelum 1 November.
- Finance menyiapkan template impor saldo utang/piutang per faktur dari export Accurate, lalu uji pratinjau tanpa posting untuk menemukan pihak yang belum ada di master.

## 5. Jumat 31 Oktober: tutup Accurate dan posting saldo pembuka

Urutan wajib. Jangan lanjut ke langkah berikut sebelum total kontrol langkah sebelumnya cocok.

1. **Freeze.** Setelah jam tutup operasional, tidak ada transaksi baru di Accurate. Catat jam freeze.
2. **Export dari Accurate per 31 Okt** ke `03-export-accurate-31-okt`:
   - Neraca per 31 Okt (total per akun).
   - Nilai & qty persediaan per gudang/cabang.
   - Daftar faktur utang belum lunas per pemasok, dan daftar faktur piutang belum lunas per pelanggan.
   - Saldo tiap rekening kas/bank.
3. **Delta rekam medis** 28–31 Okt diimpor, seperti langkah 3. Cek bahwa pasien batch awal yang datang lagi punya riwayat lama dan baru.
4. **Persediaan awal**:
   - Persediaan › Impor Barang: upload saldo stok, isi tanggal 31 Okt.
   - Klik "Lanjutkan review / bukti posting batch" (halaman Persediaan Awal): review lalu posting oleh OWNER, termasuk akun ekuitas dan alasannya.
   - Total kontrol: qty dan nilai per gudang **sama dengan** laporan persediaan Accurate. Kalau ada selisih pembulatan sen, finance memutuskan sebelum posting; sistem menolak nilai yang tidak tepat dua desimal.
   - **Posting ini hanya sekali.** Setelah diposting, dasar stok terkunci dan koreksi hanya lewat stok opname.
5. **Saldo utang & piutang per faktur** (M05):
   - Keuangan › Saldo Awal Faktur: upload, cek pratinjau (pihak, nomor faktur ganda, total), lalu posting oleh OWNER.
   - Total kontrol: total per pihak dan total keseluruhan **sama dengan** daftar Accurate, dan sama dengan saldo akun utang usaha/piutang usaha di neraca Accurate.
   - Jangan isi utang usaha atau piutang usaha di Buku Besar › Saldo Awal; sistem menolak supaya tidak dobel.
6. **Saldo kas & bank**: Kas & Bank › Daftar Rekening › buka rekening › Saldo Awal, per rekening, tanggal 31 Okt. Total kontrol per rekening.
7. **Saldo akun lain** (aset tetap, utang lain, ekuitas, dll.): Buku Besar › Saldo Awal.
8. **Rekonsiliasi akhir**: Neraca VetOS per 31 Okt dibandingkan neraca Accurate per 31 Okt, akun per akun. Selisih wajib nol atau dijelaskan tertulis. Simpan screenshot/export di `04-bukti-posting`.

## 6. Sabtu 1 November: mulai operasional

- [ ] Go/no-go oleh koordinator berdasarkan lembar kontrol.
- [ ] Sampel transaksi pertama tiap cabang: 1 penjualan kasir, 1 kunjungan klinik sampai bayar, 1 pembayaran ke faktur utang lama. Pembayaran harus mengurangi sisa faktur lama yang tepat.
- [ ] Tim VetOS siaga selama jam operasional hari pertama.
- [ ] Accurate tetap bisa dibaca (read-only) minimal sampai tutup buku November selesai.

## 7. Lembar kontrol (isi saat pelaksanaan)

| Langkah | Angka Accurate | Angka VetOS | Selisih | Pelaksana / jam |
|---|---|---|---|---|
| Rekam medis batch awal: baris / masuk / dilewati | | | | |
| Rekam medis delta: baris / masuk / dilewati | | | | |
| Persediaan: qty per gudang | | | | |
| Persediaan: nilai per gudang | | | | |
| Utang: jumlah faktur / total | | | | |
| Piutang: jumlah faktur / total | | | | |
| Kas & bank per rekening | | | | |
| Neraca: total aset / kewajiban / ekuitas | | | | |

## 8. Kalau ada masalah

| Masalah | Tindakan |
|---|---|
| Impor rekam medis berhenti di tengah | Upload ulang file yang sama; baris yang sudah masuk dilewati |
| Pratinjau stok/faktur menolak baris | Perbaiki file sumber (jenis barang, pihak, nomor ganda, desimal), **bukan** dipaksa; upload ulang |
| Total kontrol tidak cocok sebelum posting | Jangan posting. Finance cek export Accurate; tunda langkah berikut |
| Persediaan awal ternyata salah setelah posting | Tidak bisa diposting ulang; koreksi lewat stok opname per gudang dengan alasan tercatat |
| Faktur utang/piutang salah setelah posting | Batalkan faktur tersebut lewat alur koreksi berwenang (OWNER), lalu impor ulang barisnya. Jejak pembatalan tersimpan |
| Blocker teknis tanpa solusi di hari H | Koordinator memutuskan geser go-live 1 hari; Accurate tetap dipakai, delta ikut bertambah |

Impor langsung ke database (fallback) hanya dengan persetujuan tertulis pemilik, dijalankan tim VetOS, dan hasilnya tetap
direkonsiliasi dengan lembar kontrol yang sama.
