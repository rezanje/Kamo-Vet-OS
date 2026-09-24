-- Atomic clinic compound stock issue and historical-cost restoration.
-- The internal issue ledger is intentionally not directly readable by app roles;
-- later invoice posting RPCs consume it through the same database boundary.

alter table public.compounding_recipes
  add column request_key text;

create unique index compounding_recipes_request_key_unique
  on public.compounding_recipes(request_key)
  where request_key is not null;

create table public.compound_issues (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.compounding_recipes(id) on delete restrict,
  ingredient_id uuid not null references public.compounding_ingredients(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  item_id uuid not null references public.items(id) on delete restrict,
  stock_layer_id uuid not null references public.stock_layers(id) on delete restrict,
  qty numeric not null check (qty > 0),
  unit_cost numeric not null check (unit_cost > 0),
  exp_date date,
  posted_invoice_item_id uuid references public.invoice_items(id) on delete restrict,
  restored_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ingredient_id, stock_layer_id)
);

create index compound_issues_recipe_idx on public.compound_issues(recipe_id);
create index compound_issues_unposted_idx on public.compound_issues(recipe_id)
  where posted_invoice_item_id is null and restored_at is null;

alter table public.compound_issues enable row level security;
revoke all on public.compound_issues from public, anon, authenticated, service_role;

create or replace function public.clinic_issue_compound(
  p_medical_record_id uuid,
  p_visit_id uuid,
  p_recipe jsonb,
  p_request_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_call_role text;
  v_record_visit_id uuid;
  v_branch_id uuid;
  v_warehouse_id uuid;
  v_request_key text;
  v_recipe_name text;
  v_instruction text;
  v_form text;
  v_input_item jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_unit text;
  v_unit_price numeric(15,2);
  v_item_name text;
  v_item_unit text;
  v_item_type text;
  v_is_compound_material boolean;
  v_seen uuid[] := array[]::uuid[];
  v_payload_items jsonb := '[]'::jsonb;
  v_existing_items jsonb;
  v_total_price numeric := 0;
  v_recipe_id uuid;
  v_existing public.compounding_recipes%rowtype;
  v_ingredient record;
  v_ingredient_id uuid;
  v_stock_qty numeric;
  v_remaining numeric;
  v_take numeric;
  v_cost numeric;
  v_layer record;
begin
  v_call_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), 'none')
  );
  v_user_id := auth.uid();
  if v_call_role is distinct from 'authenticated' or v_user_id is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;

  select m.visit_id, v.branch_id
    into v_record_visit_id, v_branch_id
  from public.medical_records m
  join public.visits v on v.id = m.visit_id
  where m.id = p_medical_record_id;
  if not found or v_record_visit_id is distinct from p_visit_id
     or not public.user_can_access_branch(v_branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: kunjungan tidak diizinkan';
  end if;

  v_request_key := nullif(btrim(p_request_key), '');
  if v_request_key is null or length(v_request_key) > 100
     or jsonb_typeof(p_recipe) is distinct from 'object'
     or jsonb_typeof(p_recipe -> 'ingredients') is distinct from 'array'
     or jsonb_array_length(p_recipe -> 'ingredients') not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: data racikan tidak lengkap';
  end if;

  v_recipe_name := nullif(btrim(p_recipe ->> 'recipe_name'), '');
  v_instruction := nullif(btrim(p_recipe ->> 'dosage_instruction'), '');
  v_form := coalesce(nullif(btrim(p_recipe ->> 'dosage_form'), ''), 'lainnya');
  if v_recipe_name is null or length(v_recipe_name) > 200
     or v_form not in ('sirup', 'nebul', 'salep', 'puyer', 'kapsul', 'lainnya') then
    raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: nama atau bentuk racikan tidak valid';
  end if;

  -- Normalize and validate payload before looking up an idempotency key.
  -- HPP/cost fields supplied by a client are ignored entirely.
  begin
    for v_input_item in select value from jsonb_array_elements(p_recipe -> 'ingredients') as e(value)
    loop
      if jsonb_typeof(v_input_item) is distinct from 'object' then
        raise exception 'ingredient must be an object';
      end if;
      v_item_id := nullif(v_input_item ->> 'item_id', '')::uuid;
      v_qty := nullif(v_input_item ->> 'quantity', '')::numeric;
      v_unit := nullif(btrim(v_input_item ->> 'unit'), '');
      v_unit_price := coalesce(nullif(v_input_item ->> 'unit_price', '')::numeric, 0)::numeric(15,2);
      if v_item_id is null or v_qty is null or v_qty <= 0 or v_qty::text in ('NaN', 'Infinity', '-Infinity')
         or v_unit is null or v_unit_price < 0 or v_unit_price::text in ('NaN', 'Infinity', '-Infinity')
         or v_item_id = any(v_seen) then
        raise exception 'invalid or repeated ingredient';
      end if;
      v_seen := array_append(v_seen, v_item_id);
      v_payload_items := v_payload_items || jsonb_build_array(jsonb_build_object(
        'item_id', v_item_id::text,
        'quantity', v_qty,
        'unit', v_unit,
        'unit_price', v_unit_price
      ));
      v_total_price := v_total_price + (v_qty * v_unit_price);
    end loop;
  exception when others then
    raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: bahan racikan tidak valid';
  end;

  select coalesce(jsonb_agg(e.value order by e.value ->> 'item_id'), '[]'::jsonb)
    into v_payload_items
  from jsonb_array_elements(v_payload_items) as e(value);
  v_total_price := v_total_price::numeric(15,2);

  select r.* into v_existing
  from public.compounding_recipes r
  where r.request_key = v_request_key
  for update;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', ci.item_id::text,
      'quantity', ci.quantity,
      'unit', ci.unit,
      'unit_price', ci.unit_price
    ) order by ci.item_id::text), '[]'::jsonb)
      into v_existing_items
    from public.compounding_ingredients ci
    where ci.recipe_id = v_existing.id;
    if v_existing.created_by is distinct from v_user_id
       or v_existing.medical_record_id is distinct from p_medical_record_id
       or v_existing.recipe_name is distinct from v_recipe_name
       or v_existing.dosage_instruction is distinct from v_instruction
       or v_existing.dosage_form is distinct from v_form
       or v_existing.total_price is distinct from v_total_price
       or v_existing_items is distinct from v_payload_items then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci sudah dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;

  insert into public.compounding_recipes (
    medical_record_id, recipe_name, dosage_instruction, dosage_form,
    total_price, status, created_by, request_key
  ) values (
    p_medical_record_id, v_recipe_name, v_instruction, v_form,
    v_total_price, 'pending', v_user_id, v_request_key
  )
  on conflict (request_key) where request_key is not null do nothing
  returning id into v_recipe_id;

  if v_recipe_id is null then
    select r.* into v_existing
    from public.compounding_recipes r
    where r.request_key = v_request_key
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci tidak dapat dipastikan';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', ci.item_id::text,
      'quantity', ci.quantity,
      'unit', ci.unit,
      'unit_price', ci.unit_price
    ) order by ci.item_id::text), '[]'::jsonb)
      into v_existing_items
    from public.compounding_ingredients ci
    where ci.recipe_id = v_existing.id;
    if v_existing.created_by is distinct from v_user_id
       or v_existing.medical_record_id is distinct from p_medical_record_id
       or v_existing.recipe_name is distinct from v_recipe_name
       or v_existing.dosage_instruction is distinct from v_instruction
       or v_existing.dosage_form is distinct from v_form
       or v_existing.total_price is distinct from v_total_price
       or v_existing_items is distinct from v_payload_items then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci sudah dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;

  for v_input_item in select value from jsonb_array_elements(v_payload_items) as e(value)
  loop
    v_item_id := (v_input_item ->> 'item_id')::uuid;
    v_qty := (v_input_item ->> 'quantity')::numeric;
    v_unit := v_input_item ->> 'unit';
    v_unit_price := (v_input_item ->> 'unit_price')::numeric(15,2);
    select i.name, i.unit, i.item_type, i.is_compound_material
      into v_item_name, v_item_unit, v_item_type, v_is_compound_material
    from public.items i
    where i.id = v_item_id and i.is_active
    for share;
    if not found or v_item_type is distinct from 'Persediaan'
       or v_is_compound_material is distinct from true or v_item_unit is distinct from v_unit then
      raise exception using errcode = 'P0001', message = 'INGREDIENT_INVALID: bahan atau satuan tidak cocok';
    end if;
    insert into public.compounding_ingredients (
      recipe_id, ingredient_name, item_id, quantity, unit, unit_price
    ) values (
      v_recipe_id, v_item_name, v_item_id, v_qty, v_unit, v_unit_price
    );
  end loop;

  select w.id into v_warehouse_id
  from public.warehouses w
  where w.branch_id = v_branch_id and w.type = 'VET' and w.is_active
  order by w.created_at, w.id
  limit 1
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'WAREHOUSE_MISSING: gudang klinik aktif tidak ditemukan';
  end if;

  -- Lock item balances and their layers in a deterministic item order.
  for v_ingredient in
    select ci.id, ci.item_id, ci.quantity
    from public.compounding_ingredients ci
    where ci.recipe_id = v_recipe_id
    order by ci.item_id
  loop
    select i.name into v_item_name from public.items i where i.id = v_ingredient.item_id;
    select s.qty into v_stock_qty
    from public.stock s
    where s.warehouse_id = v_warehouse_id and s.item_id = v_ingredient.item_id
    for update;
    if not found or v_stock_qty < v_ingredient.quantity then
      raise exception using errcode = 'P0001', message = format('STOCK_SHORT: %s', coalesce(v_item_name, 'bahan racikan'));
    end if;

    v_remaining := v_ingredient.quantity;
    v_cost := 0;
    for v_layer in
      select l.id, l.qty_left, l.unit_cost, l.exp_date
      from public.stock_layers l
      where l.warehouse_id = v_warehouse_id
        and l.item_id = v_ingredient.item_id
        and l.qty_left > 0
      order by
        (l.exp_date is null), l.exp_date nulls last, l.tanggal, l.created_at, l.id
      for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_layer.qty_left, v_remaining);
      if v_take <= 0 then continue; end if;
      if v_layer.unit_cost <= 0 then
        raise exception using errcode = 'P0001', message = format('COST_MISSING: %s', coalesce(v_item_name, 'bahan racikan'));
      end if;
      update public.stock_layers set qty_left = qty_left - v_take where id = v_layer.id;
      insert into public.compound_issues (
        recipe_id, ingredient_id, warehouse_id, item_id,
        stock_layer_id, qty, unit_cost, exp_date
      ) values (
        v_recipe_id, v_ingredient.id, v_warehouse_id, v_ingredient.item_id,
        v_layer.id, v_take, v_layer.unit_cost, v_layer.exp_date
      );
      v_cost := v_cost + (v_take * v_layer.unit_cost);
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then
      raise exception using errcode = 'P0001', message = format('LAYER_SHORT: %s', coalesce(v_item_name, 'bahan racikan'));
    end if;

    update public.stock
    set qty = qty - v_ingredient.quantity, updated_at = now()
    where warehouse_id = v_warehouse_id and item_id = v_ingredient.item_id;
    insert into public.stock_moves (
      warehouse_id, item_id, qty, unit_cost, source, source_ref
    ) values (
      v_warehouse_id, v_ingredient.item_id, -v_ingredient.quantity,
      v_cost / v_ingredient.quantity, 'racik', v_recipe_id::text
    );
  end loop;

  return v_recipe_id;
end;
$function$;

create or replace function public.clinic_void_compound(p_recipe_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_call_role text;
  v_branch_id uuid;
  v_recipe public.compounding_recipes%rowtype;
  v_ingredient_count bigint;
  v_issue_count bigint;
  v_issue record;
begin
  v_call_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), 'none')
  );
  v_user_id := auth.uid();
  if v_call_role is distinct from 'authenticated' or v_user_id is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;

  select r.* into v_recipe
  from public.compounding_recipes r
  where r.id = p_recipe_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: racikan tidak ditemukan';
  end if;
  select v.branch_id into v_branch_id
  from public.medical_records m
  join public.visits v on v.id = m.visit_id
  where m.id = v_recipe.medical_record_id;
  if not found or not public.user_can_access_branch(v_branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang racikan tidak diizinkan';
  end if;
  if v_recipe.status = 'void' then return; end if;
  if v_recipe.status = 'handed_over' then
    raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: racikan sudah diserahkan';
  end if;

  select count(*) into v_ingredient_count
  from public.compounding_ingredients ci where ci.recipe_id = p_recipe_id;
  select count(*) into v_issue_count
  from public.compound_issues i where i.recipe_id = p_recipe_id;
  if v_issue_count = 0 and v_ingredient_count > 0 then
    raise exception using errcode = 'P0001', message = 'COST_MISSING: histori stok racikan lama tidak tersedia';
  end if;
  if exists (
    select 1 from public.compound_issues i
    where i.recipe_id = p_recipe_id and i.posted_invoice_item_id is not null
  ) then
    raise exception using errcode = 'P0001', message = 'RECIPE_LINKED: racikan sudah dipakai pada invoice';
  end if;
  if exists (
    select 1 from public.compound_issues i
    where i.recipe_id = p_recipe_id and i.restored_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'RECIPE_INVALID: status pemulihan tidak konsisten';
  end if;

  for v_issue in
    select i.id, i.warehouse_id, i.item_id, i.qty, i.unit_cost, i.exp_date
    from public.compound_issues i
    where i.recipe_id = p_recipe_id
    order by i.item_id, i.stock_layer_id
    for update
  loop
    insert into public.stock_layers (
      warehouse_id, item_id, tanggal, exp_date, qty_in, qty_left,
      unit_cost, source, source_ref
    ) values (
      v_issue.warehouse_id, v_issue.item_id, current_date, v_issue.exp_date,
      v_issue.qty, v_issue.qty, v_issue.unit_cost, 'racik', p_recipe_id::text
    );
    insert into public.stock (warehouse_id, item_id, qty, updated_at)
    values (v_issue.warehouse_id, v_issue.item_id, v_issue.qty, now())
    on conflict (warehouse_id, item_id) do update
      set qty = public.stock.qty + excluded.qty, updated_at = excluded.updated_at;
    insert into public.stock_moves (
      warehouse_id, item_id, qty, unit_cost, source, source_ref
    ) values (
      v_issue.warehouse_id, v_issue.item_id, v_issue.qty,
      v_issue.unit_cost, 'racik', p_recipe_id::text
    );
    update public.compound_issues set restored_at = now() where id = v_issue.id;
  end loop;

  update public.compounding_recipes set status = 'void' where id = p_recipe_id;
end;
$function$;

revoke all on function public.clinic_issue_compound(uuid, uuid, jsonb, text) from public, anon, service_role;
revoke all on function public.clinic_void_compound(uuid) from public, anon, service_role;
grant execute on function public.clinic_issue_compound(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.clinic_void_compound(uuid) to authenticated;
