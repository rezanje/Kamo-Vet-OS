#!/usr/bin/env python3
"""Exercise negative-stock valuation using all migrations in a disposable local DB."""
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
sales.DB = f'vetos_negative_hpp_{os.getpid()}_{int(time.time())}'
sales.PSQL[-1] = sales.DB

subprocess.run(['createdb', '-h127.0.0.1', '-p5432', sales.DB], check=True)
try:
    sales.bootstrap_database()
    base = (ROOT / 'supabase/tests/pos_merchant_fees.sql').read_text()
    fixtures = sales.fixture_owner_updates(base[:base.index('set local role authenticated;')])
    suite = (ROOT / 'supabase/tests/negative_stock_hpp.sql').read_text()
    sales.sql(fixtures + suite)
    print('Negative-stock HPP: FIFO, exhausted stock, transfer, POS journals, unknown-cost rollback passed.', flush=True)
    for name in ['pos_merchant_fees.sql', 'online_return_unit_posting.sql',
                 'posted_sale_cancellations.sql', 'stock_transfer_request_atomic.sql']:
        source = (ROOT / 'supabase/tests' / name).read_text()
        if name == 'posted_sale_cancellations.sql':
            source = fixtures + source
        sales.sql(sales.fixture_owner_updates(source))
        print(name + ': passed', flush=True)
finally:
    subprocess.run(['dropdb', '-h127.0.0.1', '-p5432', '--if-exists', sales.DB], check=True)
