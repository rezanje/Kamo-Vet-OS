#!/usr/bin/env python3
"""P05 fictional fixtures in owned network-none PostgreSQL only; no target access."""
from pathlib import Path
import importlib.util,sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('isolated',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.IMAGE='postgres:17.6'
PRELUDE=(ROOT/'supabase/tests/purchase_advance_atomic.sql').read_text().split('set local role authenticated;')[0]+"""
insert into warehouses(id,branch_id,code,name,type)values('d6200000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','P05-WH','Fictional P05 warehouse','VET');
update purchase_orders set to_warehouse_id='d6200000-0000-4000-8000-000000000001'where id='d6400000-0000-4000-8000-000000000001';
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active)values('1301','Fiction P05 inventory','ASET','D',false,true),('2102','Fiction P05 GRNI','LIABILITAS','K',false,true)on conflict(code)do update set is_active=true,is_header=false;
insert into items(id,code,name,unit,item_type)values('d6800000-0000-4000-8000-000000000001','P05-STOCK','Fiction P05 stock','pcs','Persediaan');
insert into purchase_order_items(id,po_id,nama,qty,harga_beli,satuan,faktor)values('d6500000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-000000000001','Fictional PO line',2,300000,'pcs',1);
"""
AUTH="set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='d6000000-0000-4000-8000-000000000001';"
def races(db):
 import subprocess,time
 active=[];named={}
 def po(n):return 'd6400000-0000-4000-8000-'+str(n).zfill(12)
 def line(n):return 'd6500000-0000-4000-8000-'+str(n).zfill(12)
 def pay(n,key,amount):return f"select pay_purchase_advance_atomic('{key}','UM.P05.R.',5,'d6300000-0000-4000-8000-000000000001','{po(n)}',current_date,{amount},'Transfer','d6700000-0000-4000-8000-000000000001',null);"
 def price(n,key='price'):return f"select revise_purchase_order_prices('{key}-{n}','{po(n)}',0,'[{{\"id\":\"{line(n)}\",\"harga_beli\":250000}}]','Fiction supplier price');"
 def seed(n):
  db.sql(f"insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status,total)values('{po(n)}','PO.P05.R.{n}','d6300000-0000-4000-8000-000000000001','d6100000-0000-4000-8000-000000000001','d6200000-0000-4000-8000-000000000001','Dipesan',600000);insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor)values('{line(n)}','{po(n)}','d6800000-0000-4000-8000-000000000001','Fiction race line',2,300000,'pcs',1);")
  db.sql(AUTH+pay(n,'initial-'+str(n),400000))
 def start(name,source,iso='read committed'):
  p=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);active.append(p);named[name]=p;p.stdin.write(f"set application_name='{name}';"+AUTH+f'begin isolation level {iso};'+source+'commit;');p.stdin.close();return p
 def wait(name,kind):
  for _ in range(100):
   process=named[name]
   if process.poll()not in(None,0):raise AssertionError('Race fixture failed before barrier: '+process.stderr.read())
   cond="wait_event='PgSleep'"if kind=='sleep'else"wait_event_type='Lock'"
   if db.sql(f"select exists(select 1 from pg_stat_activity where application_name='{name}'and {cond});")=='t':return
   time.sleep(.01)
  raise AssertionError('Missing race barrier '+name)
 def done(p):p.wait(timeout=15);return p.returncode,p.stdout.read(),p.stderr.read()
 try:
  for i,iso in enumerate(['read committed','repeatable read']):
   n=10+i;seed(n)
   a=start('p05-dp-first-'+str(n),pay(n,'new-'+str(n),150000)+'select pg_sleep(1);');wait('p05-dp-first-'+str(n),'sleep')
   b=start('p05-price-wait-'+str(n),price(n),iso);wait('p05-price-wait-'+str(n),'lock');ra,rb=done(a),done(b)
   assert ra[0]==0 and rb[0]!=0 and('lebih kecil' in rb[2]or 'serialize'in rb[2]),str((ra,rb))
   assert db.sql(f"select total=600000 and revision=0 from purchase_orders where id='{po(n)}'")=='t'
   print('PASS DP-first vs price correction '+iso,flush=True)
   n=12+i;seed(n)
   a=start('p05-price-first-'+str(n),price(n)+'select pg_sleep(1);');wait('p05-price-first-'+str(n),'sleep')
   b=start('p05-dp-wait-'+str(n),pay(n,'new-'+str(n),150000),iso);wait('p05-dp-wait-'+str(n),'lock');ra,rb=done(a),done(b)
   assert ra[0]==0 and rb[0]!=0 and('sisa batas'in rb[2]or 'serialize'in rb[2]),str((ra,rb))
   assert db.sql(f"select total=500000 and revision=1 from purchase_orders where id='{po(n)}'")=='t'
   print('PASS price-first vs DP cap '+iso,flush=True)
  n=14;seed(n)
  a=start('p05-same-first',price(n,'same')+'select pg_sleep(1);');wait('p05-same-first','sleep')
  b=start('p05-same-wait',price(n,'same'));wait('p05-same-wait','lock');ra,rb=done(a),done(b)
  assert not ra[0]and not rb[0]and db.sql(f"select count(*)from purchase_order_revisions where purchase_order_id='{po(n)}'")=='1',str((ra,rb))
  print('PASS concurrent price retry one audit/receipt',flush=True)
  n=15;seed(n)
  receipt=f"select receive_purchase_order('{po(n)}','p05-receipt','GR.P05.',5,current_date,null,null,'[{{\"id\":\"{line(n)}\",\"qty_terima\":1,\"qty_rusak\":0}}]');"
  a=start('p05-receipt-first',receipt+'select pg_sleep(1);');wait('p05-receipt-first','sleep')
  b=start('p05-receipt-price-wait',price(n));wait('p05-receipt-price-wait','lock');ra,rb=done(a),done(b)
  assert not ra[0]and rb[0]!=0 and 'transaksi turunan'in rb[2],str((ra,rb))
  print('PASS committed partial receipt blocks queued price correction',flush=True)
 finally:
  for p in active:
   if p.poll()is None:p.kill();p.wait()

if __name__=='__main__':
 with m.DisposablePostgres()as db:
  db.bootstrap();db.sql(PRELUDE+(ROOT/'supabase/tests/po_price_after_advance.sql').read_text());print('PASS po_price_after_advance.sql',flush=True)
  db.sql(PRELUDE+'commit;');races(db)
