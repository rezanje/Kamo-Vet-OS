begin;
do $$begin
 if not exists(select 1 from information_schema.columns where table_name='activity_log_sources' and column_name='identity_keys') then raise exception 'Composite/source scope framework missing';end if;
 if to_regprocedure('public.activity_log_identity(text,jsonb)') is null then raise exception 'Stable source identity missing';end if;
end$$;
-- The explicit registry is the capture boundary. Check every source against
-- the actual migrated catalog rather than assuming a UUID column named id.
do $$declare s public.activity_log_sources%rowtype;actual_keys text[];col text;ref jsonb;
 source_relation regclass;parent_relation regclass;local_type oid;parent_type oid;
begin
 -- 179 reviewed on 22 Oct, +6 later source migrations, +16 in 20261030110000.
 -- activity_audit_coverage.sql proves every other public table is explicitly excluded.
 if (select count(*) from public.activity_log_sources)<>201 then raise exception 'Expected the reviewed 201-source capture boundary';end if;
 for s in select * from public.activity_log_sources loop
  source_relation:=to_regclass('public.'||s.entity);
  if source_relation is null then raise exception 'Registered relation absent: %',s.entity;end if;
  select array_agg(a.attname::text order by k.ordinality) into actual_keys
   from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum,ordinality)
   join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
   where i.indisprimary and i.indrelid=source_relation;
  if actual_keys is null or s.identity_keys is distinct from actual_keys then raise exception 'Actual primary key mismatch: %',s.entity;end if;
  if not exists(select 1 from pg_trigger where tgrelid=source_relation and tgname='a01_activity_change'
   and tgfoid='public.capture_activity_log()'::regprocedure and tgtype=21 and tgenabled='O' and not tgisinternal)
   or not exists(select 1 from pg_trigger where tgrelid=source_relation and tgname='a01_activity_delete'
   and tgfoid='public.capture_activity_log()'::regprocedure and tgtype=11 and tgenabled='O' and not tgisinternal) then
   raise exception 'Missing or disabled row capture trigger: %',s.entity;
  end if;
  foreach col in array s.value_keys||case when s.label_key is null then '{}'::text[] else array[s.label_key] end loop
   if not exists(select 1 from pg_attribute where attrelid=source_relation and attname=col and attnum>0 and not attisdropped) then
    raise exception 'Snapshot/label column absent: %.%',s.entity,col;
   end if;
  end loop;
  foreach col in array s.branch_columns||case when s.owner_column is null then '{}'::text[] else array[s.owner_column] end loop
   if not exists(select 1 from pg_attribute where attrelid=source_relation and attname=col and atttypid='uuid'::regtype and attnum>0 and not attisdropped) then
    raise exception 'Branch/owner reference must be a UUID column: %.%',s.entity,col;
   end if;
  end loop;
  if s.reader_roles is null or not s.reader_roles<@array['OWNER','ADMIN'] or array_position(s.reader_roles,null) is not null then
   raise exception 'Unreviewed general audit reader role: %',s.entity;
  end if;
  -- Sources with no authenticated SELECT policy must not gain even metadata
  -- visibility through the security-definer audit writer.
  -- Refund request queues are read through OWNER/ADMIN office RPCs (no table grant,
  -- bank destination stays private); their metadata-only events were registered
  -- with those readers on purpose by 20261023193000 and 20261028140000.
  if cardinality(s.reader_roles)>0 and not (s.metadata_only and s.entity in ('sales_refund_requests','clinic_refund_requests')) and (
   exists(select 1 from unnest(s.identity_keys||s.value_keys||case when s.label_key is null then '{}'::text[] else array[s.label_key] end) k
    where not has_column_privilege('authenticated',source_relation,k,'SELECT')) or
   (select relrowsecurity from pg_class where oid=source_relation) and not exists(
    select 1 from pg_policy p where p.polrelid=source_relation and p.polcmd in ('r','*')
     and (0=any(p.polroles) or (select oid from pg_roles where rolname='authenticated')=any(p.polroles))
   )) then raise exception 'Audit would expose a source without authenticated SELECT: %',s.entity;end if;
  if jsonb_typeof(s.scope_parents)<>'array' then raise exception 'Scope references must be an array: %',s.entity;end if;
  for ref in select value from jsonb_array_elements(s.scope_parents||case when s.parent_entity is null then '[]'::jsonb else
   jsonb_build_array(jsonb_build_object('entity',s.parent_entity,'key',s.parent_key)) end) loop
   parent_relation:=to_regclass('public.'||(ref->>'entity'));
   if parent_relation is null or not exists(select 1 from public.activity_log_sources where entity=ref->>'entity' and cardinality(identity_keys)=1) then
    raise exception 'Scope parent must have a registered single-column identity: % -> %',s.entity,ref;
   end if;
   select atttypid into local_type from pg_attribute where attrelid=source_relation and attname=ref->>'key' and attnum>0 and not attisdropped;
   select a.atttypid into parent_type from public.activity_log_sources p join pg_attribute a
    on a.attrelid=parent_relation and a.attname=p.identity_keys[1] and a.attnum>0 and not a.attisdropped where p.entity=ref->>'entity';
   if local_type is null or local_type is distinct from parent_type then raise exception 'Scope reference type mismatch: % -> %',s.entity,ref;end if;
  end loop;
  if s.module_column is not null and (not exists(select 1 from pg_attribute where attrelid=source_relation and attname=s.module_column and attnum>0 and not attisdropped)
   or jsonb_typeof(s.module_map)<>'object' or s.module_map='{}') then raise exception 'Dynamic source module mapping invalid: %',s.entity;end if;
 end loop;
 if exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and t.tgname in ('a01_activity_change','a01_activity_delete') and not t.tgisinternal
   and not exists(select 1 from public.activity_log_sources registered where registered.entity=c.relname)) then raise exception 'Unregistered table has activity capture enabled';end if;
 if (select reader_roles from public.activity_log_sources where entity='inventory_month_closes') is distinct from array['OWNER'] then
  raise exception 'Inventory closing source cannot grant ADMIN audit visibility';end if;
 if exists(select 1 from public.activity_log_sources where entity in ('compound_issues','accurate_inventory_accounting',
  'sale_staff_effects','stock_document_issue_proofs','purchase_invoice_layer_proofs') and cardinality(reader_roles)>0) then
  raise exception 'Private proof source became audit-readable';end if;
end$$;
-- Stable natural/composite IDs contain identifiers only, never row payload.
do $$begin
 if activity_log_identity('company_settings','{"id":true,"secret":"PRIVATE"}')<>'true' then raise exception 'Boolean identity broken';end if;
 if activity_log_identity('role_modules','{"role":"ADMIN","module_id":"crm","secret":"PRIVATE"}')::jsonb<>'{"role":"ADMIN","module_id":"crm"}'::jsonb then raise exception 'Composite identity broken';end if;
 if activity_log_identity('import_run_rows','{"id":9007199254740993,"secret":"PRIVATE"}')<>'9007199254740993' then raise exception 'Large integer identity lost precision';end if;
 begin
  perform activity_log_identity('role_modules','{"role":"ADMIN"}');raise exception 'Expected incomplete composite identity rejection';
 exception when others then if position('Audit source identity is missing' in sqlerrm)=0 then raise;end if;end;
end$$;
-- Recorded reader roles can narrow current source restrictions, never broaden
-- them. Required owner identity also follows every old/new association.
insert into auth.users(id,raw_user_meta_data) values
 (md5('a01-contract-owner')::uuid,'{"full_name":"Fictional contract owner"}'),
 (md5('a01-contract-admin')::uuid,'{"full_name":"Fictional contract admin"}'),
 (md5('a01-contract-staff')::uuid,'{"full_name":"Fictional contract staff"}'),
 (md5('a01-contract-doctor')::uuid,'{"full_name":"Fictional contract doctor"}');
update profiles set role='OWNER',is_active=true where id=md5('a01-contract-owner')::uuid;
update profiles set role='ADMIN',is_active=true where id=md5('a01-contract-admin')::uuid;
update profiles set role='STAFF',is_active=true where id=md5('a01-contract-staff')::uuid;
update profiles set role='DOCTOR',is_active=true where id=md5('a01-contract-doctor')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',md5('a01-contract-owner')::uuid::text,true);
do $$begin
 if not public.activity_log_reader_guard('profiles',array['OWNER','ADMIN'],true,array[md5('a01-contract-owner')::uuid]) then raise exception 'Matching required owner rejected';end if;
 if public.activity_log_reader_guard('profiles',array['OWNER','ADMIN'],true,'{}')
  or public.activity_log_reader_guard('profiles',array['OWNER','ADMIN'],true,array[md5('a01-contract-owner')::uuid,md5('a01-contract-admin')::uuid]) then raise exception 'Missing/mixed required owners exposed';end if;
 if not public.activity_log_reader_guard('inventory_month_closes',array['OWNER'],false,'{}') then raise exception 'Existing OWNER closing reader rejected';end if;
 if public.activity_log_reader_guard('compound_issues',array['OWNER','ADMIN'],false,'{}') then raise exception 'Recorded roles broadened a private current source';end if;
end$$;
select set_config('request.jwt.claim.sub',md5('a01-contract-admin')::uuid::text,true);
do $$begin
 if not public.activity_log_reader_guard('profiles',array['OWNER','ADMIN'],false,'{}') then raise exception 'Existing ADMIN profile reader rejected';end if;
 if public.activity_log_reader_guard('inventory_month_closes',array['OWNER','ADMIN'],false,'{}')
  or public.activity_log_reader_guard('profiles',array['OWNER'],false,'{}') then raise exception 'Recorded/current reader intersection broadened';end if;
end$$;
do $$declare u uuid;begin
 foreach u in array array[md5('a01-contract-staff')::uuid,md5('a01-contract-doctor')::uuid] loop
  perform set_config('request.jwt.claim.sub',u::text,true);
  if public.activity_log_reader_guard('profiles',array['OWNER','ADMIN'],false,'{}')
   or public.activity_log_readable('pengaturan','global','{}') then raise exception 'New STAFF/DOCTOR general audit access';end if;
 end loop;
end$$;
reset role;
update profiles set is_active=false where id=md5('a01-contract-owner')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('a01-contract-owner')::uuid::text,true);
do $$begin if public.activity_log_reader_guard('profiles',array['OWNER','ADMIN'],false,'{}') then raise exception 'Disabled owner gained audit access';end if;end$$;
reset role;
rollback;
