#!/usr/bin/env python3
"""J03 clinical source/payout fixtures in owned network-none PostgreSQL17 only."""
from pathlib import Path
import importlib.util,sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('isolated',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.IMAGE='postgres:17.6'
if __name__=='__main__':
 with m.DisposablePostgres() as db:
  db.bootstrap()
  prelude=(ROOT/'supabase/tests/clinic_invoice_post.sql').read_text().split('set local role authenticated;')[0]
  db.sql(prelude+(ROOT/'supabase/tests/clinic_refund_source.sql').read_text());print('PASS clinic_refund_source.sql',flush=True)
