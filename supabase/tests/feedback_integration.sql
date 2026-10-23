-- Synthetic combined A01 / recoverable import / atomic DP acceptance only.
begin;
do $$begin
 if to_regclass('public.activity_log')is null or to_regprocedure('public.pay_purchase_advance_atomic(text,text,integer,uuid,uuid,date,numeric,text,uuid,text)')is null
 or to_regprocedure('public.prepare_accurate_initial_stock(text,text,uuid,uuid,date,jsonb,text)')is null then raise exception 'Combined feedback migrations missing';end if;
end$$;
insert into auth.users(id)values(md5('integration-owner')::uuid),(md5('integration-other-owner')::uuid);
update profiles set role='OWNER',is_active=true where id in(md5('integration-owner')::uuid,md5('integration-other-owner')::uuid);
insert into branches(id,code,name,type)values(md5('integration-branch')::uuid,'INT-A','Fiction integration A','PETSHOP'),(md5('integration-other')::uuid,'INT-B','Fiction integration B','PETSHOP');
insert into warehouses(id,branch_id,code,name,type)values(md5('integration-wh')::uuid,md5('integration-branch')::uuid,'INT-W','Fiction integration warehouse','RETAIL');
insert into suppliers(id,nama)values(md5('integration-supplier')::uuid,'Fiction integration supplier');
insert into coa_accounts(code,name,type,normal_balance)values('1196','Fiction integration bank','ASET','D'),('1301','Fiction integration inventory','ASET','D'),('3101','Fiction integration equity','EKUITAS','K')on conflict(code)do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code,branch_id)values(md5('integration-bank')::uuid,'Fiction integration bank','Bank','1196',md5('integration-branch')::uuid);
insert into purchase_orders(id,no_po,supplier_id,branch_id,status,total)values(md5('integration-po')::uuid,'PO.INTEGRATION',md5('integration-supplier')::uuid,md5('integration-branch')::uuid,'Draft',1000),
(md5('integration-other-po')::uuid,'PO.INTEGRATION.OTHER',md5('integration-supplier')::uuid,md5('integration-other')::uuid,'Draft',1000);
insert into items(id,code,name,unit,item_type)values(md5('integration-item')::uuid,'INT-I','Fiction integration item','pcs','Persediaan');
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',md5('integration-owner')::uuid::text,true);
do $$declare a jsonb;n bigint;blocked boolean:=false;begin
 a:=pay_purchase_advance_atomic('integration-dp','UM.INT.',5,md5('integration-supplier')::uuid,md5('integration-po')::uuid,current_date,400,'Transfer',md5('integration-bank')::uuid,null);
 if not exists(select 1 from activity_log where row_entity='purchase_advances' and row_id=a->>'advance_id' and action='create' and actor_id=auth.uid())then raise exception 'Atomic DP missing authenticated source audit';end if;
 if not exists(select 1 from activity_log where row_entity='journal_entries' and row_id=a->>'journal_id' and action='create')then raise exception 'Atomic DP missing journal audit';end if;
 select count(*)into n from activity_log;
 if a is distinct from pay_purchase_advance_atomic('integration-dp','UM.INT.',5,md5('integration-supplier')::uuid,md5('integration-po')::uuid,current_date,400,'Transfer',md5('integration-bank')::uuid,null)or(select count(*)from activity_log)<>n then raise exception 'DP retry duplicated source/audit';end if;
 begin perform * from purchase_advance_requests;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Private request receipt exposed';end if;
 perform set_config('request.headers',jsonb_build_object('x-kamo-operational-branch',md5('integration-branch')::uuid)::text,true);blocked:=false;
 begin perform pay_purchase_advance_atomic('integration-wrong-branch','UM.INT.',5,md5('integration-supplier')::uuid,md5('integration-other-po')::uuid,current_date,1,'Transfer',md5('integration-bank')::uuid,null);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Combined DP crossed selected branch';end if;
 perform set_config('request.headers','{}',true);
 perform set_config('request.jwt.claim.sub',md5('integration-other-owner')::uuid::text,true);
 if get_purchase_advance_result('integration-dp')is not null then raise exception 'Another actor recovered private DP receipt';end if;
 perform set_config('request.jwt.claim.sub',md5('integration-owner')::uuid::text,true);
end$$;
reset role;
create function pg_temp.fail_integration_audit()returns trigger language plpgsql as $$begin
 if new.row_entity='journal_lines' then raise exception 'Integration audit append failure';end if;return new;end$$;
create trigger integration_audit_failure before insert on activity_log for each row execute function pg_temp.fail_integration_audit();
set local role authenticated;
do $$declare n bigint;j bigint;a bigint;blocked boolean:=false;begin
 select count(*)into n from purchase_advances;select count(*)into j from journal_entries;select count(*)into a from activity_log;
 begin perform pay_purchase_advance_atomic('integration-audit-fail','UM.INT.',5,md5('integration-supplier')::uuid,md5('integration-po')::uuid,current_date,100,'Transfer',md5('integration-bank')::uuid,null);
 exception when others then if sqlerrm<>'Integration audit append failure'then raise;end if;blocked:=true;end;
 if not blocked or(select count(*)from purchase_advances)<>n or(select count(*)from journal_entries)<>j or(select count(*)from activity_log)<>a then raise exception 'Audit failure leaked DP/journal/audit';end if;
 if get_purchase_advance_result('integration-audit-fail')is not null then raise exception 'Audit failure left acknowledged receipt';end if;
end$$;
reset role;drop trigger integration_audit_failure on activity_log;
-- The SAME preparation/posting calls must remain idempotent with audit capture.
set local role authenticated;
do $$declare rows jsonb;run uuid;p jsonb;r jsonb;n bigint;eq uuid;begin
 rows:=jsonb_build_array(jsonb_build_object('source_row',2,'source_code','INT-I','status','valid','payload',jsonb_build_object('item_id',md5('integration-item')::uuid,'warehouse_id',md5('integration-wh')::uuid,'base_qty',10,'base_unit_cost',12.5,'as_of','2026-01-01','source_values',jsonb_build_array(jsonb_build_object('qty','10','unit_cost','12.5','factor','1','unit','pcs')))));
 run:=prepare_accurate_initial_stock('integration-stock','fiction.csv',md5('integration-branch')::uuid,md5('integration-wh')::uuid,'2026-01-01',rows,'STRICT');
 if not exists(select 1 from activity_log where row_entity='import_runs'and row_id=run::text and action='create')then raise exception 'Prepared import missing metadata audit';end if;
 if exists(select 1 from activity_log where row_entity in('import_runs','import_run_rows')and (after_state::text like '%source_values%'or after_state::text like '%fiction.csv%'))then raise exception 'Import audit leaked source payload';end if;
 select count(*)into n from activity_log;select id into eq from coa_accounts where code='3101';p:=preview_accurate_inventory_accounting(run,eq);
 if not(p->>'can_post')::boolean or(select count(*)from activity_log)<>n then raise exception 'Review blocked or wrote audit';end if;
 r:=post_accurate_inventory_accounting(run,eq,p,'Fiction integration review');select count(*)into n from activity_log;
 if r is distinct from post_accurate_inventory_accounting(run,eq,p,'Fiction integration review')or(select count(*)from activity_log)<>n then raise exception 'Import retry duplicated audited financial effects';end if;
 if prepare_accurate_initial_stock('integration-stock','fiction.csv',md5('integration-branch')::uuid,md5('integration-wh')::uuid,'2026-01-01',rows,'STRICT')<>run then raise exception 'Preparation retry changed run';end if;
 if(select sum(qty)from stock_moves where source_ref=run::text)<>10 or(select sum(qty_in*unit_cost)from stock_layers where source_ref=run::text)<>125
 or(select sum(debit)from journal_lines where entry_id=(r->>'entry_id')::uuid)<>125 or(select sum(debit-credit)from journal_lines where entry_id=(r->>'entry_id')::uuid)<>0 then raise exception 'Combined import quantity/value/journal reconciliation failed';end if;
 if not exists(select 1 from activity_log where row_entity='journal_entries'and row_id=r->>'entry_id')then raise exception 'Opening journal missing source audit';end if;
end$$;
reset role;
-- Cancelling a DP must roll back its refund if the final audit append fails.
create or replace function pg_temp.fail_integration_audit()returns trigger language plpgsql as $$begin
 if new.row_entity='purchase_advances'and new.action='update'then raise exception 'Integration cancellation audit failure';end if;return new;end$$;
create trigger integration_audit_failure before insert on activity_log for each row execute function pg_temp.fail_integration_audit();
set local role authenticated;
do $$declare a jsonb;n bigint;j bigint;blocked boolean:=false;begin
 a:=get_purchase_advance_result('integration-dp');select count(*)into n from activity_log;select count(*)into j from journal_entries;
 begin perform cancel_purchase_advance_atomic((a->>'advance_id')::uuid);exception when others then if sqlerrm<>'Integration cancellation audit failure'then raise;end if;blocked:=true;end;
 if not blocked or(select status from purchase_advances where id=(a->>'advance_id')::uuid)<>'aktif'or(select count(*)from activity_log)<>n or(select count(*)from journal_entries)<>j then raise exception 'Cancellation audit failure released DP capacity/refund';end if;
end$$;
reset role;drop trigger integration_audit_failure on activity_log;set local role authenticated;
do $$declare a jsonb;r jsonb;n bigint;begin
 a:=get_purchase_advance_result('integration-dp');r:=cancel_purchase_advance_atomic((a->>'advance_id')::uuid);select count(*)into n from activity_log;
 if r is distinct from cancel_purchase_advance_atomic((a->>'advance_id')::uuid)or(select count(*)from activity_log)<>n then raise exception 'Cancellation retry duplicated refund audit';end if;
 if not exists(select 1 from activity_log where row_entity='purchase_advances'and row_id=a->>'advance_id'and action='update')then raise exception 'Cancelled DP missing source update audit';end if;
end$$;
rollback;
