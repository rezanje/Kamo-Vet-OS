-- Example policies are prospective versions. Posted fees and shared pools are
-- immutable snapshots; a change never rewrites a paid invoice.
insert into public.coa_accounts(code,name,type,normal_balance,is_active,is_header)
values ('4303','Pendapatan Admin Pembayaran Klinik','PENDAPATAN','K',true,false)
on conflict (code) do nothing;

create table public.clinic_demo_policies (
  id uuid primary key default gen_random_uuid(), name text not null,
  incentive_percent numeric(5,2) not null check(incentive_percent between 0 and 100),
  fee_bearer text not null check(fee_bearer in ('customer','company')),
  fee_rates jsonb not null, admin_revenue_code varchar(12) not null references public.coa_accounts(code),
  admin_expense_code varchar(12) not null references public.coa_accounts(code),
  is_active boolean not null default true, created_at timestamptz not null default now(), created_by uuid references public.profiles(id)
);
create unique index clinic_demo_one_active_policy on public.clinic_demo_policies(is_active) where is_active;
alter table public.clinic_demo_policies enable row level security;
create policy clinic_demo_policy_read on public.clinic_demo_policies for select to authenticated
using (exists(select 1 from public.profiles where id=auth.uid() and is_active));
revoke insert,update,delete on public.clinic_demo_policies from authenticated;

create function public.save_clinic_demo_policy(p_name text,p_incentive_percent numeric,p_fee_bearer text,
  p_fee_rates jsonb,p_revenue_code text,p_expense_code text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_rate record;
begin
  if coalesce(auth.role(),'')<>'authenticated' or not exists(
    select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN')
  ) then raise exception 'ACCESS_DENIED: hanya OWNER/ADMIN aktif dapat mengubah aturan DEMO';end if;
  if nullif(btrim(p_name),'') is null or length(p_name)>100 or p_incentive_percent is null
    or p_incentive_percent not between 0 and 100 or p_fee_bearer not in ('customer','company')
    or jsonb_typeof(p_fee_rates) is distinct from 'object' then raise exception 'POLICY_INVALID: isi aturan DEMO yang valid';end if;
  for v_rate in select * from jsonb_each(p_fee_rates) loop
    if v_rate.key not in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet')
      or jsonb_typeof(v_rate.value) is distinct from 'number' then raise exception 'POLICY_INVALID: metode atau tarif admin tidak valid';end if;
    if (v_rate.value::text)::numeric not between 0 and 10000 or (v_rate.value::text)::numeric <> trunc((v_rate.value::text)::numeric) then
      raise exception 'POLICY_INVALID: tarif admin harus basis poin 0–10000';end if;
  end loop;
  if not exists(select 1 from public.coa_accounts where code=p_revenue_code and type='PENDAPATAN' and normal_balance='K' and is_active and not is_header)
    or not exists(select 1 from public.coa_accounts where code=p_expense_code and type='BEBAN' and normal_balance='D' and is_active and not is_header)
    or p_revenue_code='4201' then raise exception 'POLICY_INVALID: pilih akun admin pendapatan dan beban yang terpisah';end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-demo-policy',0));
  update public.clinic_demo_policies set is_active=false where is_active;
  insert into public.clinic_demo_policies(name,incentive_percent,fee_bearer,fee_rates,admin_revenue_code,admin_expense_code,created_by)
    values(btrim(p_name),p_incentive_percent,p_fee_bearer,p_fee_rates,p_revenue_code,p_expense_code,auth.uid()) returning id into v_id;
  return v_id;
end $$;

create function public.clinic_demo_care_staff(p_visit_id uuid)
returns table(id uuid,nama text,jabatan text) language plpgsql security definer set search_path='' as $$
declare v_branch uuid;
begin
  select branch_id into v_branch from public.visits where visits.id=p_visit_id;
  if coalesce(auth.role(),'')<>'authenticated' or not public.user_can_access_branch(v_branch)
    or not exists(select 1 from public.profiles where profiles.id=auth.uid() and is_active) then
    raise exception 'ACCESS_DENIED: petugas kunjungan tidak dapat diakses';end if;
  return query select e.id,e.nama::text,e.jabatan::text from public.employees e
  where e.status='Aktif' and cardinality(public.clinic_employee_roles(e.jabatan))>0
    and (e.branch_id=v_branch or exists(select 1 from public.employee_branch_assignments a where a.employee_id=e.id and a.branch_id=v_branch
      and a.effective_date<=(now() at time zone 'Asia/Jakarta')::date))
    and (exists(select 1 from public.visits v where v.id=p_visit_id and e.id in (v.doctor_id,v.service_provider_id))
      or exists(select 1 from public.inpatient_records r left join public.inpatient_daily_logs l on l.inpatient_record_id=r.id
        where r.visit_id=p_visit_id and e.id in (r.doctor_id,l.visit_doctor_id,l.paramedic_id))) order by e.nama,e.id;
end $$;
revoke all on function public.clinic_demo_care_staff(uuid) from public,anon,service_role;
grant execute on function public.clinic_demo_care_staff(uuid) to authenticated;
revoke all on function public.save_clinic_demo_policy(text,numeric,text,jsonb,text,text) from public,anon,service_role;
grant execute on function public.save_clinic_demo_policy(text,numeric,text,jsonb,text,text) to authenticated;

create table public.clinic_demo_invoice_snapshots (
  invoice_id uuid primary key references public.invoices(id) on delete restrict,
  policy_id uuid not null references public.clinic_demo_policies(id), branch_id uuid not null references public.branches(id),
  request_key text not null unique, request_hash text not null,
  base_total numeric(15,2) not null, fee_amount numeric(15,2) not null,
  fee_bearer text not null, payments jsonb not null,
  service_basis numeric(15,2) not null, incentive_pool bigint not null,
  earned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table public.clinic_demo_incentive_allocations (
  id uuid not null unique default gen_random_uuid(),
  invoice_id uuid not null references public.clinic_demo_invoice_snapshots(invoice_id) references public.invoices(id),
  employee_id uuid not null references public.employees(id), amount bigint not null check(amount>=0),
  primary key(invoice_id,employee_id)
);
alter table public.clinic_demo_invoice_snapshots enable row level security;
alter table public.clinic_demo_incentive_allocations enable row level security;
create policy clinic_demo_snapshot_read on public.clinic_demo_invoice_snapshots for select to authenticated
using(public.user_can_access_branch(branch_id) and exists(select 1 from public.profiles where id=auth.uid() and is_active));
create policy clinic_demo_allocation_read on public.clinic_demo_incentive_allocations for select to authenticated
using(exists(select 1 from public.clinic_demo_invoice_snapshots s where s.invoice_id=clinic_demo_incentive_allocations.invoice_id));
revoke insert,update,delete on public.clinic_demo_invoice_snapshots,public.clinic_demo_incentive_allocations from authenticated;

-- Nested SECURITY DEFINER receipt calls must read modern JWT claims, too.
do $$ declare v_def text;begin
  select pg_get_functiondef('public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)'::regprocedure) into v_def;
  v_def:=replace(v_def,$old$coalesce(current_setting('request.jwt.claim.role', true), '')$old$,$new$coalesce(auth.role(), '')$new$);
  if position('coalesce(auth.role(), '''')' in v_def)=0 then raise exception 'Unexpected receipt authentication guard';end if;
  execute v_def;
end $$;

grant select on public.clinic_demo_policies,public.clinic_demo_invoice_snapshots,public.clinic_demo_incentive_allocations to authenticated;
