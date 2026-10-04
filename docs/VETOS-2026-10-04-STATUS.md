# VetOS — status penyelesaian 4 Oktober 2026

Status ini menggantikan audit historis September untuk batch pekerjaan yang disetujui pengguna. Pengguna menetapkan nilai HPP/modal/margin hanya untuk **OWNER dan FINANCE**, tidak memiliki proyek Supabase demo terpisah, dan meminta HRIS memakai aturan yang sudah ada. Uji mutasi memakai data fiktif pada PostgreSQL, GoTrue, dan PostgREST lokal; pengecekan produksi hanya membaca laporan.

## Sudah live di produksi

[PR #20](https://github.com/rezanje/Kamo-Vet-OS/pull/20) sudah digabung ke `main` pada `632b0a386d9d9501fe517e6bb8265892b5ae17bd`. Deployment GitHub `6844791911`, environment Production, dan deployment Vercel terkait berstatus success. Aplikasi: <https://kamo-vet-os.vercel.app>.

| Pekerjaan | Hasil |
| --- | --- |
| REQ-1: nilai persediaan/HPP | Laporan nilai FIFO aktif per barang/gudang dan rekonsiliasi terhadap stok master, dengan penanda biaya tidak lengkap dan selisih. CSV memuat seluruh hasil dalam batas sumber yang diperiksa. |
| REQ-3: modal dan margin racikan | Laporan biaya bahan historis, pendapatan, laba kotor/margin, dan dokter yang dapat ditelusuri. Versi resep historis dipertahankan; identitas dokter memakai atribusi yang tersedia saat ini. |
| REQ-4: akses nilai | Dua laporan baru dan CSV hanya untuk OWNER/FINANCE aktif dengan akses modul dan cabang yang sesuai. Dashboard mengarahkan pengguna yang berhak ke laporan nilai FIFO. |
| Kelengkapan daftar | Pelanggan dan rekam medis dapat dicari melewati batas lama 1.000/300. Tabel menampilkan 50 baris; stok gudang memakai halaman server terhitung, sedangkan matriks dan ringkasan memeriksa kelengkapan sumber. |
| Pengingat WhatsApp | Lima sumber dibaca dengan pemeriksaan jumlah/baris/ID sebelum pengiriman; kegagalan baca dan ketidakpastian pencatatan hasil provider ditampilkan. Kebijakan pemicu dan anti-kirim ulang yang ada dipertahankan. |
| Login demo | Keterangan akun demo dipulihkan melalui PR #19 dan tetap tersedia. |

Pengecekan baca produksi memakai login demo OWNER dan FINANCE: kedua halaman menampilkan judul laporan, tidak menampilkan kegagalan baca, dan kedua unduhan CSV memberi HTTP 200 `text/csv`. CSV ADMIN memberi HTTP 403; HTML ADMIN tidak menampilkan laporan (redirect server Next dapat tetap memakai HTTP 200). Tidak ada transaksi bisnis atau pesan WhatsApp yang dibuat oleh pengecekan ini.

Validasi PR #20: **141 berkas / 1.307 tes lulus**, TypeScript, lint berkas yang berubah, build produksi, serta browser lokal dengan autentikasi/API nyata. Bukti: [HPP lokal](reports/2026-10-04-hpp-local-acceptance.md), [daftar operasional](evidence/2026-10-04-operational-list-verification.md), dan [benchmark aplikasi hasil build](evidence/2026-10-04-compiled-tab-benchmark.md).

## Selesai di branch, belum live

Paket berikut tetap **draft** karena memerlukan migrasi SQL. Akses yang tersedia di sesi ini tidak mencakup koneksi SQL atau kredensial administrasi database produksi. Menggabungkan kode sebelum migrasi diterapkan berisiko memanggil tabel/RPC yang belum tersedia.

| Paket | Perubahan dan bukti utama |
| --- | --- |
| [#18 — HRIS](https://github.com/rezanje/Kamo-Vet-OS/pull/18) | Jadwal/import Excel atomik, akses staf/cabang, absensi GPS/overnight dan koreksi, pertukaran jadwal, rekap/CSV, serta snapshot dan finalisasi payroll atomik memakai aturan yang ada. Browser lokal menghasilkan tiga slip final dengan net Rp6.075.000 dan satu jurnal seimbang Rp6.125.000; retry finalisasi ditolak tanpa duplikasi. 157 berkas / 1.331 tes dan suite SQL/race lulus. |
| [#13 — penjualan](https://github.com/rezanje/Kamo-Vet-OS/pull/13) | Surat jalan/faktur/penawaran/pembatalan atomik, validasi satuan dasar, alokasi biaya historis per baris, dan pemulihan pengajuan setelah respons hilang tanpa duplikasi. FINANCE tetap dapat membaca piutang tanpa mendapat izin posting penjualan. 134 berkas / 1.221 tes, SQL/race dan browser/API lulus. |
| [#21 — pembelian/aset](https://github.com/rezanje/Kamo-Vet-OS/pull/21) | Penerimaan PO parsial atomik, jurnal setiap penerimaan, pemulihan faktur/aset memakai identitas pengajuan yang sama, serta pemeriksaan ulang izin/cabang. Browser menguji commit yang responsnya hilang lalu pemulihan, dua penerimaan, repricing faktur, dan pembelian aset bank. 133 berkas / 1.215 tes, SQL/race dan build lulus. |
| [#22 — jurnal berulang](https://github.com/rezanje/Kamo-Vet-OS/pull/22) | Posting bulanan atomik dan idempotent, jurnal seimbang, validasi histori ambigu/tidak lengkap, dan pemeriksaan izin setelah menunggu lock. Mempertahankan aturan frekuensi bulanan yang ada. 134 berkas / 1.218 tes dan SQL/race lulus. |
| [#23 — pengamanan profil](https://github.com/rezanje/Kamo-Vet-OS/pull/23) | Akun nonaktif tidak dapat mengaktifkan dirinya melalui PATCH profil. Perubahan sensitif membutuhkan OWNER/ADMIN aktif; perubahan nama pribadi dan administrasi tepercaya tetap sesuai izin. 131 berkas / 1.203 tes, SQL/race, serta GoTrue/PostgREST dengan JWT nyata lulus. |

Candidate gabungan lokal lulus **175 berkas / 1.480 tes** dan build aplikasi. Pemeriksaan paket memakai database lokal yang diadaptasi untuk auth/storage/grant; ini bukan bukti `supabase db reset` bersih terhadap seluruh riwayat migrasi. Kandidat lokal menerapkan 183 berkas migrasi dengan pembaruan kebijakan penjualan dan nama trigger profil secara incremental; suite SQL terisolasi memeriksa versi akhirnya. Riwayat lama memiliki versi migrasi `0106` ganda dan kebutuhan bootstrap COA sebelum migrasi historis `0068`, yang harus ditangani dalam rencana rollout. Detail, skrip, dan hasil masing-masing tersedia di PR terkait.

## Batas yang masih berlaku

- Penerapan SQL produksi dan verifikasi pascarilis paket draft belum dilakukan. Urutan migrasi, kecocokan skema/histori, dan backup harus diperiksa pada database tujuan sebelum aktivasi.
- Tidak ada pesan WhatsApp nyata dikirim untuk pengujian ini; penerimaan oleh provider produksi belum dibuktikan.
- BUG-05 ditangani untuk pengajuan penjualan, faktur/aset, dan penerimaan terkait paket di atas. Draft lintas semua modul, hak melanjutkan oleh pengguna lain, dan masa retensi belum menjadi fitur umum.
- BUG-06 baru ditangani melalui CSV dua laporan HPP baru serta rekap HRIS di draft. Ekspor Excel/PDF seluruh halaman laporan belum selesai.
- BUG-07 belum mencakup aset sebagai baris faktur pembelian langsung. BUG-08 mempertahankan frekuensi bulanan; aturan frekuensi baru, mulai/akhir, dan persetujuan tetap memerlukan definisi.
- Faktur penjualan lama yang sebagian ditagih tanpa alokasi biaya yang dapat dibuktikan diblokir oleh paket penjualan untuk rekonsiliasi FINANCE; tidak ada backfill otomatis.
- Nilai persediaan adalah FIFO aktif saat ini, bukan laporan saldo per tanggal lampau. Racikan tanpa tautan historis yang dapat dibuktikan tidak memperoleh biaya buatan; diskon/pajak tingkat faktur belum dialokasikan ke tiap racikan.
- Pembacaan berhalaman mendeteksi jumlah berubah, baris hilang, dan ID duplikat, tetapi bukan snapshot transaksi database. Batas sumber diperiksa dan gagal dengan pesan, bukan dipotong diam-diam: pelanggan/rekam medis/matriks 10.000, sumber laporan biaya 5.000, dan masing-masing sumber WA 50.000.

Benchmark lokal hasil build, tiga putaran pada satu dan sepuluh tab: seluruh sepuluh tab pelanggan siap median 6.491 → 2.631 ms, rekam medis 4.266 → 1.961 ms, dan stok gudang QA 4.496 → 1.625 ms. Kedua run selesai tanpa HTTP 500 atau error browser yang tertangkap. Ini observasi mesin lokal bersama dengan data fiktif, bukan SLA produksi atau eksperimen kausal terkontrol.

PR #6 dan #9 yang masih disebut draft pada audit September sebenarnya sudah digabung pada 29 September 2026. Dokumen lama dipertahankan sebagai catatan historis; PR audit #10/#11 bukan status implementasi terkini.
