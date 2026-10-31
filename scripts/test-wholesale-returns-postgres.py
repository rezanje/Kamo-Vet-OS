#!/usr/bin/env python3
"""N01/J01 Retur Penjualan grosir: fictional fixtures on a throwaway PostgreSQL. Never accepts a database URL.

Applies every repository migration, then runs:
  supabase/tests/wholesale_returns.sql   full/partial return, over-return, paid vs unpaid, void, A01 capture,
                                         journal balance, moving average (rolls back)
  regression: sales_safe_posting.sql and wholesale_corrections.sql (patched wholesale RPCs)
  two-session races on a committed copy of the return fixture:
    identical retry, competing last quantity, payment vs return (both orders),
    correction vs return (both orders), identical void retry.

Usage:
  python3 scripts/test-wholesale-returns-postgres.py                # Docker postgres:16, network none
  python3 scripts/test-wholesale-returns-postgres.py --pg-bin DIR   # native throwaway cluster, no Docker
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import time
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
legacy_spec = importlib.util.spec_from_file_location('legacy', ROOT / 'scripts/test-posted-sales-postgres.py')
legacy = importlib.util.module_from_spec(legacy_spec)
legacy_spec.loader.exec_module(legacy)
TESTS = ROOT / 'supabase/tests'


def md5_uuid(text):
    return str(uuid.UUID(hashlib.md5(text.encode()).hexdigest()))


OWNER = md5_uuid('wr-owner')
AUTH = ("set role authenticated;select set_config('request.jwt.claim.sub','" + OWNER + "',false);"
        "select set_config('request.jwt.claim.role','authenticated',false);")


def run(db, command):
    db.sql((TESTS / 'wholesale_returns.sql').read_text())
    print('PASS wholesale_returns.sql (rolled back)', flush=True)
    db.sql(legacy.fixture_owner_updates((TESTS / 'sales_safe_posting.sql').read_text()))
    print('PASS regression sales_safe_posting.sql', flush=True)
    base = (TESTS / 'sales_safe_posting.sql').read_text().split('insert into sales_quotations')[0]
    base += "\nupdate profiles set role='OWNER' where id='f1000000-0000-4000-8000-000000000001';commit;\n"
    db.sql(legacy.fixture_owner_updates(base) + (TESTS / 'wholesale_corrections.sql').read_text())
    print('PASS regression wholesale_corrections.sql', flush=True)
    races(db, command)


def races(db, command):
    source = (TESTS / 'wholesale_returns.sql').read_text()
    marker = '-- @@fixture-end'
    if source.count(marker) != 1:
        raise RuntimeError('Fixture marker missing from wholesale_returns.sql')
    db.sql(source.split(marker)[0] + '\ncommit;')
    jobs = []

    def ids(order):
        return json.loads(db.sql("select jsonb_build_object('invoice',si.id,'revision',si.revision,'lines',(select jsonb_object_agg(oi.nama,ii.id) "
                                 "from sales_invoice_items ii join sales_order_items oi on oi.id=ii.order_item_id where ii.invoice_id=si.id)) "
                                 "from sales_invoices si join sales_orders o on o.id=si.order_id where o.no_pesanan='" + order + "' and si.status<>'batal';"))

    def wait(predicate):
        for _ in range(400):
            if db.sql("select exists(select 1 from pg_stat_activity where datname=current_database() and (" + predicate + "));") == 't':
                return
            time.sleep(0.025)
        raise RuntimeError('Missing two-session lock barrier: ' + predicate)

    def start(text):
        proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                env={**os.environ, 'PSQLRC': '/dev/null'})
        jobs.append(proc)
        proc.stdin.write(AUTH + text)
        proc.stdin.close()
        return proc

    def finish(proc, rejected=None):
        proc.wait(timeout=30)
        out, err = proc.stdout.read(), proc.stderr.read()
        if rejected:
            assert proc.returncode != 0 and rejected in err, out + err
            return None
        if proc.returncode:
            raise RuntimeError(out + err)
        return [json.loads(line) for line in out.splitlines() if line.startswith('{')]

    def race(first, second, rejected=None, first_rejected=None):
        holder = start('begin;' + first + 'select pg_sleep(1) /* wr-holder */;commit;')
        wait("wait_event='PgSleep' and query like '%wr-holder%'")
        waiter = start('/* wr-waiter */' + second)
        wait("wait_event_type='Lock' and query like '%wr-waiter%'")
        return finish(holder, first_rejected), finish(waiter, rejected)

    def ret(key, doc, line, qty):
        items = json.dumps([{'invoice_item_id': doc['lines'][line], 'qty': qty}])
        return (f"select post_wholesale_return('{key}','{doc['invoice']}',current_date,'{md5_uuid('wr-wh')}','Race retur',"
                f"'{items}'::jsonb);")

    def pay(key, doc, amount):
        return f"select receive_wholesale_payment('{key}','{doc['invoice']}',current_date,{amount},'Transfer',null,null,null);"

    try:
        doc = ids('SO.WR.A')
        a, b = race(ret('race-same', doc, 'Food box', 1), ret('race-same', doc, 'Food box', 1))
        assert a == b and len(a) == 1, (a, b)
        assert db.sql("select count(*) from wholesale_returns where invoice_id='" + doc['invoice'] + "';") == '1'
        assert db.sql("select count(*) from wholesale_operation_requests where kind='return' and request_key='race-same';") == '1'
        print('PASS identical concurrent retry: one return, same result', flush=True)

        race(ret('race-last-a', doc, 'Food pcs', 5), ret('race-last-b', doc, 'Food pcs', 5), 'melebihi sisa')
        assert db.sql("select sum(ri.qty) from wholesale_return_items ri join wholesale_returns r on r.id=ri.return_id "
                      "where r.status='posted' and ri.invoice_item_id='" + doc['lines']['Food pcs'] + "';") == '5'
        print('PASS competing returns of the last quantity: one wins, the other is refused', flush=True)

        doc_b = ids('SO.WR.B')
        race(ret('race-return-first', doc_b, 'Food pcs', 4), pay('race-pay-late', doc_b, 44), 'melebihi sisa')
        assert db.sql("select returned_ar=44 and status='lunas' from sales_invoices where id='" + doc_b['invoice'] + "';") == 't'
        doc_c = ids('SO.WR.C')
        race(pay('race-pay-first', doc_c, 33), ret('race-return-late', doc_c, 'Food pcs', 3))
        assert db.sql("select ar_reduction=0 and customer_credit=33 from wholesale_returns r join wholesale_operation_requests w "
                      "on w.result->>'return_id'=r.id::text where w.request_key='race-return-late';") == 't'
        print('PASS payment vs return in both orders: receivable never over-settled, excess becomes credit', flush=True)

        void_id = db.sql("select id from wholesale_returns r join wholesale_operation_requests w on w.result->>'return_id'=r.id::text "
                         "where w.request_key='race-return-late';")
        void = f"select void_wholesale_return('{void_id}',0,'race-void','Race pembatalan');"
        a, b = race(void, void)
        assert a == b and len(a) == 1, (a, b)
        assert db.sql("select count(*) from journal_entries where source='wholesale-return-void' and source_ref='" + void_id + "';") == '1'
        print('PASS identical concurrent void: one reversal journal, same result', flush=True)

        doc_c = ids('SO.WR.C')
        cancel = (f"select correct_wholesale_invoice('{doc_c['invoice']}',{doc_c['revision']},'race-cancel-first','cancel','Race batal',"
                  "jsonb_build_object('tanggal',current_date));")
        # Invoice C is paid; cancelling keeps the payment as customer credit.
        race(cancel, ret('race-return-after-cancel', doc_c, 'Food pcs', 1), 'dibatalkan')
        doc_a = ids('SO.WR.A')
        # The return commits first and bumps the revision once; the correction then reaches the
        # invoice-with-return guard instead of the stale-revision check.
        cancel_a = (f"select correct_wholesale_invoice('{doc_a['invoice']}',{doc_a['revision'] + 1},'race-cancel-late','cancel','Race batal',"
                    "jsonb_build_object('tanggal',current_date));")
        race(ret('race-return-before-cancel', doc_a, 'Service', 1), cancel_a, 'retur penjualan aktif')
        print('PASS correction vs return in both orders: no re-billing of returned goods', flush=True)

        unbalanced = db.sql("select count(*) from journal_entries e where e.source in ('wholesale-return','wholesale-return-void') "
                            "and (select sum(debit)-sum(credit) from journal_lines where entry_id=e.id)<>0;")
        assert unbalanced == '0', unbalanced
        print('PASS every committed return/void journal balanced', flush=True)
    finally:
        for proc in jobs:
            if proc.poll() is None:
                proc.kill()
                proc.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--pg-bin', help='PostgreSQL bin dir for a native throwaway cluster instead of Docker')
    args = parser.parse_args()
    if args.pg_bin:
        sys.path.insert(0, str(ROOT / 'scripts'))
        from native_postgres import NativePostgres
        if sys.platform == 'darwin':
            os.environ.setdefault('LC_ALL', 'en_US.UTF-8')
        with NativePostgres(args.pg_bin) as db:
            fixture.DisposablePostgres.bootstrap(db)
            command = db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
            run(db, command)
    else:
        with fixture.DisposablePostgres() as db:
            db.bootstrap()
            run(db, db.command())


if __name__ == '__main__':
    main()
