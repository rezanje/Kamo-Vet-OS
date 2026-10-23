#!/usr/bin/env python3
"""Focused I02 SQL regressions in owned network-none PostgreSQL, no target credentials."""
from pathlib import Path
import importlib.util
import sys
import subprocess
import time
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('isolated', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.IMAGE = 'postgres:17.6'
AUTH = "set role authenticated;set request.jwt.claim.role='authenticated';select set_config('request.jwt.claim.sub',md5('i02-owner')::uuid::text,false);"

def races(db):
    active = []
    def start(name, statement):
        process = subprocess.Popen(db.command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        active.append(process)
        process.stdin.write(f"set application_name='{name}';begin;" + AUTH + statement + ';commit;')
        process.stdin.close()
        return process
    def wait(name, event):
        for _ in range(200):
            condition = "wait_event='PgSleep'" if event == 'sleep' else "wait_event_type='Lock'"
            if db.sql(f"select exists(select 1 from pg_stat_activity where application_name='{name}' and {condition});") == 't':
                return
            time.sleep(.02)
        raise AssertionError('Missing concurrency barrier: ' + name)
    def finish(process):
        process.wait(timeout=15)
        return process.returncode, process.stdout.read(), process.stderr.read()
    def order(label, locked=False):
        qty = db.sql("select coalesce((select qty from stock where warehouse_id=md5('i02-vet-wh')::uuid and item_id=md5('i02-a')::uuid),0)+1;")
        db.sql(f"insert into opname_orders(id,no_opname,warehouse_id,penanggung_jawab) values(md5('{label}')::uuid,'OPO.'||left(md5('{label}'),12),md5('i02-vet-wh')::uuid,'Fictional race');")
        if locked:
            db.sql(f"insert into opname_counts(order_id,item_id,qty_sistem,qty_fisik) values(md5('{label}')::uuid,md5('i02-a')::uuid,{qty}-1,{qty});")
        return f"select post_opname_atomic(md5('{label}')::uuid,current_date,jsonb_build_object(md5('i02-a')::uuid::text,{qty}))"
    try:
        post = order('i02-race-repeat')
        first = start('i02-repeat-first', post + ';select pg_sleep(1)')
        wait('i02-repeat-first', 'sleep')
        second = start('i02-repeat-second', post)
        wait('i02-repeat-second', 'lock')
        a, b = finish(first), finish(second)
        if a[0] or b[0] or '"already_posted": true' not in b[1]:
            raise AssertionError('Identical concurrent retry failed: ' + str((a, b)))
        if db.sql("""select count(*)=1 and bool_and(
          (select count(*) from opname_posting_receipts p where p.order_id=r.order_id)=1
          and (select count(*) from stock_moves m where m.source='opname' and m.source_ref=r.no_hasil)=1
          and (select count(*) from journal_entries j where j.source='opname' and j.source_ref=r.no_hasil)=1
        ) from opname_results r where order_id=md5('i02-race-repeat')::uuid;""") != 't':
            raise AssertionError('Concurrent retry duplicated result, receipt, stock or journal')
        print('PASS two-session identical posting: one receipt/result/stock/GL outcome', flush=True)

        post = order('i02-race-cancel')
        first = start('i02-cancel-first', "select cancel_opname_draft(md5('i02-race-cancel')::uuid,'Fictional cancelled before posting');select pg_sleep(1)")
        wait('i02-cancel-first', 'sleep')
        second = start('i02-cancel-post', post)
        wait('i02-cancel-post', 'lock')
        a, b = finish(first), finish(second)
        if a[0] or not b[0] or 'Opname tidak terbuka' not in b[2]:
            raise AssertionError('Cancellation/post race failed: ' + str((a, b)))
        print('PASS cancellation wins: waiting posting rejected with no result', flush=True)

        post = order('i02-race-post-first')
        first = start('i02-post-first', post + ';select pg_sleep(1)')
        wait('i02-post-first', 'sleep')
        second = start('i02-post-cancel', "select cancel_opname_draft(md5('i02-race-post-first')::uuid,'Fictional late cancellation')")
        wait('i02-post-cancel', 'lock')
        a, b = finish(first), finish(second)
        if a[0] or not b[0] or 'OPNAME_NOT_DRAFT' not in b[2]:
            raise AssertionError('Posting/cancellation race failed: ' + str((a, b)))
        print('PASS posting wins: waiting cancellation rejected', flush=True)

        db.sql("""create function public.fictional_i02_pause() returns trigger language plpgsql as $$begin
          if current_setting('test.i02_pause',true)='yes' then perform pg_sleep(1);end if;return new;end$$;
          create trigger fictional_i02_pause before insert on opname_results for each row execute function public.fictional_i02_pause();""")
        post = order('i02-race-unlock', locked=True)
        first = start('i02-finalizing', "set local test.i02_pause='yes';" + post)
        wait('i02-finalizing', 'sleep')
        second = start('i02-unlocking', "delete from opname_counts where order_id=md5('i02-race-unlock')::uuid")
        wait('i02-unlocking', 'lock')
        a, b = finish(first), finish(second)
        if a[0] or not b[0] or 'Opname tidak terbuka' not in b[2]:
            raise AssertionError('Posting/unlock parent-child lock ordering failed: ' + str((a, b)))
        print('PASS posting vs late unlock: no deadlock, confirmed snapshot retained', flush=True)
    finally:
        for process in active:
            if process.poll() is None:
                process.kill()
                process.wait()

if __name__ == '__main__':
    with m.DisposablePostgres() as db:
        db.bootstrap()
        db.sql((ROOT / 'supabase/tests/opname_posting_atomic.sql').read_text())
        print('PASS opname_posting_atomic.sql', flush=True)
        races(db)
