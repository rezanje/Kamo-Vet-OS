# Bukti UAT HRIS Demo

**Tanggal:** 7 September 2026  
**Status keseluruhan:** BLOCKED BY DATA  
**Batas aman:** Tidak ada data Kamo, pengesahan payroll, pembayaran, maupun perubahan pada server yang terhubung.

## Alasan Tertahan

Lingkungan demo lokal tidak dapat dipastikan siap dipakai, sementara target server yang tersedia tidak dikonfirmasi sebagai database demo. Sesuai batas pilot, tidak ada akun atau data uji yang dibuat dan tidak ada pengujian peran yang dijalankan.

## Rencana Akun Demo

| Akun | Cabang | Tujuan | Status |
| --- | --- | --- | --- |
| OWNER Demo | Semua | Pengaturan pusat dan payroll draft | Belum dibuat |
| ADMIN Pandu Demo | Pandu | Kelola staf serta pengajuan Cabang Pandu | Belum dibuat |
| STAFF Pandu Demo | Pandu | Absensi dan pengajuan pribadi | Belum dibuat |
| STAFF Cabang B Demo | Cabang B | Bukti isolasi antar-cabang | Belum dibuat |

## Bukti UAT

| Tanggal | Akun demo | Skenario | Hasil harapan | Hasil aktual | Status |
| --- | --- | --- | --- | --- | --- |
| 7 September 2026 | Belum ada | Seluruh alur staf, admin, dan pemilik | Dijalankan hanya di lingkungan demo terkonfirmasi | Tidak dijalankan; target demo belum tersedia | BLOCKED BY DATA |

## Gerbang Pilot

| Gerbang | Syarat lulus | Status |
| --- | --- | --- |
| Akses | Uji negatif antar-cabang/peran lulus memakai akun demo | Tertahan |
| Data | Data karyawan, shift, komponen gaji, dan aturan insentif Kamo disetujui | Belum dimulai |
| Angka | Parallel run satu periode cocok tanpa pembayaran otomatis | Belum dimulai |

## Lanjutan Saat Database Demo Terkonfirmasi

1. Terapkan pagar akses pada database demo dan jalankan skrip bukti akses.
2. Buat empat akun serta dua cabang data fiktif di atas.
3. Uji staf mengajukan, admin cabang menyetujui, dan pemilik menghitung payroll draft.
4. Catat setiap hasil di tabel bukti ini; jangan mengesahkan atau membayar payroll.
