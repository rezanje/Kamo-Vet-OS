-- POS Fase 2: shift kasir + rekonsiliasi kas (PRD §2.1)

create table cashier_shifts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete restrict,
  opened_by uuid references profiles(id) on delete set null,
  opening_balance numeric not null default 0,    -- modal awal kas
  opened_at timestamptz not null default now(),
  closing_balance numeric,                        -- kas dihitung saat tutup
  expected_cash numeric,                          -- modal + penjualan tunai shift
  selisih numeric,                                -- closing - expected (lebih/kurang)
  closed_at timestamptz,
  status varchar(8) not null default 'open'       -- open / closed
);
create index on cashier_shifts(branch_id);
-- satu shift open per cabang+kasir.
create unique index cashier_shifts_one_open on cashier_shifts(branch_id, opened_by) where status = 'open';

alter table sales add column shift_id uuid references cashier_shifts(id) on delete set null;

alter table cashier_shifts enable row level security;
create policy shifts_all on cashier_shifts for all to authenticated
  using (public.user_can_access_branch(branch_id))
  with check (public.user_can_access_branch(branch_id));
