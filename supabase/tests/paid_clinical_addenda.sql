begin;
insert into profiles(id, role) values
  ('f0000000-0000-4000-8000-000000000001', 'DOCTOR'),
  ('f0000000-0000-4000-8000-000000000002', 'STAFF');
insert into branches(id) values
  ('f1000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-000000000002');
insert into user_branches values
  ('f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001');
insert into visits(id, pet_id, branch_id, status, service_started_at, service_finished_at, checked_out_at)
values ('f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001', 'Selesai', now(), now(), now());
insert into medical_records(id, visit_id, anamnesis, diagnosis, therapy, submission_key, submission_hash, submitted_by)
values ('f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
  'Catatan sumber', 'Diagnosa sumber', 'Terapi sumber', 'initial-key', 'initial-hash',
  'f0000000-0000-4000-8000-000000000001');
insert into invoices(id, visit_id, paid_status, paid_at)
values ('f7000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
  'Lunas', now());
insert into prescription_items values
  ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'Obat sumber', 2);
insert into compounding_recipes values
  ('f6000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'ready');
insert into stock values ('f9000000-0000-4000-8000-000000000001', 14);
insert into journal_entries values ('fa000000-0000-4000-8000-000000000001', 'invoice');

create temporary table source_snapshot as select
  (select to_jsonb(m) from medical_records m) record,
  (select to_jsonb(i) from invoices i) invoice,
  (select to_jsonb(v) from visits v) visit,
  (select jsonb_agg(to_jsonb(p)) from prescription_items p) prescriptions,
  (select jsonb_agg(to_jsonb(c)) from compounding_recipes c) compounds,
  (select jsonb_agg(to_jsonb(s)) from stock s) stock,
  (select jsonb_agg(to_jsonb(j)) from journal_entries j) journals;
grant select on source_snapshot to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000001', true);
do $$
declare visit_id uuid := 'f2000000-0000-4000-8000-000000000001';
        record_id uuid := 'f4000000-0000-4000-8000-000000000001';
        first_id uuid; replay_id uuid; denied boolean;
begin
  if not public.clinic_can_add_paid_addendum(record_id) then raise exception 'paid source not eligible'; end if;
  first_id := public.clinic_add_paid_record_addendum(visit_id, record_id, 'Catatan klinis tambahan', 'Alasan tambahan', 'paid-key');
  replay_id := public.clinic_add_paid_record_addendum(visit_id, record_id, 'Catatan klinis tambahan', 'Alasan tambahan', 'paid-key');
  if first_id is distinct from replay_id or (select count(*) from public.clinic_paid_record_addenda) <> 1 then
    raise exception 'retry created duplicate addendum';
  end if;
  if exists (select 1 from public.clinic_paid_record_addenda a, source_snapshot s
    where a.id = first_id and (a.original_record is distinct from s.record
      or a.paid_invoice_id <> 'f7000000-0000-4000-8000-000000000001'
      or a.created_by <> auth.uid() or a.invoice_paid_at is null
      or a.reason <> 'Alasan tambahan' or a.amendment <> 'Catatan klinis tambahan')) then
    raise exception 'original, actor, time or payment evidence missing';
  end if;
  denied := false;
  begin perform public.clinic_add_paid_record_addendum(visit_id, record_id, 'Different note', 'Alasan tambahan', 'paid-key');
  exception when others then denied := true; end;
  if not denied then raise exception 'conflicting replay accepted'; end if;
  denied := false;
  begin update public.clinic_paid_record_addenda set amendment = 'Tampered' where id = first_id;
  exception when others then denied := true; end;
  if not denied then raise exception 'addendum mutation accepted'; end if;
  denied := false;
  begin delete from public.clinic_paid_record_addenda where id = first_id;
  exception when others then denied := true; end;
  if not denied then raise exception 'addendum delete accepted'; end if;
  denied := false;
  begin update public.medical_records set diagnosis = 'Tampered' where id = record_id;
  exception when others then denied := true; end;
  if not denied then raise exception 'submitted record mutation accepted'; end if;
end;
$$;
-- A direct insert can target this table, but the trigger must replace forged evidence.
insert into public.clinic_paid_record_addenda
  (medical_record_id, visit_id, paid_invoice_id, invoice_paid_at, original_record,
   amendment, reason, request_key, created_by, created_at)
values
  ('f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
   'f7000000-0000-4000-8000-000000000001', '1900-01-01', '{"forged":true}',
   ' Catatan langsung ', ' Alasan langsung ', 'direct-key',
   'f0000000-0000-4000-8000-000000000002', '1900-01-01');
do $$ begin
  if exists (select 1 from public.clinic_paid_record_addenda a, source_snapshot s
    where a.request_key = 'direct-key' and (a.original_record is distinct from s.record
      or a.original_record ? 'forged' or a.created_by <> auth.uid()
      or a.created_at < '2026-01-01' or a.invoice_paid_at < '2026-01-01'
      or a.amendment <> 'Catatan langsung' or a.reason <> 'Alasan langsung')) then
    raise exception 'direct insert forged audit evidence';
  end if;
end $$;
reset role;

do $$ begin
  if exists (select 1 from source_snapshot s where
    (select to_jsonb(m) from medical_records m) is distinct from s.record or
    (select to_jsonb(i) from invoices i) is distinct from s.invoice or
    (select to_jsonb(v) from visits v) is distinct from s.visit or
    (select jsonb_agg(to_jsonb(p)) from prescription_items p) is distinct from s.prescriptions or
    (select jsonb_agg(to_jsonb(c)) from compounding_recipes c) is distinct from s.compounds or
    (select jsonb_agg(to_jsonb(st)) from stock st) is distinct from s.stock or
    (select jsonb_agg(to_jsonb(j)) from journal_entries j) is distinct from s.journals)
  then raise exception 'financial, stock or source clinical state changed'; end if;
end $$;

update invoices set paid_status = 'Belum Lunas', paid_at = null;
set local role authenticated;
do $$ declare denied boolean := false; begin
  if public.clinic_can_add_paid_addendum('f4000000-0000-4000-8000-000000000001') then raise exception 'unpaid ready'; end if;
  begin perform public.clinic_add_paid_record_addendum('f2000000-0000-4000-8000-000000000001',
    'f4000000-0000-4000-8000-000000000001', 'New unpaid note', 'Unpaid reason', 'unpaid-key');
  exception when others then denied := true; end;
  if not denied then raise exception 'unpaid addendum accepted'; end if;
end $$;
reset role;
update invoices set paid_status = 'Lunas', paid_at = now(), voided_at = now();
set local role authenticated;
do $$ declare denied boolean := false; begin
  if public.clinic_can_add_paid_addendum('f4000000-0000-4000-8000-000000000001') then raise exception 'voided invoice ready'; end if;
  begin perform public.clinic_add_paid_record_addendum('f2000000-0000-4000-8000-000000000001',
    'f4000000-0000-4000-8000-000000000001', 'New voided note', 'Voided reason', 'voided-key');
  exception when others then denied := true; end;
  if not denied then raise exception 'voided addendum accepted'; end if;
end $$;
reset role;
update invoices set voided_at = null;
update visits set branch_id = 'f1000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ begin
  if public.clinic_can_add_paid_addendum('f4000000-0000-4000-8000-000000000001') then
    raise exception 'foreign branch ready'; end if;
end $$;
reset role;
set local role anon;
do $$ declare denied boolean := false; begin
  begin perform public.clinic_add_paid_record_addendum('f2000000-0000-4000-8000-000000000001',
    'f4000000-0000-4000-8000-000000000001', 'Anonymous note', 'Anonymous reason', 'anon-key');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'anonymous addendum accepted'; end if;
end $$;
rollback;
