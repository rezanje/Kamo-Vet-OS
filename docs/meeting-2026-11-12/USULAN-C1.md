# C1 — HRIS: jadwal shift & absensi dengan verifikasi wajah (usulan, 14 Nov 2026)

Target meeting: Desember, paling lambat awal tahun. Butuh perubahan database + pilihan teknologi wajah → **menunggu
keputusan Reza**. Sudah dikerjakan tanpa ubah database: Catat Absensi tidak lagi terkunci di tanggal uji 1 Juli 2026.

## 1. Yang sudah ada (dicek di kode 14 Nov)

- **Jadwal shift — sudah jalan:** master shift (`/hris/shift`: jam masuk/pulang, libur, warna, per cabang), jadwal bulanan
  per cabang (`/hris/jadwal`: grid karyawan × tanggal, klik untuk isi), dipakai payroll untuk hitung telat & bolos dan
  jadwal dokter. Kurang: edit shift, salin minggu/bulan lalu, karyawan belum bisa lihat jadwalnya sendiri.
- **Absensi:**
  - Manual oleh HR/Admin (`/hris/absensi`) — layar di screenshot meeting.
  - **Absen mandiri** di Menu Karyawan (`/me`): tombol Absen Masuk/Pulang + **cek lokasi (geofence)** radius cabang.
- **Verifikasi wajah: belum ada sama sekali** — ubin "Verifikasi wajah" di menu HRIS masih "Fase 2".
- Masalah di absen mandiri: absen masuk dua kali menimpa jam pertama; absen pulang shift malam (lewat tengah malam) tidak
  tercatat; jam diisi dari layar (bisa diakali lewat aplikasi lain); cabang memakai cabang utama karyawan, bukan cabang
  penugasan; laporan absensi menghitung telat dari jam kerja standar perusahaan, sedangkan payroll dari shift → bisa beda.

## 2. Usulan bertahap

**Tahap 1 — Rapikan absen + jadwal (±1 minggu, ada migrasi):**
- Absen masuk/pulang lewat satu fungsi database: jam diambil dari jam server, cek lokasi di server, cek sudah absen, shift
  malam benar, cabang = cabang penugasan; staf tidak bisa lagi menulis jam absen langsung.
- Karyawan melihat "shift hari ini" & jadwal bulannya di Menu Karyawan; telat/pulang cepat dihitung dari shift.
- Laporan absensi memakai shift (sama dengan payroll); hari terjadwal tanpa absen = Alpha.
- Edit shift + salin jadwal minggu/bulan lalu.
- Pengajuan koreksi absen (lupa absen/gagal) → disetujui atasan, tercatat.

**Tahap 2 — Verifikasi wajah (±2 minggu, ada migrasi + layanan wajah):**
- HR mendaftarkan foto wajah acuan per karyawan.
- Saat absen: kamera HP ambil selfie (dengan cek "orang hidup": kedip/geleng) → dicocokkan di server, bukan di HP.
- Foto absen disimpan di penyimpanan privat; skor kecocokan rendah masuk antrean tinjau HR, tidak langsung ditolak.

**Tahap 3 — Sambung ke modul lain** (insentif/penjualan) setelah stabil, sesuai meeting.

## 3. Pilihan teknologi wajah (keputusan Reza)

- **A (saran): layanan wajah pihak ketiga** (mis. AWS Rekognition / Azure Face / penyedia lokal e-KYC) — paling akurat,
  ada cek "orang hidup", bayar per pemakaian (perkiraan kecil: ±puluhan karyawan × 2 absen/hari). Perlu akun & kunci API
  atas nama perusahaan, dan foto wajah karyawan dikirim ke penyedia itu (perlu persetujuan karyawan).
- **B: pencocokan wajah di server sendiri** (pustaka open-source) — tanpa biaya per pemakaian, data tidak keluar, tapi
  akurasi & cek "orang hidup" lebih lemah, dan lebih lama dibangun.
- **C: foto selfie saja tanpa pencocokan otomatis** — absen wajib selfie + lokasi, HR mengecek foto bila ragu. Paling cepat
  (bisa ikut tahap 1), cukup untuk mencegah titip absen kalau rutin dicek.

Usul urutan: tahap 1 + selfie (C) jalan dulu sebelum Desember, lalu naik ke A di tahap 2.

## 4. Implementasi — Tahap 1 + selfie wajib (Reza: A, 14 Nov)

Migrasi `supabase/migrations/20261118640000_c1_absensi_mandiri_selfie.sql` (**belum dipasang**). Detail rancangan,
dampak, rollback, dan cara cek ada di kepala file migrasi.

**Urutan rilis (wajib):** merge + deploy aplikasi dulu → pastikan live → segera `apply_migration`. Kebalikannya berbahaya:
aplikasi lama menulis absen langsung, ditolak database, tapi tetap menampilkan "Clock-in tercatat" (galat tidak dicek).
Selama jeda aplikasi baru tanpa migrasi, absen mandiri menampilkan "sedang diperbarui"; layar HR & laporan tetap jalan.

**Keputusan yang diambil (bisa diubah bila Reza mau lain):**
- Tanggal absen = tanggal **mulai** shift. Absen pulang 06:00 untuk shift 22:00–06:00 menutup baris kemarin. Absen masuk
  dicocokkan ke jadwal kemarin/hari ini/besok yang jendelanya (4 jam sebelum mulai s/d jam pulang) memuat jam sekarang.
- **Tanpa jadwal / jadwal libur: tetap boleh absen**, ditandai "Tanpa jadwal" (layar Absensi & laporan) untuk dicek HR.
- Absen pulang hanya untuk absen masuk ≤ 20 jam lalu; lebih dari itu (lupa pulang) → ajukan koreksi.
- Cabang untuk cek lokasi: cabang milik shift terjadwal → cabang penugasan yang masih berjalan → cabang utama (data lama).
  Lolos bila di dalam radius salah satunya. Cabang tanpa titik koordinat = cek lokasi mati (aturan lama dipertahankan).
- Selfie wajib, dikompres di HP (sisi terpanjang 960 px, JPEG). Disimpan privat di bucket `absensi-foto`
  (`<employee_id>/<tanggal>/<in|out>-<uuid>.jpg`). Yang bisa melihat: OWNER, ADMIN cabang karyawan itu, dan karyawan itu
  sendiri. Foto tidak bisa diubah/dihapus dari aplikasi. Absen yang ditolak (mis. di luar radius) meninggalkan fotonya
  sebagai jejak percobaan.
- HR tetap bisa catat/ubah manual di `/hris/absensi`; baris yang diubah HR bertanda "Manual HR" (bukti foto & waktu asli
  tetap tersimpan, perubahan tercatat di Log Aktifitas). Baris lama sebelum migrasi tercatat "manual".
- Koreksi absen: staf mengajukan dari Menu Karyawan (maks. 31 hari ke belakang, satu pengajuan menunggu per tanggal);
  diputuskan OWNER/ADMIN cabang di HRIS → Pengajuan Karyawan. ADMIN tidak bisa menyetujui koreksinya sendiri (OWNER bisa).
  Disetujui = absen tertulis bersumber "Koreksi" + nama penyetuju.
- Laporan Rekap Absensi: telat/pulang cepat/lembur dari shift masing-masing (sama dengan penggajian), toleransi telat tetap
  dari Pengaturan perusahaan; hari terjadwal tanpa absen & tanpa cuti/izin/sakit disetujui = Alpha (hari ini dihitung
  setelah jam shift selesai). Hadir tanpa jadwal tidak dihitung telat (kolom "Tanpa jadwal").
- Penggajian: hitungan telat kini memakai aturan yang sama — shift 22:00 yang diabsen 00:30 = telat 150 menit (dulu 0).
  Kasus lain tidak berubah.
- Salin jadwal: "Salin dari bulan lalu" mengambil hari yang sama 4 minggu sebelumnya (tgl 29–31: 5 minggu). Bawaan hanya
  mengisi sel kosong; menimpa harus dicentang + dikonfirmasi. Shift yang sudah nonaktif dilewati.
- Edit shift: tombol Ubah di Master Shift. Mengubah jam shift ikut mengubah hitungan telat jadwal lama yang memakainya
  (diberi peringatan di form).

**Siap tahap 2 (pencocokan wajah):** kolom `verifikasi_status` (bawaan `belum`; nilai `cocok`/`tinjau`/`tidak_cocok`
sudah diizinkan) + path foto per absen. Tahap 2 tinggal menambah skor/waktu verifikasi + tabel foto acuan per karyawan.

**Uji:** harness Postgres `scripts/test-c1-absensi-postgres.py` (60/60; `--baseline` 45/45 RED) + vitest
(`absensi-shift`, `absensi-mandiri`, `c1-jadwal-shift-koreksi`, `hris-absensi-c1`, `laporan-gerbang-g2`, `activity-log`).
Belum diuji di HP sungguhan (kamera depan, izin lokasi iOS/Android) — perlu dicoba setelah rilis.

**Pertanyaan terbuka:** (1) Absen ditolak karena di luar radius: perlu antrean "minta izin absen di luar lokasi"?
(saat ini → ajukan koreksi). (2) Toleransi telat laporan memakai Pengaturan perusahaan, potongan gaji memakai Aturan gaji —
disatukan? (3) Cabang yang belum punya titik koordinat = cek lokasi mati; perlu dipastikan semua cabang sudah diisi.
