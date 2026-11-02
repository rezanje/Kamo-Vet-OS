# Koreksi metode bayar POS ke semua metode (2 Nov 2026)

## Permintaan
Anisa (grup klinik, 14.54): "dibantu edit pembayaran ya mas, soalnya ada yang salah-salah nih metodenya."
Lanjutan 15.05–15.06: super admin perlu bisa edit penjualan, tanggal, pembayaran, pengeluaran, item/qty/total/harga.

## Temuan (data Production, baca saja)
- Koreksi metode yang ada hanya Tunai ↔ Transfer. Di toko yang sering salah: Tunai / QRIS / Debit
  (7 hari: Tunai 347, QRIS 220, Debit 69, Transfer 10, Split 5 struk). Belum pernah ada satu koreksi pun tercatat.
- Di Production, QRIS/Debit/Transfer semuanya masuk rekening bank yang sama (120002); Tunai ke kas 110003.

## Perubahan (scope batch ini: pembayaran POS saja)
- Migrasi `20261106050000_j02_koreksi_semua_metode_pos.sql`: fungsi baru `correct_pos_sale_payment_methods`
  — bagi ulang bagian pembayaran tanpa fee merchant ke Tunai/Transfer/Debit/Kredit/QRIS/E-Wallet.
  Aturan lain sama dengan koreksi lama (OWNER/FINANCE, juga sesudah shift ditutup, jurnal pembalik + pengganti
  bertanggal hari koreksi, jejak di `sale_payment_corrections`, idempoten, periode tertutup & rekonsiliasi bank
  ditolak). Bagian ber-fee merchant tetap utuh. Bayar/kembali mengikuti aturan J02_KEMBALIAN.
  Fungsi lama tidak diubah. Rollback: `docs/evidence/2026-11-02-j02-semua-metode/rollback.sql`.
- Form koreksi di detail penjualan: 6 kotak metode + tombol "Semua ke …".

## Yang sudah ada (tidak perlu dibangun)
- Pengeluaran: ubah tanggal, kategori, keterangan, jumlah, metode, atau batalkan — OWNER/ADMIN/FINANCE (menu Pengeluaran → buka → ubah).
- Penjualan barang/qty/harga: OWNER "Batalkan & siapkan pengganti" di detail penjualan (struk pengganti bertanggal hari ini).

## Belum (perlu keputusan)
- Edit langsung barang/qty/harga dengan tanggal asli, dan ubah tanggal penjualan.
- Koreksi metode bayar invoice klinik masih Tunai ↔ Transfer.
- Penjualan yang sudah dikoreksi metodenya belum bisa dibatalkan (penjaga lama).
- Selisih kas shift yang sudah ditutup (dan kasbon kasir) tidak ikut berubah saat metode dikoreksi sesudah tutup shift.

## Tes
- `supabase/tests/pos_payment_method_corrections_all_methods.sql` (baru) + `pos_payment_method_corrections.sql` (regresi)
  di PostgreSQL 16 sekali pakai dengan 362 migrasi: lulus.
- Vitest penuh 6.075 lulus; tsc bersih; lint 0 error.
