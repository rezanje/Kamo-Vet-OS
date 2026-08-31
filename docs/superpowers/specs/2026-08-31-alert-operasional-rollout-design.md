# Desain Alert Operasional dan Rollout

**Tanggal:** 31 Agustus 2026
**Status:** Disetujui untuk perencanaan implementasi
**Ruang lingkup:** aturan alert in-app, konfigurasi ambang, rekonsiliasi, dan rollout produksi

## 1. Latar Belakang

Client meminta exception/alert untuk sales, stok, expiry, diskon, void, no-show, dan produktivitas. Fase awal harus membantu owner menemukan masalah tanpa menambah kanal notifikasi, job scheduler, atau histori event yang belum dibutuhkan.

## 2. Sasaran

1. Menampilkan alert merah/kuning pada dashboard Operation & Sales.
2. Membuat ambang dapat dikonfigurasi per perusahaan atau cabang.
3. Menyediakan drill-down ke data sumber.
4. Menjaga alert reproducible dan tidak menampilkan false zero.
5. Melakukan rollout bertahap dengan rekonsiliasi stok serta laporan.

## 3. Arsitektur Alert

`operational_alert_settings` menyimpan key aturan, scope cabang opsional, nilai ambang, periode evaluasi, status aktif, severity, pembuat, dan waktu perubahan. Pengaturan cabang mengalahkan pengaturan perusahaan.

Alert dihitung saat dashboard dimuat oleh fungsi metric server yang sama dengan KPI. Fase awal tidak menyimpan event, acknowledgement, atau mengirim WhatsApp/email. Ini menghindari duplikasi state dan alert basi.

## 4. Aturan Bawaan

Aturan langsung aktif karena ambangnya sudah diberikan client:

- sales achievement di bawah 80% target: merah;
- selisih nilai stock opname di atas Rp500.000: merah;
- stok kedaluwarsa atau kedaluwarsa dalam 30 hari: merah;
- sales turun lebih dari 10% terhadap periode pembanding: kuning;
- stok negatif: merah.

Aturan berikut tersedia tetapi nonaktif sampai admin mengisi ambang:

- diskon manual melewati batas;
- jumlah/nilai void melewati batas normal;
- fast-moving kosong;
- tingkat no-show melewati batas;
- produktivitas dokter/groomer di bawah target.

## 5. Definisi dan Drill-down

- Sales memakai definisi dashboard dan target aktif.
- Selisih stok memakai hasil stock opname terakhir yang sudah diselesaikan dan HPP layer pada tanggal penilaian.
- Expiry memakai `stock_layers` dengan qty tersisa positif.
- Diskon hanya menghitung diskon manual; promo, poin, voucher, dan diskon golongan tetap terpisah.
- Void menghitung transaksi yang punya audit void pada periode.
- Fast-moving mengikuti definisi dashboard 90 hari dan stok tersedia cabang.
- No-show memakai booking terkonfirmasi yang jadwalnya sudah lewat.
- Produktivitas memakai revenue atau jumlah layanan per jam/shift sesuai basis target yang dipilih admin.

Setiap alert membawa label cabang, nilai aktual, ambang, periode, severity, dan URL detail.

## 6. Hak Akses

OWNER/ADMIN dapat mengubah pengaturan. User lain hanya membaca alert cabang yang dapat diakses. RLS dan query agregat wajib memakai scope cabang; agregat semua cabang hanya tersedia bagi user yang memang memiliki akses semua cabang.

## 7. Rollout

### Tahap 1 — Data readiness

Lengkapi lima export master, file saldo awal, rincian Grup, target penjualan, kapasitas boarding, dan link employee.

### Tahap 2 — Pilot migrasi

Jalankan preview dan saldo awal pada satu gudang/cabang. Rekonsiliasi qty, nilai stok, FIFO layer, dan kartu stok sebelum cabang lain diposting.

### Tahap 3 — Dashboard preview

Dashboard dibuka untuk OWNER/ADMIN. Setiap KPI yang punya laporan existing dibandingkan dengan laporan detail pada periode dan cabang sama.

### Tahap 4 — Data operasional

Aktifkan outcome booking, timestamp, pelaksana, kapasitas, dan referral. KPI baru tetap berstatus belum tersedia untuk histori lama.

### Tahap 5 — Alert dan production

Aktifkan aturan bawaan, isi ambang lokal, lakukan smoke test, lalu buka dashboard sesuai role.

## 8. Kriteria Go/No-Go

Go hanya jika:

- master hasil import cocok dengan jumlah preview;
- qty dan nilai saldo awal cocok per barang/gudang;
- `stock`, layer FIFO, dan kartu stok saling cocok;
- KPI dashboard cocok dengan laporan sumber;
- alert dapat direproduksi dari data detail;
- RLS cabang lulus pengujian positif dan negatif;
- tidak ada transaksi void/batal yang masuk angka aktif.

Jika gagal, dashboard baru dapat ditarik lewat rollback kode. Saldo awal yang sudah diposting tidak dihapus; koreksi memakai Penyesuaian Persediaan dengan referensi batch.

## 9. Kriteria Penerimaan

- OWNER/ADMIN dapat mengatur ambang perusahaan/cabang.
- Alert merah/kuning tampil dengan aktual, ambang, dan periode.
- Klik alert membuka detail terfilter.
- Aturan tanpa ambang tidak menghasilkan alert.
- Data belum tersedia tidak dianggap normal atau nol.
- Pilot wajib selesai dan direkonsiliasi sebelum rollout multi-cabang.
