-- Klinik: pembayaran kunjungan (PRD Addendum §3.4 step 6, §3.10 invoice + DP)

-- visit state machine dapat tahap Pembayaran antara Diperiksa dan Selesai.
alter type visit_status add value 'Pembayaran' before 'Selesai';

create table invoices (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id) on delete cascade unique,
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  total numeric not null default 0,
  dp_amount numeric not null default 0,         -- §3.10 down payment
  dp_date date,
  paid_status varchar(12) not null default 'Belum Lunas',  -- Belum Lunas / DP / Lunas
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index on invoices(visit_id);

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  deskripsi varchar(160) not null,
  qty int not null default 1,
  harga numeric not null default 0,             -- §3.10 line item editable di kasir
  created_at timestamptz not null default now()
);
create index on invoice_items(invoice_id);

alter table invoices enable row level security;
alter table invoice_items enable row level security;

-- ponytail: gate lewat visits.branch_id, konsisten dgn medical_records.
create policy inv_all on invoices for all to authenticated
  using (exists (select 1 from visits v where v.id = invoices.visit_id and public.user_can_access_branch(v.branch_id)))
  with check (exists (select 1 from visits v where v.id = invoices.visit_id and public.user_can_access_branch(v.branch_id)));

create policy invit_all on invoice_items for all to authenticated
  using (exists (select 1 from invoices i join visits v on v.id = i.visit_id
                 where i.id = invoice_items.invoice_id and public.user_can_access_branch(v.branch_id)))
  with check (exists (select 1 from invoices i join visits v on v.id = i.visit_id
                 where i.id = invoice_items.invoice_id and public.user_can_access_branch(v.branch_id)));
