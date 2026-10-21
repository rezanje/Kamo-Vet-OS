-- Fictional financial fixtures only; always execute with the disposable runner.
begin;
insert into auth.users(id) values(md5('ag-owner')::uuid),(md5('ag-admin')::uuid);
alter table profiles disable trigger guard_profile_privileges;
update profiles set role=case when id=md5('ag-owner')::uuid then 'OWNER'::user_role else 'ADMIN'::user_role end,is_active=true where id in(md5('ag-owner')::uuid,md5('ag-admin')::uuid);
alter table profiles enable trigger guard_profile_privileges;
insert into branches(id,code,name,type) values(md5('ag-branch')::uuid,'AG-A','Guard fiction A','PETSHOP'),(md5('ag-other')::uuid,'AG-B','Guard fiction B','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values(md5('ag-wh')::uuid,md5('ag-branch')::uuid,'AG-W','Guard fiction W','RETAIL');
insert into coa_accounts(code,name,type,normal_balance,is_header) values('1301','Fiction inventory','ASET','D',false),('3101','Fiction equity','EKUITAS','K',false) on conflict(code) do update set is_active=true,is_header=false;
create function pg_temp.ag_run(label text) returns uuid language plpgsql as $$
declare run uuid:=md5('ag-run-'||label)::uuid; item uuid:=md5('ag-item-'||label)::uuid;
begin
 insert into items(id,code,name,unit,item_type) values(item,'AG-'||label,'Guard fiction '||label,'pcs','Persediaan');
 insert into import_runs(id,kind,source_name,source_hash,branch_id,warehouse_id,as_of_date,created_by,summary)
 values(run,'initial_stock','fiction.xlsx','ag-hash-'||label,md5('ag-branch')::uuid,md5('ag-wh')::uuid,'2026-01-01',md5('ag-owner')::uuid,'{"valid":1}');
 insert into import_run_rows(run_id,source_row,status,payload) values(run,1,'valid',jsonb_build_object('item_id',item,'warehouse_id',md5('ag-wh')::uuid,'base_qty',10,'base_unit_cost',12.5,'as_of','2026-01-01'));
 return run;
end $$;
create function pg_temp.ag_error(command text,expected_code text) returns void language plpgsql as $$
declare denied boolean:=false;
begin
 begin execute command; exception when others then
  if sqlstate<>expected_code then raise exception 'Wrong rejection %, wanted %: %',sqlstate,expected_code,sqlerrm;end if;
  denied:=true;
 end;
 if not denied then raise exception 'Expected rejection % for %',expected_code,command;end if;
end $$;

savepoint scenario;
select pg_temp.ag_run('permission');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('ag-admin')::uuid::text,true);
select pg_temp.ag_error($q$select preview_accurate_inventory_accounting(md5('ag-run-permission')::uuid,(select id from coa_accounts where code='3101'))$q$,'42501');
select pg_temp.ag_error($q$select post_accurate_inventory_accounting(md5('ag-run-permission')::uuid,(select id from coa_accounts where code='3101'),'{}','Fiction approval')$q$,'42501');
select set_config('request.jwt.claim.sub',md5('ag-owner')::uuid::text,true);
select set_config('request.headers',jsonb_build_object('x-kamo-operational-branch',md5('ag-other')::uuid)::text,true);
select pg_temp.ag_error($q$select preview_accurate_inventory_accounting(md5('ag-run-permission')::uuid,(select id from coa_accounts where code='3101'))$q$,'42501');
rollback to scenario;
select pg_temp.ag_run('inactive');
alter table profiles disable trigger guard_profile_privileges;
update profiles set is_active=false where id=md5('ag-owner')::uuid;
alter table profiles enable trigger guard_profile_privileges;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('ag-owner')::uuid::text,true);
select pg_temp.ag_error($q$select preview_accurate_inventory_accounting(md5('ag-run-inactive')::uuid,(select id from coa_accounts where code='3101'))$q$,'42501');
select pg_temp.ag_error($q$select post_accurate_inventory_accounting(md5('ag-run-inactive')::uuid,(select id from coa_accounts where code='3101'),'{}','Fiction approval')$q$,'42501');
rollback to scenario;

select pg_temp.ag_run('mixed');
update import_run_rows set payload=payload||jsonb_build_object('branch_id',md5('ag-other')::uuid) where run_id=md5('ag-run-mixed')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('ag-owner')::uuid::text,true);
do $$ declare p jsonb;eq uuid;begin
 select id into eq from coa_accounts where code='3101';p:=preview_accurate_inventory_accounting(md5('ag-run-mixed')::uuid,eq);
 if (p->>'can_post')::boolean then raise exception 'Mixed branch payload accepted';end if;
 perform pg_temp.ag_error(format('select post_accurate_inventory_accounting(%L::uuid,%L::uuid,%L::jsonb,%L)',md5('ag-run-mixed')::uuid,eq,p,'Fiction approved equity'),'22023');
end $$;
rollback to scenario;

select pg_temp.ag_run('closed');
update accounting_locks set closed_until='2026-01-01' where id;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('ag-owner')::uuid::text,true);
do $$ declare p jsonb;eq uuid;begin
 select id into eq from coa_accounts where code='3101';p:=preview_accurate_inventory_accounting(md5('ag-run-closed')::uuid,eq);
 if (p->>'can_post')::boolean or not (p->'blockers') @> '["Periode akuntansi sudah ditutup"]'::jsonb then raise exception 'Closed period accepted: %',p;end if;
 perform pg_temp.ag_error(format('select post_accurate_inventory_accounting(%L::uuid,%L::uuid,%L::jsonb,%L)',md5('ag-run-closed')::uuid,eq,p,'Fiction approved equity'),'22023');
end $$;
rollback to scenario;

select pg_temp.ag_run('missing-lock');
delete from accounting_locks;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('ag-owner')::uuid::text,true);
do $$ declare p jsonb;begin
 p:=preview_accurate_inventory_accounting(md5('ag-run-missing-lock')::uuid,(select id from coa_accounts where code='3101'));
 if (p->>'can_post')::boolean then raise exception 'Missing accounting period configuration accepted';end if;
end $$;
rollback to scenario;

select pg_temp.ag_run('counterpart');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('ag-owner')::uuid::text,true);
do $$ declare p jsonb;begin
 p:=preview_accurate_inventory_accounting(md5('ag-run-counterpart')::uuid,(select id from coa_accounts where code='1301'));
 if (p->>'can_post')::boolean then raise exception 'Non-equity counterpart accepted';end if;
end $$;
rollback to scenario;

select pg_temp.ag_run('partial');
update import_runs set summary='{"valid":2}' where id=md5('ag-run-partial')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('ag-owner')::uuid::text,true);
do $$ declare p jsonb;begin
 p:=preview_accurate_inventory_accounting(md5('ag-run-partial')::uuid,(select id from coa_accounts where code='3101'));
 if (p->>'can_post')::boolean or not (p->'blockers') @> '["Batch belum lengkap atau jumlah baris berubah; buat preview impor ulang"]'::jsonb then raise exception 'Partially persisted batch accepted: %',p;end if;
end $$;
rollback to scenario;

select pg_temp.ag_run('stale');
create temp table ag_preview(value jsonb);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('ag-owner')::uuid::text,true);
reset role;
insert into ag_preview select preview_accurate_inventory_accounting(md5('ag-run-stale')::uuid,(select id from coa_accounts where code='3101'));
update import_run_rows set payload=jsonb_set(payload,'{base_unit_cost}','20') where run_id=md5('ag-run-stale')::uuid;
grant select on ag_preview to authenticated;
set local role authenticated;
do $$ declare p jsonb;eq uuid;begin
 select value into p from ag_preview;select id into eq from coa_accounts where code='3101';
 perform pg_temp.ag_error(format('select post_accurate_inventory_accounting(%L::uuid,%L::uuid,%L::jsonb,%L)',md5('ag-run-stale')::uuid,eq,p,'Fiction approved equity'),'22023');
 if exists(select 1 from stock_moves where source_ref=md5('ag-run-stale')::uuid::text) then raise exception 'Stale preview wrote stock';end if;
end $$;
rollback to scenario;

select pg_temp.ag_run('atomic');
create function pg_temp.ag_fail_journal() returns trigger language plpgsql as $$begin
 if exists(select 1 from public.journal_entries where id=new.entry_id and source='accurate-stock-opening') then raise exception 'FICTION_INJECTED_JOURNAL_FAILURE';end if;return new;
end $$;
create trigger ag_injected_failure before insert on journal_lines for each row execute function pg_temp.ag_fail_journal();
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('ag-owner')::uuid::text,true);
do $$ declare p jsonb;eq uuid;begin
 select id into eq from coa_accounts where code='3101';p:=preview_accurate_inventory_accounting(md5('ag-run-atomic')::uuid,eq);
 if not (p->>'can_post')::boolean then raise exception 'Atomic fixture was already blocked';end if;
 begin
  perform post_accurate_inventory_accounting(md5('ag-run-atomic')::uuid,eq,p,'Fiction approved equity');
  raise exception 'Failure injection did not execute';
 exception when raise_exception then if sqlerrm<>'FICTION_INJECTED_JOURNAL_FAILURE' then raise;end if;end;
 if exists(select 1 from stock where item_id=md5('ag-item-atomic')::uuid)
  or exists(select 1 from stock_layers where source_ref=md5('ag-run-atomic')::uuid::text)
  or exists(select 1 from stock_moves where source_ref=md5('ag-run-atomic')::uuid::text)
  or exists(select 1 from journal_entries where source_ref=md5('ag-run-atomic')::uuid::text)
  or not exists(select 1 from import_runs where id=md5('ag-run-atomic')::uuid and status='previewed')
  or not exists(select 1 from import_run_rows where run_id=md5('ag-run-atomic')::uuid and status='valid') then raise exception 'Journal failure left partial effects';end if;
end $$;
reset role;
do $$begin if exists(select 1 from accurate_inventory_accounting where run_id=md5('ag-run-atomic')::uuid) then raise exception 'Failed operation retained receipt';end if;end $$;
rollback to scenario;

-- Historical values preserve the original as-of source, even after Rp82,000 HPP.
select pg_temp.ag_run('historical');
update import_runs set status='posted',posted_at=now(),summary='{"valid":2}' where id=md5('ag-run-historical')::uuid;
update import_run_rows set status='posted',payload=jsonb_set(jsonb_set(payload,'{base_qty}','1'),'{base_unit_cost}','133458798.02') where run_id=md5('ag-run-historical')::uuid;
insert into import_run_rows(run_id,source_row,status,payload)
 select run_id,2,'posted',jsonb_set(payload,'{base_unit_cost}','82000') from import_run_rows where run_id=md5('ag-run-historical')::uuid;
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source,source_ref)
 values(md5('ag-wh')::uuid,md5('ag-item-historical')::uuid,'2026-01-01',1,1,133458798.02,'saldo-awal-accurate',md5('ag-run-historical')::uuid::text),
 (md5('ag-wh')::uuid,md5('ag-item-historical')::uuid,'2026-01-01',1,0,82000,'saldo-awal-accurate',md5('ag-run-historical')::uuid::text);
insert into stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref)
 values('2026-01-01',md5('ag-wh')::uuid,md5('ag-item-historical')::uuid,1,133458798.02,'saldo-awal-accurate',md5('ag-run-historical')::uuid::text),
 ('2026-01-01',md5('ag-wh')::uuid,md5('ag-item-historical')::uuid,1,82000,'saldo-awal-accurate',md5('ag-run-historical')::uuid::text);
insert into stock(warehouse_id,item_id,qty) values(md5('ag-wh')::uuid,md5('ag-item-historical')::uuid,1);
insert into stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values('2026-01-02',md5('ag-wh')::uuid,md5('ag-item-historical')::uuid,-1,82000,'sale','fiction-consumption');
insert into journal_entries(id,no_jurnal,tanggal,source,source_ref,branch_id) values(md5('ag-global')::uuid,'AG.GLOBAL','2026-01-01','saldo-awal','2026-01-01',null);
insert into journal_lines(entry_id,account_id,debit,credit) select md5('ag-global')::uuid,id,133540798.02,0 from coa_accounts where code='1301';
insert into journal_lines(entry_id,account_id,debit,credit) select md5('ag-global')::uuid,id,0,133540798.02 from coa_accounts where code='3101';
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('ag-owner')::uuid::text,true);
do $$ declare p jsonb;eq uuid;before_moves int;before_journals int;begin
 select id into eq from coa_accounts where code='3101';
 select count(*) into before_moves from stock_moves;select count(*) into before_journals from journal_entries;
 p:=preview_accurate_inventory_accounting(md5('ag-run-historical')::uuid,eq);
 if (p->>'can_post')::boolean or (p->>'original_value')::numeric<>133540798.02 or (p->>'remaining_value')::numeric<>133458798.02 or jsonb_array_length(p#>'{evidence,other_gl}')<>2 then raise exception 'Historical reconciliation wrong: %',p;end if;
 if jsonb_array_length(p->'blockers')<>2 or (p#>>'{evidence,original_layer_value}')::numeric<>133540798.02 or (p#>>'{evidence,original_move_value}')::numeric<>133540798.02 then raise exception 'Complete historical evidence incorrectly rejected: %',p;end if;
 perform pg_temp.ag_error(format('select post_accurate_inventory_accounting(%L::uuid,%L::uuid,%L::jsonb,%L)',md5('ag-run-historical')::uuid,eq,p,'Fiction approved equity'),'22023');
 if (select count(*) from stock_moves)<>before_moves or (select count(*) from journal_entries)<>before_journals then raise exception 'Historical report applied repair';end if;
 update stock_layers set batch_no='fiction-mismatch' where source_ref=md5('ag-run-historical')::uuid::text and unit_cost=82000;
 p:=preview_accurate_inventory_accounting(md5('ag-run-historical')::uuid,eq);
 if not (p->'blockers') @> '["Rincian historis item/lot/layer/kartu berbeda dari baris impor"]'::jsonb then raise exception 'Historical wrong lot escaped reconciliation: %',p;end if;
end $$;
rollback;
