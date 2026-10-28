#!/usr/bin/env python3
"""K08 rebill: fictional local PostgreSQL only. No URL/credentials/target are accepted.

1. Applies every repository migration (including 20261029152000_k08_inpatient_rebill_periods.sql).
2. GREEN: supabase/tests/k08_inpatient_rebill_periods.sql passes on the candidate definition.
3. RED: the owner rollback restores the pre-K08 definition; the same test must fail exactly on the
   reported bug (second discharge bills only the last period). Re-applying the migration restores the
   identical candidate definition, owner, security settings and ACL; a second apply is refused.
4. Regression: related clinic/inpatient SQL suites pass on the candidate, each in its own clone.
"""
from pathlib import Path
import importlib.util
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('k08_rebill_fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

TEST = (ROOT / 'supabase/tests/k08_inpatient_rebill_periods.sql').read_text()
MIGRATION = (ROOT / 'supabase/migrations/20261029152000_k08_inpatient_rebill_periods.sql').read_text()
ROLLBACK = (ROOT / 'docs/evidence/2026-10-29-k08-rebill/owner-apply/rollback.sql').read_text()
IDENTITY = """select row(md5(pg_get_functiondef(oid)),proowner::regrole,prosecdef,proconfig,proacl)::text
from pg_proc where oid='public.clinic_change_inpatient_condition(uuid,text,text)'::regprocedure;"""
RED = 'K08 re-discharge billed 1 line(s) / 2 day(s) / 200000.00; expected 1 line, 5 days (3+2)'
SUITES = ['k08_inpatient_rebill_periods.sql', 'clinic_inpatient_discharge.sql', 'inpatient_continuation_pet_hotel.sql',
          'inpatient_consent.sql', 'clinic_inpatient_action_category.sql', 'clinic_invoice_post.sql',
          'clinic_billing_lifecycle.sql', 'clinic_procedure_bmhp.sql', 'clinic_demo_financial_policy.sql',
          'clinic_manual_invoice_units.sql', 'clinic_compound_issue.sql']


def in_clone(db, name, source):
    db.sql(f'create database {name} template postgres;')
    try:
        return db.sql(f'\\connect {name}\n' + source)
    finally:
        db.sql(f'drop database {name} with (force);')


failures = []
with fixture.DisposablePostgres() as db:
    db.bootstrap()
    db.sql('create schema if not exists supabase_migrations;'
           'create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);')
    candidate = db.sql(IDENTITY)

    out = in_clone(db, 'k08_green', TEST)
    if 'PASS K08 re-discharge' not in out:
        raise RuntimeError('GREEN run did not reach its PASS line:\n' + out)
    print('GREEN candidate: ' + out.splitlines()[-1], flush=True)

    db.sql(ROLLBACK)
    baseline = db.sql(IDENTITY)
    if baseline == candidate or baseline.split(',', 1)[1] != candidate.split(',', 1)[1]:
        raise RuntimeError(f'Rollback must change only the body: candidate={candidate} baseline={baseline}')
    try:
        in_clone(db, 'k08_red', TEST)
        raise RuntimeError('RED probe unexpectedly passed on the pre-K08 definition')
    except RuntimeError as error:
        if RED not in str(error):
            raise
        print('RED pre-K08 definition: ' + next(line for line in str(error).splitlines() if 'K08 re-discharge' in line), flush=True)

    db.sql('begin;\n' + MIGRATION + '\ncommit;')
    if db.sql(IDENTITY) != candidate:
        raise RuntimeError('Re-applied migration does not reproduce the candidate definition/owner/security/ACL')
    try:
        db.sql('begin;\n' + MIGRATION + '\ncommit;')
        raise RuntimeError('Second apply was not refused')
    except RuntimeError as error:
        if 'K08 rebill patch is already present' not in str(error):
            raise
    print('PASS rollback/re-apply roundtrip: identical definition, owner, SECURITY DEFINER, search_path, ACL; second apply refused', flush=True)

    for index, name in enumerate(SUITES):
        try:
            in_clone(db, f'k08_suite_{index}', "set time zone 'Asia/Jakarta';\n" + (ROOT / 'supabase/tests' / name).read_text())
            print('PASS ' + name, flush=True)
        except RuntimeError as error:
            failures.append(name)
            print('FAIL ' + name + ': ' + str(error), flush=True)
if failures:
    raise SystemExit('Failed suites: ' + ', '.join(failures))
print(f'PASS K08 rebill: red/green proven, {len(SUITES)} SQL suites pass; owned database removed.', flush=True)
