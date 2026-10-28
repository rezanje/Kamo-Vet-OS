-- K08: re-discharge must bill every inpatient period of a visit exactly once.
-- Isolated local database only; every fictional row is rolled back.
--
-- Billing model this test pins (see docs/evidence/2026-10-29-k08-rebill/verification.md):
--  * One active invoice per visit; a discharge is refused while that invoice exists, so at
--    discharge time no inpatient day of the visit is billed anywhere yet.
--  * Therefore the automatic "Rawat Inap" line of a visit must cover every discharged stay
--    (period) of that visit: each stay rounded up per started 24 hours, summed, one line.
--  * A stay that is reopened and discharged again is one period from its admission to the
--    final discharge (unchanged behaviour). A K06 continuation visit bills its own stays.
-- Time cannot pass inside one transaction, so earlier periods are moved back in time with
-- direct fixture updates (as the database owner) between the real RPC calls.
begin;

insert into auth.users(id,raw_user_meta_data) values ('e8100000-0000-4000-8000-000000000001','{}');
update public.profiles set role='OWNER' where id='e8100000-0000-4000-8000-000000000001';
insert into public.branches(id,code,name,type) values ('e8200000-0000-4000-8000-000000000001','K08-REBILL','DEMO K08 branch','KLINIK');
insert into public.user_branches(user_id,branch_id) values ('e8100000-0000-4000-8000-000000000001','e8200000-0000-4000-8000-000000000001');
insert into public.employees(id,nama,jabatan,branch_id,status) values
 ('e8300000-0000-4000-8000-000000000001','DEMO Doctor','Dokter','e8200000-0000-4000-8000-000000000001','Aktif');
insert into public.customers(id,name,phone) values ('e8400000-0000-4000-8000-000000000001','DEMO Owner','080012340808');
-- One patient per scenario: one live stay per patient is enforced.
insert into public.pets(id,customer_id,name) values
 ('e8500000-0000-4000-8000-000000000001','e8400000-0000-4000-8000-000000000001','DEMO Readmitted'),
 ('e8500000-0000-4000-8000-000000000002','e8400000-0000-4000-8000-000000000001','DEMO Reopened'),
 ('e8500000-0000-4000-8000-000000000003','e8400000-0000-4000-8000-000000000001','DEMO Tariff change'),
 ('e8500000-0000-4000-8000-000000000004','e8400000-0000-4000-8000-000000000001','DEMO Invoiced');
insert into public.visits(id,branch_id,customer_id,pet_id,doctor_id,dokter,keluhan,status,service_started_at)
select ('e8600000-0000-4000-8000-00000000000'||n)::uuid,'e8200000-0000-4000-8000-000000000001',
  'e8400000-0000-4000-8000-000000000001',('e8500000-0000-4000-8000-00000000000'||n)::uuid,
  'e8300000-0000-4000-8000-000000000001','DEMO Doctor','DEMO inpatient','Pembayaran',now()
from generate_series(1,4) n;
insert into public.medical_records(id,visit_id,diagnosis)
select ('e8700000-0000-4000-8000-00000000000'||n)::uuid,('e8600000-0000-4000-8000-00000000000'||n)::uuid,'DEMO diagnosis'
from generate_series(1,4) n;
insert into public.consent_templates(id,nama,isi,branch_id,kategori) values
 ('e8800000-0000-4000-8000-000000000001','DEMO Rawat Inap','DEMO inpatient terms',null,'Rawat Inap');
update public.consent_rules set template_id=null,wajib=true where kategori='Rawat Inap';
insert into public.consents(id,visit_id,template_id,tindakan,isi_snapshot)
select ('e8900000-0000-4000-8000-00000000000'||n)::uuid,('e8600000-0000-4000-8000-00000000000'||n)::uuid,
  'e8800000-0000-4000-8000-000000000001','DEMO inpatient','DEMO inpatient terms'
from generate_series(1,4) n;
update public.consents set status='sudah_ttd',signer_name='DEMO Owner',signature_data='data:image/png;base64,demo',signed_at=now()-interval '10 days'
where id::text like 'e8900000-%';
insert into public.items(id,code,name,unit,item_type,is_active,tindakan_kategori,sell_price) values
 ('e8a00000-0000-4000-8000-000000000001','K08-REBILL-FEE','AAB DEMO Rawat Inap','hari','Jasa',true,'Rawat Inap',100000);

-- Fixture time travel runs as the owner with the actor's claims (care-staff guard);
-- every business step runs as the browser role through the real RPCs.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e8100000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e8100000-0000-4000-8000-000000000001',true);

create function pg_temp.k08_shift(p_stay uuid, p_admitted interval, p_discharged interval) returns void
language sql as $$
  update public.inpatient_records set admitted_at=now()-p_admitted,
    discharged_at=case when p_discharged is null then discharged_at else now()-p_discharged end
  where id=p_stay;
$$;
-- Billing source of a visit: automatic stay-fee lines on any of its medical records.
create function pg_temp.k08_fee(p_visit uuid, out lines integer, out days integer, out amount numeric) language sql as $$
  select count(*)::integer, coalesce(sum(p.qty),0)::integer, coalesce(sum(p.qty*p.harga),0)
  from public.prescription_items p join public.medical_records m on m.id=p.medical_record_id
  where m.visit_id=p_visit and p.kategori='Rawat Inap' and p.jenis='jasa';
$$;
create temp table k08_stay(name text primary key, id uuid);
grant all on k08_stay to authenticated;

-- ===== Scenario 1: discharged, admitted again on the same visit, discharged again =====
set local role authenticated;
insert into k08_stay values ('s1a', public.clinic_admit_inpatient_typed('e8600000-0000-4000-8000-000000000001','DEMO plan','k08-s1a','sakit'));
reset role;
select pg_temp.k08_shift((select id from k08_stay where name='s1a'),'49 hours',null);
set local role authenticated;
do $$ begin
  if not public.clinic_change_inpatient_condition((select id from k08_stay where name='s1a'),'sembuh','DEMO first discharge') then
    raise exception 'K08 setup: first discharge failed'; end if;
  if (select days from pg_temp.k08_fee('e8600000-0000-4000-8000-000000000001'))<>3 then
    raise exception 'K08 setup: first period (49h) must bill 3 days'; end if;
end $$;
reset role;
-- First period: 100h..51h ago (49h = 3 days). The patient comes back 26 hours later.
select pg_temp.k08_shift((select id from k08_stay where name='s1a'),'100 hours','51 hours');
set local role authenticated;
insert into k08_stay values ('s1b', public.clinic_admit_inpatient_typed('e8600000-0000-4000-8000-000000000001','DEMO plan 2','k08-s1b','sakit'));
reset role;
select pg_temp.k08_shift((select id from k08_stay where name='s1b'),'25 hours',null);
set local role authenticated;
select public.clinic_change_inpatient_condition((select id from k08_stay where name='s1b'),'sembuh','DEMO second discharge');
-- @@PREFLIGHT_DEMO_POINT (the owner-package rehearsal commits everything above on the pre-fix
-- definition to prove the read-only preflight lists this under-billed visit)
do $$
declare f record;
begin
  select * into f from pg_temp.k08_fee('e8600000-0000-4000-8000-000000000001');
  -- 3 days (first period) + 2 days (second period, 25h) = 5 days on exactly one line.
  if f.lines<>1 or f.days<>5 or f.amount<>500000 then
    raise exception 'K08 re-discharge billed % line(s) / % day(s) / %; expected 1 line, 5 days (3+2), 500000 - every period exactly once',
      f.lines, f.days, f.amount;
  end if;
end $$;

-- ===== Scenario 2: the same stay reopened and discharged again (regression) =====
insert into k08_stay values ('s2', public.clinic_admit_inpatient_typed('e8600000-0000-4000-8000-000000000002','DEMO plan','k08-s2','sakit'));
reset role;
select pg_temp.k08_shift((select id from k08_stay where name='s2'),'49 hours',null);
set local role authenticated;
do $$ begin
  perform public.clinic_change_inpatient_condition((select id from k08_stay where name='s2'),'sembuh','DEMO discharge');
  perform public.clinic_change_inpatient_condition((select id from k08_stay where name='s2'),'stabil','DEMO extend stay');
  if (select discharged_at from public.inpatient_records where id=(select id from k08_stay where name='s2')) is not null then
    raise exception 'K08 setup: reopened stay must be open again'; end if;
end $$;
reset role;
-- Two more days pass: admission is now 97h ago.
select pg_temp.k08_shift((select id from k08_stay where name='s2'),'97 hours',null);
set local role authenticated;
do $$
declare f record;
begin
  perform public.clinic_change_inpatient_condition((select id from k08_stay where name='s2'),'sembuh','DEMO final discharge');
  select * into f from pg_temp.k08_fee('e8600000-0000-4000-8000-000000000002');
  if f.lines<>1 or f.days<>5 then
    raise exception 'K08 reopened stay billed % line(s) / % day(s); expected 1 line, 5 days (97h)', f.lines, f.days;
  end if;
end $$;

-- ===== Scenario 3: first period already invoiced, stay reopened =====
set local role authenticated;
insert into k08_stay values ('invoiced', public.clinic_admit_inpatient_typed('e8600000-0000-4000-8000-000000000004','DEMO plan','k08-invoiced','sakit'));
reset role;
select pg_temp.k08_shift((select id from k08_stay where name='invoiced'),'49 hours',null);
set local role authenticated;
do $$ begin
  perform public.clinic_change_inpatient_condition((select id from k08_stay where name='invoiced'),'sembuh','DEMO discharge');
end $$;
reset role;
-- The cashier issues the visit invoice with the 3-day stay line (fixture insert as owner).
insert into public.invoices(id,visit_id,invoice_no,subtotal,total,paid_status)
values ('e8b00000-0000-4000-8000-000000000004','e8600000-0000-4000-8000-000000000004','K08-REBILL-INV4',300000,300000,'Belum Lunas');
insert into public.invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id,prescription_item_id)
select 'e8b00000-0000-4000-8000-000000000004',p.nama_obat,p.qty,p.harga,'jasa',p.item_id,p.id
from public.prescription_items p where p.medical_record_id='e8700000-0000-4000-8000-000000000004' and p.kategori='Rawat Inap';
set local role authenticated;
do $$
declare f record; refused boolean := false;
begin
  perform public.clinic_change_inpatient_condition((select id from k08_stay where name='invoiced'),'stabil','DEMO extend after invoice');
  begin
    perform public.clinic_change_inpatient_condition((select id from k08_stay where name='invoiced'),'sembuh','DEMO re-discharge');
  exception when raise_exception then refused := sqlerrm like 'INVOICE_EXISTS:%';
  end;
  select * into f from pg_temp.k08_fee('e8600000-0000-4000-8000-000000000004');
  -- The invoiced period is never billed a second time on the same visit.
  if not refused or f.lines<>1 or f.days<>3
     or (select count(*) from public.invoice_items where invoice_id='e8b00000-0000-4000-8000-000000000004')<>1 then
    raise exception 'K08 invoiced period: refused=% lines=% days=%; expected refused, 1 line, 3 days', refused, f.lines, f.days;
  end if;
end $$;

-- ===== Scenario 4: the stay tariff changes between the two discharges =====
insert into k08_stay values ('tariff', public.clinic_admit_inpatient_typed('e8600000-0000-4000-8000-000000000003','DEMO plan','k08-tariff','sakit'));
reset role;
select pg_temp.k08_shift((select id from k08_stay where name='tariff'),'49 hours',null);
set local role authenticated;
do $$ begin
  perform public.clinic_change_inpatient_condition((select id from k08_stay where name='tariff'),'sembuh','DEMO discharge');
  perform public.clinic_change_inpatient_condition((select id from k08_stay where name='tariff'),'stabil','DEMO extend stay');
end $$;
reset role;
select pg_temp.k08_shift((select id from k08_stay where name='tariff'),'97 hours',null);
-- Admin adds a new stay tariff that now sorts first (the discharge picks the first active one).
insert into public.items(id,code,name,unit,item_type,is_active,tindakan_kategori,sell_price) values
 ('e8a00000-0000-4000-8000-000000000002','K08-REBILL-FEE2','AAA DEMO Rawat Inap baru','hari','Jasa',true,'Rawat Inap',120000);
set local role authenticated;
do $$
declare f record;
begin
  perform public.clinic_change_inpatient_condition((select id from k08_stay where name='tariff'),'sembuh','DEMO final discharge');
  select * into f from pg_temp.k08_fee('e8600000-0000-4000-8000-000000000003');
  -- The earlier automatic line (old tariff) must not stay next to the new one: 5 days, once.
  if f.lines<>1 or f.days<>5 then
    raise exception 'K08 tariff change double-billed: % line(s) / % day(s); expected 1 line, 5 days', f.lines, f.days;
  end if;
end $$;

select 'PASS K08 re-discharge bills every inpatient period of a visit exactly once';
rollback;
