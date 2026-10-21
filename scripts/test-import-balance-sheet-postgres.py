#!/usr/bin/env python3
"""Verify import/accounting integration in a disposable local PostgreSQL database."""
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
sales.DB = f'vetos_import_balance_{os.getpid()}_{int(time.time())}'
sales.PSQL[-1] = sales.DB

subprocess.run(['createdb', '-h127.0.0.1', '-p5432', sales.DB], check=True)
try:
    sales.bootstrap_database()
    suite = (ROOT / 'supabase/tests/import_balance_sheet.sql').read_text()
    sales.sql(sales.fixture_owner_updates(suite))
    print('Initial stock import: source-valued balance sheet, branch/date, duplicate rejection, validation and atomic rollback passed.', flush=True)
    # Two source files racing for the same first inventory balance cannot both
    # pass the empty-history check and double the opening journal.
    actor = 'ed100000-0000-4000-8000-000000000001'
    auth = "set role authenticated;select set_config('request.jwt.claim.sub','" + actor + "',false);select set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false);"
    fixtures = suite[:suite.index('set local role authenticated;')]
    setup = fixtures + auth + """do $$declare first_run uuid:=pg_temp.batch(); second_run uuid:=pg_temp.batch();begin
      update import_runs set source_name='race-first' where id=first_run;
      update import_runs set source_name='race-second' where id=second_run;
      update import_run_rows set payload=jsonb_set(payload,'{item_id}',
        (select payload->'item_id' from import_run_rows where run_id=first_run)) where run_id=second_run;
    end $$;commit;"""
    sales.sql(sales.fixture_owner_updates(setup))
    first = sales.sql("select id from import_runs where source_name='race-first';").stdout.strip()
    second = sales.sql("select id from import_runs where source_name='race-second';").stdout.strip()
    def start(source):
        proc = subprocess.Popen(sales.PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, env=sales.ENV)
        proc.stdin.write(auth + source)
        proc.stdin.close()
        return proc
    winner = start("begin;select post_accurate_initial_stock('" + first + "');select pg_sleep(1) /* import-race-holder */;commit;")
    for _ in range(200):
        ready = sales.sql("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event='PgSleep' and query like '%import-race-holder%');").stdout.strip()
        if ready == 't':
            break
        time.sleep(.01)
    else:
        raise RuntimeError('Import concurrency barrier missing')
    loser = start("select post_accurate_initial_stock('" + second + "');")
    winner.wait(timeout=10)
    loser.wait(timeout=10)
    assert winner.returncode == 0, winner.stderr.read()
    error = loser.stderr.read()
    assert loser.returncode != 0 and 'tanpa riwayat stok' in error, error
    assert sales.sql("select count(*) from journal_entries where source='saldo-awal-accurate';").stdout.strip() == '1'
    assert sales.sql("select count(*) from import_runs where status='posted';").stdout.strip() == '1'
    print('Concurrent first imports for one SKU: exactly one stock balance and one opening journal passed.', flush=True)
finally:
    subprocess.run(['dropdb', '-h127.0.0.1', '-p5432', '--if-exists', sales.DB], check=True)
