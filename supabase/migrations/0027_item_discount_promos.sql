-- Addendum §6: diskon per item + promo terdaftar (reminder engine kasir).
alter table sale_items
  add column item_discount_type text check (item_discount_type in ('nominal','percent')),
  add column item_discount_value numeric(15,2) not null default 0,
  add column promo_id uuid;

create table promos (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  promo_type text not null check (promo_type in ('bundling','tebus_murah','diskon_produk')),
  -- rule: {"trigger_item_ids":[..],"min_qty":2,"min_subtotal":100000,"suggest":"...","discount_type":"percent","discount_value":10}
  rule jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table sale_items add constraint sale_items_promo_fk foreign key (promo_id) references promos(id) on delete set null;

alter table promos enable row level security;
-- ponytail: PROTOTYPE ONLY — kasir world baca promo lintas cabang (pola 0025).
create policy promos_all on promos for all to authenticated using (true) with check (true);

insert into promos (name, promo_type, rule) values
  ('Bundling Makanan Kucing', 'bundling', '{"min_qty":2,"suggest":"Beli 2+ item makanan — tawarkan diskon 10% item kedua","discount_type":"percent","discount_value":10}'),
  ('Tebus Murah Vitamin', 'tebus_murah', '{"min_subtotal":100000,"suggest":"Belanja ≥ Rp100rb — tawarkan tebus murah vitamin Rp5.000","discount_type":"nominal","discount_value":5000}');
