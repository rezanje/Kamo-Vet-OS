# Fase 6 — PPN & Mode PKP (Design / Spec)

**Tanggal:** 2026-07-24
**Keputusan boss (2026-07-22):** bangun lengkap, aktif via toggle Mode PKP (default OFF —
status PKP belum pasti).

## Temuan audit
PPN selama ini HARDCODED nyala: POS split inklusif /111 (kasir/checkout, pos/transaksi,
sinkron) dan klinik MENAMBAHKAN 11% di atas DPP ke tagihan pelanggan
(pembayaran actions:94). Belum PKP = tidak boleh mungut PPN → default OFF justru koreksi.

## 1. Setting
`company_settings` singleton: `mode_pkp bool default false`, `ppn_rate numeric default 11`.
UI `/pengaturan/pajak` (toggle + tarif). COA baru: `1105 PPN Masukan` (ASET, D).

## 2. lib/pajak.ts (pure, tested)
- `splitPpnInklusif(total, s)` → {dpp, ppn}: OFF → {total, 0}; ON → dpp = total×100/(100+rate).
- `tambahPpn(dpp, s)` → {tax, total}: OFF → {0, dpp}; ON → tax = dpp×rate/100.
- `getPajakSettings(supabase)` (server util, default OFF bila row belum ada).

## 3. Titik pemasangan
| Titik | Sebelum | Sesudah |
|---|---|---|
| kasir/checkout | selalu /111 | splitPpnInklusif(settings) |
| pos/transaksi actions | selalu /111 | splitPpnInklusif |
| klinik pembayaran | selalu +11% | tambahPpn (OFF → pelanggan TIDAK dibebani PPN) |
| keuangan/sinkron | selalu /111 | splitPpnInklusif |
| faktur pembelian | tanpa PPN | ON → PPN Masukan inklusif: Dr 1105, sisanya seperti semula (buildFakturLines dapat param ppn) |

## 4. Rekap PPN — `/keuangan/ppn`
Per bulan: PPN Keluaran (2201) − PPN Masukan (1105) = netto kurang/lebih bayar.
Bahan lapor SPT Masa. e-Faktur CSV = nanti kalau resmi PKP.

## Out of scope
Nomor seri faktur pajak, e-Faktur/Coretax export, PPnBM, PPh 22/23 pembelian.
