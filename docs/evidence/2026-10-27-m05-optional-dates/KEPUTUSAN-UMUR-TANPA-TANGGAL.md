# M05 — faktur saldo awal tanpa tanggal: dampak umur & periode, dan keputusan yang dibutuhkan

Status: **menunggu keputusan pemilik/keuangan.** Sampai diputuskan, VetOS tidak memilih aturan bisnis apa pun:
faktur tanpa tanggal tidak diberi umur dan tidak diberi tanggal karangan.

## Yang sudah berlaku (netral, tanpa menebak)

| Hal | Perlakuan sekarang |
|---|---|
| Disimpan di faktur | Tanggal faktur / jatuh tempo **kosong**, persis seperti file Accurate. Tidak diisi tanggal cutover, hari ini, atau +30 hari. |
| Tanggal yang terisi | Tetap divalidasi: harus tanggal nyata, tanggal faktur tidak sesudah tanggal saldo, jatuh tempo tidak sebelum tanggal faktur. Error Excel (#N/A dll.) ditolak. |
| Nilai, nomor, pihak, cabang | Tidak terpengaruh. Masuk total hutang/piutang, total kontrol, dan jurnal saldo awal seperti faktur bertanggal. |
| Cegah dobel | Tidak terpengaruh: nomor ganda di file dan terhadap database tetap ditolak; posting ulang file sama tidak dobel. |
| Pembayaran | Tetap per faktur lewat Pembayaran Hutang, Perintah Pembayaran, dan Faktur & Penerimaan Penjualan. |
| Umur hutang (layar Hutang, dasar: jatuh tempo) | Kelompok terpisah **"Tanpa jatuh tempo"**, tidak masuk Berjalan/1–30/…/>90. Tetap masuk TOTAL HUTANG. |
| Umur piutang (layar Piutang, dasar: tanggal faktur) | Kelompok terpisah **"Tanpa tanggal faktur"**, ditaruh paling bawah. Tetap masuk TOTAL PIUTANG. |
| Daftar Faktur Penjualan (dasar: jatuh tempo) | Label "Tanpa jatuh tempo". |
| Daftar Faktur Pembelian | Kolom tanggal "Tidak ada"; tidak pernah ditandai telat. |
| Jurnal / buku besar | Tidak berubah: satu jurnal per batch **pada tanggal saldo awal** (cutover). |
| Buku besar pembantu | Faktur tanpa tanggal faktur dicatat pada **tanggal saldo awal batch-nya** (= tanggal jurnalnya), dengan keterangan "tanggal faktur tidak ada". Ini tanggal pencatatan di VetOS, bukan tanggal faktur; tanggal fakturnya tetap kosong. Tujuannya agar saldo pembantu sejalan dengan buku besar dan pelanggan tidak tampil minus saat pembayarannya masuk. Bila pembaca tidak berhak melihat batch-nya (mis. dibatasi ke cabang lain), faktur tetap ikut tanpa tanggal dan masuk saldo awal setiap periode — tidak dibuang, tidak ditebak. |
| Laporan pembelian/penjualan, dashboard, komisi | Faktur saldo awal (bertanggal atau tidak) sudah dikecualikan sejak M05. |

## Keputusan yang dibutuhkan

**K1. Umur faktur tanpa jatuh tempo (hutang) / tanpa tanggal faktur (piutang)**

- **A — Tetap kelompok terpisah "Tanpa tanggal"** (yang berlaku sekarang). Jujur, tetapi kelompok ini tidak pernah
  "menua", jadi penagihan/pembayaran harus dipantau manual dari daftar.
- **B — Dianggap jatuh tempo pada tanggal cutover (31 Okt 2026).** Mulai 1 Nov langsung terhitung lewat jatuh tempo
  dan menua otomatis. Konsekuensi: angka umur memuat asumsi, bukan data Accurate.
- **C — Dilengkapi sebelum impor.** Keuangan mengisi tanggal dari dokumen fisik/Accurate untuk faktur yang nilainya
  besar; sisanya ikut A. Data paling benar, butuh waktu keuangan sebelum 31 Okt.

Saran: **C untuk faktur bernilai besar, A untuk sisanya.** B hanya kalau tim keuangan memang ingin semua faktur tanpa
tanggal diperlakukan "sudah jatuh tempo" untuk penagihan.

**K2. Buku besar pembantu sebelum tanggal cutover** — faktur tanpa tanggal faktur baru muncul mulai tanggal saldo
awal (sama dengan jurnalnya). Kalau keuangan butuh melihatnya di periode sebelum cutover, perlu aturan tanggal
pengganti — dan itu keputusan bisnis, bukan teknis. Saran: biarkan (VetOS mulai 1 Nov; periode sebelum itu tetap
dilihat di Accurate).

Setelah K1/K2 diputuskan, perubahannya kecil (hanya cara menghitung umur/tampilan); data yang sudah diimpor tidak
perlu diubah.
