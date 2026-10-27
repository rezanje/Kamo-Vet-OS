-- H04: business-configured commission groups/grades + explicit individual exceptions.
-- H06: inpatient doctor-visit incentive rate lives in commission settings (sumber visit_ranap).
-- No tariff is seeded. Null group keeps every legacy rule and employee unchanged.
-- Access (pay configuration, like H02): only OWNER may set an employee's commission group or
-- write rules that name an employee, a group, or an exception (no ADMIN self-raise). ADMIN keeps
-- general rules. Such rules are readable by OWNER/ADMIN/FINANCE only. Both tables already write
-- the A01 activity log, so every group change and every exception is recorded.

alter table public.employees
  add column if not exists commission_group varchar(40);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employees_commission_group_format') then
    alter table public.employees add constraint employees_commission_group_format
      check (commission_group ~ '^[a-z0-9][a-z0-9_-]{0,39}$');
  end if;
end $$;

alter table public.commission_rules
  add column if not exists commission_group varchar(40),
  -- Deleting a group rule deletes its exceptions: an orphaned exception must never become
  -- a standalone personal rule.
  add column if not exists override_group_rule_id uuid references public.commission_rules(id) on delete cascade;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'commission_rules_group_format') then
    alter table public.commission_rules add constraint commission_rules_group_format
      check (commission_group ~ '^[a-z0-9][a-z0-9_-]{0,39}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'commission_rule_override_scope_check') then
    alter table public.commission_rules add constraint commission_rule_override_scope_check
      check (override_group_rule_id is null or (employee_id is not null and commission_group is null));
  end if;
end $$;

comment on column public.employees.commission_group is
  'H04: kode grade/kelompok insentif yang ditetapkan bisnis. Null = tanpa kelompok.';
comment on column public.commission_rules.commission_group is
  'H04: aturan hanya berlaku untuk karyawan dengan kode kelompok ini. Null = tanpa batas kelompok.';
comment on column public.commission_rules.override_group_rule_id is
  'H04: pengecualian individu menggantikan aturan kelompok ini hanya pada baris yang cocok dengan keduanya.';

-- H06: 'visit_ranap' is 11 characters; widen before the new check.
alter table public.commission_rules drop constraint if exists commission_rules_sumber_check;
alter table public.commission_rules alter column sumber type varchar(16);
alter table public.commission_rules add constraint commission_rules_sumber_check
  check (sumber in ('semua', 'kasir', 'klinik', 'reseller', 'visit_ranap'));
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'commission_rules_visit_nominal_check') then
    alter table public.commission_rules add constraint commission_rules_visit_nominal_check
      check (sumber <> 'visit_ranap' or (tipe = 'nominal' and item_id is null and category_id is null));
  end if;
end $$;
comment on column public.commission_rules.sumber is
  'kasir = struk POS & online; klinik = tagihan kunjungan lunas; reseller = faktur B2B; semua = ketiganya (penjualan saja); '
  'visit_ranap = visit dokter rawat inap yang dikerjakan, nominal per visit, maks. 1 per dokter/rawat inap/tanggal WIB.';

-- H06 report reads visit logs by kind and time.
create index if not exists inpatient_daily_logs_doctor_visit_idx
  on public.inpatient_daily_logs (created_at, visit_doctor_id)
  where log_kind = 'doctor_visit';

-- H04 access: commission group is OWNER-only pay configuration (DB-enforced; the server
-- action guard is not the only line of defence).
create or replace function public.guard_employee_commission_group() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and new.commission_group is distinct from (case when tg_op = 'UPDATE' then old.commission_group end)
     and not private.is_hris_owner() then
    raise exception using errcode = '42501', message = 'ACCESS_DENIED: kelompok komisi hanya dapat diubah OWNER';
  end if;
  return new;
end $$;
revoke all on function public.guard_employee_commission_group() from public, anon, authenticated, service_role;
drop trigger if exists h04_commission_group_owner on public.employees;
create trigger h04_commission_group_owner before insert or update of commission_group on public.employees
  for each row execute function public.guard_employee_commission_group();

drop policy if exists commission_rules_select_all on public.commission_rules;
drop policy if exists commission_rules_select_general on public.commission_rules;
drop policy if exists commission_rules_write_admin on public.commission_rules;
drop policy if exists commission_rules_write_owner on public.commission_rules;
drop policy if exists commission_rules_write_admin_general on public.commission_rules;
-- General rules stay readable by every signed-in account (unchanged); personal/group/exception
-- rules reveal individual pay and are readable by OWNER/ADMIN/FINANCE only.
create policy commission_rules_select_general on public.commission_rules
  for select to authenticated
  using ((employee_id is null and commission_group is null and override_group_rule_id is null)
    or (select private.hris_role()) in ('OWNER', 'ADMIN', 'FINANCE'));
create policy commission_rules_write_owner on public.commission_rules
  for all to authenticated
  using ((select private.is_hris_owner())) with check ((select private.is_hris_owner()));
create policy commission_rules_write_admin_general on public.commission_rules
  for all to authenticated
  using ((select private.hris_role()) = 'ADMIN' and employee_id is null and commission_group is null and override_group_rule_id is null)
  with check ((select private.hris_role()) = 'ADMIN' and employee_id is null and commission_group is null and override_group_rule_id is null);
