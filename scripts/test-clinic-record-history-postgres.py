#!/usr/bin/env python3
"""K01 addenda + K13 cross-branch history: throwaway native PostgreSQL (no Docker).

Creates a fresh cluster in a temp dir on a unix socket only, applies every repository
migration in order (same auth/storage shims as scripts/test-procedure-bmhp-postgres.py),
runs the focused tests, then deletes the cluster. Never accepts a database URL.

Usage: LC_ALL=en_US.UTF-8 python3 scripts/test-clinic-record-history-postgres.py [/opt/homebrew/opt/postgresql@16/bin]
"""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(sys.argv[1] if len(sys.argv) > 1 else '/opt/homebrew/opt/postgresql@16/bin')
WORK = Path(tempfile.mkdtemp(prefix='vetos-k13-k01-'))
DATA, SOCK, PORT = WORK / 'data', WORK / 'sock', '54331'
SOCK.mkdir()
for key in [k for k in os.environ if k.startswith('PG')]:
    del os.environ[key]
os.environ.update(PSQLRC='/dev/null', TZ='Etc/UTC', LC_ALL='en_US.UTF-8')


def sql(source):
    result = subprocess.run([BIN / 'psql', '-h', str(SOCK), '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
                            input=source, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result


try:
    subprocess.run([BIN / 'initdb', '-D', DATA, '-U', 'postgres', '-E', 'UTF8', '--locale=en_US.UTF-8', '--auth=trust'], check=True, capture_output=True)
    with open(DATA / 'postgresql.conf', 'a') as conf:
        conf.write(f"\nlisten_addresses = ''\nunix_socket_directories = '{SOCK}'\nport = {PORT}\ntimezone = 'Etc/UTC'\n")
    subprocess.run([BIN / 'pg_ctl', '-D', DATA, '-l', WORK / 'server.log', '-w', 'start'], check=True, capture_output=True)
    print('server:', subprocess.run([BIN / 'postgres', '--version'], capture_output=True, text=True).stdout.strip())
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
        try:
            sql('begin;\n' + migration.read_text() + '\ncommit;')
        except RuntimeError as error:
            raise RuntimeError(migration.name + ': ' + str(error)) from error
    print(f'Applied {len(migrations)} repository migrations.')
    # Idempotency: the two new migrations can be re-applied unchanged.
    for name in ['20261028110000_clinic_record_addenda.sql', '20261028110100_clinic_patient_history_rpc.sql']:
        sql('begin;\n' + (ROOT / 'supabase/migrations' / name).read_text() + '\ncommit;')
    print('Re-applied K01/K13 migrations: idempotent.')
    tests = ROOT / 'supabase/tests'
    for name in ['clinic_record_addenda_history.sql', 'clinic_therapy_note.sql']:
        sql((tests / name).read_text())
        print(name + ': passed.')
    # Owner package rehearsal: readback -> rollback -> preflight -> apply -> readback -> tests again.
    pkg = ROOT / 'docs/evidence/2026-10-28-k13-k01/owner-apply'

    def all_ok(name):
        out = subprocess.run([BIN / 'psql', '-h', str(SOCK), '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-f', str(pkg / name)],
                             text=True, capture_output=True, check=True).stdout.strip().splitlines()
        bad = [line for line in out if line and not line.endswith('|t')]
        if bad:
            raise RuntimeError(f'{name}: failed checks {bad}')
        return len(out)

    print('readback after migrations:', all_ok('readback.sql'), 'checks ok')
    rollback = (pkg / 'rollback.sql').read_text()
    sql("insert into public.clinic_history_reads(pet_id,anchor_visit_id,branch_id,foreign_branch_ids,foreign_visit_count,read_by) "
        "values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'{}',1,gen_random_uuid())")
    try:
        sql(rollback)
        raise AssertionError('rollback ran although audit rows exist')
    except RuntimeError as error:
        if 'ROLLBACK DIBATALKAN' not in str(error):
            raise
    if sql("select 1/(to_regclass('public.clinic_history_reads') is not null)::int").returncode:
        raise RuntimeError('guarded rollback dropped objects')
    print('rollback guard: refused while rows exist, nothing dropped.')
    flag = "-- select set_config('vetos.k13_k01_rollback_discard', 'yes', true);"
    if flag not in rollback:
        raise RuntimeError('rollback flag line missing')
    sql(rollback.replace(flag, flag[3:]))
    print('rollback with explicit owner flag: done.')
    sql("select 1/(to_regclass('public.clinic_record_addenda') is null and to_regclass('public.clinic_history_reads') is null "
        "and to_regprocedure('public.clinic_patient_clinical_history(uuid,uuid)') is null "
        "and not exists(select 1 from public.activity_log_sources where entity='clinic_history_reads'))::int")
    print('preflight after rollback:', all_ok('preflight.sql'), 'checks ok')
    sql((pkg / 'apply.sql').read_text())
    print('readback after apply.sql:', all_ok('readback.sql'), 'checks ok')
    sql((tests / 'clinic_record_addenda_history.sql').read_text())
    print('clinic_record_addenda_history.sql: passed again after owner package apply.')
finally:
    if (DATA / 'postmaster.pid').exists():
        subprocess.run([BIN / 'pg_ctl', '-D', DATA, '-m', 'immediate', 'stop'], capture_output=True)
    shutil.rmtree(WORK, ignore_errors=True)
    print('cleanup: temp cluster removed' if not WORK.exists() else f'cleanup FAILED: {WORK}')
