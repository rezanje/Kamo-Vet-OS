begin;
-- Fictional HRIS/configuration acceptance; never use against a shared database.
create temporary table people_sources(entity text primary key) on commit drop;
insert into people_sources values
 ('employees'),('employee_branch_assignments'),('employee_import_details'),('attendance'),
 ('employee_schedules'),('leave_requests'),('overtime_requests'),('payrolls'),
 ('employee_salary_components'),('reimbursements'),('cash_advances'),('cash_advance_installments'),
 ('kpi_records'),('work_shifts'),('salary_components'),('payroll_settings'),('branches'),('warehouses'),
 ('profiles'),('user_branches'),('role_modules'),('role_capabilities'),('company_settings'),
 ('approval_rules'),('approval_requests'),('document_numbering'),('wa_engine_settings'),
 ('tier_settings'),('operational_alert_settings'),('commission_rules'),('sales_targets'),('notifications');
do $$begin
 if exists(select 1 from people_sources p left join public.activity_log_sources s using(entity)
  where s.entity is null or not s.metadata_only or s.label_key is not null or cardinality(s.value_keys)>0) then
  raise exception 'People/settings registration missing or retains payload';
 end if;
 if exists(select 1 from people_sources p join public.activity_log_sources s using(entity)
  where s.identity_keys is distinct from (
   select array_agg(a.attname::text order by k.ordinality)
   from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum,ordinality)
   join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
   where i.indisprimary and i.indrelid=('public.'||p.entity)::regclass
  )) then raise exception 'People/settings identity differs from actual primary key';end if;
 if exists(select 1 from people_sources p where
  (select count(*) from pg_trigger t where t.tgrelid=('public.'||p.entity)::regclass
   and t.tgname in ('a01_activity_change','a01_activity_delete') and not t.tgisinternal)<>2) then
  raise exception 'People/settings trigger missing';
 end if;
end$$;

insert into auth.users(id,raw_user_meta_data) values
 (md5('a01p-owner')::uuid,'{"full_name":"Fictional people owner"}'),
 (md5('a01p-admin')::uuid,'{"full_name":"Fictional people admin"}'),
 (md5('a01p-profile')::uuid,'{"full_name":"PRIVATE profile value"}'),
 (md5('a01p-configured-profile')::uuid,'{"full_name":"PRIVATE unconfigured profile"}');
update profiles set role='OWNER',is_active=true where id=md5('a01p-owner')::uuid;
update profiles set role='ADMIN',is_active=true where id=md5('a01p-admin')::uuid;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',md5('a01p-owner')::uuid::text,true);
insert into branches(id,code,name,type) values
 (md5('a01p-a')::uuid,'A01P-A','PRIVATE branch A','PETSHOP'),
 (md5('a01p-b')::uuid,'A01P-B','PRIVATE branch B','PETSHOP');
insert into employees(id,nik,nama,branch_id,gaji_pokok) values
 (md5('a01p-employee-a')::uuid,'A01P-A','PRIVATE employee A',md5('a01p-a')::uuid,12345),
 (md5('a01p-employee-b')::uuid,'A01P-B','PRIVATE employee B',md5('a01p-b')::uuid,12345);
insert into work_shifts(id,nama,is_libur,branch_id) values
 (md5('a01p-shift-a')::uuid,'PRIVATE shift',true,md5('a01p-a')::uuid),
 (md5('a01p-shift-b')::uuid,'PRIVATE shift',true,md5('a01p-b')::uuid);
insert into salary_components(id,nama,tipe) values(md5('a01p-component')::uuid,'PRIVATE salary component','tunjangan');
insert into cash_advances(id,employee_id,jumlah,tenor_bulan) values
 (md5('a01p-advance')::uuid,md5('a01p-employee-a')::uuid,100,1);

-- Exercise each row through real DML. JSON is a test fixture only; the helper
-- checks action capture, actual-PK identity, no-op saves and empty payloads.
create function pg_temp.people_exercise(p_entity text,p_insert jsonb,p_patch jsonb) returns void
language plpgsql as $$
declare cols text;vals text;sets text;keys jsonb;rid text;start_id bigint;n bigint;expected integer;actions text[];
begin
 select coalesce(max(id),0) into start_id from public.activity_log;
 select string_agg(format('%I',key),','),string_agg(format('x.%I',key),',') into cols,vals from jsonb_object_keys(p_insert) key;
 execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) x',p_entity,cols,vals,p_entity) using p_insert;
 select row_id into rid from public.activity_log where row_entity=p_entity and id>start_id and action='create' order by id desc limit 1;
 if rid is null then raise exception 'No create for %',p_entity;end if;
 select jsonb_object_agg(k,p_insert->k),cardinality(identity_keys) into keys,expected
 from public.activity_log_sources cross join lateral unnest(identity_keys) k where entity=p_entity group by identity_keys;
 if keys is null or (select count(*) from jsonb_object_keys(keys))<>expected or exists(select 1 from jsonb_each(keys) where value='null') then
  raise exception 'Fixture must supply full primary key for %',p_entity;end if;
 if expected>1 and exists(select 1 from jsonb_each_text(keys) where position(value in rid)=0) then
  raise exception 'Composite primary key incomplete for %',p_entity;end if;
 select string_agg(format('%I=x.%I',key,key),',') into sets from jsonb_object_keys(p_patch) key;
 execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) x where to_jsonb(t) @> $2',p_entity,sets,p_entity) using p_patch,keys;
 select count(*) into n from public.activity_log where row_entity=p_entity and id>start_id;
 if n<>2 then raise exception 'Expected create/update for %, got %',p_entity,n;end if;
 select jsonb_object_agg(k,(p_insert||p_patch)->k) into keys from public.activity_log_sources cross join lateral unnest(identity_keys) k where entity=p_entity;
 execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) x where to_jsonb(t) @> $2',p_entity,sets,p_entity) using p_patch,keys;
 if (select count(*) from public.activity_log where row_entity=p_entity and id>start_id)<>n then
  raise exception 'No-op save appended for %',p_entity;end if;
 if p_entity='employees' then
  begin
   execute format('delete from public.%I t where to_jsonb(t) @> $1',p_entity) using keys;
   raise exception 'Expected employee permanent-delete protection';
  exception when others then
   if position('Penghapusan permanen' in sqlerrm)=0 then raise;end if;
  end;
  actions:=array['create','update'];
 else
  execute format('delete from public.%I t where to_jsonb(t) @> $1',p_entity) using keys;
  actions:=array['create','update','delete'];
 end if;
 if (select array_agg(action order by id) from public.activity_log where row_entity=p_entity and id>start_id)<>actions then
  raise exception 'Action or retained delete identity missing for %',p_entity;end if;
 if exists(select 1 from public.activity_log where row_entity=p_entity and id>start_id
  and (before_state<>'{}' or after_state<>'{}' or changed_fields<>array['metadata'] or actor_id is distinct from md5('a01p-owner')::uuid)) then
  raise exception 'Payload, changed field or actor leak for %',p_entity;end if;
end$$;

select pg_temp.people_exercise('employees',jsonb_build_object('id',md5('a01p-crud-employee')::uuid,'nik','A01P-CRUD','nama','PRIVATE employee','branch_id',md5('a01p-a')::uuid,'gaji_pokok',12345),'{"nama":"PRIVATE edited employee","gaji_pokok":98765}');
select pg_temp.people_exercise('branches',jsonb_build_object('id',md5('a01p-crud-branch')::uuid,'code','A01P-CRUD','name','PRIVATE branch','type','PETSHOP'),'{"name":"PRIVATE edited branch","lat":12.345678}');
select pg_temp.people_exercise('warehouses',jsonb_build_object('id',md5('a01p-warehouse')::uuid,'branch_id',md5('a01p-a')::uuid,'code','A01P-WH','name','PRIVATE warehouse','type','RETAIL'),'{"name":"PRIVATE edited warehouse"}');
select pg_temp.people_exercise('employee_branch_assignments',jsonb_build_object('employee_id',md5('a01p-employee-a')::uuid,'branch_id',md5('a01p-b')::uuid,'role','SECONDARY','effective_date','2035-01-01'),'{"effective_date":"2035-01-02"}');
select pg_temp.people_exercise('employee_import_details',jsonb_build_object('employee_id',md5('a01p-employee-a')::uuid,'fields',jsonb_build_object('bank','PRIVATE BANK','phone','PRIVATE PHONE')),'{"fields":{"bank":"PRIVATE edited bank"}}');
select pg_temp.people_exercise('attendance',jsonb_build_object('id',md5('a01p-attendance')::uuid,'employee_id',md5('a01p-employee-a')::uuid,'tanggal','2035-01-01','keterangan','PRIVATE attendance'),'{"keterangan":"PRIVATE edited attendance"}');
select pg_temp.people_exercise('employee_schedules',jsonb_build_object('id',md5('a01p-schedule')::uuid,'employee_id',md5('a01p-employee-a')::uuid,'shift_id',md5('a01p-shift-b')::uuid,'tanggal','2035-01-01'),'{"tanggal":"2035-01-02"}');
select pg_temp.people_exercise('leave_requests',jsonb_build_object('id',md5('a01p-leave')::uuid,'employee_id',md5('a01p-employee-a')::uuid,'jenis','Sakit','tanggal_mulai','2035-01-01','alasan','PRIVATE leave'),'{"alasan":"PRIVATE edited leave"}');
select pg_temp.people_exercise('overtime_requests',jsonb_build_object('id',md5('a01p-overtime')::uuid,'employee_id',md5('a01p-employee-a')::uuid,'tanggal','2035-01-01','jam',1,'alasan','PRIVATE overtime'),'{"jam":2,"alasan":"PRIVATE edited overtime"}');
select pg_temp.people_exercise('payrolls',jsonb_build_object('id',md5('a01p-payroll')::uuid,'employee_id',md5('a01p-employee-a')::uuid,'periode','2035-01','total',12345,'catatan','PRIVATE payroll'),'{"total":98765,"catatan":"PRIVATE edited payroll"}');
select pg_temp.people_exercise('employee_salary_components',jsonb_build_object('id',md5('a01p-employee-component')::uuid,'employee_id',md5('a01p-employee-a')::uuid,'component_id',md5('a01p-component')::uuid,'nominal',12345),'{"nominal":98765}');
select pg_temp.people_exercise('reimbursements',jsonb_build_object('id',md5('a01p-reimburse')::uuid,'employee_id',md5('a01p-employee-a')::uuid,'kategori','PRIVATE category','jumlah',12345,'keterangan','PRIVATE reimburse'),'{"jumlah":98765,"keterangan":"PRIVATE edited reimburse"}');
select pg_temp.people_exercise('cash_advances',jsonb_build_object('id',md5('a01p-crud-advance')::uuid,'employee_id',md5('a01p-employee-a')::uuid,'jumlah',12345,'tenor_bulan',1,'alasan','PRIVATE advance'),'{"jumlah":98765,"alasan":"PRIVATE edited advance"}');
select pg_temp.people_exercise('cash_advance_installments',jsonb_build_object('id',md5('a01p-installment')::uuid,'advance_id',md5('a01p-advance')::uuid,'periode','2035-01','jumlah',12345),'{"jumlah":98765}');
select pg_temp.people_exercise('kpi_records',jsonb_build_object('id',md5('a01p-kpi')::uuid,'employee_id',md5('a01p-employee-a')::uuid,'periode','2035-01','metrik','PRIVATE metric','catatan','PRIVATE KPI'),'{"skor":98,"catatan":"PRIVATE edited KPI"}');
select pg_temp.people_exercise('work_shifts',jsonb_build_object('id',md5('a01p-crud-shift')::uuid,'nama','PRIVATE shift','is_libur',true,'branch_id',md5('a01p-a')::uuid),'{"nama":"PRIVATE edited shift"}');
select pg_temp.people_exercise('salary_components',jsonb_build_object('id',md5('a01p-crud-component')::uuid,'nama','PRIVATE component','tipe','tunjangan','nominal',12345),'{"nominal":98765,"nama":"PRIVATE edited component"}');
select pg_temp.people_exercise('user_branches',jsonb_build_object('user_id',md5('a01p-profile')::uuid,'branch_id',md5('a01p-a')::uuid),'{"effective_date":"2035-01-01"}');
select pg_temp.people_exercise('role_modules','{"role":"STAFF","module_id":"a01p-test"}','{"module_id":"a01p-updated"}');
delete from role_capabilities where role='FINANCE';
select pg_temp.people_exercise('role_capabilities','{"role":"FINANCE","all_branches":false}','{"create_accounts":true}');
delete from company_settings;
select pg_temp.people_exercise('company_settings','{"id":true,"nama_perusahaan":"PRIVATE COMPANY","npwp":"PRIVATE TAX","alamat":"PRIVATE ADDRESS"}','{"nama_perusahaan":"PRIVATE edited company","ppn_rate":12}');
delete from payroll_settings;
select pg_temp.people_exercise('payroll_settings','{"id":true,"telat_nominal_per_blok":12345}','{"telat_nominal_per_blok":98765}');
select pg_temp.people_exercise('approval_rules',jsonb_build_object('id',md5('a01p-approval-rule')::uuid,'jenis','PRIVATE rule','min_nilai',12345,'penyetuju_role','OWNER'),'{"min_nilai":98765}');
select pg_temp.people_exercise('approval_requests',jsonb_build_object('id',md5('a01p-approval')::uuid,'jenis','PRIVATE request','ref_id','PRIVATE REF','nilai',12345,'penyetuju_role','OWNER','keterangan','PRIVATE approval'),'{"catatan":"PRIVATE edited approval"}');
select pg_temp.people_exercise('document_numbering','{"jenis":"A01P-TEST","pola":"PRIVATE NUMBER","digit":3}','{"pola":"PRIVATE edited number","digit":4}');
delete from wa_engine_settings;
select pg_temp.people_exercise('wa_engine_settings','{"id":true,"is_enabled":false}','{"is_enabled":true}');
delete from tier_settings;
select pg_temp.people_exercise('tier_settings','{"id":1,"bronze_min":0,"silver_min":1,"gold_min":2,"platinum_min":3}','{"silver_min":98765}');
select pg_temp.people_exercise('operational_alert_settings',jsonb_build_object('id',md5('a01p-alert')::uuid,'rule_key','sales_below_target','branch_id',md5('a01p-a')::uuid,'threshold',12345,'severity','red'),'{"threshold":98765}');
select pg_temp.people_exercise('commission_rules',jsonb_build_object('id',md5('a01p-commission')::uuid,'nama','PRIVATE commission','tipe','nominal','basis','omzet','nominal',12345,'employee_id',md5('a01p-employee-a')::uuid,'branch_id',md5('a01p-b')::uuid),'{"nominal":98765,"nama":"PRIVATE edited commission"}');
select pg_temp.people_exercise('sales_targets',jsonb_build_object('id',md5('a01p-target')::uuid,'periode','2035-01','target',12345,'employee_id',md5('a01p-employee-a')::uuid,'branch_id',md5('a01p-b')::uuid),'{"target":98765}');
select pg_temp.people_exercise('notifications',jsonb_build_object('id',md5('a01p-notification')::uuid,'title','PRIVATE notification','message','PRIVATE message','type','system'),'{"title":"PRIVATE edited notification","message":"PRIVATE edited message"}');
-- Profiles are born through the existing auth trigger and deleted by its FK.
update profiles set full_name='PRIVATE edited profile' where id=md5('a01p-profile')::uuid;
update profiles set full_name='PRIVATE edited profile' where id=md5('a01p-profile')::uuid;
delete from auth.users where id=md5('a01p-profile')::uuid;
do $$begin
 if (select array_agg(action order by id) from activity_log where row_entity='profiles' and row_id=md5('a01p-profile')::uuid::text)<>array['create','update','delete'] then raise exception 'Profile auth lifecycle capture missing';end if;
end$$;

-- Actual settings RPC captures the employee/profile/branch-assignment writes.
set local role authenticated;
do $$declare n bigint;begin
 select count(*) into n from activity_log;
 perform configure_employee_account(md5('a01p-configured-profile')::uuid,md5('a01p-employee-a')::uuid,'PRIVATE configured profile','STAFF',array[md5('a01p-a')::uuid]);
 if (select count(*) from activity_log)<>n+3 then raise exception 'Official account configuration capture incomplete';end if;
 select count(*) into n from activity_log;
 perform link_employee_account(md5('a01p-configured-profile')::uuid,md5('a01p-employee-a')::uuid);
 begin
  perform configure_employee_account(md5('a01p-configured-profile')::uuid,md5('a01p-employee-a')::uuid,'PRIVATE configured profile','STAFF',array[md5('a01p-a')::uuid]);
  raise exception 'Expected existing account rejection';
 exception when others then if sqlerrm<>'ACCOUNT_NOT_UNCONFIGURED' then raise;end if;end;
 if (select count(*) from activity_log)<>n then raise exception 'No-op/rejected account action appended activity';end if;
end$$;
-- Official master lifecycle preserves employee identity; hard delete stays denied.
select change_master_data_lifecycle('employees',md5('a01p-crud-employee')::uuid,'trash',0,'Fictional audit employee lifecycle');
select change_master_data_lifecycle('employees',md5('a01p-crud-employee')::uuid,'restore',1,'Fictional audit employee restore');
-- Official HRIS import + assignment RPCs, including exact retry/no-op behavior.
select import_employee_excel(jsonb_build_array(jsonb_build_object('nik','A01P-RPC','nama','PRIVATE RPC NAME','status','Aktif','details',jsonb_build_object('bank','PRIVATE RPC BANK'))),md5('a01p-a')::uuid);
do $$declare eid uuid;n bigint;begin
 select id into eid from employees where nik='A01P-RPC';
 perform assign_employee_secondary_branches(eid,array[md5('a01p-b')::uuid],'2035-01-01');
 select count(*) into n from activity_log;
 perform assign_employee_secondary_branches(eid,array[md5('a01p-b')::uuid],'2035-01-01');
 perform import_employee_excel(jsonb_build_array(jsonb_build_object('nik','A01P-RPC','nama','PRIVATE RPC NAME','status','Aktif','details',jsonb_build_object('bank','PRIVATE RPC BANK'))),md5('a01p-a')::uuid);
 if (select count(*) from activity_log)<>n then raise exception 'Official HRIS retry appended activity';end if;
end$$;
reset role;
-- Reparented HRIS line requires old + new employee branches and memberships.
insert into attendance(id,employee_id,tanggal) values(md5('a01p-reparent')::uuid,md5('a01p-employee-a')::uuid,'2035-02-01');
update attendance set employee_id=md5('a01p-employee-b')::uuid where id=md5('a01p-reparent')::uuid;
-- Real branch/shift cascades retain their removed assignment/shift scopes.
insert into branches(id,code,name,type) values(md5('a01p-c')::uuid,'A01P-C','PRIVATE branch C','PETSHOP');
insert into employees(id,nik,nama,branch_id) values(md5('a01p-cascade')::uuid,'A01P-CASCADE','PRIVATE cascade',md5('a01p-a')::uuid);
insert into employee_branch_assignments(employee_id,branch_id,role,effective_date) values(md5('a01p-cascade')::uuid,md5('a01p-c')::uuid,'SECONDARY','2035-01-01');
insert into work_shifts(id,nama,is_libur,branch_id) values(md5('a01p-cascade-shift')::uuid,'PRIVATE cascade shift',true,md5('a01p-c')::uuid);
insert into employee_schedules(id,employee_id,tanggal,shift_id) values(md5('a01p-cascade-schedule')::uuid,md5('a01p-cascade')::uuid,'2035-01-01',md5('a01p-cascade-shift')::uuid);
delete from branches where id=md5('a01p-c')::uuid;
-- A staff advance also requires its paying-account branch, and its installments
-- retain that scope after the advance is removed by the FK cascade.
insert into coa_accounts(code,name,type,normal_balance) values('11971','PRIVATE payroll bank','ASET','D');
insert into cash_accounts(id,nama,jenis,coa_code,branch_id) values
 (md5('a01p-account-b')::uuid,'PRIVATE payroll bank','Bank','11971',md5('a01p-b')::uuid);
insert into cash_advances(id,employee_id,jumlah,tenor_bulan,cash_account_id) values
 (md5('a01p-mixed-advance')::uuid,md5('a01p-employee-a')::uuid,100,1,md5('a01p-account-b')::uuid);
insert into cash_advance_installments(id,advance_id,periode,jumlah) values
 (md5('a01p-mixed-installment')::uuid,md5('a01p-mixed-advance')::uuid,'2035-02',100);
delete from cash_advances where id=md5('a01p-mixed-advance')::uuid;
-- The employee special scope includes every secondary assignment on later edits.
update employees set nama='PRIVATE updated RPC employee' where nik='A01P-RPC';
-- Actual branch scope, including employee/shift and employee/commission branches.
do $$begin
 if (select count(*) from activity_log where row_entity in ('cash_advances','cash_advance_installments')
  and row_id in (md5('a01p-mixed-advance')::uuid::text,md5('a01p-mixed-installment')::uuid::text)
  and scope='branches' and branch_ids @> array[md5('a01p-a')::uuid,md5('a01p-b')::uuid])<>4 then raise exception 'HRIS advance/account or installment cascade scope lost';end if;
 if not exists(select 1 from activity_log where row_entity='employees' and action='update'
  and row_id=(select id::text from employees where nik='A01P-RPC')
  and scope='branches' and branch_ids @> array[md5('a01p-a')::uuid,md5('a01p-b')::uuid]) then raise exception 'Secondary employee assignment scope lost';end if;
 if not exists(select 1 from activity_log where row_entity='attendance' and row_id=md5('a01p-reparent')::uuid::text and action='update'
  and entity_ids @> array[md5('a01p-employee-a')::uuid::text,md5('a01p-employee-b')::uuid::text]
  and scope='branches' and branch_ids @> array[md5('a01p-a')::uuid,md5('a01p-b')::uuid]) then raise exception 'Reparent HRIS association/scope lost';end if;
 if (select count(*) from activity_log where entity='employees' and entity_id=md5('a01p-cascade')::uuid::text and action='delete'
  and row_entity in ('employee_branch_assignments','employee_schedules')
  and scope='branches' and branch_ids @> array[md5('a01p-a')::uuid,md5('a01p-c')::uuid])<>2 then raise exception 'Branch/shift cascade scope/membership lost';end if;
 if not exists(select 1 from activity_log where row_entity='employee_branch_assignments' and action='delete'
  and row_id like '%'||md5('a01p-cascade')::uuid::text||'%' and branch_ids @> array[md5('a01p-c')::uuid]) then raise exception 'Deleted assignment branch lost';end if;
 if exists(select 1 from activity_log where (row_entity in ('commission_rules','sales_targets') or row_entity='employee_schedules' and row_id=md5('a01p-schedule')::uuid::text)
  and scope<>'branches') or exists(select 1 from activity_log where (row_entity in ('commission_rules','sales_targets') or row_entity='employee_schedules' and row_id=md5('a01p-schedule')::uuid::text)
  and not branch_ids @> array[md5('a01p-a')::uuid,md5('a01p-b')::uuid]) then raise exception 'Cross-reference branch dropped';end if;
 if exists(select 1 from activity_log a join people_sources p on p.entity=a.row_entity
  where before_state<>'{}' or after_state<>'{}' or changed_fields<>array['metadata'] or object_label like '%PRIVATE%' or row_id like '%PRIVATE%') then raise exception 'People/settings privacy leak';end if;
end$$;
-- ADMIN limited to A sees A-only activity and no B/mixed/all-scope configuration.
insert into user_branches(user_id,branch_id) values(md5('a01p-admin')::uuid,md5('a01p-a')::uuid);
insert into role_capabilities(role,all_branches) values('ADMIN',false) on conflict(role) do update set all_branches=false;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('a01p-admin')::uuid::text,true);
do $$begin
 if not exists(select 1 from activity_log where row_entity='attendance' and row_id=md5('a01p-attendance')::uuid::text) then raise exception 'Authorized A HRIS history absent';end if;
 if exists(select 1 from activity_log where not branch_ids<@array[md5('a01p-a')::uuid] or scope='all') then raise exception 'Limited ADMIN cross-branch/configuration disclosure';end if;
end$$;
select set_config('request.jwt.claim.sub',md5('a01p-owner')::uuid::text,true);
select set_config('request.headers',jsonb_build_object('x-kamo-operational-branch',md5('a01p-a')::uuid)::text,true);
do $$begin
 if exists(select 1 from activity_log where not branch_ids<@array[md5('a01p-a')::uuid] or scope='all') then raise exception 'Selected branch HRIS/configuration disclosure';end if;
end$$;
select set_config('request.headers','{}',true);
reset role;
delete from role_modules where role='ADMIN';
insert into role_modules(role,module_id) values('ADMIN','perusahaan');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('a01p-admin')::uuid::text,true);
do $$begin if exists(select 1 from activity_log where module_id in ('hris','pengaturan','penjualan')) then raise exception 'Revoked HRIS/settings module disclosure';end if;end$$;
reset role;
rollback;
