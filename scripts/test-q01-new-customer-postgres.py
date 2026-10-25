#!/usr/bin/env python3
"""Run new-customer quest checks on fictional rows in disposable PostgreSQL 16."""
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'vetos-new-customer-quest-' + uuid.uuid4().hex[:8]


def sql(source):
    result = subprocess.run(
        ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
        input=source, text=True, capture_output=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr[-3500:])
    return result.stdout


def concurrency_test():
    sql("""insert into public.customers(id,name,phone,created_at) values
('a5500000-0000-4000-8000-000000000006','Concurrent customer','+62 814-9753-2222',
 now());""")

    def launch(sale_id, ref, branch, cashier, shift, paid_minutes, marker, hold=False):
        statements = f"""begin;
select set_config('request.jwt.claims','{{}}',true);
insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,total,bayar,cashier_id,shift_id,created_at)
 select '{sale_id}','{branch}',id,'{ref}',100,100,100,'{cashier}','{shift}',created_at+interval '1 minute'
 from public.customers where id='a5500000-0000-4000-8000-000000000006';
update public.sales set payments_finalized_at=(select created_at+interval '{paid_minutes} minutes'
 from public.customers where id='a5500000-0000-4000-8000-000000000006') where id='{sale_id}' /* {marker} */;
"""
        if hold:
            statements += "select pg_sleep(2) /* q01-holder */;\n"
        statements += 'commit;\n'
        process = subprocess.Popen(
            ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        process.stdin.write(statements)
        process.stdin.close()
        return process

    def active(marker, lock=False):
        expression = "wait_event_type='Lock' and " if lock else "state='active' and "
        query = "select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and " + expression + "query like '%" + marker + "%');"
        result = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
                                input=query, text=True, capture_output=True, check=True)
        return result.stdout.strip() == 't'

    def wait(marker, lock=False):
        for _ in range(100):
            if active(marker, lock):
                return
            time.sleep(.02)
        raise RuntimeError('Concurrency barrier absent: ' + marker)

    first = launch('a6600000-0000-4000-8000-000000000004', 'Q01-RACE-A',
                   'a2200000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001',
                   'a3300000-0000-4000-8000-000000000001', 3, 'q01-first', True)
    wait('q01-holder')
    second = launch('a6600000-0000-4000-8000-000000000005', 'Q01-RACE-B',
                    'a2200000-0000-4000-8000-000000000002', 'a1100000-0000-4000-8000-000000000002',
                    'a3300000-0000-4000-8000-000000000002', 2, 'q01-waiter')
    wait('q01-waiter', True)
    for process in (first, second):
        process.wait(timeout=15)
        output, error = process.stdout.read(), process.stderr.read()
        if process.returncode:
            raise RuntimeError((output + error)[-3500:])
    # Payment commits A then B, even though B has a backdated test timestamp.
    # The delayed B hook runs first; it must not steal A's first-sale claim.
    for sale_id, cashier in (
        ('a6600000-0000-4000-8000-000000000005','a1100000-0000-4000-8000-000000000002'),
        ('a6600000-0000-4000-8000-000000000004','a1100000-0000-4000-8000-000000000001'),
    ):
        sql(f"""begin;set local role authenticated;
select set_config('request.jwt.claims','{{"role":"authenticated","sub":"{cashier}"}}',true);
select public.apply_sale_staff_effects('{sale_id}');commit;""")
    count = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
                           input="""select count(*) from public.sale_staff_effects e,
 jsonb_array_elements(e.after_value->'progress') progress
 where e.sale_id in('a6600000-0000-4000-8000-000000000004'::uuid,
  'a6600000-0000-4000-8000-000000000005'::uuid)
 and progress->>'quest_definition_id'='a4400000-0000-4000-8000-000000000001';""",
                           text=True, capture_output=True, check=True).stdout.strip()
    if count != '1':
        raise RuntimeError('Concurrent same-phone branches awarded more than one customer: ' + count)
    winner = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
                            input="""select exists(select 1 from public.sale_staff_effects e,
 jsonb_array_elements(e.after_value->'progress') progress
 where e.sale_id='a6600000-0000-4000-8000-000000000004'
  and progress->>'quest_definition_id'='a4400000-0000-4000-8000-000000000001')
 and not exists(select 1 from public.sale_staff_effects e,
 jsonb_array_elements(e.after_value->'progress') progress
 where e.sale_id='a6600000-0000-4000-8000-000000000005'
  and progress->>'quest_definition_id'='a4400000-0000-4000-8000-000000000001')
 and exists(select 1 from public.sale_staff_effects e
 join public.staff_points_ledger l on l.id=any(e.ledger_ids)
 where e.sale_id='a6600000-0000-4000-8000-000000000004'
  and l.source_id='a4400000-0000-4000-8000-000000000001'
  and l.staff_id='a1100000-0000-4000-8000-000000000001'
  and l.branch_id='a2200000-0000-4000-8000-000000000001' and l.points_delta=10);""",
                            text=True, capture_output=True, check=True).stdout.strip()
    if winner != 't':
        raise RuntimeError('First committed paid sale did not credit its cashier and branch')


try:
    subprocess.run(['docker', 'run', '-d', '--name', CONTAINER,
                    '-e', 'POSTGRES_PASSWORD=fictional-quest-test', 'postgres:16'],
                   check=True, capture_output=True)
    for _ in range(300):
        logs = subprocess.run(['docker', 'logs', CONTAINER], text=True, capture_output=True)
        if 'PostgreSQL init process complete' in logs.stdout and subprocess.run(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'postgres'],
                          capture_output=True).returncode == 0:
            break
        time.sleep(.1)
    else:
        raise RuntimeError('Disposable PostgreSQL did not start')
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
            sql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Test cash','ASET','D'),('1102','Test bank','ASET','D') on conflict do nothing;")
        if migration.name == '20261025111000_new_customer_quests.sql':
            for drift in (
                "alter table public.staff_quest_definitions drop constraint staff_quest_definitions_target_kind_check; "
                "alter table public.staff_quest_definitions add constraint staff_quest_definitions_target_kind_check check (target_kind is not null);",
                "alter function public.apply_sale_staff_effects(uuid) security invoker;",
                "grant execute on function public.apply_sale_staff_effects(uuid) to anon;",
            ):
                try:
                    sql('begin;\n' + drift + '\n' + migration.read_text() + '\ncommit;')
                except RuntimeError as error:
                    if 'Q01_POLICY_DRIFT' not in str(error):
                        raise RuntimeError('Wrong drift rejection: ' + str(error)) from error
                else:
                    raise RuntimeError('Q01 preflight accepted a changed constraint or privilege')
        try:
            sql('begin;\n' + migration.read_text() + '\ncommit;')
        except RuntimeError as error:
            raise RuntimeError(migration.name + ': ' + str(error)) from error
    sql((ROOT / 'supabase/tests/new_customer_quest.sql').read_text())
    concurrency_test()
    print(f'Q01 fictional quest checks passed after {len(migrations)} migrations.')
finally:
    subprocess.run(['docker', 'rm', '-f', CONTAINER], capture_output=True)
