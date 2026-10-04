-- Fictional LOCAL report acceptance only; never run against production.
begin;
do $$begin
 if not exists(select 1 from local_acceptance.applied_sources)
 or not exists(select 1 from branches where id='b1000000-0000-4000-8000-000000000001' and code='QA-PERF')
 or not exists(select 1 from branches where id='a1000000-0000-4000-8000-000000000001' and code='FIC-HR-A')
 or (select count(*) from stock where warehouse_id='b1000000-0000-4000-8000-000000000002')<>1200 then
  raise exception 'Only the explicit fictional LOCAL acceptance fixture is supported';
 end if;
 if exists(select 1 from stock_layers where warehouse_id='b1000000-0000-4000-8000-000000000002' and source_ref<>'QA-RPT-FIFO') then
  raise exception 'Refuse to alter unrelated FIFO benchmark holdings';
 end if;
end$$;
insert into stock_layers(id,warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source,source_ref)
 select md5('QA-RPT-layer-'||s.item_id)::uuid,s.warehouse_id,s.item_id,'2010-01-01',10,10,110,'saldo-awal','QA-RPT-FIFO'
 from stock s where s.warehouse_id='b1000000-0000-4000-8000-000000000002' on conflict(id)do nothing;

insert into visits(id,branch_id,customer_id,pet_id,poli,dokter,keluhan,status,created_at)
 select ('c1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'b1000000-0000-4000-8000-000000000001',
 md5('QA-PERF-customer-1')::uuid,md5('QA-PERF-pet-1')::uuid,'Poli Umum',
 case i when 1 then 'Fiction Report Doctor A' when 2 then 'Fiction Report Doctor B' else 'Fiction Report Void Doctor' end,
 'QA-RPT dedicated historical report fixture','Selesai','2010-01-15T12:00:00+07:00'
 from generate_series(1,3)i on conflict(id)do nothing;
insert into medical_records(id,visit_id,diagnosis,anamnesis,created_at)
 select ('c2000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('c1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'QA-RPT fiction only','QA-RPT historical cost snapshots; no posting acceptance','2010-01-15T12:00:00+07:00'
 from generate_series(1,3)i on conflict(id)do nothing;
insert into compounding_recipes(id,medical_record_id,recipe_name,dosage_form,total_price,status,created_at)
 select md5('QA-RPT-recipe-'||i)::uuid,('c2000000-0000-4000-8000-'||lpad((case when i<=600 then 1 when i<=1200 then 2 else 3 end)::text,12,'0'))::uuid,
 'QA-RPT Compound '||lpad(i::text,4,'0'),'puyer',200,'handed_over','2010-01-15T12:00:00+07:00'
 from generate_series(1,1201)i on conflict(id)do nothing;
insert into compound_formulas(id,code,active,created_at) values
 ('c4000000-0000-4000-8000-000000000001','QA-RPT-A',true,'2010-01-01'),
 ('c4000000-0000-4000-8000-000000000002','QA-RPT-INACTIVE',false,'2010-01-01') on conflict(id)do nothing;
insert into compound_formula_versions(id,formula_id,version,name,dosage_form,ingredients,published_at)values
 ('c5000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001',1,'Fiction old A','puyer','[{"quantity":1}]','2010-01-01'),
 ('c5000000-0000-4000-8000-000000000002','c4000000-0000-4000-8000-000000000001',2,'Fiction current A','puyer','[{"quantity":2}]','2010-02-01'),
 ('c5000000-0000-4000-8000-000000000003','c4000000-0000-4000-8000-000000000002',1,'Fiction inactive B','puyer','[{"quantity":1}]','2010-01-01') on conflict(id)do nothing;
update compound_formulas set current_version_id=case code when 'QA-RPT-A' then 'c5000000-0000-4000-8000-000000000002'::uuid else 'c5000000-0000-4000-8000-000000000003'::uuid end
 where id in('c4000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000002');
insert into compound_official_usage(recipe_id,formula_version_id,created_at)
 select md5('QA-RPT-recipe-'||i)::uuid,case when i<=600 then 'c5000000-0000-4000-8000-000000000001'::uuid else 'c5000000-0000-4000-8000-000000000003'::uuid end,'2010-01-15'
 from generate_series(1,1200)i on conflict(recipe_id)do nothing;
insert into invoices(id,visit_id,invoice_no,subtotal,discount,total,paid_status,created_at,voided_at)
 select ('c3000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('c1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'QA-RPT-2010-'||i,case when i=3 then 200 else 120000 end,case when i=3 then 20 else 12000 end,
 case when i=3 then 180 else 108000 end,'Belum Lunas','2010-01-15T12:00:00+07:00',case when i=3 then '2010-01-16'::timestamptz else null end
 from generate_series(1,3)i on conflict(id)do nothing;
insert into invoice_items(id,invoice_id,deskripsi,qty,harga,diskon_persen,hpp,jenis,compound_recipe_id,satuan,created_at)
 select md5('QA-RPT-line-'||i)::uuid,('c3000000-0000-4000-8000-'||lpad((case when i<=600 then 1 when i<=1200 then 2 else 3 end)::text,12,'0'))::uuid,
 'QA-RPT Compound '||lpad(i::text,4,'0'),2,100,10,50,'obat',md5('QA-RPT-recipe-'||i)::uuid,'racikan','2010-01-15T12:00:00+07:00'
 from generate_series(1,1201)i on conflict(id)do nothing;
commit;
