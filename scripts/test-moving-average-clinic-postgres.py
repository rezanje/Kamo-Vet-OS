#!/usr/bin/env python3
"""Verify moving-average clinic and order delivery paths in an owned local DB."""
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
sales.DB = f'vetos_average_clinic_{os.getpid()}_{int(time.time())}'
sales.PSQL[-1] = sales.DB
subprocess.run(['createdb', '-h127.0.0.1', '-p5432', sales.DB], check=True)
try:
    sales.bootstrap_database()
    opening_fixture = (ROOT / 'supabase/tests/fixtures/average_opening_gl.sql').read_text()
    clinic = (ROOT / 'supabase/tests/clinic_invoice_post.sql').read_text()
    clinic = clinic[:clinic.index('set local role authenticated;')]
    order = (ROOT / 'supabase/tests/sales_safe_posting.sql').read_text()
    order = order[:order.index('create function public.test_sales_reject_order_line()')]
    order = order.replace('begin;', '', 1)
    source = clinic + order + opening_fixture + (ROOT / 'supabase/tests/moving_average_clinic.sql').read_text()
    sales.sql(sales.fixture_owner_updates(source.replace('update public.profiles ', 'update profiles ')))
    print('Moving-average clinic, compound restoration, invoice edit, sales delivery and historical invoice allocation passed.', flush=True)
    for name in ['clinic_compound_issue.sql', 'clinic_invoice_post.sql', 'clinic_billing_lifecycle.sql', 'sales_safe_posting.sql']:
        sales.sql(sales.fixture_owner_updates((ROOT / 'supabase/tests' / name).read_text().replace('update public.profiles ', 'update profiles ')))
        print(name + ': passed in default FIFO mode', flush=True)
finally:
    subprocess.run(['dropdb', '-h127.0.0.1', '-p5432', '--if-exists', sales.DB], check=True)
