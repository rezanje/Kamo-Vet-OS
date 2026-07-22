# VetOS — Roadmap Paritas Fitur Accurate (Design / Spec)

**Tanggal:** 2026-07-22
**Konteks:** PT Kamo Group Sejahtera pindah dari Accurate Online ke VetOS. VetOS sudah menutup ±80% fungsi Accurate. Dokumen ini mengunci sisa lubang + urutan pengerjaan + pembagian owner.

---

## 1. Yang Sudah Ada (parity tercapai — tidak diubah)

- **Akuntansi inti:** COA (SAK), jurnal, buku besar, neraca, laba-rugi, arus kas, aset tetap + penyusutan, hutang (AP), piutang (AR), rekonsiliasi bank.
- **Operasional:** Pembelian (PO, penerimaan, faktur, pembayaran), Penjualan, POS/kasir + shift, stok dasar, permintaan & penerimaan stok antar unit.
- **Klinik:** registrasi, rekam medis, rawat inap, resep, racik/BOM, pembayaran, follow-up.
- **HRIS:** karyawan, penggajian (PPh21, BPJS), absensi, cuti, KPI.
- **CRM:** pelanggan, anabul, promo, tier loyalti.

Sumber: `src/app/(app)/*`, `supabase/migrations/0001–0051`, PRD v2.0.

## 2. Gap vs Accurate (yang dikerjakan)

| # | Fitur | Status sekarang | Kebutuhan |
|---|-------|-----------------|-----------|
| 1 | **Pindah Barang antar gudang** (Transit) | Baru ada permintaan/penerimaan stok, belum transfer penuh + jurnal Transit | ±30 gudang (DC + WH, VET vs ONLINE). Jantung Accurate mereka |
| 2 | **Retur Pembelian & Retur Penjualan** | Belum ada modul retur | Barang balik + koreksi stok & jurnal otomatis |
| 3 | **Stok Opname** | Baru manual via jurnal | Hitung fisik per gudang → adjustment otomatis |
| 4 | **Laporan ala Accurate** | Laporan dasar ada | Aging AR/AP, stok per gudang, laba per produk & per cabang |
| 5 | **Channel Online / B2C** | Belum terpisah | WH ONLINE — penjualan online dipisah dari retail |
| 6 | **PPN 11% + Faktur Pajak** | Belum ada | Gated di belakang toggle **Mode PKP** (default OFF) |

## 3. Urutan Pengerjaan (dikunci)

1. **Pindah Barang antar gudang + Transit** ← mulai di sini (dampak terbesar, sesuai pola Accurate mereka)
2. Retur Pembelian & Penjualan
3. Stok Opname
4. Laporan ala Accurate
5. Channel Online / B2C
6. PPN + Faktur Pajak (build lengkap, aktif via toggle Mode PKP)

## 4. Pembagian Owner

- **CTO (Claude):** desain DB, koding, migrasi Supabase, tes, deploy. Boss tidak menyentuh teknis.
- **Boss (Nje):**
  - (a) Keputusan bisnis saat ditanya (kebijakan retur, aturan pajak, dll).
  - (b) Validasi hasil tiap fitur selesai.
  - (c) Screenshot menu Accurate terkait — **per fitur yang sedang digarap**, tidak sekaligus.
  - (d) Data master bila ada yang belum masuk (mayoritas sudah ada).

## 5. Keputusan Desain Kunci

- **Mode PKP** = feature flag di pengaturan perusahaan. OFF → PPN/faktur pajak tersembunyi & tidak menjurnal PPN. ON → PPN 11% + faktur pajak aktif. Tidak mengubah data lama.
- **Pindah Barang** memakai akun **Transit** (Barang Dalam Perjalanan) meniru "Transit (AOL System)" di Accurate: stok keluar gudang asal → Transit → masuk gudang tujuan saat diterima.
- Setiap fitur = spec sendiri + plan sendiri sebelum koding (alur brainstorming → writing-plans).

## 6. Langkah Berikutnya

- Boss kirim 3 screenshot Fase 1 (form Pindah Barang, list Pindah Barang, layar terima pindahan/Transit).
- CTO audit detail modul stok existing (0013/0014/0032/0037) → tulis spec Fase 1 "Pindah Barang" → plan → build.
