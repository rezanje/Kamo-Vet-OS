#!/usr/bin/env python3
"""Run moving-average/closing regressions in a disposable localhost database."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sales_test', ROOT / 'scripts/test-posted-sales-postgres.py')
sales = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sales)
sales.DB = f'vetos_average_{os.getpid()}_{int(time.time())}'
sales.PSQL[-1] = sales.DB
subprocess.run(['createdb', '-h127.0.0.1', '-p5432', sales.DB], check=True)
try:
    sales.bootstrap_database()
    opening_fixture = (ROOT / 'supabase/tests/fixtures/average_opening_gl.sql').read_text()
    base = (ROOT / 'supabase/tests/pos_merchant_fees.sql').read_text()
    fixtures = base[:base.index('set local role authenticated;')]
    suite = (ROOT / 'supabase/tests/moving_average_inventory.sql').read_text()
    sales.sql(sales.fixture_owner_updates(fixtures + opening_fixture + suite))
    print('Moving average and monthly closing regressions passed.', flush=True)

    # Independent sessions exercise the same posting/closing advisory lock.
    setup = fixtures + opening_fixture + """
update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.seed_average_opening_gl();
select activate_moving_average();
update inventory_costing_settings set activated_at=date_trunc('month',current_date)-interval '1 month' where id;
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',10,100,'purchase','AVG.RACE.SEED',(date_trunc('month',current_date)-interval '1 month')::date);
commit;
"""
    sales.sql(sales.fixture_owner_updates(setup))
    actor = """set role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"role":"authenticated"}',false);
"""
    def start(source):
        process = subprocess.Popen(sales.PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, env=sales.ENV)
        process.stdin.write(actor + source)
        process.stdin.close()
        return process

    def finish(process, success=True):
        process.wait(timeout=10)
        output, error = process.stdout.read(), process.stderr.read()
        if (process.returncode == 0) != success:
            raise RuntimeError(output + error)
        return error

    def barrier(predicate):
        for _ in range(200):
            present = sales.sql("select exists(select 1 from pg_stat_activity where datname=current_database() and (" + predicate + "));").stdout.strip()
            if present == 't':
                return
            time.sleep(.01)
        raise RuntimeError('Inventory concurrency barrier missing: ' + predicate)

    month = "(date_trunc('month',current_date)-interval '1 month')::date"
    def receipt(ref, date=month):
        return "select stock_in_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',1,100,'purchase','" + ref + "'," + date + ");"

    poster = start('begin;' + receipt('AVG.RACE.POST') + 'select pg_sleep(1) /* avg-post-holder */;commit;')
    barrier("wait_event='PgSleep' and query like '%avg-post-holder%'")
    closer = start('/* avg-close-waiter */select close_inventory_month(' + month + ');')
    barrier("wait_event_type='Lock' and query like '%avg-close-waiter%'")
    finish(poster)
    finish(closer)
    assert sales.sql("select qty from inventory_month_values where item_id='e5500000-0000-4000-8000-000000000002';").stdout.strip() == '11'

    for ref, date, succeeds in [('AVG.RACE.CLOSED', month, False),
                                ('AVG.RACE.CURRENT', 'current_date', True)]:
        closer = start('begin;select close_inventory_month(' + month + ');select pg_sleep(1) /* avg-close-holder */;commit;')
        barrier("wait_event='PgSleep' and query like '%avg-close-holder%'")
        poster = start('/* avg-post-waiter */' + receipt(ref, date))
        barrier("wait_event_type='Lock' and query like '%avg-post-waiter%'")
        finish(closer)
        error = finish(poster, succeeds)
        if not succeeds:
            assert 'Periode persediaan' in error, error
    assert sales.sql("select qty from inventory_month_values where item_id='e5500000-0000-4000-8000-000000000002';").stdout.strip() == '11'
    assert sales.sql("select count(*) from stock_moves where source_ref='AVG.RACE.CLOSED';").stdout.strip() == '0'
    print('Concurrent posting/close: prior-period post included, closed-date retry rolled back, next-period post preserved frozen snapshot.', flush=True)
finally:
    subprocess.run(['dropdb', '-h127.0.0.1', '-p5432', '--if-exists', sales.DB], check=True)
