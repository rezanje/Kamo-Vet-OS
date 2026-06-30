-- Keuangan: Chart of Accounts + jurnal double-entry (PRD Finance, "zero-error")
create table coa_accounts (
  id uuid primary key default gen_random_uuid(),
  code varchar(12) unique not null,
  name varchar(80) not null,
  type varchar(12) not null,        -- ASET / LIABILITAS / EKUITAS / PENDAPATAN / BEBAN
  normal_balance char(1) not null,  -- D / K
  is_active boolean not null default true
);
create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  no_jurnal varchar(24) unique,
  tanggal date not null default current_date,
  deskripsi text,
  source varchar(24) not null default 'manual',   -- manual/expense/sale/shift
  source_ref varchar(40),
  branch_id uuid references branches(id) on delete set null,
  created_at timestamptz not null default now()
);
create table journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references journal_entries(id) on delete cascade,
  account_id uuid not null references coa_accounts(id) on delete restrict,
  debit numeric not null default 0,
  credit numeric not null default 0
);
create index on journal_lines(entry_id);
create index on journal_entries(branch_id);
alter table coa_accounts enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines enable row level security;
create policy coa_all on coa_accounts for all to authenticated using (true) with check (true);
create policy je_all on journal_entries for all to authenticated
  using (branch_id is null or public.user_can_access_branch(branch_id))
  with check (branch_id is null or public.user_can_access_branch(branch_id));
create policy jl_all on journal_lines for all to authenticated
  using (exists (select 1 from journal_entries e where e.id = journal_lines.entry_id and (e.branch_id is null or public.user_can_access_branch(e.branch_id))))
  with check (exists (select 1 from journal_entries e where e.id = journal_lines.entry_id and (e.branch_id is null or public.user_can_access_branch(e.branch_id))));
