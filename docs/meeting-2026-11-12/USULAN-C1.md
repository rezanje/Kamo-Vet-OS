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
