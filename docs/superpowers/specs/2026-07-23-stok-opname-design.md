# Fase 3 — Stok Opname (Design / Spec)

**Tanggal:** 2026-07-23
**Roadmap induk:** [Accurate Parity Roadmap](2026-07-22-accurate-parity-roadmap-design.md)
**Sumber:** Screenshot Accurate — Perintah Stok Opname (OPO, 358 dok) + Hasil Stok Opname (OPR).
Fitur paling aktif di Accurate mereka: opname rutin bulanan per gudang, PJ Faizal/Ambar/andri.

## 1. Alur (niru Accurate, 2 dokumen)
1. **Perintah Stok Opname (OPO.NNNNN):** pilih gudang, tanggal mulai, penanggung jawab,
   dikerjakan oleh, keterangan (mis. "SO GRND JULI 2026"). Status `Terbuka` → `Selesai`.
2. **Hasil Stok Opname (OPR.NNNNN):** merujuk OPO. Semua barang ber-stok di gudang itu
   tampil dengan qty sistem; petugas isi qty fisik (default = sistem, edit yang beda).
   Simpan → stok di-set ke qty fisik, selisih dihitung & dijurnal, OPO jadi `Selesai`.

## 2. Skema (migrasi 0054)
```
coa: + 5902 "Selisih Persediaan" (BEBAN, D)   -- 1 akun dua arah (PRD 10.8 minta 2 akun
                                              -- 450101/650201; disederhanakan, COA VetOS 4 digit)
type opname_status enum ('Terbuka','Selesai')
opname_orders(id, no_opname uq OPO.NNNNN, warehouse_id->warehouses, tanggal_mulai,
  penanggung_jawab, dikerjakan_oleh, keterangan, status, created_by, created_at)
opname_results(id, no_hasil uq OPR.NNNNN, order_id->opname_orders, tanggal, created_by, created_at)
opname_result_items(id, result_id cascade, item_id->items, qty_sistem, qty_fisik, selisih)
```
RLS permissive (demo posture). Nomor = seq global count+1 pad 5 (format persis Accurate).

## 3. Penyesuaian saat simpan hasil
- qty_sistem dibaca ULANG saat submit (bukan snapshot form) → race-safe.
- `stock.qty = qty_fisik` per item; selisih = fisik − sistem.
- Nilai selisih pakai `items.buy_price` (konsisten HPP existing).
- Jurnal 1 entri (source `opname`):
  - lebih: Dr 1301 / Cr 5902 (nilai lebih)
  - kurang: Dr 5902 / Cr 1301 (nilai kurang)
- Semua baris disimpan (audit penuh ala Accurate, 357 barang per OPR tidak masalah).

## 4. UI (`/pos/opname`, tile "Stock opname" di modul POS)
- List perintah: No, tanggal, gudang, PJ, status, keterangan; tombol `+ Perintah opname`.
- `/pos/opname/baru`: form perintah (gudang, tanggal, PJ, dikerjakan oleh, keterangan).
- `/pos/opname/[id]`: Terbuka → tabel semua barang ber-stok (kode, nama, sistem, input fisik,
  selisih live) + Simpan Hasil. Selesai → tampil hasil tersimpan (readonly) + total selisih.

## 5. Ponytail / out of scope
- Filter Kategori/Pemasok/Merek pada perintah (ada di Accurate, opsional) — v2 bila diminta.
- Penanggung jawab & dikerjakan oleh = teks bebas (bukan relasi user) — cukup untuk audit.
- Barang yang tidak pernah ber-stok di gudang itu tidak muncul (opname = hitung yang ada).

## 6. Test (`src/lib/opname.ts`)
Format nomor OPO/OPR; hitung selisih & nilai (lebih/kurang) dari rows.
