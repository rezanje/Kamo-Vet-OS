# VetOS OPEN — status kerja dan batas review

Tanggal audit: 24 September 2026. Sumber: tab `Report` (14 entri OPEN) dan repo `rezanje/Kamo-Vet-OS`, `main` pada `58d9e6f`. Spreadsheet hanya dibaca. Branch review terpisah; tidak ada migrasi atau perubahan data produksi.

| Entri | Temuan terverifikasi | Status pada branch review / berikutnya |
| --- | --- | --- |
| BUG-01 | Obat klinik dipotong setelah invoice tersimpan; jalur racikan memakai titik potong berbeda. | **PR #6 draft, belum merge/deploy.** Mengikat pengeluaran klinik/racikan dan HPP ke transaksi atomik. Uji konkurensi dua sesi serta baca data produksi belum dilakukan. |
| BUG-02 | Perbandingan waktu booking dulu menyebut semua waktu lampau “tanggal lewat”. | **Selesai di main** melalui PR #5; status jam lewat hari ini dan tanggal lampau dibedakan. |
| BUG-03 | `tarikTransaksi` sudah mengambil invoice klinik non-void; error query harus gagal tertutup agar laporan parsial tidak tampak sah. | **Selesai di main** melalui PR #5; tes agregasi dan error query tersedia. Verifikasi baca data autentik belum dilakukan. |
| BUG-04 | PO, faktur langsung, pesanan jual, permintaan barang sudah mempunyai satuan/faktor. Form faktur pembelian **dari PO** tidak menampilkan satuan dan menggabungkan baris berdasarkan `item_id`. | **Perbaikan disiapkan di branch `codex/purchase-invoice-units`.** Tiap baris tersambung ke baris PO dan menyimpan satuan/faktor. RPC invoker mengunci PO, menghitung ulang sisa, menyimpan faktur, menyesuaikan layer, dan mem-posting jurnal dalam satu transaksi. HPP layer PKP memakai DPP. Stok masuk/keluar juga memakai RPC berurutan agar saldo/layer tak tertimpa pembaruan usang. Review kedua berjalan; belum merge/deploy. |
| BUG-05 | Ada tombol tunggu submit dan beberapa status draft/unpaid, tetapi error simpan lintas modul tidak mempunyai draft/retry idempotent tunggal. | **Audit saja.** Tentukan jenis transaksi, siapa dapat melanjutkan, masa simpan draft, cara deduplikasi posting, dan apa yang dianggap pending. |
| BUG-06 | Ada 19 halaman laporan spesifik di bawah `/laporan` ditambah indeks; pencarian kode tidak menemukan tombol CSV/Excel/PDF pada halaman itu. | **Audit saja.** Petakan bentuk tabular versus grafik untuk tiap halaman, hak akses, filter, batas baris, dan format PDF sebelum ekspor menyeluruh. |
| BUG-07 | Menu `/aset-tetap` dan `/keuangan/aset` sudah ada; `tambahAset` mencatat aset dan jurnal pembelian atau saldo awal. | **Fungsi dasar di main.** Posting aset tunai/bank masih terpisah dan best-effort; pembelian aset dari faktur langsung serta posting atomik terdapat di branch lama yang belum merged. Rekonsiliasi terpisah diperlukan. |
| BUG-08 | Menu `Jurnal Berulang`, hari 1–28, aktif/nonaktif, dan proses catch-up bulanan sudah ada. | **Fungsi dasar di main; definisi request belum lengkap.** Branch lama punya batas pengulangan. Butuh aturan mulai/akhir, frekuensi, jeda, persetujuan, replay, dan idempotensi sebelum mengubah jadwal. |
| BUG-09 | Bahan racikan dipotong saat resep dibuat, tetapi biaya FIFO aktual tidak tersimpan pada baris untuk ditempel ke invoice. | **PR #6 draft, belum merge/deploy.** Mencatat HPP bahan saat issue dan menautkannya ke invoice klinik; lifecycle edit/void tetap perlu review dan uji. |
| BUG-10 | PR #4, commit `289e127`, sudah merged ke `main`; laporan rinci per barang memiliki Klinik > Racikan. | **Sudah ada.** Tidak diimplementasikan ulang; masih perlu cek baca data nyata memakai login. |
| REQ-1 | Stok dan layer FIFO tersedia, layar stok menunjukkan qty, belum ada laporan nilai/HPP per barang berdasarkan layer aktif. | **Belum dibuat.** Setelah posting stok/HPP akurat, rancang agregasi per barang/gudang dan rekonsiliasi stock versus layer, lalu putuskan akses nilai stok bersamaan REQ-4. |
| REQ-2 | Racikan saat ini ditulis per rekam medis, bukan katalog resmi berversi dari perusahaan. | **Belum dibuat.** Perlu master/revisi resep, aturan pengecualian pasien, dan jejak versi pada transaksi. |
| REQ-3 | Laporan racikan yang ada menjelaskan penjualan, belum menyimpan modal aktual per bahan dan margin/dokter lengkap. | **Belum dibuat.** Bergantung pada BUG-09 dan identitas resep yang eksplisit. |
| REQ-4 | Hak lihat HPP dokter adalah kebijakan data sensitif. | **Keputusan pemilik dibutuhkan.** Tidak ada perubahan visibilitas HPP; usulan pada sheet adalah hanya OWNER/FINANCE. |

## Branch lama dan benturan

- `codex/p0-p2-stabilization` (`21fe5d4`, mencakup `e682b6f`) divergen dari `main`: 14 commit hanya di main dan 2 hanya di branch. `codex/full-stabilization-release` (`34379bb`) juga divergen: 8 versus 1. Jadi tidak aman cherry-pick seluruh branch tanpa rekonsiliasi.
- Branch tersebut memodifikasi alur pembelian langsung dan aset serta menambahkan migrasi `20260916091000_atomic_asset_acquisition.sql`, `20260916092000_direct_purchase_assets.sql`, dan `20260916093000_bounded_recurring_journals.sql`. Fitur dasarnya sudah di main; peningkatan ini belum. Tidak ada berkas lama yang ditimpa oleh perubahan branch review ini.

## Gate pekerjaan berikutnya

1. Selesaikan review PR #6; uji konflik stok dua sesi dan siklus edit/void pada Supabase lokal sebelum menggabungkan.
2. Selesaikan review kedua BUG-04; validasi migrasi/RPC sudah lulus di PGlite, sedangkan uji konkurensi dua sesi Supabase lokal masih belum dilakukan.
3. Lakukan verifikasi baca data autentik untuk BUG-03/10 tanpa mengubah data nyata.
4. BUG-05/06/08 tetap perlu definisi lingkup. REQ-4 menunggu keputusan eksplisit pemilik; visibilitas HPP tidak diubah.
