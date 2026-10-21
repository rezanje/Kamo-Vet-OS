-- Recoverable master-data trash. No physical deletion, FK unlink or stock mutation.
-- Application and migration must be reviewed/released together.
alter table public.suppliers add column is_active boolean not null default true;
do $$declare t text; begin
 foreach t in array array['employees','items','brands','suppliers','supplier_categories','units'] loop
  execute format('alter table public.%I add column trashed_at timestamptz, add column lifecycle_revision bigint not null default 0 check(lifecycle_revision>=0)',t);
 end loop;
end $$;

-- New-reference fences use indexed normalized labels, including large imports.
create index master_lifecycle_item_code on public.items(lower(btrim(code)));
create index master_lifecycle_unit_name on public.units(lower(btrim(nama)));

create table public.master_data_lifecycle_audit (
 id uuid primary key default gen_random_uuid(),
 entity text not null check(entity in ('employees','items','brands','suppliers','supplier_categories','units')),
 entity_id uuid not null,
 revision bigint not null,
 action text not null check(action in ('archive','activate','trash','restore')),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 actor_id uuid not null, -- no cascading FK: audit survives account maintenance
 branch_id uuid,
 before_state jsonb not null,
 after_state jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(entity,entity_id,revision)
);
alter table public.master_data_lifecycle_audit enable row level security;
create policy master_lifecycle_audit_read on public.master_data_lifecycle_audit for select to authenticated
 using(exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN'))
 and (branch_id is null or public.user_can_access_branch(branch_id)));
revoke all on public.master_data_lifecycle_audit from anon,authenticated;
grant select on public.master_data_lifecycle_audit to authenticated;

-- Stable code provenance is shared by trash eligibility and the rename guard.
-- A UUID-only FK does not freeze a code; only actual code-bearing evidence does.
create function public.master_item_code_has_references(p_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r record; used boolean;
begin
 if p_code is null then return false; end if;
 if exists(select 1 from public.import_run_rows where lower(btrim(source_code))=lower(btrim(p_code))) then return true; end if;
 for r in
  select c.oid::regclass relation,a.attname from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  where n.nspname='public' and c.relkind in ('r','p')
   and c.relname not in ('master_data_lifecycle_audit','profiles','user_branches','role_capabilities')
   and a.atttypid in ('json'::regtype,'jsonb'::regtype)
 loop
  execute format('select exists(select 1 from %s t cross join lateral jsonb_path_query(t.%I::jsonb, %L) j where lower(btrim(j #>> %L))=lower(btrim($1)))',r.relation,r.attname,'$.** ? (@.type() == "string")','{}')
   into used using p_code;
  if used then return true; end if;
 end loop;
 return false;
end $$;
revoke all on function public.master_item_code_has_references(text) from public,anon,authenticated,service_role;

-- Discover every incoming FK (including CASCADE/SET NULL). Also conservatively
-- inspect UUID and JSON snapshots without FKs, and unit labels stored as text.
-- Private helper; no browser-supplied relation or column is executed.
create function public.master_data_has_references(p_entity text,p_id uuid,p_label text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare r record; used boolean;
begin
 if p_entity='items' and public.master_item_code_has_references(p_label) then
  return true;
 end if;
 for r in
  select c.conrelid::regclass relation,a.attname
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
  where c.contype='f' and c.confrelid=to_regclass('public.'||p_entity)
 loop
  execute format('select exists(select 1 from %s where %I::text=$1)',r.relation,r.attname) into used using p_id::text;
  if used then return true; end if;
 end loop;
 for r in
  select c.oid::regclass relation,a.attname,a.atttypid
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  where n.nspname='public' and c.relkind in ('r','p')
   and c.relname not in ('master_data_lifecycle_audit','profiles','user_branches','role_capabilities')
   and (a.atttypid in ('json'::regtype,'jsonb'::regtype)
    or (a.atttypid='uuid'::regtype and not(c.relname=p_entity and a.attname='id')
     and not exists(select 1 from pg_catalog.pg_constraint k where k.contype='f' and k.conrelid=c.oid and a.attnum=any(k.conkey)))
    or (p_entity='units' and a.attname in ('unit','satuan','buy_unit','base_unit') and a.atttypid in ('text'::regtype,'varchar'::regtype)))
 loop
  if r.atttypid in ('json'::regtype,'jsonb'::regtype) then
   -- UUID snapshots are checked too; unit JSON labels are conservatively matched.
   execute format('select exists(select 1 from %s where position($1 in lower((%I::jsonb)::text))>0)',r.relation,r.attname)
    into used using p_id::text;
   if not used and p_entity='units' then
    execute format('select exists(select 1 from %s t cross join lateral jsonb_path_query(t.%I::jsonb, %L) j where lower(btrim(j #>> %L))=lower(btrim($1)))',r.relation,r.attname,'$.** ? (@.type() == "string")','{}')
     into used using p_label;
   end if;
  elsif r.atttypid='uuid'::regtype then
   execute format('select exists(select 1 from %s where %I=$1)',r.relation,r.attname) into used using p_id;
  else
   execute format('select exists(select 1 from %s where lower(btrim(%I))=lower(btrim($1)))',r.relation,r.attname) into used using p_label;
  end if;
  if used then return true; end if;
 end loop;
 return false;
end $$;
revoke all on function public.master_data_has_references(text,uuid,text) from public,anon,authenticated,service_role;

create function public.change_master_data_lifecycle(p_entity text,p_id uuid,p_action text,p_expected_revision bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_row jsonb; new_row jsonb; status_column text; active boolean; branch uuid;
begin
 if p_entity is null or p_entity<>all(array['employees','items','brands','suppliers','supplier_categories','units'])
  or p_action is null or p_action<>all(array['archive','activate','trash','restore'])
  or p_id is null or p_expected_revision is null or p_expected_revision<0
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'Identitas, versi dan alasan (3–500 karakter) wajib diisi';
 end if;
 if auth.role() is distinct from 'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN')) then
  raise exception 'Hanya OWNER/ADMIN aktif yang boleh mengubah master' using errcode='42501';
 end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update',p_entity) into old_row using p_id;
 if old_row is null then raise exception 'Master tidak ditemukan'; end if;
 -- Recheck after the target lock wait, then keep authorization stable until commit.
 perform 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN') for share;
 if not found then raise exception 'Akses master sudah dicabut' using errcode='42501'; end if;
 perform 1 from public.role_capabilities where role=(select role from public.profiles where id=auth.uid()) for share;
 perform 1 from public.user_branches where user_id=auth.uid() order by branch_id for share;
 branch:=(old_row->>'branch_id')::uuid;
 if p_entity='employees' and (
  (branch is null and not public.has_role_capability('all_branches'))
  or (branch is not null and not public.user_can_access_branch(branch))
  or exists(select 1 from public.employee_branch_assignments where employee_id=p_id and not public.user_can_access_branch(branch_id))
 ) then raise exception 'Cabang karyawan tidak dapat diakses' using errcode='42501'; end if;
 if (old_row->>'lifecycle_revision')::bigint<>p_expected_revision then
  raise exception 'Data sudah berubah. Muat ulang daftar sebelum mengulangi tindakan';
 end if;
 active:=case when p_entity='employees' then old_row->>'status'='Aktif' else (old_row->>'is_active')::boolean end;
 if p_action='restore' then
  if old_row->>'trashed_at' is null then raise exception 'Data tidak berada di Sampah'; end if;
 elsif old_row->>'trashed_at' is not null then
  raise exception 'Pulihkan data dari Sampah terlebih dahulu';
 elsif p_action='archive' and not active or p_action='activate' and active then
  raise exception 'Status data sudah berubah. Muat ulang daftar';
 end if;
 if p_action='trash' and ((p_entity='employees' and old_row->>'profile_id' is not null) or public.master_data_has_references(p_entity,p_id,case when p_entity='items' then old_row->>'code' else old_row->>'nama' end)) then
  raise exception 'Data masih memiliki pemakaian atau riwayat. Gunakan Nonaktifkan; riwayat dan relasi tetap disimpan';
 end if;
 status_column:=case when p_entity='employees' then 'status' else 'is_active' end;
 perform set_config('kamo.master_lifecycle',p_entity||':'||p_id::text,true);
 execute format('update public.%I set %I=$1::%s, trashed_at=$2, lifecycle_revision=lifecycle_revision+1 where id=$3 returning to_jsonb(%I.*)',p_entity,status_column,case when p_entity='employees' then 'text' else 'boolean' end,p_entity)
 into new_row using
  case when p_entity='employees' then (case when p_action='activate' then 'Aktif' else 'Nonaktif' end)::text else (p_action='activate')::text end,
  case when p_action='trash' then clock_timestamp() else null::timestamptz end,p_id;
 perform set_config('kamo.master_lifecycle','',true);
 insert into public.master_data_lifecycle_audit(entity,entity_id,revision,action,reason,actor_id,branch_id,before_state,after_state)
 values(p_entity,p_id,(new_row->>'lifecycle_revision')::bigint,p_action,btrim(p_reason),auth.uid(),branch,
  jsonb_build_object('active',active,'trashed_at',old_row->'trashed_at'),
  jsonb_build_object('active',p_action='activate','trashed_at',new_row->'trashed_at'));
 return jsonb_build_object('id',p_id,'revision',new_row->'lifecycle_revision','action',p_action);
end $$;
revoke all on function public.change_master_data_lifecycle(text,uuid,text,bigint,text) from public,anon,service_role;
grant execute on function public.change_master_data_lifecycle(text,uuid,text,bigint,text) to authenticated;

-- A caller cannot spoof the context setting: both context AND function-owner
-- execution are required. No SECURITY DEFINER on this trigger.
create function public.guard_master_data_lifecycle() returns trigger language plpgsql set search_path='' as $$
declare privileged boolean;
begin
 if tg_op='DELETE' then raise exception 'Penghapusan permanen master diblokir. Gunakan Sampah atau Nonaktifkan'; end if;
 if tg_op='INSERT' then
  if new.trashed_at is not null or new.lifecycle_revision<>0 then raise exception 'Metadata Sampah tidak boleh diisi langsung'; end if;
  return new;
 end if;
 privileged:=current_user=pg_get_userbyid((select proowner from pg_catalog.pg_proc where oid='public.change_master_data_lifecycle(text,uuid,text,bigint,text)'::regprocedure))
  and current_setting('kamo.master_lifecycle',true)=tg_table_name||':'||old.id::text;
 if not coalesce(privileged,false) and (
  new.trashed_at is distinct from old.trashed_at or new.lifecycle_revision is distinct from old.lifecycle_revision
  or (case when tg_table_name='employees' then to_jsonb(new)->'status' is distinct from to_jsonb(old)->'status'
      else to_jsonb(new)->'is_active' is distinct from to_jsonb(old)->'is_active' end)
 ) then raise exception 'Perubahan status wajib melalui aksi master dengan alasan dan versi'; end if;
 if old.trashed_at is not null and not coalesce(privileged,false) then raise exception 'Pulihkan data dari Sampah sebelum mengedit'; end if;
 return new;
end $$;

create function public.guard_used_unit_rename() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.nama is distinct from old.nama and public.master_data_has_references('units',old.id,old.nama) then
  raise exception 'Satuan sudah dipakai. Nama historis dipertahankan; buat satuan baru lalu nonaktifkan yang lama';
 end if;
 return new;
end $$;
revoke all on function public.guard_used_unit_rename() from public,anon,authenticated,service_role;
create trigger guard_used_unit_rename before update of nama on public.units for each row execute function public.guard_used_unit_rename();

-- The UPDATE already owns the item row lock. Code-reference writers lock the
-- same row, so a committed earlier reference is visible before rename is allowed.
create function public.guard_used_item_code_rename() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.code is distinct from old.code and public.master_item_code_has_references(old.code) then
  raise exception 'Kode SKU sudah memiliki riwayat berbasis kode. Kode lama dipertahankan; ubah nama atau nonaktifkan barang';
 end if;
 return new;
end $$;
revoke all on function public.guard_used_item_code_rename() from public,anon,authenticated,service_role;
create trigger guard_used_item_code_rename before update of code on public.items for each row execute function public.guard_used_item_code_rename();

-- Resolve code to identity before waiting, then lock/recheck by that identity.
-- A waiting writer must not silently accept the old code after an unused rename.
create function public.lock_master_item_code_references(p_codes text[]) returns void
language plpgsql security definer set search_path='' as $$
declare expected record; actual record; normalized text[];
begin
 select array_agg(distinct lower(btrim(c))) into normalized from unnest(p_codes) c where c is not null;
 for expected in select id,code from public.items where lower(btrim(code))=any(coalesce(normalized,array[]::text[])) order by id loop
  select code,trashed_at into actual from public.items where id=expected.id for key share;
  if not found or actual.code is distinct from expected.code then
   raise exception 'Kode SKU sudah berubah. Muat ulang sumber sebelum menyimpan referensi';
  end if;
  if actual.trashed_at is not null then raise exception 'Master berada di Sampah. Pulihkan sebelum membuat referensi baru'; end if;
 end loop;
end $$;
revoke all on function public.lock_master_item_code_references(text[]) from public,anon,authenticated,service_role;

-- Reference writers take a parent lock BEFORE checking trash, including RPCs
-- running with elevated permissions. Existing unchanged links remain usable for
-- historical corrections. Inactive parents retain their historical links.
create function public.guard_trashed_master_reference() returns trigger language plpgsql security definer set search_path='' as $$
declare value text; previous text; dead timestamptz; target text; token text; tokens text[]; reference_row record; label_column text; label_tokens text[];
begin
 value:=to_jsonb(new)->>tg_argv[1];
 if tg_op='UPDATE' then previous:=to_jsonb(old)->>tg_argv[1]; end if;
 if value is null or value is not distinct from previous then return new; end if;
 if tg_argv[0] in ('any_uuid','any_json') then
  if tg_argv[0]='any_json' then
   select array_agg(distinct m[1]) into tokens from regexp_matches(value,'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}','g') m;
  else tokens:=array[value]; end if;
  foreach token in array coalesce(tokens,array[]::text[]) loop
   foreach target in array array['employees','items','brands','suppliers','supplier_categories','units'] loop
    execute format('select trashed_at from public.%I where id=$1 for key share',target) into dead using token::uuid;
    if dead is not null then raise exception 'Master berada di Sampah. Pulihkan sebelum membuat referensi baru'; end if;
   end loop;
  end loop;
  if tg_argv[0]='any_json' then
   -- Import provenance may identify a SKU by code without an item UUID.
   -- Match whole canonical JSON strings, including escaped source labels.
   select array_agg(distinct lower(btrim(j #>> '{}'))) into label_tokens
    from jsonb_path_query(value::jsonb,'$.** ? (@.type() == "string")') j;
   perform public.lock_master_item_code_references(label_tokens);
   foreach target in array array['units'] loop
    label_column:=case when target='items' then 'code' else 'nama' end;
    for reference_row in execute format('select trashed_at from public.%I where lower(btrim(%I))=any($1) order by id for key share',target,label_column) using coalesce(label_tokens,array[]::text[]) loop
     if reference_row.trashed_at is not null then raise exception 'Master berada di Sampah. Pulihkan sebelum membuat referensi baru'; end if;
    end loop;
   end loop;
  end if;
 elsif tg_argv[0]='items_text' then
  perform public.lock_master_item_code_references(array[value]);
 elsif tg_argv[0]='units_text' then
  target:=case when tg_argv[0]='items_text' then 'items' else 'units' end;
  label_column:=case when tg_argv[0]='items_text' then 'code' else 'nama' end;
  for reference_row in execute format('select trashed_at from public.%I where lower(btrim(%I))=lower(btrim($1)) order by id for key share',target,label_column) using value loop
   if reference_row.trashed_at is not null then raise exception 'Master berada di Sampah. Pulihkan sebelum membuat referensi baru'; end if;
  end loop;
 else
  execute format('select trashed_at from public.%I where id=$1 for key share',tg_argv[0]) into dead using value::uuid;
 end if;
 if dead is not null then raise exception 'Master berada di Sampah. Pulihkan dan aktifkan sebelum dipakai'; end if;
 return new;
end $$;
revoke all on function public.guard_trashed_master_reference() from public,anon,authenticated,service_role;

create trigger master_ref_items_source_code before insert or update on public.import_run_rows for each row execute function public.guard_trashed_master_reference('items_text','source_code');

do $$declare t text; r record; begin
 foreach t in array array['employees','items','brands','suppliers','supplier_categories','units'] loop
  execute format('create trigger guard_master_lifecycle before insert or update or delete on public.%I for each row execute function public.guard_master_data_lifecycle()',t);
 end loop;
 for r in
  select distinct c.conrelid::regclass relation,target.relname target,a.attname
  from pg_catalog.pg_constraint c join pg_catalog.pg_class target on target.oid=c.confrelid
  join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
  where c.contype='f' and c.confrelid=any(array['public.employees'::regclass,'public.items'::regclass,'public.brands'::regclass,'public.suppliers'::regclass,'public.supplier_categories'::regclass,'public.units'::regclass])
 loop
  execute format('create trigger %I before insert or update on %s for each row execute function public.guard_trashed_master_reference(%L,%L)',
   'master_ref_'||r.target||'_'||r.attname,r.relation,r.target,r.attname);
 end loop;
 for r in
  select c.oid::regclass relation,a.attname from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  where n.nspname='public' and c.relkind in ('r','p') and a.attname in ('unit','satuan','buy_unit','base_unit')
   and a.atttypid in ('text'::regtype,'varchar'::regtype)
 loop
  execute format('create trigger %I before insert or update on %s for each row execute function public.guard_trashed_master_reference(%L,%L)',
   'master_ref_units_'||r.attname,r.relation,'units_text',r.attname);
 end loop;
 -- Non-FK UUID links and JSON request/provenance snapshots use the same fence.
 for r in
  select c.oid::regclass relation,a.attname,a.atttypid from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  where n.nspname='public' and c.relkind in ('r','p') and c.relname not in ('master_data_lifecycle_audit','profiles','user_branches','role_capabilities')
   and ((a.atttypid='uuid'::regtype and a.attname<>'id') or a.atttypid in ('json'::regtype,'jsonb'::regtype))
   and not exists(select 1 from pg_catalog.pg_constraint k where k.contype='f' and k.conrelid=c.oid and a.attnum=any(k.conkey))
 loop
  execute format('create trigger %I before insert or update on %s for each row execute function public.guard_trashed_master_reference(%L,%L)',
   'master_snapshot_'||r.attname,r.relation,case when r.atttypid='uuid'::regtype then 'any_uuid' else 'any_json' end,r.attname);
 end loop;
end $$;

create function public.immutable_master_lifecycle_audit() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Audit aksi master tidak boleh diubah atau dihapus'; end $$;
create trigger immutable_master_lifecycle_audit before update or delete on public.master_data_lifecycle_audit
 for each row execute function public.immutable_master_lifecycle_audit();
