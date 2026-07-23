# Fase Akuntansi 2 — Faktur Pembelian (Design / Spec)

**Tanggal:** 2026-07-24
**Konteks:** Selama ini hutang lahir dari PO (nilai PO). Accurate: hutang lahir dari FAKTUR
pemasok — nilainya bisa beda dari PO (harga berubah), punya no. faktur pemasok & jatuh tempo,
dibayar per faktur. (PRD §8.3.)

## 1. Alur baru (ala Accurate, disederhanakan)
1. PO → Diterima (stok masuk) → jurnal `Dr 1301 Persediaan / Cr 2102 Hutang Belum Difakturkan`
   (dulu langsung 2101 — dipindah ke akun antara/GRNI, akun baru).
2. **Faktur Pembelian (FB.YYYY.MM.NNNNN):** pilih PO Diterima → rincian tersalin dari PO,
   qty & harga BISA DIEDIT (harga faktur pemasok ≠ harga PO), isi no. faktur pemasok +
   jatuh tempo (default +30 hari). Boleh multi-faktur per PO (qty difakturkan ≤ qty PO).
   Jurnal: `Dr 2102 (nilai PO porsi difakturkan) / Cr 2101 Hutang Usaha (nilai faktur)`;
   selisih harga → `1301` (Dr bila faktur > PO, Cr bila faktur < PO) — koreksi nilai persediaan.
3. **Bayar per faktur** (menggantikan bayar per PO): `purchase_invoice_payments`,
   jurnal `Dr 2101 / Cr Kas/Bank`. Guard ≤ sisa faktur.
4. Retur pembelian tetap per PO (existing); pengurang hutang di level pemasok.

## 2. Skema (migrasi 0056)
```
coa: + 2102 "Hutang Belum Difakturkan" (LIABILITAS, K)
purchase_invoices(id, no_faktur uq FB.YYYY.MM.NNNNN, no_faktur_pemasok, po_id->purchase_orders,
  supplier_id->suppliers, tanggal, jatuh_tempo, total, keterangan, created_by, created_at)
purchase_invoice_items(id, invoice_id cascade, item_id->items, nama, qty>0, harga)
purchase_invoice_payments(id, invoice_id->purchase_invoices, tanggal, amount, metode, catatan, created_by)
```

## 3. Halaman Hutang (rework)
- Seksi faktur: aging pakai **jatuh tempo** (bukan tanggal PO) — lebih benar ala Accurate.
  Sisa = faktur.total − pembayaran faktur. Bayar per faktur di sini.
- Seksi "PO Diterima belum difakturkan": nilai 2102 berjalan, link buat faktur.
  (Legacy: PO lama yang terlanjur di-jurnal ke 2101 & po_payments tetap kebaca sebagai riwayat.)
- Retur pembelian mengurangi total hutang pemasok (ditampilkan sebagai pengurang).

## 4. UI
- `/pembelian/faktur` list (no, tanggal, jatuh tempo, pemasok, PO, total, sisa) + `/baru`
  (pilih PO → rincian editable qty/harga → total live → simpan).
- Tile "Faktur pembelian" di modul Pembelian dapat href.

## 5. lib/faktur-beli.ts (tested)
- `formatNoFaktur(date, seq)` FB.YYYY.MM.NNNNN.
- `hitungSelisihFaktur(nilaiPO, nilaiFaktur)` → arah jurnal 1301.
- `sisaFakturable(qtyPO, qtySudahDifakturkan)` (reuse pola sisaRetur).

## Catatan migrasi data
PO lama yang sudah Diterima sebelum fase ini ter-jurnal ke 2101 (bukan 2102) — faktur untuk
PO tsb akan men-debit 2102 tanpa saldo → 2102 minus sebesar itu. Data uji cuma 1 PO; dibiarkan
(demo). Produksi mulai bersih dari alur baru.
