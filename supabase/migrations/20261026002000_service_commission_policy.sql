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
