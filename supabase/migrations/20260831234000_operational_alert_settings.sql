-- Ambang alert operasional per perusahaan, dengan override opsional per cabang.
create table operational_alert_settings (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null check (rule_key in (
    'sales_below_target','stock_opname_variance','expired_or_near_expiry',
    'sales_drop','negative_stock','manual_discount_limit','void_limit',
    'fast_moving_out_of_stock','no_show_limit','staff_productivity'
  )),
  branch_id uuid references branches(id) on delete cascade,
  threshold numeric,
  period_days int check (period_days is null or period_days > 0),
  active boolean not null default false,
  severity text not null check (severity in ('red','yellow')),
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (threshold is null or threshold >= 0)
);

create unique index operational_alert_company_rule
  on operational_alert_settings(rule_key) where branch_id is null;
create unique index operational_alert_branch_rule
  on operational_alert_settings(rule_key, branch_id) where branch_id is not null;

alter table operational_alert_settings enable row level security;

create policy operational_alert_settings_read on operational_alert_settings
  for select to authenticated
  using (branch_id is null or public.user_can_access_branch(branch_id));

create policy operational_alert_settings_write on operational_alert_settings
  for all to authenticated
  using (public.is_admin() and (branch_id is null or public.user_can_access_branch(branch_id)))
  with check (public.is_admin() and (branch_id is null or public.user_can_access_branch(branch_id)));

insert into operational_alert_settings
  (rule_key, branch_id, threshold, period_days, active, severity)
values
  ('sales_below_target', null, 80, 30, true, 'red'),
  ('stock_opname_variance', null, 500000, 1, true, 'red'),
  ('expired_or_near_expiry', null, 30, 30, true, 'red'),
  ('sales_drop', null, 10, 30, true, 'yellow'),
  ('negative_stock', null, 0, 1, true, 'red'),
  ('manual_discount_limit', null, null, 30, false, 'red'),
  ('void_limit', null, null, 30, false, 'red'),
  ('fast_moving_out_of_stock', null, null, 1, false, 'red'),
  ('no_show_limit', null, null, 30, false, 'red'),
  ('staff_productivity', null, null, 30, false, 'yellow')
on conflict (rule_key) where branch_id is null do nothing;
