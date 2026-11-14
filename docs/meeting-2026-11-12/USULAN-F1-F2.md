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
