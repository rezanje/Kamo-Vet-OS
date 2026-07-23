# Fase 5 — Penjualan Online / B2C (Design / Spec)

**Tanggal:** 2026-07-23
**Roadmap induk:** [Accurate Parity Roadmap](2026-07-22-accurate-parity-roadmap-design.md) — item #5, penutup roadmap.

## Konteks
`branch_type`/`warehouse_type` enum sudah punya nilai `ONLINE` sejak migrasi 0001, tapi belum
ada cabang/gudang ONLINE nyata dan belum ada alur order yang memakainya. Boss belum tentukan
struktur cabang/gudang online (berapa, di mana) — jadi fitur ini dibangun **generik & siap
pakai**, tanpa nge-seed data cabang/gudang. Kalau belum ada gudang tipe ONLINE aktif saat form
dibuka, tampil pesan jelas, bukan error mentah.

Channel real: **Shopee, Tokopedia, TikTok Shop** (marketplace — potong komisi, dana cair
telat) dan **WA/Transfer Manual** (langsung lunas ke bank, non-marketplace).

## Keputusan bisnis (dikunci dari brainstorming)
- Order online **tanpa cashier shift** — beda alam dari POS retail yang wajib rekonsiliasi tunai.
- Marketplace: dicatat **Piutang Marketplace** dulu, komisi baru kehitung saat pencairan aktual
  (bukan tebak % di depan) — fleksibel & sesuai kondisi nyata (dana cair beda jumlah/waktu).
- Buyer marketplace = **teks bebas**, tidak masuk CRM/poin/tier (beda alam dari pelanggan
  retail/klinik). Buyer **WA boleh** link ke `customers` (dapat poin/tier normal).
- Tidak ada seed cabang/gudang ONLINE default — nunggu keputusan boss, master data ditambah
  manual (SQL) kapan pun siap.

## Skema DB (migrasi 0062)

`sales` — kolom baru, semua nullable (baris POS/klinik existing tidak terpengaruh):
```
channel            varchar(20)   -- 'Shopee' | 'Tokopedia' | 'TikTok Shop' | 'WA', null = POS retail
external_ref       varchar(60)   -- no. order marketplace / referensi WA (opsional)
buyer_name         varchar(120)  -- nama pembeli teks bebas (marketplace; WA opsional kalau tanpa customer_id)
marketplace_status varchar(16)   -- 'piutang' | 'cair', null kalau bukan channel marketplace
komisi             numeric not null default 0  -- terisi saat pencairan
disbursed_at       timestamptz
```
Check constraint: `channel is null or channel in ('Shopee','Tokopedia','TikTok Shop','WA')`.

`coa_accounts` — 2 akun baru:
```
1202  Piutang Marketplace          ASET   D
5305  Beban Komisi Marketplace     BEBAN  D
```

## Alur A — Buat order online (`/penjualan/online/baru`)
Form 1 halaman, pola sama seperti `POForm.tsx` (item picker via `<datalist>`, baris dinamis,
JSON di hidden input, server action) — bukan cart JS interaktif ala kasir karena tidak perlu
kalkulasi kembalian/tunai real-time.

Field: cabang (dropdown cabang yang punya gudang aktif tipe `ONLINE` — kosong → pesan "Belum
ada gudang ONLINE dikonfigurasi, hubungi admin"), channel (select 4 opsi), buyer_name (teks),
external_ref (opsional), tanggal, baris item (nama/qty/harga dari master SKU). Kalau
channel = `WA` → tambahan field opsional "Link pelanggan" (datalist customer existing, sama
pola pencarian yang sudah ada di kasir).

Server action `buatPenjualanOnline`:
1. Validasi channel valid, ≥1 item, resolve gudang `ONLINE` aktif di cabang terpilih (gagal →
   redirect error, tidak insert apa pun).
2. `no_struk` = `ONL-YYYYMMDD-NNNN` (count+1 per hari, pola sama nomor dokumen lain — ponytail).
3. Insert `sales` (branch_id, channel, external_ref, buyer_name, customer_id kalau WA+link,
   metode_bayar = channel, subtotal/total dari baris, marketplace_status = `'piutang'` kalau
   channel marketplace, else null).
4. Insert `sale_items`.
5. `stockOut` FIFO per item dari gudang ONLINE (fungsi existing `src/lib/inventory.ts`,
   sama seperti checkout POS) → total HPP riil.
6. Kalau `customer_id` terisi (khusus WA): earn poin + `recomputeCustomerTier` (reuse logic
   existing, sama rumus `floor(total/1000)`).
7. Jurnal pendapatan (`postJournal`, reuse existing):
   - Marketplace → **Dr 1202 Piutang Marketplace / Cr 4101** (+ 2201 PPN Keluaran kalau Mode
     PKP nyala, split inklusif — pola sama `checkout.ts`).
   - WA → **Dr 1102 Bank / Cr 4101** (+PPN), identik pola POS non-tunai.
8. Jurnal HPP: **Dr 5101 / Cr 1301** sebesar cost FIFO (pola sama checkout.ts).

## Alur B — List & status (`/penjualan/online`)
Tabel semua order online: no_struk, tanggal, channel (badge beda warna), buyer/cabang, total,
status — `Lunas` (WA), atau `Piutang`/`Cair` (marketplace) + tombol **"Tandai Cair"** kalau
masih piutang.

## Alur C — Tandai Cair (pencairan marketplace)
Modal/form kecil: input **nominal diterima di bank**. Server action `tandaiCair(saleId, nominal)`:
1. Guard: sale harus channel marketplace & `marketplace_status = 'piutang'`.
2. `komisi = max(0, total - nominal)`.
3. Update sale: `marketplace_status='cair'`, `disbursed_at=now()`, `komisi`.
4. Jurnal: **Dr 1102 Bank (nominal) + Dr 5305 Beban Komisi (komisi) / Cr 1202 Piutang
   Marketplace (total)**.

Simplifikasi disengaja: 1 order = 1 pencairan (marketplace asli sering batch banyak order
jadi 1 pencairan) — cukup untuk volume awal. Upgrade ke pencairan batch kalau volume online
naik dan rekonsiliasi per-order jadi beban.

## Sentuhan laporan (kecil, reuse pola existing)
- `penjualan` (Rekap Penjualan) Seksi 01: tambah baris **"Online"** (`sales` dengan
  `channel is not null`), terpisah dari baris "POS" (`channel is null`). Total gabungan jadi
  3 baris (POS + Klinik + Online).
- `keuangan/laba-rugi`: `resolveUnitTypes` (`src/lib/laporan.ts`) tambah `ONLINE` →
  `["ONLINE"]`; `PeriodFilter.tsx` tambah opsi `— Semua Online —`. Baru berguna begitu ada
  cabang tipe ONLINE nyata — tidak menunggu itu untuk ship (opsi cuma nongol kosong dulu).

## Out of scope
Storefront/checkout publik, integrasi API marketplace (auto-tarik order), pencairan batch
multi-order, seed cabang/gudang ONLINE (nunggu boss).

## Test
`resolveUnitTypes` kasus `ONLINE` (unit test, `src/lib/laporan.ts`); komisi/pencairan
(`komisi = max(0, total - nominal)`) sebagai fungsi murni + unit test di `src/lib/` yang sama
tempat helper retur/HPP FIFO lain hidup.
