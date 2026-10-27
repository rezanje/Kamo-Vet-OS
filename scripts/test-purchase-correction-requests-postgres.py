#!/usr/bin/env python3
"""A02/P01 purchase correction requests: fictional fixture in an owned network-none PostgreSQL 16.

Never accepts a database URL. Applies every repository migration, then runs the
rolled-back SQL suite supabase/tests/purchase_correction_requests.sql.
"""
from pathlib import Path
import importlib.util
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def main():
    with fixture.DisposablePostgres() as db:
        db.bootstrap()
        for name in ['purchase_correction_requests.sql']:
            db.sql((ROOT / 'supabase/tests' / name).read_text())
            print('PASS ' + name, flush=True)
        left = db.sql('select count(*) from purchase_correction_requests;')
        assert left == '0', 'Fixture rows leaked: ' + left
        print('PASS fixture rolled back (0 request rows remain)', flush=True)


if __name__ == '__main__':
    main()
