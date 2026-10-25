#!/usr/bin/env python3
"""Disposable Postgres verification; never accepts a database URL or uses real data.
Requires Docker and the postgres:16 image. Auth/storage are test-only shims.
"""
from pathlib import Path
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'vetos-clinic-demo-test-' + uuid.uuid4().hex[:8]

def sql(source, check=True, tuples=False):
    args = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
    if tuples:
        args += ['-At']
    result = subprocess.run(args, input=source, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result

try:
    subprocess.run(['docker', 'run', '-d', '--name', CONTAINER, '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '-e', 'POSTGRES_PASSWORD=fictional-sales-test', 'postgres:16'], check=True, capture_output=True)
    for _ in range(100):
        logs = subprocess.run(['docker', 'logs', CONTAINER], text=True, capture_output=True)
        if 'PostgreSQL init process complete' in logs.stdout and subprocess.run(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(.1)
    sql("""create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create publication supabase_realtime;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;
""")
    migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    for migration in migrations:
        if migration.name.startswith('0068'):
            sql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Test cash','ASET','D'),('1102','Test bank','ASET','D') on conflict do nothing")
        try:
            sql('begin;\n' + migration.read_text() + '\ncommit;')
        except RuntimeError as error:
            raise RuntimeError(migration.name + ': ' + str(error)) from error
    print(f'Applied {len(migrations)} repository migrations to isolated PostgreSQL 16 with auth/storage shims and pre-0068 COA fixtures.')
    for name in ['inpatient_consent.sql', 'clinic_demo_financial_policy.sql', 'clinic_invoice_post.sql', 'clinic_billing_lifecycle.sql', 'clinical_occupation_selection.sql', 'compound_catalog_sku_binding.sql', 'clinic_inpatient_action_category.sql']:
        sql((ROOT / 'supabase/tests' / name).read_text())
        print(name + ': passed with real FIFO and prescription triggers.')
    # Commit test-only CA fixtures inside this disposable container, then race
    # signing against both visit identity changes and a second conditional sign.
    fixture = (ROOT / 'supabase/tests/inpatient_consent.sql').read_text()
    sql(fixture.rsplit('rollback;', 1)[0] + 'commit;')
    actor = "set local role authenticated;select set_config('request.jwt.claims','{\"role\":\"authenticated\",\"sub\":\"ca100000-0000-4000-8000-000000000001\"}',true);"
    visit = "'ca600000-0000-4000-8000-000000000002'"
    consent = "'ca900000-0000-4000-8000-000000000003'"
    sql("begin;" + actor + "update public.visits set branch_id='ca200000-0000-4000-8000-000000000001' where id=" + visit + ";commit;")
    sign = "update public.consents set status='sudah_ttd',signer_name='DEMO Owner',signature_data='DEMO concurrent',signed_at=now() where id=" + consent + " and status='belum_ttd' returning id;"
    with ThreadPoolExecutor(max_workers=3) as pool:
        first = pool.submit(sql, "begin;" + actor + "set local application_name='clinic-demo-sign-race';" + sign + "select pg_sleep(2);commit;")
        for _ in range(100):
            if sql("select count(*) from pg_stat_activity where application_name='clinic-demo-sign-race' and wait_event='PgSleep'", tuples=True).stdout.strip() == '1':
                break
            if first.done():
                first.result()
                raise RuntimeError('Signing finished before concurrency check')
            time.sleep(.02)
        else:
            raise RuntimeError('Signing did not acquire the visit lock')
        move = pool.submit(sql, "begin;" + actor + "update public.visits set branch_id='ca200000-0000-4000-8000-000000000002' where id=" + visit + ";commit;", False)
        second = pool.submit(sql, "begin;" + actor + sign + "commit;")
        first.result()
        moved = move.result()
        duplicate = second.result()
        if moved.returncode == 0 or 'CONSENT_LOCKED:' not in moved.stderr or 'UPDATE 0' not in duplicate.stdout:
            raise RuntimeError('Concurrent signature/identity mutation was not protected')
    print('Consent signing versus branch move and duplicate signature: passed in concurrent database transactions.')
    sql("""begin;
insert into public.visits(id,branch_id,customer_id,pet_id,doctor_id,dokter,status,service_started_at,service_finished_at)
values ('ca600000-0000-4000-8000-000000000003','ca200000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001','DEMO Doctor','Pembayaran',now(),now());
insert into public.medical_records(visit_id) values ('ca600000-0000-4000-8000-000000000003');
insert into public.consents(visit_id,template_id,tindakan,isi_snapshot,status,signer_name,signature_data,signed_at)
values ('ca600000-0000-4000-8000-000000000003','ca800000-0000-4000-8000-000000000002','DEMO concurrency','DEMO snapshot','sudah_ttd','DEMO Owner','DEMO signature',now());
commit;""")
    admission = "select public.clinic_admit_inpatient('ca600000-0000-4000-8000-000000000003','DEMO concurrent admission','demo-admission-race');"
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(sql, "begin;" + actor + "set local application_name='clinic-demo-admission-race';" + admission + "select pg_sleep(2);commit;")
        for _ in range(100):
            if sql("select count(*) from pg_stat_activity where application_name='clinic-demo-admission-race' and wait_event='PgSleep'", tuples=True).stdout.strip() == '1':
                break
            if first.done():
                first.result()
                raise RuntimeError('Admission finished before concurrency check')
            time.sleep(.02)
        else:
            raise RuntimeError('Admission did not acquire its visit lock')
        second = pool.submit(sql, "begin;" + actor + admission + "commit;")
        first.result(); second.result()
    if sql("select count(*) from public.inpatient_records where visit_id='ca600000-0000-4000-8000-000000000003'", tuples=True).stdout.strip() != '1' or sql("select count(*) from public.inpatient_status_log l join public.inpatient_records r on r.id=l.inpatient_record_id where r.visit_id='ca600000-0000-4000-8000-000000000003'", tuples=True).stdout.strip() != '1':
        raise RuntimeError('Concurrent admission duplicated record or initial status')
    print('Concurrent admission retry: one admission and one initial status history.')

finally:
    subprocess.run(['docker', 'rm', '-f', CONTAINER], capture_output=True)
