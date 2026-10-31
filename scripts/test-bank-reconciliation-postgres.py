#!/usr/bin/env python3
"""Run reconciliation production functions against fictional localhost fixtures."""
from pathlib import Path
import importlib.util
import os
import json
from decimal import Decimal
import subprocess
import time
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def concurrency(source):
 auth="set role authenticated;set request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';set request.jwt.claims='{\"role\":\"authenticated\"}';"
 source.sql("insert into coa_accounts(code,name,type,normal_balance,is_header) values('740010','Fictional bank fee','BEBAN','D',false),('810001','Fictional interest','PENDAPATAN','K',false) on conflict(code) do update set is_active=true,is_header=false;")
 day=source.sql("select (now() at time zone 'Asia/Jakarta')::date;").stdout.strip()
 header=json.dumps(dict(account_id='e6600000-0000-4000-8000-000000000002',tanggal=day,saldo_bank=0,biaya_adm=10,bunga=2))
 create=f"select public.mutate_bank_reconciliation('race-reconciliation','create',null,null,'{header}'::jsonb,null);"
 def start(statement):
  process=subprocess.Popen(source.PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=source.ENV)
  process.stdin.write(statement);process.stdin.close();return process
 def finish(process,success=True):
  process.wait(timeout=15);out,err=process.stdout.read(),process.stderr.read()
  if (process.returncode==0)!=success:raise RuntimeError(err)
  return out.strip() if success else err
 def barrier(predicate):
  for _ in range(300):
   if source.sql('select exists(select 1 from pg_stat_activity where datname=current_database() and ('+predicate+'));').stdout.strip()=='t':return
   time.sleep(.01)
  raise AssertionError('Missing lock barrier')
 winner=start(auth+'begin;'+create+'select pg_sleep(1) /* reconciliation-holder */;commit;')
 barrier("wait_event='PgSleep' and query like '%reconciliation-holder%'")
 retry=start(auth+create.replace('select public','select /* reconciliation-retry */ public'))
 recovery=start(auth+"select /* reconciliation-recovery */ public.get_bank_reconciliation_result('race-reconciliation');")
 barrier("wait_event_type='Lock' and query like '%reconciliation-retry%'")
 barrier("wait_event_type='Lock' and query like '%reconciliation-recovery%'")
 result=json.loads(finish(winner).splitlines()[0]);assert json.loads(finish(retry))==result and json.loads(finish(recovery))==result
 assert source.sql("select count(*) from bank_reconciliation_requests where request_key='race-reconciliation';").stdout.strip()=='1'
 void=f"select public.mutate_bank_reconciliation('race-void','void','{result['reconciliation_id']}',0,'{{}}','Concurrent void');"
 winner=start(auth+'begin;'+void+'select pg_sleep(1) /* reconciliation-void-holder */;commit;')
 barrier("wait_event='PgSleep' and query like '%reconciliation-void-holder%'")
 retry=start(auth+void.replace('select public','select /* reconciliation-void-retry */ public'))
 barrier("wait_event_type='Lock' and query like '%reconciliation-void-retry%'")
 assert json.loads(finish(winner).splitlines()[0])==json.loads(finish(retry))
 assert source.sql('select count(*) from bank_reconciliation_revisions;').stdout.strip()=='1'
 # A concurrent ledger writer must finish before the book snapshot is captured.
 writer=start("begin;insert into journal_entries(id,no_jurnal,tanggal,deskripsi,source) values('efa30000-0000-4000-8000-000000000001','RACE.BANK.WRITER','"+day+"','Fictional concurrent journal','fixture');insert into journal_lines(entry_id,account_id,debit,credit) select 'efa30000-0000-4000-8000-000000000001',id,777,0 from coa_accounts where code='1112';insert into journal_lines(entry_id,account_id,debit,credit) select 'efa30000-0000-4000-8000-000000000001',id,0,777 from coa_accounts where code='510001';select pg_sleep(1) /* bank-ledger-holder */;commit;")
 barrier("wait_event='PgSleep' and query like '%bank-ledger-holder%'")
 baseline=Decimal(source.sql("select coalesce(sum(l.debit-l.credit),0) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where a.code='1112' and e.tanggal<='"+day+"';").stdout.strip())
 waiter=start(auth+create.replace('race-reconciliation','race-after-ledger').replace('select public','select /* bank-ledger-waiter */ public'))
 barrier("wait_event_type='Lock' and query like '%bank-ledger-waiter%'")
 finish(writer);row=json.loads(finish(waiter))
 observed=Decimal(source.sql(f"select saldo_buku from bank_reconciliations where id='{row['reconciliation_id']}';").stdout.strip())
 assert observed==baseline+777,(observed,baseline)
 newer=create.replace('race-reconciliation','race-newer-before-void')
 holder=start(auth+'begin;'+newer+'select pg_sleep(1) /* bank-newer-holder */;commit;')
 barrier("wait_event='PgSleep' and query like '%bank-newer-holder%'")
 waiter=start(auth+f"select /* bank-newer-void-waiter */ public.mutate_bank_reconciliation('race-out-of-order','void','{row['reconciliation_id']}',0,'{{}}','Out of order correction');")
 barrier("wait_event_type='Lock' and query like '%bank-newer-void-waiter%'")
 finish(holder);assert 'lebih baru' in finish(waiter,False)
 assert source.sql(f"select voided_at is null from bank_reconciliations where id='{row['reconciliation_id']}';").stdout.strip()=='t'
 assert source.sql("select count(*) from bank_reconciliation_requests where request_key='race-out-of-order';").stdout.strip()=='0'
 source.sql("update cash_accounts set branch_id='e2200000-0000-4000-8000-000000000001' where id='e6600000-0000-4000-8000-000000000002';")
 holder=start('begin;lock table public.journal_entries,public.journal_lines in share row exclusive mode;select pg_sleep(1) /* bank-branch-holder */;commit;')
 barrier("wait_event='PgSleep' and query like '%bank-branch-holder%'")
 waiter=start(auth+create.replace('race-reconciliation','race-inactive-branch').replace('select public','select /* bank-branch-waiter */ public'))
 barrier("wait_event_type='Lock' and query like '%bank-branch-waiter%'")
 source.sql("update branches set is_active=false where id='e2200000-0000-4000-8000-000000000001';")
 finish(holder);assert 'Cabang rekening' in finish(waiter,False)
 assert source.sql("select count(*) from bank_reconciliation_requests where request_key='race-inactive-branch';").stdout.strip()=='0'
 source.sql("update branches set is_active=true where id='e2200000-0000-4000-8000-000000000001';update cash_accounts set branch_id=null where id='e6600000-0000-4000-8000-000000000002';")
 source.sql("alter table profiles disable trigger guard_profile_privileges;update profiles set role='FINANCE' where id='e1100000-0000-4000-8000-000000000002';alter table profiles enable trigger guard_profile_privileges;")
 holder=start('begin;lock table public.journal_entries,public.journal_lines in share row exclusive mode;select pg_sleep(1) /* bank-permission-holder */;commit;')
 barrier("wait_event='PgSleep' and query like '%bank-permission-holder%'")
 finance=auth.replace('e1100000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000002')
 waiter=start(finance+create.replace('race-reconciliation','race-revoked-module').replace('select public','select /* bank-permission-waiter */ public'))
 barrier("wait_event_type='Lock' and query like '%bank-permission-waiter%'")
 source.sql("insert into role_modules(role,module_id) values('FINANCE','dashboard');")
 finish(holder);assert 'Kas & Bank' in finish(waiter,False)
 assert source.sql("select count(*) from bank_reconciliation_requests where request_key='race-revoked-module';").stdout.strip()=='0'
 source.sql("delete from role_modules where role='FINANCE';update cash_accounts set branch_id='e2200000-0000-4000-8000-000000000001' where id='e6600000-0000-4000-8000-000000000002';")
 financial_before=source.sql('select jsonb_build_array((select count(*) from bank_reconciliations),(select count(*) from journal_entries));').stdout.strip()
 holder=start("begin;select id from branches where id='e2200000-0000-4000-8000-000000000001' for update;select pg_sleep(1) /* bank-branch-permission-holder */;commit;")
 barrier("wait_event='PgSleep' and query like '%bank-branch-permission-holder%'")
 waiter=start(finance+create.replace('race-reconciliation','race-branch-revoked-module').replace('select public','select /* bank-branch-permission-waiter */ public'))
 barrier("wait_event_type='Lock' and query like '%bank-branch-permission-waiter%'")
 source.sql("insert into role_modules(role,module_id) values('FINANCE','dashboard');")
 finish(holder);assert 'Kas & Bank' in finish(waiter,False)
 assert source.sql("select count(*) from bank_reconciliation_requests where request_key='race-branch-revoked-module';").stdout.strip()=='0'
 assert source.sql('select jsonb_build_array((select count(*) from bank_reconciliations),(select count(*) from journal_entries));').stdout.strip()==financial_before
 print('PASS real concurrent create/recovery/void retries and ledger-writer snapshot locking and permission revocation while waiting')

def main():
 restore=load('payment_environment',ROOT/'scripts/test-purchase-payment-corrections-postgres.py')
 source=load('reconciliation_source',ROOT/'scripts/test-posted-sales-postgres.py')
 source.DB=f'vetos_bank_rec_{os.getpid()}_{time.time_ns()}';source.ENV=restore.ENV
 source.PSQL=['psql','-X','-q','-At',*restore.LOCAL,'-d',source.DB,'-v','ON_ERROR_STOP=1']
 created=False
 try:
  subprocess.run(['createdb',*restore.LOCAL,source.DB],check=True,capture_output=True,env=restore.ENV);created=True
  source.bootstrap_database()
  fixture=(ROOT/'supabase/tests/pos_merchant_fees.sql').read_text().rstrip();assert fixture.endswith('rollback;')
  source.sql(source.fixture_owner_updates(fixture[:-len('rollback;')]+'commit;'))
  source.sql("alter table profiles disable trigger guard_profile_privileges;update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';alter table profiles enable trigger guard_profile_privileges;")
  source.sql((ROOT/'supabase/tests/bank_reconciliation_lifecycle.sql').read_text())
  concurrency(source)
  print('PASS actual bank reconciliation snapshot, cents, rollback, create/edit/void/retry/recovery, immutable journals, role/module/scope/legacy/dependency guards')
 finally:
  if created:subprocess.run(['dropdb',*restore.LOCAL,'--if-exists',source.DB],check=True,capture_output=True,env=restore.ENV)
if __name__=='__main__':main()
