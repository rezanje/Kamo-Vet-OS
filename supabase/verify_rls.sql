-- Fase 1 verification — PRD §14 CRITICAL: branch data isolation.
-- Run AFTER creating two auth users (owner@vetos.local, staff@vetos.local) via the
-- Auth admin API. This sets their roles/assignments and proves RLS, simulating each JWT.

-- owner gets OWNER role (sees everything)
update profiles set role = 'OWNER', full_name = 'Owner Test'
where id = (select id from auth.users where email = 'owner@vetos.local');

-- staff gets STAFF role assigned to BTKM only
update profiles set role = 'STAFF', full_name = 'Staff BTKM'
where id = (select id from auth.users where email = 'staff@vetos.local');

insert into user_branches (user_id, branch_id, role)
select u.id, b.id, 'PRIMARY'
from auth.users u, branches b
where u.email = 'staff@vetos.local' and b.code = 'BTKM'
on conflict do nothing;

-- ---- isolation check, simulating the STAFF JWT ----
do $$
declare staff_id uuid; n_total int; n_other int;
begin
  select id into staff_id from auth.users where email = 'staff@vetos.local';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', staff_id)::text, true);

  select count(*) into n_total from warehouses;
  select count(*) into n_other from warehouses w
    join branches b on b.id = w.branch_id where b.code <> 'BTKM';

  raise notice 'STAFF sees % warehouse(s); of those % outside BTKM (expect 1 and 0)', n_total, n_other;
  perform set_config('role', 'postgres', true);
end $$;

-- ---- as OWNER: should see all active warehouses ----
do $$
declare owner_id uuid; n int;
begin
  select id into owner_id from auth.users where email = 'owner@vetos.local';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, true);
  select count(*) into n from warehouses;
  raise notice 'OWNER sees % warehouse(s) (expect 27)', n;
  perform set_config('role', 'postgres', true);
end $$;
