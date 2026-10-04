#!/usr/bin/env python3
"""Real local PostgreSQL profile/RLS checks; no remote database or credentials."""
from pathlib import Path
import os
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[1]
environment = {k: v for k, v in os.environ.items() if k not in
               ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']}
command = ['docker', '--host=unix:///var/run/docker.sock']

def docker(*args, **kwargs):
    return subprocess.run([*command, *args], env=environment, text=True, **kwargs)

container = docker('run', '--rm', '-d', '--network', 'none', '-e',
                   'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16', capture_output=True, check=True).stdout.strip()
try:
    for _ in range(100):
        if docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', capture_output=True).returncode == 0:
            break
        time.sleep(.1)
    else:
        raise RuntimeError('Local fictional PostgreSQL not ready')

    def sql(source):
        result = docker('exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-v',
                        'ON_ERROR_STOP=1', input=source, capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stdout[-4000:] + result.stderr)
        return result.stdout.strip()

    bootstrap = """
create role authenticated; create role anon; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid()returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth,public to authenticated,anon,service_role;
grant execute on function auth.uid()to authenticated,service_role;
"""
    for name in ['0001_core', '0002_rls', '0004_perf_security_fixes', '0060_user_admin']:
        bootstrap += '\n' + (root / f'supabase/migrations/{name}.sql').read_text()
    # Apply the exact existing profile guard without its unrelated clinic/catalog
    # dependencies. This is a curated profile stack, not a full Supabase reset.
    catalog = (root / 'supabase/migrations/20260924140000_official_compound_catalog.sql').read_text()
    section = catalog[catalog.index('create function public.prevent_self_role_change()'):catalog.index('-- The historic clinical RLS')]
    bootstrap += '\n' + section
    bootstrap += '\ngrant all on all tables in schema public to authenticated,service_role;'
    if '--baseline' not in sys.argv:
        bootstrap += '\n' + (root / 'supabase/migrations/20261004160000_profile_account_admin_guard.sql').read_text()
    sql(bootstrap)
    sql((root / 'supabase/tests/profile_account_admin_guard.sql').read_text())
    print('PASS: disabled sessions, active personal/admin edits, self-role guard and trusted maintenance', flush=True)

    sql("""
insert into auth.users(id)values('f8200000-0000-4000-8000-000000000005'),('f8200000-0000-4000-8000-000000000007');
update profiles set role='ADMIN'where id='f8200000-0000-4000-8000-000000000005';
update profiles set full_name='Fiction unchanged target'where id='f8200000-0000-4000-8000-000000000007';
""")

    def session(source):
        job = subprocess.Popen([*command, 'exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
                               env=environment, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        job.stdin.write(source)
        job.stdin.close()
        return job

    def observe(condition):
        for _ in range(50):
            if sql('select count(*)from pg_stat_activity where ' + condition + ';') != '0':
                return
            time.sleep(.05)
        raise RuntimeError('Expected real-session lock observation missing: ' + condition)

    actor = 'f8200000-0000-4000-8000-000000000005'
    target = 'f8200000-0000-4000-8000-000000000007'
    for mutation, expected in [('is_active=false', 'PROFILE_ACCOUNT_AUTH:'), ("role='STAFF'", 'PROFILE_ACCOUNT_ADMIN:')]:
        sql(f"update profiles set role='ADMIN',is_active=true where id='{actor}';")
        revoker = session(f"begin;update profiles set {mutation} where id='{actor}';select pg_sleep(3)/*{actor}*/;commit;")
        observe(f"wait_event='PgSleep'and query like '%{actor}%'")
        caller = session(f"begin;set local role authenticated;select set_config('request.jwt.claim.sub','{actor}',true);"
                         f"update profiles set full_name='Fiction forbidden waiting edit'where id='{target}';commit;")
        observe(f"cardinality(pg_blocking_pids(pid))>0 and query like '%{target}%'")
        revoker.wait(timeout=20)
        if revoker.returncode:
            raise RuntimeError(revoker.stderr.read())
        caller.wait(timeout=20)
        if caller.returncode == 0 or expected not in caller.stderr.read():
            raise RuntimeError('Waiting request ignored account revocation: ' + expected)
        if sql(f"select full_name from profiles where id='{target}';") != 'Fiction unchanged target':
            raise RuntimeError('Denied waiting administrator changed target')
    print('PASS: account disable and admin-role revocation committed during a lock wait reject edits', flush=True)

    # Conversely, an authorization already granted is held until commit, so a
    # revocation cannot commit between the guard check and the protected update.
    sql(f"update profiles set role='ADMIN',is_active=true where id='{actor}';")
    caller = session(f"begin;set local role authenticated;select set_config('request.jwt.claim.sub','{actor}',true);"
                     f"update profiles set full_name='Fiction authorized edit'where id='{target}';select pg_sleep(3)/*{target}*/;commit;")
    observe(f"wait_event='PgSleep'and query like '%{target}%'")
    revoker = session(f"update profiles set is_active=false where id='{actor}';")
    observe(f"cardinality(pg_blocking_pids(pid))>0 and query like '%{actor}%'")
    for job in [caller, revoker]:
        job.wait(timeout=20)
        if job.returncode:
            raise RuntimeError(job.stderr.read())
    if sql(f"select full_name from profiles where id='{target}';") != 'Fiction authorized edit':
        raise RuntimeError('Authorized edit did not commit before revocation')
    if sql(f"select is_active from profiles where id='{actor}';") != 'f':
        raise RuntimeError('Serialized account revocation did not commit')
    print('PASS: granted administration lock prevents revocation from committing before the protected edit', flush=True)
finally:
    docker('rm', '-f', container, capture_output=True)
