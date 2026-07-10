-- Tier otomatis & kategori pelanggan (spec 2026-07-10)

-- 1) rename keanggotaan -> kategori, ganti default & nilai existing
alter table customers rename column keanggotaan to kategori;
alter table customers alter column kategori set default 'Umum';
update customers set kategori = 'Umum' where kategori = 'Non Member';
-- nilai 'Member' tetap 'Member'

-- 2) settings tier — single row, threshold admin-editable (pola quest_settings)
create table tier_settings (
  id int primary key default 1 check (id = 1),
  bronze_min numeric not null default 1000000,
  silver_min numeric not null default 5000000,
  gold_min numeric not null default 15000000,
  platinum_min numeric not null default 50000000
);
insert into tier_settings default values;
alter table tier_settings enable row level security;
create policy tier_settings_read on tier_settings for select to authenticated using (true);
create policy tier_settings_write on tier_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 3) backfill sekali: recompute total_spending & tier semua customer existing
--    (formula sama persis dgn recomputeCustomerTier: petshop sales + klinik invoices lunas)
with agg as (
  select c.id,
    coalesce((select sum(s.total) from sales s where s.customer_id = c.id), 0)
    + coalesce((select sum(i.total) from invoices i join visits v on v.id = i.visit_id
                where v.customer_id = c.id and i.paid_status = 'Lunas' and i.voided_at is null), 0) as combined
  from customers c
)
update customers c set
  total_spending = agg.combined,
  tier = case
    when agg.combined >= (select platinum_min from tier_settings) then 'Platinum'
    when agg.combined >= (select gold_min from tier_settings) then 'Gold'
    when agg.combined >= (select silver_min from tier_settings) then 'Silver'
    when agg.combined >= (select bronze_min from tier_settings) then 'Bronze'
    else 'New'
  end
from agg where agg.id = c.id;
