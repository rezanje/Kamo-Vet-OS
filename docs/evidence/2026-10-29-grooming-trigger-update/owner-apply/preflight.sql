-- Read-only. Expected before apply: body_md5 = 019ceed5f3e0951a00cd97c7e22e984a (or 20ffd58493e4d4127fe15597e54e5158 if already applied),
-- three enabled zz_grooming_requirement triggers (invoice_items, prescription_items, sale_items).
select md5(pg_get_functiondef(p.oid)) as body_md5,
       case md5(pg_get_functiondef(p.oid)) when '019ceed5f3e0951a00cd97c7e22e984a' then 'READY: original body'
         when '20ffd58493e4d4127fe15597e54e5158' then 'ALREADY APPLIED' else 'STOP: unknown body' end as verdict
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'enforce_branch_grooming_performers';
select c.relname, t.tgenabled, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where t.tgname = 'zz_grooming_requirement' order by 1;
