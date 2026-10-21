-- P2 regression: fictional data in owned, network-isolated PostgreSQL only.
begin;
create function pg_temp.code_check(ok boolean,why text) returns void language plpgsql as $$begin if ok is not true then raise exception 'Assertion failed: %',why;end if;end $$;
create function pg_temp.code_reject(q text,fragment text) returns void language plpgsql as $$
begin
 begin execute q; exception when others then
  if position(fragment in sqlerrm)=0 then raise exception 'Wrong failure: %',sqlerrm;end if;
  return;
 end;
 raise exception 'Expected rejection: %',q;
end $$;
insert into auth.users(id) values('cc100000-0000-4000-8000-000000000001');
update profiles set role='OWNER',is_active=true where id='cc100000-0000-4000-8000-000000000001';
insert into items(id,code,name) values
 ('cc200000-0000-4000-8000-000000000001','CODE-USED','Fictional source-code history'),
 ('cc200000-0000-4000-8000-000000000002','CODE-JSON-USED','Fictional JSON-only code history'),
 ('cc200000-0000-4000-8000-000000000003','CODE-UNUSED','Fictional unused item'),
 ('cc200000-0000-4000-8000-000000000004','CODE-UUID-ONLY','Fictional UUID-only configuration');
insert into item_units(item_id,unit,factor) values('cc200000-0000-4000-8000-000000000004','pcs',1);
insert into import_runs(id,kind,source_name,source_hash,created_by) values('cc300000-0000-4000-8000-000000000001','master_accurate','Fictional P2 code history','fictional-P2-code-history','cc100000-0000-4000-8000-000000000001');
insert into import_run_rows(run_id,source_row,source_code,status,payload) values
 ('cc300000-0000-4000-8000-000000000001',1,'CODE-USED','posted','{}'),
 ('cc300000-0000-4000-8000-000000000001',2,null,'valid','{"source":{"code":" code-json-used "}}');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='cc100000-0000-4000-8000-000000000001';
-- Exact review case: failed rename leaves CODE-USED detectable at revision zero.
select pg_temp.code_reject('update items set code=''CODE-RENAMED'' where id=''cc200000-0000-4000-8000-000000000001''','Kode SKU sudah memiliki riwayat');
select pg_temp.code_reject('select change_master_data_lifecycle(''items'',''cc200000-0000-4000-8000-000000000001'',''trash'',0,''rename then trash'')','pemakaian atau riwayat');
select pg_temp.code_check((select code='CODE-USED' and trashed_at is null and lifecycle_revision=0 from items where id='cc200000-0000-4000-8000-000000000001'),'rename/trash rejection preserves original identity and status');
select pg_temp.code_reject('update items set code=''JSON-RENAMED'' where id=''cc200000-0000-4000-8000-000000000002''','Kode SKU sudah memiliki riwayat');
select pg_temp.code_reject('select change_master_data_lifecycle(''items'',''cc200000-0000-4000-8000-000000000002'',''trash'',0,''JSON rename then trash'')','pemakaian atau riwayat');
-- Re-saving the same code, or changing ordinary fields, must remain available.
update items set code='CODE-USED',name='Fictional corrected name',sell_price=123 where id='cc200000-0000-4000-8000-000000000001';
select pg_temp.code_check((select name='Fictional corrected name' and sell_price=123 from items where id='cc200000-0000-4000-8000-000000000001'),'ordinary edits and identical code remain permitted');
select change_master_data_lifecycle('items','cc200000-0000-4000-8000-000000000001','archive',0,'Keep code history while inactive');
-- No code provenance: rename is still allowed, including with UUID-only config.
update items set code='CODE-UNUSED-RENAMED' where id='cc200000-0000-4000-8000-000000000003';
select change_master_data_lifecycle('items','cc200000-0000-4000-8000-000000000003','trash',0,'Unused renamed SKU');
select change_master_data_lifecycle('items','cc200000-0000-4000-8000-000000000003','restore',1,'Restore unused renamed SKU');
update items set code='CODE-UUID-RENAMED' where id='cc200000-0000-4000-8000-000000000004';
select pg_temp.code_check((select code='CODE-UUID-RENAMED' from items where id='cc200000-0000-4000-8000-000000000004'),'UUID-only dependency does not freeze a code');
select pg_temp.code_reject('select change_master_data_lifecycle(''items'',''cc200000-0000-4000-8000-000000000004'',''trash'',0,''UUID reference remains'')','pemakaian atau riwayat');
select pg_temp.code_check((select source_code='CODE-USED' and payload='{}'::jsonb from import_run_rows where run_id='cc300000-0000-4000-8000-000000000001' and source_row=1),'source-code provenance is unchanged');
select pg_temp.code_check((select payload='{"source":{"code":" code-json-used "}}'::jsonb from import_run_rows where run_id='cc300000-0000-4000-8000-000000000001' and source_row=2),'JSON provenance is unchanged');
rollback;
