#!/usr/bin/env python3
"""Opening stock per warehouse plus the existing Accurate inventory suites, in a disposable localhost DB."""
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
sales.DB = f'vetos_opening_per_wh_{os.getpid()}_{int(time.time())}'
sales.PSQL[-1] = sales.DB
subprocess.run(['createdb', '-h127.0.0.1', '-p5432', sales.DB], check=True)
try:
    sales.bootstrap_database()
    for name in ['initial_stock_per_warehouse.sql', 'inventory_review_exact_transport.sql', 'accurate_inventory_preparation.sql', 'accurate_inventory_source_precision.sql',
                 'accurate_inventory_accounting.sql', 'accurate_inventory_accounting_guards.sql',
                 'accurate_inventory_accounting_review.sql', 'accurate_inventory_accounting_m01.sql']:
        sales.sql((ROOT / 'supabase/tests' / name).read_text())
        print(name + ': passed', flush=True)
finally:
    subprocess.run(['dropdb', '-h127.0.0.1', '-p5432', '--if-exists', sales.DB], check=True)
