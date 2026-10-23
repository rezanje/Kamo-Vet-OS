#!/usr/bin/env python3
"""Customer derived statistics on owned network-none disposable PostgreSQL17."""
from pathlib import Path
import importlib.util,sys,re,subprocess,time
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('isolated',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.IMAGE='postgres:17.6'
if __name__=='__main__':
 with m.DisposablePostgres() as db:
  db.bootstrap()
  base=(ROOT/'supabase/tests/pos_merchant_fees.sql').read_text()
  source=base[:base.index('set local role authenticated;')]+(ROOT/'supabase/tests/customer_return_spending.sql').read_text()
  db.sql(source);print('PASS customer_return_spending.sql',flush=True)
  # Existing posting/cancellation behavior remains covered after the two narrow patches.
  db.sql((ROOT/'supabase/tests/online_return_unit_posting.sql').read_text());print('PASS online_return_unit_posting.sql',flush=True)
  cancellation=(ROOT/'supabase/tests/posted_sale_cancellations.sql').read_text()
  # Native-owner fixture setup changes identities between assertions. Clear only
  # its synthetic JWT while updating accounts; keep all real guards enabled.
  cancellation=re.sub(r"(?m)^update profiles (.*);$",r"select set_config('test.fixture_actor',coalesce(current_setting('request.jwt.claim.sub',true),''),true);\nselect set_config('request.jwt.claim.sub','',true);\nupdate profiles \1;\nselect set_config('request.jwt.claim.sub',current_setting('test.fixture_actor',true),true);",cancellation)
  # Scope to sale cancellation: later unrelated old synthetic stock-out calls
  # intentionally lack documents now required by opname/transfer guards.
  db.sql(base[:base.index('set local role authenticated;')]+cancellation.split('savepoint other_fifo_callers;')[0]+'rollback;');print('PASS posted_sale_cancellations.sql (sale-specific prefix)',flush=True)

  # Commit only synthetic headers inside the owned container for two sessions.
  db.sql(source.split('-- Bad source')[0]+'commit;')
  auth="set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';"
  customer="'f1000000-0000-4000-8000-000000000001'"
  def start(sql):
   p=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
   p.stdin.write(auth+sql);p.stdin.close();return p
  def barrier(marker,event,process=None):
   for _ in range(300):
    if process is not None and process.poll() is not None:raise RuntimeError("Concurrent command exited before lock barrier: "+process.stderr.read())
    if db.sql("select exists(select 1 from pg_stat_activity where query like '%"+marker+"%'and "+event+")")=='t':return
    time.sleep(.01)
   raise RuntimeError('Concurrent refresh barrier missing')
  first=start('begin;select refresh_customer_spending('+customer+');select pg_sleep(5)/* spending-refresh-holder */;commit;')
  barrier('spending-refresh-holder',"wait_event='PgSleep'")
  second=start("begin;/* spending-refresh-waiter */select post_unit_return('sales','f2000000-0000-4000-8000-000000000001','spending-race',jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'dari','kasir'),jsonb_build_array(jsonb_build_object('source_line_id',(select id from sale_items where sale_id='f2000000-0000-4000-8000-000000000001'),'item_id','e5500000-0000-4000-8000-000000000001','qty',.01,'satuan','pcs','kondisi','baik')));select refresh_customer_spending("+customer+")/* spending-refresh-waiter */;commit;")
  barrier('spending-refresh-waiter',"wait_event_type='Lock'",second)
  for p in [first,second]:
   p.wait(timeout=15)
   if p.returncode:raise RuntimeError(p.stderr.read())
  assert db.sql('select total_spending=280705 from customers where id='+customer)=='t'
  print('PASS concurrent refresh locks preserve newly committed return history',flush=True)
