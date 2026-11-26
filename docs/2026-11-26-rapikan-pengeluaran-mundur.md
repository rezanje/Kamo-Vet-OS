# 26 Nov 2026 — Rapikan pengeluaran tanggal mundur

Lanjutan PR #570 (pengeluaran tanggal mundur untuk semua akun, live 24 Nov). Sumber: review independen "aman dengan catatan"
(`ship-backdate-pengeluaran/review/REVIEW-RESULT.md`). Perubahan hanya di aplikasi (tanpa migrasi). Aturan inti tidak berubah:
tanggal sebelum hari ini (WIB) wajib alasan 3-200 huruf/angka, paling lama 31 hari, tidak boleh masa depan, periode tutup buku dan
rekonsiliasi bank ditolak, Admin Online ditolak.

## Yang berubah di layar
- **Ubah pengeluaran** (Owner/Admin/Finance, detail `/pos/expense/<id>` dan `/buku-besar/beban/<id>`): tanggal tidak boleh masa depan;
  bila tanggal DIGANTI ke masa lalu paling lama 31 hari dan alasan koreksi 3-200 huruf/angka. Tanggal lama yang tidak diganti boleh
  berapa pun umurnya (hanya nominal/kategori/metode yang dikoreksi). Penolakan dikembalikan sebagai pesan di form (isian tetap ada),
  bukan galat server yang disamarkan produksi. Penolakan pasti dari database (periode ditutup, data sudah berubah, shift ditutup)
  juga dikembalikan.
- **Detail**: bila tanggal diubah lewat Ubah, jejak tanggal mundur menyebut "tanggal pengeluaran sekarang"; pengeluaran yang dipindah
  ke masa lalu lewat Ubah (tidak punya baris jejak) diberi catatan; Riwayat koreksi menampilkan tanggal/kategori/metode sebelum → sesudah.
- **Lencana "Mundur"** (alasan + waktu input di tooltip) di `/pos/expense`, `/buku-besar/beban`, `/klinik/pengeluaran`, `/kasir/pengeluaran`
  dan Kas Keluar. Daftar kasir dan Pencatatan Beban kini urut waktu INPUT terbaru (dulu menurut tanggal pengeluaran sehingga
  pengeluaran mundur tenggelam di bawah baris hari ini).
- **Laporan baru** di bawah `/buku-besar/beban`: "Laporan pengeluaran tanggal mundur" per periode INPUT (bawaan awal bulan s/d hari ini):
  pelaku, cabang, alasan, selisih hari, penanda "Lintas bulan" (laporan bulan itu berubah), status batal, nominal sekarang.
  Maksimal 500 baris terbaru. Pelaku biasa hanya melihat miliknya (RLS tabel jejak); Owner/Admin/Finance melihat cabangnya.
- **Rincian tutup shift** menandai pengeluaran tunai bertanggal mundur ("(tanggal mundur dd/mm/yyyy)"): pengeluaran itu mengurangi
  laci shift yang terbuka SEKARANG, bukan shift hari itu.
- **Teks banner laci** (kasir/klinik) diperjelas: pengeluaran Tunai mengurangi laci shift yang terbuka sekarang; bila uangnya sebenarnya
  sudah keluar dari laci pada hari itu, tutup shift hari ini tampak lebih besar sebesar jumlah itu: tulis di alasan dan beri tahu Finance.
- Alasan wajib memuat sedikitnya satu huruf/angka (tab, spasi, titik saja ditolak) di sisi aplikasi.

## Tidak berubah / ditunda (butuh database)
- Jalur RPC langsung `revise_expense_atomic` masih tanpa batas 31 hari dan tanpa cek rekonsiliasi bank (hanya Owner/Admin/Finance; alasan + jejak
  `expense_revisions` ada; hosted: 0 rekonsiliasi dan `closed_until` kosong). Aplikasi kini membatasi lewat layar Ubah.
- `btrim()` di database hanya membuang spasi (alasan `\t\t\t` lewat RPC langsung masih lolos; layar menolaknya).
- `ROLLBACK.sql` PR #570 menghapus tabel jejak tanpa cadangan.
- Batas tengah malam WIB tidak diuji dengan jam buatan di suite SQL (mutan UTC-vs-WIB X07-X09 tetap tidak mati oleh suite; perilaku asli
  dibuktikan reviewer dengan jam buatan).

## Tes
- vitest: `tanggal-ubah`, `expense-jejak`, `expense-ubah-tanggal-actions`, `laporan-mundur`, `lencana-mundur`, `pengeluaran-daftar-mundur`,
  `rincian-tutup-shift-mundur`, plus penyesuaian `expense-correction-actions`, `expense-detail-controls`, `expense-backdate-ui`, `kas-riwayat-periode`.
- Suite SQL `supabase/tests/backdate_pengeluaran.sql` bagian 10 menutup celah review (RLS FINANCE cabang lain / nonaktif / kasir lain,
  kategori+jumlah jejak nyata, INSERT langsung dengan tanggal kosong; 152 asersi hijau) dan runner native memperoleh mutan M40-M43 untuk X01, X02, X04, X14.
  M40, M42, M43 mati; M41 (X02, tanpa `p.is_active` di kebijakan) terbukti setara karena `user_can_access_branch()` sudah mensyaratkan akun aktif.
  Runner native kini menyemai akun beban fiktif dan melewati migrasi data hosted agar rantai terbaru bisa dibangun.
