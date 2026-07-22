# Fase 1 — Pemindahan Barang antar Gudang (Design / Spec)

**Tanggal:** 2026-07-22
**Roadmap induk:** [Accurate Parity Roadmap](2026-07-22-accurate-parity-roadmap-design.md)
**Sumber:** Screenshot Accurate "Pemindahan Barang" PT Kamo Group + audit skema stok existing.

## 1. Tujuan
Kloning menu Accurate "Pemindahan Barang": pindah stok antar ±30 gudang (DC/WH, VET/ONLINE) dengan pola Kirim → Transit → Terima. **Tanpa approval** (langsung kirim, keputusan boss 2026-07-22).

## 2. Alur (dari Accurate)
- **Kirim Barang:** gudang asal buat dokumen → stok pindah dari gudang asal ke **Transit** → status `Sedang dikirim`.
- **Terima Barang:** gudang tujuan buat dokumen yang merujuk dokumen kirim → stok pindah dari Transit ke gudang tujuan → status dokumen kirim jadi `Diterima Sebagian`/`Diterima Seluruhnya`.
- Nomor otomatis `IT.YYYY.MM.NNNNN` (reset seq per bulan).
- Multi-barang per dokumen; kolom: Nama Barang, Kode #, Kuantitas, Satuan, Kategori.

## 3. Skema DB (migrasi 0052)
```
type transfer_proses enum ('Kirim Barang','Terima Barang')
type transfer_status enum ('Sedang dikirim','Diterima Sebagian','Diterima Seluruhnya','Dibatalkan')

table stock_transfers
  id uuid pk
  no_pemindahan text unique       -- IT.YYYY.MM.NNNNN
  proses transfer_proses
  tanggal date
  from_warehouse_id uuid -> warehouses   -- gudang asal (Kirim) / gudang pengirim (Terima)
  to_warehouse_id   uuid -> warehouses   -- gudang tujuan
  keterangan text
  status transfer_status              -- dipakai utk dokumen Kirim; Terima ikut induk
  source_transfer_id uuid -> stock_transfers  -- diisi utk dokumen Terima (rujuk Kirim)
  created_by uuid -> profiles
  created_at timestamptz

table stock_transfer_items
  id, transfer_id -> stock_transfers (cascade)
  item_id -> items
  qty numeric                       -- dikirim (Kirim) / diterima (Terima)

table transfer_counters             -- nomor otomatis atomik
  period text pk (YYYY.MM), last int
```
RLS: gate via warehouse → branch (`user_can_access_branch`), plus gudang Transit shared (pola 0037).

## 4. Logika Stok (reuse tabel `stock` yang ada)
- **Transit = satu gudang khusus per perusahaan** (flag `is_transit`), meniru "Transit (AOL System)". Tidak ada konsep inventori baru — cuma pindah baris qty di tabel `stock`.
- **Kirim:** `stock[from] -= qty`, `stock[Transit] += qty`. Tolak bila stok gudang asal kurang.
- **Terima:** `stock[Transit] -= qty`, `stock[to] += qty`. Update status dokumen Kirim (bandingkan total dikirim vs total diterима).
- Semua mutasi dalam 1 RPC transaksional (Postgres function) biar konsisten.

## 5. Jurnal
Tidak ada jurnal P&L. Semua gudang milik satu badan (PT Kamo Group) → pemindahan cuma ubah lokasi, nilai inventori tetap. (Sama seperti Accurate: Pemindahan Barang bukan transaksi laba-rugi.)
`ponytail:` bila kelak butuh reklas aset antar cabang, tambah jurnal Transit di fase lanjut.

## 6. UI (route `/pos/pemindahan`)
- **List:** filter Tanggal / Status Pengiriman / Tipe Proses / Gudang / Gudang Tujuan; kolom Nomor #, Tanggal, Tipe Proses, Gudang Tujuan/Dari, Gudang, Keterangan, Status. Tombol `+`.
- **Baru (Kirim):** Proses, Gudang asal, Gudang tujuan, Tanggal, tabel pilih barang (search by nama/kode), simpan.
- **Baru (Terima):** pilih dokumen Kirim → prefill barang → edit qty diterima → simpan.
- **Detail:** ringkasan dokumen + daftar barang + status.

## 7. Test (minimal)
- Kirim kurangi stok asal & tambah Transit; tolak bila stok kurang.
- Terima penuh → status `Diterima Seluruhnya`; sebagian → `Diterima Sebagian` + sisa tetap di Transit.
- Nomor otomatis unik & urut per bulan.

## 8. Out of scope Fase 1
Retur, opname, jurnal antar-cabang, channel online, PPN. (Fase berikutnya di roadmap induk.)
