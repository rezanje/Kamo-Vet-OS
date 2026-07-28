-- Master Barang & Jasa ala Accurate: merek + jenis barang — spec 2026-07-28.
-- Sebelumnya "jasa" ditandai lewat KATEGORI bernama 'Jasa', jadi kategori tidak bisa
-- dipakai bebas (Grooming, Rawat Inap, Vaksin) tanpa merusak aturan wajib-consent.
-- Jenis barang sekarang field sendiri, kategori kembali jadi pengelompokan murni.

create table brands (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table brands enable row level security;
-- Guard peran (OWNER/ADMIN) ada di server action master barang, sama pola dgn item_units.
create policy brands_all on brands for all to authenticated using (true) with check (true);

alter table items
  add column item_type varchar(16) not null default 'Persediaan'
    check (item_type in ('Persediaan', 'Jasa', 'Non-Persediaan')),
  add column brand_id uuid references brands(id) on delete set null;

create index on items(brand_id);

-- Backfill jenis: barang di kategori bernama 'Jasa' (satu-satunya penanda lama).
update items set item_type = 'Jasa'
where category_id in (select id from item_categories where name = 'Jasa');

comment on column items.item_type is
  'Persediaan = punya stok. Jasa = tindakan/layanan, tanpa stok. Non-Persediaan = dijual tapi stoknya tidak dilacak.';
