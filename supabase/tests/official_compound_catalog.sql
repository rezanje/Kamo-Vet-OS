-- Run only against an isolated local database after the clinic posting migrations.
begin;

insert into auth.users(id, raw_user_meta_data) values
  ('fa000000-0000-4000-8000-000000000001', '{}'),
  ('fa000000-0000-4000-8000-000000000002', '{}');
update public.profiles set role = 'OWNER' where id = 'fa000000-0000-4000-8000-000000000001';
update public.profiles set role = 'DOCTOR' where id = 'fa000000-0000-4000-8000-000000000002';
insert into public.items(id, code, name, unit, item_type, is_active, is_compound_material, sell_price)
values ('fb000000-0000-4000-8000-000000000001', 'CAT-ING', 'Bahan Katalog', 'gram', 'Persediaan', true, true, 15);
insert into public.branches(id, code, name, type)
values ('fc000000-0000-4000-8000-000000000001', 'CAT-BR', 'Cabang Katalog', 'KLINIK');
insert into public.warehouses(id, branch_id, code, name, type)
values ('f2000000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001',
  'CAT-WH', 'Gudang Racikan Uji', 'VET');
insert into public.stock(warehouse_id, item_id, qty)
values ('f2000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001', 10);
insert into public.stock_layers(warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source)
values ('f2000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001',
  current_date, 10, 10, 5, 'purchase');
insert into public.user_branches(user_id, branch_id) values
  ('fa000000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001'),
  ('fa000000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000001');
insert into public.customers(id, name, phone)
values ('ff000000-0000-4000-8000-000000000001', 'Pemilik Uji', '080000000001');
insert into public.pets(id, customer_id, name)
values ('f1000000-0000-4000-8000-000000000001', 'ff000000-0000-4000-8000-000000000001', 'Hewan Uji');
insert into public.visits(id, branch_id, customer_id, pet_id)
values ('fd000000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001',
  'ff000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001');
insert into public.medical_records(id, visit_id)
values ('fe000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_formula_id uuid;
  first_version uuid;
  second_version uuid;
  v_recipe_id uuid;
  failed boolean;
  ingredients jsonb := '[{"item_id":"fb000000-0000-4000-8000-000000000001","quantity":2,"unit":"gram"}]';
begin
  if has_table_privilege('authenticated','public.compound_formulas','INSERT')
     or has_table_privilege('authenticated','public.compound_official_usage','INSERT') then
    raise exception 'catalog writes bypass the company RPC';
  end if;
  first_version := public.publish_compound_formula(null, 'R-01', 'Puyer Uji', 'puyer', '2x sehari', ingredients);
  select v.formula_id into v_formula_id from public.compound_formula_versions v where v.id = first_version;
  if v_formula_id is null or (select v.ingredients->0->>'unit_price' from public.compound_formula_versions v where v.id = first_version) <> '15' then
    raise exception 'company formula/version or selling-price snapshot missing';
  end if;
  second_version := public.publish_compound_formula(v_formula_id, 'R-01', 'Puyer Revisi', 'puyer', '3x sehari', ingredients);
  if (select version from public.compound_formula_versions where id = second_version) <> 2
     or (select name from public.compound_formula_versions where id = first_version) <> 'Puyer Uji' then
    raise exception 'publishing modified the historical version';
  end if;
  failed := false;
  begin
    perform public.publish_compound_formula(null, 'BAD-QTY', 'Tanpa Takaran', 'puyer', null,
      '[{"item_id":"fb000000-0000-4000-8000-000000000001","unit":"gram"}]');
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'formula with missing quantity was published'; end if;
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000002',true);
  failed := false;
  begin
    perform public.publish_compound_formula(null,'BAD','Unauthorized','puyer',null,ingredients);
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'doctor published a company formula'; end if;
  failed := false;
  begin
    perform public.set_compound_formula_active(v_formula_id, false);
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'doctor disabled a company formula'; end if;
  failed := false;
  begin
    update public.profiles set role = 'OWNER' where id = 'fa000000-0000-4000-8000-000000000002';
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'doctor promoted their own role'; end if;
  failed := false;
  begin
    perform public.clinic_issue_official_compound(
      'fe000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', first_version, 'catalog-stale', null);
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'stale version was issued'; end if;
  v_recipe_id := public.clinic_issue_official_compound(
    'fe000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', second_version, 'catalog-valid', '3x sehari');
  if v_recipe_id is null or (select u.formula_version_id from public.compound_official_usage u where u.recipe_id = v_recipe_id) is distinct from second_version then
    raise exception 'issued recipe has no immutable company-version reference';
  end if;
  if public.clinic_issue_official_compound(
    'fe000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', second_version, 'catalog-valid', '3x sehari') <> v_recipe_id then
    raise exception 'retry did not return the original issue';
  end if;
  failed := false;
  begin
    perform public.clinic_issue_official_compound(
      'fe000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', second_version, 'catalog-valid', 'dosis lain');
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'changed patient instruction reused an issue key'; end if;
  failed := false;
  begin
    update public.compounding_recipes set recipe_name = 'Diubah' where id = v_recipe_id;
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'issued official recipe snapshot was edited'; end if;
  failed := false;
  begin
    update public.compounding_ingredients set quantity = 100 where recipe_id = v_recipe_id;
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'issued official ingredients were edited'; end if;
  failed := false;
  begin
    update public.prescription_items set harga = 1 where compound_recipe_id = v_recipe_id;
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'issued official billing line was edited'; end if;
  failed := false;
  begin
    perform public.clinic_issue_official_compound(
      'fe000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', second_version, 'catalog-other-dosage', 'dosis lain');
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'nonstandard patient dosage was issued as official'; end if;
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000001',true);
  perform public.set_compound_formula_active(v_formula_id, false);
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000002',true);
  if public.clinic_issue_official_compound(
    'fe000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', second_version, 'catalog-valid', '3x sehari') <> v_recipe_id then
    raise exception 'safe retry failed after formula deactivation';
  end if;
  failed := false;
  begin
    perform public.clinic_issue_official_compound(
      'fe000000-0000-4000-8000-000000000001', 'fd000000-0000-4000-8000-000000000001', second_version, 'catalog-inactive', null);
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'inactive company formula was issued'; end if;
end;
$$;

rollback;
