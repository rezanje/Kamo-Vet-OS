#!/usr/bin/env python3
"""Average-cost correction regressions using fictional disposable local data."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import time
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sales_test', ROOT / 'scripts/test-posted-sales-postgres.py')
sales = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sales)
sales.DB = f'vetos_average_corrections_{os.getpid()}_{int(time.time())}'
sales.PSQL[-1] = sales.DB
subprocess.run(['createdb', '-h127.0.0.1', '-p5432', sales.DB], check=True)
try:
    sales.bootstrap_database()
    opening_fixture = (ROOT / 'supabase/tests/fixtures/average_opening_gl.sql').read_text()
    for fixture_name, suite_name in [('purchase_invoice_lifecycle.sql', 'average_purchase_corrections.sql'),
                                      ('pos_merchant_fees.sql', 'average_sale_corrections.sql')]:
        base = (ROOT / 'supabase/tests' / fixture_name).read_text()
        fixture = base[:base.index('set local role authenticated;')]
        suite = (ROOT / 'supabase/tests' / suite_name).read_text()
        sales.sql(sales.fixture_owner_updates(fixture + opening_fixture + suite))
        print(suite_name + ': passed', flush=True)
    for name in ['purchase_invoice_lifecycle.sql']:
        sales.sql(sales.fixture_owner_updates((ROOT / 'supabase/tests' / name).read_text()))
        print(name + ' (FIFO compatibility): passed', flush=True)
    base = (ROOT / 'supabase/tests/pos_merchant_fees.sql').read_text()
    sales.sql(sales.fixture_owner_updates(base[:base.index('set local role authenticated;')] +
              (ROOT / 'supabase/tests/posted_sale_cancellations.sql').read_text()))
    print('posted_sale_cancellations.sql (FIFO compatibility): passed', flush=True)
finally:
    subprocess.run(['dropdb', '-h127.0.0.1', '-p5432', '--if-exists', sales.DB], check=True)
