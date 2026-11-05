-- Sembunyikan pelanggan dari pemilih pelanggan (kasir, POS, faktur, klinik).
--
-- Permintaan Aldi (5 Nov 2026): kartu pelanggan umum seperti "CS Kamo Pusat"
-- makin sering dipilih kasir cabang, sehingga transaksi pelanggan sungguhan
-- tertumpuk di satu kartu. Owner/Admin perlu bisa menyembunyikan kartu itu
-- supaya tidak muncul lagi di pencarian pelanggan saat transaksi baru.
--
-- Menyembunyikan TIDAK menghapus apa pun: riwayat transaksi, poin, piutang,
-- dan laporan tetap utuh; kartunya tetap terlihat (bertanda) di CRM.

alter table public.customers add column if not exists hidden_at timestamptz;
alter table public.customers add column if not exists hidden_by uuid references public.profiles(id);
alter table public.customers add column if not exists hidden_reason text;

comment on column public.customers.hidden_at is
  'Kapan kartu disembunyikan dari pemilih pelanggan transaksi baru. NULL = tampil. Hanya OWNER/ADMIN yang boleh mengubah.';
comment on column public.customers.hidden_by is 'Profil OWNER/ADMIN yang menyembunyikan kartu ini.';
comment on column public.customers.hidden_reason is 'Alasan singkat kartu disembunyikan (maks. 300 karakter).';

alter table public.customers drop constraint if exists customers_hidden_reason_len;
alter table public.customers add constraint customers_hidden_reason_len
  check (hidden_reason is null or char_length(hidden_reason) <= 300);

create index if not exists customers_hidden_idx on public.customers (hidden_at) where hidden_at is not null;

-- Kebijakan update customers terbuka untuk semua pengguna login (0005), jadi
-- penanda sembunyi dijaga trigger: hanya OWNER/ADMIN aktif yang boleh
-- mengubahnya, dan pelaku/waktunya diisi server, bukan dari kiriman klien.
create or replace function public.guard_customer_hidden() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.hidden_at is not distinct from old.hidden_at
     and new.hidden_by is not distinct from old.hidden_by
     and new.hidden_reason is not distinct from old.hidden_reason then
    return new;
  end if;
  -- Jalur layanan/maintenance (tanpa sesi pengguna) tidak diperiksa perannya.
  if auth.uid() is not null and not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role in ('OWNER', 'ADMIN')
  ) then
    raise exception 'Hanya owner/admin yang bisa menyembunyikan atau menampilkan pelanggan'
      using errcode = '42501';
  end if;
  if new.hidden_at is null then
    new.hidden_by := null;
    new.hidden_reason := null;
  else
    new.hidden_at := coalesce(old.hidden_at, now());
    new.hidden_by := coalesce(auth.uid(), new.hidden_by);
    new.hidden_reason := nullif(btrim(new.hidden_reason), '');
  end if;
  return new;
end $$;
revoke all on function public.guard_customer_hidden() from public, anon, authenticated, service_role;

drop trigger if exists customers_guard_hidden on public.customers;
create trigger customers_guard_hidden before update of hidden_at, hidden_by, hidden_reason on public.customers
  for each row execute function public.guard_customer_hidden();

-- Kartu baru tidak boleh lahir dalam keadaan tersembunyi lewat insert biasa.
create or replace function public.guard_customer_hidden_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.hidden_at := null;
    new.hidden_by := null;
    new.hidden_reason := null;
  end if;
  return new;
end $$;
revoke all on function public.guard_customer_hidden_insert() from public, anon, authenticated, service_role;

drop trigger if exists customers_guard_hidden_insert on public.customers;
create trigger customers_guard_hidden_insert before insert on public.customers
  for each row execute function public.guard_customer_hidden_insert();
