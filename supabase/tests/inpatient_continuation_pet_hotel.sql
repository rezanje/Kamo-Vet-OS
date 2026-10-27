-- K06 + K14. Isolated local database only; every fictional row is rolled back.
begin;
insert into auth.users(id,raw_user_meta_data) values ('d6100000-0000-4000-8000-000000000001','{}');
update public.profiles set role='OWNER' where id='d6100000-0000-4000-8000-000000000001';
insert into public.branches(id,code,name,type) values ('d6200000-0000-4000-8000-000000000001','K06-DEMO','DEMO K06 branch','KLINIK');
insert into public.customers(id,name,phone) values ('d6300000-0000-4000-8000-000000000001','DEMO Owner','080012340606');
insert into public.pets(id,customer_id,name) values
 ('d6400000-0000-4000-8000-000000000001','d6300000-0000-4000-8000-000000000001','DEMO Paid Pet'),
 ('d6400000-0000-4000-8000-000000000002','d6300000-0000-4000-8000-000000000001','DEMO Sick Pet');
insert into public.employees(id,nama,jabatan,branch_id,status) values
 ('d6500000-0000-4000-8000-000000000001','DEMO Doctor','Dokter','d6200000-0000-4000-8000-000000000001','Aktif'),
 ('d6500000-0000-4000-8000-000000000002','DEMO Paramedic','Paramedis','d6200000-0000-4000-8000-000000000001','Aktif');
-- Visit A: outpatient, examined, paid and checked out.
insert into public.visits(id,branch_id,customer_id,pet_id,doctor_id,dokter,keluhan,status,service_started_at,service_finished_at,checked_out_at)
values ('d6600000-0000-4000-8000-000000000001','d6200000-0000-4000-8000-000000000001','d6300000-0000-4000-8000-000000000001',
 'd6400000-0000-4000-8000-000000000001','d6500000-0000-4000-8000-000000000001','DEMO Doctor','DEMO outpatient','Selesai',now(),now(),now());
insert into public.medical_records(id,visit_id,anamnesis,diagnosis) values
 ('d6700000-0000-4000-8000-000000000001','d6600000-0000-4000-8000-000000000001','DEMO anamnesis','DEMO diagnosis');
insert into public.invoices(id,visit_id,subtotal,total,paid_status,paid_at) values
 ('d6800000-0000-4000-8000-000000000001','d6600000-0000-4000-8000-000000000001',150000,150000,'Lunas',now());
insert into public.invoice_items(invoice_id,deskripsi,qty,harga) values ('d6800000-0000-4000-8000-000000000001','DEMO consult',1,150000);
-- Visit B: ordinary sick admission, still in the normal flow.
insert into public.visits(id,branch_id,customer_id,pet_id,doctor_id,dokter,keluhan,status,service_started_at,service_finished_at)
values ('d6600000-0000-4000-8000-000000000002','d6200000-0000-4000-8000-000000000001','d6300000-0000-4000-8000-000000000001',
 'd6400000-0000-4000-8000-000000000002','d6500000-0000-4000-8000-000000000001','DEMO Doctor','DEMO sick','Pembayaran',now(),now());
insert into public.medical_records(id,visit_id) values ('d6700000-0000-4000-8000-000000000002','d6600000-0000-4000-8000-000000000002');
insert into public.consent_templates(id,nama,isi,branch_id,kategori) values
 ('d6900000-0000-4000-8000-000000000001','DEMO Rawat Inap','DEMO inpatient terms',null,'Rawat Inap');
update public.consent_rules set template_id=null,wajib=true where kategori='Rawat Inap';
insert into public.items(code,name,unit,item_type,is_active,tindakan_kategori,sell_price)
values ('K06-DEMO-FEE','AAA DEMO Rawat Inap','hari','Jasa',true,'Rawat Inap',100000);

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d6100000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d6100000-0000-4000-8000-000000000001',true);

do $$
declare c1 uuid;c2 uuid;c3 uuid;failed boolean;
begin
  -- The reported bug: a paid visit cannot be admitted directly.
  failed:=false;
  begin perform public.clinic_admit_inpatient('d6600000-0000-4000-8000-000000000001','DEMO plan','k06-direct');
  exception when raise_exception then failed:=sqlerrm like 'ADMISSION_INVALID: kunjungan sudah selesai%';end;
  if not failed then raise exception 'K06 baseline: paid visit should still be rejected by the direct path';end if;
  -- An open visit must keep using the normal admission path.
  failed:=false;
  begin perform public.clinic_continue_visit_to_inpatient('d6600000-0000-4000-8000-000000000002','k06-open');
  exception when raise_exception then failed:=sqlerrm like 'ADMISSION_INVALID: kunjungan belum selesai%';end;
  if not failed then raise exception 'K06: continuation offered for an open visit';end if;

  c1:=public.clinic_continue_visit_to_inpatient('d6600000-0000-4000-8000-000000000001','k06-a');
  c2:=public.clinic_continue_visit_to_inpatient('d6600000-0000-4000-8000-000000000001','k06-a');
  c3:=public.clinic_continue_visit_to_inpatient('d6600000-0000-4000-8000-000000000001','k06-b');
  if c1 is distinct from c2 or c1 is distinct from c3 then raise exception 'K06: retry or double click created another continuation';end if;
  if (select count(*) from public.visits where continued_from_visit_id='d6600000-0000-4000-8000-000000000001')<>1 then
    raise exception 'K06: duplicate continuation visits';end if;
  if not exists(select 1 from public.visits where id=c1 and status='Pembayaran' and pet_id='d6400000-0000-4000-8000-000000000001'
      and customer_id='d6300000-0000-4000-8000-000000000001' and doctor_id='d6500000-0000-4000-8000-000000000001' and checked_out_at is null) then
    raise exception 'K06: continuation visit lost patient, owner or doctor';end if;
  if not exists(select 1 from public.medical_records where visit_id=c1 and continued_from_record_id='d6700000-0000-4000-8000-000000000001'
      and diagnosis='DEMO diagnosis') then raise exception 'K06: continuation record not linked to the original record';end if;
  if exists(select 1 from public.invoices where visit_id=c1) then raise exception 'K06: continuation must start without an invoice';end if;

  failed:=false;
  begin update public.visits set continued_from_visit_id=null where id=c1;
  exception when raise_exception then failed:=sqlerrm like 'CONTINUATION_LOCKED:%';end;
  if not failed then raise exception 'K06: browser role could move the continuation link';end if;
  failed:=false;
  begin insert into public.visits(branch_id,customer_id,pet_id,continued_from_visit_id) values
    ('d6200000-0000-4000-8000-000000000001','d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001','d6600000-0000-4000-8000-000000000002');
  exception when raise_exception then failed:=sqlerrm like 'CONTINUATION_LOCKED:%';end;
  if not failed then raise exception 'K06: browser role could forge a continuation';end if;
end $$;

-- Consent is signed on the continuation visit, exactly like a normal admission.
insert into public.consents(id,visit_id,template_id,tindakan,isi_snapshot)
select 'd6a00000-0000-4000-8000-000000000001',id,'d6900000-0000-4000-8000-000000000001','DEMO inpatient','DEMO inpatient terms'
from public.visits where continued_from_visit_id='d6600000-0000-4000-8000-000000000001';
update public.consents set status='sudah_ttd',signer_name='DEMO Owner',signature_data='data:image/png;base64,demo',signed_at=now()
where id='d6a00000-0000-4000-8000-000000000001';
insert into public.consents(id,visit_id,template_id,tindakan,isi_snapshot) values
 ('d6a00000-0000-4000-8000-000000000002','d6600000-0000-4000-8000-000000000002','d6900000-0000-4000-8000-000000000001','DEMO inpatient','DEMO inpatient terms');
update public.consents set status='sudah_ttd',signer_name='DEMO Owner',signature_data='data:image/png;base64,demo',signed_at=now()
where id='d6a00000-0000-4000-8000-000000000002';

do $$
declare c1 uuid;r1 uuid;r2 uuid;rb uuid;m1 uuid;failed boolean;
begin
  select id into c1 from public.visits where continued_from_visit_id='d6600000-0000-4000-8000-000000000001';
  select id into m1 from public.medical_records where visit_id=c1;
  failed:=false;
  begin perform public.clinic_admit_inpatient_typed(c1,'DEMO boarding','k14-bad','spa');
  exception when raise_exception then failed:=sqlerrm like 'ADMISSION_INVALID:%';end;
  if not failed then raise exception 'K14: unknown stay type accepted';end if;

  r1:=public.clinic_admit_inpatient_typed(c1,'DEMO boarding','k14-hotel','pet_hotel');
  r2:=public.clinic_admit_inpatient_typed(c1,'DEMO boarding','k14-hotel','pet_hotel');
  if r1 is distinct from r2 then raise exception 'K14: admission retry created another stay';end if;
  failed:=false;
  begin perform public.clinic_admit_inpatient_typed(c1,'DEMO boarding','k14-hotel','sakit');
  exception when raise_exception then failed:=sqlerrm like 'IDEMPOTENCY_CONFLICT:%';end;
  if not failed then raise exception 'K14: replay with another type was accepted';end if;
  if (select stay_type from public.inpatient_records where id=r1)<>'pet_hotel'
    or (select medical_record_id from public.inpatient_records where id=r1) is distinct from m1 then
    raise exception 'K14: pet hotel stay not stored on the continuation record';end if;
  failed:=false;
  begin update public.inpatient_records set stay_type='sakit' where id=r1;
  exception when insufficient_privilege then failed:=true;end;
  if not failed then raise exception 'K14: browser role could change stay type';end if;

  -- Second admission for the same patient while the stay is live.
  failed:=false;
  begin perform public.clinic_continue_visit_to_inpatient('d6600000-0000-4000-8000-000000000001','k06-again');
  exception when raise_exception then failed:=sqlerrm like 'ADMISSION_INVALID: pasien sudah memiliki rawat inap aktif%';end;
  if not failed then raise exception 'K06: double admission was allowed';end if;

  -- Pet hotel daily log: food, condition, free note by a paramedic; no doctor, no temperature.
  perform public.clinic_save_inpatient_log_with_status(r1,m1,
    '{"condition_note":"Sehat, aktif","makan":"habis","keterangan":"Main di halaman","log_kind":"monitoring","paramedic_id":"d6500000-0000-4000-8000-000000000002"}',
    '[]','[]','k14-log-1',null);
  if not exists(select 1 from public.inpatient_daily_logs where inpatient_record_id=r1 and paramedic_name='DEMO Paramedic'
      and visit_doctor_id is null and suhu is null and makan is not null) then
    raise exception 'K14: pet hotel log without doctor or temperature was not stored';end if;

  -- Discharge bills the stay on the continuation visit only.
  if not public.clinic_change_inpatient_condition(r1,'sembuh','DEMO pick-up') then raise exception 'K14: discharge failed';end if;
  if not exists(select 1 from public.prescription_items where medical_record_id=m1 and kategori='Rawat Inap')
    or exists(select 1 from public.prescription_items where medical_record_id='d6700000-0000-4000-8000-000000000001') then
    raise exception 'K06: stay fee must land on the continuation record, never on the paid visit';end if;

  -- Existing sick flow is unchanged and defaults to 'sakit'.
  rb:=public.clinic_admit_inpatient('d6600000-0000-4000-8000-000000000002','DEMO infusion','k14-legacy');
  if (select stay_type from public.inpatient_records where id=rb)<>'sakit' then raise exception 'K14: default stay type must be sakit';end if;
end $$;

-- The paid invoice of the original visit is untouched.
do $$ begin
  if (select count(*) from public.invoices where visit_id='d6600000-0000-4000-8000-000000000001')<>1
    or (select total from public.invoices where id='d6800000-0000-4000-8000-000000000001')<>150000
    or (select paid_status from public.invoices where id='d6800000-0000-4000-8000-000000000001')<>'Lunas'
    or (select voided_at from public.invoices where id='d6800000-0000-4000-8000-000000000001') is not null
    or (select count(*) from public.invoice_items where invoice_id='d6800000-0000-4000-8000-000000000001')<>1
    or (select status::text from public.visits where id='d6600000-0000-4000-8000-000000000001')<>'Selesai' then
    raise exception 'K06: original paid invoice or visit changed';end if;
end $$;
select 'PASS K06/K14 continuation, idempotency, double-admission guard, pet hotel log, separate billing';
rollback;
