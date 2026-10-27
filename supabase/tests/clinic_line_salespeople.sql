-- Append after clinic_invoice_post.sql fixture setup; synthetic rows roll back.
create function pg_temp.assert_line_seller(ok boolean, msg text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',msg;end if;end$$;
insert into public.employees(id,nama,jabatan,branch_id,status) values
 ('f2000000-0000-4000-8000-000000000001','Fictional doctor','Dokter','d2000000-0000-4000-8000-000000000001','Aktif'),
 ('f2000000-0000-4000-8000-000000000002','Fictional assistant','Perawat','d2000000-0000-4000-8000-000000000001','Aktif');
insert into public.branches(id,code,name,type) values('f2000000-0000-4000-8000-000000000010','SELLER-OTHER','Other fictional clinic','KLINIK');
insert into public.employees(id,nama,jabatan,branch_id,status) values
 ('f2000000-0000-4000-8000-000000000003','Wrong branch','Perawat','f2000000-0000-4000-8000-000000000010','Aktif'),
 ('f2000000-0000-4000-8000-000000000004','Inactive seller','Perawat','d2000000-0000-4000-8000-000000000001','Nonaktif');
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$
declare inv uuid; retry uuid; before_count bigint;
header jsonb:=jsonb_build_object('tanggal',current_date::text,'subtotal',120,'discount',0,'tax',0,'total',120,'dp_amount',0,'dp_date',null,'paid_status','Belum Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001','salesperson_id','f2000000-0000-4000-8000-000000000001');
lines jsonb:=jsonb_build_array(
 jsonb_build_object('description','Medicine','qty',1,'price',20,'kind','obat','item_id','d8000000-0000-4000-8000-000000000001','unit','pcs','discount_percent',0,'salesperson_id','f2000000-0000-4000-8000-000000000002','salesperson_name','FORGED'),
 jsonb_build_object('description','Procedure','qty',1,'price',100,'kind','jasa','item_id',null,'unit','pcs','discount_percent',0,'salesperson_id','f2000000-0000-4000-8000-000000000001'));
begin
 inv:=public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','seller.lines.1',header,lines);
 retry:=public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','seller.lines.1',header,lines);
 perform pg_temp.assert_line_seller(inv=retry,'same request is idempotent');
 perform pg_temp.assert_line_seller((select count(*)=2 and count(distinct salesperson_id)=2 from public.invoice_items where invoice_id=inv),'medicine and procedure retain distinct sellers');
 perform pg_temp.assert_line_seller((select salesperson_name='Fictional assistant' from public.invoice_items where invoice_id=inv and deskripsi='Medicine'),'server snapshots name, never trusts client');
 perform pg_temp.assert_line_seller((select salesperson_name='Fictional doctor' from public.invoice_items where invoice_id=inv and deskripsi='Procedure'),'procedure receives its own seller');
 select count(*) into before_count from public.invoices;
 begin
  perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000002','seller.lines.wrong-branch',header,jsonb_set(lines,'{0,salesperson_id}','"f2000000-0000-4000-8000-000000000003"'));
  raise exception 'Expected wrong branch seller refusal';
 exception when others then if sqlerrm not like 'CARE_INVALID:%' then raise;end if;end;
 perform pg_temp.assert_line_seller((select count(*)=before_count from public.invoices),'wrong branch seller rolls back invoice');
 begin
  perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000003','seller.lines.inactive',header,jsonb_set(lines,'{0,salesperson_id}','"f2000000-0000-4000-8000-000000000004"'));
  raise exception 'Expected inactive seller refusal';
 exception when others then if sqlerrm not like 'CARE_INVALID:%' then raise;end if;end;
 perform pg_temp.assert_line_seller((select count(*)=before_count from public.invoices),'inactive seller rolls back invoice');
end $$;
reset role;
do $$begin
 begin
  update public.invoice_items set salesperson_id='f2000000-0000-4000-8000-000000000001' where deskripsi='Medicine';
  raise exception 'Expected immutable seller rejection';
 exception when others then if sqlerrm not like 'CARE_INVALID:%' then raise;end if;end;
end $$;
update public.employees set nama='Renamed after sale' where id='f2000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
select public.change_master_data_lifecycle('employees',id,'archive',lifecycle_revision,'Fictional retirement after recorded sale')
from public.employees where id='f2000000-0000-4000-8000-000000000002';
do $$
declare inv uuid;reissued uuid;lines jsonb;header jsonb;
begin
 select id into inv from public.invoices where request_key='seller.lines.1';
 select jsonb_agg(jsonb_build_object('source_invoice_item_id',id,'description',deskripsi,'qty',qty,'price',harga,
   'kind',jenis,'item_id',item_id,'unit',satuan,'discount_percent',diskon_persen,
   'salesperson_id',salesperson_id,'salesperson_name','FORGED NEW NAME') order by deskripsi)
   into lines from public.invoice_items where invoice_id=inv;
 header:=jsonb_build_object('tanggal',current_date::text,'subtotal',120,'discount',0,'tax',0,'total',120,'paid_status','Belum Lunas','dp_amount',0,'metode_bayar','Tunai','reason','Fictional correction without seller change');
 begin
  perform public.clinic_edit_invoice(inv,'seller.lines.forged',header,
    jsonb_set(lines,'{0,salesperson_id}','"f2000000-0000-4000-8000-000000000001"'));
  raise exception 'Expected correction attribution rewrite rejection';
 exception when others then if sqlerrm not like 'CARE_INVALID:%' then raise;end if;end;
 perform public.clinic_edit_invoice(inv,'seller.lines.edit',header,lines);
 perform pg_temp.assert_line_seller((select count(*)=2 and bool_or(salesperson_name='Fictional assistant') from public.invoice_items where invoice_id=inv),'correction keeps original name after rename and retirement');
 perform pg_temp.assert_line_seller((select bool_and(service_source_line_id is not null) from public.invoice_items where invoice_id=inv),'correction links exact prior line');
 perform public.clinic_receive_invoice_payment(inv,current_date,10,'Tunai','1101',null,'seller.lines.payment');
 reissued:=public.clinic_void_reissue_invoice(inv,'seller.lines.reissue','Fictional snapshot reissue');
 perform pg_temp.assert_line_seller((select count(*)=2 and bool_or(salesperson_name='Fictional assistant') from public.invoice_items where invoice_id=reissued),'reissue retains inactive seller snapshot');
end $$;
rollback;
