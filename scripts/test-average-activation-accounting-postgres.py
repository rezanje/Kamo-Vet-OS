#!/usr/bin/env python3
"""Activation accounting guard and regressions in owned network-none PostgreSQL.

No external DSN, credentials or shared database are accepted. Docker postgres:16
must already be cached. Optional release SQL is applied only to this container.
"""
import argparse
from decimal import Decimal
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


harness = module('owned_activation_fixture', 'test-accurate-inventory-accounting-postgres.py')
sales = module('activation_fixture_helpers', 'test-posted-sales-postgres.py')
TESTS = ROOT / 'supabase/tests'
OWNER = 'ed4dbd40-d7d4-8935-bdef-5d49384ee69d'  # md5('ag-owner')
AUTH = f"set role authenticated;set request.jwt.claim.sub='{OWNER}';set request.jwt.claim.role='authenticated';"


def read(name):
    return (TESTS / name).read_text()


def source_fixture(source):
    return sales.fixture_owner_updates(source.replace('update public.profiles ', 'update profiles '))


def regressions(db):
    db.sql(read('average_activation_accounting.sql'))
    print('PASS activation guard: missing/wrong/unallocated GL, invalid journals, physical proof, no-side-effects, permissions, valid cutover and retry.', flush=True)
    opening = read('fixtures/average_opening_gl.sql')
    for base_name, suite_name in [('pos_merchant_fees.sql', 'moving_average_inventory.sql'),
                                  ('pos_merchant_fees.sql', 'average_sale_corrections.sql'),
                                  ('purchase_invoice_lifecycle.sql', 'average_purchase_corrections.sql')]:
        prefix = read(base_name).split('set local role authenticated;')[0]
        db.sql(source_fixture(prefix + opening + read(suite_name)))
        print('PASS ' + suite_name, flush=True)
    clinic = read('clinic_invoice_post.sql').split('set local role authenticated;')[0]
    order = read('sales_safe_posting.sql').split('create function public.test_sales_reject_order_line()')[0].replace('begin;', '', 1)
    db.sql(source_fixture(clinic + order + opening + read('moving_average_clinic.sql')))
    print('PASS moving_average_clinic.sql', flush=True)
    accurate = read('accurate_inventory_accounting.sql').split('set local role authenticated;')[0]
    auth = "set local role authenticated;set request.jwt.claim.role='authenticated';select set_config('request.jwt.claim.sub',md5('ai-owner')::uuid::text,true);"
    for method in ['fifo', 'average']:
        activation = 'select activate_moving_average();' if method == 'average' else ''
        db.sql(accurate + auth + activation + read('reviewed_inventory_import.sql'))
        print('PASS reviewed inventory import ' + method, flush=True)
    for name in ['accurate_inventory_accounting.sql', 'accurate_inventory_accounting_guards.sql',
                 'accurate_inventory_accounting_review.sql', 'purchase_invoice_lifecycle.sql',
                 'pos_merchant_fees.sql', 'pos_split_payments.sql', 'online_return_unit_posting.sql',
                 'clinic_compound_issue.sql', 'clinic_invoice_post.sql',
                 'clinic_billing_lifecycle.sql', 'sales_safe_posting.sql']:
        fixture = source_fixture(read(name))
        # The invoice runner normally commits for its later concurrency phase.
        # Here each standalone fixture must roll back before the next family.
        if fixture.rstrip().endswith('commit;'):
            fixture = fixture.rsplit('commit;', 1)[0] + 'rollback;'
        db.sql(fixture)
        print('PASS FIFO ' + name, flush=True)
    base = read('pos_merchant_fees.sql').split('set local role authenticated;')[0]
    db.sql(source_fixture(base + read('posted_sale_cancellations.sql')))
    print('PASS FIFO posted_sale_cancellations.sql', flush=True)


def races(db):
    setup = read('average_activation_accounting.sql').split('-- FUNCTIONAL CASES')[0]
    db.sql(setup + """
select stock_in_fifo(md5('ag-wh')::uuid,md5('ag-item')::uuid,10,16,'manual','AG.RACE.SEED');
select pg_temp.activation_gl(md5('ag-branch')::uuid,160,'AG.RACE.OPENING');
commit;
""")
    running = []

    def start(name, source, authenticated=True):
        process = subprocess.Popen(db.command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        running.append(process)
        process.stdin.write("\\set VERBOSITY verbose\nset application_name='" + name + "';" + (AUTH if authenticated else '') + source)
        process.stdin.close()
        return process

    def finish(process, success=True):
        process.wait(timeout=12)
        output, error = process.stdout.read(), process.stderr.read()
        if 'deadlock detected' in error or (process.returncode == 0) != success:
            raise AssertionError(output + error)
        return output, error

    def wait(name, predicate):
        for _ in range(300):
            if db.sql("select exists(select 1 from pg_stat_activity where application_name='" + name + "' and " + predicate + ');') == 't':
                return
            time.sleep(.01)
        raise AssertionError('Missing real session barrier: ' + name)

    def journal(ref, inventory=True):
        code = '1301' if inventory else '1101'
        return "select sales_write_journal(current_date,md5('ag-branch')::uuid,'manual','" + ref + "','Fiction concurrent journal','[{\"code\":\"" + code + "\",\"debit\":1,\"credit\":0},{\"code\":\"3101\",\"debit\":0,\"credit\":1}]');"

    try:
        # GL writers that do not hold the inventory lock cannot be read halfway.
        writer = start('ag-journal-first', 'begin;' + journal('AG.RACE.GAP') + 'select pg_sleep(1);commit;', False)
        wait('ag-journal-first', "wait_event='PgSleep'")
        attempt = start('ag-journal-conflict', 'select activate_moving_average();')
        _, error = finish(attempt, False)
        assert '55P03' in error and 'muat ulang status' in error, error
        finish(writer)
        _, error = finish(start('ag-journal-recheck', 'select activate_moving_average();'), False)
        assert '23514' in error and 'rekonsiliasi' in error, error
        assert db.sql("select method from inventory_costing_settings where id;") == 'fifo'
        assert db.sql('select count(*) from inventory_cost_events;') == '0'
        db.sql("delete from journal_entries where source_ref='AG.RACE.GAP';")
        print('PASS journal-first: nonblocking conflict, then committed mismatch rejected; no activation effects.', flush=True)

        # Reverse lock order: journal writer must wait until the activation
        # decision ends. Roll back this fictional probe to test more races.
        activation = start('ag-activation-first', 'begin;select activate_moving_average();select pg_sleep(1);rollback;')
        wait('ag-activation-first', "wait_event='PgSleep'")
        writer = start('ag-journal-waiter', journal('AG.RACE.CASH', False), False)
        wait('ag-journal-waiter', "wait_event_type='Lock'")
        finish(activation)
        finish(writer)
        assert db.sql("select method from inventory_costing_settings where id;") == 'fifo'
        print('PASS activation-first: independent journal writer waits for atomic activation decision.', flush=True)

        revoker = start('ag-revoke-first', "begin;update profiles set is_active=false where id='" + OWNER + "';select pg_sleep(1);commit;", False)
        wait('ag-revoke-first', "wait_event='PgSleep'")
        _, error = finish(start('ag-revoke-conflict', 'select activate_moving_average();'), False)
        assert '55P03' in error, error
        finish(revoker)
        _, error = finish(start('ag-revoked-actor', 'select activate_moving_average();'), False)
        assert '42501' in error, error
        db.sql("update profiles set is_active=true where id='" + OWNER + "';")
        print('PASS actor revocation-first: pending privilege change retries; revoked actor cannot activate.', flush=True)

        activation = start('ag-actor-held', 'begin;select activate_moving_average();select pg_sleep(1);rollback;')
        wait('ag-actor-held', "wait_event='PgSleep'")
        revoker = start('ag-actor-waiter', "update profiles set is_active=false where id='" + OWNER + "';", False)
        wait('ag-actor-waiter', "wait_event_type='Lock'")
        finish(activation)
        finish(revoker)
        db.sql("update profiles set is_active=true where id='" + OWNER + "';")
        print('PASS activation-first actor snapshot stays locked through decision.', flush=True)

        # A complete receipt+GL transaction wins the inventory shared lock; the
        # waiting activation reads the committed physical and financial sides.
        poster = start('ag-stock-first', "begin;select pg_advisory_xact_lock_shared(1962072401::bigint);select stock_in_fifo(md5('ag-wh')::uuid,md5('ag-item')::uuid,1,1,'manual','AG.RACE.RECEIPT');" + journal('AG.RACE.RECEIPT') + 'select pg_sleep(1);commit;', False)
        wait('ag-stock-first', "wait_event='PgSleep'")
        activation = start('ag-stock-waiter', 'select activate_moving_average();')
        wait('ag-stock-waiter', "wait_event_type='Lock' and wait_event='advisory'")
        retry = start('ag-activation-retry', 'select activate_moving_average();')
        wait('ag-activation-retry', "wait_event_type='Lock' and wait_event='advisory'")
        finish(poster)
        outputs = [finish(activation)[0], finish(retry)[0]]
        results = [json.loads(line) for output in outputs for line in output.splitlines() if line.startswith('{')]
        assert sorted(result['already_active'] for result in results) == [False, True], results
        assert abs(Decimal(db.sql("select sum(value_after) from inventory_cost_events where source='average-activation';")) - Decimal(161)) < Decimal('1e-8')
        assert db.sql("select count(*) from inventory_cost_events where source='average-activation';") == '1'
        print('PASS receipt-first and duplicate activation: completed receipt/GL included once, one seed and one already-active retry.', flush=True)
    finally:
        for process in running:
            if process.poll() is None:
                process.kill()
                process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--races-only', action='store_true')
    parser.add_argument('--compatibility-migration', action='append', type=Path, default=[])
    args = parser.parse_args()
    with harness.DisposablePostgres() as db:
        if args.compatibility_migration:
            # Replay the actual chronological migration composition, not a late
            # patch of release SQL onto an already migrated schema.
            with tempfile.TemporaryDirectory(prefix='kamo-activation-migrations-') as directory:
                migration_root = Path(directory) / 'supabase/migrations'
                migration_root.mkdir(parents=True)
                for source in list((ROOT / 'supabase/migrations').glob('*.sql')) + args.compatibility_migration:
                    target = migration_root / source.name
                    if target.exists() and target.read_bytes() != source.read_bytes():
                        raise AssertionError('Conflicting migration name: ' + source.name)
                    target.write_bytes(source.read_bytes())
                original_root = harness.ROOT
                try:
                    harness.ROOT = Path(directory)
                    db.bootstrap()
                finally:
                    harness.ROOT = original_root
            for migration in args.compatibility_migration:
                print('Included chronological compatibility migration: ' + migration.name, flush=True)
        else:
            db.bootstrap()
        if not args.races_only:
            regressions(db)
        races(db)


if __name__ == '__main__':
    main()
