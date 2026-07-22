# Fase 4 — Laporan ala Accurate (Design / Spec)

**Tanggal:** 2026-07-23
**Roadmap induk:** [Accurate Parity Roadmap](2026-07-22-accurate-parity-roadmap-design.md)
**Sumber:** Screenshot menu Laporan Accurate. Tab **Memorize** (favorit tim) = Laba/Rugi Klinik
per cabang, Laba/Rugi Petshop per cabang, histori bank/kas (sudah tercover rekonsiliasi VetOS).
Aging piutang/hutang sudah ada di VetOS (keuangan/piutang & /hutang).

## Scope (3 laporan, nempel ke halaman existing — bukan modul laporan baru)

### 1. Laba/Rugi per Unit (Klinik / Petshop) — `keuangan/laba-rugi`
- `LedgerFilter` + `branchIds?: string[]` (fetchLines pakai `.in()`).
- Param `cabang` menerima nilai khusus `unit:KLINIK` / `unit:PETSHOP` → resolve daftar branch
  via `branches.type`: KLINIK = [KLINIK, BOTH]; PETSHOP = [PETSHOP, BOTH].
- `PeriodFilter` dropdown cabang dapat 2 preset teratas: "— Semua Klinik —", "— Semua Petshop —".
- Ini meniru 2 laporan Memorize terpakai mereka (Laba/Rugi Klinik & Petshop per cabang).

### 2. Ringkasan Persediaan per Gudang (matrix) — `pos/stok`
- Opsi gudang "— Semua gudang (matrix) —": baris = barang, kolom = tiap gudang aktif
  (kode gudang), sel = qty, kolom Total. Scroll horizontal (25 gudang OK).
- Meniru laporan Persediaan/Gudang Accurate.

### 3. Penjualan per Cabang & per Barang + filter periode — `penjualan`
- Dashboard penjualan dapat filter GET `dari`/`sampai` (berlaku ke semua seksi).
- Seksi baru "Penjualan per Barang": agregat sale_items (qty & omzet), urut omzet desc.
- Seksi per cabang existing otomatis ikut periode.

## Out of scope
Laporan lain Accurate (100+) — tambah per permintaan. Histori bank/kas = rekonsiliasi existing.
Grafik-grafik — angka dulu.

## Test
`ledger` branchIds filter (unit resolve = query sederhana, dites lewat tipe); matrix pivot +
agregasi penjualan per barang = fungsi murni di `src/lib/laporan.ts` + unit test.
