-- Business configured commission groups/grades; no access policy changes.
-- Null keeps legacy unrestricted rules and employees unchanged.
alter table public.employees
  add column commission_group varchar(40)
    check (commission_group ~ '^[a-z0-9][a-z0-9_-]{0,39}$');

alter table public.commission_rules
  add column commission_group varchar(40)
    check (commission_group ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  add column override_group_rule_id uuid references public.commission_rules(id) on delete set null,
  add constraint commission_rule_override_scope_check
    check (override_group_rule_id is null or (employee_id is not null and commission_group is null));

comment on column public.commission_rules.override_group_rule_id is
  'Individual exception replaces the referenced group rule only on lines matching both rules; other stacking rules remain additive.';
