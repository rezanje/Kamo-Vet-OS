#!/usr/bin/env python3
"""B2B tests against one owned disposable Docker PG16. No database URL accepted."""
from pathlib import Path
import importlib.util
import json
import subprocess
import time
import uuid
import sys
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'kamo-wholesale-test-' + uuid.uuid4().hex[:10]
PSQL = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
AUTH = "set role authenticated;select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',false);"

def sql(source):
    result = subprocess.run(PSQL, input=source, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-9000:])
    return result

def main():
    subprocess.run(['docker','run','-d','--network','none','--name',CONTAINER,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16'], check=True, capture_output=True)
    try:
        for _ in range(200):
            if subprocess.run(['docker','exec',CONTAINER,'pg_isready','-U','postgres'],capture_output=True).returncode == 0:
                # pg_isready may see the temporary bootstrap server; TCP checks final startup.
                if subprocess.run(['docker','exec',CONTAINER,'pg_isready','-h127.0.0.1','-U','postgres'],capture_output=True).returncode == 0:
                    break
            time.sleep(.1)
        spec = importlib.util.spec_from_file_location('bootstrap', ROOT/'scripts/test-posted-sales-postgres.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.sql = sql
        module.bootstrap_database()
        sql(module.fixture_owner_updates((ROOT/'supabase/tests/sales_safe_posting.sql').read_text()))
        print('Existing sales posting SQL regression suite passed.', flush=True)
        fixture = (ROOT/'supabase/tests/sales_safe_posting.sql').read_text().split('insert into sales_quotations')[0]
        fixture = module.fixture_owner_updates(fixture)
        sql(fixture + "\nupdate profiles set role='OWNER' where id='f1000000-0000-4000-8000-000000000001';commit;")
        sql((ROOT/'supabase/tests/wholesale_corrections.sql').read_text())
        print('Wholesale SQL acceptance suite passed.', flush=True)
        concurrency_tests()
    finally:
        subprocess.run(['docker','rm','-f',CONTAINER],check=True,capture_output=True)

def concurrency_tests():
    jobs = []
    def wait(predicate):
        for _ in range(200):
            if sql("select exists(select 1 from pg_stat_activity where datname=current_database() and (" + predicate + "));" ).stdout.strip() == 't':
                return
            time.sleep(.025)
        raise RuntimeError('Missing two-session lock barrier: ' + predicate)
    def start(source):
        proc = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        jobs.append(proc)
        proc.stdin.write(AUTH + source)
        proc.stdin.close()
        return proc
    def finish(proc, rejected=None):
        proc.wait(timeout=20)
        out, err = proc.stdout.read(), proc.stderr.read()
        if rejected:
            assert proc.returncode != 0 and rejected in err, out + err
        elif proc.returncode:
            raise RuntimeError(out + err)
        return [json.loads(line) for line in out.splitlines() if line.startswith('{')]
    def race(first_call, second_call, rejected=None):
        first = start('begin;' + first_call + "select pg_sleep(1) /* b2b-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%b2b-holder%'")
        second = start('/* b2b-waiter */' + second_call)
        wait("wait_event_type='Lock' and query like '%b2b-waiter%'")
        a, b = finish(first), finish(second, rejected)
        return a, b
    def current():
        return json.loads(sql("select jsonb_build_object('invoice',si.id,'revision',si.revision,'line',ii.id) from sales_invoices si join sales_invoice_items ii on ii.invoice_id=si.id where si.status<>'batal';").stdout.strip())
    def correction(doc, key):
        return f"select correct_wholesale_invoice('{doc['invoice']}',{doc['revision']},'{key}','replace','Race price correction',jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+30,'items',jsonb_build_array(jsonb_build_object('id','{doc['line']}','harga',90))));"
    def receipt(doc, key, amount):
        return f"select receive_wholesale_payment('{key}','{doc['invoice']}',current_date,{amount},'Transfer',null,null,null);"
    try:
        doc = current()
        a, b = race(correction(doc,'concurrent-correction'), correction(doc,'concurrent-correction'))
        assert a == b and len(a) == 1
        assert sql("select count(*) from wholesale_operation_requests where request_key='concurrent-correction';").stdout.strip() == '1'
        doc = current()
        race(receipt(doc,'payment-wins',10), correction(doc,'stale-after-payment'), 'sudah berubah')
        doc = current()
        race(correction(doc,'correction-wins'), receipt(doc,'late-old-invoice',10), 'dibatalkan')
        doc = current()
        a, b = race(receipt(doc,'concurrent-receipt',20), receipt(doc,'concurrent-receipt',20))
        assert a == b and len(a) == 1
        remaining = sql("select total-carried_paid-(select coalesce(sum(jumlah),0) from sales_receipts where invoice_id=si.id) from sales_invoices si where id='" + doc['invoice'] + "';").stdout.strip()
        race(receipt(doc,'last-balance-a',remaining), receipt(doc,'last-balance-b',remaining), 'melebihi sisa')
        assert sql("select status='lunas' and total=carried_paid+(select sum(jumlah) from sales_receipts where invoice_id=si.id) from sales_invoices si where id='" + doc['invoice'] + "';").stdout.strip() == 't'
        assert sql("select sum(qty) from stock where item_id='f5000000-0000-4000-8000-000000000001';").stdout.strip() == '17'
        print('Two-session correction retry, receipt retry, competing final payments, and both payment/correction orderings passed.', flush=True)
        doc = current()
        period = sql("select to_char(current_date,'YYYY-MM');").stdout.strip()
        old_epoch = sql(AUTH + "select get_wholesale_payroll_epoch('" + period + "');").stdout.splitlines()[-1]
        def payroll(epoch):
            return "insert into payrolls(employee_id,periode,wholesale_source_epoch,komisi) values('fb000000-0000-4000-8000-000000000001','" + period + "'," + str(epoch) + ",999);"
        race(correction(doc,'epoch-correction-first'), payroll(old_epoch), 'Sumber komisi grosir berubah')
        new_epoch = sql(AUTH + "select get_wholesale_payroll_epoch('" + period + "');").stdout.splitlines()[-1]
        assert int(new_epoch) == int(old_epoch) + 1, 'Same-period correction must increment the epoch only once'
        doc = current()
        race(payroll(new_epoch), correction(doc,'epoch-payroll-first'), 'Penggajian sudah memakai')
        assert sql(AUTH + "select get_wholesale_payroll_epoch('" + period + "');").stdout.splitlines()[-1] == new_epoch
        sql("delete from payrolls where employee_id='fb000000-0000-4000-8000-000000000001';")
        # A separate service invoice proves cross-period fencing without touching physical stock.
        sql("""insert into sales_orders(id,no_pesanan,customer_id,branch_id) values('fb200000-0000-4000-8000-000000000001','SO.B2B.PERIOD','f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001');
        insert into sales_order_items(id,order_id,item_id,nama,satuan,faktor,qty,harga) values('fb300000-0000-4000-8000-000000000001','fb200000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000002','Period service','unit',1,1,100);
        """)
        old_date = "date_trunc('month',current_date)::date-1"
        # Build JSON in SQL to keep the request literal independent of Python quoting.
        service_items = "jsonb_build_array(jsonb_build_object('order_item_id','fb300000-0000-4000-8000-000000000001','qty',1))"
        sql(AUTH + "select sales_create_delivery('fb200000-0000-4000-8000-000000000001','period-delivery',jsonb_build_object('tanggal'," + old_date + ")," + service_items + ");")
        sql(AUTH + "select sales_create_invoice('fb200000-0000-4000-8000-000000000001','period-invoice',jsonb_build_object('tanggal'," + old_date + ",'jatuh_tempo',current_date+30)," + service_items + ");")
        service_doc = json.loads(sql("select jsonb_build_object('invoice',si.id,'revision',si.revision,'line',ii.id) from sales_invoices si join sales_invoice_items ii on ii.invoice_id=si.id where si.order_id='fb200000-0000-4000-8000-000000000001';").stdout.strip())
        prior_period = sql("select to_char(" + old_date + ",'YYYY-MM');").stdout.strip()
        before = {p: int(sql(AUTH + "select get_wholesale_payroll_epoch('" + p + "');").stdout.splitlines()[-1]) for p in [period, prior_period]}
        sql(AUTH + correction(service_doc,'cross-period-correction'))
        after = {p: int(sql(AUTH + "select get_wholesale_payroll_epoch('" + p + "');").stdout.splitlines()[-1]) for p in [period, prior_period]}
        assert all(after[p] == before[p] + 1 for p in before)
        print('Payroll epoch tests passed: absent0, same-period increment once, both snapshot/write races, cross-period increment of both months.', flush=True)
        service_id = sql("select id from sales_invoices where order_id='fb200000-0000-4000-8000-000000000001' and status<>'batal';").stdout.strip()
        for suffix in ['2','3']:
            adv_id = 'fb500000-0000-4000-8000-00000000000' + suffix
            ref = 'UJ.SOURCE.RACE.' + suffix
            sql("insert into sales_advances(id,no_um,customer_id,order_id,tanggal,jumlah) values('" + adv_id + "','" + ref + "','f4000000-0000-4000-8000-000000000001','fb200000-0000-4000-8000-000000000001',current_date,20);")
            sql("select sales_write_journal(current_date,'f2000000-0000-4000-8000-000000000001','sales-advance','" + ref + "','Fiction advance race',jsonb_build_array(jsonb_build_object('code','1102','debit',20,'credit',0),jsonb_build_object('code','2103','debit',0,'credit',20)));")
            payment = "select receive_wholesale_payment('advance-source-race-" + suffix + "','" + service_id + "',current_date,10,'Transfer',null,'" + adv_id + "',null);"
            extra = "insert into journal_lines(id,entry_id,account_id,debit,credit) values('fb600000-0000-4000-8000-00000000000" + suffix + "',(select id from journal_entries where source='sales-advance' and source_ref='" + ref + "'),(select id from coa_accounts where code='1102'),1,0);"
            if suffix == '2':
                race(payment, extra, 'Jurnal grosir')
                assert sql("select terpakai from sales_advances where id='" + adv_id + "';").stdout.strip() == '10.00'
            else:
                race(extra, payment, 'nilai jurnal')
                assert sql("select terpakai from sales_advances where id='" + adv_id + "';").stdout.strip() == '0.00'
                assert sql("select count(*) from sales_receipts where advance_id='" + adv_id + "';").stdout.strip() == '0'
                sql("delete from journal_lines where id='fb600000-0000-4000-8000-000000000003';")
        print('Advance funding journal INSERT/first-usage races passed in both orders: blocked phantom or rejected invalid funding, no leaked allocation.', flush=True)
    finally:
        for proc in jobs:
            if proc.poll() is None:
                proc.kill(); proc.wait()

if __name__ == '__main__':
    main()
