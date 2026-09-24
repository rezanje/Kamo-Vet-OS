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
  ('10000000-0000-4000-8000-000000000001', '{"full_name":"Dokter Cabang A"}'),
  ('10000000-0000-4000-8000-000000000002', '{"full_name":"Dokter Cabang B"}');
update profiles set role = 'DOCTOR' where id in (
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'
);

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

  -- A doctor assigned to branch B cannot issue a recipe for branch A.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
  before_state := public.test_compound_state();
  failed := false;
  begin
    perform public.clinic_issue_compound(
      '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
      '{"recipe_name":"Cabang Salah","dosage_form":"puyer","ingredients":[{"item_id":"80000000-0000-4000-8000-000000000001","quantity":1,"unit":"gram","unit_price":1}]}'::jsonb,
      'issue-wrong-branch-1'
    );
  exception when sqlstate 'P0001' then
    failed := position('ACCESS_DENIED:' in sqlerrm) = 1;
  end;
  if not failed then raise exception 'cross-branch issue was not rejected'; end if;
  if public.test_compound_state() <> before_state then raise exception 'cross-branch failure left partial state'; end if;

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
