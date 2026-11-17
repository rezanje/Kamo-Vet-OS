# 17 Nov 2026 — Kartu Stok bertautan, pembayaran hutang (rekening & sisa sen)

## 1. Kartu Stok: No. Sumber bisa diklik
- `src/lib/kartu-stok-tautan.ts`: peta `stock_moves.source` → tabel dokumen (nomor atau UUID). Satu query `.in()` per tabel
  untuk baris yang tampil; tidak ketemu / tabel tak terbaca = teks biasa (tanpa tautan buntu, kartu tetap tampil).
- Permintaan barang: `kirim/batal-kirim` menyimpan `no_request`, `terima/retur-permintaan` menyimpan id permintaan → keduanya ke `/pos/permintaan/<id>`.
- Sumber tanpa tautan: saldo awal, `sale-void`/`return-record-void` (id audit), `manual`.

## 2. Faktur pembelian: "Buka pembayaran ini" tidak melakukan apa-apa
- Tautan itu menunjuk ke anchor dirinya sendiri (pembayaran tidak punya halaman sendiri). Diganti: **Rekening** (dibaca dari
  baris kredit jurnal pembayaran yang cocok dengan `cash_accounts.coa_code`, termasuk hasil "— ikut peta —") + **Lihat jurnal pembayaran**.
- User tanpa izin `pembelian.batalkan_pembayaran` kini diberi tahu jalurnya (Owner membatalkan / beri izin di Akses Grup).
- Anchor `payment-*`/`receipt-*` yang dibuka dari "Dokumen terkait" disorot (`:target`).
- Catatan: pembayaran "tanpa pilih kas" memang sah — kosong = ikut Peta Rekening Pembayaran per metode.

## 3. Sisa hutang bersen (Rp 0,98) tidak bisa dilunasi
- Faktur ber-PPN bisa bertotal sen (jurnal faktur Cr hutang 3.585.410,98). Pembayaran wajib rupiah bulat & ≤ sisa → mustahil.
- Migrasi `20261122100000_bayar_hutang_sisa_sen.sql` (tambalan berjangkar, tanpa ubah data):
  - `pay_purchase_invoice_atomic`: nominal 2 desimal hanya bila = sisa persis; cicilan tetap bulat; jurnal pakai nominal persis
    (untuk nominal bulat identik dengan sebelumnya).
  - `cancel_purchase_payment(...,date)`: sumber bernominal sen boleh dibatalkan.
- Uji lokal PG16 (skema penuh 442 migrasi): `supabase/tests/bayar_hutang_sisa_sen.sql` — RED tanpa migrasi, GREEN dengan migrasi.
  Suite tetangga hasilnya identik sebelum/sesudah (purchase_payment_corrections, purchase_payment_atomic, po_price_after_advance
  sudah gagal di baseline karena fixture lama; purchase_advance_precision, purchase_advance_atomic, p08_advance_cancel_cascade lulus).
- **Migrasi belum dipasang ke Production.** Sebelum dipasang, perbaikan layar sen sudah aktif tapi database masih menolak sen.
- Belum disentuh: Perintah Bayar (bayar beberapa faktur sekaligus) masih rupiah bulat.
