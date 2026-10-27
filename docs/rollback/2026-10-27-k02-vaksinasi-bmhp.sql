-- K02 follow-up (27 Oct 2026): vaccination records BMHP.
--
-- Owner decision (Reza, 27 Oct 2026, option A): each vaccine gets its own clinic service
-- "Vaksinasi <name>" (item_type Jasa) under TINDAKAN > VAKSIN REGULER — TINDAKAN, priced like
-- the vial. The 18 vials stay stock items (Persediaan) and move to VACCINE > VAKSIN REGULER,
-- so they appear in the medicine list and can be chosen as BMHP of the vaccination service.
-- Billing stays one line at the same price; the vial, syringe, swab etc. are issued from stock
-- by the existing K02 BMHP posting, with their cost on the service line.
--
-- tindakan_kategori is 'Konsultasi' like every other clinic service in production. With
-- consent_rules empty, 'Vaksinasi' would fall back to the built-in mandatory-consent list
-- and suddenly require a consent form on every vaccination.
--
-- Nothing else references the vials (no branch prices, commission rules or promos on
-- 27 Oct 2026). Vial history (Vaccine F4 sales, Rabies 10Ds DF stock) is kept on the vial items;
-- reports grouped by category show those vials under VACCINE from now on.

-- Forward (applied once on production)
begin;

insert into public.items (code, name, category_id, item_type, unit, sell_price, buy_price, min_stock,
  tindakan_kategori, is_active, is_compound_material, target_species, track_expiry)
select 'JV-' || v.code,
       'Vaksinasi ' || regexp_replace(v.name, '^Vaccine\s+', ''),
       '9c784b49-58c2-4a82-b975-1e0fd843862e', -- TINDAKAN > VAKSIN REGULER — TINDAKAN
       'Jasa', 'PCS', v.sell_price, 0, 0, 'Konsultasi', true, false, 'Universal', false
from public.items v
where v.category_id = '9c784b49-58c2-4a82-b975-1e0fd843862e'
  and v.is_active and v.item_type = 'Persediaan' and v.name ilike 'Vaccine %';

update public.items v set category_id = 'e440ee84-7fc3-4c2c-a116-34a72a224be9' -- VACCINE > VAKSIN REGULER
where v.category_id = '9c784b49-58c2-4a82-b975-1e0fd843862e'
  and v.is_active and v.item_type = 'Persediaan' and v.name ilike 'Vaccine %';

commit;

-- Rollback (only while no vaccination service has been used on a prescription or invoice):
-- begin;
-- update public.items set category_id = '9c784b49-58c2-4a82-b975-1e0fd843862e'
-- where category_id = 'e440ee84-7fc3-4c2c-a116-34a72a224be9' and item_type = 'Persediaan'
--   and name ilike 'Vaccine %';
-- delete from public.items where code like 'JV-%' and item_type = 'Jasa' and name ilike 'Vaksinasi %';
-- commit;
-- Once a service has history, deactivate it from the item master instead of deleting it.
