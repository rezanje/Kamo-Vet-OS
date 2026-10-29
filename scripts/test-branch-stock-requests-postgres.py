#!/usr/bin/env python3
"""Isolated PostgreSQL 16 request regressions; never reads a database URL.

Requires the local Docker daemon and an already available postgres:16 image.
All data is fictional, networking is disabled, and the container is removed.
"""
from pathlib import Path
import os
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
# Single source of the exact hosted auth.uid() (fingerprinted by migration 20261101120000).
HOSTED_AUTH_UID = (ROOT / 'supabase/tests/fixtures/hosted_auth_uid.sql').read_text()
CONTAINER = 'vetos-branch-request-test-' + uuid.uuid4().hex[:8]
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
ENV = os.environ.copy()
for selector in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'):
    ENV.pop(selector, None)


def docker(*args, **kwargs):
    return subprocess.run([*DOCKER, *args], env=ENV, text=True, **kwargs)


def sql(source, check=True):
    result = docker('exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', input=source, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result


def actor(branch):
    return ("set role authenticated; select set_config('request.jwt.claims',"
            "'{\"role\":\"authenticated\",\"sub\":\"f1100000-0000-4000-8000-00000000000" + branch + "\"}',false);"
            "select set_config('request.headers','{\"x-kamo-operational-branch\":\"f1200000-0000-4000-8000-00000000000" + branch + "\"}',false);")


def create(key, branch='1'):
    return ("select create_cashier_stock_request_atomic('" + key + "','f1200000-0000-4000-8000-00000000000" + branch + "',"
            "'f1300000-0000-4000-8000-000000000002','normal','concurrent regression',"
            "'[{\"item_id\":\"f1400000-0000-4000-8000-000000000001\",\"qty_diminta\":2,\"satuan\":\"box\"}]');")


def concurrent(first_key, second_key, second_branch='1'):
    args = [*DOCKER, 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1']
    first = subprocess.Popen(args, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(actor('1') + 'begin;' + create(first_key) + "/* branch-request-race */ select pg_sleep(1.5);commit;")
    first.stdin.close()
    second = None
    try:
        for _ in range(100):
            if sql("select count(*) from pg_stat_activity where wait_event='PgSleep' and query like '%branch-request-race%';").stdout.strip() == '1':
                break
            time.sleep(.02)
        else:
            raise RuntimeError('First request did not acquire its locks')
        second = subprocess.Popen(args, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        second.stdin.write(actor(second_branch) + create(second_key, second_branch))
        second.stdin.close()
        blocked = False
        for _ in range(100):
            if int(sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%create_cashier_stock_request_atomic%';").stdout.strip()) > 0:
                blocked = True
                break
            time.sleep(.02)
        first.wait(timeout=15); second.wait(timeout=15)
        if first.returncode or second.returncode:
            raise RuntimeError(first.stderr.read() + second.stderr.read())
        if not blocked:
            raise RuntimeError('Concurrent request did not wait for the posting lock')
        ids = []
        for process in (first, second):
            ids.append([line for line in process.stdout.read().splitlines() if re.fullmatch('[0-9a-f-]{36}', line)][-1])
        return ids
    finally:
        for process in (first, second):
            if process is not None and process.poll() is None:
                process.kill(); process.wait()


try:
    docker('run', '--pull=never', '-d', '--network', 'none', '--name', CONTAINER,
           '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16', check=True, capture_output=True)
    for _ in range(100):
        logs = docker('logs', CONTAINER, capture_output=True)
        if 'PostgreSQL init process complete' in logs.stdout and docker('exec', CONTAINER, 'pg_isready', '-U', 'postgres', capture_output=True).returncode == 0:
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
            sql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Fictional cash','ASET','D'),('1102','Fictional bank','ASET','D') on conflict do nothing;")
        try:
            sql('begin;\n' + migration.read_text() + '\ncommit;')
        except RuntimeError as error:
            raise RuntimeError(migration.name + ': ' + str(error)) from error
    print(f'Applied {len(migrations)} migrations to isolated PostgreSQL 16 with auth/storage shims.', flush=True)
    suite = (ROOT / 'supabase/tests/branch_stock_requests.sql').read_text()
    sql(suite)
    print('Branch isolation, DC creation, global numbering, rollback, validation and retry regressions passed.', flush=True)

    # Commit only the fictional fixture so independent sessions can see it.
    sql(suite[:suite.index('set local role authenticated;')] + '\ncommit;')
    same_key = 'f1800000-0000-4000-8000-000000000001'
    first_id, retry_id = concurrent(same_key, same_key)
    assert first_id == retry_id, 'Concurrent identical retries returned different documents'
    assert sql("select count(*) from stock_requests where request_key='" + same_key + "';").stdout.strip() == '1'
    assert sql("select count(*) from stock_request_items where request_id='" + first_id + "';").stdout.strip() == '1'
    print('Concurrent identical submissions: one document and one detail set, original ID returned.', flush=True)

    first_key, second_key = 'f1800000-0000-4000-8000-000000000002', 'f1800000-0000-4000-8000-000000000003'
    first_id, second_id = concurrent(first_key, second_key, '2')
    assert first_id != second_id
    assert sql("select count(distinct no_request) from stock_requests where request_key in ('" + first_key + "','" + second_key + "');").stdout.strip() == '2'
    assert sql("select count(distinct from_branch_id) from stock_requests where request_key in ('" + first_key + "','" + second_key + "');").stdout.strip() == '2'
    print('Concurrent requests from isolated branches: both commit with distinct global numbers.', flush=True)
finally:
    docker('rm', '-f', CONTAINER, capture_output=True)
