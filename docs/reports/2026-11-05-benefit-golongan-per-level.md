# Benefit golongan per level pelanggan (5 Nov 2026)

Permintaan: Aldi (grup Kamo ERP Dev) — benefit Bronze/Silver/Gold/Platinum, mis. SKU tertentu
diskon sekian atau kategori produk diskon sekian. Keputusan Owner: **opsi A** — golongan khusus
yang dipasang admin di CRM menang atas benefit level.

## Perubahan
- Migrasi `20261106610000_benefit_golongan_per_tier.sql`
  - `tier_settings.{bronze,silver,gold,platinum}_category_id` → golongan benefit tiap level
    (FK `customer_categories`, `on delete set null`).
  - `customers.category_manual` (default false). Backfill: pelanggan yang sudah punya golongan
    → `true` (tidak ada golongan existing yang berubah).
  - Trigger BEFORE INSERT/UPDATE `customers`: bila bukan manual, `category_id` = golongan level.
    Penulis lama yang menulis `category_id` langsung tetap dianggap manual.
  - Trigger AFTER INSERT/UPDATE pemetaan `tier_settings`: selaraskan pelanggan ikut level.
  - `tier_benefit_category()` mengabaikan golongan yang sedang dihapus (FK set null aman).
- `customers.category_id` tetap satu-satunya sumber golongan untuk kasir, POS, klinik, voucher,
  laporan → tidak ada jalur harga/poin yang diubah.
- Layar Pengaturan → Konfigurasi loyalty: pilihan "Benefit <level>" per level.
- CRM → data pelanggan: dropdown golongan "— ikut level (…) —" vs golongan khusus.

## Tes
- `python3 scripts/test-benefit-golongan-tier-postgres.py` (PG16 native, 377 migrasi):
  PASS `benefit_golongan_per_tier.sql`, PASS `customer_return_spending.sql`.
  Mutasi (trigger dicabut) tertangkap oleh tes.
- Regresi: `online_return_unit_posting.sql` PASS. `activity_audit_coverage.sql` dan
  `pos_merchant_fees.sql` gagal **juga di main tanpa migrasi ini** (kendala lama, tidak terkait).
- Vitest penuh 7283 lulus; lint 0 error; `tsc --noEmit` bersih; `next build` sukses.

## Urutan rilis
Migrasi **wajib dipasang sebelum/bersamaan** dengan deploy kode: layar CRM & loyalty membaca
kolom baru. Tanpa pemetaan diisi, perilaku sama persis dengan sebelumnya.

## Belum
- Belum diuji di Production / UAT pengguna.
- Benefit level "New" tidak disediakan (di luar permintaan).
