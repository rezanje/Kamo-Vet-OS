# Fase Akuntansi Final — HPP FIFO + Neraca Saldo + Jurnal Berulang (Design / Spec)

**Tanggal:** 2026-07-24
**Konteks:** PR akuntansi terakhir paritas Accurate. PRD §10.2 mengunci metode FIFO.
Sebelumnya HPP = `items.buy_price` statis × qty → laba & nilai stok melenceng saat harga
beli berubah.

## 1. HPP FIFO — arsitektur
### Cost layers (migrasi 0058)
```
stock_layers(id, warehouse_id->warehouses, item_id->items, tanggal date,
  qty_in numeric, qty_left numeric >=0, unit_cost numeric,
  source varchar, source_ref varchar, created_at)
index (item_id, warehouse_id) where qty_left > 0
```
Seed: 1 layer `saldo-awal` per baris stok existing (qty>0) @ `items.buy_price` —
bootstrap tanpa ubah nilai buku.

### lib/inventory.ts
- `consumeLayers(layers, qty)` (PURE, dites): FIFO by (tanggal, created_at) → per-layer
  consumed + total cost + shortfall.
- `stockIn(supabase, {warehouseId, itemId, qty, unitCost, source, ref, tanggal})`:
  insert layer + naikkan `stock.qty`.
- `stockOut(supabase, {warehouseId, itemId, qty, source, ref})`: konsumsi layer FIFO
  (update qty_left), turunkan `stock.qty`, return total cost. Shortfall (stok minus /
  data pra-FIFO) dihargai `items.buy_price` — tidak bikin layer negatif.
- `getFifoCost` dipakai jurnal HPP: penjualan & opname kurang pakai cost RIIL FIFO.
- ponytail: mutasi JS read-then-update (pola existing seluruh repo); kalau kelak race
  jadi masalah nyata → pindah ke RPC transaksi.

### Titik pemasangan (semua mutasi stok lewat lib)
| Situs | Arah | unit_cost |
|---|---|---|
| pembelian PO Diterima | IN | harga_beli PO (sumber cost utama) |
| kasir/checkout | OUT | FIFO → jurnal HPP |
| pos/transaksi | OUT | FIFO → jurnal HPP |
| klinik rekam-medis / rawat-inap / racik | OUT (racik: ±) | FIFO (belum ada jurnal HPP klinik — perilaku tetap) |
| klinik/penerimaan + kasir/persediaan terima | IN | buy_price (transfer internal request-flow) |
| pos/stok tambahStok | IN | buy_price |
| pemindahan kirim | OUT asal → IN Transit | cost FIFO ikut pindah |
| pemindahan terima | OUT Transit → IN tujuan | cost FIFO ikut pindah |
| retur pembelian | OUT | FIFO (jurnal potong hutang tetap @ harga PO) |
| retur penjualan | IN | buy_price (jurnal reversal HPP tetap) |
| opname | selisih + IN @buy_price; − OUT FIFO | jurnal selisih kurang pakai cost FIFO riil |

## 2. Neraca Saldo — `/keuangan/neraca-saldo`
Trial balance dari `getAccountBalances` (filter periode + cabang): kolom Debit/Kredit
per akun + total seimbang.

## 3. Jurnal Berulang — `/keuangan/jurnal-berulang`
```
recurring_journals(id, nama, deskripsi, day_of_month int 1..28, branch_id?,
  lines jsonb [{code,debit,credit}], is_active, last_posted char(7) YYYY-MM, created_by)
```
Catch-up pola penyusutan: saat halaman Jurnal dibuka, semua recurring aktif yang
`last_posted` < bulan berjalan diposting (tanggal = day_of_month bulan ybs, sampai bulan
berjalan) lalu `last_posted` maju. Idempotent via last_posted.

## Out of scope
Revaluasi layer historis (jurnal lama tidak disentuh); laporan kartu HPP per layer;
multi-metode costing per item.
