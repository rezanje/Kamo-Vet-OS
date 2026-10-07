-- Run only against an isolated local database after the clinic posting migrations.
begin;

insert into auth.users(id, raw_user_meta_data) values
  ('fa000000-0000-4000-8000-000000000001', '{}'),
  ('fa000000-0000-4000-8000-000000000002', '{}');
update public.profiles set role = 'OWNER' where id = 'fa000000-0000-4000-8000-000000000001';
update public.profiles set role = 'DOCTOR' where id = 'fa000000-0000-4000-8000-000000000002';
insert into public.items(id, code, name, unit, item_type, is_active, is_compound_material, sell_price)
values ('fb000000-0000-4000-8000-000000000001', 'CAT-ING', 'Bahan Katalog', 'gram', 'Persediaan', true, true, 15);
insert into public.items(id, code, name, unit, item_type, is_active, is_compound_material, sell_price)
values ('fb000000-0000-4000-8000-000000000002', 'CAT-SKU', 'Obat Racik Katalog Uji', 'pcs', 'Persediaan', true, false, 75);
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

insert into public.items(id, code, name, unit, item_type, is_active, is_compound_material, sell_price)
values ('fb000000-0000-4000-8000-000000000003', 'CAT-SKU-OTHER', 'Obat Racik Katalog Lain', 'pcs', 'Persediaan', true, false, 95);
create function pg_temp.binding_state() returns jsonb language sql as $$
select jsonb_build_object('sales',(select count(*) from public.clinic_compound_sales),
  'recipes',(select count(*) from public.compounding_recipes),
  'prescriptions',(select count(*) from public.prescription_items),
  'stock',(select jsonb_agg(to_jsonb(s) order by s.id) from public.stock s),
  'layers',(select jsonb_agg(to_jsonb(l) order by l.id) from public.stock_layers l),
  'moves',(select count(*) from public.stock_moves),
  'journals',(select count(*) from public.journal_entries));
$$;
grant execute on function pg_temp.binding_state() to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000001',true);

do $$
declare
  version_id uuid; formula_id uuid; issued uuid; direct_issued uuid;
  before_state jsonb; after_state jsonb; failed boolean;
begin
  version_id:=public.publish_compound_formula(null,'BIND-TEST','Test approved formula','puyer','Test instruction',
    '[{"item_id":"fb000000-0000-4000-8000-000000000001","quantity":1,"unit":"gram"}]');
  select v.formula_id into formula_id from public.compound_formula_versions v where v.id=version_id;
  before_state:=pg_temp.binding_state();
  failed:=false;
  begin
    perform public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',
      'fb000000-0000-4000-8000-000000000002',null,'binding-unassigned',version_id,null);
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'FORMULA_SKU_MISMATCH:%' then raise; end if; failed:=true;
  end;
  if not failed or pg_temp.binding_state() is distinct from before_state then raise exception 'unassigned issue changed state'; end if;
  failed:=false;
  begin
    perform public.bind_compound_formula_sale_item(formula_id,'fb000000-0000-4000-8000-000000000001');
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'ITEM_INVALID:%' then raise; end if; failed:=true;
  end;
  if not failed then raise exception 'raw material accepted as selling SKU'; end if;
  perform public.bind_compound_formula_sale_item(formula_id,'fb000000-0000-4000-8000-000000000002');
  failed:=false;
  begin
    perform public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',
      'fb000000-0000-4000-8000-000000000003',null,'binding-mismatch',version_id,null);
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'FORMULA_SKU_MISMATCH:%' then raise; end if; failed:=true;
  end;
  if not failed or pg_temp.binding_state() is distinct from before_state then raise exception 'mismatched issue changed state'; end if;
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000002',true);
  failed:=false;
  begin perform public.bind_compound_formula_sale_item(formula_id,'fb000000-0000-4000-8000-000000000003');
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'ACCESS_DENIED:%' then raise; end if; failed:=true;
  end;
  if not failed then raise exception 'doctor changed selling binding'; end if;
  issued:=public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',
    'fb000000-0000-4000-8000-000000000002',null,'binding-valid',version_id,null);
  after_state:=pg_temp.binding_state();
  if public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',
    'fb000000-0000-4000-8000-000000000002',null,'binding-valid',version_id,null) is distinct from issued
    or pg_temp.binding_state() is distinct from after_state then raise exception 'retry duplicated effects'; end if;
  direct_issued:=public.clinic_issue_official_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',version_id,'binding-direct',null);
  if not exists(select 1 from public.clinic_compound_sales where recipe_id=direct_issued and sale_item_id='fb000000-0000-4000-8000-000000000002' and sale_price=75)
    or not exists(select 1 from public.prescription_items where compound_recipe_id=direct_issued and harga=75) then raise exception 'direct official call bypassed configured selling price'; end if;
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000001',true);
  perform public.bind_compound_formula_sale_item(formula_id,'fb000000-0000-4000-8000-000000000003');
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000002',true);
  after_state:=pg_temp.binding_state();
  if public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',
    'fb000000-0000-4000-8000-000000000002',null,'binding-valid',version_id,null) is distinct from issued
    or pg_temp.binding_state() is distinct from after_state then raise exception 'historical retry failed after rebind'; end if;
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000001',true);
  perform public.bind_compound_formula_sale_item(formula_id,null);
  failed:=false;
  begin perform public.clinic_issue_official_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',version_id,'binding-cleared',null);
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'FORMULA_SKU_MISMATCH:%' then raise; end if; failed:=true;
  end;
  if not failed or pg_temp.binding_state() is distinct from after_state then raise exception 'cleared binding changed state'; end if;
end;
$$;
rollback;
