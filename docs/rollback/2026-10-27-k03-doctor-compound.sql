-- Release rollback only. Inspect the live function, active users and migration
-- history first; this does not erase already issued clinical recipes or stock.
-- Run as one transaction only after the corresponding app rollback is ready.
begin;
do $$
declare
  target regprocedure := 'public.clinic_issue_master_compound(uuid,uuid,uuid,jsonb,text,uuid,text)'::regprocedure;
  definition text := pg_get_functiondef('public.clinic_issue_master_compound(uuid,uuid,uuid,jsonb,text,uuid,text)'::regprocedure);
  patched_call text := $patched$    if not exists (select 1 from public.profiles p where p.id=v_user and p.is_active
        and p.role in ('OWNER','ADMIN','DOCTOR')) then
      raise exception using errcode='P0001',message='ACCESS_DENIED: komposisi racikan hanya untuk pemilik/admin/dokter';
    end if;
    v_recipe_id:=clinic_private.clinic_issue_compound(p_medical_record_id,p_visit_id,v_recipe,v_key);$patched$;
  original_call text := '    v_recipe_id:=public.clinic_issue_compound(p_medical_record_id,p_visit_id,v_recipe,v_key);';
  old_owner oid;
  old_acl aclitem[];
  old_security boolean;
  old_config text[];
begin
  if to_regprocedure('public.clinic_doctor_custom_compound_supported()') is null
     or (length(definition)-length(replace(definition,patched_call,'')))/length(patched_call) <> 1
     or position('perform clinic_private.assert_compound_visit_unposted(p_visit_id,p_medical_record_id);' in definition)=0 then
    raise exception 'Doctor compound rollback drift: inspect the live function before rollback';
  end if;
  select proowner,proacl,prosecdef,proconfig into old_owner,old_acl,old_security,old_config
    from pg_catalog.pg_proc where oid=target::oid;
  execute replace(definition,patched_call,original_call);
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=target::oid
      and p.proowner=old_owner and p.proacl is not distinct from old_acl
      and p.prosecdef is not distinct from old_security
      and p.proconfig is not distinct from old_config) then
    raise exception 'Doctor compound rollback changed function owner, ACL or security configuration';
  end if;
end $$;
drop function public.clinic_doctor_custom_compound_supported();
commit;
