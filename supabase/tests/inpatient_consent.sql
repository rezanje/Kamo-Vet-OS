-- Isolated local database only. All fixtures are rolled back.
begin;
insert into auth.users(id,raw_user_meta_data) values ('ca100000-0000-4000-8000-000000000001','{}');
update public.profiles set role='OWNER' where id='ca100000-0000-4000-8000-000000000001';
insert into public.branches(id,code,name,type) values ('ca200000-0000-4000-8000-000000000001','INAP-CONSENT','DEMO Test branch','KLINIK');
insert into public.customers(id,name,phone) values ('ca300000-0000-4000-8000-000000000001','DEMO Owner','080012340000');
insert into public.pets(id,customer_id,name) values ('ca400000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','DEMO Pet');
insert into public.employees(id,nama,jabatan,branch_id,status) values ('ca500000-0000-4000-8000-000000000001','DEMO Doctor','Dokter','ca200000-0000-4000-8000-000000000001','Aktif');
insert into public.visits(id,branch_id,customer_id,pet_id,doctor_id,dokter,keluhan,status,service_started_at,service_finished_at)
values ('ca600000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001','DEMO Doctor','DEMO complaint','Pembayaran',now(),now());
insert into public.visits(id,branch_id,customer_id,pet_id) values ('ca600000-0000-4000-8000-000000000002','ca200000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001');
insert into public.medical_records(id,visit_id) values ('ca700000-0000-4000-8000-000000000001','ca600000-0000-4000-8000-000000000001');
insert into public.consent_templates(id,nama,isi,branch_id) values
 ('ca800000-0000-4000-8000-000000000001','DEMO General','DEMO snapshot',null),
 ('ca800000-0000-4000-8000-000000000002','DEMO Rawat Inap','DEMO inpatient snapshot',null);

insert into public.branches(id,code,name,type) values ('ca200000-0000-4000-8000-000000000002','INAP-OTHER','DEMO Other','KLINIK');
insert into public.consent_templates(id,nama,isi,branch_id,kategori) values ('ca800000-0000-4000-8000-000000000003','DEMO other branch','Wrong branch','ca200000-0000-4000-8000-000000000002','Rawat Inap');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"ca100000-0000-4000-8000-000000000001"}',true);
do $$
declare admission uuid; failed boolean;
begin
  failed:=false;
  begin
    perform public.clinic_admit_inpatient('ca600000-0000-4000-8000-000000000001','DEMO monitoring','demo-admit');
  exception when raise_exception then
    if sqlerrm not like 'CONSENT_REQUIRED:%' then raise;end if;failed:=true;
  end;
  if not failed then raise exception 'Admission without inpatient consent succeeded';end if;
end $$;

do $$ begin
  begin
    insert into public.consents(visit_id,template_id,tindakan,isi_snapshot) values ('ca600000-0000-4000-8000-000000000001','ca800000-0000-4000-8000-000000000003','DEMO wrong','Wrong');
    raise exception 'Wrong branch template accepted';
  exception when raise_exception then if sqlerrm not like 'CONSENT_INVALID:%' then raise;end if;end;
end $$;
update public.consent_templates set kategori='Rawat Inap' where id='ca800000-0000-4000-8000-000000000002';
insert into public.consents(id,visit_id,template_id,tindakan,isi_snapshot)
values ('ca900000-0000-4000-8000-000000000001','ca600000-0000-4000-8000-000000000001','ca800000-0000-4000-8000-000000000001','DEMO general','DEMO snapshot');
update public.consents set status='sudah_ttd',signer_name='DEMO Owner',signature_data='data:image/png;base64,demo',signed_at=now() where id='ca900000-0000-4000-8000-000000000001';
do $$ begin
  begin
    perform public.clinic_admit_inpatient('ca600000-0000-4000-8000-000000000001','DEMO monitoring','demo-admit');
    raise exception 'Wrong consent admitted';
  exception when raise_exception then if sqlerrm not like 'CONSENT_REQUIRED:%' then raise;end if;end;
end $$;
insert into public.consents(id,visit_id,template_id,tindakan,isi_snapshot)
values ('ca900000-0000-4000-8000-000000000002','ca600000-0000-4000-8000-000000000001','ca800000-0000-4000-8000-000000000002','DEMO inpatient','DEMO inpatient snapshot');
update public.consents set status='sudah_ttd',signer_name='DEMO Owner',signature_data='data:image/png;base64,demo',signed_at=now() where id='ca900000-0000-4000-8000-000000000002';
do $$
declare a uuid;b uuid;
begin
  begin
    update public.visits set branch_id='ca200000-0000-4000-8000-000000000002' where id='ca600000-0000-4000-8000-000000000001';
    raise exception 'Signed branch-specific identity could be moved';
  exception when raise_exception then if sqlerrm not like 'CONSENT_LOCKED:%' then raise;end if;end;
  begin
    update public.visits set customer_id=null where id='ca600000-0000-4000-8000-000000000001';
    raise exception 'Signed owner identity could be changed';
  exception when raise_exception then if sqlerrm not like 'CONSENT_LOCKED:%' then raise;end if;end;
  update public.consent_rules set template_id='ca800000-0000-4000-8000-000000000003' where kategori='Rawat Inap';
  begin
    perform public.clinic_admit_inpatient('ca600000-0000-4000-8000-000000000001','DEMO monitoring','demo-admit');
    raise exception 'Wrong required template admitted';
  exception when raise_exception then if sqlerrm not like 'CONSENT_REQUIRED:%' then raise;end if;end;
  update public.consent_rules set template_id=null where kategori='Rawat Inap';
  a:=public.clinic_admit_inpatient('ca600000-0000-4000-8000-000000000001','DEMO monitoring','demo-admit');
  b:=public.clinic_admit_inpatient('ca600000-0000-4000-8000-000000000001','DEMO monitoring','demo-admit');
  if a is distinct from b or (select count(*) from public.inpatient_status_log where inpatient_record_id=a)<>1 then raise exception 'Admission retry duplicated effects';end if;
  if not public.clinic_inpatient_consent_valid('ca600000-0000-4000-8000-000000000001') then raise exception 'Admission lost consent link';end if;
  begin
    update public.consents set isi_snapshot='forged' where id='ca900000-0000-4000-8000-000000000002';
    raise exception 'Signed snapshot was editable';
  exception when raise_exception then if sqlerrm not like 'CONSENT_LOCKED:%' then raise;end if;end;
  begin
    update public.inpatient_records set consent_id=null where id=a;
    raise exception 'Admission consent could be cleared';
  exception when insufficient_privilege then null;when raise_exception then if sqlerrm not like 'CONSENT_LOCKED:%' then raise;end if;end;
  update public.consent_templates set isi='revised'  where id='ca800000-0000-4000-8000-000000000002';
  if (select isi_snapshot from public.consents where id='ca900000-0000-4000-8000-000000000002')<>'DEMO inpatient snapshot' then raise exception 'Template changed signed snapshot';end if;
end $$;
insert into public.consents(id,visit_id,template_id,tindakan,isi_snapshot)
values ('ca900000-0000-4000-8000-000000000003','ca600000-0000-4000-8000-000000000002','ca800000-0000-4000-8000-000000000002','DEMO unsigned draft','DEMO inpatient snapshot');
update public.visits set branch_id='ca200000-0000-4000-8000-000000000002' where id='ca600000-0000-4000-8000-000000000002';
do $$ begin
  begin
    update public.consents set status='sudah_ttd',signer_name='DEMO Owner',signature_data='DEMO',signed_at=now() where id='ca900000-0000-4000-8000-000000000003';
    raise exception 'Changed unsigned identity could be signed';
  exception when raise_exception then if sqlerrm not like 'CONSENT_INVALID:%' then raise;end if;end;
end $$;
rollback;
