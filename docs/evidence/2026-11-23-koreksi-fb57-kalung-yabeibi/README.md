# Koreksi FB.2026.11.00057: Kalung Yabeibi Lonceng Besar (23 Nov 2026)

**Permintaan:** user (via Reza): baris "Kalung Yabeibi Lonceng Besar" seharusnya **60 PCS @ Rp 6.666**,
bukan 30 PCS @ Rp 13.334. Keputusan Reza: (1A) tambahan 30 pcs fisiknya masih di DC LOJI;
(2A) total faktur tetap Rp 11.520.000 sesuai nota supplier, selisih Rp 60 ditutup lewat baris Pembulatan Invoice.

**Kenapa koreksi data langsung:** koreksi resmi (`correct_purchase_invoice_line`) menolak qty naik dan menolak
barang yang sudah dipindah gudang. Ke-30 pcs sudah dikirim dari DC ke Transit/cabang (PRM-20261116-0007/0009,
PRM-20261117-0004/0009/0012), belum ada yang terjual. Faktur belum dibayar dan belum pernah dikoreksi.

**Yang diubah (`apply.sql`, satu blok DO, tiap langkah dicek jumlah barisnya):**
- baris kalung 30 @ 13.334 → 60 @ 6.666; baris Pembulatan Invoice 1 @ 10 → 1 @ 70; revisi faktur 0 → 1;
  total faktur tetap 11.520.000;
- layer asal faktur di DC LOJI: qty_in 30 → 60, qty_left 0 → 30, harga 6.666; stok DC LOJI 0 → 30;
- 10 layer turunan (Transit & cabang) dan 19 mutasi kirim/terima permintaan: harga 13.334 → 6.666
  (ID layer dipertahankan supaya penerimaan/pembatalan kiriman tetap jalan);
- mutasi faktur kalung: qty 30 → 60, harga 6.666; layer & mutasi Pembulatan: 10 → 70;
- snapshot bukti posting (`purchase_invoice_postings.stock_moves`, `purchase_invoice_layer_proofs.after_state`)
  ikut keadaan baru.

**Jurnal:** tidak ada jurnal baru. Nilai persediaan kalung turun Rp 60 (400.020 → 399.960) dan pembulatan naik
Rp 60 (10 → 70), keduanya di akun 170001 Persediaan. Jurnal JRN-202611-16325 (D 170001 / K 311001
11.520.000) tetap benar. Pindah gudang tidak menjurnal.

**Verifikasi setelah apply:** total faktur 11.520.000 = jumlah baris; stok kalung 70 = jumlah layer per gudang
(DC LOJI 30 @6.666, Transit 11, BTKM 9, GRND 6, CMGG 6, CMS 6, MUAR 2); tidak ada lagi mutasi berharga 13.334.

**Rollback:** `rollback.sql`. Hanya aman sebelum ada mutasi baru kalung ini.

**Celah produk (belum dikerjakan):** koreksi faktur pembelian untuk menaikkan qty dan untuk barang yang sudah
dipindah gudang.
