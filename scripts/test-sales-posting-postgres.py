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
CONTAINER = 'vetos-sales-test-' + uuid.uuid4().hex[:8]

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
    first.stdin.write(AUTH + 'begin;\n' + call_a + "\n/* sales-race-holder */ select pg_sleep(3);\ncommit;\n")
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
    blocked = sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%sales_create%';", tuples=True).stdout.strip()
    # Poll only to prove the independent second session actually waited on locks.
    for _ in range(100):
        if blocked == '1':
            break
        time.sleep(.02)
        blocked = sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%sales_create%';", tuples=True).stdout.strip()
    if blocked != '1':
        raise RuntimeError('Competing session did not block on the posting lock')
    out_a, err_a = first.stdout.read(), first.stderr.read()
    out_b, err_b = second.stdout.read(), second.stderr.read()
    first.wait(); second.wait()
    if first.returncode:
        raise RuntimeError(err_a)
    records_a = [json.loads(line) for line in out_a.splitlines() if line.startswith('{"document_id"')]
    records_b = [json.loads(line) for line in out_b.splitlines() if line.startswith('{"document_id"')]
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
    suite = (ROOT / 'supabase/tests/sales_safe_posting.sql').read_text()
    sql(suite)
    print('Sales SQL transaction/authorization suite passed.')
    sql((ROOT / 'supabase/tests/sales_opname_access.sql').read_text())
    print('POS opname invoice authorization regression passed.')
    sql((ROOT / 'supabase/tests/sales_group_access.sql').read_text())
    print('Configured group/default sales access regression passed.')
    # Commit fictional fixture setup for independent two-session connections.
    fixture = suite[:suite.index('insert into sales_quotations')]
    sql(fixture + '\ncommit;')
    sql("""update stock set qty=1 where warehouse_id='f3000000-0000-4000-8000-000000000001';
update stock_layers set qty_left=0 where warehouse_id='f3000000-0000-4000-8000-000000000001';
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
('f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001',current_date,1,1,3,'purchase');
delete from sales_order_items where order_id='f6000000-0000-4000-8000-000000000001';
insert into sales_order_items(id,order_id,item_id,nama,satuan,faktor,qty,harga) values
('f7000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','Last pcs','pcs',1,1,10);
insert into sales_orders(id,no_pesanan,branch_id,warehouse_id) values
('f6000000-0000-4000-8000-000000000003','SO.RACE.OTHER','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001');
insert into sales_order_items(id,order_id,item_id,nama,satuan,faktor,qty,harga) values
('f7000000-0000-4000-8000-000000000005','f6000000-0000-4000-8000-000000000003','f5000000-0000-4000-8000-000000000001','Competing pcs','pcs',1,1,10);
""")
    def call(kind, order, key, line, qty):
        return f"select sales_create_{kind}('{order}','{key}',jsonb_build_object('tanggal',current_date),'[{{\"order_item_id\":\"{line}\",\"qty\":{qty}}}]');"
    order = 'f6000000-0000-4000-8000-000000000001'; line = 'f7000000-0000-4000-8000-000000000001'
    race(call('delivery', order, 'last-unit-a', line, 1),call('delivery','f6000000-0000-4000-8000-000000000003','last-unit-b','f7000000-0000-4000-8000-000000000005',1))
    assert sql("select qty from stock where warehouse_id='f3000000-0000-4000-8000-000000000001';",tuples=True).stdout.strip()=='0'
    assert sql("select count(*) from stock_moves where source='sales-delivery';",tuples=True).stdout.strip()=='1'
    print('Two-session competing last-unit shipments: one commit, one stock rejection, one movement, zero stock.')
    delivery_retry = call('delivery',order,'last-unit-a',line,1)
    same_delivery = race(delivery_retry,delivery_retry,same=True)
    assert sql(f"select count(*) from sales_deliveries where id='{same_delivery['document_id']}';",tuples=True).stdout.strip()=='1'
    assert sql("select count(*) from stock_moves where source='sales-delivery';",tuples=True).stdout.strip()=='1'
    print('Two-session identical shipment retry: same document, no second stock movement.')
    race(call('invoice',order,'bill-a',line,.75),call('invoice',order,'bill-b',line,.75))
    print('Two-session invoice remainder race: one commit, one quantity rejection.')
    retry_call = call('invoice',order,'same-retry',line,.25)
    result = race(retry_call,retry_call,same=True)
    assert sql(f"select count(*) from sales_invoices where id='{result['document_id']}';",tuples=True).stdout.strip()=='1'
    assert sql(f"select count(*) from journal_entries where source='sales-invoice' and source_ref='{result['document_no']}';",tuples=True).stdout.strip()=='1'
    assert sql(f"select count(*) from sales_invoice_delivery_allocations a join sales_invoice_items ii on ii.id=a.invoice_item_id where ii.invoice_id='{result['document_id']}';",tuples=True).stdout.strip()=='1'
    print('Two-session identical invoice retry: same document, one invoice, one allocation, one journal.')
finally:
    subprocess.run(['docker','rm','-f',CONTAINER], capture_output=True)
