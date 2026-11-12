# Rancangan: "Ubah transaksi" struk petshop tanpa void, tetap di tanggal asli

Permintaan tim (12 Nov 2026, via Reza):
> kalo bisa akses ubah nya gak usah ada void void, langsung aja arahkan ke input terus simpan lagi. paling nanti
> ke record di history aja. kalo void void ribet, udah gitu khawatir malah salah tgl.
> ... misal, saya ubah tgl 2 november ditgl 6. harusnya kan transaksinya ttp ditgl 2.

Keputusan Reza: semua isi boleh diubah (barang, jumlah, harga, diskon, metode bayar); akses Owner + Finance.

## Tahap 1 — SELESAI (migrasi 20261115400000)
Koreksi metode bayar (Tunai ↔ Transfer) kini dibukukan di **tanggal struk**, bukan hari koreksi. Pagar periode
tertutup dan rekonsiliasi bank sudah memakai tanggal struk. Satu koreksi lama (POS-20261101-0051, dikoreksi
12 Nov, Rp 11.000) jurnalnya tetap 12 Nov (riwayat tidak ditulis ulang).

## Kondisi sekarang (hasil pemetaan kode, 12 Nov)
Jalur "Batalkan & siapkan pengganti" (`cancel_posted_sale` → `/kasir?replace_sale=`):
- Hanya OWNER. Ditolak bila: shift asal sudah ditutup, ada voucher/promo di struk, bulan sudah digaji, poin
  pelanggan sudah terpakai, dan — kemungkinan besar — bila kasir yang sama sudah membuat transaksi sesudahnya
  (aturan urutan efek quest staf). Produksi: 0 struk pernah dibatalkan dari 4.969.
- Pengganti = checkout baru: tanggal hari ini, nomor struk baru, harga/promo dihitung ulang dari master hari ini,
  kasir/shift/sales = pelaku koreksi (komisi pindah orang), wajib shift terbuka di cabang yang sama.
- Tidak ada tautan di database antara struk batal dan penggantinya.

Hambatan teknis untuk mengubah di tempat dengan tanggal asli:
- Baris struk, header keuangan, alokasi bayar, gerak stok dan jurnal penjualan dikunci oleh trigger
  (`unit_posted_sale_source_immutable`, `pos_sale_protect_header`, `sale_payments_immutable`,
  `guard_posted_sale_movement`, `pos_sale_protect_journal`). Satu-satunya pintu resmi: gerbang koreksi
  (`sale_payment_correction_gate`), sekarang hanya untuk alokasi bayar.
- `sale_stock_out_fifo` mewajibkan tanggal stok = tanggal struk = hari ini.
- `pos_sale_assert_actor` mewajibkan shift terbuka milik pelaku.

## Rancangan tahap 2
Satu RPC atomik `edit_posted_pos_sale(sale, expected_revision, request_key, reason, lines, payments, discount...)`
untuk OWNER/FINANCE, pada **struk yang sama** (nomor & tanggal tetap, `revision+1`):

1. Validasi: belum void; tidak ada retur/refund aktif; periode tanggal struk dan hari ini belum ditutup; tidak ada
   rekonsiliasi bank ≥ tanggal struk di rekening terkait; alasan wajib; idempotensi seperti J02.
2. Snapshot sebelum (header, baris, alokasi, jurnal) → tabel audit baru `sale_edits` (tampil di panel Riwayat).
3. Stok: balik gerak stok lama dan keluarkan stok baru — **lihat Keputusan A** soal tanggalnya.
4. Jurnal: balik jurnal penjualan/HPP aktif dan bukukan jurnal baru di **tanggal struk** (seperti tahap 1).
5. Alokasi bayar & header diganti lewat gerbang koreksi yang diperluas (baris struk ikut gerbang).
6. Poin pelanggan: selisih poin dibukukan; ditolak bila saldo poin pelanggan jadi minus.
7. Komisi: dihitung live dari struk — otomatis ikut isi baru, tetap di bulan asli. Bila bulan itu sudah digaji → tolak.
8. Laci shift: tidak diubah (angka tutup shift tetap); selisih tunai hanya ke kas di jurnal tanggal struk.
9. UI: tombol **Ubah transaksi** di detail struk → formulir berisi isi struk sekarang (barang, qty, harga,
   diskon, bayar) → Simpan. Tidak perlu shift terbuka, tidak lewat halaman kasir.

Perkiraan: ±3–5 hari kerja termasuk uji database (FIFO/rata-rata, promo, poin, shift tertutup, periode tertutup,
balapan dua sesi) dan uji coba di staging sebelum produksi.

## Keputusan yang dibutuhkan dari Reza
**A. Stok & HPP selisihnya dicatat di tanggal mana?**
- A1 (saran) — omzet, kas/bank, piutang di tanggal struk; **koreksi stok & HPP di hari diubah**. Stok fisik
  memang dibetulkan hari itu; aman untuk perhitungan HPP struk-struk sesudahnya. Efek: laba kotor tanggal asli
  bisa sedikit beda sampai tanggal ubah.
- A2 — semuanya di tanggal struk (paling mirip Accurate). Perlu hitung ulang HPP semua penjualan sesudahnya
  (rata-rata bergerak) → jauh lebih besar & berisiko; ±2 minggu.

**B. Struk yang pakai promo/voucher**
- B1 (saran) — boleh diubah; diskon promo/voucher lama ikut terbawa apa adanya dan bisa diubah manual oleh
  Owner/Finance; kuota promo tidak dihitung ulang.
- B2 — promo dihitung ulang otomatis sesuai aturan promo (lebih rumit; kuota bisa sudah habis).
