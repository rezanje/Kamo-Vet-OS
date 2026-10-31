begin;
create function pg_temp.a01_check(ok boolean,msg text) returns void language plpgsql as $$begin if ok is not true then raise exception '%',msg;end if;end$$;
-- Assert all remaining sources and trigger attachments exist, not just a viewer.
do $$declare t text;begin foreach t in array array['coa_accounts','cash_accounts','payment_account_map','budgets','budget_transfers','recurring_journals','accounting_locks','month_end_runs','asset_categories','tax_asset_categories','customer_categories','customer_review_statuses','promos','vouchers','category_discounts','pets','pet_ownership_transfers','promo_items','medical_records','prescription_items','inpatient_records','inpatient_daily_logs','inpatient_medications','inpatient_med_doses','compounding_recipes','compounding_ingredients','compound_formulas','compound_formula_versions','compound_issues','compound_official_usage','clinic_demo_policies','clinic_demo_invoice_snapshots','clinic_demo_incentive_allocations','bookings','branch_capacity_periods','consents','consent_templates','consent_rules','follow_ups','medical_equipment','medical_equipment_maintenance','visit_referrals','visit_operational_events','whatsapp_message_log','import_runs','import_run_rows','initial_stock_scope_mappings','document_attachments','accurate_inventory_accounting'] loop
 perform pg_temp.a01_check(exists(select 1 from activity_log_sources where entity=t and metadata_only),'Missing metadata source: '||t);
 perform pg_temp.a01_check((select count(*)=2 from pg_trigger where tgrelid=to_regclass('public.'||t) and tgname in('a01_activity_change','a01_activity_delete')),'Missing source trigger: '||t);
end loop;end$$;
insert into auth.users(id,raw_user_meta_data) values(md5('a01-rest-owner')::uuid,'{"full_name":"Remaining Owner"}'),(md5('a01-rest-admin')::uuid,'{"full_name":"Remaining Admin"}');
update profiles set role='OWNER',is_active=true where id=md5('a01-rest-owner')::uuid;
update profiles set role='ADMIN',is_active=true where id=md5('a01-rest-admin')::uuid;
insert into role_capabilities(role,all_branches) values('ADMIN',false) on conflict(role) do update set all_branches=false;
insert into branches(id,code,name,type) values(md5('a01-rest-a')::uuid,'A01-REST-A','PRIVATE BRANCH','KLINIK'),(md5('a01-rest-b')::uuid,'A01-REST-B','PRIVATE BRANCH','KLINIK');
insert into user_branches(user_id,branch_id) values(md5('a01-rest-admin')::uuid,md5('a01-rest-a')::uuid);
set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',md5('a01-rest-owner')::uuid::text,true);
insert into customers(id,name,phone) values(md5('a01-rest-customer')::uuid,'PRIVATE CUSTOMER','PRIVATE PHONE');
insert into pets(id,customer_id,name) values(md5('a01-rest-pet')::uuid,md5('a01-rest-customer')::uuid,'PRIVATE PET');
insert into employees(id,nama,jabatan,branch_id,status) values(md5('a01-rest-doctor')::uuid,'PRIVATE DOCTOR','Dokter',md5('a01-rest-a')::uuid,'Aktif');
insert into visits(id,branch_id,customer_id,pet_id,poli) values(md5('a01-rest-va')::uuid,md5('a01-rest-a')::uuid,md5('a01-rest-customer')::uuid,md5('a01-rest-pet')::uuid,'Umum'),(md5('a01-rest-vb')::uuid,md5('a01-rest-b')::uuid,md5('a01-rest-customer')::uuid,md5('a01-rest-pet')::uuid,'Umum');
insert into medical_records(id,visit_id,diagnosis,anamnesis) values(md5('a01-rest-mr')::uuid,md5('a01-rest-va')::uuid,'PRIVATE DIAGNOSIS','PRIVATE ANAMNESIS');
update medical_records set diagnosis='PRIVATE CHANGED DIAGNOSIS' where id=md5('a01-rest-mr')::uuid;
insert into prescription_items(id,medical_record_id,nama_obat,qty) values(md5('a01-rest-rx')::uuid,md5('a01-rest-mr')::uuid,'PRIVATE PRESCRIPTION',1);
-- Two-level reparent: source identity is retained under both visit histories,
-- and access to both branches is required for the update event.
update medical_records set visit_id=md5('a01-rest-vb')::uuid where id=md5('a01-rest-mr')::uuid;
select pg_temp.a01_check(exists(select 1 from activity_log where row_entity='medical_records' and action='update' and object_refs @> jsonb_build_array(jsonb_build_object('entity','visits','id',md5('a01-rest-va')::uuid::text),jsonb_build_object('entity','visits','id',md5('a01-rest-vb')::uuid::text)) and branch_ids @> array[md5('a01-rest-a')::uuid,md5('a01-rest-b')::uuid]),'Medical reparent lost associations/scope');
-- Nested cascade must keep source identity + original B scope after parents go.
delete from visits where id=md5('a01-rest-vb')::uuid;
select pg_temp.a01_check(exists(select 1 from activity_log where row_entity='prescription_items' and row_id=md5('a01-rest-rx')::uuid::text and action='delete' and scope='branches' and branch_ids=array[md5('a01-rest-b')::uuid]),'Clinical nested cascade lost branch or identity');
update visits set doctor_id=md5('a01-rest-doctor')::uuid where id=md5('a01-rest-va')::uuid;
insert into inpatient_records(id,branch_id,visit_id,treatment_plan) values(md5('a01-rest-inp')::uuid,md5('a01-rest-a')::uuid,md5('a01-rest-va')::uuid,'PRIVATE PLAN');
insert into inpatient_daily_logs(id,inpatient_record_id,condition_note) values(md5('a01-rest-daily')::uuid,md5('a01-rest-inp')::uuid,'PRIVATE DAILY');
insert into inpatient_medications(id,inpatient_record_id,nama_obat,frekuensi_per_hari,durasi_hari,mulai_tanggal) values(md5('a01-rest-med')::uuid,md5('a01-rest-inp')::uuid,'PRIVATE DOSE',1,1,current_date);
insert into inpatient_med_doses(id,medication_id,catatan) values(md5('a01-rest-dose')::uuid,md5('a01-rest-med')::uuid,'PRIVATE DOSE NOTE');
update inpatient_daily_logs set condition_note='PRIVATE DAILY CHANGE' where id=md5('a01-rest-daily')::uuid;
delete from inpatient_records where id=md5('a01-rest-inp')::uuid;
select pg_temp.a01_check(exists(select 1 from activity_log where row_entity='inpatient_med_doses' and action='delete' and object_refs @> jsonb_build_array(jsonb_build_object('entity','inpatient_records','id',md5('a01-rest-inp')::uuid::text))),'Three-level inpatient cascade lost object history');
insert into customer_categories(id,nama) values(md5('a01-rest-cat')::uuid,'PRIVATE CATEGORY');
update customer_categories set nama='PRIVATE CATEGORY CHANGE' where id=md5('a01-rest-cat')::uuid;
delete from customer_categories where id=md5('a01-rest-cat')::uuid;
insert into promos(id,name,promo_type,rule) values(md5('a01-rest-promo1')::uuid,'PRIVATE PROMO','diskon_produk','{}'),(md5('a01-rest-promo2')::uuid,'PRIVATE PROMO','diskon_produk','{}');
insert into items(id,code,name) values(md5('a01-rest-item')::uuid,'A01-REST-ITEM','PRIVATE ITEM');
insert into promo_items(promo_id,item_id) values(md5('a01-rest-promo1')::uuid,md5('a01-rest-item')::uuid);
update promo_items set promo_id=md5('a01-rest-promo2')::uuid where promo_id=md5('a01-rest-promo1')::uuid;
delete from promos where id=md5('a01-rest-promo2')::uuid;
select pg_temp.a01_check(exists(select 1 from activity_log where row_entity='promo_items' and action='update' and cardinality(entity_ids)=2),'CRM composite reparent lost history');
insert into import_runs(id,kind,source_name,source_hash,branch_id,created_by) values(md5('a01-rest-import')::uuid,'master_accurate','PRIVATE FILE','PRIVATE HASH',md5('a01-rest-a')::uuid,md5('a01-rest-owner')::uuid);
insert into import_run_rows(run_id,source_row,status,payload) values(md5('a01-rest-import')::uuid,1,'valid','{"name":"PRIVATE IMPORT ROW","secret":"PRIVATE SECRET"}');
update import_run_rows set payload='{"secret":"PRIVATE NEW SECRET"}' where run_id=md5('a01-rest-import')::uuid;
delete from import_runs where id=md5('a01-rest-import')::uuid;
select pg_temp.a01_check(exists(select 1 from activity_log where row_entity='import_run_rows' and action='delete' and row_id~'^\d+$' and branch_ids=array[md5('a01-rest-a')::uuid]),'Bigint import cascade identity/scope missing');
-- Global account + branch-B mapping must never appear in branch-A log.
insert into cash_accounts(id,nama,jenis,coa_code) values(md5('a01-rest-global-account')::uuid,'PRIVATE BANK','Bank','510001');
insert into payment_account_map(id,metode,branch_id,cash_account_id) values(md5('a01-rest-map')::uuid,'Transfer',md5('a01-rest-b')::uuid,md5('a01-rest-global-account')::uuid);
update payment_account_map set metode='PRIVATE METHOD' where id=md5('a01-rest-map')::uuid;
select pg_temp.a01_check(exists(select 1 from activity_log where row_entity='payment_account_map' and branch_ids=array[md5('a01-rest-b')::uuid]),'Payment map dropped own branch');
-- Polymorphic attachment source keeps known-parent history after source deletion
-- without copying filename, storage path or uploaded_by as audit actor.
insert into cash_entries(id,no_bukti,jenis,tanggal,account_id,lawan_code,jumlah,branch_id)
 values(md5('a01-rest-cash')::uuid,'A01-REST-CASH','Masuk',current_date,md5('a01-rest-global-account')::uuid,'510001',1,md5('a01-rest-b')::uuid);
insert into document_attachments(id,modul,ref_id,nama,path,uploaded_by)
 values(md5('a01-rest-attachment')::uuid,'pengeluaran',md5('a01-rest-cash')::uuid,'PRIVATE FILE','PRIVATE STORAGE',md5('a01-rest-admin')::uuid);
update document_attachments set nama='PRIVATE NEW FILE' where id=md5('a01-rest-attachment')::uuid;
delete from cash_entries where id=md5('a01-rest-cash')::uuid;
delete from document_attachments where id=md5('a01-rest-attachment')::uuid;
select pg_temp.a01_check((select count(*)=3 from activity_log where row_entity='document_attachments' and row_id=md5('a01-rest-attachment')::uuid::text and module_id='kas-bank' and branch_ids=array[md5('a01-rest-b')::uuid] and object_refs @> jsonb_build_array(jsonb_build_object('entity','cash_entries','id',md5('a01-rest-cash')::uuid::text))),'Attachment lost known-parent scope/history after deletion');
insert into document_attachments(id,modul,ref_id,nama,path) values(md5('a01-rest-unknown')::uuid,'UNKNOWN',md5('a01-rest-cash')::uuid,'PRIVATE FILE','PRIVATE STORAGE');
select pg_temp.a01_check(exists(select 1 from activity_log where row_entity='document_attachments' and row_id=md5('a01-rest-unknown')::uuid::text and module_id='__unmapped__' and scope='all'),'Unknown attachment must fail closed');
update company_settings set nama_perusahaan='PRIVATE COMPANY';
-- All minimum metadata uses a constant descriptor; not even clinical/private
-- column names, payload JSON, user-supplied business actors, or secrets leak.
select pg_temp.a01_check(not exists(select 1 from activity_log l join activity_log_sources c on c.entity=l.row_entity where c.metadata_only and (l.before_state<>'{}' or l.after_state<>'{}' or l.changed_fields<>array['metadata'])),'Metadata source persisted payload or private field names');
select pg_temp.a01_check(not exists(select 1 from activity_log where row_entity in ('medical_records','prescription_items','inpatient_records','inpatient_daily_logs','inpatient_medications','inpatient_med_doses','import_runs','import_run_rows','cash_accounts','payment_account_map','company_settings','document_attachments','promo_items','customer_categories','pets') and (before_state::text||after_state::text||object_label) like '%PRIVATE%'),'Sensitive raw values retained');
select pg_temp.a01_check(not exists(select 1 from activity_log where row_entity='medical_records' and (actor_id is distinct from md5('a01-rest-owner')::uuid or actor_name<>'Remaining Owner')),'Server actor missing');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('a01-rest-owner')::uuid::text,true);
do $$begin
 if exists(select 1 from activity_log where row_entity='document_attachments' and row_id=md5('a01-rest-unknown')::uuid::text) then raise exception 'Unknown attachment leaked to unrestricted OWNER';end if;
 if not exists(select 1 from activity_log where row_entity='document_attachments' and row_id=md5('a01-rest-attachment')::uuid::text and action='delete') then raise exception 'Known deleted attachment missing for OWNER';end if;
end$$;
select set_config('request.jwt.claim.sub',md5('a01-rest-admin')::uuid::text,true);
do $$begin
 if exists(select 1 from activity_log where row_entity='medical_records' and action='update' and cardinality(branch_ids)>1) then raise exception 'Medical before-value metadata crossed branch';end if;
 if exists(select 1 from activity_log where row_entity='document_attachments') then raise exception 'Attachment disclosed outside branch/module';end if;
 if exists(select 1 from activity_log where row_entity='payment_account_map' and row_id=md5('a01-rest-map')::uuid::text) then raise exception 'Payment mapping branch disclosure';end if;
 if not exists(select 1 from activity_log where row_entity='medical_records' and action='create') then raise exception 'Authorized medical metadata absent';end if;
end$$;
reset role;
-- An injected append denial must roll back even metadata-only source writes.
create function pg_temp.a01_rest_fail() returns trigger language plpgsql as $$begin if new.row_entity='customer_categories' then raise exception 'A01 metadata append denied';end if;return new;end$$;
create trigger a01_rest_fail before insert on activity_log for each row execute function pg_temp.a01_rest_fail();
do $$begin begin
 insert into customer_categories(id,nama) values(md5('a01-rest-rollback')::uuid,'PRIVATE ROLLBACK');raise exception 'Expected audit failure';
 exception when others then if sqlerrm<>'A01 metadata append denied' then raise;end if;end;
 if exists(select 1 from customer_categories where id=md5('a01-rest-rollback')::uuid) then raise exception 'Metadata-only source survived append denial';end if;
end$$;
rollback;
