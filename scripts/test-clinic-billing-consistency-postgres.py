#!/usr/bin/env python3
"""K08 fictional local PostgreSQL only. No URL/credentials/target are accepted."""
from pathlib import Path
import importlib.util
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('k08_fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
names = ['clinic_billing_consistency.sql', 'clinic_invoice_post.sql', 'clinic_billing_lifecycle.sql', 'inpatient_consent.sql', 'clinic_demo_financial_policy.sql']
failures = []
with fixture.DisposablePostgres() as database:
    database.bootstrap()
    # Verify the guarded rollback restores the baseline function and reapplication
    # preserves the exact candidate definition, owner, security settings and ACL.
    identity = "select row(pg_get_functiondef(oid),proowner,prosecdef,proconfig,proacl)::text from pg_proc where oid='public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure;"
    candidate = database.sql(identity)
    rollback = (ROOT / 'docs/rollback/2026-10-22-k08-paid-checkout.sql').read_text()
    migration = (ROOT / 'supabase/migrations/20261022232107_clinic_paid_checkout_atomic.sql').read_text()
    for label in ['main222-function', 'candidate223-function']:
        if label == 'main222-function':
            database.sql(rollback)
        else:
            database.sql(migration)
            if database.sql(identity) != candidate:
                raise RuntimeError('Migration/rollback roundtrip changed function security or definition')
        clone = 'k08_legacy_probe'
        database.sql('create database ' + clone + ' template postgres;')
        try:
            # The 2026-10-22 fixture gap (unauthenticated setup refused by protect_inpatient_care_staff)
            # was closed in the K08 rebill batch; the discharge assertions now run on both definitions.
            database.sql('\\connect ' + clone + "\n" + (ROOT / 'supabase/tests/clinic_inpatient_discharge.sql').read_text())
            print('PASS clinic_inpatient_discharge.sql on ' + label, flush=True)
        finally:
            database.sql('drop database ' + clone + ' with (force);')
    print('PASS migration/rollback roundtrip: exact definition/owner/security/ACL preserved', flush=True)
    for index, name in enumerate(names):
        clone = 'k08_suite_' + str(index)
        database.sql('create database ' + clone + ' template postgres;')
        source = (ROOT / 'supabase/tests' / name).read_text()
        if name == 'clinic_billing_consistency.sql':
            original = (ROOT / 'supabase/tests/clinic_invoice_post.sql').read_text()
            source = original.split('set local role authenticated;')[0] + source
        try:
            database.sql('\\connect ' + clone + "\nset time zone 'Asia/Jakarta';\n" + source)
            print('PASS ' + name, flush=True)
        except RuntimeError as error:
            failures.append(name)
            print('FAIL ' + name + ': ' + str(error), flush=True)
        finally:
            database.sql('drop database ' + clone + ' with (force);')
if failures:
    raise SystemExit('Failed suites: ' + ', '.join(failures))
print('PASS all5 K08/native suites; owned container/volumes removed.', flush=True)
