-- Stage 2a: definition storage, validator, Owner/Admin RPCs, release flag, waiver ownership, audit, legacy editor.
create function pg_temp.base_rule() returns jsonb language sql as $$
 select jsonb_build_object('discount_mode','syarat_hasil','suggest','Beli 2 Bolt, ANC -1000','syarat_hasil',
  jsonb_build_object('version',1,'repeat',true,'syarat',pg_temp.bolt_syarat(),
   'hasil',pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}'),'below_hpp','{"allowed":false}'::jsonb))
$$;
-- rule with a path replaced / removed
create function pg_temp.mut(path text[],val jsonb) returns jsonb language sql as $$select jsonb_set(pg_temp.base_rule(),path,val)$$;
create function pg_temp.cut(path text[]) returns jsonb language sql as $$select pg_temp.base_rule()#-path$$;
create function pg_temp.bad(rule jsonb,code text,label text) returns text language plpgsql as $$
declare problem text:=public.promo_syarat_hasil_rule_problem(rule);
begin
 if problem is null or problem not like code||'%' then raise exception 'Expected % for %, got %',code,label,coalesce(problem,'VALID');end if;
 return 'PASS invalid definition refused: '||label||' ['||problem||']';
end$$;

select pg_temp.ok(public.promo_syarat_hasil_rule_valid(pg_temp.base_rule()),'canonical Accurate-style definition is valid');
select pg_temp.ok(public.promo_syarat_hasil_rule_valid(pg_temp.mut('{syarat_hasil,hasil,discount}','{"type":"percent","value":50,"max_amount":5000}')),'percent with per-unit max_amount is valid');
select pg_temp.ok(public.promo_syarat_hasil_rule_valid(jsonb_set(pg_temp.base_rule(),'{syarat_hasil,syarat}',pg_temp.bolt_syarat()||'[{"kind":"nilai","min":100000}]'::jsonb)),'qty row AND whole-cart nilai row is valid');
select pg_temp.ok(public.promo_syarat_hasil_rule_valid(pg_temp.mut('{syarat_hasil,below_hpp}',
 '{"allowed":true,"reason":"barang mendekati expired","ack_by":"e1100000-0000-4000-8000-000000000003","ack_at":"2026-11-04T01:02:03.000Z"}')),'below_hpp waiver with reason+ack is valid');

-- 1. Strict validation: every malformed shape is refused with its own typed reason.
select pg_temp.bad(null::jsonb,'SH_BAD_INPUT','null rule');
select pg_temp.bad('[]','SH_BAD_INPUT','array rule');
select pg_temp.bad(pg_temp.mut('{discount_mode}','"per_unit"'),'SH_BAD_INPUT','wrong mode');
select pg_temp.bad(pg_temp.base_rule()||'{"surprise":1}','SH_BAD_INPUT','unknown top-level key');
select pg_temp.bad(pg_temp.base_rule()||'{"quantity_pool_scope":"bolt_800gr"}','SH_BAD_INPUT','pool key smuggled into a syarat_hasil rule');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,version}','2'),'SH_BAD_INPUT','version 2');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,repeat}','"yes"'),'SH_BAD_INPUT','repeat not boolean');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,extra}','1'),'SH_BAD_INPUT','unknown syarat_hasil key');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,syarat}','[]'),'SH_EMPTY_SYARAT','no syarat rows');
select pg_temp.bad(pg_temp.cut('{syarat_hasil,syarat}'),'SH_EMPTY_SYARAT','syarat missing');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,syarat}',(select jsonb_agg(pg_temp.bolt_syarat()->0) from generate_series(1,9))),'SH_TOO_LARGE','9 syarat rows');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,syarat,0,min}','0'),'SH_ROW_INVALID','qty min 0');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,syarat,0,min}','1.5'),'SH_ROW_INVALID','qty min fractional');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,syarat,0,min}','100000'),'SH_ROW_INVALID','qty min above 99999');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,syarat,0,items}','[]'),'SH_ROW_INVALID','qty row without items');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,syarat,0,items}',jsonb_build_array(pg_temp.ref('KOPI'),pg_temp.ref('KOPI'))),'SH_ROW_INVALID','duplicate item+unit in one pool');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,syarat,0,items}','[{"item_id":"NOT-A-UUID","unit":"PCS"}]'),'SH_ROW_INVALID','item id not a uuid');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,syarat,0,items}',(select jsonb_agg(jsonb_build_object('item_id',gen_random_uuid(),'unit','PCS')) from generate_series(1,51))),'SH_ROW_INVALID','51 items in one row');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,syarat,0,kind}','"bogus"'),'SH_ROW_INVALID','unknown syarat kind');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,syarat}','[{"kind":"nilai","min":0}]'),'SH_ROW_INVALID','nilai min 0');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,syarat}','[{"kind":"nilai","min":100000000}]'),'SH_ROW_INVALID','nilai min above 99.999.999');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,syarat}',jsonb_build_array(jsonb_build_object('kind','nilai','min',1000,'items',jsonb_build_array(pg_temp.ref('KOPI'))))),'SH_ROW_INVALID','nilai row carrying items (Andri: whole cart)');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,hasil}','{}'),'SH_BAD_INPUT','empty hasil object (kind missing)');
select pg_temp.bad(pg_temp.cut('{syarat_hasil,hasil}'),'SH_EMPTY_HASIL','hasil missing');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,hasil,items}','[]'),'SH_EMPTY_HASIL','hasil without items');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,hasil,items}',(select jsonb_agg(jsonb_build_object('item_id',gen_random_uuid(),'unit','PCS')) from generate_series(1,21))),'SH_EMPTY_HASIL','21 hasil items');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,hasil,kind}','"gratis"'),'SH_BAD_INPUT','hasil kind other than barang');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,hasil,reward_qty}','0'),'SH_DISCOUNT_INVALID','reward_qty 0');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,hasil,reward_qty}','1000'),'SH_DISCOUNT_INVALID','reward_qty 1000');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,hasil,discount}','{"type":"nominal","value":0}'),'SH_DISCOUNT_INVALID','nominal 0');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,hasil,discount}','{"type":"nominal","value":10.5}'),'SH_DISCOUNT_INVALID','nominal fractional');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,hasil,discount}','{"type":"nominal","value":1000,"max_amount":500}'),'SH_DISCOUNT_INVALID','nominal with max_amount');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,hasil,discount}','{"type":"percent","value":101}'),'SH_DISCOUNT_INVALID','percent 101');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,hasil,discount}','{"type":"percent","value":50,"max_amount":0}'),'SH_DISCOUNT_INVALID','percent max_amount 0');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,hasil,discount}','{"type":"free"}'),'SH_DISCOUNT_INVALID','unknown discount type');
select pg_temp.bad(pg_temp.cut('{syarat_hasil,below_hpp}'),'SH_BELOW_HPP','below_hpp missing');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,below_hpp}','{"allowed":true}'),'SH_BELOW_HPP','waiver without reason/ack');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,below_hpp}','{"allowed":true,"reason":"expired","ack_by":"e1100000-0000-4000-8000-000000000003","ack_at":"2026-11-04T01:02:03Z"}'),'SH_BELOW_HPP','waiver reason shorter than 10 characters');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,below_hpp}','{"allowed":true,"reason":"barang mendekati expired","ack_by":"x","ack_at":"2026-11-04T01:02:03Z"}'),'SH_BELOW_HPP','waiver ack_by not a uuid');
select pg_temp.bad(pg_temp.mut('{syarat_hasil,below_hpp}','{"allowed":false,"reason":"sneaky"}'),'SH_BELOW_HPP','waiver off but carrying a reason');

-- 2. The table CHECK enforces the same shape on EVERY write path (superuser here: no RPC involved).
create function pg_temp.insert_promo(rule jsonb,active boolean default false,ptype text default 'bundling',auto boolean default true,dtype text default null,kel boolean default true) returns uuid language plpgsql as $$
declare id uuid;begin
 insert into promos(name,promo_type,rule,is_active,auto_apply,discount_type,discount_value,kelipatan,valid_from,valid_until)
 values('Direct '||gen_random_uuid(),ptype,rule,active,auto,dtype,case when dtype is null then null else 1 end,kel,(now() at time zone 'Asia/Jakarta')::date,(now() at time zone 'Asia/Jakarta')::date+30) returning promos.id into id;
 return id;
end$$;
select pg_temp.must_reject($q$select pg_temp.insert_promo(pg_temp.mut('{syarat_hasil,hasil,discount,value}','0'))$q$,'promos_discount_mode_valid','CHECK refuses an invalid rule on a direct insert');
select pg_temp.must_reject($q$select pg_temp.insert_promo(pg_temp.base_rule(),false,'diskon_produk')$q$,'promos_discount_mode_valid','CHECK: promo_type must be bundling');
select pg_temp.must_reject($q$select pg_temp.insert_promo(pg_temp.base_rule(),false,'bundling',false)$q$,'promos_discount_mode_valid','CHECK: auto_apply must be true');
select pg_temp.must_reject($q$select pg_temp.insert_promo(pg_temp.base_rule(),false,'bundling',true,'nominal')$q$,'promos_discount_mode_valid','CHECK: legacy discount_type must stay NULL');
select pg_temp.must_reject($q$select pg_temp.insert_promo(pg_temp.base_rule(),false,'bundling',true,null,false)$q$,'promos_discount_mode_valid','CHECK: kelipatan mirrors rule.repeat');
select pg_temp.ok((select count(*)=0 from promos where rule->>'discount_mode'='syarat_hasil'),'no definition leaked from refused inserts');
-- the legacy modes keep their exact validation (quantity pool untouched)
select pg_temp.must_reject($q$update promos set rule=jsonb_set(rule,'{quantity_pool,normal_price}','1') where id='f2000000-0000-4000-8000-000000000001'$q$,'promos_discount_mode_valid','legacy pool CHECK still refuses a partial pool rule');

-- 3. Release flags: default OFF, no tenant role can flip them.
select pg_temp.ok((select count(*)=3 and not bool_or(enabled) from promo_release_flags),'all three release flags are OFF by default');
select pg_temp.set_user('e1100000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.must_reject($q$update promo_release_flags set enabled=true where flag='syarat_hasil'$q$,'permission denied','OWNER cannot flip a release flag');
select pg_temp.must_reject($q$insert into promo_release_flags(flag,enabled) values('syarat_hasil',true)$q$,'permission denied','OWNER cannot insert a release flag');
select pg_temp.ok((select count(*)=3 from promo_release_flags),'OWNER/ADMIN can read the flags');
select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*)=0 from promo_release_flags),'STAFF cannot read the flags (RLS)');

-- 4. Save RPC: Owner/Admin only; always inactive; mirrors promo_items; stale token refused.
select pg_temp.must_reject($q$select save_promo_syarat_hasil(null,null,pg_temp.values_of('X',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')))$q$,'Hanya owner/manajer','STAFF cannot save a definition');
reset role;
set local role anon;
select pg_temp.must_reject($q$select save_promo_syarat_hasil(null,null,'{}')$q$,'permission denied','anon has no EXECUTE on save');
reset role;
set local role authenticated;
select pg_temp.set_user('e1100000-0000-4000-8000-000000000004');
create temp table sh_ids(k text primary key,id uuid,version text);
grant all on sh_ids to authenticated;
insert into sh_ids(k,id,version)
 select 'p1',(r->'promo'->>'id')::uuid,r->>'version' from (select save_promo_syarat_hasil(null,null,pg_temp.values_of('Bolt 2 ANC -1000',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}'))) r) x;
select pg_temp.ok((select not p.is_active and p.promo_type='bundling' and p.auto_apply and p.kelipatan and p.discount_type is null and p.discount_value is null and p.min_qty is null
  and p.rule->>'discount_mode'='syarat_hasil' from promos p join sh_ids s on s.id=p.id where s.k='p1'),'ADMIN save creates a DRAFT (inactive, auto_apply, legacy columns NULL)');
select pg_temp.ok((select array_agg(item_id order by item_id)=(select array_agg(id order by id) from items where code in('DRC8993374326970','DRC8993374326987','ANC-CREAMY'))
  from promo_items where promo_id=(select id from sh_ids where k='p1')),'promo_items mirrors syarat+hasil items');
select pg_temp.must_reject($q$select save_promo_syarat_hasil((select id from sh_ids where k='p1'),'stale-token',pg_temp.values_of('Bolt 2 ANC v2',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')))$q$,'PROMO_EDIT_CONFLICT','stale version token refused');
select pg_temp.must_reject($q$select save_promo_syarat_hasil((select id from sh_ids where k='p1'),null,pg_temp.values_of('Bolt 2 ANC v2',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')))$q$,'PROMO_EDIT_CONFLICT','missing version token refused for an existing promo');
select pg_temp.must_reject($q$select save_promo_syarat_hasil(null,'whatever',pg_temp.values_of('X',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')))$q$,'tidak memakai token','new promo with a version token refused');
select pg_temp.must_reject($q$select save_promo_syarat_hasil(null,null,pg_temp.values_of('X',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":0}')))$q$,'SH_DISCOUNT_INVALID','RPC refuses an invalid definition');
select pg_temp.must_reject($q$select save_promo_syarat_hasil(null,null,pg_temp.values_of('X',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}'),true,'{"allowed":false}','[]','2026-12-31','2026-01-01'))$q$,'Tanggal berakhir','end before start refused');
select pg_temp.must_reject($q$select save_promo_syarat_hasil(null,null,pg_temp.values_of('X',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}'),true,'{"allowed":false}','["e2200000-0000-4000-8000-0000000000ff"]'))$q$,'Cabang promo','unknown branch refused');
select pg_temp.must_reject($q$select save_promo_syarat_hasil(null,null,pg_temp.values_of('X',pg_temp.bolt_syarat(),pg_temp.hasil_of('ATOMICSERVICE','{"type":"nominal","value":1000}')))$q$,'PROMO_SH_TARGET','service item as hasil refused (stock items only)');
select pg_temp.must_reject($q$select save_promo_syarat_hasil(null,null,pg_temp.values_of('X',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}',null,'DUS')))$q$,'PROMO_SH_TARGET','unit that is not an official unit refused');
select pg_temp.must_reject($q$select save_promo_syarat_hasil(null,null,pg_temp.values_of('X',pg_temp.bolt_syarat()||'[1]'::jsonb,pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')))$q$,'SH_ROW_INVALID','garbage syarat row refused');
select pg_temp.must_reject($q$select save_promo_syarat_hasil(null,null,'{"name":"X"}')$q$,'tidak lengkap','incomplete values refused');
select pg_temp.must_reject($q$select save_promo_syarat_hasil(null,null,pg_temp.values_of('X',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}'))||'{"is_active":true}')$q$,'tidak lengkap','client cannot smuggle is_active through the RPC');
select pg_temp.ok((select count(*)=1 from promos where rule->>'discount_mode'='syarat_hasil'),'refused saves left exactly the one draft');
-- a valid edit with the current token succeeds, token rotates
update sh_ids set version=(select r->>'version' from (select save_promo_syarat_hasil((select id from sh_ids where k='p1'),(select version from sh_ids where k='p1'),
 pg_temp.values_of('Bolt 2 ANC -1500',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1500}'))) r) x) where k='p1';
select pg_temp.ok((select rule#>>'{syarat_hasil,hasil,discount,value}'='1500' and name='Bolt 2 ANC -1500' from promos where id=(select id from sh_ids where k='p1')),'valid edit with a fresh token saved');
select pg_temp.must_reject($q$select save_promo_syarat_hasil((select id from sh_ids where k='p1'),'old',pg_temp.values_of('Y',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')))$q$,'PROMO_EDIT_CONFLICT','old token no longer works after an edit');

-- 5. Activation is blocked until the release flag is on.
select pg_temp.must_reject($q$select set_promo_syarat_hasil_active((select id from sh_ids where k='p1'),(select version from sh_ids where k='p1'),true)$q$,'PROMO_SH_RELEASE','activation blocked without the release flag (RPC)');
select pg_temp.must_reject($q$update promos set is_active=true where id=(select id from sh_ids where k='p1')$q$,'PROMO_SH_RELEASE','activation blocked without the release flag (direct UPDATE by an ADMIN)');
select pg_temp.must_reject($q$select pg_temp.insert_promo(pg_temp.base_rule(),true)$q$,'PROMO_SH_RELEASE','a promo cannot be INSERTed active without the flag');
reset role;
update promo_release_flags set enabled=true where flag='syarat_hasil';
select pg_temp.ok((select enabled and changed_at is not null from promo_release_flags where flag='syarat_hasil'),'database owner/service flips the release flag');
set local role authenticated;
select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
select pg_temp.must_reject($q$select set_promo_syarat_hasil_active((select id from sh_ids where k='p1'),(select version from sh_ids where k='p1'),true)$q$,'Hanya owner/manajer','STAFF cannot activate');
select pg_temp.set_user('e1100000-0000-4000-8000-000000000004');
select pg_temp.must_reject($q$select set_promo_syarat_hasil_active((select id from sh_ids where k='p1'),'stale',true)$q$,'PROMO_EDIT_CONFLICT','activation with a stale token refused');
update sh_ids set version=(select r->>'version' from (select set_promo_syarat_hasil_active((select id from sh_ids where k='p1'),(select version from sh_ids where k='p1'),true) r) x) where k='p1';
select pg_temp.ok((select is_active from promos where id=(select id from sh_ids where k='p1')),'ADMIN activates once the flag is on');
-- a live promo is never edited in place; no delete; mode is fixed
select pg_temp.must_reject($q$select save_promo_syarat_hasil((select id from sh_ids where k='p1'),(select version from sh_ids where k='p1'),pg_temp.values_of('Z',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":900}')))$q$,'PROMO_SH_ACTIVE_EDIT','active promo cannot be edited through the RPC');
select pg_temp.must_reject($q$update promos set rule=jsonb_set(rule,'{syarat_hasil,hasil,discount,value}','900') where id=(select id from sh_ids where k='p1')$q$,'PROMO_SH_ACTIVE_EDIT','active promo cannot be edited by a direct UPDATE');
select pg_temp.must_reject($q$update promos set valid_until=valid_until+1 where id=(select id from sh_ids where k='p1')$q$,'PROMO_SH_ACTIVE_EDIT','active promo dates are frozen too');
select pg_temp.must_reject($q$delete from promos where id=(select id from sh_ids where k='p1')$q$,'PROMO_SH_NO_DELETE','no promo delete (active)');
select pg_temp.must_reject($q$update promos set rule=rule-'discount_mode' where id=(select id from sh_ids where k='p1')$q$,'PROMO_SH_MODE','active promo mode cannot be dropped');
select pg_temp.must_reject($q$update promos set rule=rule||jsonb_build_object('discount_mode','syarat_hasil') where id='f2000000-0000-4000-8000-000000000001'$q$,'PROMO_SH_MODE|promos_discount_mode_valid','a legacy promo cannot be turned into a syarat_hasil promo');
-- legacy editor refuses the new mode
select pg_temp.must_reject($q$select edit_promo((select id from sh_ids where k='p1'),public.read_promo_edit((select id from sh_ids where k='p1'))->>'version',
 jsonb_build_object('name','Legacy','promo_type','bundling','suggest','x','min_subtotal',0,'min_qty',null,'max_qty',null,'kelipatan',true,'auto_apply',true,'discount_type',null,'discount_value',null,'branch_ids',null,'valid_from',null,'valid_until',null),'{}')$q$,'SYARAT_HASIL_READONLY','legacy edit_promo refuses a syarat_hasil promo');
update sh_ids set version=(select r->>'version' from (select set_promo_syarat_hasil_active((select id from sh_ids where k='p1'),(select version from sh_ids where k='p1'),false) r) x) where k='p1';
select pg_temp.ok((select not is_active from promos where id=(select id from sh_ids where k='p1')),'deactivation works');
select pg_temp.must_reject($q$delete from promos where id=(select id from sh_ids where k='p1')$q$,'PROMO_SH_NO_DELETE','no promo delete (inactive)');
select pg_temp.must_reject($q$update promos set rule=rule-'discount_mode' where id=(select id from sh_ids where k='p1')$q$,'PROMO_SH_MODE','a draft cannot drop its mode either');

-- 6. Identical active duplicates refused; target mirror enforced.
update sh_ids set version=(select r->>'version' from (select set_promo_syarat_hasil_active((select id from sh_ids where k='p1'),(select version from sh_ids where k='p1'),true) r) x) where k='p1';
insert into sh_ids(k,id,version)
 select 'dup',(r->'promo'->>'id')::uuid,r->>'version' from (select save_promo_syarat_hasil(null,null,pg_temp.values_of('Duplicate',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1500}'))) r) x;
select pg_temp.must_reject($q$select set_promo_syarat_hasil_active((select id from sh_ids where k='dup'),(select version from sh_ids where k='dup'),true)$q$,'PROMO_SH_DUPLICATE','identical active promo refused');
update sh_ids set version=(select r->>'version' from (select save_promo_syarat_hasil((select id from sh_ids where k='dup'),(select version from sh_ids where k='dup'),
 pg_temp.values_of('Different',pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":2000}'))) r) x) where k='dup';
select pg_temp.ok((set_promo_syarat_hasil_active((select id from sh_ids where k='dup'),(select version from sh_ids where k='dup'),true)->'promo'->>'is_active')::boolean,'a different definition (overlapping items) may be active at the same time');
set constraints all immediate;
select pg_temp.must_reject($q$delete from promo_items where promo_id=(select id from sh_ids where k='p1') and item_id=pg_temp.iid('ANC-CREAMY')$q$,'PROMO_SH_TARGET','active promo cannot lose a mirrored target item');
select pg_temp.must_reject($q$insert into promo_items values((select id from sh_ids where k='p1'),pg_temp.iid('KOPI'))$q$,'PROMO_SH_TARGET','active promo cannot gain an unrelated target item');
set constraints all deferred;

-- 7. Waiver ownership (Q5: only OWNER) + who/when stamped by the database.
select pg_temp.set_user('e1100000-0000-4000-8000-000000000004');
select pg_temp.must_reject($q$select save_promo_syarat_hasil(null,null,pg_temp.values_of('Expire',pg_temp.bolt_syarat(),pg_temp.hasil_of('EXP-REJECT','{"type":"nominal","value":5000}'),true,
 '{"allowed":true,"reason":"barang mendekati expired"}'))$q$,'PROMO_SH_OWNER_ONLY','ADMIN cannot enable the below-HPP waiver (RPC)');
select pg_temp.must_reject($q$select pg_temp.insert_promo(jsonb_set(jsonb_set(pg_temp.base_rule(),'{syarat_hasil,below_hpp}',
 '{"allowed":true,"reason":"barang mendekati expired","ack_by":"e1100000-0000-4000-8000-000000000004","ack_at":"2026-11-04T01:02:03Z"}'),'{syarat_hasil,hasil,items}',jsonb_build_array(pg_temp.ref('EXP-REJECT'))))$q$,'PROMO_SH_OWNER_ONLY','ADMIN cannot enable the waiver by a direct INSERT either');
select pg_temp.set_user('e1100000-0000-4000-8000-000000000003');
insert into sh_ids(k,id,version)
 select 'w1',(r->'promo'->>'id')::uuid,r->>'version' from (select save_promo_syarat_hasil(null,null,pg_temp.values_of('Expire -5000',pg_temp.bolt_syarat(),pg_temp.hasil_of('EXP-REJECT','{"type":"nominal","value":5000}'),true,
  '{"allowed":true,"reason":"barang mendekati expired"}')) r) x;
select pg_temp.ok((select rule#>>'{syarat_hasil,below_hpp,allowed}'='true' and rule#>>'{syarat_hasil,below_hpp,ack_by}'='e1100000-0000-4000-8000-000000000003'
  and (rule#>>'{syarat_hasil,below_hpp,ack_at}')::timestamptz>now()-interval '1 minute' from promos where id=(select id from sh_ids where k='w1')),'OWNER enables the waiver; ack_by/ack_at are stamped from auth.uid()/now()');
select pg_temp.ok((select count(*)=1 from promo_sh_audit where promo_id=(select id from sh_ids where k='w1') and action='below_hpp_on' and actor='e1100000-0000-4000-8000-000000000003'
  and details->>'reason'='barang mendekati expired'),'audit trail records who enabled the waiver and why');
-- a forged ack by an OWNER writing directly is overwritten with the real caller
update promos set rule=jsonb_set(rule,'{syarat_hasil,below_hpp}','{"allowed":true,"reason":"barang mendekati expired lagi","ack_by":"e1100000-0000-4000-8000-000000000001","ack_at":"2020-01-01T00:00:00Z"}')
 where id=(select id from sh_ids where k='w1');
select pg_temp.ok((select rule#>>'{syarat_hasil,below_hpp,ack_by}'='e1100000-0000-4000-8000-000000000003' and (rule#>>'{syarat_hasil,below_hpp,ack_at}')::timestamptz>now()-interval '1 minute' from promos where id=(select id from sh_ids where k='w1')),'forged ack_by/ack_at in a client rule are overwritten by the database');
update sh_ids set version=(select version from (select pg_temp.version((select id from sh_ids where k='w1')) version) x) where k='w1';
-- ADMIN may not edit a rule that carries a waiver, but may switch it off
select pg_temp.set_user('e1100000-0000-4000-8000-000000000004');
select pg_temp.must_reject($q$select save_promo_syarat_hasil((select id from sh_ids where k='w1'),(select version from sh_ids where k='w1'),pg_temp.values_of('Expire -9000',pg_temp.bolt_syarat(),pg_temp.hasil_of('EXP-REJECT','{"type":"nominal","value":9000}'),true,
 '{"allowed":true,"reason":"barang mendekati expired"}'))$q$,'PROMO_SH_OWNER_ONLY','ADMIN cannot edit a rule that carries a waiver (RPC)');
select pg_temp.must_reject($q$update promos set rule=jsonb_set(rule,'{syarat_hasil,hasil,discount,value}','9000') where id=(select id from sh_ids where k='w1')$q$,'PROMO_SH_OWNER_ONLY','ADMIN cannot edit a rule that carries a waiver (direct UPDATE)');
-- activation of a waiver promo needs the separate below_hpp release flag
select pg_temp.must_reject($q$select set_promo_syarat_hasil_active((select id from sh_ids where k='w1'),(select version from sh_ids where k='w1'),true)$q$,'PROMO_SH_RELEASE: izin di bawah HPP','waiver promo cannot be activated before the below_hpp flag');
reset role;
update promo_release_flags set enabled=true where flag='below_hpp';
set local role authenticated;
select pg_temp.set_user('e1100000-0000-4000-8000-000000000004');
select pg_temp.ok((set_promo_syarat_hasil_active((select id from sh_ids where k='w1'),(select version from sh_ids where k='w1'),true)->'promo'->>'is_active')::boolean,'waiver promo activates after the below_hpp flag');
update sh_ids set version=pg_temp.version(id) where k='w1';
select pg_temp.ok((select (set_promo_syarat_hasil_active((select id from sh_ids where k='w1'),(select version from sh_ids where k='w1'),false)->'promo'->>'is_active')::boolean is false),'ADMIN may deactivate a waiver promo');
update sh_ids set version=pg_temp.version(id) where k='w1';
update sh_ids set version=(select r->>'version' from (select save_promo_syarat_hasil((select id from sh_ids where k='w1'),(select version from sh_ids where k='w1'),
 pg_temp.values_of('Expire off',pg_temp.bolt_syarat(),pg_temp.hasil_of('EXP-REJECT','{"type":"nominal","value":5000}'),true,'{"allowed":false}')) r) x) where k='w1';
select pg_temp.ok((select rule#>>'{syarat_hasil,below_hpp}'='{"allowed": false}' from promos where id=(select id from sh_ids where k='w1')),'ADMIN may switch the waiver OFF');
reset role;
select pg_temp.ok((select count(*) filter(where action='below_hpp_off')=1 and count(*) filter(where action='deactivate')>=1 and count(*) filter(where action='activate')>=2 and count(*) filter(where action='create')=3
  from promo_sh_audit),'audit trail: create/activate/deactivate/below_hpp_on/off all recorded');
select pg_temp.must_reject($q$update promo_sh_audit set action='create' where id=(select min(id) from promo_sh_audit)$q$,'append-only','audit rows cannot be updated');
select pg_temp.must_reject($q$delete from promo_sh_audit$q$,'append-only','audit rows cannot be deleted');
-- ACL on the new objects
select pg_temp.ok((select not has_function_privilege('anon','public.save_promo_syarat_hasil(uuid,text,jsonb)','execute') and not has_function_privilege('service_role','public.set_promo_syarat_hasil_active(uuid,text,boolean)','execute')
  and has_function_privilege('authenticated','public.save_promo_syarat_hasil(uuid,text,jsonb)','execute')),'ACL: RPCs executable by authenticated only (anon/service_role denied)');
select pg_temp.ok((select not has_function_privilege('authenticated','public.promo_sh_targets_problem(jsonb)','execute') and not has_function_privilege('authenticated','public.promo_sh_definition_guard()','execute')),'ACL: internal guards are not callable by clients');

-- 8. The existing expiry sweep may still switch an expired promo off (system path, no user): the edit freeze does not block it.
select pg_temp.set_user('');
update promos set valid_until=(now() at time zone 'Asia/Jakarta')::date-1 where id=(select id from sh_ids where k='p1');
select pg_temp.ok((select not is_active from promos where id=(select id from sh_ids where k='p1')),'backdating valid_until on an active promo switches it off in place (existing expiry guard), no ACTIVE_EDIT trap');
