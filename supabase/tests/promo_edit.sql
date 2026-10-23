-- Prefix is the existing fictional POS fixture from the network-none runner.
do $$begin
 if to_regprocedure('public.edit_promo(uuid,text,jsonb,uuid[])') is null then raise exception 'C01 missing atomic promo editor';end if;
end$$;
update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
insert into promos(id,name,promo_type,rule,discount_type,discount_value,branch_ids)
values(md5('c01')::uuid,'Fiction original','diskon_produk','{"suggest":"private fictional reminder","min_subtotal":1000,"legacy_key":"keep private"}','percent',10,array['e2200000-0000-4000-8000-000000000001']::uuid[]);
insert into promo_items(promo_id,item_id) values(md5('c01')::uuid,'e5500000-0000-4000-8000-000000000001');
create function pg_temp.version() returns text language sql as $$select read_promo_edit(md5('c01')::uuid)->>'version'$$;
create function pg_temp.payload() returns jsonb language sql as $$select jsonb_build_object(
 'name','Fiction edited','promo_type','diskon_produk','suggest','private changed reminder','min_subtotal',2000,
 'discount_type','percent','discount_value',25,'min_qty',2,'max_qty',10,'kelipatan',true,'auto_apply',true,
 'valid_from','2026-10-01','valid_until','2026-10-31','branch_ids',jsonb_build_array('e2200000-0000-4000-8000-000000000001'))$$;
create function pg_temp.reject_like(statement text,expected text) returns void language plpgsql as $$declare rejected boolean:=false;begin
 begin execute statement;exception when others then
  if position(expected in sqlerrm)=0 then raise exception 'Wrong failure: % (expected %)',sqlerrm,expected;end if;rejected:=true;
 end;
 if not rejected then raise exception 'Expected rejection: %',expected;end if;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
-- A real posted fictional checkout retains its persisted discount and receipts.
select pg_temp.sale('C01.HIST','[{"method":"Tunai","amount":90000}]',90000,100000,90000,0,'Tunai');
select pg_temp.lines((select id from sales where no_struk='C01.HIST'));
update sale_items set promo_id=md5('c01')::uuid,promo_discount=10000 where sale_id=(select id from sales where no_struk='C01.HIST');
select finalize_pos_sale((select id from sales where no_struk='C01.HIST'));
reset role;
create temp table history_before as select jsonb_build_array(
 (select jsonb_agg(to_jsonb(s)) from sales s where no_struk='C01.HIST'),
 (select jsonb_agg(to_jsonb(i)) from sale_items i where sale_id=(select id from sales where no_struk='C01.HIST')),
 (select jsonb_agg(to_jsonb(p)) from sale_payments p where sale_id=(select id from sales where no_struk='C01.HIST')),
 (select jsonb_agg(to_jsonb(j)) from journal_entries j where source_ref='C01.HIST')) as rows;
grant select on history_before to authenticated;
select change_master_data_lifecycle('items','e5500000-0000-4000-8000-000000000001','archive',0,'Fiction target archive');
set local role authenticated;
-- Existing inactive target retained; unrelated old rule keys preserved, not submitted by client.
do $$declare result jsonb;old_version text:=pg_temp.version();count_before bigint;begin
 select count(*) into count_before from activity_log where entity='promos' and entity_id=md5('c01')::uuid::text;
 result:=edit_promo(md5('c01')::uuid,old_version,pg_temp.payload(),array['e5500000-0000-4000-8000-000000000001']::uuid[]);
 perform pg_temp.assert_ok(result->>'version'<>old_version,'edit refreshes token');
 perform pg_temp.assert_ok(result->'promo'->>'name'='Fiction edited','name saved');
 perform pg_temp.assert_ok(result->'promo'->'rule'->>'legacy_key'='keep private','unrelated rule survives');
 perform pg_temp.assert_ok((select count(*)=count_before+1 from activity_log where entity='promos' and entity_id=md5('c01')::uuid::text),'one header audit, unchanged children not rewritten');
 perform pg_temp.reject_like(format('select edit_promo(%L,%L,%L,%L)',md5('c01')::uuid,old_version,pg_temp.payload(),array['e5500000-0000-4000-8000-000000000001']::uuid[]),'PROMO_EDIT_CONFLICT');
end$$;
select pg_temp.assert_ok((select before_state->>'discount_value'='10.00' and after_state->>'discount_value'='25.00' and actor_id=auth.uid() and occurred_at is not null from activity_log where row_entity='promos' and row_id=md5('c01')::uuid::text and action='update' order by id desc limit 1),'audit actor/time/old/new');
select pg_temp.assert_ok(not exists(select 1 from activity_log where entity='promos' and entity_id=md5('c01')::uuid::text and (before_state::text||after_state::text) like '%private%'),'free text and rule never copied');
select pg_temp.assert_ok((select rows=jsonb_build_array(
 (select jsonb_agg(to_jsonb(s)) from sales s where no_struk='C01.HIST'),
 (select jsonb_agg(to_jsonb(i)) from sale_items i where sale_id=(select id from sales where no_struk='C01.HIST')),
 (select jsonb_agg(to_jsonb(p)) from sale_payments p where sale_id=(select id from sales where no_struk='C01.HIST')),
 (select jsonb_agg(to_jsonb(j)) from journal_entries j where source_ref='C01.HIST')) from history_before),'posted header/lines/payments/journal unchanged');
select pg_temp.reject_like($q$select edit_promo(md5('c01')::uuid,pg_temp.version(),pg_temp.payload()||'{"actor_id":"e1100000-0000-4000-8000-000000000002"}',array[]::uuid[])$q$,'kolom yang tidak diizinkan');
select pg_temp.reject_like($q$select edit_promo(md5('c01')::uuid,pg_temp.version(),pg_temp.payload()||'{"discount_value":101}',array[]::uuid[])$q$,'100%');
select pg_temp.reject_like($q$select edit_promo(md5('c01')::uuid,pg_temp.version(),pg_temp.payload()||'{"valid_until":"2026-09-30"}',array[]::uuid[])$q$,'Tanggal berakhir');
select pg_temp.reject_like($q$select edit_promo(md5('c01')::uuid,pg_temp.version(),pg_temp.payload()||'{"max_qty":1}',array[]::uuid[])$q$,'Maks. qty');
select pg_temp.reject_like($q$select edit_promo(md5('c01')::uuid,pg_temp.version(),pg_temp.payload()||'{"discount_type":null}',array[]::uuid[])$q$,'Potong otomatis');
select pg_temp.reject_like($q$select edit_promo(md5('c01')::uuid,pg_temp.version(),pg_temp.payload()||'{"min_qty":null}',array[]::uuid[])$q$,'kelipatan');
select pg_temp.reject_like($q$select edit_promo(md5('c01')::uuid,pg_temp.version(),pg_temp.payload()||'{"min_subtotal":-1}',array[]::uuid[])$q$,'Min. subtotal');
select pg_temp.reject_like($q$select edit_promo(md5('c01')::uuid,pg_temp.version(),pg_temp.payload(),array[md5('absent')::uuid])$q$,'Barang baru');
select pg_temp.reject_like($q$select edit_promo(md5('c01')::uuid,pg_temp.version(),pg_temp.payload()||jsonb_build_object('branch_ids',array[md5('absent')::uuid]),array[]::uuid[])$q$,'Cabang baru');
-- New branch targets respect the existing operational branch fence.
select set_config('request.headers','{"x-kamo-operational-branch":"e2200000-0000-4000-8000-000000000001"}',true);
select pg_temp.reject_like($q$select edit_promo(md5('c01')::uuid,pg_temp.version(),pg_temp.payload()||'{"branch_ids":["e2200000-0000-4000-8000-000000000002"]}',array[]::uuid[])$q$,'Cabang baru');
select set_config('request.headers','{}',true);
-- Child mutations also invalidate an open editor token, including direct DML.
do $$declare version text:=pg_temp.version();begin
 insert into promo_items(promo_id,item_id) values(md5('c01')::uuid,'e5500000-0000-4000-8000-000000000002');
 perform pg_temp.reject_like(format('select edit_promo(%L,%L,%L,%L)',md5('c01')::uuid,version,pg_temp.payload(),array[]::uuid[]),'PROMO_EDIT_CONFLICT');
end$$;
select edit_promo(md5('c01')::uuid,pg_temp.version(),pg_temp.payload(),array['e5500000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.reject_like($q$select edit_promo(md5('c01')::uuid,pg_temp.version(),pg_temp.payload(),array['e5500000-0000-4000-8000-000000000001']::uuid[])$q$,'Barang baru');
-- Even a privileged editor cannot forge the append-only log.
select pg_temp.reject($q$update activity_log set actor_name='spoof'$q$,'audit updates denied');
select pg_temp.reject($q$delete from activity_log$q$,'audit deletes denied');
-- Force late audit failure after header + child removal: whole operation rolls back.
reset role;
create function pg_temp.fail_promo_child_audit() returns trigger language plpgsql as $$begin
 if new.row_entity='promo_items' and new.action='delete' then raise exception 'Fictional audit failure';end if;return new;
end$$;
create trigger fictional_audit_failure before insert on activity_log for each row execute function pg_temp.fail_promo_child_audit();
set local role authenticated;
do $$declare before jsonb:=read_promo_edit(md5('c01')::uuid);logs bigint;begin
 select count(*) into logs from activity_log;
 perform pg_temp.reject_like($q$select edit_promo(md5('c01')::uuid,pg_temp.version(),pg_temp.payload()||'{"name":"Must roll back"}',array[]::uuid[])$q$,'Fictional audit failure');
 perform pg_temp.assert_ok(read_promo_edit(md5('c01')::uuid)=before,'header and children rolled back');
 perform pg_temp.assert_ok((select count(*)=logs from activity_log),'no phantom audit after rollback');
end$$;
reset role;drop trigger fictional_audit_failure on activity_log;
update profiles set role='STAFF' where id='e1100000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select pg_temp.reject_like($q$select read_promo_edit(md5('c01')::uuid)$q$,'Hanya owner');
select pg_temp.reject_like($q$select edit_promo(md5('c01')::uuid,'spoof',pg_temp.payload(),array[]::uuid[])$q$,'Hanya owner');
select pg_temp.reject_like($q$update promos set name='Spoof' where id=md5('c01')::uuid$q$,'Hanya owner');
select pg_temp.reject_like($q$delete from promo_items where promo_id=md5('c01')::uuid$q$,'Hanya owner');
select pg_temp.reject_like($q$insert into promos(name,promo_type) values('Spoof','bundling')$q$,'Hanya owner');
reset role;
select set_config('request.jwt.claim.sub','',true);
update profiles set role='ADMIN',is_active=false where id='e1100000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select pg_temp.reject_like($q$select read_promo_edit(md5('c01')::uuid)$q$,'Hanya owner');
reset role;
select set_config('request.jwt.claim.sub','',true);
update profiles set is_active=true where id='e1100000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select pg_temp.assert_ok(read_promo_edit(md5('c01')::uuid) is not null,'active ADMIN retains central-manager scope');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.reject_like($q$select read_promo_edit(md5('c01')::uuid)$q$,'Hanya owner');
reset role;set local role anon;
select pg_temp.reject($q$select read_promo_edit(md5('c01')::uuid)$q$,'anonymous RPC denied');
select pg_temp.reject($q$select edit_promo(md5('c01')::uuid,'spoof','{}',array[]::uuid[])$q$,'anonymous edit denied');
rollback;
