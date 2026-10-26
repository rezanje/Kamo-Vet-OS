-- C04: opt-in nominal amount per complete package for one targeted SKU.
-- Existing rule JSON without discount_mode remains per-unit. Posted sales are untouched.
alter table public.promos add constraint promos_discount_mode_valid check (
 coalesce(rule->>'discount_mode','per_unit')='per_unit'
 or (rule->>'discount_mode'='package_total' and discount_type='nominal' and min_qty>0)
) not valid;

-- Extend the existing owner/admin atomic editor without altering its ACL, signature,
-- target locks, audit path or stale-version contract. An absent field from an older
-- client preserves the current mode during a staggered deployment.
do $$
declare
 editor_oid oid:=to_regprocedure('public.edit_promo(uuid,text,jsonb,uuid[])');
 definition text;
 old_fields text:=$old$or exists(select 1 from jsonb_object_keys(p_values) k where k<>all(fields)) then$old$;
 new_fields text:=$new$or exists(select 1 from jsonb_object_keys(p_values) k where k<>all(fields) and k<>'discount_mode') then$new$;
 old_record text:=$old$values_row:=jsonb_populate_record(null::public.promos,p_values-array['suggest','min_subtotal']);$old$;
 new_record text:=$new$values_row:=jsonb_populate_record(null::public.promos,p_values-array['suggest','min_subtotal','discount_mode']);$new$;
 old_targets text:=$old$select coalesce(array_agg(distinct id order by id),'{}') into item_ids from unnest(p_item_ids) id;$old$;
 new_targets text:=$new$select coalesce(array_agg(distinct id order by id),'{}') into item_ids from unnest(p_item_ids) id;
 if p_values ? 'discount_mode' and (jsonb_typeof(p_values->'discount_mode')<>'string' or p_values->>'discount_mode' not in('per_unit','package_total')) then
  raise exception 'Cara hitung diskon promo tidak valid';
 end if;
 if coalesce(p_values->>'discount_mode',existing.rule->>'discount_mode','per_unit')='package_total'
  and (values_row.discount_type is distinct from 'nominal' or values_row.min_qty is null or cardinality(item_ids)<>1) then
  raise exception 'Total per paket memerlukan diskon nominal, min. qty, dan tepat satu barang target';
 end if;$new$;
 old_rule text:=$old$if min_subtotal is not null then new_rule:=new_rule||jsonb_build_object('min_subtotal',min_subtotal);end if;$old$;
 new_rule text:=$new$if min_subtotal is not null then new_rule:=new_rule||jsonb_build_object('min_subtotal',min_subtotal);end if;
 if p_values ? 'discount_mode' then
  if p_values->>'discount_mode'='per_unit' then new_rule:=new_rule-'discount_mode';
  else new_rule:=new_rule||jsonb_build_object('discount_mode','package_total');end if;
 end if;$new$;
begin
 if editor_oid is null or not exists(select 1 from pg_proc p where p.oid=editor_oid
  and p.prosecdef and p.proconfig @> array['search_path=""']::text[])
  or has_function_privilege('anon',editor_oid,'EXECUTE')
  or has_function_privilege('service_role',editor_oid,'EXECUTE')
  or not has_function_privilege('authenticated',editor_oid,'EXECUTE') then
  raise exception 'C04_PROMO_EDITOR_GUARD_DRIFT';
 end if;
 definition:=pg_get_functiondef(editor_oid);
 if (length(definition)-length(replace(definition,old_fields,'')))/length(old_fields)<>1
  or (length(definition)-length(replace(definition,old_record,'')))/length(old_record)<>1
  or (length(definition)-length(replace(definition,old_targets,'')))/length(old_targets)<>1
  or (length(definition)-length(replace(definition,old_rule,'')))/length(old_rule)<>1 then
  raise exception 'C04_PROMO_EDITOR_VALIDATION_DRIFT';
 end if;
 execute replace(replace(replace(replace(definition,old_fields,new_fields),old_record,new_record),old_targets,new_targets),old_rule,new_rule);
end $$;
