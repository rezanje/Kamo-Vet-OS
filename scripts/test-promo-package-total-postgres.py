#!/usr/bin/env python3
"""C04 fictional package-mode and legacy editor regression in owned PostgreSQL."""
import importlib.util
from pathlib import Path
import sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
fixture=importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(fixture)
with fixture.DisposablePostgres() as db:
    db.bootstrap()
    prefix=(ROOT/'supabase/tests/pos_split_payments.sql').read_text().split('set local role authenticated;')[0]
    db.sql(prefix+(ROOT/'supabase/tests/promo_edit.sql').read_text())
    db.sql(prefix+(ROOT/'supabase/tests/promo_package_total.sql').read_text())
    print('PASS C04: package mode selection, invalid settings, legacy edit, ACL and existing C01 editor',flush=True)
