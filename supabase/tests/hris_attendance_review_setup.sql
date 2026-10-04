\set ON_ERROR_STOP on
begin;
create or replace function public.hris_attendance_now() returns timestamptz language sql volatile as $$ select '2026-10-01T08:10:00+07'::timestamptz $$;
insert into auth.users(id) select ('90000000-0000-0000-0000-00000000000'||i)::uuid from generate_series(1,3) i;
update profiles set role=case id::text when '90000000-0000-0000-0000-000000000002' then 'OWNER'::user_role when '90000000-0000-0000-0000-000000000003' then 'ADMIN'::user_role else 'STAFF'::user_role end;
insert into branches(id,code,name,type) values('91000000-0000-0000-0000-000000000001','REV-FIC','Fiction review','KLINIK');
insert into employees(id,nama,profile_id,branch_id) values('92000000-0000-0000-0000-000000000001','Fiction review staff','90000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001'),('92000000-0000-0000-0000-000000000002','Fiction review second',null,'91000000-0000-0000-0000-000000000001');
insert into employee_branch_assignments(employee_id,branch_id,effective_date) select id,branch_id,'2026-01-01' from employees;
create function pg_temp.check_it(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',msg;end if;end $$;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
