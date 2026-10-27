-- H04: business-configured commission groups/grades + explicit individual exceptions.
-- H06: inpatient doctor-visit incentive rate lives in commission settings (sumber visit_ranap).
-- No tariff is seeded. Null group keeps every legacy rule and employee unchanged.
-- Access: commission_rules writes stay OWNER/ADMIN (20261027030000); employees writes stay
-- branch managers. Both tables already write the A01 activity log, so every group change
-- and every exception is recorded with before/after values.

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
  add column if not exists override_group_rule_id uuid references public.commission_rules(id) on delete set null;
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
