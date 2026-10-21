-- Administrative export is service-role only; ordinary app owners cannot dump private data.
create schema kamo_maintenance;
revoke all on schema kamo_maintenance from public,anon,authenticated,service_role;
create table kamo_maintenance.simulation_backups(
 id uuid primary key default gen_random_uuid(),requested_by uuid not null,
 created_at timestamptz not null default now(),snapshot jsonb not null,sha256 text not null,
 manifest jsonb not null,verified_at timestamptz,restore_receipt jsonb,
 reset_at timestamptz,reset_result jsonb
);
alter table kamo_maintenance.simulation_backups enable row level security;
revoke all on kamo_maintenance.simulation_backups from public,anon,authenticated,service_role;

create function kamo_maintenance.public_snapshot() returns jsonb
language plpgsql security invoker set search_path='' set timezone='UTC' set datestyle='ISO,YMD' as $$
declare t record;v_rows jsonb;v_columns jsonb;v_constraints jsonb;v_triggers jsonb;
 v_data jsonb:='{}';v_schema jsonb:='[]';v_sequences jsonb:='[]';v_sequence jsonb;v_auth_ids jsonb;
begin
 for t in select c.oid,c.relname,c.relkind from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') order by c.relname loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from only public.%I r',t.relname) into v_rows;
  select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by a.attnum),'[]') into v_columns
   from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped;
  select coalesce(jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'definition',pg_catalog.pg_get_constraintdef(c.oid,true),'validated',c.convalidated) order by c.conname),'[]') into v_constraints from pg_catalog.pg_constraint c where c.conrelid=t.oid;
  select coalesce(jsonb_agg(jsonb_build_object('name',g.tgname,'enabled',g.tgenabled,'definition',pg_catalog.pg_get_triggerdef(g.oid,true)) order by g.tgname),'[]') into v_triggers from pg_catalog.pg_trigger g where g.tgrelid=t.oid and not g.tgisinternal;
  v_data:=v_data||jsonb_build_object(t.relname,v_rows);
  v_schema:=v_schema||jsonb_build_array(jsonb_build_object('name',t.relname,'kind',t.relkind,'columns',v_columns,'constraints',v_constraints,'triggers',v_triggers));
 end loop;
 for t in select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S' order by c.relname loop
  execute format('select jsonb_build_object(''name'',%L,''last_value'',last_value,''is_called'',is_called) from public.%I',t.relname,t.relname) into v_sequence;
  v_sequences:=v_sequences||jsonb_build_array(v_sequence);
 end loop;
 select coalesce(jsonb_agg(id order by id),'[]') into v_auth_ids from auth.users;
 return jsonb_build_object('format_version',1,'project_ref','koaglxcyjqfmgfzxszkj','schema',v_schema,'tables',v_data,'sequences',v_sequences,'auth_ids',v_auth_ids);
end$$;
revoke all on function kamo_maintenance.public_snapshot() from public,anon,authenticated,service_role;

create function kamo_maintenance.snapshot_manifest(p_snapshot jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object(
  'schema_sha256',encode(sha256(convert_to((p_snapshot->'schema')::text,'UTF8')),'hex'),
  'sequences_sha256',encode(sha256(convert_to((p_snapshot->'sequences')::text,'UTF8')),'hex'),
  'auth_ids_sha256',encode(sha256(convert_to((p_snapshot->'auth_ids')::text,'UTF8')),'hex'),
  'tables',coalesce((select jsonb_object_agg(key,jsonb_build_object('count',jsonb_array_length(value),'sha256',encode(sha256(convert_to(value::text,'UTF8')),'hex'))) from jsonb_each(p_snapshot->'tables')),'{}'::jsonb)
 )
$$;
revoke all on function kamo_maintenance.snapshot_manifest(jsonb) from public,anon,authenticated,service_role;

create function public.prepare_simulation_backup(p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare v_snapshot jsonb;v_manifest jsonb;v_sha text;v_id uuid;v_tables text;
begin
 perform 1 from public.profiles where id=p_actor_id and is_active and role='OWNER' for share;
 if not found then raise exception 'An active application owner is required';end if;
 select string_agg(format('public.%I',c.relname),',' order by c.relname) into v_tables from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p');
 if v_tables is null then raise exception 'Public application schema not found';end if;
 lock table auth.users in share mode;
 execute 'lock table '||v_tables||' in share mode';
 v_snapshot:=kamo_maintenance.public_snapshot();v_manifest:=kamo_maintenance.snapshot_manifest(v_snapshot);
 v_sha:=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
 insert into kamo_maintenance.simulation_backups(requested_by,snapshot,sha256,manifest) values(p_actor_id,v_snapshot,v_sha,v_manifest) returning id into v_id;
 return jsonb_build_object('backup_id',v_id,'sha256',v_sha,'manifest',v_manifest);
end$$;
revoke all on function public.prepare_simulation_backup(uuid) from public,anon,authenticated,service_role;
grant execute on function public.prepare_simulation_backup(uuid) to service_role;

create function public.download_simulation_backup(p_backup_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b kamo_maintenance.simulation_backups%rowtype;
begin
 select * into b from kamo_maintenance.simulation_backups where id=p_backup_id;
 if not found then raise exception 'Backup not found';end if;
 return jsonb_build_object('backup_id',b.id,'sha256',b.sha256,'document',b.snapshot::text,'manifest',b.manifest);
end$$;
revoke all on function public.download_simulation_backup(uuid) from public,anon,authenticated,service_role;
grant execute on function public.download_simulation_backup(uuid) to service_role;

create function public.verify_simulation_backup(p_backup_id uuid,p_sha256 text,p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b kamo_maintenance.simulation_backups%rowtype;
begin
 select * into b from kamo_maintenance.simulation_backups where id=p_backup_id for update;
 if not found or b.sha256 is distinct from p_sha256 or p_receipt->'manifest' is distinct from b.manifest
  or p_receipt->>'constraints_validated' is distinct from 'true'
  or p_receipt->>'isolation_host' is distinct from '127.0.0.1'
  or coalesce(p_receipt->>'isolation_database','') !~ '^vetos_restore_[a-z0-9_]+$' then raise exception 'Isolated restore verification does not match this backup';end if;
 if b.verified_at is null then update kamo_maintenance.simulation_backups set verified_at=now(),restore_receipt=p_receipt where id=b.id;end if;
 return jsonb_build_object('backup_id',b.id,'sha256',b.sha256,'verified',true);
end$$;
revoke all on function public.verify_simulation_backup(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.verify_simulation_backup(uuid,text,jsonb) to service_role;
