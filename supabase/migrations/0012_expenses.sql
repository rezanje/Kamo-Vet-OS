-- Modul Pengeluaran (PRD §2.5)
create table expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete restrict,
  tanggal date not null default current_date,
  kategori varchar(40) not null,
  deskripsi text,
  jumlah numeric not null default 0,
  metode_bayar varchar(16) not null default 'Tunai',
  bukti_url text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on expenses(branch_id);
alter table expenses enable row level security;
create policy expenses_all on expenses for all to authenticated
  using (public.user_can_access_branch(branch_id))
  with check (public.user_can_access_branch(branch_id));
