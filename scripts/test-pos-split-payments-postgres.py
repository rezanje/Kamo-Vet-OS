#!/usr/bin/env python3
"""Verify POS split payments on disposable PostgreSQL 16; never accepts a database URL.

Requires Docker with a cached postgres:16 image. Auth/storage are test-only
shims, all fixtures are fictional, and no database port is exposed. The local
Docker socket is explicit so inherited remote contexts cannot redirect tests.
"""

from pathlib import Path
from decimal import Decimal
import os
import subprocess
import time
import uuid


ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'vetos-pos-split-payments-test-' + uuid.uuid4().hex[:8]
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
DOCKER_ENV = dict(os.environ)
for selector in ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']:
    DOCKER_ENV.pop(selector, None)


def docker(args, **kwargs):
    return subprocess.run(DOCKER + args, env=DOCKER_ENV, text=True, capture_output=True, **kwargs)


def sql(source, tuples=False):
    args = ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
    if tuples:
        args.append('-At')
    result = docker(args, input=source)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result


AUTH = """set role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"role":"authenticated"}',false);
"""
SALE = 'e7700000-0000-4000-8000-000000000001'
LINE = 'e7700000-0000-4000-8000-000000000011'


def start_sql(source):
    process = subprocess.Popen(DOCKER + ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                               env=DOCKER_ENV, text=True, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    process.stdin.write(AUTH + source)
    process.stdin.close()
    return process


def finish_sql(process, succeeds=True):
    process.wait(timeout=20)
    output, error = process.stdout.read(), process.stderr.read()
    if (process.returncode == 0) != succeeds:
        raise RuntimeError(f'Unexpected race result ({process.returncode}): {output}\n{error}')
    return error


def wait_activity(predicate, count=1):
    for _ in range(160):
        if sql('select count(*) from pg_stat_activity where ' + predicate, tuples=True).stdout.strip() == str(count):
            return
        time.sleep(.025)
    raise RuntimeError('Concurrent SQL did not reach expected barrier: ' + predicate)


def sale_insert(doc, ref, key):
    return f"""insert into sales(id,branch_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
values('{doc}','e2200000-0000-4000-8000-000000000001','{ref}',100000,100000,'Split',100000,'e1100000-0000-4000-8000-000000000001','e4400000-0000-4000-8000-000000000001','[{{"method":"Tunai","amount":20000}},{{"method":"Transfer","amount":80000}}]','{key}',repeat('a',64));"""


def line_insert(doc, line):
    return f"""insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp)
values('{line}','{doc}','e5500000-0000-4000-8000-000000000001','Concurrent source',2,50000,'pcs',1,0);"""


def race_regressions():
    # Commit fictional fixtures for independent sessions, after ordinary suites
    # have rolled back. Every test still lives only in this disposable container.
    suite = (ROOT / 'supabase/tests/pos_split_payments.sql').read_text()
    sql(suite[:suite.index('set local role authenticated;')] + '\ncommit;')
    sql(AUTH + sale_insert(SALE, 'RACE.FINALIZE', 'race-finalize') + line_insert(SALE, LINE))
    holder = start_sql(f"begin; select finalize_pos_sale('{SALE}'); /* split-finalize-holder */ select pg_sleep(3); commit;")
    wait_activity("wait_event='PgSleep' and query like '%split-finalize-holder%'")
    late_line = start_sql(f"/* split-late-child */ insert into sale_items(sale_id,nama,qty,harga,faktor,hpp) values('{SALE}','Too late',1,1,1,0);")
    late_group = start_sql(f"""/* split-late-child */ insert into sale_item_group_components(sale_item_id,component_item_id,component_name,item_type,qty_per_group,unit,factor,total_base_qty,hpp)
values('{LINE}','e5500000-0000-4000-8000-000000000002','Too late component','Persediaan',1,'pcs',1,1,0);""")
    wait_activity("wait_event_type='Lock' and query like '%split-late-child%'", count=2)
    stale_close = start_sql("""/* split-stale-close */ update cashier_shifts set status='closed',expected_cash=0,
closing_breakdown='{"Tunai":0,"Transfer":0,"Debit":0,"Kredit":0,"QRIS":0,"E-Wallet":0}'
where id='e4400000-0000-4000-8000-000000000001';""")
    wait_activity("wait_event_type='Lock' and query like '%split-stale-close%'")
    finish_sql(holder)
    error = finish_sql(stale_close, succeeds=False)
    assert 'Pembayaran shift berubah' in error, error
    assert sql("select status from cashier_shifts where id='e4400000-0000-4000-8000-000000000001'", tuples=True).stdout.strip() == 'open'
    for process in [late_line, late_group]:
        error = finish_sql(process, succeeds=False)
        assert 'Snapshot rincian penjualan' in error, error
    assert sql(f"select count(*) from sale_items where sale_id='{SALE}'", tuples=True).stdout.strip() == '1'
    print('Concurrent late line/group inserts wait for finalization and then reject.', flush=True)
    print('Concurrent finalization rejects a stale shift close snapshot before closing.', flush=True)

    winner = 'e7700000-0000-4000-8000-000000000002'
    loser = 'e7700000-0000-4000-8000-000000000003'
    holder = start_sql('begin; ' + sale_insert(winner, 'RACE.KEY.A', 'race-same-intent') + ' /* split-key-holder */ select pg_sleep(3); commit;')
    wait_activity("wait_event='PgSleep' and query like '%split-key-holder%'")
    competitor = start_sql('/* split-duplicate-intent */ ' + sale_insert(loser, 'RACE.KEY.B', 'race-same-intent'))
    wait_activity("wait_event_type='Lock' and query like '%split-duplicate-intent%'")
    finish_sql(holder)
    error = finish_sql(competitor, succeeds=False)
    assert 'sales_checkout_actor_key' in error, error
    assert sql("select count(*) from sales where checkout_key='race-same-intent'", tuples=True).stdout.strip() == '1'
    sql(AUTH + line_insert(winner, 'e7700000-0000-4000-8000-000000000012') + f"select finalize_pos_sale('{winner}'); select finalize_pos_sale('{winner}');")
    assert sql("select count(*) from journal_entries where source='sale' and source_ref='RACE.KEY.A'", tuples=True).stdout.strip() == '1'
    print('Concurrent identical checkout keys create one sale and one revenue journal.', flush=True)

    def refund(key):
        return f"""select post_unit_return('sales','{SALE}','{key}',jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'dari','kasir'),jsonb_build_array(jsonb_build_object('source_line_id','{LINE}','item_id','e5500000-0000-4000-8000-000000000001','qty',2,'satuan','pcs','kondisi','baik')));"""
    holder = start_sql('begin; ' + refund('race-return-a') + ' /* split-refund-holder */ select pg_sleep(3); commit;')
    wait_activity("wait_event='PgSleep' and query like '%split-refund-holder%'")
    competitor = start_sql('/* split-refund-competitor */ ' + refund('race-return-b'))
    wait_activity("wait_event_type='Lock' and query like '%split-refund-competitor%'")
    finish_sql(holder)
    error = finish_sql(competitor, succeeds=False)
    assert 'Qty melebihi sisa' in error, error
    assert Decimal(sql(f"select sum(total) from sales_returns where sale_id='{SALE}'", tuples=True).stdout.strip()) == Decimal('100000')
    assert Decimal(sql(f"select sum(r.amount) from sale_payment_refunds r join sale_payments p on p.id=r.sale_payment_id where p.sale_id='{SALE}'", tuples=True).stdout.strip()) == Decimal('100000')
    print('Concurrent full refunds serialize and cannot exceed original payment caps.', flush=True)


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
        print(f'Applied {len(migrations)} repository migrations to isolated PostgreSQL 16 with auth/storage shims and pre-0068 COA fixtures.', flush=True)
        for name in ['pos_split_payments.sql', 'online_return_unit_posting.sql', 'expense-workflow.sql']:
            try:
                sql((ROOT / 'supabase/tests' / name).read_text())
            except RuntimeError as error:
                raise RuntimeError(name + ': ' + str(error)) from error
            print(name + ': passed (fictional fixtures rolled back).', flush=True)
        race_regressions()
    finally:
        if started:
            result = docker(['rm', '-f', '-v', CONTAINER])
            if result.returncode:
                raise RuntimeError('Unable to remove disposable container: ' + result.stderr)
            print('Removed disposable PostgreSQL container and volumes.', flush=True)


if __name__ == '__main__':
    main()
