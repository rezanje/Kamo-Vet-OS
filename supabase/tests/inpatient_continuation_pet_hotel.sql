-- K06 + K14. Isolated local database only; every fictional row is rolled back.
-- scripts/test-inpatient-continuation-postgres.py also commits everything above "@@COMMIT_POINT"
-- in a second disposable run to race two admissions of the same patient.
begin;
insert into auth.users(id,raw_user_meta_data) values
 ('d6100000-0000-4000-8000-000000000001','{}'),('d6100000-0000-4000-8000-000000000002','{}');
update public.profiles set role='OWNER' where id='d6100000-0000-4000-8000-000000000001';
update public.profiles set role='FINANCE' where id='d6100000-0000-4000-8000-000000000002';
insert into public.branches(id,code,name,type) values ('d6200000-0000-4000-8000-000000000001','K06-DEMO','DEMO K06 branch','KLINIK');
insert into public.customers(id,name,phone) values ('d6300000-0000-4000-8000-000000000001','DEMO Owner','080012340606');
insert into public.pets(id,customer_id,name) values
 ('d6400000-0000-4000-8000-000000000001','d6300000-0000-4000-8000-000000000001','DEMO Paid Pet'),
 ('d6400000-0000-4000-8000-000000000002','d6300000-0000-4000-8000-000000000001','DEMO Sick Pet');
insert into public.employees(id,nama,jabatan,branch_id,status) values
 ('d6500000-0000-4000-8000-000000000001','DEMO Doctor','Dokter','d6200000-0000-4000-8000-000000000001','Aktif'),
 ('d6500000-0000-4000-8000-000000000002','DEMO Paramedic','Paramedis','d6200000-0000-4000-8000-000000000001','Aktif');
-- Pet 1. A: paid (Lunas) and checked out. A2: Selesai with no paid invoice. D: still open (Pembayaran).
insert into public.visits(id,branch_id,customer_id,pet_id,doctor_id,dokter,keluhan,status,service_started_at,service_finished_at,checked_out_at) values
 ('d6600000-0000-4000-8000-000000000001','d6200000-0000-4000-8000-000000000001','d6300000-0000-4000-8000-000000000001',
  'd6400000-0000-4000-8000-000000000001','d6500000-0000-4000-8000-000000000001','DEMO Doctor','DEMO outpatient','Selesai',now(),now(),now()),
 ('d6600000-0000-4000-8000-000000000003','d6200000-0000-4000-8000-000000000001','d6300000-0000-4000-8000-000000000001',
  'd6400000-0000-4000-8000-000000000001','d6500000-0000-4000-8000-000000000001','DEMO Doctor','DEMO second outpatient','Selesai',now(),now(),null),
 ('d6600000-0000-4000-8000-000000000004','d6200000-0000-4000-8000-000000000001','d6300000-0000-4000-8000-000000000001',
  'd6400000-0000-4000-8000-000000000001','d6500000-0000-4000-8000-000000000001','DEMO Doctor','DEMO open visit','Pembayaran',now(),now(),null);
insert into public.medical_records(id,visit_id,anamnesis,diagnosis) values
 ('d6700000-0000-4000-8000-000000000001','d6600000-0000-4000-8000-000000000001','DEMO anamnesis','DEMO diagnosis'),
 ('d6700000-0000-4000-8000-000000000003','d6600000-0000-4000-8000-000000000003','DEMO anamnesis 2','DEMO diagnosis 2'),
 ('d6700000-0000-4000-8000-000000000004','d6600000-0000-4000-8000-000000000004','DEMO anamnesis 3','DEMO diagnosis 3');
insert into public.invoices(id,visit_id,subtotal,total,paid_status,paid_at) values
 ('d6800000-0000-4000-8000-000000000001','d6600000-0000-4000-8000-000000000001',150000,150000,'Lunas',now());
insert into public.invoice_items(invoice_id,deskripsi,qty,harga) values ('d6800000-0000-4000-8000-000000000001','DEMO consult',1,150000);
-- Pet 2. B: ordinary sick case still in Pembayaran with an unpaid invoice: the direct path stays as before.
insert into public.visits(id,branch_id,customer_id,pet_id,doctor_id,dokter,keluhan,status,service_started_at,service_finished_at)
values ('d6600000-0000-4000-8000-000000000002','d6200000-0000-4000-8000-000000000001','d6300000-0000-4000-8000-000000000001',
 'd6400000-0000-4000-8000-000000000002','d6500000-0000-4000-8000-000000000001','DEMO Doctor','DEMO sick','Pembayaran',now(),now());
insert into public.medical_records(id,visit_id) values ('d6700000-0000-4000-8000-000000000002','d6600000-0000-4000-8000-000000000002');
insert into public.invoices(id,visit_id,subtotal,total,paid_status) values
 ('d6800000-0000-4000-8000-000000000002','d6600000-0000-4000-8000-000000000002',50000,50000,'Belum Lunas');
insert into public.consent_templates(id,nama,isi,branch_id,kategori) values
 ('d6900000-0000-4000-8000-000000000001','DEMO Rawat Inap','DEMO inpatient terms',null,'Rawat Inap');
update public.consent_rules set template_id=null,wajib=true where kategori='Rawat Inap';
insert into public.items(code,name,unit,item_type,is_active,tindakan_kategori,sell_price)
values ('K06-DEMO-FEE','AAA DEMO Rawat Inap','hari','Jasa',true,'Rawat Inap',100000);

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d6100000-0000-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d6100000-0000-4000-8000-000000000002',true);
do $$
declare failed boolean;
begin
  -- Clinical-role gate: FINANCE has no clinic module by default.
  failed:=false;
  begin perform public.clinic_continue_visit_to_inpatient('d6600000-0000-4000-8000-000000000001','k06-finance');
  exception when raise_exception then failed:=sqlerrm like 'ACCESS_DENIED: peran ini tidak memiliki akses modul klinik%';end;
  if not failed then raise exception 'K06: non-clinical role opened a continuation';end if;
  failed:=false;
  begin perform public.clinic_admit_inpatient_typed('d6600000-0000-4000-8000-000000000002','DEMO','k14-finance','sakit');
  exception when raise_exception then failed:=sqlerrm like 'ACCESS_DENIED: peran ini tidak memiliki akses modul klinik%';end;
  if not failed then raise exception 'K14: non-clinical role admitted a patient';end if;
end $$;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d6100000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','d6100000-0000-4000-8000-000000000001',true);

do $$
declare c1 uuid;c2 uuid;c3 uuid;cb uuid;failed boolean;
begin
  -- The reported bug: a paid visit cannot be admitted directly.
  failed:=false;
  begin perform public.clinic_admit_inpatient('d6600000-0000-4000-8000-000000000001','DEMO plan','k06-direct');
  exception when raise_exception then failed:=sqlerrm like 'ADMISSION_INVALID: kunjungan sudah selesai%';end;
  if not failed then raise exception 'K06 baseline: paid visit should still be rejected by the direct path';end if;
  -- A visit in Pembayaran with an unpaid invoice keeps the normal admission path.
  failed:=false;
  begin perform public.clinic_continue_visit_to_inpatient('d6600000-0000-4000-8000-000000000002','k06-open');
  exception when raise_exception then failed:=sqlerrm like 'ADMISSION_INVALID: kunjungan belum selesai%';end;
  if not failed then raise exception 'K06: continuation offered for a visit with an unpaid invoice still in Pembayaran';end if;

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

  -- A Selesai visit without a paid invoice may also continue (its receivable stays on its own invoice).
  cb:=public.clinic_continue_visit_to_inpatient('d6600000-0000-4000-8000-000000000003','k06-c');
  if cb is null or cb=c1 then raise exception 'K06: second source visit did not get its own continuation';end if;

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

-- Consent is signed on each visit to be admitted, exactly like a normal admission.
insert into public.consents(id,visit_id,template_id,tindakan,isi_snapshot)
select ('d6a00000-0000-4000-8000-00000000000'||n)::uuid,v,'d6900000-0000-4000-8000-000000000001','DEMO inpatient','DEMO inpatient terms'
from (values
  (1,(select id from public.visits where continued_from_visit_id='d6600000-0000-4000-8000-000000000001')),
  (2,'d6600000-0000-4000-8000-000000000002'::uuid),
  (3,(select id from public.visits where continued_from_visit_id='d6600000-0000-4000-8000-000000000003')),
  (4,'d6600000-0000-4000-8000-000000000004'::uuid)) as x(n,v);
update public.consents set status='sudah_ttd',signer_name='DEMO Owner',signature_data='data:image/png;base64,demo',signed_at=now()
where id::text like 'd6a00000-%';
-- @@COMMIT_POINT

do $$
declare ca uuid;cb uuid;r1 uuid;r2 uuid;rb uuid;m1 uuid;failed boolean;
begin
  select id into ca from public.visits where continued_from_visit_id='d6600000-0000-4000-8000-000000000001';
  select id into cb from public.visits where continued_from_visit_id='d6600000-0000-4000-8000-000000000003';
  select id into m1 from public.medical_records where visit_id=ca;
  failed:=false;
  begin perform public.clinic_admit_inpatient_typed(ca,'DEMO boarding','k14-bad','spa');
  exception when raise_exception then failed:=sqlerrm like 'ADMISSION_INVALID:%';end;
  if not failed then raise exception 'K14: unknown stay type accepted';end if;

  r1:=public.clinic_admit_inpatient_typed(ca,'DEMO boarding','k14-hotel','pet_hotel');
  r2:=public.clinic_admit_inpatient_typed(ca,'DEMO boarding','k14-hotel','pet_hotel');
  if r1 is distinct from r2 then raise exception 'K14: admission retry created another stay';end if;
  failed:=false;
  begin perform public.clinic_admit_inpatient_typed(ca,'DEMO boarding','k14-hotel','sakit');
  exception when raise_exception then failed:=sqlerrm like 'IDEMPOTENCY_CONFLICT:%';end;
  if not failed then raise exception 'K14: replay with another type was accepted';end if;
  if (select stay_type from public.inpatient_records where id=r1)<>'pet_hotel'
    or (select medical_record_id from public.inpatient_records where id=r1) is distinct from m1 then
    raise exception 'K14: pet hotel stay not stored on the continuation record';end if;
  failed:=false;
  begin update public.inpatient_records set stay_type='sakit' where id=r1;
  exception when insufficient_privilege then failed:=true;end;
  if not failed then raise exception 'K14: browser role could change stay type';end if;

  -- One live stay per patient: C_a admitted, so C_b (typed and old RPC) and the open visit D are refused.
  failed:=false;
  begin perform public.clinic_admit_inpatient_typed(cb,'DEMO second','k06-cb','sakit');
  exception when raise_exception then failed:=sqlerrm like 'ADMISSION_INVALID: pasien sudah memiliki rawat inap aktif%';end;
  if not failed then raise exception 'K06: second continuation of the same patient was admitted (typed)';end if;
  failed:=false;
  begin perform public.clinic_admit_inpatient(cb,'DEMO second','k06-cb-old');
  exception when raise_exception then failed:=sqlerrm like 'ADMISSION_INVALID: pasien sudah memiliki rawat inap aktif%';end;
  if not failed then raise exception 'K06: second continuation of the same patient was admitted (old RPC)';end if;
  failed:=false;
  begin perform public.clinic_admit_inpatient('d6600000-0000-4000-8000-000000000004','DEMO open','k06-d');
  exception when raise_exception then failed:=sqlerrm like 'ADMISSION_INVALID: pasien sudah memiliki rawat inap aktif%';end;
  if not failed then raise exception 'K06: open visit of a patient already in a stay was admitted';end if;
  failed:=false;
  begin perform public.clinic_continue_visit_to_inpatient('d6600000-0000-4000-8000-000000000001','k06-again');
  exception when raise_exception then failed:=sqlerrm like 'ADMISSION_INVALID: pasien sudah memiliki rawat inap aktif%';end;
  if not failed then raise exception 'K06: continuation opened while the patient is in a stay';end if;
  if (select count(*) from public.inpatient_records r join public.visits v on v.id=r.visit_id
      where v.pet_id='d6400000-0000-4000-8000-000000000001' and r.discharged_at is null)<>1 then
    raise exception 'K06: more than one live stay for one patient';end if;

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
  -- After discharge the next continuation of the same patient can be admitted.
  if public.clinic_admit_inpatient_typed(cb,'DEMO second','k06-cb-2','sakit') is null then raise exception 'K06: admission after discharge failed';end if;

  -- Existing sick flow (Pembayaran + unpaid invoice) is admitted directly as before, default 'sakit'.
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
select 'PASS K06/K14 continuation, idempotency, one live stay per patient, role gate, pet hotel log, separate billing';
rollback;
