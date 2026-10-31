#!/usr/bin/env python3
"""Reviewed Accurate import accounting in FIFO/average, using disposable localhost DBs."""
import hashlib
import importlib.util
import json
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
sales.DB = f'vetos_reviewed_import_{os.getpid()}_{int(time.time())}'
sales.PSQL[-1] = sales.DB
subprocess.run(['createdb', '-h127.0.0.1', '-p5432', sales.DB], check=True)
try:
    sales.bootstrap_database()
    opening_fixture = (ROOT / 'supabase/tests/fixtures/average_opening_gl.sql').read_text()
    for name in ['accurate_inventory_accounting.sql', 'accurate_inventory_accounting_guards.sql',
                 'accurate_inventory_accounting_review.sql']:
        sales.sql((ROOT / 'supabase/tests' / name).read_text())
        print(name + ': passed', flush=True)
    base = (ROOT / 'supabase/tests/accurate_inventory_accounting.sql').read_text()
    fixtures = base[:base.index('set local role authenticated;')]
    suite = (ROOT / 'supabase/tests/reviewed_inventory_import.sql').read_text()
    auth = "set local role authenticated;select set_config('request.jwt.claim.role','authenticated',true);select set_config('request.jwt.claim.sub',md5('ai-owner')::uuid::text,true);"
    for method in ['fifo', 'moving_average']:
        activate = 'select activate_moving_average();' if method == 'moving_average' else ''
        sales.sql(fixtures + auth + activate + suite)
        print('Reviewed import in ' + method + ': one selected-equity journal and atomic source valuation passed.', flush=True)
    # Activation holds the exclusive inventory lock before stock writes. A
    # reviewed import must wait without holding conflicting stock relation locks.
    setup = fixtures + opening_fixture + """insert into items(id,code,name,unit,item_type) values(md5('ai-existing')::uuid,'AI-EXISTING','Existing activation stock','pcs','Persediaan');
      insert into stock(warehouse_id,item_id,qty) values(md5('ai-wh')::uuid,md5('ai-existing')::uuid,1);
      insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values(md5('ai-wh')::uuid,md5('ai-existing')::uuid,'2026-01-01',1,1,10,'manual');select pg_temp.seed_average_opening_gl();commit;"""
    sales.sql(setup)
    import uuid
    owner = str(uuid.UUID(hashlib.md5(b'ai-owner').hexdigest()))
    auth = "set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='" + owner + "';"
    reviewed = json.loads(sales.sql(auth + "select preview_accurate_inventory_accounting(md5('ai-run')::uuid,(select id from coa_accounts where code='410001'));").stdout)
    assert reviewed['can_post'], reviewed
    processes = []
    def start(name, source):
        proc = subprocess.Popen(sales.PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, env=sales.ENV)
        processes.append(proc)
        proc.stdin.write("set application_name='" + name + "';" + auth + source)
        proc.stdin.close()
        return proc
    def wait(name, predicate):
        for _ in range(300):
            if sales.sql("select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='" + name + "' and " + predicate + ");").stdout.strip() == 't':
                return
            time.sleep(.01)
        raise RuntimeError('Reviewed import lock barrier missing: ' + name)
    try:
        activation = start('reviewed-import-activation', 'begin;select pg_advisory_xact_lock(1962072401::bigint);select pg_sleep(1);select activate_moving_average();commit;')
        wait('reviewed-import-activation', "wait_event='PgSleep'")
        payload = json.dumps(reviewed).replace("'", "''")
        post = start('reviewed-import-waiter', "select post_accurate_inventory_accounting(md5('ai-run')::uuid,(select id from coa_accounts where code='410001'),'" + payload + "'::jsonb,'Owner reviewed activation race');")
        wait('reviewed-import-waiter', "wait_event_type='Lock' and wait_event='advisory'")
        assert sales.sql("select not exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='reviewed-import-waiter' and l.relation='public.stock'::regclass and l.mode='ShareRowExclusiveLock' and l.granted);").stdout.strip() == 't', 'Waiting import held stock before global inventory lock'
        for proc in [activation, post]:
            proc.wait(timeout=10)
            assert proc.returncode == 0, proc.stderr.read()
        assert sales.sql("select count(*)=1 from journal_entries where source_ref=md5('ai-run')::uuid::text;").stdout.strip() == 't'
        assert sales.sql("select qty=10 and average_cost=12.5 from stock where item_id=md5('ai-item')::uuid;").stdout.strip() == 't'
        print('Activation/import concurrency: correct lock order, one journal and correct new average passed.', flush=True)
    finally:
        for proc in processes:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
finally:
    subprocess.run(['dropdb', '-h127.0.0.1', '-p5432', '--if-exists', sales.DB], check=True)
