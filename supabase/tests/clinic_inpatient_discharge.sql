-- Run only on isolated local Supabase after the clinic/catalog migrations.
begin;

insert into auth.users(id, raw_user_meta_data)
values ('fb000000-0000-4000-8000-000000000001', '{}');
update public.profiles set role='OWNER'
where id='fb000000-0000-4000-8000-000000000001';
insert into public.branches(id, code, name, type)
values ('fb100000-0000-4000-8000-000000000001','BILL-INPAT','Cabang Uji','KLINIK');
insert into public.user_branches(user_id,branch_id)
values ('fb000000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000001');
insert into public.items(id,code,name,unit,item_type,is_active,is_compound_material,sell_price)
values ('fb200000-0000-4000-8000-000000000001','BILL-INPAT-BHN','Bahan uji','gram','Persediaan',true,true,15);
insert into public.warehouses(id,branch_id,code,name,type)
values ('fb300000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000001','BILL-INPAT-WH','Gudang Uji','VET');
insert into public.stock(warehouse_id,item_id,qty)
values ('fb300000-0000-4000-8000-000000000001','fb200000-0000-4000-8000-000000000001',10);
insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
values ('fb300000-0000-4000-8000-000000000001','fb200000-0000-4000-8000-000000000001',current_date,10,10,5,'purchase');
insert into public.customers(id,name,phone)
values ('fb400000-0000-4000-8000-000000000001','Pemilik Uji','080000000003');
insert into public.pets(id,customer_id,name)
values ('fb500000-0000-4000-8000-000000000001','fb400000-0000-4000-8000-000000000001','Pasien Uji');
insert into public.visits(id,branch_id,customer_id,pet_id,status,service_started_at)
values ('fb600000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001','fb500000-0000-4000-8000-000000000001','Diperiksa',now());
insert into public.medical_records(id,visit_id,diagnosis)
values ('fb700000-0000-4000-8000-000000000001','fb600000-0000-4000-8000-000000000001','Rawat inap');
insert into public.inpatient_records(id,branch_id,visit_id,medical_record_id)
values ('fb800000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000001',
  'fb600000-0000-4000-8000-000000000001','fb700000-0000-4000-8000-000000000001');


update public.inpatient_records set admitted_at=now()-interval '49 hours'
  where id='fb800000-0000-4000-8000-000000000001';
insert into public.items(code,name,unit,item_type,is_active,tindakan_kategori,sell_price)
values('BILL-INPAT-FEE','AAA Biaya Rawat Inap','hari','Jasa',true,'Rawat Inap',100000);

create function public.test_fail_inpatient_fee() returns trigger language plpgsql as $$
begin
  if current_setting('test.fail_fee',true)='1' and new.kategori='Rawat Inap' then
    raise exception 'fee insert refused';
  end if;
  return new;
end;
$$;
create trigger test_fail_inpatient_fee before insert on public.prescription_items
  for each row execute function public.test_fail_inpatient_fee();

do $$
declare failed boolean := false;
begin
  begin
    insert into public.invoices(visit_id,invoice_no)
    values('fb600000-0000-4000-8000-000000000001','BILL-INPAT-EARLY');
  exception when sqlstate 'P0001' then
    failed := position('INPATIENT_OPEN:' in sqlerrm)=1;
  end;
  if not failed then raise exception 'invoice was issued before discharge fee'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','fb000000-0000-4000-8000-000000000001',true);

do $$
declare
  log_id uuid;
  failed boolean;
begin
  perform set_config('test.fail_fee','1',true);
  failed:=false;
  begin
    perform public.clinic_save_inpatient_log_with_status(
      'fb800000-0000-4000-8000-000000000001',
      'fb700000-0000-4000-8000-000000000001',
      '{"condition_note":"Pasien membaik"}'::jsonb,'[]'::jsonb,'[]'::jsonb,
      'billing-inpatient-fail','sembuh');
  exception when others then failed:=position('fee insert refused' in sqlerrm)>0; end;
  if not failed or exists(select 1 from public.inpatient_daily_logs
      where inpatient_record_id='fb800000-0000-4000-8000-000000000001')
    or (select condition_status from public.inpatient_records
      where id='fb800000-0000-4000-8000-000000000001')<>'stabil'
    or exists(select 1 from public.prescription_items
      where medical_record_id='fb700000-0000-4000-8000-000000000001') then
    raise exception 'failed fee left a daily log or discharge behind'; end if;
  perform set_config('test.fail_fee','0',true);
  log_id:=public.clinic_save_inpatient_log_with_status(
    'fb800000-0000-4000-8000-000000000001',
    'fb700000-0000-4000-8000-000000000001',
    '{"condition_note":"Pasien membaik"}'::jsonb,'[]'::jsonb,'[]'::jsonb,
    'billing-inpatient-success','sembuh');
  if public.clinic_save_inpatient_log_with_status(
    'fb800000-0000-4000-8000-000000000001',
    'fb700000-0000-4000-8000-000000000001',
    '{"condition_note":"Pasien membaik"}'::jsonb,'[]'::jsonb,'[]'::jsonb,
    'billing-inpatient-success','sembuh')<>log_id then
    raise exception 'discharge retry duplicated log'; end if;
  if (select condition_status from public.inpatient_records
      where id='fb800000-0000-4000-8000-000000000001')<>'sembuh'
     or (select qty from public.prescription_items
      where medical_record_id='fb700000-0000-4000-8000-000000000001' and kategori='Rawat Inap')<>3 then
    raise exception 'discharge status or rounded fee was not saved'; end if;
end;
$$;

rollback;
