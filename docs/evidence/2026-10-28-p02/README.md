# P02 owner-apply — koreksi harga faktur pembelian

Urutan (Supabase SQL editor, project produksi, oleh owner):

1. `preflight.sql` — hanya baca. Semua `ok` harus `true`. Bila akun 1301/5101/1105/2101 ada yang tidak aktif, berhenti dan aktifkan dulu.
2. `apply.sql` — salinan persis migrasi `supabase/migrations/20261028160000_purchase_invoice_line_correction.sql`. Aman diulang.
3. `readback.sql` — hanya baca. Semua `ok` harus `true`.
4. Baru merge PR. Sebelum migrasi, halaman koreksi hanya menampilkan pesan error (tidak menulis apa pun).

`rollback.sql` hanya bila diputuskan owner dan belum ada koreksi tersimpan.

Uji: `python3 scripts/test-purchase-invoice-correction-postgres.py --pg-bin /opt/homebrew/opt/postgresql@16/bin` (dan `@17`):
seluruh migrasi repo + suite `supabase/tests/purchase_invoice_line_correction.sql` dalam mode FIFO dan average.
Log: `native-pg16.log`, `native-pg17.log`.

## Aturan yang diterapkan
- Hanya OWNER aktif; pratinjau dan simpan memakai jalur hitung yang sama (pratinjau dibatalkan otomatis).
- Sisa stok faktur ini → nilai persediaan (FIFO: lapisan baru berharga baru; average: rata-rata dihitung ulang).
- Bagian yang sudah keluar → HPP (5101) di tanggal koreksi. PPN masukan (1105) dan hutang (2101) ikut.
- Ditolak bila: total baru < pembayaran (+ perintah bayar aktif), qty naik, qty turun melebihi sisa stok,
  faktur PO minta ubah qty (pakai Retur Pembelian), ada retur PO aktif, PPN lewat masa, tarif/mode PPN berubah,
  barang sama di beberapa baris, faktur saldo awal/dibatalkan, atau dampak berubah sejak pratinjau.
- Batal faktur setelah koreksi tetap ditolak oleh pemeriksaan bukti stok yang sudah ada.

## Batasan yang diketahui
- "Sudah keluar" = semua pengeluaran dari lapisan faktur ini (jual, pakai, transfer, opname). Bila sebagian
  barang ditransfer ke gudang lain, selisihnya tetap dibukukan ke HPP, bukan ke stok gudang tujuan.
