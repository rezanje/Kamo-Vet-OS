-- K02 follow-up (27 Oct 2026, evening): last stockless TINDAKAN items and the Vaccine F4 vial.
--
-- Field report (Andri, 21.21 WIB): Anestesi Inhalasi and other TINDAKAN items still joined the cart
-- as stock with no BMHP composer. They were the items held back from
-- 2026-10-27-k02-tindakan-service-type.sql: four flagged as compound material by the import and three
-- referenced by one unpaid prescription line each. None has stock, stock moves, cost events, receipts,
-- compound recipes, branch prices, commission rules or promos. The three prescription lines belong to
-- test visits (pets Snowy and choco) waiting at payment; they already could not be paid (no stock),
-- and they are left untouched: those test bills need to be redone.
--
-- Vaccine F4 (OBT-00431) was moved back under TINDAKAN by hand at 21.17 WIB, so it joined the cart as
-- stock again. It returns to VACCINE > VAKSIN REGULER; the clinic forms now also route a vial picked
-- anywhere to its "Vaksinasi" service with the vial as BMHP.
--
-- Obat Empedu (Urdflk) and Obat Kumur Minosep 10Ml stay stock items: they are medicines.

-- Forward (applied once on production)
begin;

update public.items set item_type = 'Jasa', is_compound_material = false
where item_type = 'Persediaan' and id in (
  '0aa32c1a-c396-42e0-a1ad-402e4655a383', -- 100679 Anestesi Inhalasi
  '7fc52cb8-8ac4-4cac-af48-3c697cc062ed', -- J0003  Cabut Gigi
  '78cd267d-4bc3-41e2-8a25-82e9dcebc8bf', -- J0004  Cairan Pembersih
  '1826bad9-814d-4821-9c77-869735154b2b', -- J0212  Folif Telinga Hidung
  '7150e0b8-4b67-43c0-a024-1658879be78e', -- J0013  Infus Iv
  'e019ba18-36a7-45b3-8d64-b6ee5c6af49d'  -- J0189  Tindakan Medis 1 Emergency
);

update public.items set category_id = 'e440ee84-7fc3-4c2c-a116-34a72a224be9' -- VACCINE > VAKSIN REGULER
where id = '5075c095-814e-42af-a0a3-8f97fc7631d3'; -- OBT-00431 Vaccine F4

commit;

-- Rollback (only while none of the six has been billed as a service):
-- begin;
-- update public.items set item_type = 'Persediaan', is_compound_material = true
-- where id in ('0aa32c1a-c396-42e0-a1ad-402e4655a383','7fc52cb8-8ac4-4cac-af48-3c697cc062ed',
--   '78cd267d-4bc3-41e2-8a25-82e9dcebc8bf','1826bad9-814d-4821-9c77-869735154b2b');
-- update public.items set item_type = 'Persediaan'
-- where id in ('7150e0b8-4b67-43c0-a024-1658879be78e','e019ba18-36a7-45b3-8d64-b6ee5c6af49d');
-- commit;
