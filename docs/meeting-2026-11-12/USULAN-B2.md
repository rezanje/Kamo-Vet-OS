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

## 4. Implementasi (pilihan A, disetujui Reza) — 14 Nov 2026

Migrasi `supabase/migrations/20261118620000_b2_batalkan_tagihan_klinik.sql` (belum dipasang di Production). Harness
`scripts/test-b2-batalkan-tagihan-klinik-postgres.py` (GREEN 62/62; `--baseline` RED).

**1. Tutup kunjungan** — tombol di Antrian (Owner/Admin) pada baris Pembayaran yang semua tagihan aktifnya Lunas.
RPC `clinic_close_settled_visit` memakai aturan lama `close_settled_visit` (tanpa jurnal/stok) dan menjelaskan penolakan:
pasien masih dirawat inap, tagihan belum lunas/sedang dikoreksi, obat/layanan belum ditagih.

**2. Batalkan tagihan** — halaman `/klinik/pembayaran/[visitId]/batalkan-tagihan` (tombol di halaman tagihan untuk
tagihan rawat jalan Belum Lunas/DP). Owner selalu; peran lain hanya bila izin Akses Grup "Batalkan tagihan klinik"
(`klinik.batalkan_tagihan`, bawaan mati) dicentang. Alasan wajib, satu transaksi, aman diulang (kunci permintaan), pratinjau
baca-saja dengan alasan penolakan bahasa biasa.
- Tanggal mengikuti aturan "2A" (keputusan B3 A, sama dengan Ubah transaksi petshop dan migrasi B3): omzet/piutang/diskon/pajak
  dibalik di **tanggal tagihan asli** (jurnal `klinik-void`; pagar tutup buku & penggajian dibaca di tanggal itu), sedangkan
  **HPP dan semua stok kembali hari ini** (jurnal `klinik-hpp-void`, mutasi stok; pagar periode persediaan dibaca hari ini).
- Stok obat/BMHP kembali sebagai lapisan baru pada biaya tercatat (mutasi klinik tidak menyimpan lapisan
  asalnya). Bahan racikan kembali ke **lapisan asal** (bukti `compound_issues`) bila lapisannya masih cocok. Nilai stok yang
  kembali wajib = HPP yang dibalik (toleransi Rp1), kalau tidak ditolak.
- DP di kepala tagihan → saldo uang muka pelanggan (UMK baru di kunjungan itu); dikembalikan lewat panel "Kembalikan saldo
  uang muka" yang sudah ada (tampil di halaman batalkan tagihan sesudah dibatalkan).
- Poin dari tagihan dibalik (tidak pernah minus; poin sudah terpakai = ditolak). Komisi/laporan otomatis tidak menghitung
  tagihan batal (membaca tagihan Lunas yang tidak dibatalkan).
- Obat/layanan di rekam medis ditarik dari penagihan (kasir tidak menagihnya lagi; isi rekam medis tetap).
- Jejak tetap `clinic_invoice_voids` + `invoice_edit_log` + Log Aktifitas ("Batalkan tagihan INV-… — alasan: …").
- Ditolak: Lunas (Batalkan penerimaan dulu), masih ada uang lewat kasir/kwitansi/uang muka (Batalkan penerimaan dulu),
  uangnya masih tercatat di shift kasir yang **sedang buka** (hitungan laci tutup shift membaca tagihan yang tidak batal —
  tunggu shift ditutup), **semua rawat inap** (tahap/berjalan/sudah pulang), hasil terbit ulang/koreksi berjalan, refund,
  DEMO, kode kampanye, koreksi metode bayar, periode akuntansi tertutup di tanggal asli, penggajian bulan itu sudah
  dibuat, periode persediaan tertutup sampai hari ini, metode persediaan rata-rata.
- Tidak ada jurnal ke rekening kas/bank (uang DP tetap di rekeningnya), jadi rekonsiliasi bank tidak terpengaruh.

**3. Arsip sesudah batal** — aturan arsip ditambal: tagihan yang dibatalkan lewat jalur ini (beserta pembayaran bersih nol,
kwitansi yang sudah dibatalkan, uang muka hasil DP yang sudah habis, penjualan racikan yang bahannya sudah kembali) tidak lagi
penghalang keras → kunjungan bisa "Paksa arsip". Saldo DP yang belum dikembalikan tetap menghalangi dengan pesan sendiri.

**4. Paksa arsip + racikan** — dipilih **menolak** (lebih aman daripada membatalkan racikan diam-diam di dalam arsip:
racikan yang sudah diserahkan ke pasien tidak boleh kembali ke stok). Pesan: "kembalikan bahan racikannya dulu dari rekam
medis, atau tagihkan". Racikan yang bahannya sudah dikembalikan ("Kembalikan bahan") tidak lagi menghalangi.

**5. Log Aktifitas** — arsip/pulihkan tercatat dengan label "Arsip PAKSA kunjungan — alasan: … (n syarat dilewati)" dan
nilai `forced`.

**Temuan data Production (14 Nov, baca-saja):**
- 5 tagihan belum lunas/DP di kunjungan Pembayaran **semuanya rawat inap** (4 tagihan tahap, 1 DP pasien masih dirawat) →
  di luar cakupan batalkan tagihan; tetap lewat koreksi rawat inap. Fitur ini dipakai untuk tagihan rawat jalan ke depan dan
  untuk tagihan Lunas sesudah "Batalkan penerimaan".
- 19 kunjungan Pembayaran yang tagihannya Lunas: **18 pasiennya masih dirawat inap** (tidak tampil di Antrian dan memang tidak
  boleh ditutup), 1 sudah pulang tetapi masih punya 1 baris belum ditagih → tombol Tutup kunjungan menolak dengan alasan jelas.
  Angka "21 nyangkut" di usulan ternyata sebagian besar pasien yang masih dirawat.

**Tanggal (diseragamkan dengan B3 A):** awalnya HPP/stok ikut tanggal asli; dikoreksi ke aturan 2A (HPP & stok hari ini) supaya
sama dengan B3 dan Ubah transaksi.
