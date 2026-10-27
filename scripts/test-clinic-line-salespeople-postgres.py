#!/usr/bin/env python3
"""Clinic per-line seller verification in disposable PostgreSQL only."""
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
    prefix = (ROOT / 'supabase/tests/clinic_invoice_post.sql').read_text().split('set local role authenticated;')[0]
    database.sql(prefix + (ROOT / 'supabase/tests/clinic_line_salespeople.sql').read_text())
    print('PASS clinic per-line sellers: medicine/service snapshots, branch/active guards, retry, correction and reissue', flush=True)
