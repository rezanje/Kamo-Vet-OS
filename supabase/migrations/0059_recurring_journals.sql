-- Jurnal Berulang — jurnal langganan bulanan otomatis (sewa, langganan, dll) ala Accurate.
create table recurring_journals (
  id uuid primary key default gen_random_uuid(),
  nama varchar(80) not null,
  deskripsi text,
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  branch_id uuid references branches(id) on delete set null,
  lines jsonb not null,                           -- [{code, debit, credit}]
  is_active boolean not null default true,
  last_posted char(7),                            -- YYYY-MM terakhir diposting (idempotensi)
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table recurring_journals enable row level security;
create policy rj_all on recurring_journals for all to authenticated using (true) with check (true);
