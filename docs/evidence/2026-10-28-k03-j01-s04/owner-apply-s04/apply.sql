-- S04 APPLY — WRITES. Satu transaksi: migrasi 20261026002000_service_commission_policy.sql apa adanya
-- (sha256 b3a7547b5e747088042996fb3e8cf41466e8761270e4fee159a52659beb2a8c6) + baris riwayat, lalu SATU pernyataan terpisah: kebijakan keputusan pemilik 28 Okt 2026
-- (dua pelaksana jasa = masing-masing memakai aturan komisinya sendiri, mulai 2026-11-01, semua cabang).
-- Galat apa pun membatalkan semuanya.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $$ begin
  if current_user <> 'postgres' then
    raise exception 'apply must run as postgres (current role: %); nothing was applied', current_user;
  end if;
end $$;

-- ===== Migrasi S04 (verbatim) =====
-- S04: an explicit, append-only choice for ordinary two-performer service commission.
-- No policy row means the existing pending/payroll-blocking behavior continues.
create table public.service_commission_policies (
 id uuid primary key default gen_random_uuid(),
 branch_id uuid references public.branches(id) on delete restrict,
 effective_from date not null,
 mode text not null check (mode in ('pending','personal_rules','both_full','split')),
 doctor_share_pct numeric,
 staff_share_pct numeric,
 created_by uuid not null default auth.uid(),
 created_at timestamptz not null default now(),
 constraint service_commission_policy_shares check (
  (mode='split' and doctor_share_pct between 0 and 100 and staff_share_pct between 0 and 100
   and doctor_share_pct=round(doctor_share_pct,2) and staff_share_pct=round(staff_share_pct,2)
   and doctor_share_pct+staff_share_pct=100)
  or (mode<>'split' and doctor_share_pct is null and staff_share_pct is null)
 )
);
create index service_commission_policies_scope_date
 on public.service_commission_policies(branch_id,effective_from desc,created_at desc,id desc);
alter table public.service_commission_policies enable row level security;
alter table public.service_commission_policies force row level security;
revoke all on public.service_commission_policies from public,anon,authenticated,service_role;
grant select on public.service_commission_policies to authenticated;
grant insert(branch_id,effective_from,mode,doctor_share_pct,staff_share_pct)
 on public.service_commission_policies to authenticated;
create policy service_commission_policies_read on public.service_commission_policies
 for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active)
 );
create policy service_commission_policies_insert on public.service_commission_policies
 for insert to authenticated with check (
  created_by=(select auth.uid()) and exists(
   select 1 from public.profiles p where p.id=(select auth.uid())
    and p.is_active and p.role in ('OWNER','ADMIN')
  )
 );
comment on table public.service_commission_policies is
 'Append-only explicit policy for ordinary two-person service commission; no row means pending. Later rows with the same scope/date supersede earlier rows for calculations, while preserving history.';

insert into supabase_migrations.schema_migrations(version, name) values ('20261026002000', 'service_commission_policy') on conflict (version) do nothing;

-- ===== Kebijakan keputusan pemilik (pernyataan terpisah) =====
-- branch_id NULL = semua cabang; mode personal_rules = aturan khusus masing-masing karyawan, dasar penuh keduanya.
-- created_by wajib terisi (default auth.uid() kosong di SQL editor): dicatat atas nama satu-satunya OWNER aktif
-- (preflight memastikan tepat satu). Tabel append-only; tidak menimpa baris lain.
do $$
declare v_owner uuid;
begin
  select id into strict v_owner from public.profiles where role='OWNER' and is_active;
  insert into public.service_commission_policies(branch_id, effective_from, mode, doctor_share_pct, staff_share_pct, created_by)
  select null, date '2026-11-01', 'personal_rules', null, null, v_owner
  where not exists (select 1 from public.service_commission_policies
    where branch_id is null and effective_from = date '2026-11-01' and mode = 'personal_rules');
end $$;
commit;
