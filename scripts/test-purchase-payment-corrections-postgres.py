#!/usr/bin/env python3
"""Execute payment posting/cancellation tests only in an owned disposable localhost DB."""
from pathlib import Path
from decimal import Decimal
import importlib.util
import os
import re
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]
DB=f'vetos_payment_corrections_{os.getpid()}_{time.time_ns()}'
ENV={key:value for key,value in os.environ.items() if not key.startswith('PG')}
ENV['PGOPTIONS']='-c client_min_messages=warning -c TimeZone=UTC'
LOCAL=['-h127.0.0.1','-p5432']
PSQL=['psql','-X','-q','-At',*LOCAL,'-v','ON_ERROR_STOP=1','-d',DB]

def sql(source):
    r=subprocess.run(PSQL,input=source,text=True,capture_output=True,env=ENV)
    if r.returncode: raise RuntimeError(r.stderr[-6000:])
    return r.stdout

AUTH = """set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-000000000001',false);
"""

def concurrency_tests():
    active=[]
    def start(source):
        p=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
        active.append(p);p.stdin.write(AUTH+source);p.stdin.close();return p
    def wait(predicate):
        for _ in range(500):
            if sql('select exists(select 1 from pg_stat_activity where datname=current_database() and ('+predicate+'));').strip()=='t': return
            time.sleep(.01)
        raise RuntimeError('Missing concurrency barrier: '+predicate)
    def finish(p, error=None):
        p.wait(timeout=10);out,err=p.stdout.read(),p.stderr.read()
        if error is not None:
            if p.returncode == 0 or error not in err: raise RuntimeError(out+err)
        elif p.returncode: raise RuntimeError(out+err)
    def cancel(name,key):
        return f"select cancel_purchase_payment((select (result->>'payment_id')::uuid from payment_test_results where name='{name}'),0,'{key}','Concurrent correction');"
    def pay(key,amount):
        return f"select pay_purchase_invoice_atomic('{key}',(select (result->>'invoice_id')::uuid from payment_test_results where name='invoice'),current_date,{amount},'Transfer',null,'ed700000-0000-4000-8000-000000000001',null);"
    try:
        # Source account change wins first; the waiting cancellation must reread it after its row lock.
        first=start("reset role;begin;update cash_accounts set is_active=false where id='ed700000-0000-4000-8000-000000000001';select pg_sleep(1) /* payment-account-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%payment-account-holder%'")
        second=start('/* payment-account-waiter */'+cancel('partial','race-inactive-account'))
        wait("wait_event_type='Lock' and query like '%payment-account-waiter%'")
        finish(first);finish(second,'Rekening pembayaran tidak aktif')
        assert sql("select count(*) from purchase_payment_cancellation_requests where request_key='race-inactive-account';").strip()=='0'
        assert sql("select count(*) from purchase_invoice_payments where reversal_of=(select (result->>'payment_id')::uuid from payment_test_results where name='partial');").strip()=='0'
        sql("update cash_accounts set is_active=true where id='ed700000-0000-4000-8000-000000000001';")
        first=start('begin;'+cancel('partial','race-duplicate')+"select pg_sleep(1) /* payment-cancel-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%payment-cancel-holder%'")
        second=start('/* payment-cancel-waiter */'+cancel('partial','race-duplicate'))
        wait("wait_event_type='Lock' and query like '%payment-cancel-waiter%'")
        finish(first);finish(second)
        assert sql("select count(*) from purchase_payment_cancellations where payment_id=(select (result->>'payment_id')::uuid from payment_test_results where name='partial');").strip()=='1'
        # A fresh payment serializes with cancellation and recalculates available debt.
        before=sql("select sum(amount) from purchase_invoice_payments where invoice_id=(select (result->>'invoice_id')::uuid from payment_test_results where name='invoice');").strip()
        first=start('begin;'+cancel('replacement','race-cancel-before-pay')+"select pg_sleep(1) /* payment-before-new-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%payment-before-new-holder%'")
        second=start('/* payment-new-waiter */'+pay('race-new-payment',50))
        wait("wait_event_type='Lock' and query like '%payment-new-waiter%'")
        finish(first);finish(second)
        after=sql("select sum(amount) from purchase_invoice_payments where invoice_id=(select (result->>'invoice_id')::uuid from payment_test_results where name='invoice');").strip()
        assert float(after)==float(before)-100+50
        sql(AUTH+"insert into payment_test_results select 'race-payment',pay_purchase_invoice_atomic('race-payment',(result->>'invoice_id')::uuid,current_date,50,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null) from payment_test_results where name='invoice';")
        first=start('begin;'+pay('race-payment-before-cancel',10)+"select pg_sleep(1) /* payment-new-first-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%payment-new-first-holder%'")
        second=start('/* payment-cancel-second */'+cancel('race-payment','race-pay-before-cancel'))
        wait("wait_event_type='Lock' and query like '%payment-cancel-second%'")
        finish(first);finish(second)
        after2=sql("select sum(amount) from purchase_invoice_payments where invoice_id=(select (result->>'invoice_id')::uuid from payment_test_results where name='invoice');").strip()
        assert float(after2)==float(after)+10
        print('Concurrent source-account deactivation, identical cancellations and both payment/cancel lock orderings passed.',flush=True)
        # Different invoices share a supplier-wide advance (no PO). Gate before journal writes
        # to reproduce the former advance -> ledger / ledger -> advance lock inversion.
        sql("""insert into purchase_invoices(id,no_faktur,supplier_id,branch_id,warehouse_id,tanggal,jatuh_tempo,total) values
          ('eda00000-0000-4000-8000-000000000010','FB.SHARED.A','ed300000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001',current_date,current_date,1000),
          ('eda00000-0000-4000-8000-000000000011','FB.SHARED.B','ed300000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001',current_date,current_date,1000);
          insert into purchase_advances(id,no_um,supplier_id,po_id,jumlah,account_id) values('ed800000-0000-4000-8000-000000000010','UM.SHARED','ed300000-0000-4000-8000-000000000001',null,1000,'ed700000-0000-4000-8000-000000000001');""")
        def shared_pay(key,invoice,amount):
            return f"select pay_purchase_invoice_atomic('{key}','eda00000-0000-4000-8000-0000000000{invoice}',(now() at time zone 'Asia/Jakarta')::date,{amount},'Transfer',null,'ed700000-0000-4000-8000-000000000001','ed800000-0000-4000-8000-000000000010');"
        def shared_seed(key):
            sql(AUTH+shared_pay(key,'10',100).replace('select pay_purchase_invoice_atomic',f"insert into payment_test_results select '{key}',pay_purchase_invoice_atomic"))
        def number_gate(marker):
            return start("reset role;begin;select pg_advisory_xact_lock(hashtextextended('clinic-journal-number:JRN-'||to_char((now() at time zone 'Asia/Jakarta')::date,'YYYYMM')||'-',0));select pg_advisory_xact_lock(hashtext('vetos:journal:JRN-'||to_char((now() at time zone 'Asia/Jakarta')::date,'YYYYMM')||'-')::bigint);select pg_sleep(2) /* "+marker+" */;commit;")
        def assert_shared(expected):
            assert Decimal(sql("select terpakai from purchase_advances where id='ed800000-0000-4000-8000-000000000010';").strip())==expected
            assert Decimal(sql("select sum(dari_uang_muka) from purchase_invoice_payments where advance_id='ed800000-0000-4000-8000-000000000010';").strip())==expected
            assert Decimal(sql("select coalesce(sum(amount),0) from purchase_invoice_payments where invoice_id='eda00000-0000-4000-8000-000000000010';").strip())==0
            assert Decimal(sql("select coalesce(sum(amount),0) from purchase_invoice_payments where invoice_id='eda00000-0000-4000-8000-000000000011';").strip())==expected
        shared_seed('shared-a-first')
        gate=number_gate('shared-pay-number-gate')
        wait("wait_event='PgSleep' and query like '%shared-pay-number-gate%'")
        first=start('/* shared-pay-first */'+shared_pay('shared-b-first','11',150))
        wait("wait_event='advisory' and query like '%shared-pay-first%'")
        second=start('/* shared-cancel-waiter */'+cancel('shared-a-first','shared-cancel-first'))
        wait("wait_event_type='Lock' and query like '%shared-cancel-waiter%'")
        finish(gate);finish(first);finish(second);assert_shared(150)
        shared_seed('shared-a-second')
        gate=number_gate('shared-cancel-number-gate')
        wait("wait_event='PgSleep' and query like '%shared-cancel-number-gate%'")
        first=start('/* shared-cancel-first */'+cancel('shared-a-second','shared-cancel-second'))
        wait("wait_event='advisory' and query like '%shared-cancel-first%'")
        second=start('/* shared-pay-waiter */'+shared_pay('shared-b-second','11',60))
        wait("wait_event_type='Lock' and query like '%shared-pay-waiter%'")
        finish(gate);finish(first);finish(second);assert_shared(210)
        assert sql("select count(*) from purchase_payment_requests where request_key in('shared-a-first','shared-a-second','shared-b-first','shared-b-second');").strip()=='4'
        assert sql("select count(*) from purchase_payment_cancellation_requests where request_key in('shared-cancel-first','shared-cancel-second');").strip()=='2'
        print('Different-invoice supplier-wide advance races passed in both lock orderings.',flush=True)
    finally:
        for p in active:
            if p.poll() is None: p.kill();p.wait()

def main():
    subprocess.run(['createdb',*LOCAL,DB],env=ENV,check=True,capture_output=True)
    try:
        spec=importlib.util.spec_from_file_location('payment_bootstrap',ROOT/'scripts/test-posted-sales-postgres.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        module.DB=DB;module.PSQL=PSQL;module.ENV=ENV
        module.bootstrap_database()
        source=ROOT/'supabase/tests/purchase_payment_corrections.sql'
        sql(module.fixture_owner_updates(source.read_text()))
        baseline=(ROOT/'supabase/tests/online_return_unit_posting.sql').read_text().split('do $$ declare r jsonb; retry jsonb; header')[0]
        baseline += "select post_unit_return('purchase','f6000000-0000-4000-8000-000000000010','payment-fixture-return',jsonb_build_object('tanggal',current_date),'[{\"item_id\":\"f5000000-0000-4000-8000-000000000001\",\"source_line_id\":\"f7000000-0000-4000-8000-000000000010\",\"qty\":0.5,\"satuan\":\"box\"}]');reset role;commit;"
        baseline=re.sub(r'\{"sub":"[^"\n]+","role":"authenticated"\}', '{"role":"authenticated"}', baseline)
        sql(module.fixture_owner_updates(baseline))
        sql(module.fixture_owner_updates(re.sub(r'\{"sub":"[^"\n]+","role":"authenticated"\}', '{"role":"authenticated"}', (ROOT/'supabase/tests/purchase_payment_atomic.sql').read_text())))
        print('Existing atomic payment regression suite also passed.',flush=True)
        concurrency_tests()
        print('Purchase payment corrections: all isolated PostgreSQL checks passed.',flush=True)
    finally:
        subprocess.run(['dropdb',*LOCAL,'--if-exists',DB],env=ENV,check=True,capture_output=True)
if __name__=='__main__': main()
