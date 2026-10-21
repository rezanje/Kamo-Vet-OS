#!/usr/bin/env python3
"""Prove reconciliation/payment-cancellation ordering in an owned localhost database."""
from pathlib import Path
import importlib.util
import json
import subprocess
import time
from decimal import Decimal

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    source = load('payment_race_environment', ROOT / 'scripts/test-purchase-payment-corrections-postgres.py')
    bootstrap = load('payment_race_bootstrap', ROOT / 'scripts/test-posted-sales-postgres.py')
    bootstrap.DB, bootstrap.PSQL, bootstrap.ENV = source.DB, source.PSQL, source.ENV
    processes = []

    def start(statement):
        process = subprocess.Popen(source.PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, env=source.ENV)
        processes.append(process)
        process.stdin.write(source.AUTH + statement)
        process.stdin.close()
        return process

    def barrier(predicate):
        for _ in range(500):
            if source.sql('select exists(select 1 from pg_stat_activity where datname=current_database() and (' + predicate + '));').strip() == 't':
                return
            time.sleep(.01)
        raise AssertionError('Missing database-local concurrency barrier: ' + predicate)

    def finish(process, success=True):
        process.wait(timeout=15)
        output, error = process.stdout.read(), process.stderr.read()
        assert (process.returncode == 0) == success, output + error
        return output.strip() if success else error

    def balance():
        return Decimal(source.sql("select coalesce(sum(l.debit-l.credit),0) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where a.code='110209' and e.tanggal<=(now() at time zone 'Asia/Jakarta')::date;").strip())

    created = False
    try:
        subprocess.run(['createdb', *source.LOCAL, source.DB], env=source.ENV, check=True, capture_output=True)
        created = True
        bootstrap.bootstrap_database()
        source.sql(bootstrap.fixture_owner_updates((ROOT / 'supabase/tests/purchase_payment_corrections.sql').read_text()))
        before = balance()
        reconciliation = "select mutate_bank_reconciliation('cross-family-bank','create',null,null,jsonb_build_object('account_id','ed700000-0000-4000-8000-000000000001','tanggal',(now() at time zone 'Asia/Jakarta')::date,'saldo_bank',0,'biaya_adm',0,'bunga',0),null);"
        cancellation = "select cancel_purchase_payment((select (result->>'payment_id')::uuid from payment_test_results where name='partial'),0,'cross-family-payment','Correct fictional payment');"
        # A reconciliation committed first must stop a later cancellation changing its book balance.
        holder = start('begin;' + reconciliation + 'select pg_sleep(1) /* cross-bank-holder */;commit;')
        barrier("wait_event='PgSleep' and query like '%cross-bank-holder%'")
        waiter = start('/* cross-payment-waiter */' + cancellation)
        barrier("wait_event_type='Lock' and query like '%cross-payment-waiter%'")
        result = json.loads(next(line for line in finish(holder).splitlines() if line.startswith('{')))
        assert 'Rekonsiliasi bank' in finish(waiter, False)
        assert balance() == before
        assert source.sql("select count(*) from purchase_payment_cancellation_requests where request_key='cross-family-payment';").strip() == '0'
        source.sql(source.AUTH + "select mutate_bank_reconciliation('cross-family-bank-void','void','" + result['reconciliation_id'] + "',0,'{}','Correct fictional reconciliation');")
        # A cancellation committed first must be included in the later reconciliation snapshot.
        holder = start('begin;' + cancellation + 'select pg_sleep(1) /* cross-payment-holder */;commit;')
        barrier("wait_event='PgSleep' and query like '%cross-payment-holder%'")
        waiter = start('/* cross-bank-waiter */' + reconciliation.replace('cross-family-bank', 'cross-family-bank-after'))
        barrier("wait_event_type='Lock' and query like '%cross-bank-waiter%'")
        finish(holder)
        result = json.loads(next(line for line in finish(waiter).splitlines() if line.startswith('{')))
        observed = Decimal(source.sql("select saldo_buku from bank_reconciliations where id='" + result['reconciliation_id'] + "';").strip())
        assert observed == before + Decimal('300') == balance(), (before, observed, balance())
        assert source.sql("select count(*) from purchase_payment_cancellations where payment_id=(select (result->>'payment_id')::uuid from payment_test_results where name='partial');").strip() == '1'
        print('PASS real reconciliation-before-cancellation blocking and cancellation-before-reconciliation book snapshot.')
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.wait()
        if created:
            subprocess.run(['dropdb', *source.LOCAL, '--if-exists', source.DB], env=source.ENV, check=True, capture_output=True)


if __name__ == '__main__':
    main()
