-- Append after clinic_invoice_post.sql fixture setup; synthetic rows roll back.
create function pg_temp.assert_record_seller(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',msg;end if;end$$;
insert into public.employees(id,nama,jabatan,branch_id,status) values
 ('f2100000-0000-4000-8000-000000000001','Doctor at sale','Dokter','d2000000-0000-4000-8000-000000000001','Aktif'),
 ('f2100000-0000-4000-8000-000000000002','Assistant at sale','Perawat','d2000000-0000-4000-8000-000000000001','Aktif'),
 ('f2100000-0000-4000-8000-000000000004','Cashier at sale','Kasir','d2000000-0000-4000-8000-000000000001','Aktif');
insert into public.branches(id,code,name,type) values('f2100000-0000-4000-8000-000000000010','RECORD-OTHER','Other fictional clinic','KLINIK');
insert into public.visits(id,branch_id,customer_id,pet_id,status,service_started_at,doctor_id,dokter)
 values
 ('f2100000-0000-4000-8000-000000000011','d2000000-0000-4000-8000-000000000001',
 'd4000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Diperiksa',now(),'f2100000-0000-4000-8000-000000000001','Doctor at sale'),
 ('f2100000-0000-4000-8000-000000000013','d2000000-0000-4000-8000-000000000001',
 'd4000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Diperiksa',now(),'f2100000-0000-4000-8000-000000000001','Doctor at sale');
insert into public.medical_records(id,visit_id,diagnosis)
 values('f2100000-0000-4000-8000-000000000014','f2100000-0000-4000-8000-000000000013','Fictional inpatient');
insert into public.items(id,code,name,unit,item_type,is_active,is_compound_material,sell_price)
 values('f2100000-0000-4000-8000-000000000012','FINISHED-FICTION','Obat Racik Kapsul Fiktif','pcs','Persediaan',true,false,70);
insert into public.employees(id,nama,jabatan,branch_id,status) values
 ('f2100000-0000-4000-8000-000000000003','Other branch staff','Perawat','f2100000-0000-4000-8000-000000000010','Aktif');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into public.inpatient_records(id,branch_id,visit_id,medical_record_id)
 values('f2100000-0000-4000-8000-000000000015','d2000000-0000-4000-8000-000000000001',
 'f2100000-0000-4000-8000-000000000013','f2100000-0000-4000-8000-000000000014');
set local role authenticated;
do $$
declare source_id uuid;created_invoice_id uuid;saved_record_id uuid;compound_source_id uuid;issued_recipe_id uuid;header jsonb;lines jsonb;
begin
 saved_record_id:=public.clinic_save_initial_record(
  'f2100000-0000-4000-8000-000000000011','d5000000-0000-4000-8000-000000000001',
  '{"diagnosis":"Fictional"}'::jsonb,'[]'::jsonb,
  '[{"nama_obat":"Obat Unit","item_id":"d8000000-0000-4000-8000-000000000001","qty":1,"satuan":"pcs","faktor":1,"harga":20,"jenis":"obat","salesperson_id":"f2100000-0000-4000-8000-000000000001"}]'::jsonb,
  '[{"sale_item_id":"f2100000-0000-4000-8000-000000000012","salesperson_id":"f2100000-0000-4000-8000-000000000002","request_key":"seller-record-compound","recipe":{"recipe_name":"Fictional compound","dosage_form":"kapsul","ingredients":[{"item_id":"d8000000-0000-4000-8000-000000000002","quantity":1,"unit":"gram","unit_price":999}]}}]'::jsonb,
  null,'f2100000-0000-4000-8000-000000000001','Doctor at sale','Fictional complaint','seller-record-save');
 perform pg_temp.assert_record_seller((select salesperson_id='f2100000-0000-4000-8000-000000000001'
   and salesperson_name='Doctor at sale' from public.prescription_items where medical_record_id=saved_record_id and compound_recipe_id is null),
   'atomic record RPC persists the clinical seller');
 select id,compound_recipe_id into compound_source_id,issued_recipe_id from public.prescription_items
  where medical_record_id=saved_record_id and compound_recipe_id is not null;
 perform pg_temp.assert_record_seller(issued_recipe_id is not null and (select salesperson_id='f2100000-0000-4000-8000-000000000002'
   and salesperson_name='Assistant at sale' from public.prescription_items where id=compound_source_id),
   'atomic compound RPC and recipe trigger persist the selected seller');
 perform public.clinic_save_inpatient_log_with_status(
  'f2100000-0000-4000-8000-000000000015','f2100000-0000-4000-8000-000000000014',
  '{"condition_note":"Fictional stable"}'::jsonb,'[]'::jsonb,
  '[{"sale_item_id":"f2100000-0000-4000-8000-000000000012","salesperson_id":"f2100000-0000-4000-8000-000000000001","request_key":"seller-inpatient-compound","recipe":{"recipe_name":"Fictional compound inpatient","dosage_form":"kapsul","ingredients":[{"item_id":"d8000000-0000-4000-8000-000000000002","quantity":1,"unit":"gram","unit_price":999}]}}]'::jsonb,
  'seller-inpatient-log',null);
 perform pg_temp.assert_record_seller((select salesperson_id='f2100000-0000-4000-8000-000000000001'
   and salesperson_name='Doctor at sale' from public.prescription_items
   where medical_record_id='f2100000-0000-4000-8000-000000000014' and compound_recipe_id is not null),
   'inpatient log RPC and recipe trigger persist the selected seller');
 insert into public.prescription_items(medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,jenis,salesperson_id,salesperson_name)
 values('d7000000-0000-4000-8000-000000000002','Obat Unit','d8000000-0000-4000-8000-000000000001',1,'pcs',1,20,'obat',
 'f2100000-0000-4000-8000-000000000001','FORGED') returning id into source_id;
 perform pg_temp.assert_record_seller((select salesperson_name='Doctor at sale' from public.prescription_items where id=source_id),'clinical record name is server-snapshotted');
 perform set_config('kamo.clinic_compound_seller','f2100000-0000-4000-8000-000000000002',true);
 insert into public.prescription_items(medical_record_id,nama_obat,qty,satuan,faktor,harga,jenis)
 values('d7000000-0000-4000-8000-000000000002','Fictional mixed compound',1,'racikan',1,20,'obat');
 perform set_config('kamo.clinic_compound_seller','',true);
 perform pg_temp.assert_record_seller((select salesperson_id='f2100000-0000-4000-8000-000000000002'
   and salesperson_name='Assistant at sale' from public.prescription_items where nama_obat='Fictional mixed compound'),'compound output carries the selected seller');
 begin
  insert into public.prescription_items(medical_record_id,nama_obat,qty,satuan,harga,jenis,salesperson_id)
  values('d7000000-0000-4000-8000-000000000002','Invalid seller',1,'pcs',1,'obat','f2100000-0000-4000-8000-000000000003');
  raise exception 'Expected wrong-branch clinical seller refusal';
 exception when others then if sqlerrm not like 'CARE_INVALID:%' then raise;end if;end;
 header:=jsonb_build_object('tanggal',current_date::text,'subtotal',20,'discount',0,'tax',0,'total',20,'dp_amount',0,'dp_date',null,'paid_status','Belum Lunas','metode_bayar','Tunai',
   'shift_id','da000000-0000-4000-8000-000000000001','salesperson_id','f2100000-0000-4000-8000-000000000002');
 lines:=jsonb_build_array(jsonb_build_object('description','Obat Unit','qty',1,'price',20,'kind','obat','item_id','d8000000-0000-4000-8000-000000000001',
   'unit','pcs','discount_percent',0,'prescription_item_id',source_id));
 created_invoice_id:=public.clinic_post_invoice('d6000000-0000-4000-8000-000000000002','seller.record.invoice',header,lines);
 perform pg_temp.assert_record_seller((select salesperson_id='f2100000-0000-4000-8000-000000000001'
   and salesperson_name='Doctor at sale' from public.invoice_items where invoice_id=created_invoice_id),'billing inherits the sealed clinical seller rather than header fallback');
 select id into source_id from public.prescription_items where medical_record_id=saved_record_id and compound_recipe_id is null;
 header:=header||jsonb_build_object('subtotal',90,'total',90,'salesperson_id','f2100000-0000-4000-8000-000000000004');
 lines:=jsonb_build_array(
  jsonb_build_object('description','Obat Unit','qty',1,'price',20,'kind','obat','item_id','d8000000-0000-4000-8000-000000000001','unit','pcs','discount_percent',0,'prescription_item_id',source_id),
  jsonb_build_object('description','Obat Racik Kapsul Fiktif','qty',1,'price',70,'kind','obat','item_id',null,'unit','racikan','discount_percent',0,'prescription_item_id',compound_source_id,'recipe_id',issued_recipe_id));
 created_invoice_id:=public.clinic_post_invoice('f2100000-0000-4000-8000-000000000011','seller.compound.invoice',header,lines);
 perform pg_temp.assert_record_seller((select count(*)=2 from public.invoice_items where invoice_id=created_invoice_id
   and ((compound_recipe_id is not null and salesperson_id='f2100000-0000-4000-8000-000000000002')
   or (compound_recipe_id is null and salesperson_id='f2100000-0000-4000-8000-000000000001'))),
   'billing inherits both ordinary and compound clinical line sellers');
end $$;
reset role;
do $$begin
 begin
  update public.prescription_items set salesperson_id='f2100000-0000-4000-8000-000000000002' where nama_obat='Obat Unit';
  raise exception 'Expected immutable clinical seller rejection';
 exception when others then if sqlerrm not like 'CARE_INVALID:%' then raise;end if;end;
end $$;
rollback;
