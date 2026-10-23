#!/usr/bin/env python3
"""J03 fictional refund tests in owned network-none PostgreSQL17 only."""
from pathlib import Path
import importlib.util
import sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('isolated',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.IMAGE='postgres:17.6'
import subprocess,time,json
AUTH="set role authenticated;select set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false);"
CASHIER="select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',false);"
FINANCE="select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',false);"
def race_checks(db):
 active=[]
 def start(name,sql,actor=FINANCE):
  p=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);active.append(p)
  p.stdin.write(f"set application_name='{name}';begin;"+AUTH+actor+sql+';commit;');p.stdin.close();return p
 def wait(name,event):
  for _ in range(300):
   condition="wait_event='PgSleep'"if event=='sleep'else"wait_event_type='Lock'"
   if db.sql(f"select exists(select 1 from pg_stat_activity where application_name='{name}'and {condition});")=='t':return
   time.sleep(.02)
  raise AssertionError('Missing race barrier '+name)
 def done(p):p.wait(timeout=15);return p.returncode,p.stdout.read(),p.stderr.read()
 def receipt(text):return json.loads(next(line for line in reversed(text.splitlines())if line.startswith('{')))
 def post(ref,key,method='Transfer'):
  return "select post_sales_return_with_payout(s.id,'"+key+"',jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'dari','kasir','refund_method','"+method+"','destination',jsonb_build_object('bank','Fictional bank','account','0001234','name','Fictional recipient')),jsonb_build_array(jsonb_build_object('source_line_id',i.id,'item_id',i.item_id,'qty',2,'satuan','pcs','kondisi','baik')))from sales s join sale_items i on i.sale_id=s.id where s.no_struk='"+ref+"'"
 def claim(rid):return f"select claim_sales_refund_request('{rid}')"
 def complete(rid,ref):return f"select complete_sales_refund_request('{rid}',(now() at time zone 'Asia/Jakarta')::date,'e6600000-0000-4000-8000-000000000003','{ref}')"
 def counts(ref):return db.sql(f"select jsonb_build_array((select count(*)from sales_returns where sale_id=s.id),(select count(*)from sales_refund_payouts where sale_id=s.id),(select count(*)from sales_refund_requests where sale_id=s.id))from sales s where no_struk='{ref}'")
 try:
  first=start('j03-pending-first',post('J03.RACE','race-pending')+';select pg_sleep(1)',CASHIER);wait('j03-pending-first','sleep')
  second=start('j03-pending-second',post('J03.RACE','race-pending'),CASHIER);wait('j03-pending-second','lock');a,b=done(first),done(second)
  assert not a[0]and not b[0]and receipt(a[1])['refund_request_id']==receipt(b[1])['refund_request_id'],str((a,b))
  rid=receipt(a[1])['refund_request_id'];assert counts('J03.RACE')=='[0, 0, 1]'
  print('PASS concurrent pending request retry: one receipt and zero return/payout',flush=True)
  first=start('j03-claim-first',claim(rid)+';select pg_sleep(1)');wait('j03-claim-first','sleep')
  second=start('j03-claim-second',claim(rid));wait('j03-claim-second','lock');a,b=done(first),done(second)
  assert not a[0]and not b[0]and receipt(b[1])['status']=='diproses',str((a,b))
  blocked=done(start('j03-cash-reserved',post('J03.RACE','cash-conflict','Tunai'),CASHIER))
  assert blocked[0]and 'reservasi' in blocked[2]and counts('J03.RACE')=='[0, 0, 1]',str(blocked)
  print('PASS claim retry and reserved full source cannot be paid via cash',flush=True)
  first=start('j03-complete-first',complete(rid,'FICT-RACE-1')+';select pg_sleep(1)');wait('j03-complete-first','sleep')
  second=start('j03-complete-second',complete(rid,'FICT-RACE-1'));wait('j03-complete-second','lock');a,b=done(first),done(second)
  assert not a[0]and not b[0]and receipt(a[1])['document_id']==receipt(b[1])['document_id']and counts('J03.RACE')=='[1, 1, 1]',str((a,b))
  print('PASS concurrent transfer completion retry: one return and payout',flush=True)
  pending=db.sql(AUTH+CASHIER+post('J03.FAILRACE','race-failure'));rid=receipt(pending)['refund_request_id'];db.sql(AUTH+FINANCE+claim(rid))
  db.sql("create function public.fictional_j03_fail()returns trigger language plpgsql as $$begin if current_setting('test.j03_fail',true)='yes'then perform pg_sleep(1);raise exception 'Fictional concurrent refund failure';end if;return new;end$$;create trigger fictional_j03_fail before insert on journal_lines for each row execute function public.fictional_j03_fail();")
  first=start('j03-failed-complete',"set local test.j03_fail='yes';"+complete(rid,'FICT-FAIL-RACE'));wait('j03-failed-complete','sleep')
  second=start('j03-queued-retry',complete(rid,'FICT-RETRY-RACE'));wait('j03-queued-retry','lock');a,b=done(first),done(second)
  assert a[0]and 'Fictional concurrent refund failure'in a[2]and not b[0]and counts('J03.FAILRACE')=='[1, 1, 1]',str((a,b))
  print('PASS journal failure rolls back before queued retry pays exactly once',flush=True)
 finally:
  for p in active:
   if p.poll()is None:p.kill();p.wait()
if __name__=='__main__':
 with m.DisposablePostgres()as db:
  db.bootstrap();fees=(ROOT/'supabase/tests/pos_merchant_fees.sql').read_text()
  fixture=(ROOT/'supabase/tests/refund_payout.sql').read_text()
  if '--sql-only'in sys.argv:db.sql(fees.split('set local role authenticated;')[0]+fixture)
  else:
   seed="set local role authenticated;"+CASHIER+"select pg_temp.fee_sale('J03.RACE','[{\"method\":\"Tunai\",\"amount\":100000}]',0,100000,100000,'Tunai');select pg_temp.lines((select id from sales where no_struk='J03.RACE'));select finalize_pos_sale((select id from sales where no_struk='J03.RACE'));select pg_temp.fee_sale('J03.FAILRACE','[{\"method\":\"Tunai\",\"amount\":100000}]',0,100000,100000,'Tunai');select pg_temp.lines((select id from sales where no_struk='J03.FAILRACE'));select finalize_pos_sale((select id from sales where no_struk='J03.FAILRACE'));commit;"
   db.sql(fees.split('set local role authenticated;')[0]+fixture.replace('rollback;',seed));race_checks(db)
  print('PASS refund_payout.sql',flush=True)
