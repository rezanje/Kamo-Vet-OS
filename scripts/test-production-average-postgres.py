#!/usr/bin/env python3
"""Fictional moving-average production in an owned network-none PostgreSQL17."""
from pathlib import Path
import importlib.util
import json
import subprocess
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('isolated', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.IMAGE = 'postgres:17.6'
AUTH = "set role authenticated;set request.jwt.claim.role='authenticated';select set_config('request.jwt.claim.sub',md5('i08-avg-owner')::uuid::text,false);"


def races(db):
    db.sql("""select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,2,2.5,'fixture','I08AVG.RACE1',current_date-1,null);
select stock_in_fifo(md5('i08-avg-a')::uuid,md5('i08-avg-material')::uuid,3,3.125,'fixture','I08AVG.RACE2',current_date-1,null);
update stock set average_cost=2.875 where warehouse_id=md5('i08-avg-a')::uuid and item_id=md5('i08-avg-material')::uuid;
update inventory_costing_settings set method='moving_average',activated_at=now() where id;""")
    active = []
    def launch(name, statement):
        process = subprocess.Popen(db.command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        active.append(process)
        process.stdin.write(f"set application_name='{name}';begin;" + AUTH + statement + ';commit;')
        process.stdin.close()
        return process
    def barrier(name, event):
        for _ in range(250):
            condition = "wait_event='PgSleep'" if event == 'sleep' else "wait_event_type='Lock'"
            if db.sql(f"select exists(select 1 from pg_stat_activity where application_name='{name}' and {condition});") == 't':
                return
            time.sleep(.02)
        raise AssertionError('Missing average production race barrier: ' + name)
    def result(process):
        process.wait(timeout=15)
        output, error = process.stdout.read(), process.stderr.read()
        if process.returncode:
            raise AssertionError(f'Concurrent average posting failed: {error}')
        return json.loads(next(line for line in output.splitlines() if line.startswith('{')))
    try:
        payload = "jsonb_build_object('recipe_id',md5('i08-avg-recipe')::uuid,'warehouse_id',md5('i08-avg-a')::uuid,'batch',1,'tanggal',current_date-1)"
        start = "select post_production_atomic('start','avg-race-start'," + payload + ')'
        first = launch('i08-avg-first', start + ';select pg_sleep(1)')
        barrier('i08-avg-first', 'sleep')
        second = launch('i08-avg-second', start)
        barrier('i08-avg-second', 'lock')
        a, b = result(first), result(second)
        assert a['value'] == .359375 and b['already_posted'] and a['order_id'] == b['order_id'], (a, b)
        print('PASS concurrent average start posts material/WIP once', flush=True)
        finish = f"select post_production_atomic('finish','avg-race-finish',jsonb_build_object('id','{a['order_id']}','qty_jadi',3,'tanggal_selesai',current_date))"
        first = launch('i08-avg-finish-first', finish + ';select pg_sleep(1)')
        barrier('i08-avg-finish-first', 'sleep')
        second = launch('i08-avg-finish-second', finish)
        barrier('i08-avg-finish-second', 'lock')
        c, d = result(first), result(second)
        assert d['already_posted'] and c['order_id'] == d['order_id'], (c, d)
        assert db.sql(f"""select status='selesai' and
 (select count(*)=2 from production_atomic_postings where order_id=o.id) and
 (select count(*)=2 from journal_entries where source='produksi' and source_ref=o.no_produksi) and
 (select sum(qty*unit_cost)=o.nilai_bahan from stock_moves where source='produksi' and source_ref=o.no_produksi and item_id=md5('i08-avg-output')::uuid and qty>0)
 from production_orders o where id='{a['order_id']}';""") == 't'
        print('PASS concurrent average finish receives output and closes WIP once', flush=True)
    finally:
        for process in active:
            if process.poll() is None:
                process.kill()
                process.wait()


with m.DisposablePostgres() as db:
    db.bootstrap()
    assert db.sql("select bool_and(p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE')) from pg_proc p where p.oid in ('public.post_production_atomic(text,text,jsonb)'::regprocedure,'public.post_production_adhoc_atomic(text,text,jsonb)'::regprocedure);") == 't'
    print('PASS production RPC security-definer and execute ACL unchanged', flush=True)
    db.sql((ROOT / 'supabase/tests/production_average.sql').read_text())
    print('PASS production_average.sql', flush=True)
    if '--sql-only' not in sys.argv:
        races(db)
