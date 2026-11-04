-- Promo "Syarat -> Hasil" (Accurate-style trigger/reward), stage 2a: DEFINITION STORAGE ONLY.
--
-- Nothing here is active: the mode cannot be switched on until (1) the app that understands it is live and
-- (2) service_role/ops flips public.promo_release_flags('syarat_hasil'). The app's promoDiscountMode() THROWS on an
-- unknown mode, so activating a promo before the app ships would fail every checkout. Deploy order:
--   app first -> these migrations -> flip the release flag -> Owner/Admin activates promos.
--
-- Adds (additive, nothing installed is edited except two anchored patches that fail closed on drift):
--   * public.promo_release_flags (default OFF) + promo_release_enabled()
--   * strict rule validator promo_syarat_hasil_rule_problem()/_valid() + promos_discount_mode_valid extended
--   * promos guard trigger: mode immutable, edit-only-while-inactive, activation gated by the release flag,
--     below-HPP waiver is OWNER-only and stamped (who/when) by the database, no delete
--   * deferred target guard (promo_items mirror == syarat+hasil items, stock items, official units) for active promos
--   * append-only audit table promo_sh_audit
--   * RPCs save_promo_syarat_hasil / set_promo_syarat_hasil_active (Owner/Admin, stale-version token, advisory lock)
--   * legacy edit_promo refuses this mode (anchored patch, same pattern as QUANTITY_POOL_READONLY)
-- Clinic is excluded by design: no clinic code path reads promos.rule->'syarat_hasil'.
begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Release flags. Only the database owner / service_role can flip them (no RPC for tenants).
-- ---------------------------------------------------------------------------------------------
create table public.promo_release_flags(
 flag text primary key check(flag in('syarat_hasil','below_hpp','promo_picker')),
 enabled boolean not null default false,
 changed_at timestamptz not null default now(),
 changed_by uuid
);
insert into public.promo_release_flags(flag) values('syarat_hasil'),('below_hpp'),('promo_picker');
alter table public.promo_release_flags enable row level security;
revoke all on public.promo_release_flags from public,anon,authenticated,service_role;
grant select on public.promo_release_flags to authenticated;
grant select,update on public.promo_release_flags to service_role;
create policy promo_release_flags_read on public.promo_release_flags for select to authenticated using(public.is_promo_manager());
create function public.promo_release_flags_stamp() returns trigger language plpgsql set search_path='' as $$
begin
 new.flag:=old.flag;new.changed_at:=now();new.changed_by:=auth.uid();
 return new;
end$$;
revoke all on function public.promo_release_flags_stamp() from public,anon,authenticated,service_role;
create trigger promo_release_flags_stamp before update on public.promo_release_flags for each row execute function public.promo_release_flags_stamp();
create function public.promo_release_enabled(p_flag text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from public.promo_release_flags where flag=p_flag),false)
$$;
revoke all on function public.promo_release_enabled(text) from public,anon,authenticated,service_role;
grant execute on function public.promo_release_enabled(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Strict definition validator (shape only; masters are checked by the target guard).
--    rule = {discount_mode:'syarat_hasil', suggest?:text<=200, syarat_hasil:{version:1,repeat,syarat[1..8],hasil,below_hpp}}
--    syarat row  = {kind:'qty',min:1..99999,items:[{item_id,unit}..1..50]} | {kind:'nilai',min:1..99999999} (whole cart, no items)
--      (R1: how a sale's nilai is measured - each line at the lesser of qty x official price and what is actually charged - is defined and enforced in 20261106510000)
--    hasil       = {kind:'barang',items:[..1..20],reward_qty?:1..999,discount:{type:'nominal',value}|{type:'percent',value<=100,max_amount?}}
--    below_hpp   = {allowed:false} | {allowed:true,reason>=10 chars,ack_by:uuid,ack_at:iso} (ack_* stamped by the database)
-- ---------------------------------------------------------------------------------------------
create function public.promo_sh_int(j jsonb,lo numeric,hi numeric) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(j)='number' then (j#>>'{}')::numeric=trunc((j#>>'{}')::numeric) and (j#>>'{}')::numeric between lo and hi else false end
$$;
create function public.promo_sh_refs_problem(refs jsonb,max_items integer) returns text
language plpgsql immutable set search_path='' as $$
declare ref jsonb;seen text[]:='{}';k text;
begin
 if jsonb_typeof(refs)<>'array' or jsonb_array_length(refs)=0 then return 'daftar barang kosong';end if;
 if jsonb_array_length(refs)>max_items then return 'terlalu banyak barang (maks '||max_items||')';end if;
 for ref in select * from jsonb_array_elements(refs) loop
  if jsonb_typeof(ref)<>'object' or exists(select 1 from jsonb_object_keys(ref) x(key) where key<>all(array['item_id','unit']))
   or jsonb_typeof(ref->'item_id') is distinct from 'string' or jsonb_typeof(ref->'unit') is distinct from 'string'
   or ref->>'item_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or btrim(ref->>'unit')<>ref->>'unit' or length(ref->>'unit') not between 1 and 30 then
   return 'barang/satuan tidak valid';
  end if;
  k:=(ref->>'item_id')||'|'||(ref->>'unit');
  if k=any(seen) then return 'barang + satuan dobel';end if;
  seen:=seen||k;
 end loop;
 return null;
end$$;
create function public.promo_syarat_hasil_rule_problem(p_rule jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare sh jsonb;h jsonb;row jsonb;d jsonb;b jsonb;problem text;
begin
 if jsonb_typeof(p_rule) is distinct from 'object' then return 'SH_BAD_INPUT: rule bukan objek';end if;
 if p_rule->>'discount_mode' is distinct from 'syarat_hasil' then return 'SH_BAD_INPUT: discount_mode harus syarat_hasil';end if;
 if exists(select 1 from jsonb_object_keys(p_rule) x(key) where key<>all(array['discount_mode','suggest','syarat_hasil'])) then return 'SH_BAD_INPUT: kunci rule tidak dikenal';end if;
 if p_rule ? 'suggest' and (jsonb_typeof(p_rule->'suggest') is distinct from 'string' or length(p_rule->>'suggest')>200) then return 'SH_BAD_INPUT: suggest harus teks maks 200';end if;
 sh:=p_rule->'syarat_hasil';
 if jsonb_typeof(sh) is distinct from 'object' or exists(select 1 from jsonb_object_keys(sh) x(key) where key<>all(array['version','repeat','syarat','hasil','below_hpp'])) then return 'SH_BAD_INPUT: syarat_hasil tidak valid';end if;
 if sh->'version' is distinct from '1'::jsonb then return 'SH_BAD_INPUT: version harus 1';end if;
 if jsonb_typeof(sh->'repeat') is distinct from 'boolean' then return 'SH_BAD_INPUT: repeat harus boolean';end if;
 if jsonb_typeof(sh->'syarat') is distinct from 'array' or jsonb_array_length(sh->'syarat')=0 then return 'SH_EMPTY_SYARAT: promo tanpa syarat';end if;
 if jsonb_array_length(sh->'syarat')>8 then return 'SH_TOO_LARGE: syarat maksimal 8 baris';end if;
 for row in select * from jsonb_array_elements(sh->'syarat') loop
  if jsonb_typeof(row) is distinct from 'object' then return 'SH_ROW_INVALID: baris syarat bukan objek';end if;
  if row->>'kind'='qty' then
   if exists(select 1 from jsonb_object_keys(row) x(key) where key<>all(array['kind','min','items'])) then return 'SH_ROW_INVALID: kunci baris syarat tidak dikenal';end if;
   if not public.promo_sh_int(row->'min',1,99999) then return 'SH_ROW_INVALID: kuantitas minimum harus bilangan bulat 1..99999';end if;
   problem:=public.promo_sh_refs_problem(row->'items',50);
   if problem is not null then return 'SH_ROW_INVALID: syarat '||problem;end if;
  elsif row->>'kind'='nilai' then
   if exists(select 1 from jsonb_object_keys(row) x(key) where key<>all(array['kind','min'])) then return 'SH_ROW_INVALID: nilai belanja dihitung atas seluruh keranjang, tanpa daftar barang';end if;
   if not public.promo_sh_int(row->'min',1,99999999) then return 'SH_ROW_INVALID: nilai minimum harus bilangan bulat 1..99999999';end if;
  else
   return 'SH_ROW_INVALID: jenis syarat tidak dikenal';
  end if;
 end loop;
 h:=sh->'hasil';
 if jsonb_typeof(h) is distinct from 'object' then return 'SH_EMPTY_HASIL: promo tanpa hasil';end if;
 if exists(select 1 from jsonb_object_keys(h) x(key) where key<>all(array['kind','items','reward_qty','discount'])) then return 'SH_BAD_INPUT: kunci hasil tidak dikenal';end if;
 if h->>'kind' is distinct from 'barang' then return 'SH_BAD_INPUT: jenis hasil harus barang';end if;
 problem:=public.promo_sh_refs_problem(h->'items',20);
 if problem is not null then return 'SH_EMPTY_HASIL: hasil '||problem;end if;
 if h ? 'reward_qty' and not public.promo_sh_int(h->'reward_qty',1,999) then return 'SH_DISCOUNT_INVALID: jumlah barang hasil harus bilangan bulat 1..999';end if;
 d:=h->'discount';
 if jsonb_typeof(d) is distinct from 'object' then return 'SH_DISCOUNT_INVALID: diskon hasil tidak valid';end if;
 if d->>'type'='nominal' then
  if exists(select 1 from jsonb_object_keys(d) x(key) where key<>all(array['type','value'])) or not public.promo_sh_int(d->'value',1,99999999) then
   return 'SH_DISCOUNT_INVALID: diskon nominal harus bilangan bulat > 0 tanpa maksimum diskon';
  end if;
 elsif d->>'type'='percent' then
  if exists(select 1 from jsonb_object_keys(d) x(key) where key<>all(array['type','value','max_amount'])) or not public.promo_sh_int(d->'value',1,100) then
   return 'SH_DISCOUNT_INVALID: diskon persen harus bilangan bulat 1..100';
  end if;
  if d ? 'max_amount' and not public.promo_sh_int(d->'max_amount',1,99999999) then return 'SH_DISCOUNT_INVALID: maksimum diskon harus bilangan bulat > 0';end if;
 else
  return 'SH_DISCOUNT_INVALID: jenis diskon tidak dikenal';
 end if;
 b:=sh->'below_hpp';
 if jsonb_typeof(b) is distinct from 'object' or jsonb_typeof(b->'allowed') is distinct from 'boolean' then return 'SH_BELOW_HPP: below_hpp.allowed wajib boolean';end if;
 if b->'allowed'='false'::jsonb then
  if b<>'{"allowed":false}'::jsonb then return 'SH_BELOW_HPP: izin mati tidak boleh membawa alasan/ack';end if;
 else
  if exists(select 1 from jsonb_object_keys(b) x(key) where key<>all(array['allowed','reason','ack_by','ack_at']))
   or jsonb_typeof(b->'reason') is distinct from 'string' or length(btrim(b->>'reason'))<10 or length(b->>'reason')>200
   or jsonb_typeof(b->'ack_by') is distinct from 'string' or b->>'ack_by' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(b->'ack_at') is distinct from 'string' or b->>'ack_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
   return 'SH_BELOW_HPP: izin di bawah HPP butuh alasan (min. 10 karakter), ack_by dan ack_at';
  end if;
 end if;
 return null;
exception when others then
 return 'SH_BAD_INPUT: '||sqlstate;
end$$;
create function public.promo_syarat_hasil_rule_valid(p_rule jsonb) returns boolean
language sql immutable set search_path='' as $$select public.promo_syarat_hasil_rule_problem(p_rule) is null$$;
revoke all on function public.promo_sh_int(jsonb,numeric,numeric),public.promo_sh_refs_problem(jsonb,integer),
 public.promo_syarat_hasil_rule_problem(jsonb),public.promo_syarat_hasil_rule_valid(jsonb) from public,anon,service_role;
grant execute on function public.promo_sh_int(jsonb,numeric,numeric),public.promo_sh_refs_problem(jsonb,integer),
 public.promo_syarat_hasil_rule_problem(jsonb),public.promo_syarat_hasil_rule_valid(jsonb) to authenticated;

-- (row_no 0 = hasil, 1.. = syarat qty rows in order). Only call on a validated rule.
create function public.promo_sh_refs(p_rule jsonb) returns table(row_no integer,item_id uuid,unit text)
language sql immutable set search_path='' as $$
 select r.n::integer,(x->>'item_id')::uuid,x->>'unit'
 from jsonb_array_elements(p_rule->'syarat_hasil'->'syarat') with ordinality r(row,n),
  jsonb_array_elements(case when r.row->>'kind'='qty' then r.row->'items' else '[]'::jsonb end) x
 union all
 select 0,(x->>'item_id')::uuid,x->>'unit' from jsonb_array_elements(p_rule->'syarat_hasil'->'hasil'->'items') x
$$;
revoke all on function public.promo_sh_refs(jsonb) from public,anon,service_role;
grant execute on function public.promo_sh_refs(jsonb) to authenticated;

-- Masters referenced by a rule must be active stock items with an official unit.
create function public.promo_sh_targets_problem(p_rule jsonb) returns text
language sql stable security definer set search_path='' as $$
 select case
  when exists(select 1 from public.promo_sh_refs(p_rule) r where not exists(select 1 from public.items i where i.id=r.item_id and i.is_active and i.item_type='Persediaan'))
   then 'barang syarat/hasil harus ada, aktif, dan berjenis Persediaan'
  when exists(select 1 from public.promo_sh_refs(p_rule) r join public.items i on i.id=r.item_id
   where r.unit<>i.unit and not exists(select 1 from public.item_units u where u.item_id=i.id and u.unit=r.unit))
   then 'satuan bukan satuan resmi barang'
 end
$$;
revoke all on function public.promo_sh_targets_problem(jsonb) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. promos_discount_mode_valid: legacy expression kept verbatim, one alternative added.
--    Anchor: the live constraint must equal the one rebuilt from the reviewed 20261105020000 source text.
-- ---------------------------------------------------------------------------------------------
do $$
declare
 old_src constant text:=$src$
 (not(coalesce(rule,'{}') ?| array['quantity_pool','quantity_pool_scope'])
  or coalesce(rule->>'discount_mode'='quantity_pool',false)) and (
 coalesce(rule->>'discount_mode','per_unit')='per_unit'
 or coalesce(rule->>'discount_mode'='package_total' and discount_type='nominal' and min_qty>0,false)
 or coalesce(rule->>'discount_mode'='quantity_pool'
  and rule->'quantity_pool'='{"version":1,"unit":"PCS","normal_price":20000,"tiers":[{"qty":6,"total":110000},{"qty":2,"total":38000}]}'::jsonb
  and rule->>'quantity_pool_scope' in('bolt_800gr','cat_choize_adult')
  and auto_apply and discount_type='nominal' and discount_value>0
  and min_qty=2 and max_qty is null and kelipatan
  and (rule->>'unit' is null or upper(rule->>'unit')='PCS')
  and coalesce((rule->>'min_subtotal')::numeric,0)=0,false)
 )$src$;
 sh_src constant text:=$src$
 coalesce(rule->>'discount_mode'='syarat_hasil' and promo_type='bundling' and auto_apply
  and discount_type is null and discount_value is null and min_qty is null and max_qty is null
  and kelipatan=(rule#>>'{syarat_hasil,repeat}'='true')
  and public.promo_syarat_hasil_rule_valid(rule),false)$src$;
 live text;ref text;
begin
 select pg_get_constraintdef(oid) into live from pg_constraint where conrelid='public.promos'::regclass and conname='promos_discount_mode_valid';
 if live is null then raise exception 'PROMO_SH_DRIFT: promos_discount_mode_valid is missing';end if;
 create temp table promo_sh_check_reference(like public.promos) on commit drop;
 execute 'alter table pg_temp.promo_sh_check_reference add constraint promos_discount_mode_valid check ('||old_src||') not valid';
 select pg_get_constraintdef(oid) into ref from pg_constraint where conrelid='pg_temp.promo_sh_check_reference'::regclass and conname='promos_discount_mode_valid';
 if ref is distinct from live then raise exception 'PROMO_SH_DRIFT: promos_discount_mode_valid changed; review before release';end if;
 alter table public.promos drop constraint promos_discount_mode_valid;
 execute 'alter table public.promos add constraint promos_discount_mode_valid check (('||old_src||') or ('||sh_src||')) not valid';
end$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Audit trail (append-only; reads restricted like the other promo tables' history).
-- ---------------------------------------------------------------------------------------------
create table public.promo_sh_audit(
 id bigint generated always as identity primary key,
 promo_id uuid not null,
 at timestamptz not null default now(),
 actor uuid,
 actor_role text,
 action text not null check(action in('create','rule_change','activate','deactivate','below_hpp_on','below_hpp_off','branch_or_date_change')),
 details jsonb not null default '{}'
);
alter table public.promo_sh_audit enable row level security;
revoke all on public.promo_sh_audit from public,anon,authenticated,service_role;
grant select on public.promo_sh_audit to authenticated;
create policy promo_sh_audit_read on public.promo_sh_audit for select to authenticated using(public.is_promo_manager());
create function public.promo_sh_audit_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'PROMO_SH_AUDIT: append-only';end$$;
revoke all on function public.promo_sh_audit_immutable() from public,anon,authenticated,service_role;
create trigger promo_sh_audit_immutable before update or delete on public.promo_sh_audit for each row execute function public.promo_sh_audit_immutable();

-- ---------------------------------------------------------------------------------------------
-- 5. BEFORE guard on promos (mode lock, draft/active discipline, release flag, OWNER-only waiver stamping, no delete)
-- ---------------------------------------------------------------------------------------------
create function public.promo_sh_actor_is_owner() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER')
$$;
revoke all on function public.promo_sh_actor_is_owner() from public,anon,service_role;
grant execute on function public.promo_sh_actor_is_owner() to authenticated;

create function public.promo_sh_definition_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare was_sh boolean;is_sh boolean;old_sh jsonb;new_sh jsonb;old_allowed boolean;new_allowed boolean;activating boolean;
begin
 if tg_op='DELETE' then
  if coalesce(old.rule->>'discount_mode'='syarat_hasil',false) then
   raise exception 'PROMO_SH_NO_DELETE: promo Syarat-Hasil tidak boleh dihapus; nonaktifkan saja' using errcode='23514';
  end if;
  return old;
 end if;
 is_sh:=coalesce(new.rule->>'discount_mode'='syarat_hasil',false);
 was_sh:=tg_op='UPDATE' and coalesce(old.rule->>'discount_mode'='syarat_hasil',false);
 if not is_sh and not was_sh then return new;end if;
 if was_sh and not is_sh then raise exception 'PROMO_SH_MODE: mode Syarat-Hasil tidak boleh diubah' using errcode='23514';end if;
 if not was_sh and tg_op='UPDATE' then raise exception 'PROMO_SH_MODE: promo lama tidak boleh dijadikan Syarat-Hasil' using errcode='23514';end if;
 new_sh:=new.rule->'syarat_hasil';
 old_sh:=case when was_sh then old.rule->'syarat_hasil' end;
 new_allowed:=coalesce(new_sh#>>'{below_hpp,allowed}'='true',false);
 old_allowed:=coalesce(old_sh#>>'{below_hpp,allowed}'='true',false);
 activating:=new.is_active and (tg_op='INSERT' or not old.is_active);
 -- a live promo is never edited in place: deactivate, edit, re-activate (every activation re-checks everything)
 if tg_op='UPDATE' and old.is_active and new.is_active and
  (new.rule is distinct from old.rule or new.branch_ids is distinct from old.branch_ids or new.valid_from is distinct from old.valid_from
   or new.valid_until is distinct from old.valid_until or new.name is distinct from old.name or new.auto_apply is distinct from old.auto_apply) then
  raise exception 'PROMO_SH_ACTIVE_EDIT: nonaktifkan promo dulu sebelum mengubah definisinya' using errcode='55000';
 end if;
 -- Below-HPP waiver: only an OWNER may switch it on or touch a rule that carries it. Who/when are stamped here, never trusted from the client.
 if auth.uid() is not null or current_setting('role',true) in('authenticated','anon') then
  if (new_allowed or old_allowed) and (new_sh is distinct from old_sh) and not (old_allowed and not new_allowed) then
   if not public.promo_sh_actor_is_owner() then
    raise exception 'PROMO_SH_OWNER_ONLY: izin penjualan di bawah HPP hanya boleh diatur oleh Owner' using errcode='42501';
   end if;
  end if;
  if new_allowed and (not old_allowed or new_sh->'below_hpp' is distinct from old_sh->'below_hpp') then
   new.rule:=jsonb_set(new.rule,'{syarat_hasil,below_hpp}',jsonb_build_object('allowed',true,'reason',new_sh#>'{below_hpp,reason}',
    'ack_by',auth.uid(),'ack_at',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  end if;
 end if;
 if activating then
  if not public.promo_release_enabled('syarat_hasil') then
   raise exception 'PROMO_SH_RELEASE: promo Syarat-Hasil belum dirilis; aplikasi harus live dan flag rilis dinyalakan dulu' using errcode='55000';
  end if;
  if new_allowed and not public.promo_release_enabled('below_hpp') then
   raise exception 'PROMO_SH_RELEASE: izin di bawah HPP belum dirilis' using errcode='55000';
  end if;
 end if;
 return new;
end$$;
revoke all on function public.promo_sh_definition_guard() from public,anon,authenticated,service_role;
create trigger promo_sh_guard before insert or update or delete on public.promos for each row execute function public.promo_sh_definition_guard();

create function public.promo_sh_audit_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();role_name text;old_sh jsonb;new_sh jsonb;
begin
 if new.rule->>'discount_mode' is distinct from 'syarat_hasil' then return null;end if;
 select role into role_name from public.profiles where id=actor;
 new_sh:=new.rule->'syarat_hasil';
 old_sh:=case when tg_op='UPDATE' then old.rule->'syarat_hasil' end;
 if tg_op='INSERT' then
  insert into public.promo_sh_audit(promo_id,actor,actor_role,action,details) values(new.id,actor,role_name,'create',
   jsonb_build_object('name',new.name,'rule_md5',md5(new_sh::text),'is_active',new.is_active));
  if new_sh#>>'{below_hpp,allowed}'='true' then
   insert into public.promo_sh_audit(promo_id,actor,actor_role,action,details) values(new.id,actor,role_name,'below_hpp_on',
    jsonb_build_object('reason',new_sh#>'{below_hpp,reason}','ack_by',new_sh#>'{below_hpp,ack_by}','ack_at',new_sh#>'{below_hpp,ack_at}'));
  end if;
  if new.is_active then
   insert into public.promo_sh_audit(promo_id,actor,actor_role,action,details) values(new.id,actor,role_name,'activate',
    jsonb_build_object('valid_from',new.valid_from,'valid_until',new.valid_until,'branch_ids',new.branch_ids));
  end if;
 else
  if new_sh is distinct from old_sh then
   insert into public.promo_sh_audit(promo_id,actor,actor_role,action,details) values(new.id,actor,role_name,'rule_change',
    jsonb_build_object('old_md5',md5(old_sh::text),'new_md5',md5(new_sh::text)));
  end if;
  if coalesce(new_sh#>>'{below_hpp,allowed}','false')<>coalesce(old_sh#>>'{below_hpp,allowed}','false') then
   insert into public.promo_sh_audit(promo_id,actor,actor_role,action,details) values(new.id,actor,role_name,
    case when new_sh#>>'{below_hpp,allowed}'='true' then 'below_hpp_on' else 'below_hpp_off' end,
    jsonb_build_object('reason',new_sh#>'{below_hpp,reason}','ack_by',new_sh#>'{below_hpp,ack_by}','ack_at',new_sh#>'{below_hpp,ack_at}'));
  end if;
  if new.is_active is distinct from old.is_active then
   insert into public.promo_sh_audit(promo_id,actor,actor_role,action,details) values(new.id,actor,role_name,
    case when new.is_active then 'activate' else 'deactivate' end,jsonb_build_object('valid_from',new.valid_from,'valid_until',new.valid_until,'branch_ids',new.branch_ids));
  end if;
  if new.branch_ids is distinct from old.branch_ids or new.valid_from is distinct from old.valid_from or new.valid_until is distinct from old.valid_until then
   insert into public.promo_sh_audit(promo_id,actor,actor_role,action,details) values(new.id,actor,role_name,'branch_or_date_change',
    jsonb_build_object('old',jsonb_build_object('branch_ids',old.branch_ids,'from',old.valid_from,'until',old.valid_until),
     'new',jsonb_build_object('branch_ids',new.branch_ids,'from',new.valid_from,'until',new.valid_until)));
  end if;
 end if;
 return null;
end$$;
revoke all on function public.promo_sh_audit_row() from public,anon,authenticated,service_role;
create trigger promo_sh_zaudit after insert or update on public.promos for each row execute function public.promo_sh_audit_row();

-- ---------------------------------------------------------------------------------------------
-- 6. Deferred target guard: an ACTIVE promo's promo_items must equal its syarat+hasil items
--    (an empty promo_items would mean "all items" to legacy readers) and every master must still be valid.
-- ---------------------------------------------------------------------------------------------
create function public.promo_sh_target_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare ids uuid[]:='{}';candidate uuid;p public.promos%rowtype;problem text;want uuid[];have uuid[];
begin
 if tg_table_name='promos' then ids:=array[new.id];
 else
  if tg_op<>'INSERT' then ids:=array[old.promo_id];end if;
  if tg_op<>'DELETE' then ids:=ids||new.promo_id;end if;
 end if;
 for candidate in select distinct u.id from unnest(ids) u(id) where u.id is not null order by u.id loop
  select * into p from public.promos where id=candidate for share;
  if found and p.is_active and p.rule->>'discount_mode'='syarat_hasil' then
   problem:=public.promo_syarat_hasil_rule_problem(p.rule);
   if problem is not null then raise exception 'PROMO_SH_RULE: %',problem using errcode='23514';end if;
   problem:=public.promo_sh_targets_problem(p.rule);
   if problem is not null then raise exception 'PROMO_SH_TARGET: %',problem using errcode='23514';end if;
   select coalesce(array_agg(distinct r.item_id order by r.item_id),'{}') into want from public.promo_sh_refs(p.rule) r;
   select coalesce(array_agg(t.item_id order by t.item_id),'{}') into have from public.promo_items t where t.promo_id=p.id;
   if want is distinct from have then raise exception 'PROMO_SH_TARGET: promo_items harus sama dengan barang syarat+hasil' using errcode='23514';end if;
  end if;
 end loop;
 return null;
end$$;
revoke all on function public.promo_sh_target_guard() from public,anon,authenticated,service_role;
create constraint trigger promo_sh_targets_header after insert or update on public.promos
 deferrable initially deferred for each row execute function public.promo_sh_target_guard();
create constraint trigger promo_sh_targets_items after insert or update or delete on public.promo_items
 deferrable initially deferred for each row execute function public.promo_sh_target_guard();

-- ---------------------------------------------------------------------------------------------
-- 7. Legacy editor refuses the new mode (anchored; fails closed on drift).
-- ---------------------------------------------------------------------------------------------
do $$
declare definition text;anchor text:=$anchor$if jsonb_typeof(p_values) is distinct from 'object' or not p_values ?& fields$anchor$;
begin
 definition:=pg_get_functiondef('public.edit_promo(uuid,text,jsonb,uuid[])'::regprocedure);
 if position('SYARAT_HASIL_READONLY' in definition)>0 then raise exception 'PROMO_SH_EDITOR: already patched';end if;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'PROMO_SH_EDITOR_DRIFT: edit_promo changed; review before release';
 end if;
 execute replace(definition,anchor,
  $guard$if existing.rule->>'discount_mode'='syarat_hasil' then
  raise exception 'SYARAT_HASIL_READONLY: saved Syarat-Hasil promo cannot be edited through legacy editor';
 end if;
 $guard$||anchor);
end$$;

-- ---------------------------------------------------------------------------------------------
-- 8. Atomic save / activate. Owner/Admin only (assert_promo_manager), stale-version token = promo_edit_snapshot().version,
--    one global advisory lock serialises definition changes (rare, human-driven) so duplicate/identical checks cannot race.
-- ---------------------------------------------------------------------------------------------
create function public.save_promo_syarat_hasil(p_id uuid,p_expected_version text,p_values jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.promos%rowtype;pid uuid:=p_id;new_rule jsonb;sh jsonb;below jsonb;problem text;branches uuid[];repeat_flag boolean;
 fields constant text[]:=array['name','suggest','branch_ids','valid_from','valid_until','repeat','syarat','hasil','below_hpp'];
begin
 perform public.assert_promo_manager();
 perform pg_advisory_xact_lock(hashtextextended('promo_syarat_hasil:definition',0));
 if jsonb_typeof(p_values) is distinct from 'object' or not p_values ?& fields
  or exists(select 1 from jsonb_object_keys(p_values) k where k<>all(fields)) then
  raise exception 'PROMO_SH_RULE: data promo tidak lengkap atau memuat kolom yang tidak diizinkan' using errcode='22023';
 end if;
 if jsonb_typeof(p_values->'name') is distinct from 'string' or length(btrim(p_values->>'name')) not between 1 and 120 then
  raise exception 'PROMO_SH_RULE: nama wajib diisi (maks. 120 karakter)' using errcode='22023';
 end if;
 below:=p_values->'below_hpp';
 if jsonb_typeof(below) is distinct from 'object' or jsonb_typeof(below->'allowed') is distinct from 'boolean'
  or exists(select 1 from jsonb_object_keys(below) k where k<>all(array['allowed','reason'])) then
  raise exception 'PROMO_SH_RULE: below_hpp harus {allowed, reason}' using errcode='22023';
 end if;
 if below->'allowed'='true'::jsonb and not public.promo_sh_actor_is_owner() then
  raise exception 'PROMO_SH_OWNER_ONLY: izin penjualan di bawah HPP hanya boleh diatur oleh Owner' using errcode='42501';
 end if;
 repeat_flag:=case when jsonb_typeof(p_values->'repeat')='boolean' then (p_values->>'repeat')::boolean end;
 if repeat_flag is null then raise exception 'PROMO_SH_RULE: repeat harus boolean' using errcode='22023';end if;
 if pid is null then
  if p_expected_version is not null then raise exception 'PROMO_SH_RULE: promo baru tidak memakai token versi' using errcode='22023';end if;
 else
  select * into existing from public.promos where id=pid for update;
  if not found or existing.rule->>'discount_mode' is distinct from 'syarat_hasil' then
   raise exception 'Promo tidak ditemukan atau bukan promo Syarat-Hasil' using errcode='42501';
  end if;
  if p_expected_version is null or public.promo_edit_snapshot(pid)->>'version' is distinct from p_expected_version then
   raise exception 'PROMO_EDIT_CONFLICT: Promo sudah berubah. Muat ulang data terbaru sebelum mengedit lagi.' using errcode='40001';
  end if;
  if existing.is_active then raise exception 'PROMO_SH_ACTIVE_EDIT: nonaktifkan promo dulu sebelum mengubah definisinya' using errcode='55000';end if;
 end if;
 -- ack_by/ack_at are placeholders here; the BEFORE trigger overwrites them with auth.uid()/now() whenever the waiver changes.
 new_rule:=jsonb_build_object('discount_mode','syarat_hasil','suggest',coalesce(nullif(btrim(p_values->>'suggest'),''),btrim(p_values->>'name')),
  'syarat_hasil',jsonb_build_object('version',1,'repeat',repeat_flag,'syarat',p_values->'syarat','hasil',p_values->'hasil',
   'below_hpp',case when below->'allowed'='true'::jsonb then jsonb_build_object('allowed',true,'reason',below->'reason',
     'ack_by',auth.uid(),'ack_at',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    else '{"allowed":false}'::jsonb end));
 -- keep an unchanged waiver's original ack (who/when) when the OWNER-approved block is resubmitted identically
 if pid is not null and existing.rule#>>'{syarat_hasil,below_hpp,allowed}'='true' and below->'allowed'='true'::jsonb
  and existing.rule#>'{syarat_hasil,below_hpp,reason}' is not distinct from below->'reason' then
  new_rule:=jsonb_set(new_rule,'{syarat_hasil,below_hpp}',existing.rule#>'{syarat_hasil,below_hpp}');
 end if;
 problem:=public.promo_syarat_hasil_rule_problem(new_rule);
 if problem is not null then raise exception 'PROMO_SH_RULE: %',problem using errcode='22023';end if;
 problem:=public.promo_sh_targets_problem(new_rule);
 if problem is not null then raise exception 'PROMO_SH_TARGET: %',problem using errcode='23514';end if;
 if jsonb_typeof(p_values->'branch_ids') not in('array','null') then raise exception 'Daftar cabang promo tidak valid' using errcode='22023';end if;
 select array_agg(distinct y.bid order by y.bid) into branches from jsonb_array_elements_text(coalesce(nullif(p_values->'branch_ids','null'::jsonb),'[]'::jsonb)) x(v) cross join lateral (select x.v::uuid bid) y;
 perform b.id from public.branches b where b.id=any(coalesce(branches,'{}')) order by b.id for share;
 if exists(select 1 from unnest(coalesce(branches,'{}')) c(id) where not exists(select 1 from public.branches b where b.id=c.id and b.is_active)) then
  raise exception 'Cabang promo harus tersedia dan aktif' using errcode='23514';
 end if;
 if (p_values->>'valid_until')::date<(p_values->>'valid_from')::date then raise exception 'Tanggal berakhir lebih awal dari tanggal mulai' using errcode='22023';end if;
 if pid is null then
  insert into public.promos(name,promo_type,rule,is_active,branch_ids,valid_from,valid_until,min_qty,max_qty,kelipatan,auto_apply,discount_type,discount_value)
  values(btrim(p_values->>'name'),'bundling',new_rule,false,coalesce(branches,'{}'),(p_values->>'valid_from')::date,(p_values->>'valid_until')::date,null,null,repeat_flag,true,null,null)
  returning id into pid;
 else
  update public.promos set name=btrim(p_values->>'name'),rule=new_rule,branch_ids=coalesce(branches,'{}'),valid_from=(p_values->>'valid_from')::date,
   valid_until=(p_values->>'valid_until')::date,kelipatan=repeat_flag where id=pid;
 end if;
 delete from public.promo_items where promo_id=pid and item_id<>all(coalesce((select array_agg(distinct r.item_id) from public.promo_sh_refs(new_rule) r),'{}'));
 insert into public.promo_items(promo_id,item_id) select distinct pid,r.item_id from public.promo_sh_refs(new_rule) r
  where not exists(select 1 from public.promo_items t where t.promo_id=pid and t.item_id=r.item_id);
 return public.promo_edit_snapshot(pid);
end$$;
revoke all on function public.save_promo_syarat_hasil(uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.save_promo_syarat_hasil(uuid,text,jsonb) to authenticated;

create function public.set_promo_syarat_hasil_active(p_id uuid,p_expected_version text,p_active boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.promos%rowtype;problem text;fingerprint text;
begin
 perform public.assert_promo_manager();
 perform pg_advisory_xact_lock(hashtextextended('promo_syarat_hasil:definition',0));
 if p_active is null then raise exception 'PROMO_SH_RULE: status aktif wajib diisi' using errcode='22023';end if;
 select * into existing from public.promos where id=p_id for update;
 if not found or existing.rule->>'discount_mode' is distinct from 'syarat_hasil' then
  raise exception 'Promo tidak ditemukan atau bukan promo Syarat-Hasil' using errcode='42501';
 end if;
 if p_expected_version is null or public.promo_edit_snapshot(p_id)->>'version' is distinct from p_expected_version then
  raise exception 'PROMO_EDIT_CONFLICT: Promo sudah berubah. Muat ulang data terbaru sebelum mengedit lagi.' using errcode='40001';
 end if;
 if p_active and not existing.is_active then
  if not public.promo_release_enabled('syarat_hasil') then
   raise exception 'PROMO_SH_RELEASE: promo Syarat-Hasil belum dirilis; aplikasi harus live dan flag rilis dinyalakan dulu' using errcode='55000';
  end if;
  problem:=public.promo_syarat_hasil_rule_problem(existing.rule);
  if problem is not null then raise exception 'PROMO_SH_RULE: %',problem using errcode='22023';end if;
  problem:=public.promo_sh_targets_problem(existing.rule);
  if problem is not null then raise exception 'PROMO_SH_TARGET: %',problem using errcode='23514';end if;
  fingerprint:=md5(((existing.rule->'syarat_hasil')-'below_hpp')::text);
  if exists(select 1 from public.promos o where o.id<>existing.id and o.is_active and o.rule->>'discount_mode'='syarat_hasil'
   and md5(((o.rule->'syarat_hasil')-'below_hpp')::text)=fingerprint
   and coalesce(o.valid_from,'-infinity'::date)<=coalesce(existing.valid_until,'infinity'::date)
   and coalesce(existing.valid_from,'-infinity'::date)<=coalesce(o.valid_until,'infinity'::date)
   and (cardinality(o.branch_ids)=0 or cardinality(existing.branch_ids)=0 or o.branch_ids&&existing.branch_ids)) then
   raise exception 'PROMO_SH_DUPLICATE: sudah ada promo aktif dengan aturan identik pada tanggal dan cabang yang beririsan' using errcode='23505';
  end if;
 end if;
 update public.promos set is_active=p_active where id=p_id;
 return public.promo_edit_snapshot(p_id);
end$$;
revoke all on function public.set_promo_syarat_hasil_active(uuid,text,boolean) from public,anon,service_role;
grant execute on function public.set_promo_syarat_hasil_active(uuid,text,boolean) to authenticated;
commit;
