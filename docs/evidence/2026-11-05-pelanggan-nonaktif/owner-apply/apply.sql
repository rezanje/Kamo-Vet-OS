-- Pelanggan nonaktif — apply: sama persis dengan supabase/migrations/20261107100000_pelanggan_nonaktif.sql.
-- Jalankan HANYA setelah preflight.sql lolos. Satu transaksi; aman diulang.
begin;
-- Pelanggan nonaktif (Aldi, 5 Nov 2026): kasir cabang "membuang" penjualan ke pelanggan
-- "CS pusat" alih-alih ke pelanggan asli. Pelanggan kini bisa dinonaktifkan oleh OWNER/ADMIN.
--
-- Aturan:
--  * Kartu pelanggan TIDAK dihapus. Riwayat, laporan, piutang, poin, dan transaksi lama tetap
--    utuh dan terbaca — kolom baru hanya menandai statusnya.
--  * Transaksi BARU (struk POS/kasir/online, kunjungan klinik, penawaran, pesanan, faktur,
--    uang muka) atas pelanggan nonaktif ditolak oleh database — bukan cuma disembunyikan di layar.
--  * Pengecualian (bukan transaksi baru): impor rekam medis lama (legacy_source_key), lanjutan
--    rawat inap yang sudah berjalan (continued_from_visit_id), faktur pengganti koreksi
--    (replaces_invoice_id), dan saldo awal piutang (opening_batch_id).
--  * Hanya OWNER/ADMIN yang aktif yang boleh mengubah status aktif pelanggan; waktu & pelakunya
--    diisi database, bukan dari kiriman klien.

alter table public.customers
  add column if not exists is_active boolean not null default true,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid references public.profiles(id) on delete set null,
  add column if not exists deactivation_reason text;

comment on column public.customers.is_active is
  'false = pelanggan dinonaktifkan: tidak bisa dipakai untuk transaksi baru; riwayat tetap utuh.';
comment on column public.customers.deactivation_reason is
  'Alasan opsional saat dinonaktifkan (maks. 500 karakter). Dikosongkan saat diaktifkan lagi.';

-- Daftar pelanggan nonaktif kecil; indeks parsial cukup untuk filter "Tampilkan nonaktif".
create index if not exists customers_nonaktif_idx on public.customers (name) where not is_active;

-- ---------------------------------------------------------------------------------------------
-- 1. Siapa yang boleh mengubah status aktif pelanggan.
create or replace function public.customer_status_manager() returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role in ('OWNER','ADMIN')
  );
$$;
revoke all on function public.customer_status_manager() from public, anon, authenticated, service_role;
grant execute on function public.customer_status_manager() to authenticated;

-- Trigger SECURITY INVOKER: current_user = peran pemanggil sebenarnya (authenticated/anon dari
-- aplikasi; postgres/service_role untuk pemilik lewat SQL editor). Fungsi RPC lain yang memperbarui
-- pelanggan (poin, impor) tidak menyentuh kolom status, jadi tidak terpengaruh.
create or replace function public.guard_customer_status() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_client boolean := current_user in ('authenticated','anon');
  v_reason text := nullif(btrim(left(coalesce(new.deactivation_reason, ''), 500)), '');
begin
  if tg_op = 'UPDATE' then
    if (new.is_active, new.deactivated_at, new.deactivated_by, new.deactivation_reason)
       is not distinct from (old.is_active, old.deactivated_at, old.deactivated_by, old.deactivation_reason) then
      return new;
    end if;
    if v_client and not public.customer_status_manager() then
      raise exception using errcode = '42501',
        message = 'Hanya owner/admin yang bisa menonaktifkan atau mengaktifkan pelanggan.';
    end if;
    if new.is_active then
      new.deactivated_at := null; new.deactivated_by := null; new.deactivation_reason := null;
    elsif old.is_active then
      new.deactivated_at := now(); new.deactivated_by := auth.uid(); new.deactivation_reason := v_reason;
    else
      -- Sudah nonaktif: jejak penonaktifan tidak boleh ditulis ulang; alasan boleh diperbaiki.
      new.deactivated_at := old.deactivated_at; new.deactivated_by := old.deactivated_by;
      new.deactivation_reason := v_reason;
    end if;
    return new;
  end if;

  -- INSERT
  if new.is_active then
    new.deactivated_at := null; new.deactivated_by := null; new.deactivation_reason := null;
  else
    if v_client and not public.customer_status_manager() then
      raise exception using errcode = '42501',
        message = 'Hanya owner/admin yang bisa menonaktifkan atau mengaktifkan pelanggan.';
    end if;
    new.deactivated_at := coalesce(new.deactivated_at, now());
    new.deactivated_by := coalesce(new.deactivated_by, auth.uid());
    new.deactivation_reason := v_reason;
  end if;
  return new;
end $$;
revoke all on function public.guard_customer_status() from public, anon, authenticated, service_role;

drop trigger if exists customers_status_guard on public.customers;
create trigger customers_status_guard
  before insert or update of is_active, deactivated_at, deactivated_by, deactivation_reason on public.customers
  for each row execute function public.guard_customer_status();

-- ---------------------------------------------------------------------------------------------
-- 2. Transaksi baru atas pelanggan nonaktif ditolak.
create or replace function public.guard_new_transaction_customer_active() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
begin
  if new.customer_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.customer_id is not distinct from old.customer_id then return new; end if;

  -- Bukan transaksi baru: data lama yang diimpor/dilanjutkan/dikoreksi tetap boleh tercatat.
  if tg_op = 'INSERT' then
    v_row := to_jsonb(new);
    if tg_table_name = 'visits'
       and (v_row->>'legacy_source_key' is not null or v_row->>'continued_from_visit_id' is not null) then
      return new;
    end if;
    if tg_table_name = 'sales_invoices'
       and (v_row->>'replaces_invoice_id' is not null or v_row->>'opening_batch_id' is not null) then
      return new;
    end if;
  end if;

  if exists (select 1 from public.customers c where c.id = new.customer_id and not c.is_active) then
    raise exception using errcode = 'P0001',
      message = 'Pelanggan ini sudah dinonaktifkan, pilih pelanggan asli.',
      hint = 'CUSTOMER_INACTIVE';
  end if;
  return new;
end $$;
revoke all on function public.guard_new_transaction_customer_active() from public, anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['sales','visits','sales_quotations','sales_orders','sales_invoices','sales_advances'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'PELANGGAN_NONAKTIF_SOURCE_CHANGED: tabel % tidak ada', t;
    end if;
    execute format('drop trigger if exists customer_active_guard on public.%I', t);
    execute format(
      'create trigger customer_active_guard before insert or update of customer_id on public.%I '
      'for each row execute function public.guard_new_transaction_customer_active()', t);
  end loop;
end $$;
commit;
