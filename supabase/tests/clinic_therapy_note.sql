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

insert into public.employees(id,nama,jabatan,status,branch_id) values
('ca800000-0000-4000-8000-000000000001','Dokter Fiktif','Dokter','Aktif','ca100000-0000-4000-8000-000000000001');
insert into public.visits(id,branch_id,customer_id,pet_id,status,poli,service_started_at)
select id::uuid,'ca100000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001','Diperiksa','Poli Umum',now()
from unnest(array['ca600000-0000-4000-8000-000000000002','ca600000-0000-4000-8000-000000000003']) id;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000002',true);

do $$
declare first_id uuid; retry_id uuid; legacy_id uuid; failed boolean;
  note jsonb := jsonb_build_object('diagnosis','Diagnosis fiktif','therapy',E'Terapi fiktif\nObservasi');
begin
  -- New nullable field is included in the same atomic record and request hash.
  first_id := public.clinic_save_initial_record('ca600000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001',note,'[]','[]','[]',null,'ca800000-0000-4000-8000-000000000001','Dokter Fiktif','Keluhan fiktif','therapy-first');
  if (select therapy from public.medical_records where id=first_id) is distinct from E'Terapi fiktif\nObservasi' then raise exception 'therapy not persisted'; end if;
  retry_id := public.clinic_save_initial_record('ca600000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001',note,'[]','[]','[]',null,'ca800000-0000-4000-8000-000000000001','Dokter Fiktif','Keluhan fiktif','therapy-first');
  if first_id is distinct from retry_id then raise exception 'retry duplicated record'; end if;
  failed := false;
  begin
    perform public.clinic_save_initial_record('ca600000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001',note || '{"therapy":"Berubah"}','[]','[]','[]',null,'ca800000-0000-4000-8000-000000000001','Dokter Fiktif','Keluhan fiktif','therapy-first');
  exception when sqlstate 'P0001' then if sqlerrm like 'IDEMPOTENCY_CONFLICT:%' then failed:=true; else raise; end if; end;
  if not failed then raise exception 'changed therapy accepted on same retry'; end if;
  failed:=false;
  begin update public.medical_records set therapy='Ditulis ulang' where id=first_id;
  exception when sqlstate 'P0001' then if sqlerrm like 'RECORD_POSTED:%' then failed:=true; else raise; end if; end;
  if not failed then raise exception 'posted therapy bypassed immutable record'; end if;
  legacy_id := public.clinic_save_initial_record('ca600000-0000-4000-8000-000000000002','ca500000-0000-4000-8000-000000000001','{"diagnosis":"Legacy"}','[]','[]','[]',null,'ca800000-0000-4000-8000-000000000001','Dokter Fiktif','Keluhan fiktif','therapy-legacy');
  if (select therapy from public.medical_records where id=legacy_id) is not null then raise exception 'legacy omission fabricated therapy'; end if;
  failed:=false;
  begin
    perform public.clinic_save_initial_record('ca600000-0000-4000-8000-000000000003','ca500000-0000-4000-8000-000000000001',note,'[]','[{"nama_obat":"Invalid","qty":"invalid","jenis":"jasa"}]','[]',null,'ca800000-0000-4000-8000-000000000001','Dokter Fiktif','Keluhan fiktif','therapy-rollback');
  exception when invalid_text_representation then failed:=true; end;
  if not failed or exists(select 1 from public.medical_records where submission_key='therapy-rollback') or (select service_finished_at from public.visits where id='ca600000-0000-4000-8000-000000000003') is not null then raise exception 'failed prescription left note or finished visit'; end if;
  failed:=false;
  perform set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000099',true);
  begin
    perform public.clinic_save_initial_record('ca600000-0000-4000-8000-000000000003','ca500000-0000-4000-8000-000000000001',note,'[]','[]','[]',null,'ca800000-0000-4000-8000-000000000001','Dokter Fiktif','Keluhan fiktif','therapy-denied');
  exception when sqlstate 'P0001' then if sqlerrm like 'ACCESS_DENIED:%' then failed:=true; else raise; end if; end;
  if not failed then raise exception 'unassigned actor saved therapy'; end if;
  perform set_config('request.jwt.claim.role','anon',true);
  failed:=false;
  begin
    perform public.clinic_save_initial_record('ca600000-0000-4000-8000-000000000003','ca500000-0000-4000-8000-000000000001',note,'[]','[]','[]',null,'ca800000-0000-4000-8000-000000000001','Dokter Fiktif','Keluhan fiktif','therapy-anon');
  exception when sqlstate 'P0001' then if sqlerrm like 'ACCESS_DENIED:%' then failed:=true; else raise; end if; end;
  if not failed then raise exception 'anonymous actor saved therapy'; end if;
end;
$$;
rollback;
