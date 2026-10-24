-- Fictional PostgreSQL acceptance. Requires real migrations in an owned isolated DB.
begin;
insert into auth.users(id) values
 ('d6000000-0000-4000-8000-000000000001'),('d6000000-0000-4000-8000-000000000002'),('d6000000-0000-4000-8000-000000000003');
insert into profiles(id,role,is_active) values
 ('d6000000-0000-4000-8000-000000000001','OWNER',true),('d6000000-0000-4000-8000-000000000002','STAFF',true),('d6000000-0000-4000-8000-000000000003','ADMIN',true)
 on conflict(id)do update set role=excluded.role,is_active=excluded.is_active;
insert into branches(id,code,name,type,is_active) values('d6100000-0000-4000-8000-000000000001','QA-DP','Fiction DP branch','KLINIK',true);
insert into suppliers(id,nama) values('d6300000-0000-4000-8000-000000000001','Fiction DP supplier'),('d6300000-0000-4000-8000-000000000002','Fiction other supplier');
insert into coa_accounts(code,name,type,normal_balance) values('1196','Fiction DP cash','ASET','D'),('2101','Fiction DP payable','LIABILITAS','K') on conflict(code)do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code,is_active) values('d6700000-0000-4000-8000-000000000001','Fiction DP bank','Bank','1196',true);
insert into purchase_orders(id,no_po,supplier_id,branch_id,status,total) values
 ('d6400000-0000-4000-8000-000000000001','PO.QA.CAP','d6300000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','Draft',600000),
 ('d6400000-0000-4000-8000-000000000002','PO.QA.RECEIVED','d6300000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','Diterima',600000),
 ('d6400000-0000-4000-8000-000000000003','PO.QA.ROLLBACK','d6300000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','Dipesan',600000);
set local role authenticated;
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='d6000000-0000-4000-8000-000000000001';
do $$declare a jsonb;b jsonb;failed boolean;message text;begin
 failed:=false;begin perform pay_purchase_advance_atomic('over','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001',current_date,1000000,'Transfer','d6700000-0000-4000-8000-000000000001',null);exception when sqlstate '22003' then failed:=true;end;
 if not failed then raise exception 'excess advance accepted';end if;
 a:=pay_purchase_advance_atomic('first','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001',current_date,400000,'Transfer','d6700000-0000-4000-8000-000000000001',null);
 failed:=false;begin perform pay_purchase_advance_atomic('cumulative','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001',current_date,200001,'Transfer','d6700000-0000-4000-8000-000000000001',null);exception when sqlstate '22003' then failed:=true;end;
 if not failed then raise exception 'cumulative excess accepted';end if;
 b:=pay_purchase_advance_atomic('exact','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001',current_date,200000,'Transfer','d6700000-0000-4000-8000-000000000001',null);
 if b is distinct from pay_purchase_advance_atomic('exact','UM.CHANGED.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001',current_date,200000,'Transfer','d6700000-0000-4000-8000-000000000001',null) then raise exception 'retry receipt changed';end if;
 if (select sum(jumlah) from purchase_advances where po_id='d6400000-0000-4000-8000-000000000001' and status='aktif')<>600000 then raise exception 'exact cap mismatch';end if;
 if (select sum(debit) from journal_lines where entry_id=(b->>'journal_id')::uuid)<>200000 or (select sum(credit) from journal_lines where entry_id=(b->>'journal_id')::uuid)<>200000 then raise exception 'journal mismatch';end if;
 failed:=false;begin perform pay_purchase_advance_atomic('exact','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001',current_date,1,'Transfer','d6700000-0000-4000-8000-000000000001',null);exception when sqlstate '22023' then failed:=true;end;
 if not failed then raise exception 'changed retry accepted';end if;
 failed:=false;begin perform pay_purchase_advance_atomic('received','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000002',current_date,1,'Transfer','d6700000-0000-4000-8000-000000000001',null);exception when sqlstate '55000' then failed:=true;end;
 if not failed then raise exception 'received PO accepted advance';end if;
 failed:=false;begin perform pay_purchase_advance_atomic('supplier','UM.QA.',5,'d6300000-0000-4000-8000-000000000002','d6400000-0000-4000-8000-000000000003',current_date,1,'Transfer','d6700000-0000-4000-8000-000000000001',null);exception when sqlstate '22023' then failed:=true;end;
 if not failed then raise exception 'other supplier accepted';end if;
 if get_purchase_advance_result('exact') is distinct from b then raise exception 'durable recovery mismatch';end if;
end$$;
-- The existing cancellation action requires a complete reverse journal before
-- status=batal; a direct status write must not release capacity without it.
do $$declare failed boolean:=false;begin
 begin update purchase_advances set status='batal' where id=(get_purchase_advance_result('exact')->>'advance_id')::uuid;exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'unbacked cancellation released PO capacity';end if;
end$$;
reset role;
-- Fail after the advance insert, inside the real journal writer. All source writes must roll back.
create function public.qa_dp_fail_journal()returns trigger language plpgsql as $$begin if new.source='purchase-advance' then raise exception 'fictional journal failure';end if;return new;end$$;
create trigger qa_dp_fail_journal before insert on journal_entries for each row execute function qa_dp_fail_journal();
set local role authenticated;
do $$declare n bigint;failed boolean:=false;begin
 select count(*) into n from purchase_advances;
 begin perform pay_purchase_advance_atomic('journal-fail','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000003',current_date,100,'Transfer','d6700000-0000-4000-8000-000000000001',null);exception when others then if sqlerrm<>'fictional journal failure' then raise;end if;failed:=true;end;
 if not failed or (select count(*) from purchase_advances)<>n then raise exception 'journal failure left partial advance';end if;
end$$;
reset role;drop trigger qa_dp_fail_journal on journal_entries;drop function qa_dp_fail_journal();
set local role authenticated;
set local request.jwt.claim.sub='d6000000-0000-4000-8000-000000000002';
do $$declare failed boolean:=false;begin
 begin perform pay_purchase_advance_atomic('staff','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000003',current_date,1,'Transfer','d6700000-0000-4000-8000-000000000001',null);exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'STAFF created advance';end if;

end$$;
reset role;set local role authenticated;set local request.jwt.claim.sub='d6000000-0000-4000-8000-000000000003';
do $$begin if get_purchase_advance_result('exact') is not null then raise exception 'another actor recovered receipt';end if;end$$;
reset role;
set local request.jwt.claim.sub='d6000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare amount numeric;failed boolean;begin
 foreach amount in array array[0::numeric,-1,1.001,'NaN'::numeric,'Infinity'::numeric]loop
  failed:=false;begin perform pay_purchase_advance_atomic('bad-'||amount,'UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000003',current_date,amount,'Transfer','d6700000-0000-4000-8000-000000000001',null);exception when sqlstate '22023' then failed:=true;end;
  if not failed then raise exception 'invalid money accepted: %',amount;end if;
 end loop;
 failed:=false;begin insert into purchase_advances(no_um,supplier_id,jumlah)values('UM.DIRECT','d6300000-0000-4000-8000-000000000001',1);exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'direct source insert bypassed atomic path';end if;
 failed:=false;begin delete from journal_entries where id=(get_purchase_advance_result('exact')->>'journal_id')::uuid;exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'direct journal delete bypassed source protection';end if;
end$$;
reset role;

do $$begin
 if exists(select 1 from purchase_advance_requests where request_key in('journal-fail','over','cumulative','received','supplier','staff')) then raise exception 'failed attempt left durable request';end if;
end$$;
insert into branches(id,code,name,type,is_active)values('d6100000-0000-4000-8000-000000000002','QA-DP-OTHER','Fiction other branch','KLINIK',true);
insert into coa_accounts(code,name,type,normal_balance)values('1197','Fiction other cash','ASET','D');
insert into cash_accounts(id,nama,jenis,coa_code,branch_id,is_active)values('d6700000-0000-4000-8000-000000000002','Fiction other bank','Bank','1197','d6100000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$declare failed boolean:=false;begin
 begin perform pay_purchase_advance_atomic('wrong-bank','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000003',current_date,1,'Transfer','d6700000-0000-4000-8000-000000000002',null);exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'cross-branch account accepted';end if;
end$$;
reset role;
-- Optional-PO DP must keep working under the existing operational branch context.
set local request.headers='{"x-kamo-operational-branch":"d6100000-0000-4000-8000-000000000001"}';
set local role authenticated;
do $$declare receipt jsonb;failed boolean:=false;begin
 receipt:=pay_purchase_advance_atomic('unbound-context','UM.QA.',5,'d6300000-0000-4000-8000-000000000001',null,current_date,700000,'Transfer','d6700000-0000-4000-8000-000000000001',null);
 if (select branch_id from journal_entries where id=(receipt->>'journal_id')::uuid) is distinct from 'd6100000-0000-4000-8000-000000000001'::uuid then raise exception 'unbound selected branch was lost';end if;
 begin perform pay_purchase_advance_atomic('unbound-wrong-bank','UM.QA.',5,'d6300000-0000-4000-8000-000000000001',null,current_date,1,'Transfer','d6700000-0000-4000-8000-000000000002',null);exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'unbound advance crossed operational branch';end if;
end$$;
reset role;set local request.headers='{}';set local role authenticated;
do $$declare receipt jsonb;begin
 receipt:=pay_purchase_advance_atomic('unbound-bank','UM.QA.',5,'d6300000-0000-4000-8000-000000000001',null,current_date,1,'Transfer','d6700000-0000-4000-8000-000000000002',null);
 if (select branch_id from journal_entries where id=(receipt->>'journal_id')::uuid) is distinct from 'd6100000-0000-4000-8000-000000000002'::uuid then raise exception 'unbound source-bank branch was lost';end if;
end$$;
reset role;
set local role authenticated;
do $$declare a jsonb;b jsonb;begin
 a:=pay_purchase_advance_atomic('to-cancel','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000003',current_date,100,'Transfer','d6700000-0000-4000-8000-000000000001',null);
 b:=cancel_purchase_advance_atomic((a->>'advance_id')::uuid);
 if b is distinct from cancel_purchase_advance_atomic((a->>'advance_id')::uuid) then raise exception 'full cancellation retry changed receipt';end if;
 if (select status from purchase_advances where id=(a->>'advance_id')::uuid)<>'batal' then raise exception 'full cancellation not recorded';end if;
 if (select sum(l.debit-l.credit) from journal_lines l where l.entry_id in((a->>'journal_id')::uuid,(b->>'journal_id')::uuid) and l.account_id=(select id from coa_accounts where code='1303'))<>0 then raise exception 'original and refund do not reconcile';end if;
 perform pay_purchase_advance_atomic('after-refund','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000003',current_date,600000,'Transfer','d6700000-0000-4000-8000-000000000001',null);
end$$;
reset role;
create function public.qa_dp_fail_refund()returns trigger language plpgsql as $$begin if new.source='purchase-advance-void' then raise exception 'fictional refund failure';end if;return new;end$$;
create trigger qa_dp_fail_refund before insert on journal_entries for each row execute function qa_dp_fail_refund();
set local role authenticated;
do $$declare failed boolean:=false;adv uuid;begin
 adv:=(get_purchase_advance_result('after-refund')->>'advance_id')::uuid;
 begin perform cancel_purchase_advance_atomic(adv);exception when others then if sqlerrm<>'fictional refund failure' then raise;end if;failed:=true;end;
 if not failed or (select status from purchase_advances where id=adv)<>'aktif' then raise exception 'failed refund released capacity';end if;
end$$;
reset role;drop trigger qa_dp_fail_refund on journal_entries;drop function qa_dp_fail_refund();
insert into purchase_orders(id,no_po,supplier_id,branch_id,status,total) values('d6400000-0000-4000-8000-000000000004','PO.QA.LEGACY','d6300000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','Draft',100);
insert into purchase_advances(no_um,supplier_id,po_id,jumlah,status)values('UM.LEGACY.UNPROVEN','d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000004',100,'batal');
set local role authenticated;
do $$declare failed boolean:=false;begin
 begin perform pay_purchase_advance_atomic('unproven-legacy','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000004',current_date,100,'Transfer','d6700000-0000-4000-8000-000000000001',null);exception when sqlstate '55000' then failed:=true;end;
 if not failed then raise exception 'unproven legacy refund released capacity';end if;
end$$;
reset role;
-- A provable legacy full refund releases capacity without rewriting its source.
select clinic_write_journal(current_date,'Fiction legacy source','purchase-advance','UM.LEGACY.UNPROVEN','d6100000-0000-4000-8000-000000000001',
 '[{"code":"1303","debit":100,"credit":0},{"code":"1196","debit":0,"credit":100}]');
select clinic_write_journal(current_date,'Fiction legacy reversal','purchase-advance-void','UM.LEGACY.UNPROVEN','d6100000-0000-4000-8000-000000000001',
 '[{"code":"1196","debit":100,"credit":0},{"code":"1303","debit":0,"credit":100}]');
set local role authenticated;
select pay_purchase_advance_atomic('proven-legacy','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000004',current_date,100,'Transfer','d6700000-0000-4000-8000-000000000001',null);
reset role;
-- Existing payment correction may restore an advance to net zero allocation.
-- Historical allocation rows alone must not forbid its established full refund.
insert into warehouses(id,branch_id,code,name,type)values('d6900000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','QA-DP-WH','Fiction DP warehouse','VET');
insert into purchase_invoices(id,no_faktur,supplier_id,branch_id,warehouse_id,tanggal,total)values
 ('d6800000-0000-4000-8000-000000000001','FB.QA.DP','d6300000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','d6900000-0000-4000-8000-000000000001',current_date,100);
set local role authenticated;
do $$declare adv uuid;pay jsonb;failed boolean:=false;begin
 adv:=(get_purchase_advance_result('unbound-context')->>'advance_id')::uuid;
 pay:=pay_purchase_invoice_atomic('allocate-dp','d6800000-0000-4000-8000-000000000001',current_date,100,'Transfer',null,'d6700000-0000-4000-8000-000000000001',adv);
 begin perform cancel_purchase_advance_atomic(adv);exception when sqlstate '55000' then failed:=true;end;
 if not failed then raise exception 'allocated advance was refunded';end if;
 perform cancel_purchase_payment((pay->>'payment_id')::uuid,0,'restore-dp','Fiction wrong allocation');
 perform cancel_purchase_advance_atomic(adv);
 if (select terpakai from purchase_advances where id=adv)<>0 then raise exception 'reversed allocation not reconciled';end if;
end$$;
reset role;
update accounting_locks set closed_until=current_date where id;
update purchase_orders set status='Diterima' where id='d6400000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare prior jsonb;failed boolean:=false;begin
 prior:=get_purchase_advance_result('exact');
 if pay_purchase_advance_atomic('exact','UM.OTHER.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001',current_date,200000,'Transfer','d6700000-0000-4000-8000-000000000001',null) is distinct from prior then raise exception 'received/closed recovery failed';end if;
 begin perform pay_purchase_advance_atomic('closed','UM.QA.',5,'d6300000-0000-4000-8000-000000000001',null,current_date,1,'Transfer','d6700000-0000-4000-8000-000000000001',null);exception when sqlstate '55000' then failed:=true;end;
 if not failed then raise exception 'closed period accepted new advance';end if;
end$$;
reset role;update accounting_locks set closed_until=null where id;
insert into purchase_orders(id,no_po,supplier_id,branch_id,status,total) values('d6400000-0000-4000-8000-000000000005','PO.QA.INACTIVE','d6300000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','Draft',100);
update branches set is_active=false where id='d6100000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare failed boolean:=false;begin
 begin perform pay_purchase_advance_atomic('inactive-branch','UM.QA.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000005',current_date,1,'Transfer','d6700000-0000-4000-8000-000000000001',null);exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'inactive branch accepted new advance';end if;
end$$;
rollback;
