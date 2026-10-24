begin;
create function pg_temp.check_ok(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'U09 assertion: %',msg;end if;end$$;
insert into auth.users(id,raw_user_meta_data) values
 ('ab100000-0000-4000-8000-000000000001','{"full_name":"Owner A"}'),
 ('ab100000-0000-4000-8000-000000000002','{"full_name":"Owner B"}'),
 ('ab100000-0000-4000-8000-000000000003','{"full_name":"Scoped admin"}'),
 ('ab100000-0000-4000-8000-000000000004','{"full_name":"Target staff"}'),
 ('ab100000-0000-4000-8000-000000000005','{"full_name":"Creator only"}'),
 ('ab100000-0000-4000-8000-000000000006','{"full_name":"In scope doctor"}');
update profiles set role='OWNER' where id in('ab100000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000002');
update profiles set role='ADMIN' where id='ab100000-0000-4000-8000-000000000003';
update profiles set role='DOCTOR' where id='ab100000-0000-4000-8000-000000000006';
update profiles set role='STAFF' where id in('ab100000-0000-4000-8000-000000000004','ab100000-0000-4000-8000-000000000005');
insert into branches(id,code,name,type,is_active) values
 ('ab200000-0000-4000-8000-000000000001','U09_A','Fiction A','KLINIK',true),
 ('ab200000-0000-4000-8000-000000000002','U09_B','Fiction B','KLINIK',true),
 ('ab200000-0000-4000-8000-000000000003','U09_C','Fiction inactive','KLINIK',false);
insert into user_branches(user_id,branch_id,role) values
 ('ab100000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001','PRIMARY'),
 ('ab100000-0000-4000-8000-000000000004','ab200000-0000-4000-8000-000000000001','PRIMARY'),
 ('ab100000-0000-4000-8000-000000000006','ab200000-0000-4000-8000-000000000001','PRIMARY');
insert into employees(id,nama,jabatan,branch_id,status,profile_id) values('ab300000-0000-4000-8000-000000000001','Canonical HRIS','Perawat','ab200000-0000-4000-8000-000000000001','Aktif','ab100000-0000-4000-8000-000000000004');
insert into role_capabilities(role,all_branches,create_accounts) values('ADMIN',false,true),('STAFF',false,true) on conflict(role) do update set all_branches=excluded.all_branches,create_accounts=excluded.create_accounts;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ab100000-0000-4000-8000-000000000001',true);
do $$declare old jsonb;result jsonb;retried jsonb;before_count int;begin
 old:=public.get_user_account_for_edit('ab100000-0000-4000-8000-000000000004');
 perform pg_temp.check_ok(old->>'role'='STAFF' and old->>'full_name'='Target staff','existing values loaded');
 result:=public.edit_user_account('ab100000-0000-4000-8000-000000000004','Edited fictional','DOCTOR',array['ab200000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000002']::uuid[],old->>'version','ab400000-0000-4000-8000-000000000001');
 perform pg_temp.check_ok((select role='DOCTOR' and full_name='Edited fictional' and is_active from profiles where id='ab100000-0000-4000-8000-000000000004'),'name/role saved, active unchanged');
 perform pg_temp.check_ok((select role='PRIMARY' from user_branches where user_id='ab100000-0000-4000-8000-000000000004' and branch_id='ab200000-0000-4000-8000-000000000001'),'retained primary grant unchanged');
 perform pg_temp.check_ok((select role='SECONDARY' from user_branches where user_id='ab100000-0000-4000-8000-000000000004' and branch_id='ab200000-0000-4000-8000-000000000002'),'new grant secondary');
 perform pg_temp.check_ok((select nama='Canonical HRIS' and branch_id='ab200000-0000-4000-8000-000000000001' and profile_id='ab100000-0000-4000-8000-000000000004' from employees where id='ab300000-0000-4000-8000-000000000001'),'HRIS identity and employment assignment untouched');
 retried:=public.edit_user_account('ab100000-0000-4000-8000-000000000004','Edited fictional','DOCTOR',array['ab200000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000002']::uuid[],old->>'version','ab400000-0000-4000-8000-000000000001');
 perform pg_temp.check_ok((retried->>'replayed')::boolean,'lost response replay succeeds');
 perform pg_temp.check_ok((select count(*)=1 from user_account_edits),'one audit on exact retry');
 perform pg_temp.check_ok((select actor_id=auth.uid() and name_changed and old_role='STAFF' and new_role='DOCTOR' and cardinality(new_branch_ids)=2 and to_jsonb(e)::text not like '%Edited fictional%' from user_account_edits e),'server actor and minimal change audit');
 begin perform public.edit_user_account('ab100000-0000-4000-8000-000000000004','Changed request','DOCTOR',array['ab200000-0000-4000-8000-000000000001']::uuid[],old->>'version','ab400000-0000-4000-8000-000000000001');raise exception 'Expected identity conflict';exception when others then if sqlerrm not like 'ACCOUNT_IDEMPOTENCY_CONFLICT:%' then raise;end if;end;
 begin perform public.edit_user_account('ab100000-0000-4000-8000-000000000004','Stale','STAFF',array['ab200000-0000-4000-8000-000000000001']::uuid[],old->>'version','ab400000-0000-4000-8000-000000000002');raise exception 'Expected stale rejected';exception when others then if sqlerrm not like 'ACCOUNT_EDIT_CONFLICT:%' then raise;end if;end;
 old:=public.get_user_account_for_edit('ab100000-0000-4000-8000-000000000004');
 select count(*) into before_count from user_account_edits;
 begin perform public.edit_user_account('ab100000-0000-4000-8000-000000000004','Invalid late branch','STAFF',array['ab200000-0000-4000-8000-000000000003']::uuid[],old->>'version','ab400000-0000-4000-8000-000000000003');raise exception 'Expected inactive rejected';exception when others then if sqlerrm not like 'ACCOUNT_EDIT_INVALID:%' then raise;end if;end;
 perform pg_temp.check_ok((select full_name='Edited fictional' and role='DOCTOR' from profiles where id='ab100000-0000-4000-8000-000000000004') and (select count(*)=before_count from user_account_edits),'invalid branch rolls back profile/grants/audit');
 begin update user_account_edits set new_role='OWNER';raise exception 'Expected audit update denied';exception when insufficient_privilege then null;end;
 begin delete from user_account_edits;raise exception 'Expected audit delete denied';exception when insufficient_privilege then null;end;
 old:=public.get_user_account_for_edit(auth.uid());
 begin perform public.edit_user_account(auth.uid(),'Owner A','ADMIN',array[]::uuid[],old->>'version','ab400000-0000-4000-8000-000000000004');raise exception 'Expected self role lockout rejected';exception when others then if sqlerrm not like 'ACCOUNT_EDIT_SELF:%' then raise;end if;end;
end$$;
select set_config('request.jwt.claim.sub','ab100000-0000-4000-8000-000000000003',true);
do $$begin
 begin perform public.get_user_account_for_edit('ab100000-0000-4000-8000-000000000001');raise exception 'Expected privileged target denied';exception when insufficient_privilege then null;end;
 begin perform public.get_user_account_for_edit('ab100000-0000-4000-8000-000000000004');raise exception 'Expected foreign branch target denied';exception when insufficient_privilege then null;end;
end$$;
select pg_temp.check_ok((select count(*)=0 from user_account_edits),'scoped admin cannot read foreign/privileged target audit');
reset role;
update role_capabilities set create_accounts=false where role='ADMIN';
set local role authenticated;
select set_config('request.jwt.claim.sub','ab100000-0000-4000-8000-000000000003',true);
do $$declare v_view jsonb;begin
 v_view:=public.get_user_account_for_edit('ab100000-0000-4000-8000-000000000006');
 perform pg_temp.check_ok(not (v_view->'editable_roles' ? 'STAFF'),'cannot assign delegated create capability beyond actor');
 begin perform public.edit_user_account('ab100000-0000-4000-8000-000000000006','Escalation','STAFF',array['ab200000-0000-4000-8000-000000000001']::uuid[],v_view->>'version','ab400000-0000-4000-8000-000000000009');raise exception 'Expected delegated privilege escalation denied';exception when insufficient_privilege then null;end;
 perform public.edit_user_account('ab100000-0000-4000-8000-000000000006','In-scope edit','DOCTOR',array['ab200000-0000-4000-8000-000000000001']::uuid[],v_view->>'version','ab400000-0000-4000-8000-000000000010');
 perform pg_temp.check_ok((select full_name='In-scope edit' and role='DOCTOR' from profiles where id='ab100000-0000-4000-8000-000000000006'),'scoped admin can edit permitted account without elevating capability');
end$$;
select set_config('request.jwt.claim.sub','ab100000-0000-4000-8000-000000000005',true);
do $$begin begin perform public.get_user_account_for_edit('ab100000-0000-4000-8000-000000000004');raise exception 'Expected creator-only denied';exception when insufficient_privilege then null;end;end$$;
reset role;
update profiles set is_active=false where id='ab100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','ab100000-0000-4000-8000-000000000001',true);
do $$begin begin perform public.get_user_account_for_edit('ab100000-0000-4000-8000-000000000004');raise exception 'Expected inactive denied';exception when insufficient_privilege then null;end;end$$;
reset role;
select pg_temp.check_ok(not has_table_privilege('authenticated','public.user_account_edits','insert') and not has_table_privilege('authenticated','public.user_account_edits','update') and not has_table_privilege('authenticated','public.user_account_edits','delete'),'app audit writes revoked');
select pg_temp.check_ok(not has_function_privilege('anon','public.edit_user_account(uuid,text,text,uuid[],text,uuid)','execute'),'anonymous edit denied');
rollback;
