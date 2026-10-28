-- Read-only. Expected after apply: body_md5 = f9630a9197f26870696f688e6eee6d7b, triggers unchanged (3 rows, enabled 'O'),
-- and no EXECUTE for anon/authenticated/service_role.
select md5(pg_get_functiondef('public.enforce_branch_grooming_performers()'::regprocedure)) = 'f9630a9197f26870696f688e6eee6d7b' as body_ok;
select c.relname, t.tgenabled, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where t.tgname = 'zz_grooming_requirement' order by 1;
select r as role, has_function_privilege(r, 'public.enforce_branch_grooming_performers()', 'EXECUTE') as can_execute
  from unnest(array['anon','authenticated','service_role']) r;
