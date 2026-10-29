#!/usr/bin/env python3
"""Rehearse the K08 rebill owner package on a disposable fictional database (never a real target).

Order: all migrations EXCEPT 20261029152000 (= production before K08) -> preflight (0 failed, empty lists)
-> commit fictional bug data on the old definition -> preflight lists that visit (Query A) -> apply ->
readback (0 failed) -> existing rows untouched -> second apply refused -> acceptance test green ->
rollback -> preflight clean again and acceptance red -> rollback refused when nothing is applied ->
committed post-fix data: Query A empty, Query C lists the stay reopened after its invoice.

Run with: K08_TARGET=docs/evidence/2026-10-29-k08-rebill/rehearse-owner-apply.py \
  python3 docs/evidence/2026-10-29-k08-rebill/run-native-pg.py
"""
from pathlib import Path
import hashlib
import importlib.util
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[3]
PKG = ROOT / 'docs/evidence/2026-10-29-k08-rebill/owner-apply'
VERSION = '20261029152000'
MIGRATION_PATH = ROOT / f'supabase/migrations/{VERSION}_k08_inpatient_rebill_periods.sql'
spec = importlib.util.spec_from_file_location('k08_rehearsal_fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

migration = MIGRATION_PATH.read_text()
apply_sql = (PKG / 'apply.sql').read_text()
preflight = (PKG / 'preflight.sql').read_text()
readback = (PKG / 'readback.sql').read_text()
rollback = (PKG / 'rollback.sql').read_text()
test = (ROOT / 'supabase/tests/k08_inpatient_rebill_periods.sql').read_text()
MARK = '-- @@PREFLIGHT_DEMO_POINT'


def check(cond, message):
    if not cond:
        raise RuntimeError('REHEARSAL FAILED: ' + message)
    print('ok  ' + message, flush=True)


sha = hashlib.sha256(migration.encode()).hexdigest()
check(migration in apply_sql and sha in apply_sql and f"values ('{VERSION}', 'k08_inpatient_rebill_periods')" in apply_sql,
      f'apply.sql carries the migration verbatim (sha256 {sha}) and its history row')
check(test.count(MARK) == 1 and test.rstrip().endswith('rollback;'), 'acceptance test layout (demo marker, rollback) as expected')

# Production before K08: every repository migration except this one.
pre_root = Path(tempfile.mkdtemp(prefix='k08-pre-migrations-'))
(pre_root / 'supabase/migrations').mkdir(parents=True)
for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
    if path != MIGRATION_PATH:
        (pre_root / 'supabase/migrations' / path.name).symlink_to(path)
fixture.ROOT = pre_root


def lines(out, prefix):
    return [line for line in out.splitlines() if line.startswith(prefix)]


def summary(out):
    return next(line for line in out.splitlines() if line.startswith('SUMMARY:'))


with fixture.DisposablePostgres() as db:
    db.bootstrap()
    db.sql('create schema supabase_migrations;'
           'create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);')

    # --- realistic target: a copy of "production before K08" ---
    db.sql('create database k08_target template postgres;')
    run = lambda source: db.sql('\\connect k08_target\n' + source)
    out = run(preflight)
    print(out, flush=True)
    check(summary(out) == 'SUMMARY: 0 failed|t', 'preflight on pre-K08 target: SUMMARY 0 failed')
    check(not lines(out, 'A under-billed') and not lines(out, 'B duplicate') and not lines(out, 'C open stay'),
          'preflight lists are empty before any affected data exists')

    run(test.split(MARK)[0] + '\ncommit;')
    out = run(preflight)
    a_rows = lines(out, 'A under-billed')
    print('\n'.join(a_rows), flush=True)
    check(len(a_rows) == 1 and '|e8600000-0000-4000-8000-000000000001|' in a_rows[0] and '|2|2|5|2|1|' in a_rows[0],
          'preflight Query A lists the fictional visit billed 2 of 5 days by the old definition')

    run(apply_sql)
    out = run(readback)
    print(out, flush=True)
    check(summary(out) == 'SUMMARY: 0 failed|t', 'readback after apply: SUMMARY 0 failed')
    check(run("select sum(p.qty) from public.prescription_items p join public.medical_records m on m.id=p.medical_record_id "
              "where m.visit_id='e8600000-0000-4000-8000-000000000001' and p.kategori='Rawat Inap';") == '2',
          'apply changes no existing rows (the old short line stays for a separate decision)')
    try:
        run(apply_sql)
        check(False, 'second apply must be refused')
    except RuntimeError as error:
        check('K08 rebill patch is already present' in str(error), 'second apply refused, nothing changed')
    check(summary(run(readback)) == 'SUMMARY: 0 failed|t', 'readback still 0 failed after the refused second apply')
    check(summary(run(preflight)) != 'SUMMARY: 0 failed|t', 'preflight now reports the patch as applied (marker present)')
    db.sql('drop database k08_target with (force);')

    # --- acceptance on applied / rolled-back definitions (fresh copies, no demo rows) ---
    db.sql(apply_sql)
    db.sql('create database k08_green template postgres;')
    out = db.sql('\\connect k08_green\n' + test)
    db.sql('drop database k08_green with (force);')
    check('PASS K08 re-discharge' in out, 'acceptance test green after apply.sql')

    db.sql(rollback)
    check(summary(db.sql(preflight)) == 'SUMMARY: 0 failed|t', 'preflight 0 failed again after rollback (exact pre-K08 block)')
    check(summary(db.sql(readback)) != 'SUMMARY: 0 failed|t', 'readback fails after rollback, as it should')
    check(db.sql(f"select count(*) from supabase_migrations.schema_migrations where version='{VERSION}';") == '0',
          'rollback removed the history row')
    db.sql('create database k08_red template postgres;')
    try:
        db.sql('\\connect k08_red\n' + test)
        check(False, 'acceptance must fail after rollback')
    except RuntimeError as error:
        check('K08 re-discharge billed 1 line(s) / 2 day(s)' in str(error), 'acceptance red again after rollback (bug is back)')
    finally:
        db.sql('drop database k08_red with (force);')
    try:
        db.sql(rollback)
        check(False, 'rollback on a pre-K08 definition must be refused')
    except RuntimeError as error:
        check('K08 rebill block not found exactly as applied' in str(error), 'rollback refused when K08 is not applied')

    # --- Query C on committed post-fix data: the stay reopened after its invoice ---
    db.sql(apply_sql)
    db.sql('create database k08_after template postgres;')
    db.sql('\\connect k08_after\n' + test.rstrip()[:-len('rollback;')] + 'commit;')
    out = db.sql('\\connect k08_after\n' + preflight)
    c_rows = lines(out, 'C open stay')
    print('\n'.join(c_rows), flush=True)
    check(not lines(out, 'A under-billed') and not lines(out, 'B duplicate'),
          'post-fix discharges leave no under-billed visit and no duplicate automatic line')
    check(len(c_rows) == 1 and '|e8600000-0000-4000-8000-000000000004|' in c_rows[0] and 'K08-REBILL-INV4' in c_rows[0],
          'preflight Query C lists the stay reopened after its invoice (cannot be discharged)')
    db.sql('drop database k08_after with (force);')
print('PASS K08 rebill owner package rehearsal', flush=True)
