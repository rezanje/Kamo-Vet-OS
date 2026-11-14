# B2 — Hapus/arsip data percobaan & transaksi oleh Owner/Admin (usulan, 14 Nov 2026)

Menyentuh jurnal, stok, dan uang → **menunggu keputusan Reza**. Belum ada perubahan kode/database.

## 1. Kondisi sekarang

- **Arsip antrian klinik sudah ada** (sejak 6–7 Nov): Owner/Admin bisa "Arsipkan"; Owner bisa "Paksa arsip" (ketik PAKSA +
  alasan). Arsip hanya **menyembunyikan** kunjungan (bisa dipulihkan), tidak menyentuh uang/stok/jurnal.
- **Kenapa "menunggu pembayaran" ditolak:** begitu kasir membuat tagihan (invoice), kunjungan diblok permanen — walau dipaksa —
  karena tagihan sudah memotong stok (obat/BMHP/racikan) dan menulis jurnal penjualan + HPP + piutang. Menyembunyikannya
  saja akan membuat stok & pembukuan tidak cocok dengan yang terlihat.
- Tidak ada jalur **membatalkan tagihan klinik secara murni** (void tanpa pengganti): "void & terbitkan ulang" selalu membuat
  tagihan pengganti dan menolak tagihan belum lunas; "Batalkan penerimaan" hanya membalik uangnya.
- Tidak ada alat "hapus data percobaan" yang berfungsi (reset simulasi lama sudah dimatikan di Production).
- Celah kecil: kunjungan tanpa tagihan yang racikannya sudah dibuat bisa dipaksa arsip, tetapi stok racikannya tetap terpotong.
- Log Aktifitas umum mencatat arsip sebagai perubahan tanggal arsip saja; alasan & tanda "dipaksa" ada di jejak arsip sendiri.

**Data Production (14 Nov):** 82 kunjungan aktif berstatus Pembayaran (tertua 22 Okt; Cimanggu 27, Panduraya 26, Gerlong 8,
Granada 7, Ciomas 5, Garuda 4, TKI 3, Ciawi 1, Surken 1).
- **59 tanpa tagihan** → sudah bisa diarsipkan sekarang dengan tombol yang ada (Arsipkan / Paksa arsip).
- **23 dengan tagihan**: 21 Lunas (kebanyakan rawat inap yang lunas bertahap tapi kunjungannya belum ditutup), 3 Belum Lunas,
  2 DP. Inilah yang tidak bisa disentuh.

## 2. Usulan

1. **Tutup kunjungan Lunas yang nyangkut** (21): tombol "Tutup kunjungan" untuk Owner/Admin bila semua tagihan sudah Lunas
   (fungsi tutup kunjungan lunas sudah ada di database, tinggal dipakai). Tanpa ubah jurnal/stok.
2. **"Batalkan tagihan" klinik (void murni)** untuk tagihan Belum Lunas/DP, Owner (Admin bila dicentang di Akses Grup, izin
   khusus bawaan mati), satu transaksi atomik:
   - jurnal penjualan, HPP, dan piutang dibalik di **tanggal tagihan asli** (sejalan dengan B3), periode tertutup ditolak;
   - stok obat/BMHP/racikan dikembalikan (lapisan FIFO asal);
   - DP yang sudah dibayar → kembali ke saldo uang muka pelanggan (bisa direfund lewat jalur refund DP yang sudah ada);
   - poin pelanggan & komisi dari tagihan itu ikut dibatalkan; alasan wajib; tercatat di jejak + Log Aktifitas;
   - setelah itu kunjungan boleh diarsipkan (paksa) seperti kunjungan tanpa tagihan.
   Tagihan **Lunas** tetap lewat jalur yang ada (Batalkan penerimaan → Batalkan tagihan), supaya uang keluar dari kas tercatat.
3. **Tidak ada hapus permanen** untuk transaksi yang sudah diproses — dibatalkan + diarsipkan, riwayat tetap (sesuai meeting).
   Hapus permanen hanya untuk kunjungan **Menunggu** tanpa isi (sudah ada).
4. Paksa arsip kunjungan berisi racikan: racikan dibatalkan dulu otomatis (stok kembali) atau ditolak dengan pesan.
5. Alasan + tanda "dipaksa" ikut tampil di Log Aktifitas.
6. Petshop: pembatalan struk Owner sudah ada (`cancel_posted_sale`) — tidak perlu fitur baru, cukup sejalan dengan B3.

## 3. Pilihan

- **A (saran):** kerjakan 1 + 2 + 4 + 5 (tutup yang lunas, batalkan tagihan belum lunas/DP lalu arsip). Admin hanya bila
  dicentang Owner.
- **B:** hanya 1 + 5 (tanpa membatalkan tagihan). Tagihan Belum Lunas/DP tetap harus dilunasi/dikoreksi manual.
- **C:** alat sekali jalan "bersihkan data percobaan" untuk daftar kunjungan yang Reza tandai (dijalankan oleh dev setelah
  disetujui per daftar), tanpa fitur permanen di aplikasi.

Sambil menunggu: 59 kunjungan tanpa tagihan bisa langsung dirapikan klinik dengan tombol Arsipkan/Paksa arsip yang sudah ada.
