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

## Tahap 2 — DIBANGUN (migrasi 20261115500000, keputusan Reza 12 Nov: 2A, 3A, Owner + Finance)
Rancangan "ubah di struk yang sama" ditinggalkan: setiap fungsi hilir (pembatalan, koreksi metode, batal penerimaan,
retur, laporan) mengandaikan satu jurnal `sale` per nomor struk. Yang dibangun = **tutup + ganti atomik** (pola klinik
"void & terbitkan ulang") di satu transaksi database, sehingga semua jalur lama tetap berlaku untuk struk hasil ubah.

`edit_posted_pos_sale(sale, revisi, kunci, alasan, isi)` — Owner/Finance:
1. Struk lama ditutup lewat `pos_sale_edit_void` (turunan berjangkar `cancel_posted_sale`, hanya bisa dipanggil di
   gerbang privat): jurnal pendapatan/kas + pasangan koreksi metode dibalik **di tanggal jurnalnya masing-masing**;
   jurnal HPP dibalik & stok dikembalikan **hari ini**; shift tertutup boleh; promo/voucher boleh; efek quest staf
   **dipindah** ke struk baru (tidak dibalik → aturan urutan quest tidak memblokir).
2. Struk baru: `created_at` = lama + 1 ms (tanggal & urutan asli), kasir/shift/sales/pelanggan/pet sama, nomor
   `<asli>-U<n>`; diposting oleh jalur resmi (trigger pembayaran, `cashier_post_stock_atomic` / `finalize_pos_sale`):
   pendapatan di tanggal struk, stok & HPP hari ini, lantai harga P03 tetap berlaku. Metode bayar yang sudah ada tetap
   di rekening tercatatnya (mis. Kas Kecil 1–6 Nov); metode baru memakai peta sekarang.
3. Jalur khusus hanya di gerbang `pos_sale_edit_gate` (per transaksi, tak bisa ditulis klien): pemeriksaan pelaku/shift,
   snapshot kasir, cek ulang promo/kuota/kampanye (3A), tanggal stok = hari ini, tanggal jurnal HPP = hari ini.
4. Jejak `sale_edits` (sebelum/sesudah, alasan, pelaku, waktu nyata), idempotensi `sale_edit_requests`.
5. Ditolak: periode tanggal struk/hari ini tutup buku; rekonsiliasi bank ≥ tanggal struk di rekening terkait; retur
   aktif / refund; pernah batal penerimaan; bulan sudah digaji; poin pelanggan sudah terpakai; struk tanpa shift.

Aplikasi: tombol **Ubah transaksi** di detail struk (Owner/Finance) → `/penjualan/[id]/ubah`: ubah qty/harga/satuan/
diskon baris (atau diskon promo lama), hapus baris, tambah barang (bukan paket), diskon golongan & potongan lain,
pembayaran per metode + fee merchant → Simpan → buka struk baru. Struk lama menampilkan "sudah diubah → buka struk
terbaru"; panel Riwayat menampilkan peristiwa ubah.

Batasan versi ini: paket (Grup) baru tidak bisa ditambahkan dari layar ubah (paket lama bisa diubah qty / dihapus);
uang tunai yang diserahkan/kembalian tidak dibawa (Dibayar = total); laci shift tertutup tidak diubah; poin dipakai tetap.

## Keputusan Reza (12 Nov): A1 dan B1 dipilih
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
