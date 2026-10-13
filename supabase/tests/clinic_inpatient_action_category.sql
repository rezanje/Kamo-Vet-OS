-- Local fictional data only. Saving catalog actions must preserve the consent
-- category as well as the SKU and amounts, without rewriting historical rows.
begin;
insert into auth.users(id, raw_user_meta_data)
values ('ce000000-0000-4000-8000-000000000001', '{}');
update public.profiles set role='OWNER' where id='ce000000-0000-4000-8000-000000000001';
insert into public.branches(id,code,name,type)
values ('ce100000-0000-4000-8000-000000000001','ACTION-TEST','Cabang Uji Tindakan','KLINIK');
insert into public.user_branches(user_id,branch_id)
values ('ce000000-0000-4000-8000-000000000001','ce100000-0000-4000-8000-000000000001');
insert into public.employees(id,nama,jabatan,branch_id,status)
values ('ce200000-0000-4000-8000-000000000001','Dokter Uji','Dokter','ce100000-0000-4000-8000-000000000001','Aktif');
insert into public.items(id,code,name,unit,item_type,is_active,sell_price,tindakan_kategori)
values ('ce300000-0000-4000-8000-000000000001','ACTION-SKU','Steril Uji','tindakan','Jasa',true,75000,'Operasi');
insert into public.customers(id,name,phone)
values ('ce400000-0000-4000-8000-000000000001','Pemilik Uji','080000000009');
insert into public.pets(id,customer_id,name)
values ('ce500000-0000-4000-8000-000000000001','ce400000-0000-4000-8000-000000000001','Pasien Uji');
insert into public.visits(id,branch_id,customer_id,pet_id,status,doctor_id,dokter,service_started_at)
values ('ce600000-0000-4000-8000-000000000001','ce100000-0000-4000-8000-000000000001',
  'ce400000-0000-4000-8000-000000000001','ce500000-0000-4000-8000-000000000001','Diperiksa',
  'ce200000-0000-4000-8000-000000000001','Dokter Uji',now());
insert into public.medical_records(id,visit_id,diagnosis)
values ('ce700000-0000-4000-8000-000000000001','ce600000-0000-4000-8000-000000000001','Rawat inap');
insert into public.prescription_items(medical_record_id,nama_obat,qty,satuan,harga,jenis,kategori)
values ('ce700000-0000-4000-8000-000000000001','Jasa historis',1,'jasa',1000,'jasa',null);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ce000000-0000-4000-8000-000000000001',true);
insert into public.inpatient_records(id,branch_id,visit_id,medical_record_id)
values ('ce800000-0000-4000-8000-000000000001','ce100000-0000-4000-8000-000000000001',
  'ce600000-0000-4000-8000-000000000001','ce700000-0000-4000-8000-000000000001');
set local role authenticated;
do $$
declare
  first_id uuid;
  retry_id uuid;
  log jsonb := '{"condition_note":"Kontrol stabil","log_kind":"monitoring"}';
  rows jsonb := '[{"nama_obat":"Steril Uji","item_id":"ce300000-0000-4000-8000-000000000001","qty":2,"satuan":"tindakan","faktor":1,"harga":75000,"jenis":"jasa","kategori":"Operasi"}]';
begin
  first_id := public.clinic_save_inpatient_log_with_status(
    'ce800000-0000-4000-8000-000000000001','ce700000-0000-4000-8000-000000000001',
    log,rows,'[]','action-category-save',null);
  retry_id := public.clinic_save_inpatient_log_with_status(
    'ce800000-0000-4000-8000-000000000001','ce700000-0000-4000-8000-000000000001',
    log,rows,'[]','action-category-save',null);
  if first_id is distinct from retry_id then raise exception 'retry created a new log'; end if;
  if not exists(select 1 from public.prescription_items
    where medical_record_id='ce700000-0000-4000-8000-000000000001'
    and item_id='ce300000-0000-4000-8000-000000000001' and nama_obat='Steril Uji'
    and qty=2 and satuan='tindakan' and faktor=1 and harga=75000 and jenis='jasa' and kategori='Operasi') then
    raise exception 'saved action lost identity, amount, or consent category';
  end if;
  if (select count(*) from public.prescription_items where medical_record_id='ce700000-0000-4000-8000-000000000001')<>2
    or not exists(select 1 from public.prescription_items where medical_record_id='ce700000-0000-4000-8000-000000000001'
      and nama_obat='Jasa historis' and harga=1000 and item_id is null and kategori is null) then
    raise exception 'retry duplicated items or historical row changed';
  end if;
end;
$$;
rollback;
