-- Company-controlled, versioned compound formulas. A clinical issue retains an
-- immutable link to the exact published version; the recipe itself remains a
-- patient-specific snapshot created by clinic_issue_compound.
create table public.compound_formulas (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(code) between 1 and 40),
  active boolean not null default true,
  current_version_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.compound_formula_versions (
  id uuid primary key default gen_random_uuid(),
  formula_id uuid not null references public.compound_formulas(id) on delete restrict,
  version integer not null check (version > 0),
  name text not null check (length(name) between 1 and 200),
  dosage_form text not null check (dosage_form in ('sirup','nebul','salep','puyer','kapsul','lainnya')),
  dosage_instruction text,
  ingredients jsonb not null check (jsonb_typeof(ingredients) = 'array' and jsonb_array_length(ingredients) between 1 and 100),
  published_by uuid references public.profiles(id),
  published_at timestamptz not null default now(),
  unique(formula_id, version),
  unique(formula_id, id)
);
alter table public.compound_formulas
  add constraint compound_formulas_current_version_fk
  foreign key (id, current_version_id) references public.compound_formula_versions(formula_id, id);

create table public.compound_official_usage (
  recipe_id uuid primary key references public.compounding_recipes(id) on delete restrict,
  formula_version_id uuid not null references public.compound_formula_versions(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index compound_official_usage_version_idx on public.compound_official_usage(formula_version_id);

alter table public.compound_formulas enable row level security;
alter table public.compound_formula_versions enable row level security;
alter table public.compound_official_usage enable row level security;
revoke all on public.compound_formulas, public.compound_formula_versions, public.compound_official_usage
  from public, anon, authenticated, service_role;
grant select on public.compound_formulas, public.compound_formula_versions, public.compound_official_usage to authenticated;

create policy compound_formulas_read on public.compound_formulas for select to authenticated
  using (active or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('OWNER','ADMIN')));
create policy compound_formula_versions_read on public.compound_formula_versions for select to authenticated
  using (exists (select 1 from public.compound_formulas f where f.id = formula_id));
create policy compound_official_usage_read on public.compound_official_usage for select to authenticated
  using (exists (
    select 1 from public.compounding_recipes r
    join public.medical_records m on m.id = r.medical_record_id
    join public.visits v on v.id = m.visit_id
    where r.id = recipe_id and public.user_can_access_branch(v.branch_id)
  ));

-- The legacy self-update policy on profiles allows updating every column,
-- including role. Block self promotion without breaking admins changing the
-- roles of other users through the existing user-management flow.
create function public.prevent_self_role_change() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if new.role is distinct from old.role and auth.uid() = old.id then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak dapat mengubah perannya sendiri';
  end if;
  return new;
end;
$function$;
create trigger profiles_prevent_self_role_change before update of role on public.profiles
  for each row execute function public.prevent_self_role_change();
revoke all on function public.prevent_self_role_change() from public, anon, authenticated, service_role;

-- The historic clinical RLS policies permit direct edits. Keep dispensing
-- status/technical preparation editable, but freeze fields representing the
-- official clinical formula once its usage row has been written.
create function public.protect_official_compound_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare
  v_recipe_id uuid;
begin
  if tg_table_name = 'compounding_recipes' then
    v_recipe_id := old.id;
    if tg_op = 'DELETE' then
      if exists (select 1 from public.compound_official_usage where recipe_id = v_recipe_id) then
        raise exception using errcode='P0001', message='RECIPE_LINKED: resep resmi tidak dapat dihapus';
      end if;
      return old;
    end if;
    if exists (select 1 from public.compound_official_usage where recipe_id = v_recipe_id)
       and (old.medical_record_id is distinct from new.medical_record_id
         or old.recipe_name is distinct from new.recipe_name
         or old.dosage_instruction is distinct from new.dosage_instruction
         or old.dosage_form is distinct from new.dosage_form
         or old.total_price is distinct from new.total_price
         or old.request_key is distinct from new.request_key
         or old.created_by is distinct from new.created_by) then
      raise exception using errcode='P0001', message='RECIPE_LINKED: resep resmi tidak dapat diubah';
    end if;
  elsif tg_table_name = 'compounding_ingredients' then
    v_recipe_id := case when tg_op = 'DELETE' then old.recipe_id else new.recipe_id end;
    if exists (select 1 from public.compound_official_usage where recipe_id = v_recipe_id)
       or (tg_op = 'UPDATE' and exists (
         select 1 from public.compound_official_usage where recipe_id = old.recipe_id)) then
      raise exception using errcode='P0001', message='RECIPE_LINKED: bahan resep resmi tidak dapat diubah';
    end if;
  elsif tg_table_name = 'prescription_items' then
    v_recipe_id := case when tg_op = 'DELETE' then old.compound_recipe_id else new.compound_recipe_id end;
    if exists (select 1 from public.compound_official_usage where recipe_id = v_recipe_id)
       or (tg_op = 'UPDATE' and exists (
         select 1 from public.compound_official_usage where recipe_id = old.compound_recipe_id)) then
      raise exception using errcode='P0001', message='RECIPE_LINKED: tagihan resep resmi tidak dapat diubah';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;
create trigger official_recipe_snapshot before update or delete on public.compounding_recipes
  for each row execute function public.protect_official_compound_snapshot();
create trigger official_ingredients_snapshot before insert or update or delete on public.compounding_ingredients
  for each row execute function public.protect_official_compound_snapshot();
create trigger official_prescription_snapshot before insert or update or delete on public.prescription_items
  for each row execute function public.protect_official_compound_snapshot();
revoke all on function public.protect_official_compound_snapshot() from public, anon, authenticated, service_role;

create function public.publish_compound_formula(
  p_formula_id uuid, p_code text, p_name text, p_dosage_form text,
  p_dosage_instruction text, p_ingredients jsonb
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_formula public.compound_formulas%rowtype;
  v_version_id uuid;
  v_ingredient jsonb;
  v_item public.items%rowtype;
  v_seen uuid[] := array[]::uuid[];
  v_qty numeric;
  v_items jsonb := '[]'::jsonb;
  v_code text := nullif(upper(btrim(p_code)), '');
  v_name text := nullif(btrim(p_name), '');
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'authenticated'
     or v_user is null or not exists (
       select 1 from public.profiles p where p.id = v_user and p.role in ('OWNER','ADMIN')
     ) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: hanya pemilik/admin dapat menerbitkan katalog';
  end if;
  if v_code is null or length(v_code) > 40 or v_code !~ '^[A-Z0-9_-]+$'
     or v_name is null or length(v_name) > 200
     or p_dosage_form not in ('sirup','nebul','salep','puyer','kapsul','lainnya')
     or jsonb_typeof(p_ingredients) is distinct from 'array'
     or jsonb_array_length(p_ingredients) not between 1 and 100 then
    raise exception using errcode='P0001', message='RECIPE_INVALID: katalog tidak lengkap';
  end if;
  for v_ingredient in select value from jsonb_array_elements(p_ingredients) as e(value) loop
    begin
      if jsonb_typeof(v_ingredient) is distinct from 'object' then raise exception 'invalid'; end if;
      v_qty := (v_ingredient ->> 'quantity')::numeric;
      select * into v_item from public.items
      where id = (v_ingredient ->> 'item_id')::uuid
      for share;
      if not found or not v_item.is_active or v_item.item_type <> 'Persediaan'
         or v_item.is_compound_material is distinct from true
         or v_item.unit is distinct from v_ingredient ->> 'unit'
         or v_qty is null or v_qty <= 0 or v_qty::text in ('NaN','Infinity','-Infinity')
         or v_item.id = any(v_seen) then raise exception 'invalid'; end if;
      v_seen := array_append(v_seen, v_item.id);
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'item_id', v_item.id, 'name', v_item.name, 'quantity', v_qty,
        'unit', v_item.unit, 'unit_price', greatest(coalesce(v_item.sell_price, 0), 0)
      ));
    exception when others then
      raise exception using errcode='P0001', message='INGREDIENT_INVALID: bahan katalog tidak aktif, duplikat, atau satuan tidak cocok';
    end;
  end loop;

  if p_formula_id is null then
    insert into public.compound_formulas(code, created_by)
    values (v_code, v_user) returning * into v_formula;
  else
    select * into v_formula from public.compound_formulas where id = p_formula_id for update;
    if not found or v_formula.code <> v_code then
      raise exception using errcode='P0001', message='RECIPE_INVALID: kode katalog tidak dapat diubah';
    end if;
  end if;
  insert into public.compound_formula_versions(
    formula_id, version, name, dosage_form, dosage_instruction, ingredients, published_by
  ) values (
    v_formula.id,
    coalesce((select max(version) from public.compound_formula_versions where formula_id = v_formula.id), 0) + 1,
    v_name, p_dosage_form, nullif(btrim(p_dosage_instruction), ''), v_items, v_user
  ) returning id into v_version_id;
  update public.compound_formulas set current_version_id = v_version_id, active = true where id = v_formula.id;
  return v_version_id;
end;
$function$;

create function public.set_compound_formula_active(p_formula_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'authenticated'
     or auth.uid() is null or not exists (
       select 1 from public.profiles p where p.id = auth.uid() and p.role in ('OWNER','ADMIN')
     ) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: hanya pemilik/admin dapat mengubah katalog';
  end if;
  update public.compound_formulas set active = p_active where id = p_formula_id;
  if not found then raise exception using errcode='P0001', message='RECIPE_INVALID: katalog tidak ditemukan'; end if;
end;
$function$;

-- The legacy custom-issue RPC remains available to OWNER/ADMIN for an exceptional
-- patient recipe. Move the stock-writing implementation out of the exposed API:
-- doctors must go through the company-version RPC, which supplies the immutable
-- ingredient snapshot itself. Revoking only the old function would also block
-- the official function's internal call.
create schema if not exists clinic_private;
revoke all on schema clinic_private from public, anon, authenticated, service_role;
alter function public.clinic_issue_compound(uuid,uuid,jsonb,text) set schema clinic_private;
revoke all on function clinic_private.clinic_issue_compound(uuid,uuid,jsonb,text)
  from public, anon, authenticated, service_role;

create function public.clinic_issue_compound(
  p_medical_record_id uuid, p_visit_id uuid, p_recipe jsonb, p_request_key text
) returns uuid language plpgsql security definer set search_path = '' as $function$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'authenticated'
     or auth.uid() is null or not exists (
       select 1 from public.profiles p where p.id = auth.uid() and p.role in ('OWNER','ADMIN')
     ) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: racikan khusus pasien hanya untuk pemilik/admin';
  end if;
  return clinic_private.clinic_issue_compound(p_medical_record_id,p_visit_id,p_recipe,p_request_key);
end;
$function$;
revoke all on function public.clinic_issue_compound(uuid,uuid,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function public.clinic_issue_compound(uuid,uuid,jsonb,text) to authenticated;

create function public.clinic_issue_official_compound(
  p_medical_record_id uuid, p_visit_id uuid, p_formula_version_id uuid,
  p_request_key text, p_dosage_instruction text default null
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_formula record;
  v_existing public.compounding_recipes%rowtype;
  v_existing_version uuid;
  v_recipe_id uuid;
  v_instruction text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'authenticated'
     or auth.uid() is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  select f.id, v.name, v.dosage_form, v.dosage_instruction, v.ingredients
    into v_formula
  from public.compound_formulas f
  join public.compound_formula_versions v on v.id = f.current_version_id
  where f.active and v.id = p_formula_version_id
  for share of f;
  v_instruction := (select v.dosage_instruction from public.compound_formula_versions v
    where v.id = p_formula_version_id);
  if nullif(btrim(p_dosage_instruction), '') is not null
     and nullif(btrim(p_dosage_instruction), '') is distinct from v_instruction then
    raise exception using errcode='P0001', message='RECIPE_INVALID: aturan pakai resep resmi harus sesuai katalog';
  end if;
  -- A repeat with the same key may succeed after the catalog gets revised.
  select * into v_existing from public.compounding_recipes where request_key = p_request_key for update;
  if found then
    select formula_version_id into v_existing_version from public.compound_official_usage
    where recipe_id = v_existing.id;
    if v_existing.created_by is distinct from auth.uid()
       or v_existing.medical_record_id is distinct from p_medical_record_id
       or v_existing_version is distinct from p_formula_version_id
       or v_existing.dosage_instruction is distinct from v_instruction
       or not exists (select 1 from public.medical_records m join public.visits s on s.id = m.visit_id
         where m.id = p_medical_record_id and s.id = p_visit_id and public.user_can_access_branch(s.branch_id)) then
      raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: kunci sudah dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;
  if v_formula.id is null then
    raise exception using errcode='P0001', message='RECIPE_INVALID: katalog sudah berubah atau nonaktif, muat ulang';
  end if;
  v_recipe_id := clinic_private.clinic_issue_compound(
    p_medical_record_id, p_visit_id,
    jsonb_build_object(
      'recipe_name', v_formula.name,
      'dosage_form', v_formula.dosage_form,
      'dosage_instruction', v_instruction,
      'ingredients', v_formula.ingredients
    ), p_request_key
  );
  -- A concurrent caller may have committed the same official issue while we
  -- waited on the inner RPC's unique request key. Accept only an identical
  -- official usage; a custom issue must never be relabeled as official.
  if (select r.xmin::text <> txid_current()::text
      from public.compounding_recipes r where r.id = v_recipe_id) then
    select * into v_existing from public.compounding_recipes where id = v_recipe_id;
    select formula_version_id into v_existing_version from public.compound_official_usage
    where recipe_id = v_recipe_id;
    if v_existing.created_by is distinct from auth.uid()
       or v_existing.medical_record_id is distinct from p_medical_record_id
       or v_existing.dosage_instruction is distinct from v_instruction
       or v_existing_version is distinct from p_formula_version_id then
      raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: kunci sudah dipakai racikan lain';
    end if;
    return v_recipe_id;
  end if;
  insert into public.compound_official_usage(recipe_id, formula_version_id)
  values (v_recipe_id, p_formula_version_id)
  on conflict (recipe_id) do nothing;
  select formula_version_id into v_existing_version from public.compound_official_usage
  where recipe_id = v_recipe_id;
  if v_existing_version is distinct from p_formula_version_id then
    raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: racikan memakai versi katalog lain';
  end if;
  return v_recipe_id;
end;
$function$;

revoke all on function public.publish_compound_formula(uuid,text,text,text,text,jsonb),
  public.set_compound_formula_active(uuid,boolean),
  public.clinic_issue_official_compound(uuid,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_compound_formula(uuid,text,text,text,text,jsonb),
  public.set_compound_formula_active(uuid,boolean),
  public.clinic_issue_official_compound(uuid,uuid,uuid,text,text) to authenticated;
