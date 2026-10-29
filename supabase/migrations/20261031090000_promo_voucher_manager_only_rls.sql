-- AUDIT PROMO 2026-10-28 — temuan Tinggi: master promo & voucher bisa ditulis
-- siapa pun yang login.
--
-- `promos`, `promo_items`, dan `vouchers` masing-masing hanya punya satu policy
-- `for all to authenticated using (true) with check (true)`, sementara role
-- `authenticated` memegang grant penuh (arwdDxtm). Pembatasan OWNER/ADMIN hanya
-- ada di server action (src/app/(app)/crm/promo/actions.ts,
-- src/app/(app)/crm/voucher/actions.ts). Artinya akun kasir/dokter/groomer dapat
-- memanggil REST Supabase langsung untuk membuat promo "potong otomatis 100%"
-- atau voucher nominal besar, lalu menebusnya sendiri di kasir.
--
-- Perbaikannya memakai pola yang sudah dipakai campaign_codes (migrasi
-- 20261028181000): BACA tetap terbuka untuk semua pengguna yang login — kasir
-- wajib bisa membaca promo & voucher saat menghitung potongan — sementara
-- TULIS dikunci ke OWNER/ADMIN yang aktif.
--
-- Tidak mengubah jalur tulis yang sah:
--   * edit_promo() dan import_promo_excel_batch() adalah SECURITY DEFINER dan
--     sudah memanggil assert_promo_manager(), jadi tidak terpengaruh policy ini;
--   * createPromo/togglePromo dan simpanVoucher berjalan sebagai pengguna dan
--     sudah mensyaratkan OWNER/ADMIN, jadi syaratnya sama persis.
--
-- BELUM DITERAPKAN ke Production. Terapkan bersama rilis berikutnya.

create or replace function public.is_promo_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role in ('OWNER','ADMIN')
  )
$$;
revoke all on function public.is_promo_manager() from public, anon, service_role;
grant execute on function public.is_promo_manager() to authenticated;
comment on function public.is_promo_manager() is
  'True bila pengguna yang login adalah OWNER/ADMIN aktif. Dipakai policy master promo & voucher.';

do $$
declare t text;
begin
  foreach t in array array['promos','promo_items','vouchers'] loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_manager_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_manager_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_manager_delete', t);

    -- Kasir harus tetap bisa membaca master saat menghitung potongan.
    execute format('create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_promo_manager())',
      t || '_manager_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_promo_manager()) with check (public.is_promo_manager())',
      t || '_manager_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_promo_manager())',
      t || '_manager_delete', t);
  end loop;
end $$;

-- Role anon tidak pernah punya policy di tabel ini; grant tabelnya ikut dicabut
-- supaya hak aksesnya tidak lagi bergantung pada ada/tidaknya policy.
revoke all on table public.promos from anon;
revoke all on table public.promo_items from anon;
revoke all on table public.vouchers from anon;
