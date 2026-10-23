#!/usr/bin/env python3
"""Focused service-attribution tests in an owned network-none PostgreSQL fixture only."""
import importlib.util
from pathlib import Path
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
with fixture.DisposablePostgres() as database:
    database.bootstrap()
    prefix = (ROOT / 'supabase/tests/pos_split_payments.sql').read_text().split('set local role authenticated;')[0]
    database.sql(prefix + (ROOT / 'supabase/tests/service_line_performers.sql').read_text())
    print('PASS service_line_performers: roles/branch/actor/snapshots/immutability/rollback', flush=True)
    clinic = (ROOT / 'supabase/tests/clinic_invoice_post.sql').read_text().split('set local role authenticated;')[0]
    database.sql(clinic + (ROOT / 'supabase/tests/clinic_service_performers.sql').read_text())
    print('PASS clinic_service_performers: atomicity/retry/actor/exact-source correction/reissue', flush=True)
    for name in ['clinic_billing_lifecycle.sql', 'pos_split_payments.sql']:
        database.sql((ROOT / 'supabase/tests' / name).read_text())
        print('PASS existing regression: ' + name, flush=True)
