-- Penjualan Online / B2C — Fase 5, penutup roadmap paritas Accurate
-- (spec: docs/superpowers/specs/2026-07-23-penjualan-online-design.md)

-- Akun: dana marketplace yang belum cair + beban komisi platform.
insert into coa_accounts (code, name, type, normal_balance) values
  ('1202', 'Piutang Marketplace', 'ASET', 'D'),
  ('5305', 'Beban Komisi Marketplace', 'BEBAN', 'D')
on conflict (code) do nothing;

-- Semua kolom nullable / berdefault: baris POS & klinik lama tidak tersentuh.
-- channel null = penjualan POS retail (perilaku lama, tetap default).
alter table sales
  add column if not exists channel varchar(20),
  add column if not exists external_ref varchar(60),
  add column if not exists buyer_name varchar(120),
  add column if not exists marketplace_status varchar(16),
  add column if not exists komisi numeric not null default 0,
  add column if not exists disbursed_at timestamptz;

alter table sales drop constraint if exists sales_channel_check;
alter table sales add constraint sales_channel_check
  check (channel is null or channel in ('Shopee','Tokopedia','TikTok Shop','WA'));

alter table sales drop constraint if exists sales_marketplace_status_check;
alter table sales add constraint sales_marketplace_status_check
  check (marketplace_status is null or marketplace_status in ('piutang','cair'));

create index if not exists sales_channel_idx on sales(channel) where channel is not null;
