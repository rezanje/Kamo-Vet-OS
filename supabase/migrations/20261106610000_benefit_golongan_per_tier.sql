-- Benefit per level pelanggan (keputusan Owner 5 Nov, opsi A).
--
-- Level (Bronze/Silver/Gold/Platinum) dihitung sistem dari total belanja, tapi selama ini
-- hanya label: diskon & poin melekat ke golongan (customer_categories). Sekarang tiap level
-- boleh menunjuk satu golongan sebagai paket benefitnya (diskon dasar, diskon per SKU /
-- kategori produk, Rp per poin — semuanya mesin golongan yang sudah ada).
--
-- Aturan menang (opsi A): golongan yang dipasang admin di CRM selalu menang. Pelanggan yang
-- tidak dipasangi golongan khusus memakai golongan milik levelnya, dan ikut pindah otomatis
-- begitu levelnya naik/turun.
--
-- customers.category_id tetap menjadi SATU-SATUNYA golongan yang dibaca kasir, POS, klinik,
-- voucher, dan laporan; jadi tidak ada jalur harga yang berubah. Yang baru:
--   * customers.category_manual — true = golongan dipasang admin (tidak disentuh otomatis).
--   * tier_settings.<tier>_category_id — golongan benefit tiap level (boleh kosong).
--   * trigger customers: kalau bukan manual, category_id = golongan milik level saat ini.
--   * trigger tier_settings: saat pemetaan berubah, pelanggan non-manual ikut diselaraskan.
--
-- Pelanggan yang SUDAH punya golongan sebelum migrasi ini dianggap dipasang admin (manual),
-- jadi tidak ada golongan yang hilang atau berganti karena rilis ini. Tanpa pemetaan level
-- (kolom kosong / baris tier_settings belum ada) perilakunya persis seperti sebelumnya.

alter table public.tier_settings
  add column if not exists bronze_category_id uuid references public.customer_categories(id) on delete set null,
  add column if not exists silver_category_id uuid references public.customer_categories(id) on delete set null,
  add column if not exists gold_category_id uuid references public.customer_categories(id) on delete set null,
  add column if not exists platinum_category_id uuid references public.customer_categories(id) on delete set null;

alter table public.customers
  add column if not exists category_manual boolean not null default false;

update public.customers set category_manual = true
 where category_id is not null and not category_manual;

-- Golongan benefit untuk satu level. Level lain (New, nilai lama) = tanpa benefit level.
-- Golongan yang sedang dihapus (FK "set null" belum sampai ke tier_settings) tidak
-- dikembalikan, supaya penghapusan golongan tidak gagal karena pelanggan ikut level.
create or replace function public.tier_benefit_category(p_tier text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select k.id
  from public.tier_settings s
  join public.customer_categories k on k.id = case p_tier
    when 'Bronze' then s.bronze_category_id
    when 'Silver' then s.silver_category_id
    when 'Gold' then s.gold_category_id
    when 'Platinum' then s.platinum_category_id
  end
  where s.id = 1
$$;

revoke all on function public.tier_benefit_category(text) from public;
grant execute on function public.tier_benefit_category(text) to authenticated, service_role;

create or replace function public.customers_tier_benefit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  manual boolean := coalesce(new.category_manual, false);
begin
  -- Penulis lama yang menulis category_id langsung (tanpa menyentuh category_manual)
  -- tetap dihormati sebagai pilihan admin, bukan ditimpa diam-diam oleh level.
  if not manual and new.category_id is not null and (
       tg_op = 'INSERT'
       or (new.category_id is distinct from old.category_id
           and new.category_manual is not distinct from old.category_manual)
     ) then
    manual := true;
  end if;
  -- "Manual" tanpa golongan tidak bermakna: artinya kembali ikut level.
  if manual and new.category_id is null then
    manual := false;
  end if;
  new.category_manual := manual;
  if not manual then
    new.category_id := public.tier_benefit_category(new.tier);
  end if;
  return new;
end
$$;

drop trigger if exists customers_tier_benefit on public.customers;
create trigger customers_tier_benefit
  before insert or update on public.customers
  for each row execute function public.customers_tier_benefit();

-- Pemetaan level diubah di Pengaturan → Konfigurasi loyalty: selaraskan pelanggan yang ikut
-- level. Hanya baris yang golongannya memang berubah yang ditulis (jejak audit tetap ringkas).
create or replace function public.tier_settings_sync_benefit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.customers c
     set category_manual = false
   where not c.category_manual
     and c.category_id is distinct from public.tier_benefit_category(c.tier);
  return null;
end
$$;

drop trigger if exists tier_settings_sync_benefit on public.tier_settings;
create trigger tier_settings_sync_benefit
  after insert or update of bronze_category_id, silver_category_id, gold_category_id, platinum_category_id
  on public.tier_settings
  for each row execute function public.tier_settings_sync_benefit();

revoke all on function public.customers_tier_benefit() from public;
revoke all on function public.tier_settings_sync_benefit() from public;

comment on column public.customers.category_manual is
  'true = golongan dipasang admin di CRM (menang atas benefit level); false = golongan mengikuti level (tier_settings.<tier>_category_id).';
