#!/usr/bin/env python3
"""K02 procedure BMHP: disposable Postgres verification; never accepts a database URL or uses real data.
Requires Docker and the postgres:16 image. Auth/storage are test-only shims.
"""
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
# Single source of the exact hosted auth.uid() (fingerprinted by migration 20261101120000).
HOSTED_AUTH_UID = (ROOT / 'supabase/tests/fixtures/hosted_auth_uid.sql').read_text()
CONTAINER = 'vetos-k02-bmhp-test-' + uuid.uuid4().hex[:8]

def sql(source, check=True, tuples=False):
    args = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
    if tuples:
        args += ['-At']
    result = subprocess.run(args, input=source, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result

try:
    subprocess.run(['docker', 'run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=fictional-sales-test', 'postgres:16'], check=True, capture_output=True)
    for _ in range(100):
        logs = subprocess.run(['docker', 'logs', CONTAINER], text=True, capture_output=True)
        if 'PostgreSQL init process complete' in logs.stdout and subprocess.run(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(.1)
    sql("""create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
""" + HOSTED_AUTH_UID + """
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
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
    tests = ROOT / 'supabase/tests'
    for name in ['clinic_procedure_bmhp.sql', 'clinic_invoice_post.sql', 'clinic_billing_lifecycle.sql', 'clinic_compound_issue.sql',
                 'clinic_manual_invoice_units.sql', 'clinic_inpatient_action_category.sql', 'official_compound_catalog.sql', 'compound_catalog_sku_binding.sql']:
        sql((tests / name).read_text())
        print(name + ': passed (FIFO).')
    # Same K02 assertions under moving average: the fixture activates average costing
    # before the authenticated section, then the expected cost is the average, not FIFO.
    source = (tests / 'clinic_procedure_bmhp.sql').read_text()
    marker = "set local role authenticated;\nselect set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);"
    if source.count(marker) < 1:
        raise RuntimeError('K02 average marker missing')
    activate = ((tests / 'fixtures/average_opening_gl.sql').read_text() +
        "\nselect set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);"
        "\nselect set_config('request.jwt.claim.role', 'authenticated', true);"
        "\nselect pg_temp.seed_average_opening_gl();\nselect public.activate_moving_average();\n")
    average = source.replace(marker, activate + marker, 1).replace('is not FIFO BMHP cost', 'is not moving-average BMHP cost').replace(' is distinct from 5500', ' is distinct from 5900')
    sql(average)
    print('clinic_procedure_bmhp.sql: passed (moving average).')
finally:
    subprocess.run(['docker', 'rm', '-f', CONTAINER], capture_output=True)
