-- All fixtures are fictional and rolled back; no remote database is accepted by runner.
begin;
create function pg_temp.must_fail(q text,fragment text) returns void language plpgsql as $$
begin
 begin execute q; exception when others then
  if position(fragment in sqlerrm)=0 then raise exception 'Wrong failure [%], expected [%]',sqlerrm,fragment;end if;
  return;
 end;
 raise exception 'Expected failure: %',q;
end $$;
create function pg_temp.check_true(ok boolean,why text) returns void language plpgsql as $$begin if ok is not true then raise exception 'Assertion failed: %',why;end if;end $$;
insert into auth.users(id) values ('aa000000-0000-4000-8000-000000000001'),('aa000000-0000-4000-8000-000000000002');
update profiles set role='OWNER',is_active=true where id='aa000000-0000-4000-8000-000000000001';
update profiles set role='STAFF',is_active=true where id='aa000000-0000-4000-8000-000000000002';
insert into branches(id,code,name,type) values('ab000000-0000-4000-8000-000000000001','MASTER-TEST','Fictional branch','KLINIK');
insert into employees(id,nama) values ('ac000000-0000-4000-8000-000000000001','Fictional unused employee');
insert into items(id,code,name) values ('ac000000-0000-4000-8000-000000000002','MASTER-UNUSED','Fictional unused item');
insert into brands(id,name) values ('ac000000-0000-4000-8000-000000000003','Fictional unused brand');
insert into suppliers(id,nama) values ('ac000000-0000-4000-8000-000000000004','Fictional unused supplier');
insert into supplier_categories(id,nama) values ('ac000000-0000-4000-8000-000000000005','Fictional unused supplier category');
insert into units(id,nama) values ('ac000000-0000-4000-8000-000000000006','unused-lifecycle');
select pg_temp.check_true(not has_function_privilege('anon','public.change_master_data_lifecycle(text,uuid,text,bigint,text)','EXECUTE'),'anonymous RPC execution denied');
select pg_temp.check_true(not has_function_privilege('service_role','public.change_master_data_lifecycle(text,uuid,text,bigint,text)','EXECUTE'),'service role cannot bypass authenticated actor requirement');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='aa000000-0000-4000-8000-000000000001';
do $$declare entity text; id uuid; idx integer:=0; s jsonb; begin
 foreach entity in array array['employees','items','brands','suppliers','supplier_categories','units'] loop
  idx:=idx+1;id:=('ac000000-0000-4000-8000-'||lpad(idx::text,12,'0'))::uuid;
  perform public.change_master_data_lifecycle(entity,id,'trash',0,'Fictional mistaken entry');
  execute format('select to_jsonb(t) from public.%I t where id=$1',entity) into s using id;
  perform pg_temp.check_true(s->>'trashed_at' is not null,'recoverable trash row remains');
  perform pg_temp.must_fail(format('select public.change_master_data_lifecycle(%L,%L,''trash'',0,''stale retry'')',entity,id),'Data sudah berubah');
  perform pg_temp.must_fail(format('update public.%I set trashed_at=null where id=%L',entity,id),'Perubahan status wajib');
  if entity<>'items' then perform pg_temp.must_fail(format('delete from public.%I where id=%L',entity,id),'Penghapusan permanen'); end if;
  perform public.change_master_data_lifecycle(entity,id,'restore',1,'Restore fictional entry');
  execute format('select to_jsonb(t) from public.%I t where id=$1',entity) into s using id;
  perform pg_temp.check_true(s->>'trashed_at' is null and case when entity='employees' then s->>'status'='Nonaktif' else s->>'is_active'='false' end,'restore must be inactive');
  perform public.change_master_data_lifecycle(entity,id,'activate',2,'Activate fictional entry');
  perform public.change_master_data_lifecycle(entity,id,'archive',3,'Archive fictional entry');
 end loop;
end $$;
select set_config('kamo.master_lifecycle','brands:ac000000-0000-4000-8000-000000000003',true);
select pg_temp.must_fail('update brands set is_active=true where id=''ac000000-0000-4000-8000-000000000003''','Perubahan status wajib');
select set_config('kamo.master_lifecycle','',true);
select pg_temp.check_true((select count(*)=24 from master_data_lifecycle_audit),'exactly one audit per committed transition');
select pg_temp.must_fail('update master_data_lifecycle_audit set reason=''replace''','permission denied');
select pg_temp.must_fail('select change_master_data_lifecycle(''items'',''ac000000-0000-4000-8000-000000000002'',''trash'',4,''x'')','alasan');
select pg_temp.must_fail('select change_master_data_lifecycle(''profiles'',''ac000000-0000-4000-8000-000000000002'',''trash'',4,''bad entity'')','Identitas');
set local request.jwt.claim.sub='aa000000-0000-4000-8000-000000000002';
select pg_temp.must_fail('select change_master_data_lifecycle(''items'',''ac000000-0000-4000-8000-000000000002'',''trash'',4,''unauthorized'')','OWNER/ADMIN aktif');
reset role;
set local request.jwt.claim.sub='aa000000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=false where id='aa000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub='aa000000-0000-4000-8000-000000000002';
select pg_temp.must_fail('select change_master_data_lifecycle(''items'',''ac000000-0000-4000-8000-000000000002'',''trash'',4,''inactive admin'')','OWNER/ADMIN aktif');
reset role;
-- Existing links block trash even when FK would CASCADE or SET NULL.
insert into items(id,code,name,brand_id,supplier_id,unit) values('ad000000-0000-4000-8000-000000000001','REF-MASTER','Fictional referenced item','ac000000-0000-4000-8000-000000000003','ac000000-0000-4000-8000-000000000004','unused-lifecycle');
update suppliers set category_id='ac000000-0000-4000-8000-000000000005' where id='ac000000-0000-4000-8000-000000000004';
insert into employee_branch_assignments(employee_id,branch_id) values('ac000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001');
insert into item_units(item_id,unit,factor) values('ac000000-0000-4000-8000-000000000002','pcs',1);
insert into warehouses(id,branch_id,code,name,type) values('ab100000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001','MASTER-WH','Fictional warehouse','VET');
insert into stock(warehouse_id,item_id,qty) values('ab100000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002',0);
insert into stock_layers(warehouse_id,item_id,qty_in,qty_left,unit_cost,source) values('ab100000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002',7,0,12345,'purchase');
insert into payrolls(periode,employee_id,gaji_pokok,total) values('2026-09','ac000000-0000-4000-8000-000000000001',1234567,1234567);
insert into work_shifts(id,nama,is_libur) values('ab200000-0000-4000-8000-000000000001','Fictional shift',true);
insert into employee_schedules(employee_id,tanggal,shift_id) values('ac000000-0000-4000-8000-000000000001','2026-10-21','ab200000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claim.sub='aa000000-0000-4000-8000-000000000001';
do $$declare entity text; id uuid; idx integer:=0; begin
 foreach entity in array array['employees','items','brands','suppliers','supplier_categories','units'] loop
  idx:=idx+1;id:=('ac000000-0000-4000-8000-'||lpad(idx::text,12,'0'))::uuid;
  perform pg_temp.must_fail(format('select change_master_data_lifecycle(%L,%L,''trash'',4,''has references'')',entity,id),'pemakaian atau riwayat');
  perform public.change_master_data_lifecycle(entity,id,'activate',4,'Activate with history');
  perform public.change_master_data_lifecycle(entity,id,'archive',5,'Archive with history');
 end loop;
end $$;
select pg_temp.check_true((select brand_id='ac000000-0000-4000-8000-000000000003' and supplier_id='ac000000-0000-4000-8000-000000000004' and unit='unused-lifecycle' from items where code='REF-MASTER'),'archive preserves every outgoing link');
select pg_temp.must_fail('update units set nama=''renamed'' where id=''ac000000-0000-4000-8000-000000000006''','Satuan sudah dipakai');
select pg_temp.check_true((select qty=0 from stock where item_id='ac000000-0000-4000-8000-000000000002'),'zero stock retained, never treated as unused');
select pg_temp.check_true((select qty_in=7 and qty_left=0 and unit_cost=12345 from stock_layers where item_id='ac000000-0000-4000-8000-000000000002'),'exhausted FIFO financial record retained');
select pg_temp.check_true((select total=1234567 from payrolls where employee_id='ac000000-0000-4000-8000-000000000001'),'historical payroll amount retained');
select pg_temp.check_true((select count(*)=1 from employee_schedules where employee_id='ac000000-0000-4000-8000-000000000001'),'schedule retained');
-- Parent is unused, then trashed: new FK, text and JSON links must fail.
reset role;
insert into brands(id,name) values('ae000000-0000-4000-8000-000000000001','Fictional trashed brand');
insert into units(id,nama) values('ae000000-0000-4000-8000-000000000002','trashed-lifecycle');
set local role authenticated;
select change_master_data_lifecycle('brands','ae000000-0000-4000-8000-000000000001','trash',0,'Trash unused brand');
select change_master_data_lifecycle('units','ae000000-0000-4000-8000-000000000002','trash',0,'Trash unused unit');
select pg_temp.must_fail('update items set brand_id=''ae000000-0000-4000-8000-000000000001'' where code=''REF-MASTER''','Sampah');
select pg_temp.must_fail('update items set unit=''trashed-lifecycle'' where code=''REF-MASTER''','Sampah');
reset role;
insert into employees(id,nama) values('bf000000-0000-4000-8000-000000000001','Fictional snapshot owner');
set local role authenticated;
select pg_temp.must_fail('insert into employee_import_details(employee_id,fields) values(''bf000000-0000-4000-8000-000000000001'',''{"brand":"ae000000-0000-4000-8000-000000000001"}'')','Sampah');
select pg_temp.must_fail('insert into employee_import_details(employee_id,fields) values(''bf000000-0000-4000-8000-000000000001'',''{"satuan":"trashed-lifecycle"}'')','Sampah');
-- Import audit can reference an item code without an item UUID.
reset role;
insert into items(id,code,name) values('bf100000-0000-4000-8000-000000000001','CODE-USED','Fictional code-linked SKU'),('bf100000-0000-4000-8000-000000000002','CODE-TRASH','Fictional code trash SKU');
insert into import_runs(id,kind,source_name,source_hash,created_by) values('bf200000-0000-4000-8000-000000000001','master_accurate','Fictional code fixture','fictional-code-fixture','aa000000-0000-4000-8000-000000000001');
insert into import_run_rows(run_id,source_row,source_code,status,payload) values('bf200000-0000-4000-8000-000000000001',1,'CODE-USED','posted','{"code":"CODE-USED"}');
set local role authenticated;
select pg_temp.must_fail('select change_master_data_lifecycle(''items'',''bf100000-0000-4000-8000-000000000001'',''trash'',0,''code source history'')','pemakaian atau riwayat');
select change_master_data_lifecycle('items','bf100000-0000-4000-8000-000000000002','trash',0,'Trash unused code');
select pg_temp.must_fail('insert into import_run_rows(run_id,source_row,source_code,status,payload) values(''bf200000-0000-4000-8000-000000000001'',2,''CODE-TRASH'',''valid'',''{}'')','Sampah');
select pg_temp.must_fail('insert into import_run_rows(run_id,source_row,source_code,status,payload) values(''bf200000-0000-4000-8000-000000000001'',3,null,''valid'',''{"code":"CODE-TRASH"}'')','Sampah');
-- Active employee archival leaves the login account untouched.
reset role;
insert into employees(id,nama,profile_id) values('af000000-0000-4000-8000-000000000001','Fictional linked employee','aa000000-0000-4000-8000-000000000001');
set local role authenticated;
select change_master_data_lifecycle('employees','af000000-0000-4000-8000-000000000001','archive',0,'Employee stops work');
select pg_temp.check_true((select is_active and role='OWNER' from profiles where id='aa000000-0000-4000-8000-000000000001'),'employee inactive does not revoke login');
select pg_temp.must_fail('select change_master_data_lifecycle(''employees'',''af000000-0000-4000-8000-000000000001'',''trash'',1,''account binding'')','pemakaian atau riwayat');
-- Branch selection cannot mutate employee records from a different branch.
set local request.headers='{"x-kamo-operational-branch":"ab000000-0000-4000-8000-000000000099"}';
select pg_temp.must_fail('select change_master_data_lifecycle(''employees'',''ac000000-0000-4000-8000-000000000001'',''activate'',6,''wrong branch'')','Cabang karyawan');
reset role;
-- Physical deletion is also blocked for elevated legacy cleanup helpers.
select pg_temp.must_fail('delete from items where id=''ac000000-0000-4000-8000-000000000002''','Penghapusan permanen');
select pg_temp.must_fail('delete from master_data_lifecycle_audit','Audit aksi master');
-- Preserve the existing category-specific atomic removal/replacement contract.
insert into item_categories(id,name) values('be000000-0000-4000-8000-000000000001','Fictional category source'),('be000000-0000-4000-8000-000000000002','Fictional category target'),('be000000-0000-4000-8000-000000000003','Fictional empty category');
update items set category_id='be000000-0000-4000-8000-000000000001' where code='REF-MASTER';
set local request.headers='{}';
set local role authenticated;
select pg_temp.must_fail('select remove_item_category(''be000000-0000-4000-8000-000000000001'',null)','Kategori masih dipakai');
select remove_item_category('be000000-0000-4000-8000-000000000003',null);
select remove_item_category('be000000-0000-4000-8000-000000000001','be000000-0000-4000-8000-000000000002');
select pg_temp.check_true((select category_id='be000000-0000-4000-8000-000000000002' from items where code='REF-MASTER'),'existing category replacement remains atomic and explicit');
reset role;
-- An injected final audit failure must roll back the lifecycle mutation too.
create function pg_temp.reject_audit() returns trigger language plpgsql as $$begin raise exception 'injected audit failure';end $$;
create trigger zz_reject_audit before insert on master_data_lifecycle_audit for each row execute function pg_temp.reject_audit();
set local request.headers='{}';
set local role authenticated;
select pg_temp.must_fail('select change_master_data_lifecycle(''brands'',''ae000000-0000-4000-8000-000000000001'',''restore'',1,''audit rollback'')','injected audit failure');
select pg_temp.check_true((select trashed_at is not null and lifecycle_revision=1 from brands where id='ae000000-0000-4000-8000-000000000001'),'audit failure rolls back status, trash and revision');
rollback;
