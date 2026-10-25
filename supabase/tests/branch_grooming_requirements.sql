-- Fictional rows in disposable PostgreSQL only. Every write rolls back.
begin;
create function pg_temp.check_ok(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', label; end if; end $$;
create function pg_temp.reject(statement text, label text) returns void language plpgsql as $$
declare denied boolean := false;
begin
  begin execute statement; exception when others then denied := true; end;
  if not denied then raise exception 'Expected rejection: %', label; end if;
end $$;

insert into auth.users(id, raw_user_meta_data) values
  ('f9100000-0000-4000-8000-000000000001', '{"full_name":"Fictional owner"}');
update profiles set role = 'OWNER', is_active = true where id = 'f9100000-0000-4000-8000-000000000001';
insert into branches(id, code, name, type) values
  ('f9200000-0000-4000-8000-000000000001', 'GROOM-PET', 'Fictional petshop', 'PETSHOP'),
  ('f9200000-0000-4000-8000-000000000002', 'GROOM-CLINIC', 'Fictional clinic', 'KLINIK');
insert into user_branches(user_id, branch_id) values
  ('f9100000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000001'),
  ('f9100000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000002');
insert into items(id, code, name, unit, item_type, tindakan_kategori) values
  ('f9300000-0000-4000-8000-000000000001', 'GROOM-SVC', 'Fictional grooming', 'pcs', 'Jasa', 'Grooming'),
  ('f9300000-0000-4000-8000-000000000002', 'OTHER-SVC', 'Fictional other service', 'pcs', 'Jasa', 'Konsultasi');
insert into employees(id, nama, jabatan, branch_id, status) values
  ('f9400000-0000-4000-8000-000000000001', 'Fictional groomer', 'Groomer', 'f9200000-0000-4000-8000-000000000001', 'Aktif'),
  ('f9400000-0000-4000-8000-000000000002', 'Fictional doctor', 'Dokter', 'f9200000-0000-4000-8000-000000000002', 'Aktif');
insert into employee_branch_assignments(employee_id, branch_id, role, effective_date) values
  ('f9400000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000002', 'SECONDARY', current_date);
insert into sales(id, branch_id, no_struk, subtotal, total, cashier_id) values
  ('f9500000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000001', 'GROOM.PET', 0, 0, 'f9100000-0000-4000-8000-000000000001'),
  ('f9500000-0000-4000-8000-000000000002', 'f9200000-0000-4000-8000-000000000002', 'GROOM.CLINIC', 0, 0, 'f9100000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f9100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga) values
  ('f9500000-0000-4000-8000-000000000001','f9300000-0000-4000-8000-000000000001','Missing groomer',1,0)$q$, 'petshop requires groomer');
insert into sale_items(sale_id,item_id,nama,qty,harga,service_performers) values
  ('f9500000-0000-4000-8000-000000000001','f9300000-0000-4000-8000-000000000001','Petshop grooming',1,0,
   '{"staff_id":"f9400000-0000-4000-8000-000000000001"}');
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,service_performers) values
  ('f9500000-0000-4000-8000-000000000002','f9300000-0000-4000-8000-000000000001','Clinic missing doctor',1,0,
   '{"staff_id":"f9400000-0000-4000-8000-000000000001"}')$q$, 'clinic also requires doctor');
insert into sale_items(sale_id,item_id,nama,qty,harga,service_performers) values
  ('f9500000-0000-4000-8000-000000000002','f9300000-0000-4000-8000-000000000001','Clinic grooming',1,0,
   '{"staff_id":"f9400000-0000-4000-8000-000000000001","doctor_id":"f9400000-0000-4000-8000-000000000002"}');
insert into branch_grooming_rules(branch_id,doctor_required,updated_by) values
  ('f9200000-0000-4000-8000-000000000001',true,'f9100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,service_performers) values
  ('f9500000-0000-4000-8000-000000000001','f9300000-0000-4000-8000-000000000001','Petshop override',1,0,
   '{"staff_id":"f9400000-0000-4000-8000-000000000001"}')$q$, 'saved override requires doctor');
insert into branch_grooming_rules(branch_id,doctor_required,updated_by) values
  ('f9200000-0000-4000-8000-000000000002',false,'f9100000-0000-4000-8000-000000000001');
insert into sale_items(sale_id,item_id,nama,qty,harga,service_performers) values
  ('f9500000-0000-4000-8000-000000000002','f9300000-0000-4000-8000-000000000001','Clinic override',1,0,
   '{"staff_id":"f9400000-0000-4000-8000-000000000001"}');
select pg_temp.reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,service_performers) values
  ('f9500000-0000-4000-8000-000000000002','f9300000-0000-4000-8000-000000000001','Wrong groomer role',1,0,
   '{"staff_id":"f9400000-0000-4000-8000-000000000002"}')$q$, 'doctor cannot occupy groomer slot');
insert into sale_items(sale_id,item_id,nama,qty,harga) values
  ('f9500000-0000-4000-8000-000000000002','f9300000-0000-4000-8000-000000000002','Other service',1,0);
select pg_temp.check_ok((select count(*) = 4 from sale_items), 'only valid grooming and unrelated lines persisted');
rollback;
