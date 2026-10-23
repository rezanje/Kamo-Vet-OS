begin;
create function pg_temp.assert_ok(ok boolean,message text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'Assertion failed: %',message;end if;end$$;
insert into auth.users(id,raw_user_meta_data) values
 ('fa100000-0000-4000-8000-000000000001','{"full_name":"Private A"}'),
 ('fa100000-0000-4000-8000-000000000002','{"full_name":"Private B"}'),
 ('fa100000-0000-4000-8000-000000000003','{"full_name":"Disabled"}'),
 ('fa100000-0000-4000-8000-000000000004','{"full_name":"No module"}');
update profiles set role='ADMIN' where id in('fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000003');
update profiles set role='OWNER' where id='fa100000-0000-4000-8000-000000000002';
update profiles set is_active=false where id='fa100000-0000-4000-8000-000000000003';
update profiles set role='STAFF' where id='fa100000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000001',true);
insert into private_report_presets(id,name,href,saved_at) values('fa200000-0000-4000-8000-000000000001','Vaksin A','/laporan/promo?dari=2026-10-01&dokter=fixture','2000-01-01');
select pg_temp.assert_ok((select user_id=auth.uid() and saved_at>'2026-01-01' from private_report_presets where id='fa200000-0000-4000-8000-000000000001'),'owner and time server derived');
do $$begin
 begin insert into private_report_presets(user_id,name,href) values('fa100000-0000-4000-8000-000000000002','spoof','/laporan/promo');raise exception 'Expected spoof denied';exception when insufficient_privilege then null;end;
 begin insert into private_report_presets(name,href) values('external','https://evil.test');raise exception 'Expected external denied';exception when check_violation then null;end;
 begin insert into private_report_presets(name,href) values('secret','/laporan/promo?token=not-allowed');raise exception 'Expected unknown query denied';exception when check_violation then null;end;
end$$;
-- Another browser's independent row is not lost by editing/retrying the first.
insert into private_report_presets(id,name,href) values('fa200000-0000-4000-8000-000000000002','B browser','/laporan/promo?periode=2026-11');
insert into private_report_presets(id,name,href) values('fa200000-0000-4000-8000-000000000001','Vaksin A','/laporan/promo?periode=2026-11') on conflict(id) do update set href=excluded.href;
select pg_temp.assert_ok((select count(*)=2 from private_report_presets),'upsert retry no duplicate and preserves other browser row');
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000002',true);
select pg_temp.assert_ok((select count(*)=0 from private_report_presets),'OWNER cannot read other private owner');
update private_report_presets set name='forbidden' where id='fa200000-0000-4000-8000-000000000001';
delete from private_report_presets where id='fa200000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000001',true);
select pg_temp.assert_ok((select name='Vaksin A' from private_report_presets where id='fa200000-0000-4000-8000-000000000001'),'other owner update/delete cannot alter it');
do $$begin
 begin update private_report_presets set user_id='fa100000-0000-4000-8000-000000000002' where id='fa200000-0000-4000-8000-000000000001';raise exception 'Expected reparent denied';exception when insufficient_privilege then null;end;
end$$;
-- Limit enforced under serialized owner lock, not a client count.
insert into private_report_presets(name,href) select 'P'||n,'/laporan/promo' from generate_series(1,48)n;
do $$begin
 begin insert into private_report_presets(name,href) values('over cap','/laporan/promo');raise exception 'Expected cap denied';exception when check_violation then null;end;
end$$;
select pg_temp.assert_ok((select count(*)=50 from private_report_presets),'failed cap leaves existing rows intact');
update private_report_presets set name='edited at cap' where id='fa200000-0000-4000-8000-000000000001';
insert into private_report_presets(id,name,href) values('fa200000-0000-4000-8000-000000000001','retry at cap','/laporan/promo') on conflict(id) do update set name=excluded.name;
select pg_temp.assert_ok((select count(*)=50 from private_report_presets),'exact id retry still works at cap');
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000003',true);
select pg_temp.assert_ok((select count(*)=0 from private_report_presets),'disabled cannot read');
do $$begin begin insert into private_report_presets(name,href) values('disabled','/laporan/promo');raise exception 'Expected disabled denied';exception when insufficient_privilege then null;end;end$$;
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000004',true);
select pg_temp.assert_ok((select count(*)=0 from private_report_presets),'no module cannot read');
do $$begin begin insert into private_report_presets(name,href) values('staff','/laporan/promo');raise exception 'Expected module denied';exception when insufficient_privilege then null;end;end$$;
reset role;
insert into role_modules(role,module_id) values('ADMIN','klinik');
set local role authenticated;
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000001',true);
select pg_temp.assert_ok((select count(*)=0 from private_report_presets),'explicit module override revokes private config access');
reset role;
insert into role_modules(role,module_id) values('STAFF','laporan');
set local role authenticated;
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000004',true);
insert into private_report_presets(name,href) values('explicit module','/laporan/promo');
select pg_temp.assert_ok((select count(*)=1 from private_report_presets),'existing explicit module permission is honored only for own rows');
reset role;
set local role anon;
select pg_temp.assert_ok(not has_table_privilege('anon','public.private_report_presets','select'),'anonymous has no preference grants');
reset role;
rollback;
