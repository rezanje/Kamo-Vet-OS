#!/usr/bin/env python3
"""HRIS pilot access (20261027030000) in an owned, network-isolated PostgreSQL 16 container.

Applies every repository migration except the HRIS one, loads fictional pre-migration
fixtures, applies the HRIS migration inside supabase/tests/hris_pilot_access.sql, then
checks OWNER / ADMIN / FINANCE / STAFF / DOCTOR / anon access. No external database.

Usage: python3 scripts/test-hris-pilot-access-postgres.py
"""
import importlib.util
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('hris_fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
TARGET = '20261027030000_hris_pilot_access.sql'

with fixture.DisposablePostgres() as database:
    real = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    original_glob = Path.glob
    # Reuse the shared bootstrap, minus the migration under test.
    Path.glob = lambda self, pattern: (p for p in original_glob(self, pattern) if p.name != TARGET)
    try:
        database.bootstrap()
    finally:
        Path.glob = original_glob
    test = (ROOT / 'supabase/tests/hris_pilot_access.sql').read_text()
    test = test.replace('\\ir ../migrations/' + TARGET, (ROOT / 'supabase/migrations' / TARGET).read_text())
    print(database.sql(test), flush=True)
