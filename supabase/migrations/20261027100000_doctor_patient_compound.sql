-- A DOCTOR may choose actual ingredients for a finished, active compound SKU.
-- Keep the legacy no-SKU custom RPC OWNER/ADMIN-only and retain the locked
-- visit, FIFO, HPP, idempotency and posted-history checks in the existing body.
do $$
declare
  definition text := pg_get_functiondef('public.clinic_issue_master_compound(uuid,uuid,uuid,jsonb,text,uuid,text)'::regprocedure);
  old_call text := '    v_recipe_id:=public.clinic_issue_compound(p_medical_record_id,p_visit_id,v_recipe,v_key);';
  new_call text := $new$    if not exists (select 1 from public.profiles p where p.id=v_user and p.is_active
        and p.role in ('OWNER','ADMIN','DOCTOR')) then
      raise exception using errcode='P0001',message='ACCESS_DENIED: komposisi racikan hanya untuk pemilik/admin/dokter';
    end if;
    v_recipe_id:=clinic_private.clinic_issue_compound(p_medical_record_id,p_visit_id,v_recipe,v_key);$new$;
begin
  if (length(definition)-length(replace(definition,old_call,'')))/length(old_call) <> 1
     or position('perform clinic_private.assert_compound_visit_unposted(p_visit_id,p_medical_record_id);' in definition)=0 then
    raise exception 'Doctor compound patch drift: review current master issue and posted-visit guard';
  end if;
  execute replace(definition,old_call,new_call);
end $$;

-- The app fails closed for doctors until this migration is present. Existing
-- OWNER/ADMIN custom composition does not depend on this readiness signal.
create function public.clinic_doctor_custom_compound_supported()
returns boolean language sql stable security invoker set search_path='' as $$select true$$;
revoke all on function public.clinic_doctor_custom_compound_supported() from public,anon,service_role;
grant execute on function public.clinic_doctor_custom_compound_supported() to authenticated;
