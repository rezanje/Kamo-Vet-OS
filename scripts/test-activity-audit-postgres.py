#!/usr/bin/env python3
"""A01 source chain and regression SQL in cloned fictional disposable databases.

No remote URL or credentials are accepted. Every suite gets a fresh database
cloned from the fully migrated fictional template inside one network-none PG16
container (or, with --pg-bin, a throwaway native PostgreSQL cluster), so a legacy
suite that commits cannot pollute a different suite.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('activity_fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
legacy_spec = importlib.util.spec_from_file_location('activity_legacy_fixture', ROOT / 'scripts/test-posted-sales-postgres.py')
legacy = importlib.util.module_from_spec(legacy_spec)
legacy_spec.loader.exec_module(legacy)
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres  # noqa: E402


class NativeDisposablePostgres(NativePostgres):
    bootstrap = fixture.DisposablePostgres.bootstrap


def suite_source(test):
    """Reuse the prerequisite recipes from each existing dedicated runner."""
    source = test.read_text()
    if test.name == 'posted_sale_cancellations.sql':
        base = (ROOT / 'supabase/tests/pos_merchant_fees.sql').read_text()
        return legacy.fixture_owner_updates(base[:base.index('set local role authenticated;')] + source)
    if test.name == 'wholesale_corrections.sql':
        base = (ROOT / 'supabase/tests/sales_safe_posting.sql').read_text().split('insert into sales_quotations')[0]
        base += "\nupdate profiles set role='OWNER' where id='f1000000-0000-4000-8000-000000000001';commit;\n"
        return legacy.fixture_owner_updates(base) + source
    if test.name == 'bank_reconciliation_lifecycle.sql':
        base = (ROOT / 'supabase/tests/pos_merchant_fees.sql').read_text().strip()
        if not base.endswith('rollback;'):
            raise RuntimeError('Unexpected merchant fixture ending')
        base = legacy.fixture_owner_updates(base[:-len('rollback;')] + 'commit;')
        base += "\nreset role;alter table profiles disable trigger guard_profile_privileges;update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';alter table profiles enable trigger guard_profile_privileges;\n"
        return base + source
    return source


DEFAULTS = [
    'activity_audit_coverage.sql',
    'activity_audit.sql', 'activity_audit_framework.sql',
    'activity_audit_financial.sql', 'activity_audit_inventory.sql',
    'activity_audit_people_settings.sql', 'activity_audit_remaining_modules.sql',
    'master_data_lifecycle.sql', 'master_item_code_history.sql',
    'stock_document_corrections.sql', 'clinic_billing_lifecycle.sql',
    'manual-journal-corrections.sql', 'cash-entry-corrections.sql',
    'posted_sale_cancellations.sql', 'wholesale_corrections.sql',
    'purchase_invoice_lifecycle.sql', 'purchase_payment_corrections.sql',
    'asset_purchase_correction.sql', 'bank_reconciliation_lifecycle.sql',
    'internal_transfer_corrections.sql',
]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('tests', nargs='*', default=DEFAULTS)
parser.add_argument('--pg-bin', type=Path, help='Use a throwaway native PostgreSQL cluster from this bin directory instead of Docker')
parser.add_argument('--schema-output', type=Path, help='Write owned test database schema metadata only (no source row values)')
args = parser.parse_args()
tests = []
for name in args.tests:
    path = (ROOT / 'supabase/tests' / name).resolve()
    if path.parent != (ROOT / 'supabase/tests').resolve() or not path.is_file() or path.suffix != '.sql':
        parser.error('Expected an existing SQL filename directly in supabase/tests')
    tests.append(path)
failures = []
with (NativeDisposablePostgres(args.pg_bin) if args.pg_bin else fixture.DisposablePostgres()) as database:
    database.bootstrap()
    if args.schema_output:
        destination = args.schema_output.resolve()
        if not destination.is_relative_to(ROOT):
            parser.error('Schema metadata output must stay inside this workspace')
        metadata = database.sql("""select jsonb_object_agg(c.relname,jsonb_build_object(
          'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',not a.attnotnull) order by a.attnum)
            from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
          'constraints',coalesce((select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid),'[]'),
          'policies',coalesce((select jsonb_agg(jsonb_build_object('name',p.policyname,'cmd',p.cmd,'qual',p.qual,'check',p.with_check) order by p.policyname)
            from pg_policies p where p.schemaname='public' and p.tablename=c.relname),'[]')) order by c.relname)
          from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';""")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(json.loads(metadata), indent=2, sort_keys=True) + '\n')
        print('Wrote schema metadata only: ' + str(destination.relative_to(ROOT)), flush=True)
    # Same accounting reference code as supabase/seed.sql, with fictional label.
    # The legacy manual-journal suite assumes it exists but does not seed it.
    database.sql("insert into coa_accounts(code,name,type,normal_balance) values('510001','Fictional A01 revenue prerequisite','PENDAPATAN','K') on conflict(code) do nothing;")
    print('Fictional prerequisite: COA 4101 (legacy manual-journal fixture).', flush=True)
    for index, test in enumerate(tests):
        name = 'a01_suite_' + str(index)
        database.sql('create database ' + name + ' template postgres;')
        try:
            # Fixture current_date must use the same business clock as source guards.
            database.sql('\\connect ' + name + "\nset time zone 'Asia/Jakarta';\n" + suite_source(test))
            print('PASS ' + test.name, flush=True)
        except RuntimeError as error:
            failures.append(test.name)
            print('FAIL ' + test.name + ': ' + str(error), flush=True)
        finally:
            database.sql('drop database ' + name + ' with (force);')
if failures:
    raise SystemExit('Failed suites: ' + ', '.join(failures))
print(f'PASS {len(tests)} independently isolated SQL suites.', flush=True)
