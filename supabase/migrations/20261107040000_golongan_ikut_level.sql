-- Diskon per level member: golongan pelanggan otomatis mengikuti level (tier).
--
-- Janji Reza ke grup (5 Nov 2026 12.28): "tiap level (Bronze, Silver, dst) bisa dikasih diskon
-- sendiri: diskon buat SKU tertentu atau kategori produk tertentu. Diskonnya otomatis ngikut
-- pas pelanggan naik level."
--
-- Diskon per SKU / per kategori produk SUDAH ada per golongan (0082 category_discounts) dan
-- dibaca server kasir/POS/klinik lewat customers.category_id. Yang belum ada: golongan yang
-- berpindah sendiri saat level berubah. Migrasi ini:
--   1. customer_categories.tier_otomatis — golongan ini dipakai otomatis untuk satu level.
--   2. customer_categories.khusus — golongan manual (Reseller, B2B, Rescuer, ...) yang TIDAK
--      pernah ditimpa level. 'Umum' dan golongan level bukan khusus.
--   3. Trigger di customers: setiap kali tier berubah (dari mana pun: hitung ulang belanja,
--      retur, pembatalan, turun level karena tidak aktif), golongan ikut level baru — kecuali
--      pelanggan sedang memakai golongan khusus, atau golongan diganti pada perintah yang sama.
--   4. public.terapkan_golongan_level() — OWNER/ADMIN menerapkan pemetaan ke pelanggan lama.
-- Rumus harga, poin, dan jurnal tidak diubah.

alter table public.customer_categories add column if not exists tier_otomatis varchar(20);
alter table public.customer_categories add column if not exists khusus boolean;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public'
                 and table_name='customer_categories' and column_name='khusus' and is_nullable='NO') then
    -- Golongan lama dianggap khusus (dipasang manual), kecuali 'Umum' = tanpa perlakuan khusus.
    update public.customer_categories set khusus = (lower(btrim(nama)) <> 'umum') where khusus is null;
    alter table public.customer_categories alter column khusus set default true;
    alter table public.customer_categories alter column khusus set not null;
  end if;
end $$;

alter table public.customer_categories drop constraint if exists custcat_tier_otomatis_valid;
alter table public.customer_categories add constraint custcat_tier_otomatis_valid
  check (tier_otomatis is null or (tier_otomatis in ('New','Bronze','Silver','Gold','Platinum') and not khusus));
create unique index if not exists customer_categories_tier_otomatis_uq
  on public.customer_categories (tier_otomatis) where tier_otomatis is not null;

comment on column public.customer_categories.tier_otomatis is
  'Level (New/Bronze/Silver/Gold/Platinum) yang otomatis memakai golongan ini. Satu golongan per level.';
comment on column public.customer_categories.khusus is
  'Golongan khusus (dipasang manual) tidak pernah diganti otomatis saat level pelanggan berubah.';

-- Golongan tujuan untuk satu pelanggan. NULL hasilnya = kosongkan golongan level lama.
create or replace function public.golongan_untuk_level(p_tier text, p_current uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare cur public.customer_categories%rowtype; target uuid;
begin
  if p_current is not null then
    select * into cur from public.customer_categories where id = p_current;
    -- Golongan khusus (atau id yang tak dikenal) dibiarkan apa adanya.
    if not found or cur.khusus then return p_current; end if;
  end if;
  select id into target from public.customer_categories where tier_otomatis = p_tier and is_active;
  if target is not null then return target; end if;
  -- Level baru tanpa golongan: golongan level lama dilepas; 'Umum'/kosong dibiarkan.
  if p_current is not null and cur.tier_otomatis is not null then return null; end if;
  return p_current;
end $$;
revoke all on function public.golongan_untuk_level(text, uuid) from public, anon, authenticated, service_role;

create or replace function public.customers_golongan_ikut_level() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.tier is not distinct from old.tier then return new; end if;
    -- Admin mengganti golongan dan level sekaligus: pilihan admin yang dipakai.
    if new.category_id is distinct from old.category_id then return new; end if;
  end if;
  new.category_id := public.golongan_untuk_level(new.tier, new.category_id);
  return new;
end $$;
revoke all on function public.customers_golongan_ikut_level() from public, anon, authenticated, service_role;

drop trigger if exists customers_golongan_ikut_level on public.customers;
create trigger customers_golongan_ikut_level before insert or update of tier on public.customers
  for each row execute function public.customers_golongan_ikut_level();

-- Terapkan pemetaan ke semua pelanggan yang sudah ada (dipanggil setelah admin mengubah golongan).
create or replace function public.terapkan_golongan_level() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles p
     where p.id = auth.uid() and p.is_active and p.role in ('OWNER','ADMIN')) then
    raise exception 'Hanya owner/admin yang bisa menerapkan golongan per level' using errcode = '42501';
  end if;
  with t as (
    select c.id, public.golongan_untuk_level(c.tier, c.category_id) as baru, c.category_id as lama
    from public.customers c
  )
  update public.customers c set category_id = t.baru
  from t where t.id = c.id and t.baru is distinct from t.lama;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.terapkan_golongan_level() from public, anon, service_role;
grant execute on function public.terapkan_golongan_level() to authenticated;
