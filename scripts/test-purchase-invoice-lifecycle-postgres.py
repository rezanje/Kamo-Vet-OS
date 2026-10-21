#!/usr/bin/env python3
"""Native PostgreSQL purchase-invoice checks in one owned disposable localhost DB."""
from pathlib import Path
import importlib.util
import os
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
DB = f'vetos_invoice_lifecycle_{os.getpid()}_{time.time_ns()}'
ENV = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
ENV['PGOPTIONS'] = '-c client_min_messages=warning -c TimeZone=UTC'
LOCAL = ['-h127.0.0.1', '-p5432']
PSQL = ['psql', '-X', '-q', '-At', *LOCAL, '-v', 'ON_ERROR_STOP=1', '-d', DB]

def sql(source):
    result = subprocess.run(PSQL, input=source, text=True, capture_output=True, env=ENV)
    if result.returncode:
        raise RuntimeError(result.stderr[-7000:])
    return result.stdout

AUTH = """set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','ee000000-0000-4000-8000-000000000001',false);
"""

def concurrency_tests():
    jobs = []
    def start(source):
        proc = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=ENV)
        jobs.append(proc)
        proc.stdin.write(AUTH + source)
        proc.stdin.close()
        return proc
    def wait(predicate):
        for _ in range(500):
            if sql("select exists(select 1 from pg_stat_activity where datname=current_database() and (" + predicate + "));" ).strip() == 't':
                return
            time.sleep(.01)
        raise RuntimeError('Missing local database concurrency barrier: ' + predicate)
    def finish(proc, rejected=None):
        proc.wait(timeout=15)
        out, err = proc.stdout.read(), proc.stderr.read()
        if rejected:
            if proc.returncode == 0 or rejected not in err:
                raise RuntimeError(out + err)
        elif proc.returncode:
            raise RuntimeError(out + err)
    def direct(key):
        return f"select create_direct_purchase_invoice('{key}',jsonb_set((select result from invoice_test_results where name='direct-payload'),'{{items,0,item_id}}','\"ee400000-0000-4000-8000-000000000099\"'));"
    def cancel(create_key, cancel_key):
        # Use the public result reader: private request storage stays inaccessible to authenticated callers.
        return f"select cancel_purchase_invoice((get_purchase_operation_result('invoice-direct','{create_key}')->>'invoice_id')::uuid,0,'{cancel_key}','Concurrent invoice correction');"
    def consume():
        return """do $$declare issued record;begin
          select * into issued from stock_out_fifo('ee200000-0000-4000-8000-000000000001','ee400000-0000-4000-8000-000000000099',1,'test-consume','INV.RACE',current_date);
          if issued.shortfall>0 then raise exception 'No remaining received stock';end if;
        end$$;"""
    try:
        sql("insert into items(id,code,name,unit,item_type) values('ee400000-0000-4000-8000-000000000099','INV-RACE','Race goods','box','Persediaan');")
        first = start('begin;' + direct('concurrent-create') + "select pg_sleep(1) /* invoice-create-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%invoice-create-holder%'")
        second = start('/* invoice-create-waiter */' + direct('concurrent-create'))
        wait("wait_event_type='Lock' and query like '%invoice-create-waiter%'")
        finish(first); finish(second)
        assert sql("select count(*) from purchase_operations where kind='invoice-direct' and request_key='concurrent-create';").strip() == '1'
        assert sql("select qty from stock where item_id='ee400000-0000-4000-8000-000000000099';").strip() == '1'
        first = start('begin;' + cancel('concurrent-create', 'concurrent-cancel') + "select pg_sleep(1) /* invoice-cancel-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%invoice-cancel-holder%'")
        second = start('/* invoice-cancel-waiter */' + cancel('concurrent-create', 'concurrent-cancel'))
        wait("wait_event_type='Lock' and query like '%invoice-cancel-waiter%'")
        finish(first); finish(second)
        assert sql("select count(*) from purchase_invoice_cancellation_requests where request_key='concurrent-cancel';").strip() == '1'
        assert sql("select qty from stock where item_id='ee400000-0000-4000-8000-000000000099';").strip() == '0'
        sql(AUTH + direct('consume-first'))
        first = start('begin;' + consume() + "select pg_sleep(1) /* invoice-stock-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%invoice-stock-holder%'")
        second = start('/* invoice-stock-cancel-waiter */' + cancel('consume-first', 'consume-before-cancel'))
        wait("wait_event_type='Lock' and query like '%invoice-stock-cancel-waiter%'")
        finish(first); finish(second, 'Rekonsiliasi')
        assert sql("select count(*) from purchase_invoice_cancellation_requests where request_key='consume-before-cancel';").strip() == '0'
        sql(AUTH + direct('cancel-first'))
        first = start('begin;' + cancel('cancel-first', 'cancel-before-consume') + "select pg_sleep(1) /* invoice-void-stock-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%invoice-void-stock-holder%'")
        second = start('/* invoice-stock-consumer-waiter */' + consume())
        wait("wait_event_type='Lock' and query like '%invoice-stock-consumer-waiter%'")
        finish(first); finish(second, 'No remaining received stock')
        assert sql("select qty from stock where item_id='ee400000-0000-4000-8000-000000000099';").strip() == '0'
        assert sql("select count(*) from stock_moves where item_id='ee400000-0000-4000-8000-000000000099' and source='test-consume';").strip() == '1'
        # An already-posted retry must recheck warehouse access after waiting.
        first = start("reset role;begin;update warehouses set is_active=false where id='ee200000-0000-4000-8000-000000000001';select pg_sleep(1) /* invoice-warehouse-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%invoice-warehouse-holder%'")
        second = start('/* invoice-access-waiter */' + direct('concurrent-create'))
        wait("wait_event_type='Lock' and query like '%invoice-access-waiter%'")
        finish(first); finish(second, 'Gudang')
        sql("update warehouses set is_active=true where id='ee200000-0000-4000-8000-000000000001';")
        sql("""insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status) values('ee500000-0000-4000-8000-000000000099','PO.INV.RACE','ee300000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000001','Dipesan');
          insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor) values('ee600000-0000-4000-8000-000000000099','ee500000-0000-4000-8000-000000000099','ee400000-0000-4000-8000-000000000099','Race goods',4,111,'box',1);""")
        sql(AUTH + "select receive_purchase_order('ee500000-0000-4000-8000-000000000099','race-receipt','TB.INV.RACE.',5,current_date,null,null,'[{\"id\":\"ee600000-0000-4000-8000-000000000099\",\"qty_terima\":4}]');")
        po_create = "select create_purchase_invoice_from_po('ee500000-0000-4000-8000-000000000099','FB.INV.RACE.',5,null,current_date,current_date+30,null,'[{\"po_item_id\":\"ee600000-0000-4000-8000-000000000099\",\"qty\":1,\"harga\":111}]','[]','[]',11,'race-po');"
        first = start('begin;' + po_create + "select pg_sleep(1) /* invoice-po-holder */;commit;")
        wait("wait_event='PgSleep' and query like '%invoice-po-holder%'")
        second = start('/* invoice-po-waiter */' + po_create)
        wait("wait_event_type='Lock' and query like '%invoice-po-waiter%'")
        finish(first); finish(second)
        assert sql("select count(*) from purchase_invoices where po_id='ee500000-0000-4000-8000-000000000099';").strip() == '1'
        assert sql("select sum(qty_left*unit_cost)=433 from stock_layers where source_ref='PO.INV.RACE';").strip() == 't'
        # The legacy PO internal reads accounts before its explicit journal counter.
        # Hold that exact gate, deactivate AP after those reads, then release it.
        audited_tables = ['purchase_invoices', 'purchase_invoice_items', 'stock', 'stock_layers', 'stock_moves', 'journal_entries', 'journal_lines', 'purchase_invoice_postings', 'purchase_invoice_layer_proofs', 'purchase_operations']
        snapshot_query = 'select jsonb_build_object(' + ','.join("'%s',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from %s t)" % (table, table) for table in audited_tables) + ')::text;'
        before_account_race = sql(snapshot_query)
        gate = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=ENV)
        jobs.append(gate)
        gate.stdin.write("begin;select pg_advisory_xact_lock(hashtext('vetos:journal:JRN-'||to_char(current_date,'YYYYMM')||'-')::bigint) /* invoice-coa-numbergate */;\n")
        gate.stdin.flush()
        wait("state='idle in transaction' and query like '%invoice-coa-numbergate%'")
        second = start('/* invoice-coa-waiter */' + po_create.replace("'race-po'", "'race-po-inactive-coa'"))
        wait("wait_event_type='Lock' and wait_event='advisory' and query like '%invoice-coa-waiter%'")
        sql("update coa_accounts set is_active=false where code='2101';")
        gate.stdin.write('commit;\n'); gate.stdin.close()
        finish(gate); finish(second, 'Akun sumber')
        assert sql(snapshot_query) == before_account_race, 'Account deactivation race leaked invoice, repricing, journal, proof or durable result'
        sql("update coa_accounts set is_active=true where code='2101';")
        print('PO account deactivation after journal-counter wait rejected with exact full rollback.', flush=True)
        print('Concurrent same-key create/cancel and both consume/cancel orderings passed.', flush=True)
    finally:
        for proc in jobs:
            if proc.poll() is None:
                proc.kill(); proc.wait()

def main():
    subprocess.run(['createdb', *LOCAL, DB], env=ENV, check=True, capture_output=True)
    try:
        spec = importlib.util.spec_from_file_location('invoice_bootstrap', ROOT / 'scripts/test-posted-sales-postgres.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.DB, module.PSQL, module.ENV = DB, PSQL, ENV
        module.bootstrap_database()
        print('All production migrations applied to isolated localhost database.', flush=True)
        # Keep the original recovery assertions; adapt only historical fixture setup
        # to today's supplier and profile-privilege requirements.
        legacy = (ROOT / 'supabase/tests/purchase_recovery.sql').read_text()
        legacy = legacy.replace('begin;', """begin;
alter table profiles disable trigger guard_profile_privileges;
alter table profiles disable trigger profiles_prevent_self_role_change;
insert into suppliers(id,nama) values('dc900000-0000-4000-8000-000000000001','Legacy fiction supplier');
insert into coa_accounts(code,name,type,normal_balance) values('1301','Legacy stock','ASET','D'),('2101','Legacy payable','LIABILITAS','K'),('1105','Legacy VAT','ASET','D'),('1501','Legacy asset','ASET','D') on conflict(code) do update set is_active=true,is_header=false;
update company_settings set mode_pkp=false;
""", 1)
        legacy = legacy.replace('insert into purchase_order_items', "update purchase_orders set supplier_id='dc900000-0000-4000-8000-000000000001';\ninsert into purchase_order_items", 1)
        legacy = legacy.replace("update profiles set role='OWNER'where", "update profiles set role='OWNER',is_active=true where")
        sql(legacy)
        print('Original purchase recovery/receipt/FIFO assertions passed.', flush=True)
        source = ROOT / 'supabase/tests/purchase_invoice_lifecycle.sql'
        if source.exists():
            sql(module.fixture_owner_updates(source.read_text()))
        concurrency_tests()
        print('Purchase invoice lifecycle checks passed.', flush=True)
    finally:
        subprocess.run(['dropdb', *LOCAL, '--if-exists', DB], env=ENV, check=True, capture_output=True)

if __name__ == '__main__':
    main()
