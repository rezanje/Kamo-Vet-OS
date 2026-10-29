#!/usr/bin/env python3
"""K08 rawat inap: re-discharge billing + paid/unfinished review script, throwaway native PostgreSQL.

Applies every repository migration with the shared fictional auth/storage bootstrap (no Docker,
no DB URL, nothing touches a real database), then:
  1. supabase/tests/clinic_inpatient_discharge.sql (single period, re-discharge with the first period
     not invoiced / already invoiced, reopen guards) plus the inpatient regression suites;
  2. scripts/review-k08-paid-unfinished-visits.sql on committed fictional rows: preview changes nothing,
     a wrong expected count aborts, the guarded repair finishes only the safe visit and leaves every
     invoice, payment and journal row byte-identical.

Usage: python3 scripts/test-clinic-inpatient-discharge-postgres.py [/usr/lib/postgresql/16/bin]
"""
import importlib.util
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


native = load('native_postgres', ROOT / 'scripts/native_postgres.py')
fixture = load('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
candidates = [a for a in sys.argv[1:]] + ['/usr/lib/postgresql/16/bin', '/opt/homebrew/opt/postgresql@16/bin']
BIN = next(c for c in candidates if (Path(c) / 'initdb').exists())

SUITES = ['clinic_inpatient_discharge.sql', 'inpatient_continuation_pet_hotel.sql', 'clinic_billing_lifecycle.sql',
          'inpatient_consent.sql', 'clinic_inpatient_action_category.sql', 'clinic_invoice_post.sql']

REPAIR_FIXTURE = """
begin;
insert into auth.users(id,raw_user_meta_data) values ('fc000000-0000-4000-8000-000000000001','{}');
update public.profiles set role='OWNER' where id='fc000000-0000-4000-8000-000000000001';
select 1 from set_config('request.jwt.claim.role','authenticated',true);
select 1 from set_config('request.jwt.claim.sub','fc000000-0000-4000-8000-000000000001',true);
insert into public.branches(id,code,name,type) values ('fc100000-0000-4000-8000-000000000001','K08-REPAIR','DEMO K08','KLINIK');
insert into public.user_branches(user_id,branch_id) values ('fc000000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001');
insert into public.employees(id,nama,jabatan,branch_id,status)
 values ('fc900000-0000-4000-8000-000000000001','DEMO Dokter','Dokter','fc100000-0000-4000-8000-000000000001','Aktif');
insert into public.customers(id,name,phone) values ('fc400000-0000-4000-8000-000000000001','DEMO Pemilik','080000000808');
insert into public.pets(id,customer_id,name) values
 ('fc500000-0000-4000-8000-000000000001','fc400000-0000-4000-8000-000000000001','DEMO Aman'),
 ('fc500000-0000-4000-8000-000000000002','fc400000-0000-4000-8000-000000000001','DEMO Inap'),
 ('fc500000-0000-4000-8000-000000000003','fc400000-0000-4000-8000-000000000001','DEMO Selesai');
insert into public.visits(id,branch_id,customer_id,pet_id,doctor_id,dokter,status,service_started_at) values
 ('fc600000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','fc400000-0000-4000-8000-000000000001',
  'fc500000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000001','DEMO Dokter','Pembayaran',now()),
 ('fc600000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000001','fc400000-0000-4000-8000-000000000001',
  'fc500000-0000-4000-8000-000000000002','fc900000-0000-4000-8000-000000000001','DEMO Dokter','Pembayaran',now()),
 ('fc600000-0000-4000-8000-000000000003','fc100000-0000-4000-8000-000000000001','fc400000-0000-4000-8000-000000000001',
  'fc500000-0000-4000-8000-000000000003','fc900000-0000-4000-8000-000000000001','DEMO Dokter','Selesai',now());
insert into public.medical_records(id,visit_id) values ('fc700000-0000-4000-8000-000000000002','fc600000-0000-4000-8000-000000000002');
insert into public.invoices(id,visit_id,invoice_no,subtotal,total,paid_status,paid_at) values
 ('fca00000-0000-4000-8000-000000000001','fc600000-0000-4000-8000-000000000001','K08-REP-1',100000,100000,'Lunas',now()-interval '3 days'),
 ('fca00000-0000-4000-8000-000000000002','fc600000-0000-4000-8000-000000000002','K08-REP-2',100000,100000,'Lunas',now()-interval '2 days'),
 ('fca00000-0000-4000-8000-000000000003','fc600000-0000-4000-8000-000000000003','K08-REP-3',100000,100000,'Lunas',now()-interval '1 day');
insert into public.inpatient_records(id,branch_id,visit_id,medical_record_id) values
 ('fc800000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000001','fc600000-0000-4000-8000-000000000002','fc700000-0000-4000-8000-000000000002');
commit;
"""
MONEY = """select md5(string_agg(t, '|' order by t)) from (
  select 'inv:'||to_jsonb(i)::text t from public.invoices i
  union all select 'item:'||to_jsonb(ii)::text from public.invoice_items ii
  union all select 'pay:'||to_jsonb(p)::text from public.invoice_payments p
  union all select 'je:'||to_jsonb(e)::text from public.journal_entries e
  union all select 'jl:'||to_jsonb(l)::text from public.journal_lines l) s;"""
STATE = """select string_agg(id::text||'='||status::text||'/'||(checked_out_at is not null)::text, ',' order by id)
  from public.visits where branch_id='fc100000-0000-4000-8000-000000000001';"""

with native.NativePostgres(BIN) as database:
    fixture.DisposablePostgres.bootstrap(database)
    failures = []
    for name in SUITES:
        clone = 'k08_' + name.removesuffix('.sql')
        database.sql(f'create database {clone} template postgres;')
        try:
            database.sql(f'\\connect {clone}\n' + (ROOT / 'supabase/tests' / name).read_text())
            print('PASS ' + name, flush=True)
        except RuntimeError as error:
            failures.append(name)
            print('FAIL ' + name + ': ' + str(error), flush=True)
        finally:
            database.sql(f'drop database {clone} with (force);')

    review = (ROOT / 'scripts/review-k08-paid-unfinished-visits.sql').read_text()
    database.sql(REPAIR_FIXTURE)
    money, state = database.last(MONEY), database.last(STATE)
    preview = database.sql(review)
    if 'aman_diperbaiki|1' not in preview or 'perlu_tinjau: rawat inap masih aktif|1' not in preview \
            or database.last(STATE) != state:
        raise RuntimeError('Preview did not classify or changed data:\n' + preview)
    try:
        database.sql('\\set apply 1\n\\set expected 2\n\\set actor fc000000-0000-4000-8000-000000000001\n' + review)
        raise RuntimeError('Repair with a wrong expected count was not refused')
    except RuntimeError as error:
        if 'pratinjau yang ditinjau menyebut 2' not in str(error):
            raise
    if database.last(STATE) != state:
        raise RuntimeError('Refused repair left changes behind')
    database.sql('\\set apply 1\n\\set expected 1\n\\set actor fc000000-0000-4000-8000-000000000001\n' + review)
    after = database.last(STATE)
    expected = ('fc600000-0000-4000-8000-000000000001=Selesai/true,'
                'fc600000-0000-4000-8000-000000000002=Pembayaran/false,'
                'fc600000-0000-4000-8000-000000000003=Selesai/false')
    if after != expected:
        raise RuntimeError('Unexpected visit state after repair: ' + after)
    if database.last(MONEY) != money:
        raise RuntimeError('Repair changed invoices, payments or journals')
    if database.last("select count(*) from public.visit_operational_events where payload->>'source'='k08-paid-unfinished-repair';") != '1':
        raise RuntimeError('Repair did not record exactly one check_out event')
    print('PASS review-k08-paid-unfinished-visits.sql: preview read-only, wrong count refused, '
          'only the safe visit finished, money rows identical', flush=True)
    if failures:
        raise SystemExit('Failed suites: ' + ', '.join(failures))
print('PASS K08 inpatient discharge suites and paid/unfinished review script.', flush=True)
