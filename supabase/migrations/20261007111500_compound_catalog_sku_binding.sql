-- Existing recipes and selling snapshots remain unchanged. No formula/SKU
-- associations are inferred: OWNER/ADMIN must configure each formula explicitly.
alter table public.compound_formulas
  add column sale_item_id uuid references public.items(id) on delete restrict;
create index compound_formulas_sale_item_idx on public.compound_formulas(sale_item_id);

create function public.bind_compound_formula_sale_item(p_formula_id uuid,p_sale_item_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'authenticated' or auth.uid() is null or not exists (
    select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN')
  ) then
    raise exception using errcode='P0001',message='ACCESS_DENIED: hanya OWNER/ADMIN aktif dapat menautkan resep';
  end if;
  perform 1 from public.compound_formulas where id=p_formula_id for update;
  if not found then
    raise exception using errcode='P0001',message='RECIPE_INVALID: resep resmi tidak ditemukan';
  end if;
  if p_sale_item_id is not null then
    perform 1 from public.items i where i.id=p_sale_item_id and i.is_active
      and i.item_type='Persediaan' and not i.is_compound_material
      and (i.name ilike 'Obat Racik %' or i.name ilike 'Obat Racikan %' or exists (
        select 1 from public.item_categories c where c.id=i.category_id
          and upper(regexp_replace(btrim(c.name),'\s+',' ','g')) in ('OBAT RACIK','OBAT RACIKAN','RACIKAN')
      )) for share of i;
    if not found then
      raise exception using errcode='P0001',message='ITEM_INVALID: pilih SKU obat racik aktif dari Barang & Jasa';
    end if;
  end if;
  update public.compound_formulas set sale_item_id=p_sale_item_id where id=p_formula_id;
end;
$$;
revoke all on function public.bind_compound_formula_sale_item(uuid,uuid) from public,anon,service_role;
grant execute on function public.bind_compound_formula_sale_item(uuid,uuid) to authenticated;

create or replace function public.clinic_issue_master_compound(
  p_medical_record_id uuid,p_visit_id uuid,p_sale_item_id uuid,p_recipe jsonb,
  p_request_key text,p_formula_version_id uuid default null,p_dosage_instruction text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid();
  v_visit public.visits%rowtype;
  v_sale public.clinic_compound_sales%rowtype;
  v_item public.items%rowtype;
  v_price numeric(15,2);
  v_key text:=nullif(btrim(p_request_key),'');
  v_hash text;
  v_recipe jsonb;
  v_ingredients jsonb:='[]'::jsonb;
  v_ingredient jsonb;
  v_material public.items%rowtype;
  v_recipe_id uuid;
begin
  if coalesce(auth.role(),'')<>'authenticated' or v_user is null or not exists (
    select 1 from public.profiles p where p.id=v_user and p.is_active=true
  ) then
    raise exception using errcode='P0001',message='ACCESS_DENIED: pengguna tidak aktif atau tidak terautentikasi';
  end if;
  if v_key is null or length(v_key)>100 or p_sale_item_id is null
    or (p_formula_version_id is null and jsonb_typeof(p_recipe) is distinct from 'object')
    or (p_formula_version_id is not null and p_recipe is not null) then
    raise exception using errcode='P0001',message='RECIPE_INVALID: pilih SKU obat racik dan komposisi yang valid';
  end if;
  select * into v_visit from public.visits where id=p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) or not exists (
    select 1 from public.medical_records where id=p_medical_record_id and visit_id=p_visit_id
  ) then
    raise exception using errcode='P0001',message='ACCESS_DENIED: pemeriksaan atau cabang tidak dapat diakses';
  end if;
  v_hash:=md5(jsonb_build_object('medical',p_medical_record_id,'visit',p_visit_id,
    'sale_item',p_sale_item_id,'recipe',p_recipe,'formula',p_formula_version_id,'dose',p_dosage_instruction)::text);
  perform pg_advisory_xact_lock(hashtextextended('clinic-master-compound:'||v_key,0));
  select * into v_sale from public.clinic_compound_sales where request_key=v_key for update;
  if found then
    if v_sale.actor_id is distinct from v_user or v_sale.request_hash is distinct from v_hash
      or v_sale.recipe_id is null then
      raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT: kunci racikan dipakai untuk data berbeda';
    end if;
    return v_sale.recipe_id;
  end if;
  if exists(select 1 from public.compounding_recipes where request_key=v_key) then
    raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT: kunci sudah dipakai racikan sebelumnya';
  end if;
  select i.* into v_item from public.items i where i.id=p_sale_item_id and i.is_active
    and i.item_type='Persediaan' and not i.is_compound_material
    and (i.name ilike 'Obat Racik %' or i.name ilike 'Obat Racikan %' or exists (
      select 1 from public.item_categories c where c.id=i.category_id
        and upper(regexp_replace(btrim(c.name),'\s+',' ','g')) in ('OBAT RACIK','OBAT RACIKAN','RACIKAN')
    )) for share of i;
  if not found then
    raise exception using errcode='P0001',message='ITEM_INVALID: pilih SKU obat racik aktif dari Barang & Jasa';
  end if;
  -- Lock the explicit binding until issue commits; revisions/rebinding cannot
  -- race a new issue. Successful retries above retain their original snapshot.
  if p_formula_version_id is not null then
    perform 1 from public.compound_formulas f
      where f.active and f.current_version_id=p_formula_version_id
        and f.sale_item_id=p_sale_item_id for share of f;
    if not found then
      raise exception using errcode='P0001',message='FORMULA_SKU_MISMATCH: resep resmi belum ditautkan ke SKU ini atau katalog sudah berubah';
    end if;
  end if;
  select sell_price into v_price from public.item_branch_prices
    where item_id=v_item.id and branch_id=v_visit.branch_id and unit=v_item.unit for share;
  v_price:=coalesce(v_price,v_item.sell_price,0);
  if v_price<0 or v_price::text in ('NaN','Infinity','-Infinity') then
    raise exception using errcode='P0001',message='ITEM_INVALID: harga jual master tidak valid';
  end if;
  insert into public.clinic_compound_sales(request_key,request_hash,visit_id,medical_record_id,
    actor_id,sale_item_id,sale_name,sale_price,sale_unit)
  values(v_key,v_hash,p_visit_id,p_medical_record_id,v_user,v_item.id,v_item.name,v_price,v_item.unit);
  if p_formula_version_id is not null then
    v_recipe_id:=public.clinic_issue_official_compound(p_medical_record_id,p_visit_id,p_formula_version_id,v_key,p_dosage_instruction);
  else
    if jsonb_typeof(p_recipe->'ingredients') is distinct from 'array'
      or jsonb_array_length(p_recipe->'ingredients') not between 1 and 100 then
      raise exception using errcode='P0001',message='RECIPE_INVALID: minimal satu bahan racikan';
    end if;
    for v_ingredient in select value from jsonb_array_elements(p_recipe->'ingredients') loop
      select * into v_material from public.items where id=(v_ingredient->>'item_id')::uuid
        and is_active and is_compound_material and item_type='Persediaan' for share;
      if not found then
        raise exception using errcode='P0001',message='INGREDIENT_INVALID: bahan tidak aktif';
      end if;
      -- Unit/quantity is validated by the existing stock routine. Client prices
      -- never set selling price or ingredient snapshots.
      v_ingredients:=v_ingredients||jsonb_build_array(v_ingredient||jsonb_build_object('unit_price',coalesce(v_material.sell_price,0)));
    end loop;
    v_recipe:=p_recipe||jsonb_build_object('recipe_name',v_item.name,'ingredients',v_ingredients);
    v_recipe_id:=public.clinic_issue_compound(p_medical_record_id,p_visit_id,v_recipe,v_key);
  end if;
  update public.clinic_compound_sales set recipe_id=v_recipe_id where request_key=v_key;
  if not exists(select 1 from public.prescription_items where compound_recipe_id=v_recipe_id
      and item_id is null and nama_obat=v_item.name and harga=v_price and qty=1) then
    raise exception using errcode='P0001',message='RECIPE_INVALID: tautan harga jual racikan gagal';
  end if;
  return v_recipe_id;
end;
$$;
revoke all on function public.clinic_issue_master_compound(uuid,uuid,uuid,jsonb,text,uuid,text) from public,anon,service_role;
grant execute on function public.clinic_issue_master_compound(uuid,uuid,uuid,jsonb,text,uuid,text) to authenticated;

create or replace function public.clinic_issue_official_compound(
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
  select f.id, f.sale_item_id, v.name, v.dosage_form, v.dosage_instruction, v.ingredients
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
  if v_formula.sale_item_id is null then
    raise exception using errcode='P0001',message='FORMULA_SKU_MISMATCH: OWNER/ADMIN harus menautkan resep resmi ke SKU jual';
  end if;
  -- Legacy direct official callers use the configured selling SKU too. The
  -- sale wrapper inserts its pending row before calling back here, avoiding
  -- recursion and preserving one FIFO/prescription write per request.
  if not exists (select 1 from public.clinic_compound_sales s
    where s.request_key=p_request_key and s.actor_id=auth.uid()
      and s.medical_record_id=p_medical_record_id and s.visit_id=p_visit_id
      and s.sale_item_id=v_formula.sale_item_id and s.recipe_id is null) then
    return public.clinic_issue_master_compound(p_medical_record_id,p_visit_id,
      v_formula.sale_item_id,null,p_request_key,p_formula_version_id,p_dosage_instruction);
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
