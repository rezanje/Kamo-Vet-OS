-- Fictional C04 fixture, run after the POS fixture prefix in disposable Postgres.
update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
insert into promos(id,name,promo_type,rule,discount_type,discount_value,min_qty,max_qty,auto_apply)
values(md5('c04-package')::uuid,'Fiction package','diskon_produk','{"suggest":"Fiction package"}',
 'nominal',10000,5,5,true);
insert into promo_items(promo_id,item_id) values(md5('c04-package')::uuid,'e5500000-0000-4000-8000-000000000001');
create function pg_temp.package_payload(mode text) returns jsonb language sql as $$select jsonb_build_object(
 'name','Fiction package','promo_type','diskon_produk','suggest','Fiction package','min_subtotal',null,
 'discount_type','nominal','discount_value',10000,'min_qty',5,'max_qty',5,'kelipatan',false,'auto_apply',true,
 'valid_from',null,'valid_until',null,'branch_ids',null,'discount_mode',mode)$$;
create function pg_temp.reject_like(statement text,expected text) returns void language plpgsql as $$declare rejected boolean:=false;begin
 begin execute statement;exception when others then
  if position(expected in sqlerrm)=0 then raise exception 'Wrong failure: % (expected %)',sqlerrm,expected;end if;rejected:=true;
 end;
 if not rejected then raise exception 'Expected rejection: %',expected;end if;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $$declare id uuid:=md5('c04-package')::uuid; v text; snapshot jsonb;begin
 v:=read_promo_edit(id)->>'version';
 snapshot:=edit_promo(id,v,pg_temp.package_payload('package_total'),array['e5500000-0000-4000-8000-000000000001']::uuid[]);
 if snapshot->'promo'->'rule'->>'discount_mode'<>'package_total' then raise exception 'Explicit package mode not saved';end if;
 v:=snapshot->>'version';
 perform pg_temp.reject_like(format('select edit_promo(%L,%L,%L,%L)',id,v,pg_temp.package_payload('unknown'),array['e5500000-0000-4000-8000-000000000001']::uuid[]),'Cara hitung');
 perform pg_temp.reject_like(format('select edit_promo(%L,%L,%L,%L)',id,v,pg_temp.package_payload('package_total')||'{"min_qty":null}',array['e5500000-0000-4000-8000-000000000001']::uuid[]),'Total per paket');
 perform pg_temp.reject_like(format('select edit_promo(%L,%L,%L,%L)',id,v,pg_temp.package_payload('package_total')||'{"discount_type":"percent","discount_value":10}',array['e5500000-0000-4000-8000-000000000001']::uuid[]),'Total per paket');
 perform pg_temp.reject_like(format('select edit_promo(%L,%L,%L,%L)',id,v,pg_temp.package_payload('package_total'),array[]::uuid[]),'Total per paket');
 if (read_promo_edit(id)->>'version')<>v then raise exception 'Rejected edits changed promo';end if;
 snapshot:=edit_promo(id,v,pg_temp.package_payload('package_total')-'discount_mode',array['e5500000-0000-4000-8000-000000000001']::uuid[]);
 if snapshot->'promo'->'rule'->>'discount_mode'<>'package_total' then raise exception 'Older client cleared selected mode';end if;
 snapshot:=edit_promo(id,snapshot->>'version',pg_temp.package_payload('per_unit'),array['e5500000-0000-4000-8000-000000000001']::uuid[]);
 if snapshot->'promo'->'rule' ? 'discount_mode' then raise exception 'Legacy mode did not remove opt-in key';end if;
end$$;
reset role;
do $$begin
 begin
  update promos set rule=rule||'{"discount_mode":"unknown"}'::jsonb where id=md5('c04-package')::uuid;
  raise exception 'Unknown mode accepted';
 exception when check_violation then null;
 end;
 if has_function_privilege('anon','public.edit_promo(uuid,text,jsonb,uuid[])','EXECUTE') then raise exception 'Anonymous editor access widened';end if;
 if has_function_privilege('service_role','public.edit_promo(uuid,text,jsonb,uuid[])','EXECUTE') then raise exception 'Service editor access widened';end if;
end$$;
rollback;
