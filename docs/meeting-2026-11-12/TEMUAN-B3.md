# B3 — Void/koreksi transaksi masuk ke tanggal transaksi asli (temuan, 14 Nov 2026)

Status: **sebagian besar sudah tertangani** oleh pekerjaan lain (11–13 Nov, semuanya sudah terpasang di Production).
Sisa celah ada di **pembukuan (jurnal)**, bukan di laporan omzet. Menyentuh jurnal → menunggu keputusan Reza.

## 1. Yang sudah jalan (dicek di `main` + definisi fungsi di Production, 14 Nov)

| Jalur | Omzet / laporan penjualan | Jurnal (Buku Besar, Laba Rugi, Kas/Bank) | Sumber |
|---|---|---|---|
| **Ubah transaksi struk kasir petshop** (pengganti "void lalu buat ulang") | struk baru `created_at` = struk lama + 1 ms → tetap di tanggal asli | pendapatan & kas dibalik/dibukukan di **tanggal struk**; stok & HPP di hari diubah (keputusan 2A) | `20261116300000_ubah_struk_petshop` |
| **Void & terbitkan ulang nota klinik** | nota pengganti `created_at` = nota sumber + 1 ms, `paid_at` ikut → tanggal asli | jurnal batal + jurnal terbit ulang **di hari koreksi** (lihat celah 2) | `20261111035704_terbit_ulang_tanggal_asli` |
| **Batalkan penerimaan** petshop / pencairan marketplace / klinik / pembelian | struk/nota tidak ditulis ulang | Owner memilih **tanggal efektif** (boleh tanggal asli); default hari ini | `20261114300000`, `20261115100000`, `20261114500000` |
| **Koreksi metode bayar** struk petshop | — | jurnal pembalik & pengganti di **tanggal struk** | `20261115400000_j02_koreksi_metode_tanggal_asli` |

Laporan omzet/penjualan membaca tanggal transaksi (`sales.created_at`, nota klinik) dan **membuang** transaksi yang
dibatalkan (`voided_at is null`, mis. `src/lib/laporan-transaksi-server.ts:60`). Jadi untuk **laporan omzet**, keluhan
B3 ("omzet ikut tercatat di tanggal perbaikan") sudah tidak terjadi pada semua jalur di atas.

## 2. Celah yang tersisa (pembukuan)

1. **Batalkan struk petshop tanpa pengganti** (`cancel_posted_sale`): jurnal pembalik pendapatan, HPP, dan penerimaan
   dibukukan **hari pembatalan** (`d = hari ini`), mutasi stok `sale-void` juga hari ini. Laporan omzet menghapus struk
   dari tanggal asli, tetapi Laba Rugi/Buku Besar baru turun di hari pembatalan → **laporan omzet dan Laba Rugi beda
   tanggal** untuk struk yang dibatalkan lewat tengah malam.
2. **Void & terbitkan ulang nota klinik** (`clinic_void_reissue_invoice_core`): jurnal batal + jurnal nota baru
   `current_date`. Kalau nilainya sama, saling meniadakan (aman). Kalau nilainya **berubah** (mis. 100rb → 90rb),
   selisihnya (−10rb) jatuh di Laba Rugi hari koreksi, sedangkan laporan omzet menaruh 90rb di tanggal asli.
3. **Batal kwitansi klinik lama** (`clinic_void_payment_receipt`): jurnal `current_date`. Sudah ada pengganti yang lebih
   baik ("Batalkan penerimaan" dengan tanggal efektif), jadi cukup diarahkan ke sana.

Semua pagar yang ada (periode tutup buku, rekonsiliasi bank, penggajian sudah dibuat) sudah membaca tanggal asli,
jadi memindah tanggal jurnal ke tanggal asli tidak membuka celah baru di periode yang sudah ditutup — ditolak dengan pesan.

## 3. Pilihan (keputusan Reza)

- **A (saran):** jurnal pembalik untuk celah 1 dan 2 dibukukan di **tanggal transaksi asli** (pendapatan, piutang/kas),
  sama seperti "Ubah transaksi" dan koreksi metode bayar. Stok & HPP tetap di hari pembatalan (sama dengan keputusan 2A
  "Ubah transaksi", karena stok fisik kembali hari itu). Periode yang sudah ditutup → ditolak dengan pesan jelas.
  Dampak: Laba Rugi per hari = laporan omzet; kas/bank yang benar-benar keluar-masuk tetap tercatat di shift hari itu.
- **B:** Owner **memilih tanggal** saat membatalkan (default hari ini, paling awal tanggal asli) — sama seperti
  "Batalkan penerimaan". Lebih fleksibel, tapi tergantung yang membatalkan ingat memilih tanggal.
- **C:** Biarkan; tutup B3 dengan arahan "pakai Ubah transaksi / Batalkan penerimaan", jangan batalkan struk mentah.

Rencana teknis (bila A/B): tambalan berjangkar pada `cancel_posted_sale` dan `clinic_void_reissue_invoice_core`
(tanpa menulis ulang fungsi), uji harness Postgres + tes regresi laporan, migrasi baru di atas versi tertinggi
Production dan `main`, dipasang setelah disetujui.

## 4. Implementasi (Reza: A, 14 Nov) — migrasi `20261114141422_b3_jurnal_batal_tanggal_asli.sql`

- **Petshop (`cancel_posted_sale`):** pendekatan sama persis dengan `pos_sale_edit_void` (Ubah transaksi): tiap jurnal
  pendapatan (`sale`/`sale-online`) dan penerimaan (`sale-receipt-cancel`/`-repost`) dibalik di **tanggalnya sendiri**;
  `sale-void-hpp` dan mutasi stok `sale-void` tetap hari ini. Pagar baru: rekonsiliasi bank aktif bertanggal >= tanggal
  jurnal pada rekening yang dibalik → ditolak. Tutup buku & penggajian tanggal struk sudah dijaga pagar lama.
- **Klinik (`clinic_void_reissue_invoice_core`):** `klinik-void` + `klinik-reissue` di tanggal invoice asli (created_at WIB,
  sama dengan invoice pengganti). Pasangan HPP (`klinik-hpp-void` + `klinik-hpp` invoice pengganti) **tetap hari ini**:
  terbit ulang tidak menggerakkan stok dan pasangan ini saling meniadakan, jadi periode persediaan tanggal asli tidak tersentuh.
- **Selisih nilai** sebenarnya terjadi saat invoice pengganti dikoreksi (`clinic_edit_invoice_core`, bukan saat terbit ulang
  — terbit ulang menyalin nilai lama). Karena itu koreksi invoice pengganti yang belum selesai (correction_pending +
  reissued_from, tanpa jendela tanggal efektif) ikut dibukukan di tanggal asli; HPP koreksinya tetap hari ini (aturan 2A).
- Pagar klinik baru (kode dikenali layar): `PERIODE_TERKUNCI`, `REKONSILIASI_TERKUNCI`, `GAJI_SUDAH_DIBUAT` (komisi klinik
  = tanggal lunas asli yang dipertahankan invoice pengganti). Ditolak di awal terbit ulang supaya invoice tidak tertahan
  "koreksi belum selesai". Transaksi hari yang sama = perilaku lama persis.
- Uji: `scripts/test-b3-jurnal-batal-tanggal-asli-postgres.py` (`--baseline` = kasus fitur merah tanpa migrasi).
