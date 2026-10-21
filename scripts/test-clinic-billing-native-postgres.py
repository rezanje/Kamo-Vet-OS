#!/usr/bin/env python3
"""Run existing clinical acceptance SQL in an owned disposable localhost database."""
from pathlib import Path
import importlib.util
import os
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    environment = load('clinical_local_environment', ROOT / 'scripts/verify-simulation-backup.py')
    source = load('clinical_local_bootstrap', ROOT / 'scripts/test-posted-sales-postgres.py')
    source.DB = f'vetos_clinic_{os.getpid()}_{time.time_ns()}'
    source.ENV = environment.ENV
    source.PSQL = ['psql', '-X', '-q', '-At', *environment.LOCAL, '-d', source.DB, '-v', 'ON_ERROR_STOP=1']
    created = False
    try:
        subprocess.run(['createdb', *environment.LOCAL, source.DB], env=source.ENV, check=True, capture_output=True)
        created = True
        source.bootstrap_database()
        for name in ('inpatient_consent.sql', 'clinic_demo_financial_policy.sql', 'clinic_invoice_post.sql',
                     'clinic_billing_lifecycle.sql', 'clinical_occupation_selection.sql',
                     'compound_catalog_sku_binding.sql', 'clinic_inpatient_action_category.sql'):
            fixture = (ROOT / 'supabase/tests' / name).read_text()
            source.sql(source.fixture_owner_updates(fixture.replace('update public.profiles ', 'update profiles ')))
            print(f'PASS existing clinical acceptance: {name}', flush=True)
    finally:
        if created:
            subprocess.run(['dropdb', *environment.LOCAL, '--if-exists', source.DB], env=source.ENV, check=True, capture_output=True)


if __name__ == '__main__':
    main()
