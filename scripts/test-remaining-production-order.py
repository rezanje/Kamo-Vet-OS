"""Fictional schema/flows in the real rollout order: deployed main, then remaining PRs."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
BASE = '9aafe37d13913735dacbee60ffd2099b43853db9'
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
bootstrap_spec = importlib.util.spec_from_file_location('bootstrap_helpers', ROOT / 'scripts/test-posted-sales-postgres.py')
bootstrap = importlib.util.module_from_spec(bootstrap_spec)
bootstrap_spec.loader.exec_module(bootstrap)
with tempfile.TemporaryDirectory(prefix='kamo-release-order-') as temporary:
    baseline = Path(temporary)
    directory = baseline / 'supabase/migrations'
    directory.mkdir(parents=True)
    paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', BASE, 'supabase/migrations'], cwd=ROOT, text=True).splitlines()
    for path in paths:
        (directory / Path(path).name).write_bytes(subprocess.check_output(['git', 'show', BASE + ':' + path], cwd=ROOT))
    harness.ROOT = ROOT if '--clean-replay' in sys.argv else baseline
    with harness.DisposablePostgres() as db:
        db.bootstrap()
        costing_core = db.sql("select pg_get_functiondef('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)'::regprocedure)||pg_get_functiondef('public.stock_in_fifo(uuid,uuid,numeric,numeric,text,text,date,date)'::regprocedure)||pg_get_functiondef('public.activate_moving_average()'::regprocedure)||pg_get_functiondef('public.close_inventory_month(date)'::regprocedure);")
        # Production retains this retired invoker overload, absent on a clean
        # repository replay. Its old write privileges are already revoked.
        db.sql("""create function public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric)
returns table(invoice_id uuid,no_faktur varchar(30),no_jurnal varchar(24),total numeric)
language plpgsql security invoker set search_path=public as $$begin raise exception 'Retired fixture overload';end$$;""")
        retired_hash = db.sql("select md5(pg_get_functiondef('public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric)'::regprocedure));")
        pending = [] if '--clean-replay' in sys.argv else sorted(path for path in (ROOT / 'supabase/migrations').glob('*.sql') if not (directory / path.name).exists())
        for path in pending:
            if path.name == '20261021074417_return_record_corrections.sql':
                try:
                    db.sql('begin;grant insert on public.purchase_invoices to authenticated;\n' + path.read_text() + '\ncommit;')
                except RuntimeError as error:
                    assert 'Retired invoice overload has unexpected write authority' in str(error), str(error)
                else:
                    raise AssertionError('Unexpected legacy write authority must abort return migration')
                assert db.sql("select to_regclass('public.return_record_postings') is null and not has_table_privilege('authenticated','public.purchase_invoices','INSERT');") == 't'
                print('PASS unexpected retired-overload authority aborts and rolls back fixture migration.', flush=True)
            db.sql('begin;\n' + path.read_text() + '\ncommit;')
            print('Applied after deployed main: ' + path.name, flush=True)
        assert retired_hash == db.sql("select md5(pg_get_functiondef('public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric)'::regprocedure));"), 'Retired overload must remain unchanged'
        coverage = db.sql("""select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
where n.nspname='public' and c.relname in ('cash_transfer_revisions','cash_transfer_requests','stock_document_corrections','stock_document_correction_requests','stock_document_issue_proofs','monetary_opening_corrections','monetary_opening_requests','opening_balance_create_requests','wholesale_invoice_corrections','wholesale_operation_requests','wholesale_payroll_epochs','return_record_postings','return_record_corrections','return_record_requests','fixed_asset_corrections','fixed_asset_value_requests')
and a.atttypid in ('json'::regtype,'jsonb'::regtype)
and not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='master_snapshot_'||a.attname and t.tgfoid='public.guard_trashed_master_reference()'::regprocedure);""")
        assert coverage == '0', 'New correction JSON provenance lacks deployed master reference guards: ' + coverage
        print('PASS production-order master JSON guard coverage.', flush=True)
        db.sql("""begin;
insert into auth.users(id) values(md5('remaining-guard-owner')::uuid);
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='OWNER',is_active=true where id=md5('remaining-guard-owner')::uuid;
alter table profiles enable trigger guard_profile_privileges;
insert into brands(id,name) values(md5('remaining-guard-brand')::uuid,'Fictional remaining guard brand');
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('remaining-guard-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select change_master_data_lifecycle('brands',md5('remaining-guard-brand')::uuid,'trash',0,'Fictional unused master');
reset role;
do $$ declare message text;begin
 begin
  insert into return_record_requests(actor_id,request_key,payload,result)
  values(md5('remaining-guard-owner')::uuid,'fictional-trashed-reference',jsonb_build_object('brand_id',md5('remaining-guard-brand')::uuid),'{}');
  raise exception 'Expected new correction request to reject trashed master';
 exception when others then
  get stacked diagnostics message=message_text;
  if message not like 'Master berada di Sampah%' then raise;end if;
 end;
end $$;
rollback;""")
        print('PASS newly created return-request JSON cannot reference a trashed master.', flush=True)
        db.sql((ROOT / 'supabase/tests/remaining_average_composition.sql').read_text())
        print('PASS future-average correction boundary.', flush=True)
        assert costing_core == db.sql("select pg_get_functiondef('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)'::regprocedure)||pg_get_functiondef('public.stock_in_fifo(uuid,uuid,numeric,numeric,text,text,date,date)'::regprocedure)||pg_get_functiondef('public.activate_moving_average()'::regprocedure)||pg_get_functiondef('public.close_inventory_month(date)'::regprocedure);"), 'Concurrent PR80 costing/activation/closing definitions changed'
        print('PASS concurrent PR80 costing/activation/closing source preserved exactly.', flush=True)
        # Actual independent sessions: the activation/closing exclusive lock must
        # block correction entry before any stock/document row lock is acquired.
        for index, statement in enumerate([
            "select preview_stock_document_correction('adjustment',null,'[]')",
            "select correct_stock_document('adjustment',null,'[]','Reason','lock-fixture','token')",
            "select correct_return_record('sales',null,0,'lock-fixture','Reason','Fictional receipt evidence','[]')",
            "select post_unit_return('sales',null,'lock-fixture','{}','[]')",
            "select issue_stock_document_recorded('adjustment',null,null)",
            "select create_opening_balance_atomic('lock-fixture',current_date,'[]')",
        ]):
            def launch(source):
                process = subprocess.Popen(db.command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                process.stdin.write(source)
                process.stdin.close()
                return process
            def barrier(name, event):
                for _ in range(300):
                    if db.sql("select exists(select 1 from pg_stat_activity where application_name='" + name + "' and " + event + ");") == 't': return
                    time.sleep(.01)
                raise AssertionError('Missing real session barrier: ' + name)
            holder_name = 'remaining_mode_holder_' + str(index)
            waiter_name = 'remaining_mode_waiter_' + str(index)
            holder = launch("set application_name='" + holder_name + "';begin;select pg_advisory_xact_lock(1962072401::bigint);select pg_sleep(20);rollback;")
            barrier(holder_name, "wait_event='PgSleep'")
            waiter = launch("set application_name='" + waiter_name + "';" + statement + ';')
            barrier(waiter_name, "wait_event_type='Lock' and wait_event='advisory'")
            assert db.sql("select not exists(select 1 from pg_locks l join pg_stat_activity a using(pid) where a.application_name='" + waiter_name + "' and relation in('public.stock'::regclass,'public.stock_layers'::regclass,'public.sales'::regclass,'public.purchase_orders'::regclass,'public.journal_entries'::regclass) and mode in('RowShareLock','RowExclusiveLock','ShareRowExclusiveLock')); ") == 't', 'Document lock acquired before costing-mode lock'
            # Cancel only our disposable fixture sleeper, closing its transaction
            # and releasing the barrier after the waiting session is proven.
            assert db.sql("select pg_cancel_backend(pid) from pg_stat_activity where application_name='" + holder_name + "';") == 't'
            holder.wait(timeout=10)
            waiter.wait(timeout=10)
            assert holder.returncode != 0 and waiter.returncode != 0, 'Fixture must cancel barrier and reject missing-document input'
            holder.stdout.close();holder.stderr.close();waiter.stdout.close();waiter.stderr.close()
        print('PASS six real-session correction/posting versus activation-lock order races.', flush=True)
        if '--coverage-only' not in sys.argv:
            names = ['internal_transfer_corrections.sql','stock_document_corrections.sql','monetary_opening_corrections.sql','monetary_opening_creation.sql','sales_safe_posting.sql','wholesale_corrections.sql','asset_purchase_correction.sql','accurate_inventory_accounting.sql','master_item_code_history.sql','pos_merchant_fees.sql','pos_split_payments.sql','online_return_unit_posting.sql']
            for index, name in enumerate(names):
                database = 'fixture_' + str(index)
                db.sql('create database ' + database + ' template postgres;')
                command = db.command() + ['-d', database]
                if name == 'wholesale_corrections.sql':
                    fixture = bootstrap.fixture_owner_updates((ROOT / 'supabase/tests/sales_safe_posting.sql').read_text().split('insert into sales_quotations')[0])
                    fixture += "\nupdate profiles set role='OWNER' where id='f1000000-0000-4000-8000-000000000001';commit;"
                    setup = subprocess.run(command, input=fixture, text=True, capture_output=True)
                    if setup.returncode: raise RuntimeError('Wholesale fixture setup: ' + setup.stderr[-5000:])
                source = (ROOT / 'supabase/tests' / name).read_text()
                if name == 'sales_safe_posting.sql': source = bootstrap.fixture_owner_updates(source)
                result = subprocess.run(command, input=source, text=True, capture_output=True)
                if result.returncode:
                    raise RuntimeError(name + ': ' + result.stderr[-5000:])
                print('PASS production-order fixture ' + name, flush=True)
            average_fixtures = [
                ('pos_merchant_fees.sql', 'moving_average_inventory.sql'),
                ('purchase_invoice_lifecycle.sql', 'average_purchase_corrections.sql'),
                ('pos_merchant_fees.sql', 'average_sale_corrections.sql'),
            ]
            for index, (fixture_name, suite_name) in enumerate(average_fixtures):
                database = 'average_fixture_' + str(index)
                db.sql('create database ' + database + ' template postgres;')
                fixture = (ROOT / 'supabase/tests' / fixture_name).read_text().split('set local role authenticated;')[0]
                source = bootstrap.fixture_owner_updates(fixture + (ROOT / 'supabase/tests' / suite_name).read_text())
                result = subprocess.run(db.command() + ['-d', database], input=source, text=True, capture_output=True)
                if result.returncode: raise RuntimeError(suite_name + ': ' + result.stderr[-5000:])
                print('PASS preserved PR80 suite ' + suite_name, flush=True)
            db.sql('create database average_fixture_clinic template postgres;')
            clinic = (ROOT / 'supabase/tests/clinic_invoice_post.sql').read_text().split('set local role authenticated;')[0]
            order = (ROOT / 'supabase/tests/sales_safe_posting.sql').read_text().split('create function public.test_sales_reject_order_line()')[0].replace('begin;', '', 1)
            source = bootstrap.fixture_owner_updates((clinic + order + (ROOT / 'supabase/tests/moving_average_clinic.sql').read_text()).replace('update public.profiles ', 'update profiles '))
            result = subprocess.run(db.command() + ['-d', 'average_fixture_clinic'], input=source, text=True, capture_output=True)
            if result.returncode: raise RuntimeError('moving_average_clinic.sql: ' + result.stderr[-5000:])
            print('PASS preserved PR80 clinic/compound/order-delivery suite.', flush=True)
            db.sql('create database fixture_returns template postgres;')
            command = db.command() + ['-d', 'fixture_returns']
            setup = (ROOT / 'supabase/tests/online_return_unit_posting.sql').read_text().split('set local role authenticated;')[0] + 'commit;'
            for name, sql in [('return_setup',setup), *[(name,(ROOT / 'supabase/tests' / name).read_text()) for name in ['return_record_corrections.sql','return_date_windows.sql']]]:
                result = subprocess.run(command, input=sql, text=True, capture_output=True)
                if result.returncode: raise RuntimeError(name + ': ' + result.stderr[-5000:])
                print('PASS production-order fixture ' + name, flush=True)
