# VetOS OPEN — status kerja dan batas review

Tanggal audit: 24 September 2026. Sumber: tab `Report` (14 entri OPEN) dan repo `rezanje/Kamo-Vet-OS`, `main` pada `686afd7`. Spreadsheet hanya dibaca. Branch review ini tidak menjalankan migrasi atau mengubah data produksi.

| Entri | Temuan terverifikasi | Status pada branch review / berikutnya |
| --- | --- | --- |
| BUG-01 | Obat klinik dipotong setelah invoice tersimpan; error `stockOut` ditangkap lalu proses berlanjut. Jurnal `postJournal` juga tidak wajib sukses. | **Terblokir untuk rilis.** Kontrak error, desain dua transaksi, dan rencana SQL ada; RPC atomik belum dibuat/diuji. Prioritas pertama saat Postgres isolasi tersedia. |
| BUG-02 | Perbandingan waktu booking dulu menyebut semua waktu lampau “tanggal lewat”. | **Diperbaiki pada branch ini.** Status hari ini dengan jam lewat dan tanggal lewat dipisah, diuji termasuk batas hari WIB. |
| BUG-03 | `tarikTransaksi` di `main` sudah mengambil invoice klinik belum void. Error query sebelumnya diabaikan sehingga laporan parsial bisa terlihat sah. | **Pengaman pada branch ini.** Test agregasi POS+klinik dan fail closed untuk error invoice. Data autentik di aplikasi belum diverifikasi. |
| BUG-04 | PO, faktur langsung, pesanan jual, permintaan barang sudah mempunyai satuan/faktor. Form faktur pembelian **dari PO** tidak menampilkan satuan dan menggabungkan baris berdasarkan `item_id`; PO menyimpan satuan/faktor, faktur dari PO hanya menyimpan qty/harga. | **Masih terbuka, butuh perubahan terukur.** Hubungkan tiap baris faktur ke baris PO, pertahankan satuan/faktor historis, dan hitung sisa dalam satuan dasar untuk kasus item sama dengan kemasan berbeda. Uji jurnal dan repricing layer per satuan. Jangan menambahkan dropdown yang hanya mengubah label tanpa mengubah hitungan. |
| BUG-05 | Ada tombol tunggu submit dan beberapa status draft/unpaid, tetapi error simpan lintas modul tidak mempunyai draft/retry idempotent tunggal. | **Audit saja.** Tentukan jenis transaksi, siapa dapat melanjutkan, masa simpan draft, cara deduplikasi posting, dan apa yang dianggap pending. |
| BUG-06 | Ada 19 halaman laporan spesifik di bawah `/laporan` ditambah indeks; pencarian kode tidak menemukan tombol CSV/Excel/PDF pada halaman itu. | **Audit saja.** Petakan bentuk tabular versus grafik untuk tiap halaman, hak akses, filter, batas baris, dan format PDF sebelum ekspor menyeluruh. |
| BUG-07 | Menu `/aset-tetap` dan `/keuangan/aset` sudah ada; `tambahAset` mencatat aset dan jurnal pembelian atau saldo awal. | **Fungsi dasar di main.** Posting aset tunai/bank masih terpisah dan best-effort; pembelian aset dari faktur langsung serta posting atomik terdapat di branch lama yang belum merged. Rekonsiliasi terpisah diperlukan. |
| BUG-08 | Menu `Jurnal Berulang`, hari 1–28, aktif/nonaktif, dan proses catch-up bulanan sudah ada. | **Fungsi dasar di main; definisi request belum lengkap.** Branch lama punya batas pengulangan. Butuh aturan mulai/akhir, frekuensi, jeda, persetujuan, replay, dan idempotensi sebelum mengubah jadwal. |
| BUG-09 | Bahan racikan dipotong saat resep dibuat, tetapi biaya FIFO aktual tidak tersimpan pada baris untuk ditempel ke invoice. | **Terblokir bersama BUG-01.** Rencana mengikat biaya historis ke resep, lalu menjurnal HPP sekali pada faktur; void/reissue juga harus aman. |
| BUG-10 | PR #4, commit `289e127`, sudah merged ke `main`; laporan rinci per barang memiliki Klinik > Racikan. | **Sudah ada.** Tidak diimplementasikan ulang; masih perlu cek baca data nyata memakai login. |
| REQ-1 | Stok dan layer FIFO tersedia, layar stok menunjukkan qty, belum ada laporan nilai/HPP per barang berdasarkan layer aktif. | **Belum dibuat.** Setelah posting stok/HPP akurat, rancang agregasi per barang/gudang dan rekonsiliasi stock versus layer, lalu putuskan akses nilai stok bersamaan REQ-4. |
| REQ-2 | Racikan saat ini ditulis per rekam medis, bukan katalog resmi berversi dari perusahaan. | **Belum dibuat.** Perlu master/revisi resep, aturan pengecualian pasien, dan jejak versi pada transaksi. |
| REQ-3 | Laporan racikan yang ada menjelaskan penjualan, belum menyimpan modal aktual per bahan dan margin/dokter lengkap. | **Belum dibuat.** Bergantung pada BUG-09 dan identitas resep yang eksplisit. |
| REQ-4 | Hak lihat HPP dokter adalah kebijakan data sensitif. | **Keputusan pemilik dibutuhkan.** Tidak ada perubahan visibilitas HPP; usulan pada sheet adalah hanya OWNER/FINANCE. |

## Branch lama dan benturan

- `codex/p0-p2-stabilization` (`21fe5d4`, mencakup `e682b6f`) divergen dari `main`: 14 commit hanya di main dan 2 hanya di branch. `codex/full-stabilization-release` (`34379bb`) juga divergen: 8 versus 1. Jadi tidak aman cherry-pick seluruh branch tanpa rekonsiliasi.
- Branch tersebut memodifikasi alur pembelian langsung dan aset serta menambahkan migrasi `20260916091000_atomic_asset_acquisition.sql`, `20260916092000_direct_purchase_assets.sql`, dan `20260916093000_bounded_recurring_journals.sql`. Fitur dasarnya sudah di main; peningkatan ini belum. Tidak ada berkas lama yang ditimpa oleh perubahan branch review ini.

## Gate pekerjaan berikutnya

1. Siapkan Postgres/Supabase **lokal terisolasi** dan uji migrasi/RPC dengan role authenticated, RLS, dua checkout stok terakhir yang bersaing, resep bahan kedua kurang, retry, edit dan void. Lingkungan eksekusi saat ini tidak memiliki Postgres, `psql`, Docker, atau Supabase CLI; instalasi via apt juga gagal karena hak sistem. Kontrak TypeScript saja belum memperbaiki BUG-01/09.
2. Lakukan uji aplikasi dengan akun resmi pada data yang boleh dibaca untuk BUG-03/10. Jangan mengubah data nyata dalam verifikasi.
3. Pecah BUG-04 dan rekonsiliasi aset/berulang dari branch lama menjadi PR terpisah dengan pengujian basis hitung dan migrasi lokal sebelum digabung.
4. Minta keputusan pemilik khusus REQ-4; rincian BUG-05/06/08 memerlukan definisi lingkup sebelum implementasi menyeluruh.
