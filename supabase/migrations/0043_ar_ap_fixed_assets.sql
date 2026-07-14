-- Keuangan: pelunasan piutang (AR), pembayaran hutang pembelian (AP), aset tetap + penyusutan.

-- Pembayaran piutang atas invoice klinik (DP / Belum Lunas → cicilan → Lunas).
create table invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  tanggal date not null default current_date,
  amount numeric not null,
  metode varchar(16) not null default 'Tunai',   -- Tunai / QRIS / Transfer / Debit
  catatan text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on invoice_payments(invoice_id);

-- Pembayaran hutang usaha atas PO yang sudah Diterima.
create table po_payments (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  tanggal date not null default current_date,
  amount numeric not null,
  metode varchar(16) not null default 'Transfer',
  catatan text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on po_payments(po_id);

-- Aset tetap + log penyusutan garis lurus.
create table fixed_assets (
  id uuid primary key default gen_random_uuid(),
  nama varchar(120) not null,
  kategori varchar(40) not null default 'Peralatan',
  tanggal_perolehan date not null default current_date,
  harga_perolehan numeric not null,
  nilai_sisa numeric not null default 0,
  umur_bulan int not null,                        -- umur ekonomis dalam bulan
  branch_id uuid references branches(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table asset_depreciations (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references fixed_assets(id) on delete cascade,
  periode char(7) not null,                       -- 'YYYY-MM'
  amount numeric not null,
  created_at timestamptz not null default now(),
  unique (asset_id, periode)                      -- anti dobel-jalan per bulan
);
create index on asset_depreciations(asset_id);

alter table invoice_payments enable row level security;
alter table po_payments enable row level security;
alter table fixed_assets enable row level security;
alter table asset_depreciations enable row level security;

-- Gate invoice_payments lewat visits.branch_id (konsisten dgn invoices).
create policy invpay_all on invoice_payments for all to authenticated
  using (exists (select 1 from invoices i join visits v on v.id = i.visit_id
                 where i.id = invoice_payments.invoice_id and public.user_can_access_branch(v.branch_id)))
  with check (exists (select 1 from invoices i join visits v on v.id = i.visit_id
                 where i.id = invoice_payments.invoice_id and public.user_can_access_branch(v.branch_id)));

create policy popay_all on po_payments for all to authenticated
  using (exists (select 1 from purchase_orders p where p.id = po_payments.po_id
                 and (p.branch_id is null or public.user_can_access_branch(p.branch_id))))
  with check (exists (select 1 from purchase_orders p where p.id = po_payments.po_id
                 and (p.branch_id is null or public.user_can_access_branch(p.branch_id))));

create policy fa_all on fixed_assets for all to authenticated using (true) with check (true);
create policy fadep_all on asset_depreciations for all to authenticated using (true) with check (true);

-- COA baru: aset tetap, akumulasi penyusutan (kontra-aset, normal D supaya saldo
-- tampil negatif dan total ASET otomatis bersih), beban penyusutan.
insert into coa_accounts (code, name, type, normal_balance) values
  ('1501','Aset Tetap','ASET','D'),
  ('1509','Akumulasi Penyusutan','ASET','D'),
  ('5601','Beban Penyusutan','BEBAN','D')
on conflict (code) do nothing;
