-- Only explicit future recipient-instruction edits are synchronized. Existing
-- mixed compounding_steps and historic clinical records are never backfilled.
create function public.sync_compound_recipient_instruction() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_prescription_id uuid;
  v_usage text;
begin
  select id, aturan_pakai into v_prescription_id, v_usage from public.prescription_items
    where compound_recipe_id = new.id and medical_record_id = new.medical_record_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'USAGE_LINK_MISSING: resep pemakaian belum tertaut atau tidak dapat diakses; petunjuk tidak disimpan';
  end if;
  if v_usage is distinct from new.dosage_instruction then
    update public.prescription_items set aturan_pakai = new.dosage_instruction where id = v_prescription_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: petunjuk pemakaian resep tidak dapat disimpan lengkap';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.sync_compound_recipient_instruction() from public, anon, authenticated, service_role;
create trigger compound_recipient_instruction_sync
  after update of dosage_instruction on public.compounding_recipes
  for each row
  execute function public.sync_compound_recipient_instruction();
