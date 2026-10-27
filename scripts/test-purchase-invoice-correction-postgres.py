#!/usr/bin/env python3
"""P02 purchase invoice line correction: fictional fixture on a throwaway PostgreSQL.

Never accepts a database URL. Applies every repository migration, then runs the rolled-back
SQL suite supabase/tests/purchase_invoice_line_correction.sql twice: FIFO and moving average.

Usage:
  python3 scripts/test-purchase-invoice-correction-postgres.py                # Docker postgres:16, network none
  python3 scripts/test-purchase-invoice-correction-postgres.py --pg-bin DIR   # native throwaway cluster, no Docker
"""
from pathlib import Path
import argparse
import importlib.util
import os
import re
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
SUITE = ROOT / 'supabase/tests/purchase_invoice_line_correction.sql'


def owner_updates(source):
    # Fixture role changes bypass the profile privilege guard only inside the rolled-back test.
    return re.sub(r"(?m)^update profiles (.*);$",
                  r"alter table profiles disable trigger guard_profile_privileges;\nupdate profiles \1;\nalter table profiles enable trigger guard_profile_privileges;", source)


def run(db, bootstrap):
    bootstrap(db)
    for mode in ['fifo', 'average']:
        db.sql(owner_updates(SUITE.read_text().replace('__MODE__', mode)))
        print(f'PASS purchase_invoice_line_correction.sql ({mode})', flush=True)
    left = db.sql('select (select count(*) from purchase_invoice_corrections)+(select count(*) from purchase_invoices);')
    assert left == '0', 'Fixture rows leaked: ' + left


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--pg-bin', help='PostgreSQL bin dir for a native throwaway cluster instead of Docker')
    args = parser.parse_args()
    if args.pg_bin:
        sys.path.insert(0, str(ROOT / 'scripts'))
        from native_postgres import NativePostgres
        if sys.platform == 'darwin':
            os.environ.setdefault('LC_ALL', 'en_US.UTF-8')
        with NativePostgres(args.pg_bin) as db:
            run(db, lambda target: fixture.DisposablePostgres.bootstrap(target))
    else:
        with fixture.DisposablePostgres() as db:
            run(db, lambda target: target.bootstrap())


if __name__ == '__main__':
    main()
