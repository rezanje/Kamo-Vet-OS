#!/usr/bin/env python3
"""J03 fictional refund tests in owned network-none PostgreSQL17 only."""
from pathlib import Path
import importlib.util
import sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('isolated',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.IMAGE='postgres:17.6'
if __name__=='__main__':
 with m.DisposablePostgres() as db:
  db.bootstrap()
  fees=(ROOT/'supabase/tests/pos_merchant_fees.sql').read_text()
  db.sql(fees.split('set local role authenticated;')[0]+(ROOT/'supabase/tests/refund_payout.sql').read_text())
  print('PASS refund_payout.sql',flush=True)
