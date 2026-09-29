-- Run only on isolated local Supabase after the clinic/catalog migrations.
begin;

insert into auth.users(id, raw_user_meta_data) values
  ('ca000000-0000-4000-8000-000000000001', '{}'),
  ('ca000000-0000-4000-8000-000000000002', '{}');
update public.profiles set role='OWNER'
where id='ca000000-0000-4000-8000-000000000001';
update public.profiles set role='DOCTOR'
where id='ca000000-0000-4000-8000-000000000002';
insert into public.branches(id, code, name, type)
values ('ca100000-0000-4000-8000-000000000001','ATOMIC-REQ2','Cabang Uji','KLINIK');
insert into public.user_branches(user_id,branch_id) values
  ('ca000000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001'),
  ('ca000000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000001');
insert into public.items(id,code,name,unit,item_type,is_active,is_compound_material,sell_price)
values ('ca200000-0000-4000-8000-000000000001','ATOMIC-BHN','Bahan uji','gram','Persediaan',true,true,15);
insert into public.warehouses(id,branch_id,code,name,type)
values ('ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','ATOMIC-WH','Gudang Uji','VET');
insert into public.stock(warehouse_id,item_id,qty)
values ('ca300000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001',10);
insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
values ('ca300000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001',current_date,10,10,5,'purchase');
insert into public.customers(id,name,phone)
values ('ca400000-0000-4000-8000-000000000001','Pemilik Uji','080000000001');
insert into public.pets(id,customer_id,name)
values ('ca500000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001','Pasien Uji');
insert into public.visits(id,branch_id,customer_id,pet_id,status,service_started_at)
values ('ca600000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001','Diperiksa',now());

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000001',true);

do $$
declare v_formula uuid; v_version uuid; v_first uuid; v_retry uuid; failed boolean;
  v_record jsonb := '{"diagnosis":"Uji","berat":4,"penunjang_urls":[]}';
  v_followups jsonb := '[{"jenis":"Kontrol","tanggal":"2026-10-01","catatan":"Uji"}]';
  v_rows jsonb := '[{"nama_obat":"Jasa Uji","item_id":null,"qty":1,"satuan":"tindakan","faktor":1,"harga":1000,"jenis":"jasa"}]';
begin
  v_version := public.publish_compound_formula(null,'ATOMIC-REQ2','Racikan Uji','puyer',null,
    '[{"item_id":"ca200000-0000-4000-8000-000000000001","quantity":2,"unit":"gram"}]');
  select formula_id into v_formula from public.compound_formula_versions where id=v_version;
  perform set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000002',true);

  -- The second formula fails after the first one tried to issue stock.
  failed := false;
  begin
    perform public.clinic_save_initial_record(
      'ca600000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001',
      v_record,v_followups,v_rows,
      jsonb_build_array(
        jsonb_build_object('official_version_id',v_version,'request_key','atomic-first'),
        jsonb_build_object('official_version_id','ca700000-0000-4000-8000-000000000001','request_key','atomic-fail')
      ),null,null,'Dokter Uji',null,'atomic-record-fail');
  exception when others then failed := true; end;
  if not failed then raise exception 'invalid second compound was accepted'; end if;
  if exists(select 1 from public.medical_records where visit_id='ca600000-0000-4000-8000-000000000001')
     or exists(select 1 from public.compounding_recipes where request_key='atomic-first')
     or (select qty from public.stock where warehouse_id='ca300000-0000-4000-8000-000000000001'
         and item_id='ca200000-0000-4000-8000-000000000001') <> 10
     or (select service_finished_at from public.visits where id='ca600000-0000-4000-8000-000000000001') is not null then
    raise exception 'compound failure left a partial record, stock move, or finished visit';
  end if;

  v_first := public.clinic_save_initial_record(
    'ca600000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001',
    v_record,v_followups,v_rows,
    jsonb_build_array(jsonb_build_object('official_version_id',v_version,'request_key','atomic-final')),
    null,null,'Dokter Uji',null,'atomic-record-success');
  v_retry := public.clinic_save_initial_record(
    'ca600000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001',
    v_record,v_followups,v_rows,
    jsonb_build_array(jsonb_build_object('official_version_id',v_version,'request_key','atomic-final')),
    null,null,'Dokter Uji',null,'atomic-record-success');
  if v_first is null or v_retry <> v_first
     or (select count(*) from public.medical_records where visit_id='ca600000-0000-4000-8000-000000000001') <> 1
     or (select count(*) from public.follow_ups where medical_record_id=v_first) <> 1
     or (select count(*) from public.prescription_items where medical_record_id=v_first) <> 2
     or (select qty from public.stock where warehouse_id='ca300000-0000-4000-8000-000000000001'
         and item_id='ca200000-0000-4000-8000-000000000001') <> 8
     or (select service_finished_at from public.visits where id='ca600000-0000-4000-8000-000000000001') is null then
    raise exception 'atomic initial record or idempotent retry failed';
  end if;
  failed := false;
  begin
    perform public.clinic_save_initial_record(
      'ca600000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001',
      v_record || '{"diagnosis":"Berubah"}',v_followups,v_rows,
      jsonb_build_array(jsonb_build_object('official_version_id',v_version,'request_key','atomic-final')),
      null,null,'Dokter Uji',null,'atomic-record-success');
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'changed retry reused the submission key'; end if;
  failed := false;
  begin
    update public.medical_records set diagnosis='Diubah' where id=v_first;
  exception when sqlstate 'P0001' then failed := true; end;
  if not failed then raise exception 'posted medical record was edited'; end if;
end;
$$;

rollback;
