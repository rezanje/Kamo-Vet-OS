#!/usr/bin/env python3
"""Disposable Postgres verification; never accepts a database URL or uses real data.
Requires Docker and the postgres:16 image. Auth/storage are test-only shims.
"""
from pathlib import Path
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'vetos-employee-context-test-' + uuid.uuid4().hex[:8]

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
create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
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
        if migration.name.endswith('_employee_account_operational_context.sql'):
            duplicate = sql("""begin;
insert into auth.users(id) values ('ed100000-0000-4000-8000-000000000001');
insert into employees(nama,profile_id) values ('Fictional duplicate one','ed100000-0000-4000-8000-000000000001'),('Fictional duplicate two','ed100000-0000-4000-8000-000000000001');
""" + migration.read_text(), check=False)
            if duplicate.returncode == 0 or 'HRIS_LINK_DUPLICATES' not in duplicate.stderr:
                raise RuntimeError('Duplicate-link rollout did not fail safely')
            print('Duplicate-link migration preflight: fails safely without committing changes.')
        try:
            sql('begin;\n' + migration.read_text() + '\ncommit;')
        except RuntimeError as error:
            raise RuntimeError(migration.name + ': ' + str(error)) from error
    print(f'Applied {len(migrations)} repository migrations to isolated PostgreSQL 16 with auth/storage shims and pre-0068 COA fixtures.')
    if sys.argv[1:] == ['--sales-return-only']:
        return_migration = next(path for path in migrations if path.name.endswith('_sales_return_branch_isolation.sql'))
        drift_cases = [
            ('alter table public.sales disable row level security;', 'RETURN_RLS_DISABLED'),
            ('alter policy operational_branch_isolation on public.sales using (true) with check (true);', 'SALES_BRANCH_POLICY_CHANGED'),
            ('alter table public.sales_returns disable row level security;', 'RETURN_RLS_DISABLED'),
            ('alter table public.sales_return_items disable row level security;', 'RETURN_RLS_DISABLED'),
            ('alter policy sr2_all on public.sales_returns using (false) with check (false);', 'RETURN_POLICY_BASELINE_CHANGED'),
            ('alter policy sri2_all on public.sales_return_items using (false) with check (false);', 'RETURN_POLICY_BASELINE_CHANGED'),
        ]
        for change, expected in drift_cases:
            failed = sql('begin;\n' + change + '\n' + return_migration.read_text(), check=False)
            if failed.returncode == 0 or expected not in failed.stderr:
                raise RuntimeError(f'Return isolation failed to reject policy drift {change}: {failed.stderr}')
        print('Six disabled or drifted RLS/policy baselines rejected atomically.')
    tests = ['sales_return_branch_isolation.sql'] if sys.argv[1:] == ['--sales-return-only'] else ['employee_account_operational_context.sql', 'inpatient_consent.sql', 'clinic_demo_financial_policy.sql', 'clinic_invoice_post.sql', 'clinic_billing_lifecycle.sql', 'clinical_occupation_selection.sql', 'compound_catalog_sku_binding.sql', 'clinic_inpatient_action_category.sql']
    for name in tests:
        sql((ROOT / 'supabase/tests' / name).read_text())
        print(name + ': passed.')

finally:
    subprocess.run(['docker', 'rm', '-f', CONTAINER], capture_output=True)
