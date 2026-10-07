#!/usr/bin/env python3
"""Disposable Postgres verification; never accepts a database URL or uses real data.
Requires Docker and the postgres:16 image. Auth/storage are test-only shims.
"""
from pathlib import Path
import json
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'vetos-purchase-payment-test-' + uuid.uuid4().hex[:8]

def sql(source, check=True, tuples=False):
    args = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
    if tuples:
        args += ['-At']
    result = subprocess.run(args, input=source, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result

AUTH = """set role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',false);
"""

def race(call_a, call_b, same=False):
    args = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1']
    first = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(AUTH + 'begin;\n' + call_a + "\n/* sales-race-holder */ select pg_sleep(10);\ncommit;\n")
    first.stdin.close()
    for _ in range(100):
        active = sql("select count(*) from pg_stat_activity where wait_event='PgSleep' and query like '%sales-race-holder%';", tuples=True).stdout.strip()
        if active == '1':
            break
        time.sleep(.05)
    else:
        raise RuntimeError('First session did not reach the transaction barrier: ' + first.stderr.read())
    second = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    second.stdin.write(AUTH + call_b)
    second.stdin.close()
    blocked = sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and (query like '%post_unit_return%' or query like '%pay_purchase_invoice_atomic%');", tuples=True).stdout.strip()
    # Poll only to prove the independent second session actually waited on locks.
    for _ in range(100):
        if int(blocked or 0) >= 1:
            break
        time.sleep(.02)
        blocked = sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and (query like '%post_unit_return%' or query like '%pay_purchase_invoice_atomic%');", tuples=True).stdout.strip()
    if int(blocked or 0) < 1:
        raise RuntimeError('Competing session did not block on the posting lock: '+second.stderr.read())
    out_a, err_a = first.stdout.read(), first.stderr.read()
    out_b, err_b = second.stdout.read(), second.stderr.read()
    first.wait(); second.wait()
    if first.returncode:
        raise RuntimeError(err_a)
    records_a = [json.loads(line) for line in out_a.splitlines() if line.startswith('{')]
    records_b = [json.loads(line) for line in out_b.splitlines() if line.startswith('{')]
    if same:
        assert second.returncode == 0, err_b
        assert records_a == records_b and len(records_a) == 1, (out_a, out_b)
    else:
        assert second.returncode != 0 and ('melebihi sisa' in err_b or 'tidak cukup' in err_b), err_b
    return records_a[0]

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
    suite=(ROOT / 'supabase/tests/online_return_unit_posting.sql').read_text()
    # Reuse only fictional table fixtures; unrelated sales/online checks belong to their own runner.
    fixtures=suite.split('do $$ declare r jsonb; retry jsonb; header')[0]
    sql(fixtures + "select post_unit_return('purchase','f6000000-0000-4000-8000-000000000010','payment-fixture-return',jsonb_build_object('tanggal',current_date),'[{\"item_id\":\"f5000000-0000-4000-8000-000000000001\",\"source_line_id\":\"f7000000-0000-4000-8000-000000000010\",\"qty\":0.5,\"satuan\":\"box\"}]');reset role;commit;")
    print('Fictional PO fixtures and initial 60-unit-debt purchase return committed.')
    sql((ROOT/'supabase/tests/purchase_payment_atomic.sql').read_text())
    print('Payment exact recovery, changed payload, return-adjusted ceiling, direct bypass and journal rollback passed.')
    sql("insert into purchase_invoices(id,no_faktur,po_id,tanggal,jatuh_tempo,total) values('fa000000-0000-4000-8000-000000000001','FB.PAYMENT.RACE','f6000000-0000-4000-8000-000000000010',current_date,current_date,220);")
    payment="select pay_purchase_invoice_atomic('pay-race','fa000000-0000-4000-8000-000000000001',current_date,150,'Transfer',null,null,null);"
    return_call="select post_unit_return('purchase','f6000000-0000-4000-8000-000000000010','return-after-pay',jsonb_build_object('tanggal',current_date),'[{\"item_id\":\"f5000000-0000-4000-8000-000000000001\",\"source_line_id\":\"f7000000-0000-4000-8000-000000000011\",\"qty\":1,\"satuan\":\"pcs\"}]');"
    race(payment,return_call)
    assert sql("select sum(amount) from purchase_invoice_payments where invoice_id='fa000000-0000-4000-8000-000000000001';",tuples=True).stdout.strip()=='150'
    print('Two independent sessions: payment commits first; blocked return rechecks current debt and rejects.')
    sql("delete from purchase_invoice_payments where invoice_id='fa000000-0000-4000-8000-000000000001';delete from purchase_payment_requests;delete from journal_entries where source='purchase-pay';")
    # The payment waiter now must see the newly committed return too.
    race(return_call,payment.replace('pay-race','pay-after-return'))
    assert sql("select count(*) from purchase_invoice_payments where invoice_id='fa000000-0000-4000-8000-000000000001';",tuples=True).stdout.strip()=='0'
    print('Two independent sessions: return commits first; blocked payment rechecks ceiling and rejects.')
finally:
    subprocess.run(['docker','rm','-f',CONTAINER], capture_output=True)
