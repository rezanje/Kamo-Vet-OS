#!/usr/bin/env python3
"""Only fictional data in an owned PostgreSQL 16 container without networking."""
from pathlib import Path
import importlib.util
import os
import subprocess
import sys
import time
import uuid
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'vetos-stock-correction-' + uuid.uuid4().hex[:10]
PSQL = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
AUTH = "set role authenticated; select set_config('request.jwt.claim.sub','ef100000-0000-4000-8000-000000000001',false);"

def sql(source):
    result = subprocess.run(PSQL, input=source, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-6000:])
    return result.stdout.strip()

def races():
    jobs = []
    def start(source):
        proc = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        jobs.append(proc)
        proc.stdin.write(source)
        proc.stdin.close()
        return proc
    def wait(predicate):
        for _ in range(400):
            if sql("select exists(select 1 from pg_stat_activity where datname=current_database() and (" + predicate + "));" ) == 't':
                return
            time.sleep(.02)
        raise RuntimeError('Concurrency barrier not reached: ' + predicate)
    def finish(proc, error=None):
        proc.wait(timeout=20)
        out, err = proc.stdout.read(), proc.stderr.read()
        if error:
            assert proc.returncode and error in err, out + err
        else:
            assert proc.returncode == 0, out + err
        return out
    try:
        doc = sql("select test_stock_source('adjustment','RACE',5);")
        rows = "'[ {\"item_id\":\"ef400000-0000-4000-8000-000000000001\",\"qty\":3} ]'::jsonb"
        token = sql(AUTH + f"select preview_stock_document_correction('adjustment','{doc}',{rows})->>'token';").splitlines()[-1]
        call = f"select correct_stock_document('adjustment','{doc}',{rows},'Race correction','race-key','{token}');"
        first = start(AUTH + 'begin;' + call + "select pg_sleep(1) /* correction-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%correction-holder%'")
        second = start(AUTH + '/* correction-waiter */' + call)
        wait("wait_event_type='Lock' and query like '%correction-waiter%'")
        finish(first); finish(second)
        assert sql(f"select count(*) from stock_document_corrections where document_id='{doc}';") == '1'
        assert sql("select qty from stock where item_id='ef400000-0000-4000-8000-000000000001';") == '3'
        # Consumer wins the stock lock: correction must recheck after waiting.
        doc = sql("select test_stock_source('adjustment','CONSUME',5);")
        token = sql(AUTH + f"select preview_stock_document_correction('adjustment','{doc}',{rows})->>'token';").splitlines()[-1]
        first = start("begin;select * from stock_out_fifo('ef300000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001',1,'test-sale','CONSUMER');select pg_sleep(1) /* consume-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%consume-holder%'")
        second = start(AUTH + f"/* consume-correction-waiter */ select correct_stock_document('adjustment','{doc}',{rows},'Consumed','consume-key','{token}');")
        wait("wait_event_type='Lock' and query like '%consume-correction-waiter%'")
        finish(first); finish(second, 'terpakai')
        assert sql(f"select count(*) from stock_document_corrections where document_id='{doc}';") == '0'
        # Correction wins the stock lock: a later consuming transaction must see
        # the reduced balance and roll its own shortfall back, never stale stock.
        next_doc = sql("select test_stock_source('adjustment','CORRECT-FIRST',5);")
        cancel_rows = "'[{\"item_id\":\"ef400000-0000-4000-8000-000000000001\",\"qty\":0}]'::jsonb"
        cancel_token = sql(AUTH + f"select preview_stock_document_correction('adjustment','{next_doc}',{cancel_rows})->>'token';").splitlines()[-1]
        first = start(AUTH + f"begin;select correct_stock_document('adjustment','{next_doc}',{cancel_rows},'Cancel wrong effect','correct-first','{cancel_token}');select pg_sleep(1) /* correction-first-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%correction-first-holder%'")
        second = start("/* consumer-second-waiter */ do $$declare issue record;begin select * into issue from stock_out_fifo('ef300000-0000-4000-8000-000000000001','ef400000-0000-4000-8000-000000000001',1000000,'test-sale','AFTER-CORRECTION');if issue.shortfall>0 then raise exception 'Controlled stock shortfall';end if;end$$;")
        wait("wait_event_type='Lock' and query like '%consumer-second-waiter%'")
        finish(first);finish(second,'Controlled stock shortfall')
        assert sql("select count(*) from stock_moves where source_ref='AFTER-CORRECTION';") == '0'
        # Revocation committed during a document-lock wait is authoritative.
        first = start(f"begin;select id from inventory_adjustments where id='{doc}' for update;update profiles set is_active=false where id='ef100000-0000-4000-8000-000000000001';select pg_sleep(1) /* revoke-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%revoke-holder%'")
        second = start(AUTH + f"/* revoke-correction-waiter */ select preview_stock_document_correction('adjustment','{doc}',{rows});")
        wait("wait_event_type='Lock' and query like '%revoke-correction-waiter%'")
        finish(first); finish(second, 'Super Admin')
        print('Real waiting sessions: identical retries, both correction/consumption orders, access revocation passed.', flush=True)
    finally:
        for proc in jobs:
            if proc.poll() is None:
                proc.kill(); proc.wait()

def main():
    subprocess.run(['docker', 'run', '-d', '--network', 'none', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=fictional-stock-test', 'postgres:16'], check=True, capture_output=True)
    try:
        for _ in range(200):
            logs = subprocess.run(['docker', 'logs', CONTAINER], text=True, capture_output=True)
            if 'PostgreSQL init process complete' in logs.stdout and subprocess.run(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'postgres'], capture_output=True).returncode == 0:
                break
            time.sleep(.1)
        spec = importlib.util.spec_from_file_location('stock_bootstrap', ROOT / 'scripts/test-posted-sales-postgres.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        statements = []
        module.sql = statements.append
        module.bootstrap_database()
        sql('\n'.join(source for source in statements if '--baseline' not in sys.argv or 'create table public.stock_document_corrections (' not in source))
        sql((ROOT / 'supabase/tests/stock_document_corrections.sql').read_text())
        print('Stock correction SQL assertions passed.', flush=True)
        races()
    finally:
        subprocess.run(['docker', 'rm', '-f', CONTAINER], check=True, capture_output=True)

if __name__ == '__main__':
    main()
