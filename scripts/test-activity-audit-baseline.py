#!/usr/bin/env python3
"""Reproduce the two documented legacy SQL fixture failures on pristine main.

Reads an existing local Git commit; never checks out or mutates a shared branch.
Runs fictional fixtures in an owned network-none PostgreSQL16 container only.
An expected failure is evidence of baseline behavior, not a passing business test.
"""
import argparse
import importlib.util
import io
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--ref', default='origin/main')
args = parser.parse_args()
commit = subprocess.check_output(['git', 'rev-parse', '--verify', args.ref + '^{commit}'], cwd=ROOT, text=True).strip()
if not re.fullmatch('[0-9a-f]{40}', commit):
    parser.error('Expected an existing local Git commit')
spec = importlib.util.spec_from_file_location('baseline_fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
legacy_spec = importlib.util.spec_from_file_location('baseline_legacy', ROOT / 'scripts/test-posted-sales-postgres.py')
legacy = importlib.util.module_from_spec(legacy_spec)
legacy_spec.loader.exec_module(legacy)
with tempfile.TemporaryDirectory(prefix='a01-pristine-baseline-') as directory:
    archive = subprocess.check_output(['git', 'archive', commit, 'supabase/migrations', 'supabase/tests'], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        source.extractall(directory, filter='data')
    baseline = Path(directory)
    if list((baseline / 'supabase/migrations').glob('*activity_audit*.sql')):
        raise SystemExit('Baseline must not include A01 migrations')
    fixture.ROOT = baseline
    print('Pristine baseline commit: ' + commit, flush=True)
    with fixture.DisposablePostgres() as database:
        database.bootstrap()
        merchant = (baseline / 'supabase/tests/pos_merchant_fees.sql').read_text()
        posted = (baseline / 'supabase/tests/posted_sale_cancellations.sql').read_text()
        cases = [
            ('posted_sale_cancellations.sql', legacy.fixture_owner_updates(merchant[:merchant.index('set local role authenticated;')] + posted), 'Efek retur hanya melalui jalur koreksi catatan retur resmi'),
            ('clinical_occupation_selection.sql', (baseline / 'supabase/tests/clinical_occupation_selection.sql').read_text(), 'Perubahan status wajib melalui aksi master dengan alasan dan versi'),
        ]
        offset = database.sql("select current_date is distinct from (now() at time zone 'Asia/Jakarta')::date;") == 't'
        print('UTC vs Jakarta current_date differ: ' + str(offset), flush=True)
        if offset:
            cases.extend([
                ('purchase_invoice_lifecycle.sql', (baseline / 'supabase/tests/purchase_invoice_lifecycle.sql').read_text(), 'Expected rejection: Tanggal'),
                ('asset_purchase_correction.sql', (baseline / 'supabase/tests/asset_purchase_correction.sql').read_text(), 'Expected rejection: select correct_fixed_asset_purchase'),
            ])
        for index, (name, source, expected) in enumerate(cases):
            clone = 'a01_baseline_' + str(index)
            database.sql('create database ' + clone + ' template postgres;')
            try:
                database.sql('\\connect ' + clone + '\n' + source)
            except RuntimeError as error:
                if expected not in str(error):
                    raise
                print('EXPECTED BASELINE FAILURE ' + name + ': ' + str(error).strip(), flush=True)
            else:
                raise RuntimeError('Baseline failure did not reproduce: ' + name)
            finally:
                database.sql('drop database ' + clone + ' with (force);')
        for index, name in enumerate(['purchase_invoice_lifecycle.sql', 'asset_purchase_correction.sql']):
            clone = 'a01_business_clock_' + str(index)
            database.sql('create database ' + clone + ' template postgres;')
            try:
                database.sql('\\connect ' + clone + "\nset time zone 'Asia/Jakarta';\n" + (baseline / 'supabase/tests' / name).read_text())
                print('PASS pristine baseline with Jakarta fixture clock: ' + name, flush=True)
            finally:
                database.sql('drop database ' + clone + ' with (force);')
print('Confirmed baseline fixture failures and business-clock preparation; expected failures are not green business regressions.', flush=True)
