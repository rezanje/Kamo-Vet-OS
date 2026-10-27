#!/usr/bin/env python3
"""C05 campaign codes + Q01 new-customer quest: disposable Postgres verification.

Never accepts a database URL or touches real data. Requires Docker and postgres:16, or run it through
docs/evidence/2026-10-28-c05-q01/run-native-pg.py (Homebrew PostgreSQL, no Docker).
Steps: apply every repository migration in order, re-apply the two new migrations (idempotency),
run the new SQL suites, the touched-area regressions, and two concurrency races on separate sessions.
"""
from pathlib import Path
import subprocess
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'vetos-c05-q01-test-' + uuid.uuid4().hex[:8]
NEW = ['20261028180000_q01_new_customer_quest.sql', '20261028181000_c05_campaign_codes.sql']
SUITES = ['c05_campaign_codes.sql', 'q01_new_customer_quest.sql']
REGRESSIONS = ['clinic_invoice_post.sql', 'clinic_billing_lifecycle.sql', 'clinic_demo_financial_policy.sql',
               'quest_config_write_guard.sql', 'pos_payment_method_corrections.sql',
               'clinic_manual_invoice_units.sql', 'clinic_procedure_bmhp.sql']


def sql(source, check=True, tuples=False):
    args = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
    if tuples:
        args += ['-At']
    result = subprocess.run(args, input=source, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result


SEED = """
insert into auth.users (id) values ('cc000000-0000-4000-8000-000000000001'), ('cc000000-0000-4000-8000-000000000002');
update public.profiles set role = 'STAFF', is_active = true where id::text like 'cc000000-%';
insert into public.branches (id, code, name, type) values ('cc100000-0000-4000-8000-000000000001', 'RACE', 'Race', 'PETSHOP');
insert into public.cashier_shifts (id, branch_id, opened_by, shift_type, status) values
 ('cc200000-0000-4000-8000-000000000001', 'cc100000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'petshop', 'open'),
 ('cc200000-0000-4000-8000-000000000002', 'cc100000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000002', 'petshop', 'open');
insert into public.vouchers (id, code, tipe, nilai) values ('cc300000-0000-4000-8000-000000000001', 'RACEV', 'nominal', 1000);
insert into public.campaign_codes (code, voucher_id, max_uses) values ('RACE1', 'cc300000-0000-4000-8000-000000000001', 1);
insert into public.customers (id, name, phone) values ('cc400000-0000-4000-8000-000000000001', 'Race customer', '081299990001');
"""


def race(statements, hold_first=1.0):
    """Session 1 runs its statement and holds its transaction open; session 2 starts meanwhile."""
    results = [None, None]

    def run(i, body):
        prefix = '' if i == 0 else 'select pg_sleep(0.3);\n'
        hold = f'select pg_sleep({hold_first});\n' if i == 0 else ''
        results[i] = sql(f'begin;\n{prefix}{body}\n{hold}commit;', check=False)

    threads = [threading.Thread(target=run, args=(i, s)) for i, s in enumerate(statements)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def sale(no, cashier, shift, extra_cols='', extra_vals=''):
    return (f"insert into public.sales (branch_id, customer_id, no_struk, subtotal, total, bayar, cashier_id, shift_id{extra_cols}) "
            f"values ('cc100000-0000-4000-8000-000000000001', 'cc400000-0000-4000-8000-000000000001', '{no}', 5000, 5000, 5000, "
            f"'{cashier}', '{shift}'{extra_vals});")


try:
    subprocess.run(['docker', 'run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=fictional-c05-q01-test', 'postgres:16'],
                   check=True, capture_output=True)
    for _ in range(100):
        logs = subprocess.run(['docker', 'logs', CONTAINER], text=True, capture_output=True)
        if 'PostgreSQL init process complete' in logs.stdout and subprocess.run(
                ['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'postgres'], capture_output=True).returncode == 0:
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
        try:
            sql('begin;\n' + migration.read_text() + '\ncommit;')
        except RuntimeError as error:
            raise RuntimeError(migration.name + ': ' + str(error)) from error
    print(f'Applied {len(migrations)} repository migrations to isolated PostgreSQL with auth/storage shims.')
    for name in NEW:
        sql('begin;\n' + (ROOT / 'supabase/migrations' / name).read_text() + '\ncommit;')
    print('Re-applied both new migrations: idempotent.')

    tests = ROOT / 'supabase/tests'
    for name in SUITES + REGRESSIONS:
        sql((tests / name).read_text())
        print(name + ': passed.')

    # Race 1 (C05): cap 1, two cashiers submit the same code at once -> exactly one receipt.
    sql(SEED)
    a = sale('RACE-A', 'cc000000-0000-4000-8000-000000000001', 'cc200000-0000-4000-8000-000000000001', ', campaign_code, voucher_code', ", 'RACE1', 'RACEV'")
    b = sale('RACE-B', 'cc000000-0000-4000-8000-000000000002', 'cc200000-0000-4000-8000-000000000002', ', campaign_code, voucher_code', ", 'RACE1', 'RACEV'")
    first, second = race([a, b])
    used = sql("select count(*) from public.sales where campaign_code = 'RACE1'", tuples=True).stdout.strip()
    if first.returncode or not second.returncode or 'batas pemakaian' not in second.stderr or used != '1':
        raise RuntimeError(f'C05 race failed: used={used} first={first.stderr} second={second.stderr}')
    print('C05 concurrency: two simultaneous checkouts at cap 1 -> 1 accepted, 1 refused.')

    # Race 2 (Q01): the same new customer paid at two counters at once -> exactly one claim.
    sql(sale('RACE-Q1', 'cc000000-0000-4000-8000-000000000001', 'cc200000-0000-4000-8000-000000000001')
        + sale('RACE-Q2', 'cc000000-0000-4000-8000-000000000002', 'cc200000-0000-4000-8000-000000000002'))
    fin = "update public.sales set payments_finalized_at = clock_timestamp() where no_struk = '{}';"
    first, second = race([fin.format('RACE-Q1'), fin.format('RACE-Q2')])
    claims = sql("select count(*) from public.quest_new_customer_claims where customer_id = 'cc400000-0000-4000-8000-000000000001'",
                 tuples=True).stdout.strip()
    if first.returncode or second.returncode or claims != '1':
        raise RuntimeError(f'Q01 race failed: claims={claims} {first.stderr} {second.stderr}')
    print('Q01 concurrency: one new customer paid at two counters simultaneously -> 1 claim.')
finally:
    subprocess.run(['docker', 'rm', '-f', CONTAINER], capture_output=True)
