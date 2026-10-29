#!/usr/bin/env python3
"""P03 jual di bawah HPP: fictional fixtures on a throwaway PostgreSQL. Never accepts a database URL.

Applies every repository migration, then runs (each suite rolls back):
  supabase/tests/p03_price_floor.sql          petshop Grup floor, clinic goods/package floor, corrections
  regression: cashier_atomic_fifo_floor.sql, clinic_invoice_post.sql, clinic_billing_lifecycle.sql,
              clinic_procedure_bmhp.sql, clinic_manual_invoice_units.sql, clinic_demo_financial_policy.sql

Usage:
  python3 scripts/test-p03-price-floor-postgres.py                # Docker postgres:16, network none
  python3 scripts/test-p03-price-floor-postgres.py --pg-bin DIR   # native throwaway cluster, no Docker
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
SUITES = ['p03_price_floor.sql', 'cashier_atomic_fifo_floor.sql', 'clinic_invoice_post.sql',
          'clinic_billing_lifecycle.sql', 'clinic_procedure_bmhp.sql', 'clinic_manual_invoice_units.sql',
          'clinic_demo_financial_policy.sql']


def run(db, bootstrap):
    bootstrap(db)
    for name in SUITES:
        db.sql((ROOT / 'supabase/tests' / name).read_text())
        print('PASS ' + name, flush=True)
    left = db.sql("select (select count(*) from sales where no_struk like 'P03.%')"
                  "+(select count(*) from branches where code like 'P03%');")
    assert left == '0', 'Fixture rows leaked: ' + left
    print('PASS P03 fixtures rolled back', flush=True)


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
