#!/usr/bin/env python3
"""N02 focused fictional acceptance in an owned network-none PostgreSQL17.6."""
from pathlib import Path
import importlib.util, subprocess, sys, time
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py');fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture);fixture.IMAGE='postgres:17.6'
AUTH="set role authenticated;set request.jwt.claim.role='authenticated';select set_config('request.jwt.claim.sub',md5('n02-owner')::uuid::text,false);"
CREATE="select create_purchase_order_atomic('n02-race','N02.',4,null,md5('n02-wa')::uuid,md5('n02-a')::uuid,current_date,'[{\"nama\":\"Fiction item\",\"qty\":1,\"harga_beli\":100}]')/*n02-create-wait*/;"
def main():
 with fixture.DisposablePostgres()as db:
  db.bootstrap()
  for name in ['po_branch_numbering.sql']:
   # The suite rolls back its fictional fixture transaction.
   db.sql((ROOT/'supabase/tests'/name).read_text());print('PASS '+name,flush=True)
  prefix=(ROOT/'supabase/tests/po_branch_numbering.sql').read_text().split('-- fixture-end:')[0]
  db.sql(prefix+'commit;');active=[]
  def start(source,keep_open=False):
   p=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);active.append(p);p.stdin.write(source+'\n');p.stdin.flush()
   if not keep_open:p.stdin.close()
   return p
  def wait(marker,condition):
   for _ in range(500):
    if db.sql("select exists(select 1 from pg_stat_activity where datname=current_database()and query like '%"+marker+"%'and "+condition+");")=='t':return
    time.sleep(.01)
   raise RuntimeError('Concurrency barrier missing: '+marker)
  try:
   holder=start("begin;select id from branches where id=md5('n02-a')::uuid for update/*n02-branch-edit*/;",keep_open=True)
   wait('n02-branch-edit',"state='idle in transaction'")
   creator=start(AUTH+CREATE)
   wait('n02-create-wait',"wait_event_type='Lock'")
   holder.stdin.write("update branches set code='N02RACE'where id=md5('n02-a')::uuid;commit;\n");holder.stdin.close()
   for p in [holder,creator]:
    p.wait(timeout=15);err=p.stderr.read();out=p.stdout.read();assert p.returncode==0,err+out
   assert db.sql("select no_po from purchase_orders where no_po like 'N02.%'")=='N02.N02RACE-0001'
   assert db.sql("select count(*)from purchase_order_requests where request_key='n02-race'")=='1'
   print('PASS concurrent branch edit serializes authoritative code/one PO',flush=True)
  finally:
   for p in active:
    if p.poll()is None:p.kill();p.wait()
if __name__=='__main__':main()
