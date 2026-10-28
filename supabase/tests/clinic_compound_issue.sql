-- Run after `supabase db reset` against the LOCAL Supabase database only.
-- This transaction is rolled back. Fixtures use fixed UUIDs for reproducible local runs.
begin;

-- Test-only definer helper lets the authenticated test assert rollback on the
-- private HPP ledger without granting direct table access to authenticated.
create or replace function public.test_compound_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  issue_count bigint := 0;
begin
  if to_regclass('public.compound_issues') is not null then
    execute 'select count(*) from public.compound_issues i join public.compounding_recipes r on r.id = i.recipe_id where r.medical_record_id in (''70000000-0000-4000-8000-000000000001'', ''70000000-0000-4000-8000-000000000002'')'
      into issue_count;
  end if;
  return jsonb_build_object(
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object('warehouse_id', s.warehouse_id, 'item_id', s.item_id, 'qty', s.qty)
                       order by s.warehouse_id, s.item_id)
      from public.stock s
      where s.warehouse_id in ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002')
        and s.item_id between '80000000-0000-4000-8000-000000000001' and '80000000-0000-4000-8000-000000000005'
    ), '[]'::jsonb),
    'layers', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'qty_left', l.qty_left, 'unit_cost', l.unit_cost, 'exp_date', l.exp_date)
                       order by l.id)
      from public.stock_layers l
      where l.warehouse_id in ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002')
        and l.item_id between '80000000-0000-4000-8000-000000000001' and '80000000-0000-4000-8000-000000000005'
    ), '[]'::jsonb),
    'moves', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.id)
      from public.stock_moves m
      where m.warehouse_id in ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002')
        and m.item_id between '80000000-0000-4000-8000-000000000001' and '80000000-0000-4000-8000-000000000005'
    ), '[]'::jsonb),
    'recipes', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.id)
      from public.compounding_recipes r
      where r.medical_record_id in ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002')
    ), '[]'::jsonb),
    'ingredients', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.id)
      from public.compounding_ingredients i
      join public.compounding_recipes r on r.id = i.recipe_id
      where r.medical_record_id in ('70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002')
    ), '[]'::jsonb),
    'issues', issue_count
  );
end;
$$;
grant execute on function public.test_compound_state() to authenticated;

create or replace function public.test_compound_issues(p_recipe_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', i.item_id,
    'qty', i.qty,
    'unit_cost', i.unit_cost,
    'exp_date', i.exp_date,
    'restored_at', i.restored_at
  ) order by i.item_id, i.stock_layer_id), '[]'::jsonb)
  from public.compound_issues i
  where i.recipe_id = p_recipe_id;
$$;
grant execute on function public.test_compound_issues(uuid) to authenticated;

insert into auth.users (id, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001', '{"full_name":"Pemilik Cabang A"}'),
  ('10000000-0000-4000-8000-000000000002', '{"full_name":"Dokter Cabang B"}');
update profiles set role = 'OWNER' where id = '10000000-0000-4000-8000-000000000001';
update profiles set role = 'DOCTOR' where id = '10000000-0000-4000-8000-000000000002';

insert into branches (id, code, name, type) values
  ('20000000-0000-4000-8000-000000000001', 'TEST-A', 'Klinik Test A', 'KLINIK'),
  ('20000000-0000-4000-8000-000000000002', 'TEST-B', 'Klinik Test B', 'KLINIK');
insert into user_branches (user_id, branch_id) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002');
insert into warehouses (id, branch_id, code, name, type) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'TEST-WA', 'Gudang Test A', 'VET'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'TEST-WB', 'Gudang Test B', 'VET');
insert into customers (id, name, phone) values
  ('40000000-0000-4000-8000-000000000001', 'Pelanggan Test A', '080000000001'),
  ('40000000-0000-4000-8000-000000000002', 'Pelanggan Test B', '080000000002');
insert into pets (id, customer_id, name) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Pasien Test A'),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'Pasien Test B');
insert into visits (id, branch_id, customer_id, pet_id) values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002');
insert into medical_records (id, visit_id) values
  ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002');
insert into items (id, code, name, unit, buy_price, is_compound_material) values
  ('80000000-0000-4000-8000-000000000001', 'TEST-A1', 'Bahan A', 'gram', 99, true),
  ('80000000-0000-4000-8000-000000000002', 'TEST-B1', 'Bahan B', 'ml', 99, true),
  ('80000000-0000-4000-8000-000000000003', 'TEST-C1', 'Bahan Layer Kurang', 'pcs', 99, true),
  ('80000000-0000-4000-8000-000000000004', 'TEST-D1', 'Bahan Tanpa HPP', 'pcs', 99, true),
  ('80000000-0000-4000-8000-000000000005', 'TEST-E1', 'Bahan Unit Terakhir', 'pcs', 99, true);
insert into stock (warehouse_id, item_id, qty) values
  ('30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 3),
  ('30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', 1),
  ('30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000003', 2),
  ('30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000004', 1),
  ('30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000005', 1),
  ('30000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000002', 1);
insert into stock_layers (id, warehouse_id, item_id, tanggal, exp_date, qty_in, qty_left, unit_cost, source) values
  ('90000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '2026-01-01', '2026-12-01', 1, 1, 2.123456, 'purchase'),
  ('90000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '2026-02-01', '2027-03-01', 2, 2, 3.5, 'purchase'),
  ('90000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', '2026-01-01', null, 1, 1, 5.25, 'purchase'),
  ('90000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000002', '2026-01-01', null, 1, 1, 5, 'purchase'),
  ('90000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000003', '2026-01-01', null, 1, 1, 4, 'purchase'),
  ('90000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000004', '2026-01-01', null, 1, 1, 0, 'purchase'),
  ('90000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000005', '2026-01-01', null, 1, 1, 7, 'purchase');
insert into compounding_recipes (id, medical_record_id, recipe_name, dosage_form, total_price, status)
values ('a0000000-0000-4000-8000-000000000099', '70000000-0000-4000-8000-000000000001', 'Racikan Lama', 'puyer', 1, 'pending');
insert into compounding_ingredients (recipe_id, ingredient_name, item_id, quantity, unit, unit_price)
values ('a0000000-0000-4000-8000-000000000099', 'Bahan A', '80000000-0000-4000-8000-000000000001', 1, 'gram', 1);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  issued uuid;
  repeated uuid;
  before_state jsonb;
  failed boolean;
  valid_recipe jsonb := '{
    "recipe_name":"Racikan Valid",
    "dosage_instruction":"2x sehari",
    "dosage_form":"puyer",
    "ingredients":[
      {"item_id":"80000000-0000-4000-8000-000000000001","quantity":2,"unit":"gram","unit_price":10,"hpp":0.01},
      {"item_id":"80000000-0000-4000-8000-000000000002","quantity":1,"unit":"ml","unit_price":20,"hpp":0.01}
    ]
  }'::jsonb;
begin
  -- Ingredient 2 shortage rolls back ingredient 1, layers, moves, BOM and HPP ledger.
  before_state := public.test_compound_state();
  failed := false;
  begin
    perform public.clinic_issue_compound(
      '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
      '{"recipe_name":"Racikan Kurang","dosage_form":"puyer","ingredients":[{"item_id":"80000000-0000-4000-8000-000000000001","quantity":1,"unit":"gram","unit_price":10},{"item_id":"80000000-0000-4000-8000-000000000002","quantity":2,"unit":"ml","unit_price":20}]}'::jsonb,
      'issue-shortage-1'
    );
  exception when sqlstate 'P0001' then
    failed := position('STOCK_SHORT:' in sqlerrm) = 1;
  end;
  if not failed then raise exception 'expected STOCK_SHORT for the second ingredient'; end if;
  if public.test_compound_state() <> before_state then raise exception 'ingredient shortage left partial state'; end if;

  -- A stock balance without enough active FIFO/FEFO layers must fail closed.
  before_state := public.test_compound_state();
  failed := false;
  begin
    perform public.clinic_issue_compound(
      '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
      '{"recipe_name":"Layer Kurang","dosage_form":"puyer","ingredients":[{"item_id":"80000000-0000-4000-8000-000000000003","quantity":2,"unit":"pcs","unit_price":1}]}'::jsonb,
      'issue-layer-short-1'
    );
  exception when sqlstate 'P0001' then
    failed := position('LAYER_SHORT:' in sqlerrm) = 1;
  end;
  if not failed then raise exception 'expected LAYER_SHORT for positive stock without enough layers'; end if;
  if public.test_compound_state() <> before_state then raise exception 'layer shortage left partial state'; end if;

  -- Zero-cost layers cannot silently create a zero-value HPP record.
  before_state := public.test_compound_state();
  failed := false;
  begin
    perform public.clinic_issue_compound(
      '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
      '{"recipe_name":"Tanpa HPP","dosage_form":"puyer","ingredients":[{"item_id":"80000000-0000-4000-8000-000000000004","quantity":1,"unit":"pcs","unit_price":1}]}'::jsonb,
      'issue-zero-cost-1'
    );
  exception when sqlstate 'P0001' then
    failed := position('COST_MISSING:' in sqlerrm) = 1;
  end;
  if not failed then raise exception 'expected COST_MISSING for a zero-cost layer'; end if;
  if public.test_compound_state() <> before_state then raise exception 'zero-cost failure left partial state'; end if;

  -- A missing active clinic warehouse fails before any recipe or stock mutation.
  update warehouses set is_active = false where id = '30000000-0000-4000-8000-000000000001';
  before_state := public.test_compound_state();
  failed := false;
  begin
    perform public.clinic_issue_compound(
      '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
      '{"recipe_name":"Tanpa Gudang","dosage_form":"puyer","ingredients":[{"item_id":"80000000-0000-4000-8000-000000000001","quantity":1,"unit":"gram","unit_price":1}]}'::jsonb,
      'issue-no-warehouse-1'
    );
  exception when sqlstate 'P0001' then
    failed := position('WAREHOUSE_MISSING:' in sqlerrm) = 1;
  end;
  if not failed then raise exception 'expected WAREHOUSE_MISSING'; end if;
  if public.test_compound_state() <> before_state then raise exception 'missing warehouse failure left partial state'; end if;
  update warehouses set is_active = true where id = '30000000-0000-4000-8000-000000000001';

  -- Visit identity is resolved on the server; a caller cannot pair another visit.
  before_state := public.test_compound_state();
  failed := false;
  begin
    perform public.clinic_issue_compound(
      '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002',
      '{"recipe_name":"Visit Salah","dosage_form":"puyer","ingredients":[{"item_id":"80000000-0000-4000-8000-000000000001","quantity":1,"unit":"gram","unit_price":1}]}'::jsonb,
      'issue-wrong-visit-1'
    );
  exception when sqlstate 'P0001' then
    failed := position('ACCESS_DENIED:' in sqlerrm) = 1;
  end;
  if not failed then raise exception 'mismatched visit identity was not rejected'; end if;
  if public.test_compound_state() <> before_state then raise exception 'mismatched visit left partial state'; end if;

  -- A doctor cannot bypass the official catalog through the custom RPC.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
  before_state := public.test_compound_state();
  failed := false;
  begin
    perform public.clinic_issue_compound(
      '70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002',
      '{"recipe_name":"Racikan Manual Dokter","dosage_form":"puyer","ingredients":[{"item_id":"80000000-0000-4000-8000-000000000002","quantity":1,"unit":"ml","unit_price":1}]}'::jsonb,
      'issue-doctor-custom-blocked-1'
    );
  exception when sqlstate 'P0001' then
    failed := position('ACCESS_DENIED: racikan khusus pasien hanya untuk pemilik/admin' in sqlerrm) = 1;
  end;
  if not failed then raise exception 'doctor bypassed catalog through the custom RPC'; end if;
  if public.test_compound_state() <> before_state then raise exception 'blocked doctor issue left partial state'; end if;

  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
  before_state := public.test_compound_state();
  failed := false;
  begin
    perform public.clinic_void_compound('a0000000-0000-4000-8000-000000000099');
  exception when sqlstate 'P0001' then
    failed := position('COST_MISSING:' in sqlerrm) = 1;
  end;
  if not failed then raise exception 'legacy recipe without issue history was voided automatically'; end if;
  if public.test_compound_state() <> before_state then raise exception 'legacy recipe void changed state'; end if;

  before_state := public.test_compound_state();
  issued := public.clinic_issue_compound(
    '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
    valid_recipe, 'issue-valid-1'
  );
  repeated := public.clinic_issue_compound(
    '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
    valid_recipe, 'issue-valid-1'
  );
  if issued <> repeated then raise exception 'retry did not return the original recipe'; end if;
  if public.test_compound_state() = before_state then raise exception 'valid issue made no stock or issue changes'; end if;
  if (select count(*) from compounding_ingredients where recipe_id = issued) <> 2 then raise exception 'BOM rows were not stored'; end if;
  if jsonb_array_length(public.test_compound_issues(issued)) <> 3 then raise exception 'expected one issue row per consumed layer'; end if;
  if (select sum((issue ->> 'qty')::numeric * (issue ->> 'unit_cost')::numeric)
      from jsonb_array_elements(public.test_compound_issues(issued)) as e(issue)) <> 10.873456 then
    raise exception 'historical HPP snapshot is incorrect';
  end if;
  if (select qty_left from stock_layers where id = '90000000-0000-4000-8000-000000000001') <> 0 then raise exception 'FEFO layer was not consumed first'; end if;
  if (select qty_left from stock_layers where id = '90000000-0000-4000-8000-000000000002') <> 1 then raise exception 'later expiry layer was consumed out of order'; end if;

  -- Idempotency keys cannot be reused for a different recipe payload.
  before_state := public.test_compound_state();
  failed := false;
  begin
    perform public.clinic_issue_compound(
      '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
      '{"recipe_name":"Nama Berbeda","dosage_form":"puyer","ingredients":[{"item_id":"80000000-0000-4000-8000-000000000001","quantity":2,"unit":"gram","unit_price":10},{"item_id":"80000000-0000-4000-8000-000000000002","quantity":1,"unit":"ml","unit_price":20}]}'::jsonb,
      'issue-valid-1'
    );
  exception when sqlstate 'P0001' then
    failed := position('IDEMPOTENCY_CONFLICT:' in sqlerrm) = 1;
  end;
  if not failed then raise exception 'reused request key with a different payload was accepted'; end if;
  if public.test_compound_state() <> before_state then raise exception 'idempotency conflict left partial state'; end if;

  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
  before_state := public.test_compound_state();
  failed := false;
  begin
    perform public.clinic_void_compound(issued);
  exception when sqlstate 'P0001' then
    failed := position('ACCESS_DENIED:' in sqlerrm) = 1;
  end;
  if not failed then raise exception 'cross-branch void was not rejected'; end if;
  if public.test_compound_state() <> before_state then raise exception 'cross-branch void left partial state'; end if;
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

  -- The internal cost ledger has no direct authenticated SELECT grant.
  failed := false;
  begin
    perform count(*) from compound_issues;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'authenticated role can read the internal HPP ledger directly'; end if;
  if has_function_privilege('service_role', 'public.clinic_issue_compound(uuid,uuid,jsonb,text)', 'EXECUTE') then
    raise exception 'service_role can invoke the user-scoped compound issue RPC';
  end if;

  -- Void is idempotent, restores original costs/expiry, and never uses current buy_price.
  perform public.clinic_void_compound(issued);
  before_state := public.test_compound_state();
  perform public.clinic_void_compound(issued);
  if public.test_compound_state() <> before_state then raise exception 'repeated void changed stock or layers'; end if;
  if (select qty from stock where warehouse_id = '30000000-0000-4000-8000-000000000001' and item_id = '80000000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'void did not restore ingredient quantity';
  end if;
  if (select count(*) from jsonb_array_elements(public.test_compound_issues(issued)) as e(issue)
      where issue ->> 'restored_at' is not null) <> 3 then
    raise exception 'void did not mark each historical layer restored exactly once';
  end if;
  if (select sum(qty_left * unit_cost) from stock_layers where source_ref = issued::text and item_id = '80000000-0000-4000-8000-000000000001') <> 5.623456 then
    raise exception 'void did not restore historical FIFO cost';
  end if;
  if not exists (select 1 from stock_layers where source_ref = issued::text and item_id = '80000000-0000-4000-8000-000000000001' and exp_date = '2026-12-01' and unit_cost = 2.123456) then
    raise exception 'void did not restore first layer expiry and cost';
  end if;
  if not exists (select 1 from stock_layers where source_ref = issued::text and item_id = '80000000-0000-4000-8000-000000000001' and exp_date = '2027-03-01' and unit_cost = 3.5) then
    raise exception 'void did not restore second layer expiry and cost';
  end if;

  -- A second issue cannot overdraw the last unit even when submitted after the first.
  issued := public.clinic_issue_compound(
    '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
    '{"recipe_name":"Unit Terakhir","dosage_form":"puyer","ingredients":[{"item_id":"80000000-0000-4000-8000-000000000005","quantity":1,"unit":"pcs","unit_price":1}]}'::jsonb,
    'issue-last-unit-1'
  );
  before_state := public.test_compound_state();
  failed := false;
  begin
    perform public.clinic_issue_compound(
      '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
      '{"recipe_name":"Unit Terakhir Kedua","dosage_form":"puyer","ingredients":[{"item_id":"80000000-0000-4000-8000-000000000005","quantity":1,"unit":"pcs","unit_price":1}]}'::jsonb,
      'issue-last-unit-2'
    );
  exception when sqlstate 'P0001' then
    failed := position('STOCK_SHORT:' in sqlerrm) = 1;
  end;
  if not failed then raise exception 'second last-unit issue was not rejected'; end if;
  if public.test_compound_state() <> before_state then raise exception 'last-unit rejection left partial state'; end if;
  if (select qty from stock where warehouse_id = '30000000-0000-4000-8000-000000000001' and item_id = '80000000-0000-4000-8000-000000000005') <> 0 then
    raise exception 'last-unit issue produced a negative or nonzero balance';
  end if;
end;
$$;

rollback;

-- K03 (28 Okt 2026): an "Obat Racik" SKU needs a composition in clinic records and clinic
-- bills. Outpatient, inpatient daily log and manual clinic invoice lines are rejected with
-- RECIPE_REQUIRED and leave nothing behind; the master compound path still works; an existing
-- legacy row is left alone unless its item changes. Separate fixture, rolled back.
begin;
insert into auth.users (id, raw_user_meta_data) values ('c3a00000-0000-4000-8000-000000000001', '{"full_name":"Pemilik K03"}');
update profiles set role = 'OWNER' where id = 'c3a00000-0000-4000-8000-000000000001';
insert into branches (id, code, name, type) values ('c3a10000-0000-4000-8000-000000000001', 'K03-TEST', 'Klinik K03', 'KLINIK');
insert into user_branches (user_id, branch_id) values ('c3a00000-0000-4000-8000-000000000001', 'c3a10000-0000-4000-8000-000000000001');
insert into warehouses (id, branch_id, code, name, type)
values ('c3a30000-0000-4000-8000-000000000001', 'c3a10000-0000-4000-8000-000000000001', 'K03-WH', 'Gudang K03', 'VET');
insert into item_categories (id, name) values ('c3a90000-0000-4000-8000-000000000002', 'Racikan') on conflict (name) do nothing;
insert into items (id, code, name, unit, buy_price, sell_price, item_type, is_active, is_compound_material, category_id) values
  ('c3a20000-0000-4000-8000-000000000001', 'K03-SKU-NAME', 'Obat Racik K03 Uji', 'pcs', 5, 50, 'Persediaan', true, false, null),
  ('c3a20000-0000-4000-8000-000000000002', 'K03-SKU-CAT', 'Sirup Batuk K03', 'pcs', 5, 60, 'Persediaan', true, false,
    (select id from item_categories where name = 'Racikan')),
  ('c3a20000-0000-4000-8000-000000000003', 'K03-BAHAN', 'Bahan K03', 'gram', 5, 10, 'Persediaan', true, true, null),
  ('c3a20000-0000-4000-8000-000000000004', 'K03-NORMAL', 'Obat Biasa K03', 'pcs', 5, 40, 'Persediaan', true, false, null);
insert into stock (warehouse_id, item_id, qty)
select 'c3a30000-0000-4000-8000-000000000001', id, 10 from items where id between 'c3a20000-0000-4000-8000-000000000001' and 'c3a20000-0000-4000-8000-000000000004';
insert into stock_layers (warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source)
select 'c3a30000-0000-4000-8000-000000000001', id, current_date, 10, 10, 5, 'purchase' from items where id between 'c3a20000-0000-4000-8000-000000000001' and 'c3a20000-0000-4000-8000-000000000004';
insert into customers (id, name, phone) values ('c3a40000-0000-4000-8000-000000000001', 'Pemilik Hewan K03', '080000000303');
insert into pets (id, customer_id, name) values ('c3a50000-0000-4000-8000-000000000001', 'c3a40000-0000-4000-8000-000000000001', 'Pasien K03');
insert into employees (id, nama, jabatan, branch_id, status)
values ('c3ac0000-0000-4000-8000-000000000001', 'Dokter K03', 'Dokter', 'c3a10000-0000-4000-8000-000000000001', 'Aktif');
insert into visits (id, branch_id, customer_id, pet_id, status, doctor_id, dokter, service_started_at)
select ('c3a60000-0000-4000-8000-00000000000' || n)::uuid, 'c3a10000-0000-4000-8000-000000000001',
  'c3a40000-0000-4000-8000-000000000001', 'c3a50000-0000-4000-8000-000000000001', 'Diperiksa',
  'c3ac0000-0000-4000-8000-000000000001', 'Dokter K03', now()
from generate_series(1, 5) n;
insert into medical_records (id, visit_id, diagnosis)
select ('c3a70000-0000-4000-8000-00000000000' || n)::uuid, ('c3a60000-0000-4000-8000-00000000000' || n)::uuid, 'Uji K03'
from generate_series(2, 5) n;
-- The inpatient admission guard needs an authenticated actor even for fixtures.
select set_config('request.jwt.claim.sub', 'c3a00000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
insert into inpatient_records (id, branch_id, visit_id, medical_record_id)
values ('c3a80000-0000-4000-8000-000000000001', 'c3a10000-0000-4000-8000-000000000001',
  'c3a60000-0000-4000-8000-000000000002', 'c3a70000-0000-4000-8000-000000000002');
insert into cashier_shifts (id, branch_id, opened_by, shift_type, status)
values ('c3ab0000-0000-4000-8000-000000000001', 'c3a10000-0000-4000-8000-000000000001', 'c3a00000-0000-4000-8000-000000000001', 'klinik', 'open');
insert into coa_accounts (code, name, type, normal_balance, is_active, is_header) values
  ('1101','Kas','ASET','D',true,false), ('1201','Piutang','ASET','D',true,false),
  ('1301','Persediaan','ASET','D',true,false), ('2201','PPN Keluaran','LIABILITAS','K',true,false),
  ('4102','Diskon','PENDAPATAN','D',true,false), ('4201','Pendapatan Klinik','PENDAPATAN','K',true,false),
  ('5101','HPP','BEBAN','D',true,false)
on conflict (code) do update set is_active = true, is_header = false;
insert into cash_accounts (nama, jenis, coa_code) values ('Kas Uji K03', 'Kas', '1101') on conflict (coa_code) do update set is_active = true;
-- A legacy racikan-SKU prescription row that predates K03 (production has one such row).
alter table prescription_items disable trigger zz_racikan_recipe_required;
insert into prescription_items (id, medical_record_id, nama_obat, qty, harga, satuan, faktor, jenis, item_id)
values ('c3aa0000-0000-4000-8000-000000000001', 'c3a70000-0000-4000-8000-000000000003', 'Obat Racik K03 Uji', 1, 50, 'pcs', 1, 'obat', 'c3a20000-0000-4000-8000-000000000001');
alter table prescription_items enable trigger zz_racikan_recipe_required;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3a00000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  failed boolean;
  v_err text;
  v_recipe uuid;
  v_rx uuid;
  v_invoice uuid;
  v_record jsonb := '{"diagnosis":"Uji K03","berat":4,"penunjang_urls":[]}';
  v_racik_row jsonb := '[{"nama_obat":"Obat Racik K03 Uji","item_id":"c3a20000-0000-4000-8000-000000000001","qty":1,"satuan":"pcs","faktor":1,"harga":50,"jenis":"obat"}]';
  v_cat_row jsonb := '[{"nama_obat":"Sirup Batuk K03","item_id":"c3a20000-0000-4000-8000-000000000002","qty":1,"satuan":"pcs","faktor":1,"harga":60,"jenis":"obat"}]';
  v_invoice_head jsonb := jsonb_build_object(
    'tanggal', current_date::text, 'subtotal', 50, 'discount', 0, 'tax', 0, 'total', 50,
    'dp_amount', 0, 'dp_date', null, 'paid_status', 'Lunas', 'metode_bayar', 'Tunai',
    'shift_id', 'c3ab0000-0000-4000-8000-000000000001', 'voucher_code', null, 'salesperson_id', null);
begin
  -- 1. Outpatient record: a racikan SKU as an ordinary medicine row is refused; nothing saved.
  failed := false;
  begin
    perform public.clinic_save_initial_record('c3a60000-0000-4000-8000-000000000001', 'c3a50000-0000-4000-8000-000000000001',
      v_record, '[]', v_racik_row, '[]', null, 'c3ac0000-0000-4000-8000-000000000001', 'Dokter K03', 'Keluhan K03', 'k03-outpatient');
  exception when others then failed := position('RECIPE_REQUIRED:' in sqlerrm) = 1; v_err := sqlerrm;
  end;
  if not failed then raise exception 'K03 outpatient racikan SKU without composition was not refused with RECIPE_REQUIRED: %', v_err; end if;
  if exists (select 1 from medical_records where visit_id = 'c3a60000-0000-4000-8000-000000000001') then
    raise exception 'K03 outpatient refusal left a medical record';
  end if;

  -- 2. Inpatient daily log: same rule, category-based SKU; nothing saved.
  failed := false;
  begin
    perform public.clinic_save_inpatient_log_with_status('c3a80000-0000-4000-8000-000000000001', 'c3a70000-0000-4000-8000-000000000002',
      '{"condition_note":"Stabil","makan":"habis"}', v_cat_row, '[]', 'k03-inpatient', null);
  exception when others then failed := position('RECIPE_REQUIRED:' in sqlerrm) = 1; v_err := sqlerrm;
  end;
  if not failed then raise exception 'K03 inpatient racikan SKU without composition was not refused with RECIPE_REQUIRED: %', v_err; end if;
  if exists (select 1 from prescription_items where medical_record_id = 'c3a70000-0000-4000-8000-000000000002')
     or exists (select 1 from inpatient_daily_logs where inpatient_record_id = 'c3a80000-0000-4000-8000-000000000001') then
    raise exception 'K03 inpatient refusal left a daily log or prescription';
  end if;

  -- 3. Clinic invoice manual line: a racikan SKU cannot be billed without composition; no invoice, no stock move.
  failed := false;
  begin
    perform public.clinic_post_invoice('c3a60000-0000-4000-8000-000000000004', 'k03-invoice-manual', v_invoice_head,
      jsonb_build_array(jsonb_build_object('description','Obat Racik K03 Uji','qty',1,'price',50,'kind','obat',
        'item_id','c3a20000-0000-4000-8000-000000000001','unit',null,'prescription_item_id',null,'recipe_id',null,'discount_percent',0)));
  exception when others then failed := position('RECIPE_REQUIRED:' in sqlerrm) = 1; v_err := sqlerrm;
  end;
  if not failed then raise exception 'K03 manual invoice racikan SKU without composition was not refused with RECIPE_REQUIRED: %', v_err; end if;
  if exists (select 1 from invoices where visit_id = 'c3a60000-0000-4000-8000-000000000004')
     or exists (select 1 from stock_moves where warehouse_id = 'c3a30000-0000-4000-8000-000000000001') then
    raise exception 'K03 invoice refusal left an invoice or stock movement';
  end if;

  -- 4. Ordinary medicine rows are unaffected.
  perform public.clinic_save_initial_record('c3a60000-0000-4000-8000-000000000001', 'c3a50000-0000-4000-8000-000000000001',
    v_record, '[]', '[{"nama_obat":"Obat Biasa K03","item_id":"c3a20000-0000-4000-8000-000000000004","qty":1,"satuan":"pcs","faktor":1,"harga":40,"jenis":"obat"}]',
    '[]', null, 'c3ac0000-0000-4000-8000-000000000001', 'Dokter K03', 'Keluhan K03', 'k03-outpatient-normal');
  if not exists (select 1 from prescription_items p join medical_records m on m.id = p.medical_record_id
      where m.visit_id = 'c3a60000-0000-4000-8000-000000000001' and p.item_id = 'c3a20000-0000-4000-8000-000000000004') then
    raise exception 'K03 blocked an ordinary medicine row';
  end if;

  -- 5. Master compound path (SKU + composition) passes and is billable.
  v_recipe := public.clinic_issue_master_compound('c3a70000-0000-4000-8000-000000000004', 'c3a60000-0000-4000-8000-000000000004',
    'c3a20000-0000-4000-8000-000000000001',
    '{"dosage_form":"puyer","ingredients":[{"item_id":"c3a20000-0000-4000-8000-000000000003","quantity":1,"unit":"gram"}]}',
    'k03-master', null, '2x sehari');
  select id into v_rx from prescription_items where compound_recipe_id = v_recipe;
  if v_recipe is null or v_rx is null then raise exception 'K03 master compound path did not create its linked row'; end if;
  v_invoice := public.clinic_post_invoice('c3a60000-0000-4000-8000-000000000004', 'k03-invoice-master', v_invoice_head,
    jsonb_build_array(jsonb_build_object('description','Obat Racik K03 Uji','qty',1,'price',50,'kind','obat',
      'item_id',null,'unit','racikan','prescription_item_id',v_rx,'recipe_id',v_recipe,'discount_percent',0)));
  if v_invoice is null or not exists (select 1 from invoice_items where invoice_id = v_invoice and compound_recipe_id = v_recipe) then
    raise exception 'K03 master compound line was not billed';
  end if;
end;
$$;

-- 6. Only new or changed rows are checked: the legacy row may still be edited (not its item)
--    and billed from its prescription line; switching it to another racikan SKU is refused.
--    The direct UPDATEs run as the fixture owner with zz_grooming_requirement off, because that
--    existing trigger cannot evaluate UPDATEs on prescription_items (it reads new.sale_id).
reset role;
alter table prescription_items disable trigger zz_grooming_requirement;
do $$
declare failed boolean := false; v_err text;
begin
  update prescription_items set aturan_pakai = '2x sehari' where id = 'c3aa0000-0000-4000-8000-000000000001';
  update prescription_items set item_id = 'c3a20000-0000-4000-8000-000000000001', qty = 1 where id = 'c3aa0000-0000-4000-8000-000000000001';
  begin
    update prescription_items set item_id = 'c3a20000-0000-4000-8000-000000000002' where id = 'c3aa0000-0000-4000-8000-000000000001';
  exception when others then failed := position('RECIPE_REQUIRED:' in sqlerrm) = 1; v_err := sqlerrm;
  end;
  if not failed then raise exception 'K03 item change to a racikan SKU was not refused: %', v_err; end if;
end;
$$;
alter table prescription_items enable trigger zz_grooming_requirement;
set local role authenticated;
do $$
declare v_invoice uuid;
begin
  v_invoice := public.clinic_post_invoice('c3a60000-0000-4000-8000-000000000003', 'k03-invoice-legacy',
    jsonb_build_object('tanggal', current_date::text, 'subtotal', 50, 'discount', 0, 'tax', 0, 'total', 50,
      'dp_amount', 0, 'dp_date', null, 'paid_status', 'Lunas', 'metode_bayar', 'Tunai',
      'shift_id', 'c3ab0000-0000-4000-8000-000000000001', 'voucher_code', null, 'salesperson_id', null),
    jsonb_build_array(jsonb_build_object('description','Obat Racik K03 Uji','qty',1,'price',50,'kind','obat',
      'item_id','c3a20000-0000-4000-8000-000000000001','unit','pcs','prescription_item_id','c3aa0000-0000-4000-8000-000000000001','recipe_id',null,'discount_percent',0)));
  if v_invoice is null then raise exception 'K03 blocked billing of a legacy prescription row'; end if;
end;
$$;

-- 7. Terbit ulang (void-reissue) of an invoice that already billed a racikan SKU as a manual line
--    (allowed before K03) copies that line into the replacement; the copy is not new billing.
reset role;
alter table invoice_items disable trigger zz_racikan_recipe_required;
set local role authenticated;
select public.clinic_post_invoice('c3a60000-0000-4000-8000-000000000005', 'k03-invoice-old-manual',
  jsonb_build_object('tanggal', current_date::text, 'subtotal', 50, 'discount', 0, 'tax', 0, 'total', 50,
    'dp_amount', 0, 'dp_date', null, 'paid_status', 'Lunas', 'metode_bayar', 'Tunai',
    'shift_id', 'c3ab0000-0000-4000-8000-000000000001', 'voucher_code', null, 'salesperson_id', null),
  jsonb_build_array(jsonb_build_object('description','Obat Racik K03 Uji','qty',1,'price',50,'kind','obat',
    'item_id','c3a20000-0000-4000-8000-000000000001','unit',null,'prescription_item_id',null,'recipe_id',null,'discount_percent',0)));
reset role;
alter table invoice_items enable trigger zz_racikan_recipe_required;
set local role authenticated;
do $$
declare v_old uuid; v_new uuid; v_err text;
begin
  select id into v_old from invoices where visit_id = 'c3a60000-0000-4000-8000-000000000005';
  begin
    v_new := public.clinic_void_reissue_invoice(v_old, 'k03-reissue', 'Koreksi K03');
  exception when others then v_err := sqlerrm;
  end;
  if v_new is null then raise exception 'K03 blocked void-reissue of an already billed racikan line: %', v_err; end if;
  if not exists (select 1 from invoice_items n join invoice_items o on o.id = n.service_source_line_id
      where n.invoice_id = v_new and o.invoice_id = v_old and n.item_id = 'c3a20000-0000-4000-8000-000000000001') then
    raise exception 'K03 reissue did not carry the copied racikan line';
  end if;
end;
$$;
-- The copy exemption cannot be borrowed by an unrelated invoice: a line pointing at the old line
-- from a different invoice is still refused (direct write as table owner; the app has no grant;
-- the salesperson-source guard is switched off here so only K03 is exercised).
reset role;
alter table invoice_items disable trigger clinic_line_salesperson;
do $$
declare v_old uuid; v_err text;
begin
  select id into v_old from invoices where visit_id = 'c3a60000-0000-4000-8000-000000000005' and voided_at is not null;
  begin
    insert into invoice_items (invoice_id, deskripsi, qty, harga, jenis, item_id, service_source_line_id)
    select i.id, 'Obat Racik K03 Uji', 1, 50, 'obat', 'c3a20000-0000-4000-8000-000000000001',
      (select id from invoice_items where invoice_id = v_old limit 1)
    from invoices i where i.visit_id = 'c3a60000-0000-4000-8000-000000000004' limit 1;
  exception when others then v_err := sqlerrm;
  end;
  if position('RECIPE_REQUIRED:' in coalesce(v_err, '')) <> 1 then
    raise exception 'K03 copy exemption leaked to an unrelated invoice: %', coalesce(v_err, 'accepted');
  end if;
end;
$$;
alter table invoice_items enable trigger clinic_line_salesperson;

rollback;
