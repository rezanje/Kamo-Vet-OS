# Verifikasi Alur Klinik Demo 12 Oktober 2026

Data dan aturan perusahaan tidak menjadi penghalang pengujian karena pengguna menegaskan aplikasi masih demo/percobaan. Konfigurasi baru memakai label DEMO; riwayat lama tidak direset pada pengujian ini.

## Master yang tersedia di aplikasi demo

- Dua racikan resmi DEMO A/B, terhubung ke SKU Obat Racik DEMO A/B seharga Rp25.000/Rp35.000. Instruksi secara eksplisit menyebut simulasi, bukan resep untuk pasien nyata.
- Dua bahan: DEMO Bahan A (gram, biaya contoh Rp1.000/unit) dan DEMO Bahan B (ml, Rp500/unit).
- DEMO Obat Satuan (biaya Rp5.000, harga jual Rp15.000) serta DEMO Pemeriksaan Klinik (jasa Rp50.000).
- Dua dokter, satu paramedis dan satu groomer DEMO. Cabang utama Cimanggu dan tambahan Panduraya untuk masing-masing staf.
- Stok awal 100 unit per bahan/obat pada kedua gudang klinik, melalui penyesuaian aplikasi. Setiap penyesuaian menghasilkan jurnal seimbang Rp650.000.

Pendaftaran mengikuti shift OWNER yang sudah terbuka di Panduraya; shift tersebut tidak diganti atau ditutup. Template persetujuan simulasi memakai fitur consent umum existing dan bukan penutupan fitur persetujuan khusus rawat inap MEET-09.

## Hasil simulasi di aplikasi demo

Pendaftaran → panggil pasien → pemeriksaan dengan racikan A/obat/jasa → masuk rawat inap → visit dokter berbeda dan paramedis dengan racikan B → tanda tangan consent contoh → kondisi sembuh → pembayaran campuran → pulang.

| Pemeriksaan | Hasil |
| --- | --- |
| Invoice | INV-202610-0003, satu invoice aktif, Lunas, total Rp125.000 |
| Pembayaran | Tunai Rp62.500 + Transfer Rp62.500; dua receipt |
| HPP | Racikan A Rp4.000, racikan B Rp7.000, obat Rp5.000; total Rp16.000 |
| Jurnal invoice | Empat jurnal; setiap jurnal memiliki debit dan kredit seimbang |
| Stok akhir Panduraya | Bahan A 93 gram, Bahan B 92 ml, obat 99 pcs |
| Staf rawat inap | PJ awal dokter A tetap; log visit dokter B dan paramedis tersimpan |
| Status pasien | Kunjungan Selesai, rawat inap sembuh, waktu pulang tercatat |
| Ketahanan pembayaran | Kurang Rp1 menonaktifkan checkout; bagian pembayaran pulih setelah reload |
| Retry | Payload server action checkout yang sama dikirim ulang, HTTP 200; tetap satu invoice, dua receipt, empat jurnal dan stok yang sama |

Ini verifikasi satu skenario DEMO, bukan klaim bahwa seluruh skenario operasional atau integrasi eksternal sudah diuji. Radius absensi, WA/CRM, gateway, pembagian insentif dan biaya admin otomatis tetap di luar batch ini. Tidak ada pesan WhatsApp/email yang dikirim.

## Perbaikan yang ditemukan saat simulasi

Sesi PostgREST valid mengirim identitas dalam `request.jwt.claims`, tetapi `clinic_issue_official_compound` masih mewajibkan GUC lama `request.jwt.claim.role`. Akibatnya pemeriksaan dengan racikan resmi ditolak sebagai tidak terautentikasi dan seluruh transaksi dibatalkan.

Migrasi `20261012090000_official_compound_claims_auth.sql` mengganti hanya pembaca role tersebut dengan `auth.role()`. Body transaksi, pemeriksaan user/cabang, owner, ACL, SECURITY DEFINER dan search path tetap. Migrasi berhenti jika pola guard tidak dikenali dan aman diterapkan ulang. Migrasi diterapkan ke database demo serta dicatat pada migration history; tidak membutuhkan deployment frontend.

## Bukti verifikasi perubahan

- Regresi PostgreSQL gagal sebelum perbaikan tepat pada guard fungsi racikan resmi; lulus setelah perbaikan.
- Database PostgreSQL 16 sementara menerapkan 188 migrasi repo dengan auth/storage shims. Tiga suite katalog/SKU/jabatan lulus dengan FIFO dan trigger prescription nyata; ini bukan verifikasi provisioning Supabase penuh.
- Regresi mencakup JWT dengan kedua GUC lama kosong, nested/direct official issue, harga master dan retry; klaim anon, service-role dan authenticated tanpa sub ditolak tanpa efek.
- Review kode independen: tidak ada temuan yang perlu diperbaiki. Owner/ACL/security/search path serta penerapan ulang juga dibandingkan dalam transaksi penerapan database demo dan tetap sama. Simulasi UI setelah perbaikan membuktikan jalur OWNER.
- Tes aplikasi lengkap: 199 berkas / 1.690 tes lulus. TypeScript dan production build lulus. Tes browser lokal pembayaran dan rawat inap/draft juga lulus.
- Instalasi dependency sesuai lockfile melengkapi jsdom yang belum tersedia pada workspace awal; tidak ada perubahan dependency atau lockfile.

Manifest ID master/dokumen, CSV contoh dan readback database disimpan pada paket lokal `docs/feedback/2026-10-12/`. Perubahan ini tidak mengoreksi empat saldo negatif lama, dua HPP POS lama atau nota Snowy historis.
