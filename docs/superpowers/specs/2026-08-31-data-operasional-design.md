# Desain Data Operasional Klinik dan Layanan

**Tanggal:** 31 Agustus 2026
**Status:** Disetujui untuk perencanaan implementasi
**Ruang lingkup:** outcome booking, timestamp layanan, pelaksana, kapasitas, dan referral

## 1. Latar Belakang

Sebagian KPI Operation & Sales belum dapat dihitung jujur karena VetOS belum mencatat outcome no-show, asal walk-in, waktu mulai/selesai layanan, groomer pelaksana, kapasitas boarding, dan referral secara konsisten. Data harus ditangkap pada alur kerja existing, bukan lewat form laporan terpisah.

## 2. Sasaran

1. Membedakan booked, walk-in, hadir, no-show, dan batal.
2. Menghitung waktu tunggu serta durasi layanan.
3. Menghubungkan dokter/groomer ke employee.
4. Menghitung kepatuhan follow-up dan okupansi rawat inap.
5. Mencatat referral masuk/keluar.

## 3. Booking dan Kunjungan

Status workflow booking existing tetap dipakai untuk baru, dikonfirmasi, ditolak, dan batal. Kolom outcome terpisah menyimpan pending, hadir, dan no-show agar keputusan staf tidak tercampur dengan kehadiran pelanggan.

Kunjungan menyimpan sumber `booking` atau `walk_in`. Booking yang diubah menjadi kunjungan otomatis menjadi hadir dan tetap terhubung melalui `visit_id`. No-show hanya dapat ditetapkan pada booking terkonfirmasi yang jadwalnya sudah lewat dan belum mempunyai kunjungan.

## 4. Timestamp Layanan

Kunjungan menyimpan:

- `checked_in_at` saat registrasi selesai;
- `service_started_at` saat pemeriksaan/grooming dimulai;
- `service_finished_at` saat layanan selesai;
- `checked_out_at` saat pembayaran atau penyelesaian kunjungan selesai.

Urutan waktu wajib monoton. Waktu tunggu = mulai − check-in. Durasi layanan = selesai − mulai. Data lama tetap null dan tidak dihitung sebagai nol.

## 5. Pelaksana Layanan

`doctor_id` existing tetap menjadi dokter utama. Relasi pelaksana layanan umum ditambahkan untuk grooming atau layanan non-dokter. Pelaksana harus employee aktif pada cabang tersebut. Bila satu kunjungan memiliki beberapa pelaksana, rincian invoice/layanan memakai assignment existing sebagai sumber revenue per staf; pelaksana utama hanya menjadi fallback operasional.

## 6. Follow-up

Tabel follow-up existing tetap dipakai. Compliance dihitung dari follow-up jatuh tempo pada periode yang berstatus selesai tepat waktu dibanding seluruh follow-up yang jatuh tempo. Follow-up batal dikeluarkan dan follow-up tanpa tanggal tidak masuk denominator.

## 7. Rawat Inap dan Kapasitas

Data masuk/keluar rawat inap existing menjadi sumber occupied bed-days. Kapasitas aktif disimpan per cabang dan dapat berubah dengan tanggal berlaku. Okupansi = occupied bed-days / available bed-days. Tanpa kapasitas, dashboard menampilkan `Kapasitas belum diisi`.

## 8. Referral

Referral menyimpan kunjungan, arah masuk/keluar, fasilitas asal/tujuan, alasan, tanggal, catatan, dan pencatat. Referral keluar dapat ditautkan ke follow-up tanpa mewajibkannya.

## 9. Integrasi UI

- Registrasi menentukan booked atau walk-in otomatis.
- Daftar booking menyediakan tindakan `No-show` setelah jadwal lewat.
- Antrian menyediakan tombol mulai dan selesai layanan.
- Rekam medis/pembayaran memilih pelaksana bila belum terisi.
- Rawat inap memakai kapasitas cabang dari Pengaturan.
- Rekam medis menyediakan panel referral ringkas.

## 10. Keamanan dan Audit

Semua data membawa atau menurunkan `branch_id`, memakai RLS cabang, dan hanya dapat diubah user yang dapat mengakses cabang tersebut. Timestamp dan outcome menyimpan user pengubah serta waktu perubahan pada audit log. Backfill tidak mengarang outcome atau timestamp data lama.

## 11. Kriteria Penerimaan

- Booking dapat berakhir hadir, no-show, ditolak, atau batal tanpa status ambigu.
- Walk-in dan booking dapat dibedakan pada laporan.
- Waktu tunggu/durasi hanya dihitung dari pasangan timestamp valid.
- Revenue per dokter/groomer dapat ditelusuri ke transaksi.
- Follow-up compliance dapat direkonsiliasi ke daftar follow-up.
- Okupansi tidak dihitung tanpa kapasitas.
- Referral masuk/keluar dapat difilter cabang dan periode.
- Data cabang tidak bocor antar-user melalui query atau agregat.
