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
-- Compare physical state independently of caller visibility while changing claims.
create function pg_temp.binding_state() returns jsonb language sql security definer set search_path='' as $$
select jsonb_build_object('sales',(select count(*) from public.clinic_compound_sales),
  'recipes',(select count(*) from public.compounding_recipes),
  'prescriptions',(select count(*) from public.prescription_items),
  'stock',(select jsonb_agg(to_jsonb(s) order by s.id) from public.stock s),
  'layers',(select jsonb_agg(to_jsonb(l) order by l.id) from public.stock_layers l),
  'moves',(select count(*) from public.stock_moves),
  'journals',(select count(*) from public.journal_entries));
$$;
grant execute on function pg_temp.binding_state() to authenticated;
create function pg_temp.fixture_invoice() returns void language sql security definer set search_path='' as $$
  insert into public.invoices(visit_id,invoice_no,paid_status)
  values('fd000000-0000-4000-8000-000000000001','GUARD-EXISTING','Belum Lunas');
$$;
grant execute on function pg_temp.fixture_invoice() to authenticated;
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
  -- PostgREST supplies request.jwt.claims, not necessarily legacy per-claim GUCs.
  -- Exercise the real nested official issue and FIFO triggers with that session.
  perform set_config('request.jwt.claim.role','',true);
  perform set_config('request.jwt.claim.sub','',true);
  before_state:=pg_temp.binding_state();
  for i in 1..3 loop
    perform set_config('request.jwt.claims',case i
      when 1 then '{"sub":"fa000000-0000-4000-8000-000000000002","role":"anon"}'
      when 2 then '{"sub":"fa000000-0000-4000-8000-000000000002","role":"service_role"}'
      else '{"role":"authenticated"}' end,true);
    failed:=false;
    begin
      perform public.clinic_issue_official_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',version_id,'invalid-session-'||i,null);
    exception when raise_exception then
      if sqlerrm not like 'ACCESS_DENIED:%' then raise; end if; failed:=true;
    end;
    if not failed or pg_temp.binding_state() is distinct from before_state then
      raise exception 'invalid session issued an official compound';
    end if;
  end loop;
  perform set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
  issued:=public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',
    'fb000000-0000-4000-8000-000000000002',null,'binding-valid',version_id,null);
  after_state:=pg_temp.binding_state();
  if public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',
    'fb000000-0000-4000-8000-000000000002',null,'binding-valid',version_id,null) is distinct from issued
    or pg_temp.binding_state() is distinct from after_state then raise exception 'retry duplicated effects'; end if;
  direct_issued:=public.clinic_issue_official_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',version_id,'binding-direct',null);
  if not exists(select 1 from public.clinic_compound_sales where recipe_id=direct_issued and sale_item_id='fb000000-0000-4000-8000-000000000002' and sale_price=75)
    or not exists(select 1 from public.prescription_items where compound_recipe_id=direct_issued and harga=75) then raise exception 'direct official call bypassed configured selling price'; end if;
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims','',true);
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

  -- Same visit and SKU, but new work after checkout must not consume stock or
  -- add a prescription. Exact retries of old work still return the old recipe.
  perform public.bind_compound_formula_sale_item(formula_id,'fb000000-0000-4000-8000-000000000002');
  update public.visits set status='Selesai',checked_out_at=now()
    where id='fd000000-0000-4000-8000-000000000001';
  before_state:=pg_temp.binding_state();
  for i in 1..3 loop
    failed:=false;
    begin
      if i=1 then
        perform public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',
          'fb000000-0000-4000-8000-000000000002',null,'paid-master',version_id,null);
      elsif i=2 then
        perform public.clinic_issue_official_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',
          version_id,'paid-official',null);
      else
        perform public.clinic_issue_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',
          '{"recipe_name":"Late","dosage_form":"puyer","ingredients":[{"item_id":"fb000000-0000-4000-8000-000000000001","quantity":1,"unit":"gram","unit_price":15}]}'::jsonb,
          'paid-custom');
      end if;
    exception when sqlstate 'P0001' then
      if sqlerrm not like 'RECIPE_POSTED:%' then raise; end if;
      failed:=true;
    end;
    if not failed or pg_temp.binding_state() is distinct from before_state then
      raise exception 'checked-out compound path % changed stock or billing',i;
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000002',true);
  if public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',
    'fb000000-0000-4000-8000-000000000002',null,'binding-valid',version_id,null) is distinct from issued
    or pg_temp.binding_state() is distinct from before_state then raise exception 'posted exact retry lost idempotency'; end if;
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000001',true);

  -- A pending visit with any invoice, including one not yet paid, is also closed
  -- to new racikan. The old invoice/stock state must remain byte-for-byte intact.
  update public.visits set status='Pembayaran',checked_out_at=null
    where id='fd000000-0000-4000-8000-000000000001';
  perform pg_temp.fixture_invoice();
  before_state:=pg_temp.binding_state();
  failed:=false;
  begin
    perform public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',
      'fb000000-0000-4000-8000-000000000002',null,'invoiced-master',version_id,null);
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'RECIPE_POSTED:%' then raise; end if;
    failed:=true;
  end;
  if not failed or pg_temp.binding_state() is distinct from before_state then raise exception 'invoiced visit accepted new racikan'; end if;
end;
$$;

-- A doctor may choose the same finished selling SKU with different actual
-- materials on separate visits. The unbound SKU has no fixed formula.
reset role;
insert into auth.users(id,raw_user_meta_data) values
  ('fa000000-0000-4000-8000-000000000003','{}'),
  ('fa000000-0000-4000-8000-000000000004','{}'),
  ('fa000000-0000-4000-8000-000000000005','{}');
update public.profiles set role='DOCTOR' where id='fa000000-0000-4000-8000-000000000003';
update public.profiles set role='STAFF' where id='fa000000-0000-4000-8000-000000000004';
update public.profiles set role='DOCTOR',is_active=false where id='fa000000-0000-4000-8000-000000000005';
insert into public.user_branches(user_id,branch_id) values
  ('fa000000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000001'),
  ('fa000000-0000-4000-8000-000000000004','fc000000-0000-4000-8000-000000000001'),
  ('fa000000-0000-4000-8000-000000000005','fc000000-0000-4000-8000-000000000001');
insert into public.branches(id,code,name,type)
values('fc000000-0000-4000-8000-000000000002','CAT-OTHER','Cabang lain uji','KLINIK');
insert into public.visits(id,branch_id,customer_id,pet_id) values
  ('fd000000-0000-4000-8000-000000000002','fc000000-0000-4000-8000-000000000001','ff000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001'),
  ('fd000000-0000-4000-8000-000000000003','fc000000-0000-4000-8000-000000000001','ff000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001'),
  ('fd000000-0000-4000-8000-000000000004','fc000000-0000-4000-8000-000000000002','ff000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001');
insert into public.medical_records(id,visit_id) values
  ('fe000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002'),
  ('fe000000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000003'),
  ('fe000000-0000-4000-8000-000000000004','fd000000-0000-4000-8000-000000000004');
insert into public.items(id,code,name,unit,item_type,is_active,is_compound_material,sell_price)
values('fb000000-0000-4000-8000-000000000004','CAT-ING-B','Bahan variabel B','gram','Persediaan',true,true,25);
insert into public.stock(warehouse_id,item_id,qty)
values('f2000000-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000004',5);
insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
values('f2000000-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000004',current_date,5,5,7,'purchase');
create function pg_temp.issued_cost(p_recipe_id uuid) returns numeric
language sql security definer set search_path='' as $$
  select coalesce(sum(qty*unit_cost),0) from public.compound_issues where recipe_id=p_recipe_id
$$;
grant execute on function pg_temp.issued_cost(uuid) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000002',true);
do $$
declare recipe_a uuid; recipe_b uuid; before_state jsonb; after_state jsonb;
  before_a numeric; before_b numeric; denied boolean;
  composition_a jsonb := '{"recipe_name":"Ignored client name","dosage_form":"kapsul","ingredients":[{"item_id":"fb000000-0000-4000-8000-000000000001","quantity":1,"unit":"gram","unit_price":999999}]}'::jsonb;
  composition_b jsonb := '{"recipe_name":"Ignored client name","dosage_form":"kapsul","ingredients":[{"item_id":"fb000000-0000-4000-8000-000000000004","quantity":2,"unit":"gram","unit_price":999999}]}'::jsonb;
begin
  if public.clinic_doctor_custom_compound_supported() is distinct from true
    or not has_function_privilege('authenticated','public.clinic_doctor_custom_compound_supported()','EXECUTE')
    or has_function_privilege('anon','public.clinic_doctor_custom_compound_supported()','EXECUTE') then
    raise exception 'doctor readiness signal or grants unavailable';
  end if;
  before_state:=pg_temp.binding_state();
  denied:=false;
  begin
    perform public.clinic_issue_compound('fe000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002',composition_a,'doctor-legacy-denied');
  exception when sqlstate 'P0001' then denied:=sqlerrm like 'ACCESS_DENIED:%'; end;
  if not denied or pg_temp.binding_state() is distinct from before_state then raise exception 'doctor reached legacy freeform RPC'; end if;
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000005',true);
  denied:=false;
  begin
    perform public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002',
      'fb000000-0000-4000-8000-000000000003',composition_a,'inactive-doctor',null,null);
  exception when sqlstate 'P0001' then denied:=sqlerrm like 'ACCESS_DENIED:%'; end;
  if not denied or pg_temp.binding_state() is distinct from before_state then raise exception 'inactive doctor issued compound'; end if;
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000003',true);
  denied:=false;
  begin
    perform public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000004','fd000000-0000-4000-8000-000000000004',
      'fb000000-0000-4000-8000-000000000003',composition_a,'other-branch-doctor',null,null);
  exception when sqlstate 'P0001' then denied:=sqlerrm like 'ACCESS_DENIED:%'; end;
  if not denied or pg_temp.binding_state() is distinct from before_state then raise exception 'doctor crossed branch'; end if;
  denied:=false;
  begin
    perform public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000003',
      'fb000000-0000-4000-8000-000000000003',composition_a,'mismatched-record-doctor',null,null);
  exception when sqlstate 'P0001' then denied:=sqlerrm like 'ACCESS_DENIED:%'; end;
  if not denied or pg_temp.binding_state() is distinct from before_state then raise exception 'doctor crossed visit and record'; end if;
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000002',true);
  select qty into before_a from public.stock where warehouse_id='f2000000-0000-4000-8000-000000000001' and item_id='fb000000-0000-4000-8000-000000000001';
  select qty into before_b from public.stock where warehouse_id='f2000000-0000-4000-8000-000000000001' and item_id='fb000000-0000-4000-8000-000000000004';
  recipe_a:=public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002',
    'fb000000-0000-4000-8000-000000000003',composition_a,'doctor-variable-a',null,null);
  if not exists(select 1 from public.clinic_compound_sales where recipe_id=recipe_a and sale_item_id='fb000000-0000-4000-8000-000000000003' and sale_price=95)
    or not exists(select 1 from public.compounding_ingredients where recipe_id=recipe_a and item_id='fb000000-0000-4000-8000-000000000001' and quantity=1)
    or pg_temp.issued_cost(recipe_a) is distinct from 5
    or (select qty from public.stock where warehouse_id='f2000000-0000-4000-8000-000000000001' and item_id='fb000000-0000-4000-8000-000000000001') is distinct from before_a-1 then
    raise exception 'first doctor composition did not use actual material cost and stock';
  end if;
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000003',true);
  recipe_b:=public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000003',
    'fb000000-0000-4000-8000-000000000003',composition_b,'doctor-variable-b',null,null);
  if recipe_b=recipe_a or not exists(select 1 from public.compounding_ingredients where recipe_id=recipe_b and item_id='fb000000-0000-4000-8000-000000000004' and quantity=2)
    or pg_temp.issued_cost(recipe_b) is distinct from 14
    or (select qty from public.stock where warehouse_id='f2000000-0000-4000-8000-000000000001' and item_id='fb000000-0000-4000-8000-000000000004') is distinct from before_b-2 then
    raise exception 'second doctor composition did not use its own material cost and stock';
  end if;
  after_state:=pg_temp.binding_state();
  if public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000003',
    'fb000000-0000-4000-8000-000000000003',composition_b,'doctor-variable-b',null,null) is distinct from recipe_b
    or pg_temp.binding_state() is distinct from after_state then raise exception 'doctor retry duplicated material issue'; end if;
  update public.visits set status='Selesai',checked_out_at=now() where id='fd000000-0000-4000-8000-000000000003';
  denied:=false;
  begin
    perform public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000003',
      'fb000000-0000-4000-8000-000000000003',composition_b,'doctor-after-checkout',null,null);
  exception when sqlstate 'P0001' then denied:=sqlerrm like 'RECIPE_POSTED:%'; end;
  if not denied or pg_temp.binding_state() is distinct from after_state then raise exception 'doctor issued after checkout'; end if;
  if public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000003','fd000000-0000-4000-8000-000000000003',
    'fb000000-0000-4000-8000-000000000003',composition_b,'doctor-variable-b',null,null) is distinct from recipe_b
    or pg_temp.binding_state() is distinct from after_state then raise exception 'posted doctor retry changed history'; end if;
  perform set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000004',true);
  denied:=false;
  begin
    perform public.clinic_issue_master_compound('fe000000-0000-4000-8000-000000000002','fd000000-0000-4000-8000-000000000002',
      'fb000000-0000-4000-8000-000000000003',composition_a,'staff-custom-denied',null,null);
  exception when sqlstate 'P0001' then denied:=sqlerrm like 'ACCESS_DENIED:%'; end;
  if not denied or pg_temp.binding_state() is distinct from after_state then raise exception 'staff issued doctor composition'; end if;
end $$;
rollback;
