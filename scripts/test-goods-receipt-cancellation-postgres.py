#!/usr/bin/env python3
"""P08 goods receipt cancellation: fictional fixture on a throwaway PostgreSQL.

Never accepts a database URL. Applies every repository migration, then runs the rolled-back SQL
suite supabase/tests/goods_receipt_cancellation.sql twice: FIFO costing, and moving average
(activated inside the suite at its marker). Covers safe cancel (stock, layers, journal, PO qty),
refusal when invoiced, refusal when stock was consumed, non-owner refusal, idempotent double cancel.

Usage:
  python3 scripts/test-goods-receipt-cancellation-postgres.py                # Docker postgres:16, network none
  python3 scripts/test-goods-receipt-cancellation-postgres.py --pg-bin DIR   # native throwaway cluster, no Docker
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
SUITE = ROOT / 'supabase/tests/goods_receipt_cancellation.sql'
MARKER = '-- @AVERAGE_ACTIVATION@'


def average_suite():
    source = SUITE.read_text()
    if source.count(MARKER) != 1:
        raise RuntimeError('P08 average marker missing')
    activate = ((ROOT / 'supabase/tests/fixtures/average_opening_gl.sql').read_text()
                + '\nselect pg_temp.seed_average_opening_gl();\nselect activate_moving_average();\n'
                + "select pg_temp.ok((select method from inventory_costing_settings where id)='moving_average','average active');\n")
    return source.replace(MARKER, activate, 1)


def run(db, bootstrap):
    bootstrap(db)
    db.sql(SUITE.read_text())
    print('PASS goods_receipt_cancellation.sql (FIFO)', flush=True)
    db.sql(average_suite())
    print('PASS goods_receipt_cancellation.sql (moving average)', flush=True)
    left = db.sql('select (select count(*) from goods_receipts)+(select count(*) from purchase_receipt_cancellations);')
    assert left == '0', 'Fixture rows leaked: ' + left
    print('PASS fixture rolled back (0 receipt rows remain)', flush=True)


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
