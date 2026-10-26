-- I09 candidate only: read exact production origins of FIFO layers consumed by a clinic compound.
-- Security migration: review/approve before applying to any hosted database.
create function public.read_compound_production_layer_trace(p_recipe_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  clinic_branch uuid;
  result jsonb := '[]'::jsonb;
  source_row record;
begin
  if p_recipe_id is null or auth.uid() is null
    or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active
      and (p.role = 'OWNER' or (p.role = 'ADMIN' and
        (exists (select 1 from public.role_modules m where m.role = p.role and m.module_id = 'klinik')
        or not exists (select 1 from public.role_modules m where m.role = p.role))))) then
    raise exception 'Akses jejak racikan ditolak' using errcode = '42501';
  end if;

  select v.branch_id into clinic_branch
  from public.compounding_recipes r
  join public.medical_records m on m.id = r.medical_record_id
  join public.visits v on v.id = m.visit_id
  where r.id = p_recipe_id;
  if clinic_branch is null or not public.user_can_access_branch(clinic_branch) then
    raise exception 'Akses jejak racikan ditolak' using errcode = '42501';
  end if;

  for source_row in
    select ci.ingredient_id, ci.item_id, ci.warehouse_id, ci.restored_at,
      ingredient.recipe_id as ingredient_recipe_id, ingredient.item_id as ingredient_item_id,
      l.item_id as layer_item_id, l.warehouse_id as layer_warehouse_id,
      l.source_ref, o.id as order_id, o.no_produksi, o.status,
      o.warehouse_id as order_warehouse_id, o.output_item_id,
      pr.item_id as recipe_output_item_id, w.branch_id as production_branch,
      exists (select 1 from public.production_atomic_postings p where p.order_id = o.id and p.kind = 'start') as start_proved,
      exists (select 1 from public.production_atomic_postings p where p.order_id = o.id and p.kind = 'finish') as finish_proved
    from public.compound_issues ci
    join public.compounding_ingredients ingredient on ingredient.id = ci.ingredient_id
    join public.stock_layers l on l.id = ci.stock_layer_id
    left join public.production_orders o on o.no_produksi = l.source_ref
    left join public.production_recipes pr on pr.id = o.recipe_id
    left join public.warehouses w on w.id = o.warehouse_id
    where ci.recipe_id = p_recipe_id and l.source = 'produksi'
    order by ci.ingredient_id, ci.id
  loop
    if source_row.source_ref is null or source_row.order_id is null or source_row.status is distinct from 'selesai'
      or not source_row.start_proved or not source_row.finish_proved
      or source_row.ingredient_recipe_id is distinct from p_recipe_id
      or source_row.ingredient_item_id is distinct from source_row.item_id
      or source_row.layer_item_id is distinct from source_row.item_id
      or source_row.layer_warehouse_id is distinct from source_row.warehouse_id
      or source_row.order_warehouse_id is distinct from source_row.warehouse_id
      or coalesce(source_row.output_item_id, source_row.recipe_output_item_id) is distinct from source_row.item_id
      or source_row.production_branch is null or not public.user_can_access_branch(source_row.production_branch) then
      raise exception 'Bukti asal produksi racikan tidak konsisten atau tidak dapat diakses' using errcode = '42501';
    end if;
    perform public.stock_document_access(source_row.production_branch, 'pos');
    result := result || jsonb_build_array(jsonb_build_object(
      'ingredient_id', source_row.ingredient_id,
      'material_item_id', source_row.item_id,
      'production_order_id', source_row.order_id,
      'no_produksi', source_row.no_produksi,
      'restored', source_row.restored_at is not null
    ));
  end loop;
  return result;
end $$;

revoke all on function public.read_compound_production_layer_trace(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_compound_production_layer_trace(uuid) to authenticated;
