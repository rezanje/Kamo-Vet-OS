#!/usr/bin/env python3
"""M05 opening AP/AR per invoice: fictional fixture on a throwaway PostgreSQL.

Never accepts a database URL. Applies every repository migration, then runs the rolled-back
SQL suite supabase/tests/opening_ap_ar_invoices.sql (preview/post access, validation, balanced
journal, idempotent re-post, fail-closed double count, payment allocation, protection).

Usage:
  python3 scripts/test-opening-invoices-postgres.py                # Docker postgres:16, network none
  python3 scripts/test-opening-invoices-postgres.py --pg-bin DIR   # native throwaway cluster, no Docker
"""
from pathlib import Path
import argparse
import importlib.util
import os
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
SUITE = 'opening_ap_ar_invoices.sql'


def run(db, bootstrap):
    bootstrap(db)
    db.sql((ROOT / 'supabase/tests' / SUITE).read_text())
    print('PASS ' + SUITE, flush=True)
    left = db.sql('select (select count(*) from opening_invoice_batches)+(select count(*) from opening_invoice_lines);')
    assert left == '0', 'Fixture rows leaked: ' + left
    print('PASS fixture rolled back (0 opening rows remain)', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--pg-bin', help='PostgreSQL bin dir for a native throwaway cluster instead of Docker')
    args = parser.parse_args()
    if args.pg_bin:
        sys.path.insert(0, str(ROOT / 'scripts'))
        from native_postgres import NativePostgres
        # macOS postmaster refuses to start without a valid process locale.
        if sys.platform == 'darwin':
            os.environ.setdefault('LC_ALL', 'en_US.UTF-8')
        with NativePostgres(args.pg_bin) as db:
            run(db, lambda target: fixture.DisposablePostgres.bootstrap(target))
    else:
        with fixture.DisposablePostgres() as db:
            run(db, lambda target: target.bootstrap())


if __name__ == '__main__':
    main()
