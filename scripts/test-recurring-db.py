#!/usr/bin/env python3
"""Disposable fictional PostgreSQL checks; no Supabase credentials or remote DB."""
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
        raise RuntimeError('Fictional local PostgreSQL not ready')

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
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth,public to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,service_role;
"""
    for name in ['0001_core', '0002_rls', '0015_keuangan', '0055_tutup_buku',
                 '0059_recurring_journals', '0060_user_admin', '0101_akses_grup',
                 '0106_audit_keuangan', '0113_coa_header_detail']:
        bootstrap += '\n' + (root / f'supabase/migrations/{name}.sql').read_text()
    bootstrap += '\ngrant all on all tables in schema public to authenticated,service_role;'
    if '--baseline' not in sys.argv:
        bootstrap += '\n' + (root / 'supabase/migrations/20261004110000_atomic_recurring_journals.sql').read_text()
        bootstrap += '\n' + (root / 'supabase/migrations/20261005051500_recurring_occurrence_limit.sql').read_text()
    sql(bootstrap)
    sql((root / 'supabase/tests/atomic_recurring_journals.sql').read_text())
    print('PASS: recurring transaction, rollback, WIB date, legacy identity and authenticated access', flush=True)
    sql((root / 'supabase/tests/recurring_occurrence_limit.sql').read_text())
    print('PASS: finite/unlimited recurring limits, successful-only counting, rollback, recovery and ambiguity', flush=True)

    sql("""
insert into auth.users(id)values('f1000000-0000-4000-8000-000000000001');
update profiles set role='OWNER' where id='f1000000-0000-4000-8000-000000000001';
insert into coa_accounts(code,name,type,normal_balance)values('FIC-D','Fiction debit','BEBAN','D'),('FIC-K','Fiction credit','ASET','K');
insert into recurring_journals(id,nama,day_of_month,max_occurrences,last_posted,lines)values
 ('f7000000-0000-4000-8000-000000000001','Fiction race',1,2,
 to_char((statement_timestamp() at time zone 'Asia/Jakarta')-interval '1 month','YYYY-MM'),
 '[{"code":"FIC-D","debit":100,"credit":0},{"code":"FIC-K","debit":0,"credit":100}]');
insert into journal_entries(no_jurnal,tanggal,source,source_ref)
select 'JRN-FIC-RACE-PRIOR',date_trunc('month',statement_timestamp() at time zone 'Asia/Jakarta')::date-interval '1 month',
'recurring',id::text||':'||last_posted from recurring_journals;
insert into journal_lines(entry_id,account_id,debit,credit)select e.id,a.id,
case a.code when 'FIC-D' then 100 else 0 end,case a.code when 'FIC-K' then 100 else 0 end
from journal_entries e cross join coa_accounts a;
""")
    request = """
begin; set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select entry_id||'|'||posted from public.post_recurring_journal_period(
 'f7000000-0000-4000-8000-000000000001',to_char(statement_timestamp() at time zone 'Asia/Jakarta','YYYY-MM'));
select pg_sleep(2); commit;
"""
    jobs = [subprocess.Popen([*command, 'exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
                            env=environment, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            for _ in range(2)]
    for job in jobs:
        job.stdin.write(request)
        job.stdin.close()
    blocked = False
    for _ in range(20):
        if sql("select count(*)from pg_stat_activity where cardinality(pg_blocking_pids(pid))>0 and query like '%post_recurring_journal_period%';") != '0':
            blocked = True
            break
        time.sleep(.05)
    rows = []
    for job in jobs:
        job.wait(timeout=20)
        output, error = job.stdout.read(), job.stderr.read()
        if job.returncode:
            raise RuntimeError(error)
        rows.extend(line for line in output.splitlines() if '|true' in line or '|false' in line)
    if len(rows) != 2 or len({line.split('|')[0] for line in rows}) != 1 or sorted(line.split('|')[1] for line in rows) != ['false','true']:
        raise RuntimeError('Concurrent retries must return the same journal with one new posting: ' + repr(rows))
    if not blocked:
        raise RuntimeError('Race did not observe a waiting second session; cannot claim concurrent serialization')
    counts = sql("select count(distinct e.id)||'|'||count(l.id)from journal_entries e join journal_lines l on l.entry_id=e.id where e.tanggal=date_trunc('month',statement_timestamp() at time zone 'Asia/Jakarta')::date;")
    if counts != '1|2':
        raise RuntimeError('Concurrent replay left unexpected journal counts: ' + counts)
    if sql("select recurring_completed_occurrences('f7000000-0000-4000-8000-000000000001');") != '2':
        raise RuntimeError('Concurrent retries consumed an incorrect number of occurrences')
    print('PASS: two independent sessions return one journal, one pair of lines and one effective progress update', flush=True)

    sql("""
insert into auth.users(id)values('f1000000-0000-4000-8000-000000000002');
update profiles set role='FINANCE'where id='f1000000-0000-4000-8000-000000000002';
insert into recurring_journals(id,nama,day_of_month,lines)values
 ('f7300000-0000-4000-8000-000000000001','Fiction disable during wait',1,'[{"code":"FIC-D","debit":100,"credit":0},{"code":"FIC-K","debit":0,"credit":100}]'),
 ('f7300000-0000-4000-8000-000000000002','Fiction module revoke during wait',1,'[{"code":"FIC-D","debit":100,"credit":0},{"code":"FIC-K","debit":0,"credit":100}]');
""")
    for index, expected_code in [(1, 'RECURRING_AUTH:'), (2, 'RECURRING_MODULE:')]:
        schedule_id = f'f7300000-0000-4000-8000-00000000000{index}'
        caller_id = f'f1000000-0000-4000-8000-00000000000{index}'
        def session(source):
            job = subprocess.Popen([*command, 'exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
                                   env=environment, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            job.stdin.write(source)
            job.stdin.close()
            return job
        locker = session(f"begin;select id from recurring_journals where id='{schedule_id}'for update;select pg_sleep(2)/*{schedule_id}*/;commit;")
        for _ in range(30):
            if sql(f"select count(*)from pg_stat_activity where wait_event='PgSleep'and query like '%{schedule_id}%';") != '0':
                break
            time.sleep(.05)
        else:
            if locker.poll() is not None:
                raise RuntimeError('Schedule locker exited early: ' + locker.stderr.read() + locker.stdout.read())
            raise RuntimeError('Could not establish held recurring schedule lock: ' + sql("select state||'|'||coalesce(wait_event,'')||'|'||query from pg_stat_activity where application_name='psql';"))
        caller = session(f"begin;set local role authenticated;select set_config('request.jwt.claim.sub','{caller_id}',true);"
                         f"select *from post_recurring_journal_period('{schedule_id}',to_char(statement_timestamp()at time zone 'Asia/Jakarta','YYYY-MM'));commit;")
        for _ in range(20):
            if sql("select count(*)from pg_stat_activity where cardinality(pg_blocking_pids(pid))>0 and query like '%post_recurring_journal_period%';") != '0':
                break
            time.sleep(.05)
        else:
            raise RuntimeError('Could not observe waiting request before permission revocation')
        if index == 1:
            sql(f"update profiles set is_active=false where id='{caller_id}';")
        else:
            sql("insert into role_modules(role,module_id)values('FINANCE','laporan');")
        locker.wait(timeout=20)
        if locker.returncode:
            raise RuntimeError(locker.stderr.read())
        caller.wait(timeout=20)
        if caller.returncode == 0 or expected_code not in caller.stderr.read():
            raise RuntimeError('Waiting request ignored permission revocation: ' + expected_code)
        unchanged = sql(f"select (last_posted is null)::text||'|'||(select count(*)from journal_entries where source_ref like '{schedule_id}:%')"
                        f"from recurring_journals where id='{schedule_id}';")
        if unchanged != 'true|0':
            raise RuntimeError('Revoked request created a journal or advanced its progress')
    print('PASS: profile disable and module revocation committed during lock wait reject posting without a header or progress update', flush=True)
finally:
    docker('rm', '-f', container, capture_output=True)
