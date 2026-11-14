# F1 + F2 — Laporan hasil stok opname, akun selisih, beban ke karyawan (usulan, 14 Nov 2026)

Menyentuh jurnal & stok → **menunggu keputusan Reza**. Belum ada perubahan kode/database.

## 1. Kondisi sekarang (kode `main` + Production, dicek 14 Nov)

- **Metode HPP Production = FIFO**, bukan average. Average hanya aktif kalau Owner/Finance menjalankan "Aktifkan average"
  di Closing HPP (belum pernah). Di meeting disebut "HPP memakai average" → **belum sesuai**.
- **Posting opname** (`post_opname_atomic`, versi I02 28 Okt):
  - Selisih **minus**: Dr **720010 Beban Selisih Stok** / Cr 170001 Persediaan, senilai HPP barang yang keluar (FIFO: lapisan
    yang terpakai).
  - Selisih **plus**: Dr 170001 Persediaan / Cr **720010 Beban Selisih Stok** (akun yang sama!), senilai harga beli master.
  - Jadi plus **tidak** masuk Pendapatan Lain-lain; plus dan minus saling mengurangi di satu akun beban. Di Laba Rugi
    minus bisa "hilang" kalau ada plus di periode yang sama.
  - Minus dengan HPP 0 (lapisan biaya nol) **tidak menulis jurnal sama sekali** (`if loss>0`), padahal stoknya berkurang.
- **Data Production:** 7 perintah opname November, **2 sudah diposting**, keduanya minus: total Rp1.379.040,92 di
  720010 Beban Selisih Stok. Belum ada plus.
- **Laporan** `Laporan › Hasil Opname` (Owner/Finance) sudah ada dan ikut pola "Tampilkan": per dokumen, pilih dasar
  **modal (HPP)** *atau* **harga jual** (bergantian, tidak berdampingan), saringan lebih/kurang, rekonsiliasi jurnal.
  Kurang: total per periode lintas dokumen, HPP & harga jual berdampingan, label "Modal FIFO" tetap walau metode average,
  dan kalau average diaktifkan kolom HPP-nya kosong ("tidak tersedia").
- **F2:** notifikasi nilai minus opname masih kosong ("penilaian HPP belum tersedia"; ambang Rp500rb sudah ada di
  pengaturan). Beban ke karyawan pernah ada (23–28 Okt: faktur ke Piutang Usaha / Pendapatan Penjualan "ditanggung kepala
  toko") lalu dicabut 28 Okt.

## 2. Usulan

### F1-a. Laporan (tanpa ubah jurnal) — bisa langsung dikerjakan
- Rekap periode lintas dokumen: per gudang/cabang, jumlah & nilai plus, minus, neto.
- Kolom **HPP dan harga jual berdampingan** + selisih nilai keduanya; tetap bisa diunduh Excel.
- Label mengikuti metode (FIFO/average); bila average aktif, HPP diambil dari nilai yang benar-benar dijurnal.

### F1-b. Akun selisih (ubah jurnal posting opname ke depan)
- Plus → **Pendapatan Lain-lain** (810004 Pendapatan Diluar Operasional Lain, atau akun baru "Pendapatan Selisih Stok"),
  minus → tetap 720010 Beban Selisih Stok. Berlaku juga untuk koreksi opname & penyesuaian persediaan agar konsisten.
- Minus ber-HPP 0 tidak boleh lolos tanpa jurnal: dinilai dengan harga beli terakhir/master, atau ditolak dengan pesan.
- Jurnal lama (2 opname November) tidak diubah kecuali Finance minta reklas.

### F1-c. HPP average
- Pindah ke average = keputusan akuntansi besar (semua HPP penjualan ke depan ikut berubah). Prasyarat: tidak ada stok minus,
  lalu Owner/Finance menekan "Aktifkan average". Usul: diputuskan terpisah bersama Finance, **bukan** bagian F1.

### F2. Beban selisih minus ke karyawan (P2)
- Ringkasan + notifikasi nilai minus saat opname diposting (HPP & harga jual), memakai ambang yang sudah ada.
- Beban karyawan = qty minus × **harga jual** (contoh meeting: HPP 100rb, jual 150rb → karyawan 150rb).
- Usul jurnal: Dr **182001 Kasbon/Piutang Karyawan** 150rb / Cr 720010 Beban Selisih Stok 100rb / Cr **Pendapatan Lain-lain**
  50rb (selisih harga jual − HPP). Ditagih lewat potong gaji (payroll) atau bayar tunai. Siapa karyawannya dipilih saat
  posting (kepala toko/penanggung jawab opname), bisa dibagi beberapa orang.

## 3. Pilihan

- **A (saran):** kerjakan F1-a sekarang; F1-b (plus ke Pendapatan Lain-lain, minus HPP 0 dinilai harga beli terakhir)
  setelah disetujui; average diputuskan terpisah dengan Finance; F2 sesudah F1 dengan jurnal di atas.
- **B:** F1-a saja (laporan), jurnal tetap seperti sekarang.
- **C:** F1-a + F1-b + aktifkan average sekaligus (risiko: HPP semua penjualan berubah mulai tanggal aktif).

Pertanyaan untuk F2 (bila jalan): beban karyawan dipotong gaji otomatis atau dicatat sebagai kasbon saja?

## 4. Implementasi F1 (keputusan Reza: A — F1-a + F1-b; average & F2 di luar cakupan)

Migrasi `supabase/migrations/20261118630000_f1_opname_akun_selisih.sql` (satu transaksi, tambalan jangkar
eksak pada definisi yang berjalan — dicek sama dengan Production 14 Nov via `pg_get_functiondef`) + laporan.
Hanya posting **baru**; jurnal/stok/snapshot lama tidak diubah.

**F1-b — akun (jurnal ke depan)**
- `stock_opname_account('gain')` = **810004** Pendapatan Diluar Operasional Lain (ada, aktif, akun rincian di
  Production). `variance` tetap 720010, `inventory` tetap 170001.
- `post_opname_atomic` dan `post_inventory_adjustment_atomic` (keduanya memakai pasangan akun yang sama →
  diputuskan ikut berubah): lebih = Dr 170001 / Cr 810004; kurang = Dr 720010 / Cr 170001. Bukti posting
  mencatat `gain_account`. Penyesuaian kini mewajibkan 170001, 720010, 810004 aktif sebelum menulis.
- Nilai selisih lebih: tetap harga beli master (nilai stok masuk = nilai jurnal; tidak diubah ke harga terakhir).
- **Kurang ber-HPP 0**: `stock_out_fifo` kini menilai kuantitas dari lapisan tanpa harga untuk sumber `opname`
  dan `penyesuaian` dengan aturan taksiran yang sama dengan penjualan (harga lapisan terakhir yang terpakai →
  riwayat masuk terakhir → harga beli master). Nilai ikut di mutasi stok & bukti pengeluaran, jadi jurnal =
  mutasi = snapshot laporan, dan koreksi resmi tetap bisa membaliknya persis. Bila tetap 0 (tidak ada harga sama
  sekali) posting **ditolak**: "Harga modal barang X belum ada … Isi harga beli barang ini dulu". Mode average:
  harga efektif yang sama; 0 → ditolak.
- **Koreksi stok** (`stock_correction_plan` / `correct_stock_document`): jurnal sumber boleh 720010 (lama) atau
  810004 (baru) di sisi lawan; pengganti lebih → Cr 810004, kurang → Dr 720010, tanpa baris nol. Koreksi yang
  selisih kurang barunya memakai lapisan tanpa harga ditolak dengan pesan (jalur koreksi tidak menilai taksiran).
  Koreksi dokumen lama: jurnal asal (720010) dibalik persis, pengganti memakai kebijakan baru.
- Snapshot `capture_opname_price_report` mengikuti metode: bila average aktif, HPP selisih = nilai yang dijurnal
  (bukti pengeluaran / harga beli masuk), nilai stok setelah posting = qty × harga pokok average.

**F1-a — Laporan › Hasil Opname**
- Rekap periode lintas dokumen per cabang/gudang: jumlah dokumen, baris & nilai lebih/kurang/neto, **HPP dan
  harga jual berdampingan** + selisih jual − HPP, baris total. Sumber: RPC baru `read_opname_price_recap(uuid[])`
  (hak akses = snapshot per dokumen: OWNER/FINANCE aktif, izin modul laporan, izin cabang).
- Rincian per dokumen tetap ada; tombol modal/jual diganti kolom berdampingan. Label "HPP FIFO"/"HPP average"
  mengikuti metode (bukan "Modal FIFO" tetap). Parameter `dasar` lama diabaikan (preset tersimpan tetap jalan).
- Unduh CSV/Excel di server (sesi + akses efektif lewat `loadOpnamePriceReport`, sel teks `amankanSel`):
  lembar "Rekap periode", "Hasil opname" (bila satu dokumen dipilih), "Ringkasan dan filter". Rekap bisa diunduh
  tanpa memilih dokumen. Gerbang A1 tetap: tanpa `tampil=1` tidak ada pembacaan data.

**Tes**: `scripts/test-f1-opname-akun-selisih-postgres.py` 33/33 PASS, `--baseline` 25/25 kasus fitur RED;
regresi SQL `opname_posting_atomic.sql` & `i02_inventory_adjustment_atomic.sql` disesuaikan ke kebijakan baru
(lulus), `stock_document_corrections.sql`, `opname_price_report.sql`, `remaining_average_composition.sql` lulus
tanpa perubahan; vitest penuh, lint, typecheck, build lulus.

**Risiko Production / catatan**
- Opname/penyesuaian barang yang tidak punya harga sama sekali (stok, riwayat, master = 0) akan ditolak sampai
  harga beli diisi — sebelumnya lolos tanpa jurnal.
- Lapisan stok tanpa harga yang terpakai opname kini menghasilkan beban (taksiran), sama seperti penjualan.
- 810004 juga dipakai kelebihan kas tutup shift; bila Finance ingin memisahkan, tinggal ganti satu pemetaan
  (`stock_opname_account('gain')` + literal di perencana koreksi) ke akun baru "Pendapatan Selisih Stok".
