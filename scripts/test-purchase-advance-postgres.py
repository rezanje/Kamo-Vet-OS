#!/usr/bin/env python3
"""Owned network-none PostgreSQL16 tests only; no target connection or credentials."""
from pathlib import Path
import importlib.util,subprocess,time,sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('isolated',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
AUTH="set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='d6000000-0000-4000-8000-000000000001';"
def races(db):
 db.sql("""insert into auth.users(id)values('d6000000-0000-4000-8000-000000000001');
 insert into profiles(id,role,is_active)values('d6000000-0000-4000-8000-000000000001','OWNER',true)on conflict(id)do update set role='OWNER',is_active=true;
 insert into suppliers(id,nama)values('d6300000-0000-4000-8000-000000000001','Fiction race supplier');
 insert into coa_accounts(code,name,type,normal_balance)values('1196','Fiction race bank','ASET','D');
 insert into cash_accounts(id,nama,jenis,coa_code,is_active)values('d6700000-0000-4000-8000-000000000001','Fiction race bank','Bank','1196',true);
 insert into purchase_orders(id,no_po,supplier_id,status,total)values
 ('d6400000-0000-4000-8000-000000000010','PO.RACE.RC','d6300000-0000-4000-8000-000000000001','Draft',100),
 ('d6400000-0000-4000-8000-000000000011','PO.RACE.RR','d6300000-0000-4000-8000-000000000001','Draft',100),
 ('d6400000-0000-4000-8000-000000000012','PO.RACE.RETRY','d6300000-0000-4000-8000-000000000001','Draft',100),
 ('d6400000-0000-4000-8000-000000000013','PO.RACE.VOID','d6300000-0000-4000-8000-000000000001','Draft',100),
 ('d6400000-0000-4000-8000-000000000014','PO.RACE.RECOVERY','d6300000-0000-4000-8000-000000000001','Draft',100);""")
 def pay(key,po,amount=60):return f"select pay_purchase_advance_atomic('{key}','UM.RACE.',5,'d6300000-0000-4000-8000-000000000001','d6400000-0000-4000-8000-0000000000{po}',current_date,{amount},'Transfer','d6700000-0000-4000-8000-000000000001',null);"
 active=[]
 def start(source):
  p=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);active.append(p);p.stdin.write(AUTH+source);p.stdin.close();return p
 def wait(marker,lock=False):
  for _ in range(500):
   where="wait_event_type='Lock'" if lock else "wait_event='PgSleep'"
   if db.sql(f"select exists(select 1 from pg_stat_activity where {where} and query like '%{marker}%');")=='t':return
   time.sleep(.01)
  raise RuntimeError('Missing concurrency barrier '+marker)
 def finish(p):p.wait(timeout=15);return p.returncode,p.stdout.read(),p.stderr.read()
 try:
  for iso,po in [('read committed','10'),('repeatable read','11')]:
   first=start(f'begin isolation level {iso};'+pay('first-'+po,po)+f"select pg_sleep(1) /* dp-holder-{po} */;commit;")
   wait('dp-holder-'+po)
   second=start(f'begin isolation level {iso};/* dp-waiter-{po} */'+pay('second-'+po,po)+'commit;')
   wait('dp-waiter-'+po,True);a=finish(first);b=finish(second)
   total=db.sql(f"select coalesce(sum(jumlah),0) from purchase_advances where po_id='d6400000-0000-4000-8000-0000000000{po}';")
   if a[0] or b[0]==0 or ('sisa batas' not in b[2] and 'serialize' not in b[2]) or float(total)!=60:raise AssertionError(f'{iso} cap race: first={a}, second={b}, total={total}')
   print('PASS concurrent cap '+iso,flush=True)
  first=start('begin;'+pay('same-key','12')+"select pg_sleep(1) /* dp-same-holder */;commit;");wait('dp-same-holder')
  second=start('/* dp-same-waiter */'+pay('same-key','12'));wait('dp-same-waiter',True)
  a=finish(first);b=finish(second)
  if a[0] or b[0] or db.sql("select count(*) from purchase_advances where po_id='d6400000-0000-4000-8000-000000000012';")!='1':raise AssertionError('same-key race duplicated or failed '+str((a,b)))
  print('PASS concurrent identical retry: one advance and one receipt',flush=True)
  first=start("begin;select id from purchase_orders where id='d6400000-0000-4000-8000-000000000013' for update;select pg_sleep(1) /* dp-void-holder */;select revise_purchase_order('dp-race-void','d6400000-0000-4000-8000-000000000013',0,'void','{}','[]','Fiction concurrent void');commit;")
  wait('dp-void-holder');second=start('/* dp-void-waiter */'+pay('after-void','13'));wait('dp-void-waiter',True)
  a=finish(first);b=finish(second)
  if a[0] or b[0]==0 or 'tidak aktif' not in b[2] or db.sql("select count(*) from purchase_advances where po_id='d6400000-0000-4000-8000-000000000013';")!='0':raise AssertionError('PO revision/advance lock order '+str((a,b)))
  print('PASS existing PO revision vs advance lock ordering',flush=True)
  advance=db.sql("select id from purchase_advances where po_id='d6400000-0000-4000-8000-000000000012';")
  first=start('begin;'+pay('before-refund','12',20)+"select pg_sleep(1) /* dp-before-refund */;commit;");wait('dp-before-refund')
  second=start(f"/* dp-refund-waiter */select cancel_purchase_advance_atomic('{advance}');");wait('dp-refund-waiter',True)
  a=finish(first);b=finish(second)
  if a[0] or b[0] or db.sql("select sum(jumlah) from purchase_advances where po_id='d6400000-0000-4000-8000-000000000012' and status='aktif';")!='20.00':raise AssertionError('advance then refund race '+str((a,b)))
  advance=db.sql("select id from purchase_advances where po_id='d6400000-0000-4000-8000-000000000012' and status='aktif';")
  first=start(f"begin;select cancel_purchase_advance_atomic('{advance}');select pg_sleep(1) /* dp-refund-first */;commit;");wait('dp-refund-first')
  second=start('/* dp-after-refund */'+pay('after-refund','12'));wait('dp-after-refund',True)
  a=finish(first);b=finish(second)
  if a[0] or b[0] or db.sql("select sum(jumlah) from purchase_advances where po_id='d6400000-0000-4000-8000-000000000012' and status='aktif';")!='60.00':raise AssertionError('refund then advance race '+str((a,b)))
  advance=db.sql("select id from purchase_advances where po_id='d6400000-0000-4000-8000-000000000012' and status='aktif';")
  first=start(f"begin;select cancel_purchase_advance_atomic('{advance}');select pg_sleep(1) /* dp-refund-retry-first */;commit;");wait('dp-refund-retry-first')
  second=start(f"/* dp-refund-retry-second */select cancel_purchase_advance_atomic('{advance}');");wait('dp-refund-retry-second',True)
  a=finish(first);b=finish(second)
  if a[0] or b[0] or db.sql(f"select count(*) from purchase_advance_cancellations where advance_id='{advance}';")!='1':raise AssertionError('refund retry duplicated '+str((a,b)))
  print('PASS advance/refund ordering and concurrent refund retry',flush=True)
  first=start("begin;select id from purchase_orders where id='d6400000-0000-4000-8000-000000000014' for update;select pg_sleep(2) /* dp-recovery-revision */;select revise_purchase_order('dp-recovery-void','d6400000-0000-4000-8000-000000000014',0,'void','{}','[]','Fiction recovery race');commit;")
  wait('dp-recovery-revision');second=start('/* dp-recovery-pay */'+pay('recovery-race','14'));wait('dp-recovery-pay',True)
  third=start("/* dp-recovery-read */select get_purchase_advance_result('recovery-race');");wait('dp-recovery-read',True)
  a=finish(first);b=finish(second);c=finish(third)
  if a[0] or b[0]==0 or 'tidak aktif' not in b[2] or c[0] or c[1].strip():raise AssertionError('recovery/revision/advance lock order '+str((a,b,c)))
  print('PASS recovery vs pending advance and PO revision lock order',flush=True)


 finally:
  for p in active:
   if p.poll()is None:p.kill();p.wait()
def main():
 with m.DisposablePostgres() as db:
  db.bootstrap();db.sql((ROOT/'supabase/tests/purchase_advance_atomic.sql').read_text());print('PASS purchase_advance_atomic.sql',flush=True);races(db)
if __name__=='__main__':main()
