# Tier Otomatis & Kategori Pelanggan — Design

## Goal
Tier pelanggan (New/Bronze/Silver/Gold/Platinum) jadi murni hasil hitungan sistem berdasarkan total nilai transaksi gabungan petshop + klinik — bukan lagi field yang bisa dipilih manual di form mana pun. "Keanggotaan" (Member/Non Member) diganti jadi "Kategori" (Umum/Member/B2B/Rescuer) yang cuma bisa diubah OWNER/ADMIN dari CRM, tapi tetap tampil read-only di dashboard POS. Admin juga bisa lihat breakdown total & rata-rata transaksi per unit (petshop vs klinik) per customer, dan atur threshold nominal tier dari halaman pengaturan.

## Context
- `customers` table (migration 0001) punya `tier varchar(20) not null default 'New'` — sampai sekarang manual, dipilih lewat dropdown di 2 tempat: POS "Tambah Customer" modal (`src/app/kasir/KasirClient.tsx` + `src/app/kasir/actions.ts`) dan `/crm/pelanggan/baru` (`src/app/(app)/crm/pelanggan/baru/actions.ts`).
- `customers.keanggotaan varchar(12) not null default 'Non Member'` (migration 0007) — sama, manual dropdown Member/Non Member di 2 tempat yang sama.
- `customers.total_spending numeric` ada, tapi **cuma di-update dari petshop** — akhir `checkoutKasir` di `src/app/kasir/checkout.ts` (`customers.update({ points: saldo, total_spending: custSpending + total })`). Klinik (`src/app/(app)/klinik/pembayaran/[visitId]/actions.ts`, fungsi `bayarVisit` & `voidAndReissue`) sama sekali gak nyentuh `customers.total_spending`/`tier` — gap yang mau ditutup.
- Transaksi klinik traceable ke customer lewat `invoices.visit_id → visits.customer_id` (bukan langsung `invoices.customer_id`). `invoices` punya `paid_status` (`Belum Lunas`/`DP`/`Lunas`) dan `voided_at` (soft-void, migration 0028-an) — cuma baris `paid_status = 'Lunas' AND voided_at IS NULL` yang dihitung "transaksi selesai".
- Transaksi petshop (`sales.total`, `sales.customer_id`) selalu final begitu insert — gak ada status belum-lunas di petshop.
- Belum ada mekanisme edit-customer sama sekali di CRM — `PelangganClient.tsx` (`src/app/(app)/crm/pelanggan/PelangganClient.tsx`) cuma nampilin detail read-only (profil, pets, riwayat pembelian). Cuma create (`/crm/pelanggan/baru`) yang ada.
- Role check pattern udah ada: `role === "OWNER" || role === "ADMIN"` di `src/lib/stock-recon.ts` dan sebagai server-side gate di `src/app/(app)/crm/promo/actions.ts` (query `profiles.role`, tolak kalau bukan OWNER/ADMIN). `src/app/(app)/layout.tsx` udah fetch `profile.role` untuk kebutuhan layout lain.
- Precedent single-row settings table: `quest_settings` (migration 0033) — `id int primary key default 1 check (id = 1)`, komentar "spec: jangan hardcode nilainya". Pola ini dipakai lagi buat `tier_settings`.
- `/pengaturan` adalah area admin settings, isinya baru `/pengaturan/cabang` — home yang natural buat halaman threshold tier baru.
- POS petshop panel customer (`KasirClient.tsx` baris ~150-165) udah nampilin badge tier (`TIER_BADGE` map warna Bronze/Silver/Gold/Platinum, fallback abu-abu buat nilai lain termasuk "New") dan badge keanggotaan digabung jadi satu span — perlu dipecah jadi 2 badge terpisah (Tier + Kategori).

## Architecture

### a) Schema — migration `0042_tier_kategori_otomatis.sql`
```sql
-- rename keanggotaan -> kategori, ganti default & existing values
alter table customers rename column keanggotaan to kategori;
alter table customers alter column kategori set default 'Umum';
update customers set kategori = 'Umum' where kategori = 'Non Member';
-- 'Member' tetap 'Member', gak perlu diubah

-- settings tier — single row, admin-editable, gak hardcode threshold di kode
create table tier_settings (
  id int primary key default 1 check (id = 1),
  bronze_min numeric not null default 1000000,
  silver_min numeric not null default 5000000,
  gold_min numeric not null default 15000000,
  platinum_min numeric not null default 50000000
);
insert into tier_settings default values;
alter table tier_settings enable row level security;
create policy tier_settings_read on tier_settings for select to authenticated using (true);
create policy tier_settings_write on tier_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- backfill satu kali: recompute total_spending & tier semua customer existing
-- pakai formula sama dgn recomputeCustomerTier (petshop sales + klinik invoices lunas)
with agg as (
  select c.id,
    coalesce((select sum(s.total) from sales s where s.customer_id = c.id), 0)
    + coalesce((select sum(i.total) from invoices i join visits v on v.id = i.visit_id
                where v.customer_id = c.id and i.paid_status = 'Lunas' and i.voided_at is null), 0) as combined
  from customers c
)
update customers c set
  total_spending = agg.combined,
  tier = case
    when agg.combined >= (select platinum_min from tier_settings) then 'Platinum'
    when agg.combined >= (select gold_min from tier_settings) then 'Gold'
    when agg.combined >= (select silver_min from tier_settings) then 'Silver'
    when agg.combined >= (select bronze_min from tier_settings) then 'Bronze'
    else 'New'
  end
from agg where agg.id = c.id;
```
Threshold seed: New < 1jt, Bronze < 5jt, Silver < 15jt, Gold < 50jt, Platinum ≥ 50jt — starting point, admin ubah kapan aja lewat `/pengaturan/tier`.

### b) Tier compute — `src/lib/customer-tier.ts` (baru)
```ts
export async function recomputeCustomerTier(supabase, customerId: string): Promise<void>
```
- Sum `sales.total` where `customer_id = X` (petshop).
- Sum `invoices.total` join `visits` where `visits.customer_id = X`, `paid_status = 'Lunas'`, `voided_at is null` (klinik).
- `combined = petshopSum + klinikSum` → fetch `tier_settings` (single row) → map ke tier string (logic sama persis kayak SQL backfill di atas, ditulis sekali sebagai pure function `computeTier(combined, thresholds)` biar gak duplikat & bisa di-unit-test) → `update customers set total_spending = combined, tier = tier where id = customerId`.
- Unit test (`src/lib/__tests__/customer-tier.test.ts`): `computeTier()` di semua boundary (pas di threshold, di bawah, di atas, kombinasi 0).

**Titik panggil** (server-side, gak ada trigger manual dari UI):
- `src/app/kasir/checkout.ts` — akhir `checkoutKasir`, ganti baris update `total_spending` manual jadi panggil `recomputeCustomerTier(supabase, customerId)` setelah update points selesai.
- `src/app/(app)/klinik/pembayaran/[visitId]/actions.ts` — akhir `bayarVisit` (baik jalur CREATE maupun EDIT, dipanggil unconditional sebelum redirect sukses — invoice bisa jadi Lunas dari kedua jalur) dan akhir `voidAndReissue` (void ngurangin total lunas, harus direcompute juga). Ambil `customerId` dari `visits.customer_id` (query yang udah ada, `v` variable, tambah kolom `customer_id` ke select).

### c) Kategori — fixed list, admin-only edit
- Fixed di kode: `Umum`, `Member`, `B2B`, `Rescuer` (const array, satu tempat — reuse di form admin & seed).
- **Create forms** (`KasirClient.tsx` modal `tambahCustomerKasir` di `src/app/kasir/actions.ts`, dan `/crm/pelanggan/baru`): hapus field Tier & Kategori/Keanggotaan sepenuhnya dari form + action. Customer baru selalu `kategori` default `'Umum'` (db default), `tier` default `'New'` (db default) — gak dikirim dari client sama sekali.
- **CRM pelanggan detail** (`PelangganClient.tsx` + `actions.ts` baru di `src/app/(app)/crm/pelanggan/`): tambah kontrol edit Kategori (dropdown 4 pilihan + tombol simpan, server action `updateKategoriPelanggan`). Action cek role server-side (query `profiles.role`, tolak kalau bukan OWNER/ADMIN — pola sama `crm/promo/actions.ts`). Halaman `page.tsx` fetch role user saat ini, pass `isAdmin` boolean ke client component — kalau bukan admin, kontrol edit gak dirender (cuma badge read-only), form gak ada di DOM sama sekali (bukan cuma disabled).

### d) Tampilan POS petshop
- `KasirClient.tsx` panel customer: pecah badge gabungan jadi 2 badge terpisah — **Tier** (read-only, `TIER_BADGE` map yang udah ada, tambah "New" eksplisit ke map biar gak fallback abu-abu generik) dan **Kategori** (read-only, badge simpel nampilin nilai `kategori` apa adanya). Gak ada kontrol edit di POS sama sekali (sesuai existing pattern — POS emang gak punya jalur admin actions).

### e) Admin aggregate view — breakdown per unit
- Blok baru di `PelangganClient.tsx` detail panel, render cuma kalau `isAdmin`: dua baris **Petshop** dan **Klinik**, masing-masing (jumlah transaksi, total nilai, rata-rata/transaksi).
- Dihitung live di `page.tsx` (server component) pas admin buka detail — query agregat langsung (`count`, `sum`, lalu `avg = sum/count` di JS) ke `sales` (petshop, by `customer_id`) dan `invoices` join `visits` (klinik, `paid_status = 'Lunas' AND voided_at is null`, by `customer_id`). Gak disimpan/didenormalisasi — selalu akurat, konsisten dengan cara `recomputeCustomerTier` menghitung total gabungan.

### f) Threshold tier — `/pengaturan/tier` (halaman baru)
- Gated OWNER/ADMIN, pola sama `/pengaturan/cabang`.
- Form 4 input angka (Bronze/Silver/Gold/Platinum minimum), server action `updateTierSettings` — update single-row `tier_settings`. **Tidak** otomatis recompute semua customer saat threshold diubah (ponytail: recompute massal itu operasi terpisah & berat, threshold baru cuma berlaku ke transaksi berikutnya — kalau nanti perlu recompute massal on-demand, itu penambahan terpisah, bukan bagian scope ini).

## Testing
- Unit test `computeTier()` — semua boundary condition (di bawah New, tepat di tiap threshold, di atas Platinum).
- Manual verify (browser): petshop checkout naikin tier customer (mis. transaksi gede sekali langsung ke Silver), klinik bayar Lunas juga naikin tier gabungan, void invoice klinik nurunin lagi. Kategori dropdown cuma muncul buat akun OWNER/ADMIN, POS panel nampilin 2 badge terpisah read-only.
