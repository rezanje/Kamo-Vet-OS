#!/usr/bin/env python3
"""Real import RPC verification in owned network-none PostgreSQL; no target credentials."""
from pathlib import Path
import importlib.util
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('isolated', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.IMAGE = 'postgres:17.6'
if __name__ == '__main__':
    with m.DisposablePostgres() as db:
        db.bootstrap()
        db.sql((ROOT / 'supabase/tests/medical_delta_identity.sql').read_text())
        print('PASS real medical RPC mismatch reproduction, append, identity links, retry, original history and invalid-pet rollback', flush=True)
