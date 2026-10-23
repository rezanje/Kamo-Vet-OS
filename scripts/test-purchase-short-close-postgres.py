#!/usr/bin/env python3
"""P07 isolated fictional PostgreSQL17.6 acceptance and bounded concurrency only."""
from pathlib import Path
from decimal import Decimal
import importlib.util,subprocess,sys,time,uuid
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py');fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture);fixture.IMAGE='postgres:17.6'
AUTH="set role authenticated;set request.jwt.claim.role='authenticated';do $$begin perform set_config('request.jwt.claim.sub',md5('p07-owner')::uuid::text,false);end$$;"
EXPECTED="jsonb_build_array(jsonb_build_object('id',md5('p07-line')::uuid,'qty',10,'qty_terima',5,'qty_rusak',0,'satuan','pcs','faktor',1))"
def close(key='p07-race-close'):return "select close_purchase_order_remainder(md5('p07-po')::uuid,'"+key+"',"+EXPECTED+",'Supplier remainder unavailable',true);"
def receive():return "select receive_purchase_order(md5('p07-po')::uuid,'p07-race-receipt','TB.P07.',5,current_date,null,null,jsonb_build_array(jsonb_build_object('id',md5('p07-line')::uuid,'qty_terima',1)));"
def invoice():return "select * from create_purchase_invoice_from_po(md5('p07-po')::uuid,'FB.P07.',5,null,current_date,current_date+30,null,jsonb_build_array(jsonb_build_object('po_item_id',md5('p07-line')::uuid,'qty',5,'harga',100)),'[]','[]',0,'p07-race-invoice');"
class DB:
 def __init__(self,owned,name):self.owned=owned;self.name=name
 def command(self):return self.owned.command()+['-d',self.name]
 def sql(self,source):
  r=subprocess.run(self.command(),input=source,text=True,capture_output=True)
  if r.returncode:raise RuntimeError(r.stderr+r.stdout)
  return r.stdout.strip()
def races(owned,prefix):
 for scenario in ['close-first','receipt-first','identical-retry']:
  name='p07_'+uuid.uuid4().hex;owned.sql('create database '+name+' template postgres');db=DB(owned,name);db.sql(prefix+'commit;');active=[]
  def start(source):
   p=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);active.append(p);p.stdin.write(AUTH+source);p.stdin.close();return p
  def wait(marker,event):
   for _ in range(500):
    if db.sql("select exists(select 1 from pg_stat_activity where datname=current_database()and query like '%"+marker+"%'and "+event+");")=='t':return
    time.sleep(.01)
   raise RuntimeError('Missing concurrency barrier '+marker)
  def finish(p):p.wait(timeout=15);return p.returncode,p.stdout.read(),p.stderr.read()
  try:
   first=start('begin;'+(receive()if scenario=='receipt-first'else close())+'select pg_sleep(1)/* p07-holder */;commit;');wait('p07-holder',"wait_event='PgSleep'")
   second=start('/* p07-waiter */'+(receive()if scenario=='close-first'else close()));wait('p07-waiter',"wait_event_type='Lock'")
   third=None
   if scenario in('close-first','receipt-first'):
    third=start('/* p07-invoice-waiter */'+invoice());wait('p07-invoice-waiter',"wait_event_type='Lock'")
   a=finish(first);b=finish(second);c=finish(third)if third else None
   if a[0]:raise AssertionError('First transaction failed '+str(a))
   if scenario=='receipt-first':
    assert b[0]and 'berubah'in b[2]and c[0]and 'Diterima'in c[2],(b,c)
    assert db.sql("select qty_terima from purchase_order_items where id=md5('p07-line')::uuid")=='6'
    assert db.sql('select count(*)from purchase_order_receipt_closures')=='0'
    assert db.sql('select count(*)from purchase_invoices')=='0'
   elif scenario=='close-first':
    assert b[0]and 'tidak bisa diterima'in b[2]and c[0]==0,(b,c)
    assert Decimal(db.sql('select sum(qty)from purchase_invoice_items'))==5
    assert db.sql('select count(*)from goods_receipts')=='1'
    assert Decimal(db.sql('select sum(qty)from stock'))==5
   else:
    assert b[0]==0,b
    assert db.sql('select count(*)from purchase_order_receipt_closures')=='1'
    assert db.sql("select count(*)from activity_log where row_entity='purchase_orders'and after_state->>'status'='Diterima'")=='1'
    assert db.sql(AUTH+"select result is not null from(select get_purchase_order_short_close(md5('p07-po')::uuid,'p07-race-close')result)x")=='t'
   print('PASS concurrency '+scenario,flush=True)
  finally:
   for p in active:
    if p.poll()is None:p.kill();p.wait()
   owned.sql('drop database '+name+' with(force)')
def main():
 source=(ROOT/'supabase/tests/purchase_short_close.sql').read_text();prefix=source.split('-- fixture-end:')[0]
 with fixture.DisposablePostgres()as db:
  db.bootstrap()
  for name in ['purchase_short_close.sql','purchase_short_close_guards.sql']:
   name_db='p07_suite_'+uuid.uuid4().hex;db.sql('create database '+name_db+' template postgres')
   try:
    body=(ROOT/'supabase/tests'/name).read_text();DB(db,name_db).sql((prefix if name.endswith('guards.sql')else'')+body);print('PASS '+name,flush=True)
   finally:db.sql('drop database '+name_db+' with(force)')
  # Existing real invoice and DP protections remain active alongside short-close.
  for name in ['purchase_advance_atomic.sql','purchase_invoice_lifecycle.sql']:
   name_db='p07_regression_'+uuid.uuid4().hex;db.sql('create database '+name_db+' template postgres')
   try:DB(db,name_db).sql((ROOT/'supabase/tests'/name).read_text());print('PASS regression '+name,flush=True)
   finally:db.sql('drop database '+name_db+' with(force)')
  races(db,prefix)
if __name__=='__main__':main()
