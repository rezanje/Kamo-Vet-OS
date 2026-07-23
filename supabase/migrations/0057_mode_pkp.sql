-- Mode PKP & PPN — toggle perusahaan (default OFF: belum PKP, tidak mungut PPN)
-- (spec: docs/superpowers/specs/2026-07-24-ppn-mode-pkp-design.md)

create table company_settings (
  id boolean primary key default true check (id),
  mode_pkp boolean not null default false,
  ppn_rate numeric not null default 11,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into company_settings (id) values (true);

alter table company_settings enable row level security;
create policy csettings_all on company_settings for all to authenticated using (true) with check (true);

-- PPN Masukan (dibayar ke pemasok, bisa dikreditkan saat PKP).
insert into coa_accounts (code, name, type, normal_balance)
values ('1105', 'PPN Masukan', 'ASET', 'D')
on conflict (code) do nothing;
