# HRIS Kamo — status dan panduan user

Diperiksa 5 Oktober 2026, sekitar 10.49–10.51 WIB.

## Kesimpulan

HRIS dasar tersedia di https://kamo-vet-os.vercel.app/hris. Paket pembaruan hasil meeting sudah dikerjakan dan diuji dengan data fiktif, tetapi belum dirilis ke produksi. Jangan menyampaikan semua pembaruan sebagai sudah bisa dicoba lewat link produksi.

Paket baru menunggu penerapan perubahan database, pemeriksaan kecocokan dengan database tujuan, penggabungan kode dan verifikasi setelah rilis. Tidak ada rilis atau perubahan data bisnis dilakukan dalam pengecekan ini.

## Arti status

- **Tampil di produksi:** halaman/control dibaca langsung pada akun demo OWNER. Ini bukan bukti semua aksi simpan/hitung sudah diuji hari ini.
- **Ada di versi produksi:** sumber rilis menunjukkan alur dasar; belum diuji ulang lengkap lewat browser pada pengecekan ini.
- **Selesai diuji, menunggu rilis:** tersedia dalam paket HRIS terpisah; uji menggunakan lingkungan fiktif, bukan data gaji Kamo.
- **Belum termasuk:** membutuhkan pekerjaan/aturan tambahan atau memang ditunda.

## Status masing-masing pembaruan

| Kebutuhan | Status sekarang | Batas dan langkah berikutnya |
|---|---|---|
| Daftar dan profil dasar karyawan | Tampil di produksi | Nama, jabatan, status, tautan Profil/Edit dan unggah Excel terlihat. Kelengkapan data tiap orang perlu dicek HR. |
| Unggah karyawan dari Excel | Tampil di produksi | Tombol Unggah Excel aktif tersedia. Uji ini tidak melakukan unggahan; fitur bukan pembuat akun login atau pengisi gaji otomatis. |
| Penugasan lintas cabang | Tampil di produksi | Form penugasan tersedia; cakupan dan tanggal penempatan tiap orang harus dilengkapi. |
| Tab kehadiran dan riwayat gaji dalam profil | Selesai diuji, menunggu rilis | Tambahan navigasi/akses dalam paket HRIS baru. |
| Master shift dan jadwal bulanan | Tampil di produksi untuk jadwal; master tersedia lewat menu | Cabang default B2C belum punya shift aktif saat pengecekan. Itu tidak berarti semua cabang kosong. |
| Jadwal mingguan, nama/jam shift lebih terbaca | Selesai diuji, menunggu rilis | Produksi masih menampilkan bulan. |
| Impor/ekspor Excel jadwal + pemeriksaan sebelum simpan | Selesai diuji, menunggu rilis | Uji data fiktif mencakup ekspor/impor dan pembatasan cabang; jangan tertukar dengan impor karyawan yang sudah live. |
| Penyimpanan jadwal tanpa perubahan separuh | Selesai diuji, menunggu rilis | Paket baru juga menolak jadwal yang telah diubah pengguna lain. |
| Absensi dasar masuk/pulang dan lokasi | Ada di versi produksi; halaman pengelola terlihat | Uji hari ini hanya membaca, tidak mencatat kehadiran atau mengirim GPS. |
| Absensi shift lintas tengah malam | Selesai diuji, menunggu rilis | Sesi masuk/pulang dikaitkan secara benar meskipun berganti tanggal. |
| Koreksi absensi dengan alasan dan jejak perubahan | Selesai diuji, menunggu rilis | Menjaga riwayat dan menolak koreksi sumber gaji yang sudah final. |
| Pengajuan perubahan jadwal dan persetujuan otomatis | Selesai diuji, menunggu rilis | Jadwal efektif diperbarui saat disetujui. |
| Tukar shift dua karyawan | Selesai diuji, menunggu rilis | Persetujuan rekan dahulu, kemudian HR; kedua jadwal berubah bersama. Implementasi dibatasi cabang penugasan yang sama. |
| Rekap harian/bulanan dan ekspor baru | Selesai diuji, menunggu rilis | Mencakup sumber jadwal, terlambat, waktu kerja, izin/cuti, lembur dan penanda anomali. |
| Cuti/lembur/kasbon/reimburse dasar | Ada di versi produksi | Menu tersedia; alur persetujuan dan pengamanan baru masih dalam paket rilis. |
| Hitung gaji dan slip dasar | Tampil di produksi | Halaman memberi peringatan aturan telat/bolos/lembur masih nol; belum ada periode penggajian diproses. Tidak diklik Hitung. |
| Aturan gaji menurut kelompok dan tanggal berlaku | Selesai diuji, menunggu rilis | Memakai aturan yang sudah ada; tidak otomatis menerapkan semua tarif contoh meeting. |
| Rincian sumber gaji, histori tetap, pengesahan tanpa duplikasi | Selesai diuji, menunggu rilis | Uji fiktif mencakup slip, kasbon, reimburse dan jurnal; belum validasi angka karyawan Kamo. |
| Komisi yang sebelumnya tersedia | Ada di versi produksi | Paket baru memperkuat sumber/rinciannya; tidak membangun ulang seluruh komisi. |
| Komisi baru berdasarkan kelompok, katalog dan beberapa penerima | Belum termasuk lengkap | Daftar insentif dan cara membagi komisi belum final; aturan baru tidak boleh ditebak. |
| Uang duduk dokter sesuai skenario meeting | Belum termasuk lengkap | Dasar jam nyata/per shift/per hari dan pengecualian perlu disepakati. |
| Kasbon Rp700.000 dan lunas tiap bulan | Belum diterapkan sebagai kebijakan baru | Pekerjaan cloud mempertahankan aturan cicilan yang sudah ada; utang lama tidak diubah otomatis. |
| Tarif/plafon baru lembur dan potongan telat | Belum diaktifkan sebagai kebijakan meeting | Pengaturan kelompok disiapkan, tetapi angka/cakupan/pembulatan baru belum ditetapkan. |
| Pembagian beban biaya klinik/franchise | Belum termasuk | Perlu rancangan dan aturan pembagian tersendiri. |
| Pelacakan lokasi berkelanjutan | Ditunda | Berbeda dari cek lokasi saat absensi. |
| Hubungan HRIS dengan Quest | Belum ditetapkan | Perlu pembahasan terpisah. |

## Panduan pengecekan produksi sekarang — sekitar 10–15 menit

Gunakan akun yang diberikan admin sesuai kewenangan. Akun demo tersedia pada halaman login untuk peninjauan; jangan membagikan akses OWNER ke semua staf. Link produksi memuat data yang sedang dipakai, sehingga pengecekan berikut dilakukan dengan melihat saja.

1. **Masuk dan pilih HRIS.** Buka https://kamo-vet-os.vercel.app/login lalu https://kamo-vet-os.vercel.app/hris. Hasil yang diharapkan: pilihan Karyawan, Absensi, Jadwal, Slip Gaji, pengajuan dan master shift terlihat sesuai hak akses.
2. **Cek karyawan.** Buka https://kamo-vet-os.vercel.app/hris/karyawan. Klik Profil pada orang yang berhak diperiksa. Cek nama, jabatan, status dan cabang; catat data kosong atau duplikat untuk HR. Jangan mengubah nominal gaji untuk eksperimen.
3. **Cek jalur impor karyawan.** Dari daftar, klik Unggah Excel. Periksa instruksi/template yang tersedia. Tidak perlu mengunggah data percobaan ke produksi. Ini impor karyawan, bukan jadwal.
4. **Cek shift.** Buka https://kamo-vet-os.vercel.app/hris/shift. Tinjau shift, jam dan cabang yang sudah dikonfigurasi. Belum ada shift untuk suatu cabang berarti konfigurasi cabang itu perlu dilengkapi sebelum penyusunan jadwal.
5. **Cek jadwal.** Buka https://kamo-vet-os.vercel.app/hris/jadwal. Pilih cabang tujuan dan bulan yang ingin dilihat, lalu Tampilkan. Produksi masih versi bulanan. Saat pengecekan, pilihan default B2C menampilkan belum ada shift aktif; pilih cabang operasional yang relevan sebelum menyimpulkan kosong.
6. **Cek absensi.** Buka https://kamo-vet-os.vercel.app/hris/absensi. Pastikan tanggal filter sesuai hari yang dicari lalu gunakan Terapkan. Saat pengecekan, tanggal awal masih 1 Juli 2026 meskipun hari ini 5 Oktober; jangan menganggap itu data hari ini. Cek masuk/pulang/status dari catatan yang sudah ada. Jangan tekan Simpan Absensi untuk percobaan.
7. **Tinjau pengajuan.** Buka https://kamo-vet-os.vercel.app/hris/pengajuan. Lihat lembur, kasbon dan reimburse yang tersedia sesuai kewenangan. Persetujuan/penolakan adalah tindakan bisnis, bukan tombol coba.
8. **Tinjau gaji.** Buka https://kamo-vet-os.vercel.app/hris/penggajian. Pilih periode dan Tampilkan. Peringatan aturan nol berarti telat/bolos/lembur belum memengaruhi perhitungan. Saat diperiksa, belum ada periode diproses. Jangan klik Hitung/Sahkan untuk eksperimen pada produksi.
9. **Lihat pengalaman staf.** Menu pribadi berada di https://kamo-vet-os.vercel.app/me; gunakan akun staf sendiri, bukan OWNER untuk menguji identitas staf. Pengaitan akun-karyawan dan lokasi perlu benar sebelum uji absensi nyata.

Langkah 1, 2, 5, 6 dan 8 dibaca langsung pada browser produksi dalam pemeriksaan ini. Langkah lain menggunakan menu dan sumber rilis yang tersedia; uji simpan/approval/absensi GPS tidak dilakukan. Tampilan yang belum dirilis tidak dijanjikan tersedia lewat link ini.

## Panduan uji setelah paket baru dirilis

Bagian ini belum bisa dijalankan lengkap di produksi saat ini. Gunakan data fiktif yang disepakati dalam lingkungan uji terpisah.

- HR membuka satu minggu; nama shift, jam, cabang dan libur terbaca jelas.
- Ekspor jadwal, impor kembali tanpa menggandakan; perubahan tidak valid/cabang salah ditolak pada pemeriksaan.
- Staf absen 20.00 lalu pulang 08.00 esok hari: tetap satu sesi yang benar.
- Staf meminta perubahan dari 07.00 menjadi 08.00; HR menyetujui; masuk 08.00 tidak dianggap terlambat terhadap jadwal lama.
- Dua staf menyetujui pertukaran, lalu HR menyetujui; kedua jadwal berubah bersama.
- HR mengoreksi catatan dengan alasan; riwayat perubahan terlihat dan rekap ikut berubah.
- OWNER menghitung gaji fiktif, membuka sumber angka, membandingkan manual, lalu mengesahkan pada lingkungan uji. Percobaan ulang tidak menggandakan pembayaran/potongan/jurnal.
- Staf melihat hanya data sendiri; pengelola cabang tidak dapat membuka data sensitif cabang lain.

## Cara mengirim hasil pengecekan

Catat: nama fitur, akun/peran, cabang, periode/tanggal, langkah yang dilakukan, hasil yang diharapkan, hasil yang muncul, serta tangkapan layar tanpa data sensitif yang tidak diperlukan. Angka gaji untuk validasi dibahas hanya dengan pihak yang berwenang.

## Bukti dan batas audit

- Paket HRIS: https://github.com/rezanje/Kamo-Vet-OS/pull/18 — OPEN dan draft pada 5 Oktober, head24c0d03. Berhasil dibangun sebagai preview bukan bukti rilis produksi.
- Status terbaru main: https://github.com/rezanje/Kamo-Vet-OS/blob/main/docs/VETOS-2026-10-04-STATUS.md.
- Catatan uji HRIS: https://github.com/rezanje/Kamo-Vet-OS/blob/codex/hris-meeting-followup/docs/reports/2026-10-04-hris-local-acceptance.md.
- Uji tercatat: 1.331 pengujian aplikasi dan rangkaian uji data/akses/bentrok, serta browser dengan layanan login/API nyata lokal. Hasil ini dibaca dari bukti pekerjaan cloud, tidak dijalankan ulang hari ini.
- Deployment Production terbaru di GitHub:6844961569, commitcd565b7, success4 Oktober18:30 UTC atau5 Oktober01:30 WIB. Alias produksi dibuka langsung dan login akun demo berhasil.
- Hanya membaca produksi; tidak membuat karyawan, jadwal, absensi, pengajuan, hitungan gaji, pengesahan, migrasi, atau pembayaran.
