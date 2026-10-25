-- Append to the fictional inpatient_consent.sql fixture before its ROLLBACK.
-- This file deliberately performs no stock, invoice, journal, or production writes.
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"ca100000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ca100000-0000-4000-8000-000000000001',true);
insert into public.visits(id,branch_id,customer_id,pet_id,doctor_id,dokter,status,service_started_at,service_finished_at)
values ('ca600000-0000-4000-8000-000000000004',
  'ca200000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001',
  'DEMO Doctor','Pembayaran',now(),now());
insert into public.medical_records(id,visit_id)
values ('ca700000-0000-4000-8000-000000000004','ca600000-0000-4000-8000-000000000004');
insert into public.consents(id,visit_id,template_id,tindakan,isi_snapshot)
values ('ca900000-0000-4000-8000-000000000006','ca600000-0000-4000-8000-000000000004',
  'ca800000-0000-4000-8000-000000000002','DEMO Rawat Inap','DEMO signed admission');
update public.consents set status='sudah_ttd',signer_name='DEMO Owner',
  signature_data='data:image/png;base64,demo',signed_at=now()
where id='ca900000-0000-4000-8000-000000000006';
select public.clinic_admit_inpatient('ca600000-0000-4000-8000-000000000004',
  'DEMO K07 stay','demo-k07-admission');
insert into public.prescription_items(id,medical_record_id,nama_obat,qty,satuan,jenis)
values ('ca910000-0000-4000-8000-000000000001',
  'ca700000-0000-4000-8000-000000000004','DEMO Obat Biasa',3,'tablet','obat');
insert into public.prescription_items(id,medical_record_id,nama_obat,qty,satuan,jenis)
values ('ca910000-0000-4000-8000-000000000002',
  'ca700000-0000-4000-8000-000000000004','DEMO Obat Ruangan',2,'tablet','obat');

do $$
declare v_record uuid;v_handover uuid;v_administration uuid;v_failed boolean;
begin
  select id into v_record from public.inpatient_records
    where visit_id='ca600000-0000-4000-8000-000000000004';
  if v_record is null then raise exception 'fictional admission fixture missing';end if;
  perform set_config('test.k07_record_id',v_record::text,true);

  v_handover:=public.clinic_record_rx_evidence(v_record,
    'ca910000-0000-4000-8000-000000000001','handover',2,null,null,'rx-evidence-demo-hand-01');
  if public.clinic_record_rx_evidence(v_record,
    'ca910000-0000-4000-8000-000000000001','handover',2,null,null,'rx-evidence-demo-hand-01') is distinct from v_handover then
    raise exception 'identical request key duplicated handover';
  end if;
  if (select count(*) from public.inpatient_rx_evidence where prescription_item_id='ca910000-0000-4000-8000-000000000001')<>1 then
    raise exception 'handover replay produced another row';
  end if;
  v_failed:=false;
  begin
    perform public.clinic_record_rx_evidence(v_record,
      'ca910000-0000-4000-8000-000000000001','handover',1,null,null,'rx-evidence-demo-hand-01');
  exception when others then v_failed:=sqlerrm like 'IDEMPOTENCY_CONFLICT:%';end;
  if not v_failed then raise exception 'conflicting request key was accepted';end if;

  v_administration:=public.clinic_record_rx_evidence(v_record,
    'ca910000-0000-4000-8000-000000000001','administration',1,null,'DEMO dose','rx-evidence-demo-given-01');
  if v_administration is null then raise exception 'administration evidence missing';end if;
  if public.clinic_record_rx_evidence(v_record,
    'ca910000-0000-4000-8000-000000000002','administration',1,null,'DEMO ward stock',
    'rx-evidence-demo-given-02') is null then
    raise exception 'independent administration evidence missing';
  end if;
  v_failed:=false;
  begin
    perform public.clinic_record_rx_evidence(v_record,
      'ca910000-0000-4000-8000-000000000001','handover',2,null,null,'rx-evidence-demo-over-01');
  exception when others then v_failed:=sqlerrm like 'RX_EVIDENCE_INVALID:%';end;
  if not v_failed then raise exception 'quantity beyond prescription was accepted';end if;

  -- Source identity/quantity must stay stable after any evidence exists.
  v_failed:=false;
  begin
    update public.prescription_items set qty=1 where id='ca910000-0000-4000-8000-000000000001';
  exception when others then v_failed:=sqlerrm like 'RX_EVIDENCE_LOCKED:%';end;
  if not v_failed then raise exception 'prescription quantity changed after evidence';end if;
  v_failed:=false;
  begin
    update public.medical_records set visit_id='ca600000-0000-4000-8000-000000000002'
      where id='ca700000-0000-4000-8000-000000000004';
  exception when others then v_failed:=sqlerrm like 'RX_EVIDENCE_LOCKED:%';end;
  if not v_failed then raise exception 'medical record moved after prescription evidence';end if;
  if not public.clinic_void_rx_evidence(v_administration,'DEMO salah catat') then
    raise exception 'administration void failed';end if;
  if (select voided_at from public.inpatient_rx_evidence where id=v_administration) is null
    or (select count(*) from public.inpatient_rx_evidence where prescription_item_id='ca910000-0000-4000-8000-000000000001')<>2 then
    raise exception 'void erased evidence or failed to retain audit row';
  end if;
  if not public.clinic_void_rx_evidence(v_administration,'DEMO salah catat') then
    raise exception 'identical void retry failed';end if;
  v_failed:=false;
  begin
    perform public.clinic_void_rx_evidence(v_administration,'DEMO alasan berubah');
  exception when others then v_failed:=sqlerrm like 'IDEMPOTENCY_CONFLICT:%';end;
  if not v_failed then raise exception 'different void reason was acknowledged as a retry';end if;
end $$;

-- A different active user assigned only to the other branch cannot write this stay.
reset role;
do $$
begin
  if has_table_privilege('authenticated','public.inpatient_rx_evidence','INSERT')
    or has_table_privilege('service_role','public.inpatient_rx_evidence','UPDATE')
    or has_table_privilege('authenticated','public.inpatient_rx_evidence_settings','UPDATE')
    or has_function_privilege('anon',
      'public.clinic_record_rx_evidence(uuid,uuid,text,numeric,timestamptz,text,text)','EXECUTE')
    or not has_function_privilege('authenticated',
      'public.clinic_record_rx_evidence(uuid,uuid,text,numeric,timestamptz,text,text)','EXECUTE') then
    raise exception 'inpatient evidence grants differ from the reviewed RPC-only contract';
  end if;
end $$;
-- Simulate a privileged maintenance write: source identity remains locked even
-- when the ordinary client has no direct UPDATE grant on these parent tables.
do $$
declare v_failed boolean:=false;
begin
  begin
    update public.inpatient_records set branch_id='ca200000-0000-4000-8000-000000000002'
      where id=current_setting('test.k07_record_id')::uuid;
  exception when others then
    if sqlerrm not like 'RX_EVIDENCE_LOCKED:%' then raise;end if;
    v_failed:=true;
  end;
  if not v_failed then raise exception 'inpatient stay moved after prescription evidence';end if;
  v_failed:=false;
  begin
    update public.visits set branch_id='ca200000-0000-4000-8000-000000000002'
      where id='ca600000-0000-4000-8000-000000000004';
  exception when others then
    if sqlerrm not like 'RX_EVIDENCE_LOCKED:%' then raise;end if;
    v_failed:=true;
  end;
  if not v_failed then raise exception 'visit moved after prescription evidence';end if;
end $$;
insert into auth.users(id,raw_user_meta_data)
values ('ca100000-0000-4000-8000-000000000009','{}');
update public.profiles set role='STAFF' where id='ca100000-0000-4000-8000-000000000009';
insert into public.user_branches(user_id,branch_id)
values ('ca100000-0000-4000-8000-000000000009','ca200000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"ca100000-0000-4000-8000-000000000009"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ca100000-0000-4000-8000-000000000009',true);
do $$
declare v_record uuid;v_failed boolean:=false;
begin
  -- Keep the exact ID saved by the authorized fixture; do not rely on a row hidden by RLS.
  v_record:=current_setting('test.k07_record_id')::uuid;
  if (select count(*) from public.inpatient_rx_evidence
      where inpatient_record_id=v_record)<>0 then
    raise exception 'cross-branch actor read private evidence';
  end if;
  begin
    perform public.clinic_record_rx_evidence(v_record,
      'ca910000-0000-4000-8000-000000000001','handover',1,null,null,'rx-evidence-other-branch');
  exception when others then v_failed:=sqlerrm like 'ACCESS_DENIED:%';end;
  if not v_failed then raise exception 'cross-branch actor recorded evidence';end if;
end $$;

-- A user assigned to the same branch still needs clinic module access to write.
reset role;
insert into auth.users(id,raw_user_meta_data)
values ('ca100000-0000-4000-8000-000000000010','{}');
update public.profiles set role='FINANCE' where id='ca100000-0000-4000-8000-000000000010';
insert into public.user_branches(user_id,branch_id)
values ('ca100000-0000-4000-8000-000000000010','ca200000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"ca100000-0000-4000-8000-000000000010"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ca100000-0000-4000-8000-000000000010',true);
do $$
declare v_failed boolean:=false;
begin
  begin
    perform public.clinic_record_rx_evidence(current_setting('test.k07_record_id')::uuid,
      'ca910000-0000-4000-8000-000000000001','handover',1,null,null,
      'rx-evidence-finance-module');
  exception when others then v_failed:=sqlerrm like 'ACCESS_DENIED:%';end;
  if not v_failed then raise exception 'finance actor without clinic module recorded evidence';end if;
end $$;
