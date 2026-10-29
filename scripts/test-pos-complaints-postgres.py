#!/usr/bin/env python3
"""Verify POS fixes on disposable PostgreSQL 16; never accepts a database URL.

Requires Docker with a cached postgres:16 image. Auth/storage are test-only
shims, all fixtures are fictional, and no database port is exposed. The local
Docker socket is explicit so inherited remote contexts cannot redirect tests.
"""

from pathlib import Path
import os
import subprocess
import time
import uuid


ROOT = Path(__file__).resolve().parents[1]
# Single source of the exact hosted auth.uid() (fingerprinted by migration 20261101120000).
HOSTED_AUTH_UID = (ROOT / 'supabase/tests/fixtures/hosted_auth_uid.sql').read_text()
CONTAINER = 'vetos-pos-complaints-test-' + uuid.uuid4().hex[:8]
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
DOCKER_ENV = dict(os.environ)
for selector in ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']:
    DOCKER_ENV.pop(selector, None)


def docker(args, **kwargs):
    return subprocess.run(DOCKER + args, env=DOCKER_ENV, text=True, capture_output=True, **kwargs)


def sql(source):
    result = docker(['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=source)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result


def main():
    started = False
    try:
        result = docker(['run', '--pull=never', '-d', '--name', CONTAINER,
                         '--label', 'vetos-purpose=local-pos-acceptance', '--network', 'none',
                         '-e', 'POSTGRES_PASSWORD=fictional-pos-test-only', 'postgres:16'])
        if result.returncode:
            raise RuntimeError(result.stderr)
        started = True
        for _ in range(200):
            logs = docker(['logs', CONTAINER])
            ready = docker(['exec', CONTAINER, 'pg_isready', '-U', 'postgres'])
            if 'PostgreSQL init process complete' in logs.stdout + logs.stderr and ready.returncode == 0:
                break
            time.sleep(.1)
        else:
            raise RuntimeError('Disposable PostgreSQL did not become ready')

        sql("""create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
""" + HOSTED_AUTH_UID + """
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
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
        print(f'Applied {len(migrations)} repository migrations to isolated PostgreSQL 16 with auth/storage shims and pre-0068 COA fixtures.', flush=True)
        for name in ['branch_stock_requests.sql', 'expense-workflow.sql', 'stock_transfer_request_atomic.sql']:
            try:
                sql((ROOT / 'supabase/tests' / name).read_text())
            except RuntimeError as error:
                raise RuntimeError(name + ': ' + str(error)) from error
            print(name + ': passed (fictional fixtures rolled back).', flush=True)
    finally:
        if started:
            result = docker(['rm', '-f', '-v', CONTAINER])
            if result.returncode:
                raise RuntimeError('Unable to remove disposable container: ' + result.stderr)
            print('Removed disposable PostgreSQL container and volumes.', flush=True)


if __name__ == '__main__':
    main()
