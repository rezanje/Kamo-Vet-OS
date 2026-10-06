-- Optional protected, read-only historical HPP reader. No table grants or
-- business data writes. The app retains recipe-only detail if this RPC is absent.
create function public.report_compound_ingredients(p_invoice_item_ids uuid[])
returns table (
  id uuid, invoice_item_id uuid, recipe_id uuid, ingredient_id uuid,
  item_id uuid, ingredient_name text, unit text, qty numeric, unit_cost numeric
)
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_role public.user_role;
  v_call_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('role', true), 'none'));
begin
  if v_call_role is distinct from 'authenticated' or auth.uid() is null then
    raise exception using errcode = '42501', message = 'ACCESS_DENIED: sesi laporan tidak ditemukan';
  end if;
  select p.role into v_role from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role in ('OWNER','FINANCE');
  if not found then
    raise exception using errcode = '42501', message = 'ACCESS_DENIED: HPP hanya untuk OWNER/FINANCE aktif';
  end if;
  if v_role <> 'OWNER' and exists (select 1 from public.role_modules rm where rm.role = v_role)
     and not exists (select 1 from public.role_modules rm where rm.role = v_role and rm.module_id = 'laporan') then
    raise exception using errcode = '42501', message = 'ACCESS_DENIED: modul laporan tidak diizinkan';
  end if;
  if p_invoice_item_ids is null or cardinality(p_invoice_item_ids) > 100 or array_position(p_invoice_item_ids, null) is not null then
    raise exception using errcode = '22023', message = 'REPORT_INVALID: maksimal 100 ID baris invoice';
  end if;
  -- Reject the entire request if even one ID is foreign or missing. Never
  -- silently export an authorized subset and call it a complete report.
  if exists (
    select 1 from unnest(p_invoice_item_ids) requested(line_id)
    left join public.invoice_items ii on ii.id = requested.line_id
    left join public.invoices inv on inv.id = ii.invoice_id
    left join public.visits v on v.id = inv.visit_id
    where ii.id is null or v.id is null or not public.user_can_access_branch(v.branch_id)
  ) then
    raise exception using errcode = '42501', message = 'ACCESS_DENIED: cabang invoice tidak diizinkan';
  end if;
  return query
    select ci.id, ii.id, ci.recipe_id, ci.ingredient_id, ci.item_id,
      ingredient.ingredient_name, ingredient.unit, ci.qty, ci.unit_cost
    from public.invoice_items ii
    join public.invoices inv on inv.id = ii.invoice_id and inv.voided_at is null
    join public.visits v on v.id = inv.visit_id
    join public.compounding_recipes recipe on recipe.id = ii.compound_recipe_id
    join public.medical_records m on m.id = recipe.medical_record_id and m.visit_id = inv.visit_id
    join public.compound_issues ci on ci.posted_invoice_item_id = ii.id
      and ci.recipe_id = recipe.id and ci.restored_at is null
    join public.compounding_ingredients ingredient on ingredient.id = ci.ingredient_id
      and ingredient.recipe_id = ci.recipe_id and ingredient.item_id = ci.item_id
    join public.warehouses w on w.id = ci.warehouse_id and w.branch_id = v.branch_id
    where ii.id = any(p_invoice_item_ids) and public.user_can_access_branch(v.branch_id);
end;
$function$;
revoke all on function public.report_compound_ingredients(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.report_compound_ingredients(uuid[]) to authenticated;
comment on function public.report_compound_ingredients(uuid[]) is
  'Read-only invoice-linked compound issue quantities/costs; names and units from stored ingredient snapshot. OWNER/FINANCE active, laporan module and branch scope required. Apply exact-count paging at caller.';
