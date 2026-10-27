-- K01 addenda + K13 cross-branch history. Isolated database only.
-- Branch A and B; doctor B is attached to branch B only. Two patients share the
-- name "Milo" but have different ids. Milo-1 visited A (paid) and B (current).
begin;

insert into auth.users(id, raw_user_meta_data) values
  ('d1300000-0000-4000-8000-000000000001', '{"full_name":"Dokter A"}'),
  ('d1300000-0000-4000-8000-000000000002', '{"full_name":"Dokter B"}'),
  ('d1300000-0000-4000-8000-000000000003', '{"full_name":"Kasir tanpa klinik"}'),
  ('d1300000-0000-4000-8000-000000000004', '{"full_name":"Dokter nonaktif"}');
update public.profiles set role = 'DOCTOR', full_name = 'Dokter A' where id = 'd1300000-0000-4000-8000-000000000001';
update public.profiles set role = 'DOCTOR', full_name = 'Dokter B' where id = 'd1300000-0000-4000-8000-000000000002';
update public.profiles set role = 'FINANCE' where id = 'd1300000-0000-4000-8000-000000000003';
update public.profiles set role = 'DOCTOR', is_active = false where id = 'd1300000-0000-4000-8000-000000000004';
delete from public.role_modules where role = 'FINANCE';
insert into public.role_modules(role, module_id) values ('FINANCE', 'keuangan');

insert into public.branches(id, code, name, type) values
  ('d1310000-0000-4000-8000-00000000000a', 'K13-A', 'Klinik Cabang A', 'KLINIK'),
  ('d1310000-0000-4000-8000-00000000000b', 'K13-B', 'Klinik Cabang B', 'KLINIK');
insert into public.user_branches(user_id, branch_id) values
  ('d1300000-0000-4000-8000-000000000001', 'd1310000-0000-4000-8000-00000000000a'),
  ('d1300000-0000-4000-8000-000000000002', 'd1310000-0000-4000-8000-00000000000b'),
  ('d1300000-0000-4000-8000-000000000003', 'd1310000-0000-4000-8000-00000000000b'),
  ('d1300000-0000-4000-8000-000000000004', 'd1310000-0000-4000-8000-00000000000b');

insert into public.customers(id, name, phone) values
  ('d1320000-0000-4000-8000-000000000001', 'Pemilik Satu', '081300000001'),
  ('d1320000-0000-4000-8000-000000000002', 'Pemilik Dua', '081300000002');
insert into public.pets(id, customer_id, name) values
  ('d1330000-0000-4000-8000-000000000001', 'd1320000-0000-4000-8000-000000000001', 'Milo'),
  ('d1330000-0000-4000-8000-000000000002', 'd1320000-0000-4000-8000-000000000002', 'Milo');

insert into public.visits(id, branch_id, customer_id, pet_id, status, poli, dokter, keluhan, created_at) values
  -- Milo-1 at A, finished and paid.
  ('d1340000-0000-4000-8000-0000000000a1', 'd1310000-0000-4000-8000-00000000000a', 'd1320000-0000-4000-8000-000000000001',
   'd1330000-0000-4000-8000-000000000001', 'Selesai', 'Poli Umum', 'Dokter A', 'Muntah', now() - interval '10 days'),
  -- Milo-1 at B, current visit.
  ('d1340000-0000-4000-8000-0000000000b1', 'd1310000-0000-4000-8000-00000000000b', 'd1320000-0000-4000-8000-000000000001',
   'd1330000-0000-4000-8000-000000000001', 'Diperiksa', 'Poli Umum', 'Dokter B', 'Kontrol', now()),
  -- Milo-2 (same name, different patient) at A.
  ('d1340000-0000-4000-8000-0000000000a2', 'd1310000-0000-4000-8000-00000000000a', 'd1320000-0000-4000-8000-000000000002',
   'd1330000-0000-4000-8000-000000000002', 'Selesai', 'Poli Umum', 'Dokter A', 'Rahasia pasien lain', now() - interval '5 days'),
  -- Milo-2 at B, used to prove the anchor binds the patient.
  ('d1340000-0000-4000-8000-0000000000b2', 'd1310000-0000-4000-8000-00000000000b', 'd1320000-0000-4000-8000-000000000002',
   'd1330000-0000-4000-8000-000000000002', 'Diperiksa', 'Poli Umum', 'Dokter B', 'Kontrol', now());

insert into public.medical_records(id, visit_id, diagnosis, anamnesis, therapy, created_at) values
  ('d1350000-0000-4000-8000-0000000000a1', 'd1340000-0000-4000-8000-0000000000a1', 'Gastritis', 'Muntah 2 hari', 'Antiemetik', now() - interval '10 days'),
  ('d1350000-0000-4000-8000-0000000000a2', 'd1340000-0000-4000-8000-0000000000a2', 'Diagnosa pasien lain', 'x', 'y', now() - interval '5 days');
insert into public.prescription_items(id, medical_record_id, nama_obat, qty, aturan_pakai) values
  ('d1360000-0000-4000-8000-0000000000a1', 'd1350000-0000-4000-8000-0000000000a1', 'Obat A', 2, '2x1');
insert into public.invoices(id, visit_id, total, paid_status, paid_at) values
  ('d1370000-0000-4000-8000-0000000000a1', 'd1340000-0000-4000-8000-0000000000a1', 50000, 'Lunas', now() - interval '10 days');

create temp table k13_before as
  select (select to_jsonb(m) from public.medical_records m where m.id = 'd1350000-0000-4000-8000-0000000000a1') as rec,
         (select to_jsonb(i) from public.invoices i where i.id = 'd1370000-0000-4000-8000-0000000000a1') as inv,
         (select count(*) from public.prescription_items) as rx;
grant select on k13_before to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

-- ===== K01: doctor A adds an addendum to the paid record at A =====
select set_config('request.jwt.claim.sub', 'd1300000-0000-4000-8000-000000000001', true);
do $$
declare first_id uuid; retry_id uuid; failed boolean;
begin
  if not public.clinic_can_add_record_addendum('d1350000-0000-4000-8000-0000000000a1') then
    raise exception 'paid record should accept an addendum';
  end if;
  first_id := public.clinic_add_record_addendum('d1340000-0000-4000-8000-0000000000a1', 'd1350000-0000-4000-8000-0000000000a1',
    'Gastritis akut (adendum)', null, 'Hasil lab menyusul', 'k01-first');
  retry_id := public.clinic_add_record_addendum('d1340000-0000-4000-8000-0000000000a1', 'd1350000-0000-4000-8000-0000000000a1',
    ' Gastritis akut (adendum) ', '', 'Hasil lab menyusul', 'k01-first');
  if first_id is distinct from retry_id then raise exception 'retry duplicated addendum'; end if;
  failed := false;
  begin
    perform public.clinic_add_record_addendum('d1340000-0000-4000-8000-0000000000a1', 'd1350000-0000-4000-8000-0000000000a1',
      'Berbeda', null, null, 'k01-first');
  exception when others then failed := sqlerrm like 'Kunci adendum telah dipakai%'; end;
  if not failed then raise exception 'changed content reused request key'; end if;
  failed := false;
  begin
    perform public.clinic_add_record_addendum('d1340000-0000-4000-8000-0000000000a1', 'd1350000-0000-4000-8000-0000000000a1',
      '  ', null, null, 'k01-empty');
  exception when others then failed := true; end;
  if not failed then raise exception 'empty addendum accepted'; end if;
  -- Forged direct insert gets server-filled evidence.
  insert into public.clinic_record_addenda(medical_record_id, visit_id, invoice_id, invoice_paid_status, original_record,
    therapy_addendum, request_key, created_by)
  values ('d1350000-0000-4000-8000-0000000000a1', 'd1340000-0000-4000-8000-0000000000b1', 'd1370000-0000-4000-8000-0000000000a1',
    'Palsu', '{}', 'Terapi tambahan', 'k01-direct', 'd1300000-0000-4000-8000-000000000001');
  if exists (select 1 from public.clinic_record_addenda where request_key = 'k01-direct'
      and (visit_id <> 'd1340000-0000-4000-8000-0000000000a1' or invoice_paid_status <> 'Lunas' or original_record = '{}'::jsonb)) then
    raise exception 'forged addendum evidence persisted';
  end if;
  failed := false;
  begin update public.clinic_record_addenda set therapy_addendum = 'ubah' where id = first_id;
  exception when sqlstate '42501' then failed := true; end;
  if not failed then raise exception 'addendum update allowed'; end if;
  -- Unpaid/no-invoice record is not addendum territory (it uses Edit instead).
  if public.clinic_can_add_record_addendum('d1350000-0000-4000-8000-0000000000a2') then
    raise exception 'record without posted invoice must use Edit, not addendum';
  end if;
end $$;

-- Source record, invoice and prescriptions are untouched.
do $$
begin
  if (select to_jsonb(m) from public.medical_records m where m.id = 'd1350000-0000-4000-8000-0000000000a1') is distinct from (select rec from k13_before)
    or (select to_jsonb(i) from public.invoices i where i.id = 'd1370000-0000-4000-8000-0000000000a1') is distinct from (select inv from k13_before)
    or (select count(*) from public.prescription_items) is distinct from (select rx from k13_before) then
    raise exception 'addendum changed clinical/billing source';
  end if;
end $$;

-- ===== K13: doctor B (branch B only) reads Milo-1 history from anchor visit B1 =====
select set_config('request.jwt.claim.sub', 'd1300000-0000-4000-8000-000000000002', true);
do $$
declare h jsonb; failed boolean;
begin
  -- Ordinary RLS still hides branch A.
  if exists (select 1 from public.visits where id = 'd1340000-0000-4000-8000-0000000000a1') then
    raise exception 'branch RLS changed: doctor B sees branch A visit directly';
  end if;
  if exists (select 1 from public.medical_records where id = 'd1350000-0000-4000-8000-0000000000a1') then
    raise exception 'branch RLS changed: doctor B sees branch A record directly';
  end if;
  if exists (select 1 from public.invoices where visit_id = 'd1340000-0000-4000-8000-0000000000a1') then
    raise exception 'doctor B can read branch A invoice';
  end if;
  if public.clinic_can_add_record_addendum('d1350000-0000-4000-8000-0000000000a1') then
    raise exception 'doctor B may write addendum across branches';
  end if;

  h := public.clinic_patient_clinical_history('d1330000-0000-4000-8000-000000000001', 'd1340000-0000-4000-8000-0000000000b1');
  if jsonb_array_length(h->'visits') <> 2 then raise exception 'expected 2 visits for Milo-1, got %', h->'visits'; end if;
  if exists (select 1 from jsonb_array_elements(h->'visits') e where (e->>'pet_id')::uuid <> 'd1330000-0000-4000-8000-000000000001') then
    raise exception 'other patient leaked into history';
  end if;
  if h::text like '%Rahasia pasien lain%' or h::text like '%Diagnosa pasien lain%' then
    raise exception 'same-name patient leaked into history';
  end if;
  if (h->'visits'->1->>'branch_name') <> 'Klinik Cabang A' or (h->'visits'->1->'records'->0->>'diagnosis') <> 'Gastritis'
    or (h->'visits'->1->'records'->0->'prescriptions'->0->>'nama_obat') <> 'Obat A'
    or (h->'visits'->1->>'can_open')::boolean
    or not (h->'visits'->0->>'can_open')::boolean then
    raise exception 'branch A visit projection wrong: %', h;
  end if;
  if jsonb_array_length(h->'visits'->1->'records'->0->'addenda') <> 2
    or (h->'visits'->1->'records'->0->'addenda'->0->>'author') <> 'Dokter A' then
    raise exception 'addenda missing from history: %', h->'visits'->1->'records'->0->'addenda';
  end if;
  if h::text like '%d1370000-0000-4000-8000-0000000000a1%' or h::text like '%081300000001%' or h::text like '%paid_status%' or h::text like '%"total"%' then
    raise exception 'billing or contact data leaked into history';
  end if;

  -- Anchor must be the same patient: pass Milo-2 id with Milo-1 anchor.
  failed := false;
  begin perform public.clinic_patient_clinical_history('d1330000-0000-4000-8000-000000000002', 'd1340000-0000-4000-8000-0000000000b1');
  exception when sqlstate '42501' then failed := true; end;
  if not failed then raise exception 'mismatched patient/anchor accepted'; end if;
  -- Anchor in a branch the caller cannot access.
  failed := false;
  begin perform public.clinic_patient_clinical_history('d1330000-0000-4000-8000-000000000001', 'd1340000-0000-4000-8000-0000000000a1');
  exception when sqlstate '42501' then failed := true; end;
  if not failed then raise exception 'foreign-branch anchor accepted'; end if;
  -- Milo-2 via its own B anchor gets only Milo-2.
  h := public.clinic_patient_clinical_history('d1330000-0000-4000-8000-000000000002', 'd1340000-0000-4000-8000-0000000000b2');
  if jsonb_array_length(h->'visits') <> 2 or h::text like '%Gastritis%' then raise exception 'Milo-2 history wrong: %', h; end if;
end $$;

-- Operational branch header narrows the anchor check like every other read.
select set_config('request.headers', '{"x-kamo-operational-branch":"d1310000-0000-4000-8000-00000000000a"}', true);
do $$
declare failed boolean := false;
begin
  begin perform public.clinic_patient_clinical_history('d1330000-0000-4000-8000-000000000001', 'd1340000-0000-4000-8000-0000000000b1');
  exception when sqlstate '42501' then failed := true; end;
  if not failed then raise exception 'anchor outside operational branch accepted'; end if;
end $$;
select set_config('request.headers', '', true);

-- No clinic module (FINANCE with keuangan only) and inactive profile are denied.
select set_config('request.jwt.claim.sub', 'd1300000-0000-4000-8000-000000000003', true);
do $$
declare failed boolean := false;
begin
  begin perform public.clinic_patient_clinical_history('d1330000-0000-4000-8000-000000000001', 'd1340000-0000-4000-8000-0000000000b1');
  exception when sqlstate '42501' then failed := true; end;
  if not failed then raise exception 'non-clinic role read history'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'd1300000-0000-4000-8000-000000000004', true);
do $$
declare failed boolean := false;
begin
  begin perform public.clinic_patient_clinical_history('d1330000-0000-4000-8000-000000000001', 'd1340000-0000-4000-8000-0000000000b1');
  exception when sqlstate '42501' then failed := true; end;
  if not failed then raise exception 'inactive profile read history'; end if;
end $$;

-- anon has no execute grant.
reset role;
set local role anon;
do $$
declare failed boolean := false;
begin
  begin perform public.clinic_patient_clinical_history('d1330000-0000-4000-8000-000000000001', 'd1340000-0000-4000-8000-0000000000b1');
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'anon executed history'; end if;
end $$;

rollback;
