-- Read-only. Expected after apply: body_md5 = 20ffd58493e4d4127fe15597e54e5158, triggers unchanged (3 rows, enabled 'O'),
-- and no EXECUTE for anon/authenticated/service_role.
select md5(pg_get_functiondef('public.enforce_branch_grooming_performers()'::regprocedure)) = '20ffd58493e4d4127fe15597e54e5158' as body_ok;
select c.relname, t.tgenabled, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where t.tgname = 'zz_grooming_requirement' order by 1;
select r as role, has_function_privilege(r, 'public.enforce_branch_grooming_performers()', 'EXECUTE') as can_execute
  from unnest(array['anon','authenticated','service_role']) r;
