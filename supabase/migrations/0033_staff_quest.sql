-- Addendum §8: gamifikasi staff (Daily/Monthly Quest, streak, leaderboard, reward).
-- Currency TERPISAH dari poin customer (Modul 02) — jangan pernah digabung.

create table staff_quest_definitions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id) on delete cascade,   -- null = berlaku semua cabang
  quest_type text not null check (quest_type in ('daily','monthly')),
  title text not null,
  target_kind text not null check (target_kind in ('product_qty','category_qty','total_sales_amount')),
  target_ref_id uuid,                                          -- item_id / category_id; null utk total_sales_amount
  target_value numeric not null,
  points_reward int not null,
  is_active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table staff_quest_progress (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references profiles(id) on delete cascade,
  quest_definition_id uuid not null references staff_quest_definitions(id) on delete cascade,
  period_key text not null,                                    -- 'YYYY-MM-DD' daily, 'YYYY-MM' monthly
  current_value numeric not null default 0,
  status text not null default 'in_progress' check (status in ('in_progress','completed','claimed')),
  completed_at timestamptz,
  claimed_at timestamptz,
  unique (staff_id, quest_definition_id, period_key)
);

create table staff_points (
  staff_id uuid primary key references profiles(id) on delete cascade,
  total_points int not null default 0,
  updated_at timestamptz not null default now()
);

create table staff_points_ledger (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references profiles(id) on delete cascade,
  points_delta int not null,                                   -- positif = earn, negatif = redeem
  source_type text not null check (source_type in ('quest_completion','streak_bonus','reward_redemption','manual_adjustment')),
  source_id uuid,
  branch_id uuid references branches(id) on delete set null,   -- cabang transaksi (leaderboard per cabang)
  notes text,
  created_at timestamptz not null default now()
);
create index on staff_points_ledger(staff_id);

create table staff_streaks (
  staff_id uuid primary key references profiles(id) on delete cascade,
  current_streak_days int not null default 0,
  longest_streak_days int not null default 0,
  last_active_date date,
  updated_at timestamptz not null default now()
);

create table staff_reward_catalog (
  id uuid primary key default gen_random_uuid(),
  reward_name text not null,
  reward_type text not null check (reward_type in ('discount_voucher','free_shipping','free_product','bonus_points')),
  points_cost int not null,
  reward_value jsonb,
  is_active boolean not null default true
);

create table staff_reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references profiles(id) on delete cascade,
  reward_catalog_id uuid not null references staff_reward_catalog(id) on delete restrict,
  points_spent int not null,
  status text not null default 'pending_fulfillment' check (status in ('pending_fulfillment','fulfilled','cancelled')),
  redeemed_at timestamptz not null default now(),
  fulfilled_by uuid references profiles(id) on delete set null,
  fulfilled_at timestamptz
);

-- bonus streak configurable (spec: jangan hardcode nilainya).
create table quest_settings (
  id int primary key default 1 check (id = 1),
  streak_bonus_every_days int not null default 5,
  streak_bonus_points int not null default 50
);
insert into quest_settings default values;

alter table staff_quest_definitions enable row level security;
alter table staff_quest_progress enable row level security;
alter table staff_points enable row level security;
alter table staff_points_ledger enable row level security;
alter table staff_streaks enable row level security;
alter table staff_reward_catalog enable row level security;
alter table staff_reward_redemptions enable row level security;
alter table quest_settings enable row level security;

-- ponytail: PROTOTYPE ONLY relax (kasir world), KECUALI ledger yang immutable by design.
create policy sqd_all on staff_quest_definitions for all to authenticated using (true) with check (true);
create policy sqp_all on staff_quest_progress for all to authenticated using (true) with check (true);
create policy sp_all on staff_points for all to authenticated using (true) with check (true);
-- spec §8 edge case: ledger immutable — insert/select saja, tanpa update/delete (jejak audit anti-kolusi).
create policy spl_sel on staff_points_ledger for select to authenticated using (true);
create policy spl_ins on staff_points_ledger for insert to authenticated with check (true);
create policy ss_all on staff_streaks for all to authenticated using (true) with check (true);
create policy src_all on staff_reward_catalog for all to authenticated using (true) with check (true);
create policy srr_all on staff_reward_redemptions for all to authenticated using (true) with check (true);
create policy qs_all on quest_settings for all to authenticated using (true) with check (true);

-- contoh quest & reward awal (bisa diubah dari dashboard admin).
insert into staff_quest_definitions (quest_type, title, target_kind, target_value, points_reward) values
  ('daily',   'Total Penjualan Hari Ini Rp 1.000.000', 'total_sales_amount', 1000000, 40),
  ('daily',   'Jual 10 item apa saja',                 'product_qty',        10,      30),
  ('monthly', 'Total Penjualan Bulan Ini Rp 20.000.000','total_sales_amount', 20000000, 300);

insert into staff_reward_catalog (reward_name, reward_type, points_cost, reward_value) values
  ('Voucher Diskon 10%', 'discount_voucher', 500,  '{"discount_pct": 10}'),
  ('Gratis Ongkir',      'free_shipping',    750,  '{}'),
  ('Bonus Poin 100',     'bonus_points',     300,  '{"bonus_points": 100}');
