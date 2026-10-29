#!/usr/bin/env python3
"""Q01 atomic quest progress: disposable native PostgreSQL verification (no Docker, no database URL).

Steps: throwaway cluster -> every repository migration in order -> re-apply the Q01 and Q01-atomic
migrations (idempotency) -> the new suite, the existing Q01/C05 suites and the POS sale regressions
that finalize, return or void receipts -> two concurrency checks on separate sessions.

Usage: python3 scripts/test-q01-atomic-postgres.py [pg bin dir, default /usr/lib/postgresql/16/bin]
       add --baseline to skip 20261029153000 (shows which checks the new migration is needed for);
       --only=<substring> runs just the matching suites (the race always runs).
Run as root it uses the `postgres` OS user for the server (see scripts/native_postgres.py).
"""
from pathlib import Path
import re
import subprocess
import sys
import threading

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres  # noqa: E402

BASELINE = '--baseline' in sys.argv
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
BIN = ARGS[0] if ARGS else '/usr/lib/postgresql/16/bin'
NEW = '20261029153000_q01_quest_progress_atomic.sql'
REAPPLY = ['20261028180000_q01_new_customer_quest.sql', NEW]
TESTS = ROOT / 'supabase/tests'

SHIMS = """create role anon; create role authenticated; create role service_role bypassrls;
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
"""


def owner_updates(source):
    """Same fixture rewrite as scripts/test-posted-sales-postgres.py: fixture profile writes bypass the admin guard."""
    return re.sub(r"(?m)^update profiles (.*);$", r"alter table profiles disable trigger guard_profile_privileges;\nselect set_config('test.fixture_actor',coalesce(current_setting('request.jwt.claim.sub',true),''),true);\nselect set_config('request.jwt.claim.sub','',true);\nupdate profiles \1;\nselect set_config('request.jwt.claim.sub',current_setting('test.fixture_actor',true),true);\nalter table profiles enable trigger guard_profile_privileges;", source)


def prelude(name):
    text = (TESTS / name).read_text()
    return text[:text.index('set local role authenticated;')]


def suites():
    fees, split = prelude('pos_merchant_fees.sql'), prelude('pos_split_payments.sql')
    plain = ['q01_new_customer_quest.sql', 'c05_campaign_codes.sql', 'quest_config_write_guard.sql',
             'pos_merchant_fees.sql', 'pos_split_payments.sql', 'pos_payment_method_corrections.sql',
             'cashier_atomic_fifo_floor.sql']
    out = [('q01_quest_progress_atomic.sql', fees + (TESTS / 'q01_quest_progress_atomic.sql').read_text())]
    out += [(n, (TESTS / n).read_text()) for n in plain]
    # The cancellation suite without its self-contained "other FIFO callers" savepoint block, which
    # already fails on main (opname guard, unrelated to Q01; see verification.md). Everything else,
    # including all staff-reward reversal sections, runs.
    cancellation = (TESTS / 'posted_sale_cancellations.sql').read_text()
    start, end = cancellation.index('savepoint other_fifo_callers;'), cancellation.index('rollback to other_fifo_callers;')
    out.append(('posted_sale_cancellations.sql (fee prelude, minus other-FIFO-callers block)',
                fees + cancellation[:start] + cancellation[end + len('rollback to other_fifo_callers;'):]))
    out += [(n + ' (fee prelude)', fees + (TESTS / n).read_text()) for n in
            ['refund_payout.sql', 'return_planned_corrections.sql',
             'customer_return_spending.sql', 'negative_stock_hpp.sql']]
    out.append(('average_sale_corrections.sql (fee prelude + average opening)',
                fees + (TESTS / 'fixtures/average_opening_gl.sql').read_text() + (TESTS / 'average_sale_corrections.sql').read_text()))
    out += [(n + ' (split prelude)', split + (TESTS / n).read_text()) for n in
            ['service_line_performers.sql', 'sold_sku_units.sql', 'promo_edit.sql']]
    return out


RACE_SEED = """
insert into auth.users (id) values ('cc000000-0000-4000-8000-000000000001'), ('cc000000-0000-4000-8000-000000000002');
alter table profiles disable trigger guard_profile_privileges;
update public.profiles set role = 'STAFF', is_active = true where id::text like 'cc000000-%';
alter table profiles enable trigger guard_profile_privileges;
insert into public.branches (id, code, name, type) values ('cc100000-0000-4000-8000-000000000001', 'RACE', 'Race', 'PETSHOP');
insert into public.cashier_shifts (id, branch_id, opened_by, shift_type, status) values
 ('cc200000-0000-4000-8000-000000000001', 'cc100000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'petshop', 'open'),
 ('cc200000-0000-4000-8000-000000000002', 'cc100000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000002', 'petshop', 'open');
update public.staff_quest_definitions set is_active = false;
insert into public.staff_quest_definitions (id, quest_type, title, target_kind, target_value, points_reward)
 values ('cc500000-0000-4000-8000-000000000001', 'daily', 'Race new customer', 'new_customer', 5, 1);
insert into public.customers (id, name, phone) values ('cc400000-0000-4000-8000-000000000002', 'Race new', '081299990002');
"""


def sale(no, cashier, shift):
    return (f"insert into public.sales (branch_id, customer_id, no_struk, subtotal, total, bayar, cashier_id, shift_id) "
            f"values ('cc100000-0000-4000-8000-000000000001', 'cc400000-0000-4000-8000-000000000002', '{no}', 5000, 5000, 5000, "
            f"'{cashier}', '{shift}');")


def main():
    with NativePostgres(BIN) as db:
        print('server:', subprocess.run([str(Path(BIN) / 'postgres'), '--version'], capture_output=True, text=True).stdout.strip(),
              '| baseline (without ' + NEW + ')' if BASELINE else '', flush=True)
        db.sql(SHIMS)
        migrations = [m for m in sorted((ROOT / 'supabase/migrations').glob('*.sql')) if not (BASELINE and m.name == NEW)]
        for m in migrations:
            if m.name.startswith('0068'):
                db.sql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Test cash','ASET','D'),('1102','Test bank','ASET','D') on conflict do nothing")
            try:
                db.sql('begin;\n' + m.read_text() + '\ncommit;')
            except RuntimeError as error:
                raise RuntimeError(m.name + ': ' + str(error)) from error
        print(f'Applied {len(migrations)} repository migrations in order.', flush=True)
        if not BASELINE:
            for name in REAPPLY:
                db.sql('begin;\n' + (ROOT / 'supabase/migrations' / name).read_text() + '\ncommit;')
            print('Re-applied ' + ' + '.join(REAPPLY) + ': idempotent.', flush=True)

        failed = []
        only = [a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--only=')]
        for name, source in suites():
            if only and not any(o in name for o in only):
                continue
            try:
                db.sql(owner_updates(source))
                if BASELINE and name == 'q01_quest_progress_atomic.sql':
                    failed.append(name + ' (passed without the migration: the suite does not detect the bug)')
                print(name + ': passed', flush=True)
            except RuntimeError as error:
                if BASELINE and name == 'q01_quest_progress_atomic.sql':
                    print(name + ': fails without the migration, as expected:\n  '
                          + '\n  '.join(l for l in str(error).splitlines() if 'ERROR' in l), flush=True)
                    continue
                failed.append(name)
                print(name + ': FAILED\n  ' + '\n  '.join(l for l in str(error).strip().splitlines() if 'ERROR' in l or 'CONTEXT' in l)[:1500], flush=True)

        # Race: the same new customer paid at two counters at once -> exactly one claim and exactly
        # one unit of progress, each landing with its own payment.
        db.sql(RACE_SEED + sale('RACE-Q1', 'cc000000-0000-4000-8000-000000000001', 'cc200000-0000-4000-8000-000000000001')
               + sale('RACE-Q2', 'cc000000-0000-4000-8000-000000000002', 'cc200000-0000-4000-8000-000000000002'))
        conn = db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
        results = [None, None]

        def run(i, ref):
            body = ('' if i == 0 else 'select pg_sleep(0.3);\n') + \
                f"update public.sales set payments_finalized_at = clock_timestamp() where no_struk = '{ref}';\n" + \
                ('select pg_sleep(1);\n' if i == 0 else '')
            results[i] = subprocess.run(conn, input=f'begin;\n{body}commit;', text=True, capture_output=True)
        threads = [threading.Thread(target=run, args=(i, r)) for i, r in enumerate(['RACE-Q1', 'RACE-Q2'])]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        state = db.last("select (select count(*) from quest_new_customer_claims where customer_id='cc400000-0000-4000-8000-000000000002')"
                        " || ',' || (select coalesce(sum(current_value),0) from staff_quest_progress where quest_definition_id='cc500000-0000-4000-8000-000000000001')"
                        " || ',' || (select count(*) from sale_staff_effects e join sales s on s.id=e.sale_id where s.no_struk in ('RACE-Q1','RACE-Q2'))")
        expected = '1,0,0' if BASELINE else '1,1,2'
        if any(r.returncode for r in results) or state != expected:
            failed.append('Q01 race')
            print(f'Q01 race: FAILED claims,progress,effects={state} (expected {expected}) {results[0].stderr} {results[1].stderr}', flush=True)
        else:
            print(f'Q01 race: one new customer paid at two counters at once -> claims,progress,effects = {state}', flush=True)

        if failed:
            raise SystemExit('FAILED: ' + ', '.join(failed))
        print('Baseline: new suite is red without the migration (claim locked, progress 0); every regression passes on main.'
              if BASELINE else 'All Q01 atomic checks passed.', flush=True)


if __name__ == '__main__':
    main()
