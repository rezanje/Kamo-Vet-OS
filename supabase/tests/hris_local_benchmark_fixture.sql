-- LOCAL fictional bootstrap only, after successful payroll acceptance.
-- No visits/invoices/payments in the finalized month; no outbound messages.
begin;
do $$begin
 if not exists(select 1 from public.branches where id='a1000000-0000-4000-8000-000000000001'and code='FIC-HR-A')
 or not exists(select 1 from local_acceptance.applied_sources)then
  raise exception 'Only the explicit fictional LOCAL acceptance database is supported';
 end if;
end$$;
insert into branches(id,code,name,type,created_at)values('b1000000-0000-4000-8000-000000000001','QA-PERF','Fiction QA-PERF','KLINIK','2010-01-01')on conflict(code)do nothing;
insert into warehouses(id,branch_id,code,name,type,created_at)values('b1000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','QA-PERF-WH','Fiction QA-PERF warehouse','VET','2010-01-01')on conflict(code)do nothing;
insert into customers(id,name,phone,created_at)
 select md5('QA-PERF-customer-'||i)::uuid,'Fiction QA customer '||lpad(i::text,4,'0'),'0800'||lpad(i::text,8,'0'),'2010-01-01'::timestamptz+i*interval'1 minute'
 from generate_series(1,1200)i on conflict(id)do nothing;
insert into pets(id,customer_id,name,species,created_at)
 select md5('QA-PERF-pet-'||i)::uuid,md5('QA-PERF-customer-'||i)::uuid,'Fiction QA pet '||lpad(i::text,4,'0'),'Kucing','2010-01-01'::timestamptz+i*interval'1 minute'
 from generate_series(1,1200)i on conflict(id)do nothing;
insert into visits(id,branch_id,customer_id,pet_id,poli,dokter,keluhan,status,created_at)
 select md5('QA-PERF-visit-'||i)::uuid,'b1000000-0000-4000-8000-000000000001',md5('QA-PERF-customer-'||i)::uuid,md5('QA-PERF-pet-'||i)::uuid,
 'Poli Umum','Fiction QA doctor','Fiction historical benchmark only','Selesai','2010-01-01'::timestamptz+i*interval'1 minute'
 from generate_series(1,350)i on conflict(id)do nothing;
insert into medical_records(id,visit_id,diagnosis,anamnesis,created_at)
 select md5('QA-PERF-medical-'||i)::uuid,md5('QA-PERF-visit-'||i)::uuid,'Fiction QA diagnosis','Fiction historical benchmark only','2010-01-01'::timestamptz+i*interval'1 minute'
 from generate_series(1,350)i on conflict(id)do nothing;
insert into items(id,code,name,sell_price,buy_price,created_at)
 select md5('QA-PERF-item-'||i)::uuid,'QA-PERF-'||lpad(i::text,4,'0'),'Fiction QA item '||lpad(i::text,4,'0'),150,100,'2010-01-01'
 from generate_series(1,1200)i on conflict(id)do nothing;
insert into stock(warehouse_id,item_id,qty,updated_at)
 select 'b1000000-0000-4000-8000-000000000002',md5('QA-PERF-item-'||i)::uuid,10,'2010-01-01'
 from generate_series(1,1200)i on conflict(warehouse_id,item_id)do nothing;
commit;
