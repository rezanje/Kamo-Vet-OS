# VetOS OPEN — status kerja dan batas review

Tanggal audit: 25 September 2026. Sumber: tab `Report` (14 entri OPEN) dan repo `rezanje/Kamo-Vet-OS`, `main` pada `f860e92`. Spreadsheet hanya dibaca; branch review tidak mengubah data produksi.

| Entri | Temuan terverifikasi | Status pada branch review / berikutnya |
| --- | --- | --- |
| BUG-01 | Obat klinik dipotong setelah invoice tersimpan; jalur racikan memakai titik potong berbeda. | **PR #6 draft, belum merge/deploy.** RPC CREATE atomik tersedia; edit/void dan uji dua sesi masih gate rilis. |
| BUG-02 | Perbandingan waktu booking dulu menyebut semua waktu lampau “tanggal lewat”. | **Selesai di main** melalui PR #5; status jam lewat hari ini dan tanggal lampau dibedakan. |
| BUG-03 | `tarikTransaksi` sudah mengambil invoice klinik non-void; error query harus gagal tertutup agar laporan parsial tidak tampak sah. | **Selesai di main** melalui PR #5; tes agregasi dan error query tersedia. Verifikasi baca data autentik belum dilakukan. |
| BUG-04 | Faktur dari PO dulu kehilangan satuan dan menggabungkan baris SKU yang sama. | **Merged di main** melalui PR #7; baris faktur tersambung ke baris PO dan menyimpan satuan/faktor, faktur dan jurnal lewat RPC atomik. Vercel success; uji database penuh masih perlu. |
| BUG-05 | Ada tombol tunggu submit dan beberapa status draft/unpaid, tetapi error simpan lintas modul tidak mempunyai draft/retry idempotent tunggal. | **Audit saja.** Tentukan jenis transaksi, siapa dapat melanjutkan, masa simpan draft, cara deduplikasi posting, dan apa yang dianggap pending. |
| BUG-06 | Ada 19 halaman laporan spesifik di bawah `/laporan` ditambah indeks; pencarian kode tidak menemukan tombol CSV/Excel/PDF pada halaman itu. | **Audit saja.** Petakan bentuk tabular versus grafik untuk tiap halaman, hak akses, filter, batas baris, dan format PDF sebelum ekspor menyeluruh. |
| BUG-07 | Menu `/aset-tetap` dan `/keuangan/aset` sudah ada; action lama menulis aset lebih dulu lalu jurnal best-effort. | **Merged di main** melalui PR #8; pembelian aset kas/bank dan jurnal atomik. Integrasi aset sebagai baris faktur pembelian langsung tetap tahap terpisah; status Vercel commit merge perlu diverifikasi. |
| BUG-08 | Menu `Jurnal Berulang`, hari 1–28, aktif/nonaktif, dan proses catch-up bulanan sudah ada. | **Fungsi dasar di main; definisi request belum lengkap.** Branch lama punya batas pengulangan. Butuh aturan mulai/akhir, frekuensi, jeda, persetujuan, replay, dan idempotensi sebelum mengubah jadwal. |
| BUG-09 | Bahan racikan dipotong saat resep dibuat, tetapi biaya FIFO aktual tidak tersimpan pada baris invoice. | **PR #6 draft, belum merge/deploy.** Biaya layer historis tercatat saat racikan dibuat dan ditautkan sekali ke invoice. Edit/void racikan diblokir sementara; uji race masih gate. |
| BUG-10 | PR #4, commit `289e127`, sudah merged ke `main`; laporan rinci per barang memiliki Klinik > Racikan. | **Sudah ada.** Tidak diimplementasikan ulang; masih perlu cek baca data nyata memakai login. |
| REQ-1 | Stok dan layer FIFO tersedia, layar stok menunjukkan qty, belum ada laporan nilai/HPP per barang berdasarkan layer aktif. | **Belum dibuat.** Setelah posting stok/HPP akurat, rancang agregasi per barang/gudang dan rekonsiliasi stock versus layer, lalu putuskan akses nilai stok bersamaan REQ-4. |
| REQ-2 | `main` belum punya katalog resmi berversi. | **Tahap 1 di branch review bertumpuk di PR #6.** OWNER/ADMIN menerbitkan revisi dan menonaktifkan master; versi aktif dapat dipilih pada racikan inline setelah rekam medis tersimpan. Resep, stok/HPP bahan, dan tautan versi disimpan dalam satu RPC; resep resmi historis dikunci. Aturan pakai resmi tetap seperti versi perusahaan; kebutuhan khusus pasien menggunakan racikan manual. Form pemeriksaan awal/rawat inap menunggu penyimpanan seluruh isian secara atomik agar versi yang tiba-tiba nonaktif tidak meninggalkan rekam medis/log parsial. |
| REQ-3 | Laporan racikan yang ada belum memuat biaya bahan aktual, total modal, margin, dan dokter lengkap. | **Belum dibuat.** Branch review menyiapkan identitas resep dan HPP invoice; belum ada laporan khusus dengan semua kolom yang diminta. |
| REQ-4 | Hak lihat HPP dokter adalah kebijakan data sensitif. | **Keputusan pemilik dibutuhkan.** Tidak ada perubahan visibilitas HPP; usulan pada sheet adalah hanya OWNER/FINANCE. |

## Branch lama dan benturan

- `codex/p0-p2-stabilization` (`21fe5d4`, mencakup `e682b6f`) divergen dari `main`: 14 commit hanya di main dan 2 hanya di branch. `codex/full-stabilization-release` (`34379bb`) juga divergen: 8 versus 1. Jadi tidak aman cherry-pick seluruh branch tanpa rekonsiliasi.
- Branch tersebut memodifikasi alur pembelian langsung dan aset serta menambahkan migrasi `20260916091000_atomic_asset_acquisition.sql`, `20260916092000_direct_purchase_assets.sql`, dan `20260916093000_bounded_recurring_journals.sql`. Fitur dasarnya sudah di main; peningkatan ini belum. Tidak ada berkas lama yang ditimpa oleh perubahan branch review ini.

## Gate pekerjaan berikutnya

1. Selesaikan review PR #6; uji konflik stok dua sesi dan siklus edit/void pada Supabase lokal sebelum menggabungkan.
2. Uji PR #7/#8 pada Supabase lokal, termasuk uji konkurensi dua sesi. Build dan tes gabungan lulus tetapi database penuh belum diuji.
3. Lakukan verifikasi baca data autentik untuk BUG-03/10 tanpa mengubah data nyata.
4. BUG-05/06/08 tetap perlu definisi lingkup. REQ-4 menunggu keputusan eksplisit pemilik; visibilitas HPP tidak diubah.
