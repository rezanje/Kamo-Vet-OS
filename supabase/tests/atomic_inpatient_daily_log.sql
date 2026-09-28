-- Run only on isolated local Supabase after the clinic/catalog migrations.
begin;

insert into auth.users(id, raw_user_meta_data)
values ('cb000000-0000-4000-8000-000000000001', '{}');
update public.profiles set role='OWNER'
where id='cb000000-0000-4000-8000-000000000001';
insert into public.branches(id, code, name, type)
values ('cb100000-0000-4000-8000-000000000001','INPAT-REQ2','Cabang Uji','KLINIK');
insert into public.user_branches(user_id,branch_id)
values ('cb000000-0000-4000-8000-000000000001','cb100000-0000-4000-8000-000000000001');
insert into public.items(id,code,name,unit,item_type,is_active,is_compound_material,sell_price)
values ('cb200000-0000-4000-8000-000000000001','INPAT-BHN','Bahan uji','gram','Persediaan',true,true,15);
insert into public.warehouses(id,branch_id,code,name,type)
values ('cb300000-0000-4000-8000-000000000001','cb100000-0000-4000-8000-000000000001','INPAT-WH','Gudang Uji','VET');
insert into public.stock(warehouse_id,item_id,qty)
values ('cb300000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001',10);
insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
values ('cb300000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001',current_date,10,10,5,'purchase');
insert into public.customers(id,name,phone)
values ('cb400000-0000-4000-8000-000000000001','Pemilik Uji','080000000002');
insert into public.pets(id,customer_id,name)
values ('cb500000-0000-4000-8000-000000000001','cb400000-0000-4000-8000-000000000001','Pasien Uji');
insert into public.visits(id,branch_id,customer_id,pet_id,status,service_started_at)
values ('cb600000-0000-4000-8000-000000000001','cb100000-0000-4000-8000-000000000001',
  'cb400000-0000-4000-8000-000000000001','cb500000-0000-4000-8000-000000000001','Diperiksa',now());
insert into public.medical_records(id,visit_id,diagnosis)
values ('cb700000-0000-4000-8000-000000000001','cb600000-0000-4000-8000-000000000001','Rawat inap');
insert into public.inpatient_records(id,branch_id,visit_id,medical_record_id)
values ('cb800000-0000-4000-8000-000000000001','cb100000-0000-4000-8000-000000000001',
  'cb600000-0000-4000-8000-000000000001','cb700000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','cb000000-0000-4000-8000-000000000001',true);

do $$
declare v_version uuid; v_first uuid; v_retry uuid; failed boolean;
  v_log jsonb := '{"condition_note":"Stabil","makan":"habis"}';
  v_rows jsonb := '[{"nama_obat":"Jasa Uji","item_id":null,"qty":1,"satuan":"tindakan","faktor":1,"harga":1000,"jenis":"jasa"}]';
begin
  v_version := public.publish_compound_formula(null,'INPAT-REQ2','Racikan Uji','puyer',null,
    '[{"item_id":"cb200000-0000-4000-8000-000000000001","quantity":2,"unit":"gram"}]');
  failed := false;
  begin
    perform public.clinic_save_inpatient_log(
      'cb800000-0000-4000-8000-000000000001','cb700000-0000-4000-8000-000000000001',
      v_log,v_rows,jsonb_build_array(
        jsonb_build_object('official_version_id',v_version,'request_key','inpat-first'),
        jsonb_build_object('official_version_id','cb900000-0000-4000-8000-000000000001','request_key','inpat-fail')
      ),'inpat-record-fail');
  exception when others then failed := true; end;
  if not failed or exists(select 1 from public.inpatient_daily_logs where inpatient_record_id='cb800000-0000-4000-8000-000000000001')
     or exists(select 1 from public.prescription_items where medical_record_id='cb700000-0000-4000-8000-000000000001')
     or exists(select 1 from public.compounding_recipes where request_key='inpat-first')
     or (select qty from public.stock where warehouse_id='cb300000-0000-4000-8000-000000000001'
         and item_id='cb200000-0000-4000-8000-000000000001') <> 10 then
    raise exception 'formula failure left a partial log, prescription, or stock move';
  end if;

  v_first := public.clinic_save_inpatient_log(
    'cb800000-0000-4000-8000-000000000001','cb700000-0000-4000-8000-000000000001',
    v_log,v_rows,jsonb_build_array(jsonb_build_object('official_version_id',v_version,'request_key','inpat-final')),
    'inpat-record-success');
  v_retry := public.clinic_save_inpatient_log(
    'cb800000-0000-4000-8000-000000000001','cb700000-0000-4000-8000-000000000001',
    v_log,v_rows,jsonb_build_array(jsonb_build_object('official_version_id',v_version,'request_key','inpat-final')),
    'inpat-record-success');
  if v_first is null or v_first <> v_retry
     or (select count(*) from public.inpatient_daily_logs where inpatient_record_id='cb800000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.prescription_items where medical_record_id='cb700000-0000-4000-8000-000000000001') <> 2
     or (select qty from public.stock where warehouse_id='cb300000-0000-4000-8000-000000000001'
         and item_id='cb200000-0000-4000-8000-000000000001') <> 8 then
    raise exception 'atomic inpatient log or idempotent retry failed';
  end if;
  failed := false;
  begin
    perform public.clinic_save_inpatient_log(
      'cb800000-0000-4000-8000-000000000001','cb700000-0000-4000-8000-000000000001',
      v_log || '{"condition_note":"Berubah"}',v_rows,
      jsonb_build_array(jsonb_build_object('official_version_id',v_version,'request_key','inpat-final')),
      'inpat-record-success');
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'changed retry reused the submission key'; end if;
  update public.inpatient_daily_logs set condition_note='Dikoreksi' where id=v_first;
  failed := false;
  begin
    update public.inpatient_daily_logs set submission_key='lain' where id=v_first;
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'submission identity was changed'; end if;
end;
$$;

rollback;
