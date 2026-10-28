#!/usr/bin/env python3
"""N01 invoice<->receipt links + P08 one-step cancel of a used purchase advance: fictional fixtures
on a throwaway PostgreSQL. Never accepts a database URL.

Applies every repository migration, then runs (each suite rolls back unless noted):
  supabase/tests/n01_purchase_invoice_receipts.sql   links, uniqueness, narrowed receipt cancel
  supabase/tests/p08_advance_cancel_cascade.sql      cascade cancel + cancelled receipts no longer freeze the PO
  regression: goods_receipt_cancellation.sql (FIFO), purchase_advance_atomic.sql.

Usage:
  python3 scripts/test-n01-p08-postgres.py                # Docker postgres:16, network none
  python3 scripts/test-n01-p08-postgres.py --pg-bin DIR   # native throwaway cluster, no Docker
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
SUITES = ['n01_purchase_invoice_receipts.sql', 'p08_advance_cancel_cascade.sql',
          'goods_receipt_cancellation.sql', 'purchase_advance_atomic.sql']


def run(db, bootstrap):
    bootstrap(db)
    for name in SUITES:
        db.sql((ROOT / 'supabase/tests' / name).read_text())
        print('PASS ' + name, flush=True)
    left = db.sql('select (select count(*) from purchase_invoice_receipts)+(select count(*) from purchase_advance_cascade_cancellations);')
    assert left == '0', 'Fixture rows leaked: ' + left
    print('PASS N01/P08 fixtures rolled back', flush=True)


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
