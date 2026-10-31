-- Only the owned local runner prepends the original clinic_invoice_post fixture.
-- All patient, invoice, stock and payment data below are fictional and rolled back.
insert into cash_accounts(nama,jenis,coa_code) values('Fictional K08 bank','Bank','120002') on conflict(coa_code) do update set is_active=true;
insert into prescription_items(id,medical_record_id,nama_obat,qty,harga,jenis,item_id,satuan)
values('db000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000002','Fictional base care',1,305000,'jasa',null,'kali'),
('db000000-0000-4000-8000-000000000002','d7000000-0000-4000-8000-000000000002','Fictional added medicine',2,47500,'obat','d8000000-0000-4000-8000-000000000005','pcs');
insert into public.branches(id,code,name,type) values('dc000000-0000-4000-8000-000000000001','K08-OTHER','Fictional inaccessible clinic','KLINIK');
update public.visits set branch_id='dc000000-0000-4000-8000-000000000001' where id='d6000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$declare old_id uuid;snapshot jsonb;blocked boolean:=false;
 old_plan jsonb:=jsonb_build_object('tanggal',current_date,'subtotal',415000,'discount',0,'tax',0,'total',415000,'dp_amount',0,'paid_status','Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001');
 new_plan jsonb:=jsonb_build_object('tanggal',current_date,'subtotal',400000,'discount',0,'tax',0,'total',400000,'dp_amount',0,'paid_status','Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001');
 lines jsonb:='[{"description":"Base care","qty":1,"price":305000,"kind":"jasa","item_id":null,"discount_percent":0},{"description":"Added medicine","qty":2,"price":47500,"kind":"obat","item_id":"d8000000-0000-4000-8000-000000000005","unit":"pcs","discount_percent":0}]';
begin
 -- New checkout must inherit the original posting authentication and branch guard.
 snapshot:=test_clinic_invoice_state();
 perform set_config('request.jwt.claim.sub','',true);
 begin perform clinic_post_invoice('d6000000-0000-4000-8000-000000000002','k08-no-actor',new_plan,lines);
 exception when raise_exception then if sqlerrm not like 'ACCESS_DENIED:%' then raise;end if;blocked:=true;end;
 if not blocked or test_clinic_invoice_state()<>snapshot then raise exception 'Unauthenticated posting wrote data';end if;
 perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);blocked:=false;
 begin perform clinic_post_invoice('d6000000-0000-4000-8000-000000000004','k08-foreign-branch',new_plan,lines);
 exception when raise_exception then if sqlerrm not like 'ACCESS_DENIED:%' then raise;end if;blocked:=true;end;
 if not blocked or test_clinic_invoice_state()<>snapshot then raise exception 'Cross-branch posting wrote data';end if;blocked:=false;
 old_id:=clinic_post_invoice('d6000000-0000-4000-8000-000000000001','k08-old-paid-415',old_plan,'[{"description":"Old care","qty":1,"price":415000,"kind":"jasa","item_id":null,"discount_percent":0}]');
 perform set_visit_service_state('d6000000-0000-4000-8000-000000000001','checkout');
 if (select sum(qty*harga) from prescription_items where medical_record_id='d7000000-0000-4000-8000-000000000002')<>400000 then raise exception 'Added draft source total must be400000';end if;
 if exists(select 1 from invoices where visit_id='d6000000-0000-4000-8000-000000000002') then raise exception 'Draft was incorrectly treated as an invoice';end if;
 snapshot:=test_clinic_invoice_state();
 begin perform clinic_post_invoice('d6000000-0000-4000-8000-000000000002','k08-new-400',new_plan,lines);
 exception when raise_exception then if sqlerrm not like 'STOCK_SHORT:%' then raise;end if;blocked:=true;end;
 if not blocked or test_clinic_invoice_state()<>snapshot then raise exception 'Stock failure changed stock/invoices/items/journals';end if;
 if exists(select 1 from invoice_payments where invoice_id in(select id from invoices where visit_id='d6000000-0000-4000-8000-000000000002')) then raise exception 'Failed draft received a payment';end if;
 if (select status from visits where id='d6000000-0000-4000-8000-000000000002')='Selesai' then raise exception 'Failed posting completed a visit';end if;
 if not exists(select 1 from invoices where id=old_id and total=415000 and paid_status='Lunas') then raise exception 'Old paid invoice was overwritten';end if;
end$$;
reset role;
-- Controlled fictional replenishment; no source guard or stock check is disabled.
update stock set qty=2 where warehouse_id='d3000000-0000-4000-8000-000000000001' and item_id='d8000000-0000-4000-8000-000000000005';
update stock_layers set qty_in=2,qty_left=2 where warehouse_id='d3000000-0000-4000-8000-000000000001' and item_id='d8000000-0000-4000-8000-000000000005';
-- Failure injection is owned test-only DDL, never part of the migration.
create function public.test_k08_checkout_failure() returns trigger language plpgsql as $$
begin
 if new.id='d6000000-0000-4000-8000-000000000002' and new.status='Selesai' then raise exception 'K08_TEST_CHECKOUT_FAILURE';end if;
 return new;
end$$;
create trigger test_k08_checkout_failure before update on public.visits for each row execute function public.test_k08_checkout_failure();
set local role authenticated;
do $$declare snapshot jsonb:=test_clinic_invoice_state();blocked boolean:=false;
begin
 begin perform clinic_post_invoice('d6000000-0000-4000-8000-000000000002','k08-checkout-fails',
 jsonb_build_object('tanggal',current_date,'subtotal',400000,'discount',0,'tax',0,'total',400000,'dp_amount',0,'paid_status','Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001'),
 '[{"description":"Added medicine","qty":2,"price":200000,"kind":"obat","item_id":"d8000000-0000-4000-8000-000000000005","unit":"pcs","discount_percent":0}]');
 exception when raise_exception then if sqlerrm<>'K08_TEST_CHECKOUT_FAILURE' then raise;end if;blocked:=true;end;
 if not blocked or test_clinic_invoice_state()<>snapshot then raise exception 'Checkout failure leaked financial writes';end if;
 if exists(select 1 from visit_operational_events where visit_id='d6000000-0000-4000-8000-000000000002' and event_type='check_out') then raise exception 'Failed checkout leaked event';end if;
end$$;
reset role;
drop trigger test_k08_checkout_failure on public.visits;
drop function public.test_k08_checkout_failure();
set local role authenticated;
do $$declare new_id uuid;replayed uuid;snapshot jsonb;events bigint;bad boolean:=false;split_id uuid;payments bigint;
 plan jsonb:=jsonb_build_object('tanggal',current_date,'subtotal',400000,'discount',0,'tax',0,'total',400000,'dp_amount',0,'paid_status','Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001');
 lines jsonb:='[{"description":"Base care","qty":1,"price":305000,"kind":"jasa","item_id":null,"discount_percent":0},{"description":"Added medicine","qty":2,"price":47500,"kind":"obat","item_id":"d8000000-0000-4000-8000-000000000005","unit":"pcs","discount_percent":0}]';
 parts jsonb:='[{"method":"Tunai","amount":150000,"kas_code":"110003"},{"method":"Transfer","amount":250000,"kas_code":"120002"}]';
begin
 new_id:=clinic_post_invoice('d6000000-0000-4000-8000-000000000002','k08-new-400',plan,lines);
 if (select status from visits where id='d6000000-0000-4000-8000-000000000002')<>'Selesai' then raise exception 'Paid invoice committed before checkout';end if;
 snapshot:=test_clinic_invoice_state();
 replayed:=clinic_post_invoice('d6000000-0000-4000-8000-000000000002','k08-new-400',plan,lines);
 if replayed<>new_id or test_clinic_invoice_state()<>snapshot then raise exception 'Lost-response retry duplicated an invoice/stock/journal';end if;
 if not exists(select 1 from invoices where id=new_id and total=400000 and paid_status='Lunas') then raise exception 'Successful invoice missing400000 payment status';end if;
 if (select count(*) from invoices where visit_id='d6000000-0000-4000-8000-000000000002')<>1 then raise exception 'Duplicate invoice on new visit';end if;
 perform set_visit_service_state('d6000000-0000-4000-8000-000000000002','checkout');
 select count(*) into events from visit_operational_events where visit_id='d6000000-0000-4000-8000-000000000002' and event_type='check_out';
 perform set_visit_service_state('d6000000-0000-4000-8000-000000000002','checkout');
 if exists(select 1 from visit_operational_events where visit_id='d6000000-0000-4000-8000-000000000002' and event_type='check_out' and created_by is distinct from auth.uid()) then raise exception 'Checkout actor was not derived from authenticated session';end if;
 if events<>1 or (select count(*) from visit_operational_events where visit_id='d6000000-0000-4000-8000-000000000002' and event_type='check_out')<>events then raise exception 'Checkout retry duplicated operational events';end if;
 if (select status from visits where id='d6000000-0000-4000-8000-000000000002')<>'Selesai' then raise exception 'Confirmed checkout not visible to medical reader';end if;
 -- Same stock guard must roll back a split invoice and every receipt too.
 snapshot:=test_clinic_invoice_state();select count(*) into payments from invoice_payments;
 begin perform clinic_post_split_invoice('d6000000-0000-4000-8000-000000000003','k08-split-failed',plan,'[{"description":"Missing stock","qty":1,"price":400000,"kind":"obat","item_id":"d8000000-0000-4000-8000-000000000005","unit":"pcs","discount_percent":0}]',parts);
 exception when raise_exception then if sqlerrm not like 'STOCK_SHORT:%' then raise;end if;bad:=true;end;
 if not bad or test_clinic_invoice_state()<>snapshot or (select count(*) from invoice_payments)<>payments then raise exception 'Failed split leaked invoice/payment/move/journal';end if;
 split_id:=clinic_post_split_invoice('d6000000-0000-4000-8000-000000000003','k08-split-success',plan,'[{"description":"Service","qty":1,"price":400000,"kind":"jasa","item_id":null,"discount_percent":0}]',parts);
 snapshot:=test_clinic_invoice_state();select count(*) into payments from invoice_payments where invoice_id=split_id;
 replayed:=clinic_post_split_invoice('d6000000-0000-4000-8000-000000000003','k08-split-success',plan,'[{"description":"Service","qty":1,"price":400000,"kind":"jasa","item_id":null,"discount_percent":0}]',parts);
 if replayed<>split_id or test_clinic_invoice_state()<>snapshot or payments<>2 or (select count(*) from invoice_payments where invoice_id=split_id)<>2 then raise exception 'Split retry duplicated money';end if;
 if (select sum(amount) from invoice_payments where invoice_id=split_id)<>400000 or (select paid_status from invoices where id=split_id)<>'Lunas' then raise exception 'Split amounts/status inconsistent';end if;
 if (select count(*) from invoices where visit_id in('d6000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000002') and total in(415000,400000))<>2 then raise exception 'Old/new document identities conflated';end if;
end$$;
rollback;
