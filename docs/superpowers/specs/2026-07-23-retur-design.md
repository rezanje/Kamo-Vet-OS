# Fase 2 — Retur Pembelian & Retur Penjualan (Design / Spec)

**Tanggal:** 2026-07-23
**Roadmap induk:** [Accurate Parity Roadmap](2026-07-22-accurate-parity-roadmap-design.md)
**Sumber:** Screenshot Accurate (Retur Pembelian + Retur Penjualan, dua-duanya 0 data → versi lean).
**Keputusan boss (2026-07-23):** Retur penjualan = **refund tunai di kasir**. Retur pembelian = **potong hutang pemasok**.

## 1. Alur
- **Retur Pembelian:** pilih PO status `Diterima` (label pemasok) → pilih barang + qty (≤ qty PO − sudah diretur)
  → stok KELUAR dari gudang PO → hutang berkurang → jurnal `Dr 2101 Hutang / Cr 1301 Persediaan` (nilai = qty × harga_beli PO).
  Guard: nilai retur ≤ sisa hutang (total − dibayar − retur sebelumnya).
- **Retur Penjualan:** cari struk POS (`no_struk`) → pilih barang + qty (≤ qty terjual − sudah diretur)
  → stok MASUK ke gudang cabang penjualan (logika gudang sama dgn checkout) → refund tunai dicatat sebagai
  `expenses` kategori `Retur Penjualan` (shift_id = shift open kasir di cabang itu bila ada → kepotong otomatis
  di tutup shift) → jurnal `Dr 4101 Pendapatan / Cr 1101 Kas` (refund) + `Dr 1301 / Cr 5101` (stok balik, nilai buy_price).
- Nomor otomatis: `RB.YYYY.MM.NNNNN` (beli) / `RJ.YYYY.MM.NNNNN` (jual), seq per bulan (pola pemindahan).

## 2. Skema (migrasi 0053)
```
purchase_returns(id, no_retur uq, po_id->purchase_orders, tanggal, keterangan, total, created_by, created_at)
purchase_return_items(id, return_id cascade, item_id->items, nama, qty>0, harga)
sales_returns(id, no_retur uq, sale_id->sales, tanggal, keterangan, total, created_by, created_at)
sales_return_items(id, return_id cascade, item_id->items, nama, qty>0, harga)
```
RLS permissive (demo posture 0025/0032).

## 3. Dampak modul lain
- `keuangan/hutang`: sisa = total − dibayar − **retur** (page + guard bayarHutang).
- Tutup shift: otomatis benar — refund masuk `expenses` Tunai ber-shift_id (expectedCash sudah menghitung expenses).

## 4. UI
- `/pembelian/retur` list (+ `/baru` form) — tile "Retur pembelian" di modul Pembelian.
- `/penjualan/retur` list (+ `/baru` form) — tile "Retur penjualan" di modul Penjualan.
- Form ala Accurate: dokumen sumber → rincian barang (nama, kode, qty, @harga, total) → total footer.

## 5. Penyederhanaan (ponytail)
- Diskon level transaksi struk diabaikan di refund (refund = qty × harga item). Diskon per item sudah ada di harga sale_items.
- PPN refund tidak dipecah (Mode PKP belum aktif); saat PKP nyala, tambah baris 2201.
- Retur klinik (invoice) di luar scope — retur barang ritel saja.

## 6. Test
`src/lib/retur.ts`: format nomor RB/RJ; sisa qty returnable per item (reuse pola sisaTransit); total retur.
