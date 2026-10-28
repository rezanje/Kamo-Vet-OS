#!/usr/bin/env python3
"""Focused production-core SQL checks in owned network-none PostgreSQL17 only."""
from pathlib import Path
import importlib.util
import sys
import subprocess
import time
import json
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('isolated',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.IMAGE='postgres:17.6'

AUTH="set role authenticated;set request.jwt.claim.role='authenticated';select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,false);"
def races(db):
 active=[]
 def post(key,wh='i08-wh'):
  return f"select post_production_atomic('start','{key}',jsonb_build_object('recipe_id',md5('i08-recipe')::uuid,'warehouse_id',md5('{wh}')::uuid,'batch',1,'tanggal',current_date-1))"
 def finish(oid,key):
  return f"select post_production_atomic('finish','{key}',jsonb_build_object('id','{oid}','qty_jadi',3,'tanggal_selesai',current_date))"
 def launch(name,sql):
  process=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  active.append(process);process.stdin.write(f"set application_name='{name}';begin;"+AUTH+sql+';commit;');process.stdin.close();return process
 def wait(name,event):
  for _ in range(250):
   cond="wait_event='PgSleep'" if event=='sleep' else "wait_event_type='Lock'"
   if db.sql(f"select exists(select 1 from pg_stat_activity where application_name='{name}' and {cond});")=='t':return
   time.sleep(.02)
  raise AssertionError('Missing production race barrier '+name)
 def result(process):
  process.wait(timeout=15);return process.returncode,process.stdout.read(),process.stderr.read()
 def receipt(output):return json.loads(next(line for line in output.splitlines() if line.startswith('{')))
 def check_finished(oid):
  valid=db.sql(f"""select status='selesai' and qty_jadi=3 and
   (select count(*)=2 from production_atomic_postings where order_id=o.id) and
   (select sum(qty)=3 and sum(qty*unit_cost)=o.nilai_bahan from stock_moves where source='produksi' and source_ref=o.no_produksi and item_id=md5('i08-output')::uuid and qty>0) and
   (select count(*)=2 from journal_entries where source='produksi' and source_ref=o.no_produksi)
   from production_orders o where id='{oid}';""")
  if valid!='t':raise AssertionError('Concurrent completion reconciliation failed')
 try:
  db.sql("select stock_in_fifo(md5('i08-wh')::uuid,md5('i08-material')::uuid,10,2.5,'fixture','I08-RACES',current_date-1,null);")
  a=launch('i08-start-first',post('race-start')+';select pg_sleep(1)');wait('i08-start-first','sleep')
  activation=launch('i08-activation',"reset role;select pg_advisory_xact_lock(1962072401::bigint);update inventory_costing_settings set method='moving_average' where id");wait('i08-activation','lock')
  pending=db.sql(AUTH+"select coalesce(get_production_atomic_result('start','race-start',null)::text,'null');")
  if pending.splitlines()[-1]!='null':raise AssertionError('Uncommitted start falsely confirmed')
  b=launch('i08-start-second',post('race-start'));wait('i08-start-second','lock');ra,rb=result(a),result(b)
  if ra[0] or rb[0] or not receipt(rb[1])['already_posted']:raise AssertionError('Concurrent start retry failed '+str((ra,rb)))
  rc=result(activation)
  if not rc[0] or 'Produksi FIFO masih berjalan' not in rc[2] or db.sql("select method from inventory_costing_settings where id;")!='fifo':raise AssertionError('Activation stranded running FIFO WIP '+str(rc))
  print('PASS concurrent method transition waits then rejects running FIFO WIP',flush=True)
  oid=receipt(ra[1])['order_id']
  if db.sql(f"select count(*) from production_atomic_postings where order_id='{oid}';")!='1':raise AssertionError('Start duplicate receipt')
  print('PASS concurrent identical start and uncommitted receipt visibility',flush=True)
  a=launch('i08-finish-first',finish(oid,'finish-one')+';select pg_sleep(1)');wait('i08-finish-first','sleep')
  b=launch('i08-finish-second',finish(oid,'finish-two'));wait('i08-finish-second','lock');ra,rb=result(a),result(b)
  if ra[0] or rb[0] or not receipt(rb[1])['already_posted']:raise AssertionError('Concurrent finish retry failed '+str((ra,rb)))
  check_finished(oid);print('PASS concurrent finish exactly once: output, WIP and journals',flush=True)
  db.sql("insert into warehouses(id,branch_id,code,name,type) values(md5('i08-race-wh')::uuid,md5('i08-branch')::uuid,'I08C','Fictional race warehouse','RETAIL');select stock_in_fifo(md5('i08-race-wh')::uuid,md5('i08-material')::uuid,0.125,2.5,'fixture','I08-LAST',current_date-1,null);")
  a=launch('i08-stock-first',post('race-last-one','i08-race-wh')+';select pg_sleep(1)');wait('i08-stock-first','sleep')
  b=launch('i08-stock-second',post('race-last-two','i08-race-wh'));wait('i08-stock-second','lock');ra,rb=result(a),result(b)
  if ra[0] or not rb[0] or 'Stok bahan tidak cukup' not in rb[2]:raise AssertionError('Concurrent material availability failed '+str((ra,rb)))
  print('PASS competing jobs cannot issue the same final material twice',flush=True)
  oid=receipt(db.sql(AUTH+post('race-failure-retry')))['order_id']
  db.sql("""create function public.fictional_i08_pause_fail() returns trigger language plpgsql as $$begin if current_setting('test.i08_fail',true)='yes' then perform pg_sleep(1);raise exception 'Fictional concurrent journal failure';end if;return new;end$$;
   create trigger fictional_i08_fail before insert on journal_lines for each row execute function public.fictional_i08_pause_fail();""")
  a=launch('i08-fail-first',"set local test.i08_fail='yes';"+finish(oid,'finish-failure'));wait('i08-fail-first','sleep')
  b=launch('i08-fail-retry',finish(oid,'finish-after-failure'));wait('i08-fail-retry','lock');ra,rb=result(a),result(b)
  if not ra[0] or rb[0] or 'Fictional concurrent journal failure' not in ra[2]:raise AssertionError('Rollback/queued completion failed '+str((ra,rb)))
  check_finished(oid);print('PASS failed completion rolls back before queued retry commits once',flush=True)
  db.sql("drop trigger fictional_i08_fail on journal_lines;insert into warehouses(id,branch_id,code,name,type) values(md5('i08-ad-race-wh')::uuid,md5('i08-branch')::uuid,'I08AD','Fictional ad hoc race source','RETAIL');select stock_in_fifo(md5('i08-ad-race-wh')::uuid,md5('i08-material')::uuid,10,3.125,'fixture','I08-AD-RACE',current_date-1,null);")
  adhoc="select post_production_adhoc_atomic('start','adhoc-concurrent',jsonb_build_object('mode','adhoc','nama','Fictional concurrent job','branch_id',md5('i08-branch')::uuid,'warehouse_id',md5('i08-wh')::uuid,'output_item_id',md5('i08-output')::uuid,'output_qty',3,'output_unit','PCS','tanggal',current_date-1,'bahan',jsonb_build_array(jsonb_build_object('item_id',md5('i08-material')::uuid,'warehouse_id',md5('i08-wh')::uuid,'qty',1.5,'satuan','PCS'),jsonb_build_object('item_id',md5('i08-material')::uuid,'warehouse_id',md5('i08-ad-race-wh')::uuid,'qty',1.5,'satuan','PCS'))))"
  a=launch('i08-ad-first',adhoc+';select pg_sleep(1)');wait('i08-ad-first','sleep');b=launch('i08-ad-second',adhoc);wait('i08-ad-second','lock');ra,rb=result(a),result(b)
  if ra[0] or rb[0] or not receipt(rb[1])['already_posted']:raise AssertionError('Concurrent ad hoc start failed '+str((ra,rb)))
  oid=receipt(ra[1])['order_id'];db.sql(AUTH+finish(oid,'adhoc-race-finish'));check_finished(oid)
  print('PASS concurrent multi-warehouse ad hoc start and exact finish once',flush=True)
 finally:
  for process in active:
   if process.poll() is None:process.kill();process.wait()

if __name__=='__main__':
 with m.DisposablePostgres() as db:
  db.bootstrap()
  db.sql((ROOT/'supabase/tests/production_atomic.sql').read_text())
  print('PASS production_atomic.sql',flush=True)
  db.sql((ROOT/'supabase/tests/production_adhoc.sql').read_text())
  print('PASS production_adhoc.sql',flush=True)
  for name in ['production_average.sql','production_trace_i08_i09.sql']:
   db.sql((ROOT/'supabase/tests'/name).read_text())
   print('PASS '+name,flush=True)
  if '--sql-only' not in sys.argv:races(db)
