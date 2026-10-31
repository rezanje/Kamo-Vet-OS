-- Appended to clinic_invoice_post.sql fixture prefix; no target database.
create function pg_temp.assert_ok(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'Assertion failed: %',msg;end if;end$$;
insert into public.items(id,code,name,unit,item_type,is_active) values('f3000000-0000-4000-8000-000000000001','SERVICE-FICTION','Fictional service','pcs','Jasa',true);
insert into public.employees(id,nama,jabatan,branch_id,status) values
 ('f1000000-0000-4000-8000-000000000001','Original doctor','Dokter','d2000000-0000-4000-8000-000000000001','Aktif'),
 ('f1000000-0000-4000-8000-000000000002','Original nurse','Perawat','d2000000-0000-4000-8000-000000000001','Aktif');
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$
declare inv uuid;retry uuid;before_count bigint;line_id uuid;patch jsonb;lines jsonb;failed boolean;
header jsonb:=jsonb_build_object('service_pricing_version',1,'tanggal',current_date::text,'subtotal',200,'discount',0,'tax',0,'total',200,'dp_amount',0,'dp_date',null,'paid_status','Belum Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001');
begin
 lines:=jsonb_build_array(jsonb_build_object('description','Same service','qty',1,'price',100,'kind','jasa','item_id','f3000000-0000-4000-8000-000000000001','unit','pcs','discount_percent',0,'service_performers',jsonb_build_object('doctor_id','f1000000-0000-4000-8000-000000000001','doctor_name','FORGED')),
 jsonb_build_object('description','Same service','qty',1,'price',100,'kind','jasa','item_id','f3000000-0000-4000-8000-000000000001','unit','pcs','discount_percent',0,'service_performers',jsonb_build_object('staff_id','f1000000-0000-4000-8000-000000000002')));
 inv:=public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','S01.clinic.pair',header,lines);
 retry:=public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','S01.clinic.pair',header,lines);
 perform pg_temp.assert_ok(inv=retry,'unchanged request must return original invoice');
 perform pg_temp.assert_ok((select service_pricing_version=1 from invoices where id=inv),'new pricing version persisted for exact replay');
 begin
  update invoices set service_pricing_version=null where id=inv;
  raise exception 'Expected stored pricing version mutation rejection';
 exception when insufficient_privilege then null; when others then if sqlerrm not like 'CARE_INVALID:%' then raise;end if;end;
 retry:=public.clinic_post_invoice('d6000000-0000-4000-8000-000000000003','S01.clinic.legacy',header-'service_pricing_version',lines);
 perform pg_temp.assert_ok((select service_pricing_version is null from invoices where id=retry),'legacy request retains null pricing version');
 perform pg_temp.assert_ok(retry=public.clinic_post_invoice('d6000000-0000-4000-8000-000000000003','S01.clinic.legacy',header-'service_pricing_version',lines),'legacy request exact replay unchanged');
 perform pg_temp.assert_ok((select count(*)=2 and count(distinct service_performers)=2 from invoice_items where invoice_id=inv),'same service source rows and performers independent');
 perform pg_temp.assert_ok((select cashier_profile_id=auth.uid() and cashier_name is not null from invoices where id=inv),'clinic cashier actual login snapshot');
 perform pg_temp.assert_ok((select bool_or(service_performers->>'doctor_name'='Original doctor') from invoice_items where invoice_id=inv),'ignore forged snapshot name');
 begin
  perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','S01.clinic.pair',header,jsonb_set(lines,'{0,service_performers,doctor_id}','"f1000000-0000-4000-8000-000000000002"'));
  raise exception 'Expected changed-performer identity rejection';
 exception when others then if sqlerrm not like 'IDEMPOTENCY_CONFLICT:%' then raise;end if;end;
 select count(*) into before_count from invoices;
 begin
  perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000002','S01.clinic.invalid',header,jsonb_set(lines,'{1,service_performers,staff_id}','"f1000000-0000-4000-8000-000000000001"'));
  raise exception 'Expected invalid later service actor rejection';
 exception when others then if sqlerrm not like 'CARE_INVALID:%' then raise;end if;end;
 perform pg_temp.assert_ok((select count(*)=before_count from invoices),'invalid later actor rolls invoice/lines/journal back');
 perform pg_temp.assert_ok(not exists(select 1 from journal_entries where source_ref like '%S01.clinic.invalid%'),'no journal on failed metadata');
 perform pg_temp.assert_ok(not has_function_privilege('authenticated','public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)','execute'),'internal correction RPC ACL retained');
 perform pg_temp.assert_ok(not has_function_privilege('anon','public.clinic_post_invoice(uuid,text,jsonb,jsonb)','execute'),'anonymous RPC denied');
end $$;
reset role;
-- Independently exercise the immutable trigger under the fixture owner, without
-- granting application users DML that the existing policy already denies.
do $$begin
 begin
  update invoices set service_pricing_version=null where request_key='S01.clinic.pair';
  raise exception 'Expected immutable pricing contract';
 exception when others then if sqlerrm not like 'CARE_INVALID:%' then raise;end if;end;
end $$;
update public.employees set nama='Changed after work' where id in('f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002');
-- OWNER executes the existing permitted correction/reissue, not a new edit right.
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
select public.change_master_data_lifecycle('employees',id,'archive',lifecycle_revision,'Fictional retirement after recorded service') from public.employees where id in('f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002');
do $$
declare inv uuid;new_inv uuid;lines jsonb;header jsonb;old_ids uuid[];
begin
 select id into inv from invoices where request_key='S01.clinic.pair';
 select array_agg(id),jsonb_agg(jsonb_build_object('source_invoice_item_id',id,'description',deskripsi,'qty',qty,'price',110,'kind',jenis,'item_id',item_id,'unit',satuan,'discount_percent',0,'service_performers',jsonb_build_object('doctor_id',service_performers->>'doctor_id','staff_id',service_performers->>'staff_id','doctor_name','UNTRUSTED NEW NAME'))) into old_ids,lines from invoice_items where invoice_id=inv;
 header:=jsonb_build_object('tanggal',current_date::text,'subtotal',220,'discount',0,'tax',0,'total',220,'paid_status','Belum Lunas','dp_amount',0,'metode_bayar','Tunai','reason','Fictional unrelated price correction');
 perform public.clinic_edit_invoice(inv,'S01.clinic.edit',header,lines);
 perform pg_temp.assert_ok((select count(*)=2 and bool_or(service_performers->>'doctor_name'='Original doctor') and bool_or(service_performers->>'staff_name'='Original nurse') from invoice_items where invoice_id=inv),'manual line snapshots survive retirement/name/price correction');
 perform pg_temp.assert_ok((select bool_and(service_source_line_id=any(old_ids)) from invoice_items where invoice_id=inv),'correction binds exact original line IDs');
 perform pg_temp.assert_ok(not exists(select 1 from invoice_items where id=any(old_ids)),'old lines deleted only after replacement validation');
 perform public.clinic_receive_invoice_payment(inv,current_date,10,'Tunai','110003',null,'S01.clinic.partial-payment');
 new_inv:=public.clinic_void_reissue_invoice(inv,'S01.clinic.reissue','Fictional snapshot reissue');
 perform pg_temp.assert_ok((select service_pricing_version=1 from invoices where id=new_inv),'reissue preserves pricing contract version');
 perform pg_temp.assert_ok((select count(*)=2 and bool_or(service_performers->>'doctor_name'='Original doctor') and bool_or(service_performers->>'staff_name'='Original nurse') from invoice_items where invoice_id=new_inv),'reissue snapshots survive inactive staff without reconstruction');
 perform pg_temp.assert_ok((select bool_and(service_source_line_id in(select id from invoice_items where invoice_id=inv)) from invoice_items where invoice_id=new_inv),'reissue binds original rows');
 select jsonb_agg(jsonb_build_object('source_invoice_item_id',id,'description',deskripsi,'qty',qty,'price',120,'kind',jenis,'item_id',item_id,'unit',satuan,'discount_percent',0,'service_performers',jsonb_build_object('doctor_id',service_performers->>'doctor_id','staff_id',service_performers->>'staff_id'))) into lines from invoice_items where invoice_id=new_inv;
 header:=header || jsonb_build_object('subtotal',240,'total',240,'paid_status','DP','reason','Fictional correction of reissued invoice');
 perform public.clinic_edit_invoice(new_inv,'S01.clinic.edit-reissued',header,lines);
 perform pg_temp.assert_ok((select count(*)=2 and bool_or(service_performers->>'doctor_name'='Original doctor') and bool_or(service_performers->>'staff_name'='Original nurse') from invoice_items where invoice_id=new_inv),'editing reissued invoice binds its own exact current rows');
end $$;
rollback;
