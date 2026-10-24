-- Extend the same immutable index for natural/composite IDs, nested source
-- associations and conservative source-specific reader restrictions.
alter table public.activity_log_sources
 add column identity_keys text[] not null default array['id'],
 add column branch_columns text[] not null default '{}',
 add column scope_parents jsonb not null default '[]',
 add column metadata_only boolean not null default false,
 add column reader_roles text[] not null default array['OWNER','ADMIN'],
 add column owner_column text,
 add column module_column text,
 add column module_map jsonb not null default '{}';
alter table public.activity_log
 add column reader_roles text[] not null default array['OWNER','ADMIN'],
 add column owner_required boolean not null default false,
 add column owner_ids uuid[] not null default '{}',
 add column related_objects jsonb not null default '[]',
 add column required_modules text[] not null default '{}';
create index activity_log_source_page on public.activity_log(row_entity,row_id,id desc);

-- Generated lookup indexes use only previously recorded facts for older events.
-- This is not a historical backfill from live source data or a payload rewrite.
create function public.activity_log_object_refs(p_entity text,p_ids text[],p_row_entity text,p_row_id text,p_related jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(o order by o->>'entity',o->>'id'),'[]') from (
  select distinct o from (
   select jsonb_build_object('entity',p_entity,'id',v) o from unnest(p_ids) v
   union all select jsonb_build_object('entity',p_row_entity,'id',p_row_id)
   union all select value from jsonb_array_elements(p_related)
  ) objects where o->>'id' is not null and o->>'entity' is not null
 ) deduplicated;
$$;
create function public.activity_log_object_entities(p_entity text,p_ids text[],p_row_entity text,p_row_id text,p_related jsonb)
returns text[] language sql immutable set search_path='' as $$
 select coalesce(array_agg(distinct o->>'entity' order by o->>'entity'),'{}')
 from jsonb_array_elements(public.activity_log_object_refs(p_entity,p_ids,p_row_entity,p_row_id,p_related)) o;
$$;
revoke all on function public.activity_log_object_refs(text,text[],text,text,jsonb),public.activity_log_object_entities(text,text[],text,text,jsonb) from public,anon,authenticated,service_role;
alter table public.activity_log
 add column object_refs jsonb generated always as (public.activity_log_object_refs(entity,entity_ids,row_entity,row_id,related_objects)) stored,
 add column object_entities text[] generated always as (public.activity_log_object_entities(entity,entity_ids,row_entity,row_id,related_objects)) stored;
create index activity_log_object_refs on public.activity_log using gin(object_refs);
create index activity_log_object_entities on public.activity_log using gin(object_entities);

create function public.activity_log_reader_guard(p_source text,p_roles text[],p_owner_required boolean,p_owner_ids uuid[])
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.activity_log_sources c on c.entity=p_source
  where p.id=auth.uid() and p.is_active and p.role::text=any(p_roles) and p.role::text=any(c.reader_roles)
   and (not(p_owner_required or c.owner_column is not null)
    or (cardinality(p_owner_ids)>0 and not exists(select 1 from unnest(p_owner_ids) u where u is distinct from auth.uid()))));
$$;
revoke all on function public.activity_log_reader_guard(text,text[],boolean,uuid[]) from public,anon,service_role;
grant execute on function public.activity_log_reader_guard(text,text[],boolean,uuid[]) to authenticated;
drop policy activity_log_read on public.activity_log;
create policy activity_log_read on public.activity_log for select to authenticated using(
 module_id<>'__unmapped__' and not ('__unmapped__'=any(required_modules))
 and public.activity_log_readable(module_id,scope,branch_ids)
 and public.activity_log_reader_guard(row_entity,reader_roles,owner_required,owner_ids)
 and not exists(select 1 from unnest(required_modules) m where not public.activity_log_readable(m,'global','{}')));

create function public.activity_log_module(p_entity text,p_row jsonb)
returns text language sql stable security definer set search_path='' as $$
 select case when module_column is null then module_id else coalesce(module_map->>(p_row->>module_column),'__unmapped__') end
 from public.activity_log_sources where entity=p_entity;
$$;
revoke all on function public.activity_log_module(text,jsonb) from public,anon,authenticated,service_role;

create function public.activity_log_identity(p_entity text,p_row jsonb)
returns text language plpgsql stable security definer set search_path='' as $$
declare keys text[];result text;
begin
 select identity_keys into strict keys from public.activity_log_sources where entity=p_entity;
 if cardinality(keys)=1 then result:=p_row->>keys[1];else
  select jsonb_object_agg(k,p_row->k order by k)::text into result from unnest(keys) k;
 end if;
 if result is null or cardinality(keys)=0 or exists(select 1 from unnest(keys) k where p_row->>k is null) then raise exception 'Audit source identity is missing: %',p_entity;end if;
 return result;
end$$;
revoke all on function public.activity_log_identity(text,jsonb) from public,anon,authenticated,service_role;

-- Typed PK comparisons preserve indexes, including bigint, boolean and composite
-- keys. Only the private registry supplies relation/column identifiers.
create function public.activity_log_entity_row(p_entity text,p_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare keys text[];key_value jsonb;predicate text;result jsonb;
begin
 select identity_keys into strict keys from public.activity_log_sources where entity=p_entity;
 key_value:=case when cardinality(keys)=1 then jsonb_build_object(keys[1],p_id) else p_id::jsonb end;
 select string_agg(format('t.%I=k.%I',v,v),' and ') into predicate from unnest(keys) v;
 execute format('select to_jsonb(t) from public.%I t cross join jsonb_populate_record(null::public.%I,$1) k where %s',p_entity,p_entity,predicate)
 into result using key_value;
 return result;
end$$;
revoke all on function public.activity_log_entity_row(text,text) from public,anon,authenticated,service_role;

create function public.activity_log_merge_context(a jsonb,b jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare branches uuid[];roles text[];owners uuid[];objects jsonb;
begin
 select coalesce(array_agg(distinct v::uuid order by v::uuid),'{}') into branches from jsonb_array_elements_text((a->'branches')||(b->'branches')) v;
 select coalesce(array_agg(v order by v),'{}') into roles from (
  select jsonb_array_elements_text(a->'roles') v intersect select jsonb_array_elements_text(b->'roles') v
 ) r;
 select coalesce(array_agg(distinct v::uuid order by v::uuid),'{}') into owners from jsonb_array_elements_text((a->'owners')||(b->'owners')) v;
 select coalesce(jsonb_agg(v order by v::text),'[]') into objects from (select distinct value v from jsonb_array_elements((a->'objects')||(b->'objects'))) o;
 return a||jsonb_build_object('scope',case when a->>'scope'='all' or b->>'scope'='all' then 'all' when cardinality(branches)>0 then 'branches' else 'global' end,
  'branches',branches,'roles',roles,'owners',owners,'owner_required',coalesce((a->>'owner_required')::boolean,false) or coalesce((b->>'owner_required')::boolean,false),'objects',objects);
end$$;
revoke all on function public.activity_log_merge_context(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.activity_log_resolve(p_entity text,p_row jsonb,p_trail text[] default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.activity_log_sources%rowtype;id_value text;token text;ids uuid[]:='{}';scope_value text;ctx jsonb;parent_ctx jsonb;
 ref jsonb;refs jsonb;parent_row jsonb;parent_id text;branch_name text;owner_id uuid;found_ref boolean:=false;
begin
 select * into strict cfg from public.activity_log_sources where entity=p_entity;
 id_value:=public.activity_log_identity(p_entity,p_row);token:=p_entity||':'||id_value;
 scope_value:='global';
 if token=any(p_trail) or cardinality(p_trail)>24 then
  return jsonb_build_object('root_entity',p_entity,'root_id',id_value,'label',id_value,'scope','all','branches','[]'::jsonb,'roles','[]'::jsonb,'owners','[]'::jsonb,'owner_required',false,'objects',jsonb_build_array(jsonb_build_object('entity',p_entity,'id',id_value)));
 end if;
 if cfg.scope_kind='employee' then
  -- A null primary assignment already requires all-branch access in the
  -- existing master lifecycle. Every secondary assignment remains required.
  if p_row->>'branch_id' is null then scope_value:='all';else
   select array_agg(distinct v order by v) into ids from (
    select (p_row->>'branch_id')::uuid v union select branch_id from public.employee_branch_assignments where employee_id=(p_row->>'id')::uuid
   ) b;scope_value:='branches';
  end if;
 elsif cfg.scope_kind='account' then
  if p_row->>'branch_id' is not null then ids:=array[(p_row->>'branch_id')::uuid];scope_value:='branches';end if;
 elsif cfg.scope_kind not in ('refs','parent') then
  ids:=public.activity_log_scope(cfg.scope_kind,p_row);
  scope_value:=case when cfg.scope_kind='global' then 'global' when cardinality(ids)>0 then 'branches' else 'all' end;
 end if;
 foreach branch_name in array cfg.branch_columns loop
  if p_row->>branch_name is null then scope_value:='all';else ids:=array_append(ids,(p_row->>branch_name)::uuid);if scope_value<>'all' then scope_value:='branches';end if;end if;
 end loop;
 if cfg.owner_column is not null then owner_id:=(p_row->>cfg.owner_column)::uuid;end if;
 ctx:=jsonb_build_object('root_entity',p_entity,'root_id',id_value,'label',coalesce(p_row->>cfg.label_key,id_value),'scope',scope_value,
  'branches',ids,'roles',cfg.reader_roles,'owner_required',cfg.owner_column is not null,'owners',case when owner_id is null then '{}'::uuid[] else array[owner_id] end,
  'objects',jsonb_build_array(jsonb_build_object('entity',p_entity,'id',id_value)));
 refs:=cfg.scope_parents;
 if cfg.parent_entity is not null then refs:=refs||jsonb_build_array(jsonb_build_object('entity',cfg.parent_entity,'key',cfg.parent_key,'group',true));end if;
 for ref in select value from jsonb_array_elements(refs) loop
  if ref ? 'when_key' and p_row->>(ref->>'when_key') is distinct from ref->>'when_value' then continue;end if;
  parent_id:=p_row->>(ref->>'key');
  if parent_id is null then continue;end if;
  parent_row:=public.activity_log_entity_row(ref->>'entity',parent_id);
  if parent_row is not null then
   parent_ctx:=public.activity_log_resolve(ref->>'entity',parent_row,p_trail||token);
  else
   -- Parent BEFORE DELETE has already retained its actual scope and associations.
   select jsonb_build_object('root_entity',entity,'root_id',entity_id,'label',object_label,'scope',scope,'branches',branch_ids,'roles',reader_roles,'owners',owner_ids,'owner_required',owner_required,'objects',object_refs)
    into parent_ctx from public.activity_log where row_entity=ref->>'entity' and row_id=parent_id order by id desc limit 1;
   if parent_ctx is null and coalesce((ref->>'optional')::boolean,false) then continue;end if;
   if parent_ctx is null then
    parent_ctx:=jsonb_build_object('root_entity',ref->>'entity','root_id',parent_id,'label',parent_id,'scope','all','branches','[]'::jsonb,
     'roles',coalesce((select to_jsonb(reader_roles) from public.activity_log_sources where entity=ref->>'entity'),'[]'::jsonb),'owners','[]'::jsonb,'owner_required',true,'objects',jsonb_build_array(jsonb_build_object('entity',ref->>'entity','id',parent_id)));
   end if;
  end if;
  found_ref:=true;
  ctx:=public.activity_log_merge_context(ctx,parent_ctx);
  if coalesce((ref->>'group')::boolean,false) then ctx:=ctx||jsonb_build_object('root_entity',parent_ctx->>'root_entity','root_id',parent_ctx->>'root_id','label',parent_ctx->>'label');end if;
 end loop;
 if cfg.scope_kind in ('refs','parent') and not found_ref and cardinality(cfg.branch_columns)=0 then ctx:=jsonb_set(ctx,'{scope}','"all"');end if;
 return ctx;
end$$;
revoke all on function public.activity_log_resolve(text,jsonb,text[]) from public,anon,authenticated,service_role;

create or replace function public.activity_log_context(p_entity text,p_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;ctx jsonb;
begin
 r:=public.activity_log_entity_row(p_entity,p_id);
 if r is not null then return public.activity_log_resolve(p_entity,r);end if;
 select jsonb_build_object('root_entity',entity,'root_id',entity_id,'label',object_label,'scope',scope,'branches',branch_ids,'roles',reader_roles,'owners',owner_ids,'owner_required',owner_required,'objects',object_refs)
 into ctx from public.activity_log where row_entity=p_entity and row_id=p_id order by id desc limit 1;
 return coalesce(ctx,jsonb_build_object('root_entity',p_entity,'root_id',p_id,'label',p_id,'scope','all','branches','[]'::jsonb,'roles','[]'::jsonb,'owners','[]'::jsonb,'owner_required',true,'objects','[]'::jsonb));
end$$;

create or replace function public.capture_activity_log() returns trigger
language plpgsql security definer set search_path='' as $$
declare cfg public.activity_log_sources%rowtype;old_value jsonb:='{}';new_value jsonb:='{}';row_value jsonb;before_value jsonb;after_value jsonb;
 fields text[];ctx jsonb;old_ctx jsonb;id_value text;root_ids text[];branches uuid[];roles text[];owners uuid[];modules text[];event_module text;actor uuid;actor_label text;
begin
 select * into strict cfg from public.activity_log_sources where entity=tg_table_name;
 if tg_op<>'INSERT' then old_value:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then new_value:=to_jsonb(new);end if;
 select coalesce(array_agg(k order by k),'{}') into fields from (select jsonb_object_keys(old_value||new_value) k) keys
 where k<>all(array['created_at','updated_at']) and old_value->k is distinct from new_value->k;
 if tg_op='UPDATE' and cardinality(fields)=0 then return new;end if;
 row_value:=case when tg_op='DELETE' then old_value else new_value end;
 id_value:=public.activity_log_identity(cfg.entity,row_value);
 event_module:=public.activity_log_module(cfg.entity,row_value);modules:=array[event_module];
 if tg_op='UPDATE' then modules:=array_append(modules,public.activity_log_module(cfg.entity,old_value));end if;
 ctx:=public.activity_log_resolve(cfg.entity,row_value);
 root_ids:=array[ctx->>'root_id'];
 if tg_op='UPDATE' then
  old_ctx:=public.activity_log_resolve(cfg.entity,old_value);
  if old_ctx->>'root_entity'=ctx->>'root_entity' then root_ids:=array_append(root_ids,old_ctx->>'root_id');end if;
  ctx:=public.activity_log_merge_context(ctx,old_ctx);
 end if;
 select coalesce(array_agg(distinct v::uuid order by v::uuid),'{}') into branches from jsonb_array_elements_text(ctx->'branches') v;
 select coalesce(array_agg(v),'{}') into roles from jsonb_array_elements_text(ctx->'roles') v;
 select coalesce(array_agg(distinct v::uuid order by v::uuid),'{}') into owners from jsonb_array_elements_text(ctx->'owners') v;
 if cfg.metadata_only then fields:=array['metadata'];before_value:='{}';after_value:='{}';else
  select coalesce(jsonb_object_agg(k,v),'{}') into before_value from jsonb_each(old_value) e(k,v) where k=any(cfg.value_keys) and k=any(fields) and public.activity_log_safe_value(k,v);
  select coalesce(jsonb_object_agg(k,v),'{}') into after_value from jsonb_each(new_value) e(k,v) where k=any(cfg.value_keys) and k=any(fields) and public.activity_log_safe_value(k,v);
 end if;
 actor:=auth.uid();select full_name into actor_label from public.profiles where id=actor;
 insert into public.activity_log(actor_id,actor_name,actor_kind,module_id,entity,entity_id,entity_ids,object_label,row_entity,row_id,action,scope,branch_ids,changed_fields,before_state,after_state,reader_roles,owner_required,owner_ids,related_objects,required_modules)
 values(actor,coalesce(nullif(actor_label,''),case when actor is null then 'Sistem / database' else actor::text end),case when actor is null then 'system' else 'user' end,
 event_module,ctx->>'root_entity',ctx->>'root_id',root_ids,left(ctx->>'label',160),cfg.entity,id_value,case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
 ctx->>'scope',branches,fields,before_value,after_value,roles,(ctx->>'owner_required')::boolean,owners,ctx->'objects',modules);
 return coalesce(new,old);
end$$;

do $$declare f regprocedure;definition text;begin
 foreach f in array array['public.master_item_code_has_references(text)'::regprocedure,'public.master_data_has_references(text,uuid,text)'::regprocedure] loop
  definition:=pg_get_functiondef(f);
  if position('''activity_log'',''profiles''' in definition)=0 then raise exception 'Unexpected audit reference exclusion definition';end if;
  execute replace(definition,'''activity_log'',''profiles''','''activity_log'',''activity_log_sources'',''profiles''');
 end loop;
end$$;
