#!/usr/bin/env python3
"""Test only fictional openings in an owned disposable localhost database."""
from pathlib import Path
import importlib.util
import os
import subprocess
import time
ROOT=Path(__file__).resolve().parents[1]
ENV={k:v for k,v in os.environ.items() if not k.startswith('PG')}
ENV['PGOPTIONS']='-c client_min_messages=warning -c TimeZone=UTC'
LOCAL=['-h127.0.0.1','-p5432']

def concurrency(source):
 import json
 def literal(value):return "'"+value.replace("'","''")+"'"
 actor='fab10000-0000-4000-8000-000000000001'
 account='fab20000-0000-4000-8000-000000000001'
 auth=f"set role authenticated;set request.jwt.claim.sub='{actor}';set request.jwt.claim.role='authenticated';"
 source.sql("""insert into auth.users(id,raw_user_meta_data) values('fab10000-0000-4000-8000-000000000001','{}'),('fab10000-0000-4000-8000-000000000002','{}');
 alter table profiles disable trigger guard_profile_privileges;
 update profiles set role='OWNER',is_active=true where id in('fab10000-0000-4000-8000-000000000001','fab10000-0000-4000-8000-000000000002');
 alter table profiles enable trigger guard_profile_privileges;
 insert into coa_accounts(code,name,type,normal_balance) values('410001','Equity','EKUITAS','K'),('119701','Race bank','ASET','D'),('139701','Race noncash','ASET','D') on conflict(code) do nothing;
 insert into cash_accounts(id,nama,jenis,coa_code,created_at) values('fab20000-0000-4000-8000-000000000001','Race bank','Bank','119701',now()-interval '10 days');
 insert into journal_entries(id,no_jurnal,tanggal,source,source_ref) values('fab30000-0000-4000-8000-000000000001','RACE.OPEN',current_date-10,'cash-account-opening','119701');
 insert into journal_lines(entry_id,account_id,debit,credit)
 select 'fab30000-0000-4000-8000-000000000001'::uuid,id,500,0 from coa_accounts where code='119701'
 union all select 'fab30000-0000-4000-8000-000000000001',id,0,500 from coa_accounts where code='410001';
 update accounting_locks set closed_until=null where id;
 """)
 active=[]
 def start(statement):
  p=subprocess.Popen(source.PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
  active.append(p);p.stdin.write(statement);p.stdin.close();return p
 def finish(p,error=None):
  p.wait(timeout=15);out,err=p.stdout.read(),p.stderr.read()
  if error is not None:
   assert p.returncode and error in err,(out,err,error)
   return err
  if p.returncode:raise RuntimeError(err)
  return out.strip()
 def barrier(marker,kind='Lock'):
  for _ in range(400):
   predicate="wait_event='PgSleep'" if kind=='sleep' else "wait_event_type='Lock'"
   if source.sql(f"select exists(select 1 from pg_stat_activity where datname=current_database() and {predicate} and query like '%{marker}%');").stdout.strip()=='t':return
   time.sleep(.01)
  raise AssertionError('Missing concurrency barrier '+marker)
 def preview(amount,reason='Race correction'):
  return source.sql(auth+f"select preview_monetary_opening('{account}',{amount},{literal(reason)});").stdout.strip()
 def correction(key,amount,evidence,reason='Race correction'):
  return f"select correct_monetary_opening('{account}',{amount},{literal(reason)},{literal(evidence)}::jsonb,{literal(key)});"
 def count():return int(source.sql('select count(*) from monetary_opening_corrections;').stdout.strip())
 def balance():return source.sql("select sum(debit-credit) from journal_lines l join coa_accounts a on a.id=l.account_id where code='119701';").stdout.strip()
 try:
  evidence=preview(400);call=correction('same-submit',400,evidence)
  first=start(auth+'begin;'+call+"select pg_sleep(1) /* monetary-duplicate-holder */;commit;")
  barrier('monetary-duplicate-holder','sleep')
  retry=start(auth+'/* monetary-duplicate-waiter */'+call)
  recover=start(auth+f"select /* monetary-recovery-waiter */ get_monetary_opening_result('{account}','same-submit');")
  barrier('monetary-duplicate-waiter');barrier('monetary-recovery-waiter')
  winner=json.loads(finish(first).splitlines()[0]);assert json.loads(finish(retry))==winner and json.loads(finish(recover))==winner
  assert count()==1 and float(balance())==400
  # Distinct requests from the same revision cannot both post.
  a=preview(300);b=preview(200)
  first=start(auth+'begin;'+correction('winner',300,a)+"select pg_sleep(1) /* monetary-revision-holder */;commit;")
  barrier('monetary-revision-holder','sleep')
  second=start(auth+'/* monetary-revision-waiter */'+correction('loser',200,b));barrier('monetary-revision-waiter')
  finish(first);finish(second,'Preview');assert count()==2 and float(balance())==300
  # A completed ledger writer invalidates the reviewed running balance.
  evidence=preview(250)
  first=start("""begin;insert into journal_entries(id,no_jurnal,tanggal,source) values('fab30000-0000-4000-8000-000000000002','RACE.LATER',current_date,'fixture');
 insert into journal_lines(entry_id,account_id,debit,credit) select 'fab30000-0000-4000-8000-000000000002'::uuid,id,10,0 from coa_accounts where code='119701' union all select 'fab30000-0000-4000-8000-000000000002',id,0,10 from coa_accounts where code='139701';
 select pg_sleep(1) /* monetary-ledger-holder */;commit;""")
  barrier('monetary-ledger-holder','sleep')
  second=start(auth+'/* monetary-ledger-waiter */'+correction('ledger-stale',250,evidence));barrier('monetary-ledger-waiter')
  finish(first);finish(second,'Preview');assert count()==2 and float(balance())==310
  # A real reconciliation winning the ledger lock must block correction.
  evidence=preview(250)
  header=json.dumps(dict(account_id=account,tanggal=source.sql("select (now() at time zone 'Asia/Jakarta')::date;").stdout.strip(),saldo_bank=310,biaya_adm=0,bunga=0))
  create=f"select mutate_bank_reconciliation('monetary-recon-first','create',null,null,{literal(header)}::jsonb,null);"
  first=start(auth+'begin;'+create+"select pg_sleep(1) /* monetary-recon-holder */;commit;")
  barrier('monetary-recon-holder','sleep')
  second=start(auth+'/* monetary-recon-waiter */'+correction('recon-blocked',250,evidence));barrier('monetary-recon-waiter')
  rec=json.loads(finish(first).splitlines()[0]);finish(second,'Rekonsiliasi');assert count()==2
  source.sql(auth+f"select mutate_bank_reconciliation('monetary-recon-void','void','{rec['reconciliation_id']}',0,'{{}}','Reopen for correction');")
  # In the other ordering reconciliation captures the corrected balance.
  evidence=preview(200)
  first=start(auth+'begin;'+correction('before-recon',200,evidence)+"select pg_sleep(1) /* monetary-before-recon-holder */;commit;")
  barrier('monetary-before-recon-holder','sleep')
  second=start(auth+'/* monetary-after-correction-waiter */'+create.replace('monetary-recon-first','monetary-recon-after'))
  barrier('monetary-after-correction-waiter');finish(first);rec=json.loads(finish(second))
  observed=source.sql(f"select saldo_buku from bank_reconciliations where id='{rec['reconciliation_id']}';").stdout.strip()
  assert float(observed)==210 and count()==3,(observed,count())
  source.sql(auth+f"select mutate_bank_reconciliation('monetary-recon-after-void','void','{rec['reconciliation_id']}',0,'{{}}','Reopen for tests');")
  # A closing-period transaction is checked after its row lock resolves.
  evidence=preview(150)
  first=start("begin;update accounting_locks set closed_until=current_date where id;select pg_sleep(1) /* monetary-period-holder */;commit;")
  barrier('monetary-period-holder','sleep')
  second=start(auth+'/* monetary-period-waiter */'+correction('closed-period',150,evidence));barrier('monetary-period-waiter')
  finish(first);finish(second,'ditutup');source.sql('update accounting_locks set closed_until=null where id;');assert count()==3
  # The access check re-reads an account or actor changed before the lock is granted.
  for target,update,restore,error in [
   ('account',f"update cash_accounts set is_active=false where id='{account}'",f"update cash_accounts set is_active=true where id='{account}'",'Rekening'),
   ('actor',f"update profiles set is_active=false where id='{actor}'",f"update profiles set is_active=true where id='{actor}'",'Owner aktif')]:
   fixture_actor="set request.jwt.claim.sub='fab10000-0000-4000-8000-000000000002';" if target=='actor' else ''
   first=start(fixture_actor+'begin;'+update+f";select pg_sleep(1) /* monetary-{target}-holder */;commit;")
   barrier(f'monetary-{target}-holder','sleep')
   second=start(auth+f'/* monetary-{target}-waiter */'+correction(f'inactive-{target}',150,evidence));barrier(f'monetary-{target}-waiter')
   finish(first);finish(second,error);source.sql(fixture_actor+restore);assert count()==3
  assert source.sql("select count(*) from monetary_opening_requests where request_key in('loser','ledger-stale','recon-blocked','closed-period','inactive-account','inactive-actor');").stdout.strip()=='0'
  print('PASS real concurrent duplicate/recovery, competing revisions, ledger change, both reconciliation orderings, period closure and current account/actor authorization')
 finally:
  for p in active:
   if p.poll() is None:p.kill();p.wait()

def main():
 spec=importlib.util.spec_from_file_location('opening_bootstrap',ROOT/'scripts/test-posted-sales-postgres.py')
 source=importlib.util.module_from_spec(spec);spec.loader.exec_module(source)
 source.DB=f'vetos_monetary_opening_{os.getpid()}_{time.time_ns()}'
 source.ENV=ENV;source.PSQL=['psql','-X','-q','-At',*LOCAL,'-d',source.DB,'-v','ON_ERROR_STOP=1']
 created=False
 try:
  subprocess.run(['createdb',*LOCAL,source.DB],env=ENV,check=True,capture_output=True);created=True
  source.bootstrap_database()
  source.sql((ROOT/'supabase/tests/monetary_opening_corrections.sql').read_text())
  source.sql((ROOT/'supabase/tests/monetary_opening_creation.sql').read_text())
  concurrency(source)
  print('PASS monetary opening lifecycle, ledger/journals, audit, permission, retry, zero/repeated correction, rollback and downstream guards')
 finally:
  if created:subprocess.run(['dropdb',*LOCAL,'--if-exists',source.DB],env=ENV,check=True,capture_output=True)
if __name__=='__main__':main()
