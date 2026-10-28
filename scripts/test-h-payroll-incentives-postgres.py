#!/usr/bin/env python3
"""H04/H05/H06/H03/H02 schema checks in a throwaway native PostgreSQL cluster (no Docker, no DB URL).

Applies every repository migration with the shared fictional auth/storage bootstrap, then runs
supabase/tests/h_payroll_incentives.sql on top of the clinic invoice fixture. Nothing touches
a real database.

Usage: LC_ALL=en_US.UTF-8 python3 scripts/test-h-payroll-incentives-postgres.py [/opt/homebrew/opt/postgresql@16/bin] [--dump fn]
"""
import importlib.util
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


native = load('native_postgres', ROOT / 'scripts/native_postgres.py')
fixture = load('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
dump = sys.argv[sys.argv.index('--dump') + 1] if '--dump' in sys.argv else None
if dump in args:
    args.remove(dump)
BIN = args[0] if args else '/opt/homebrew/opt/postgresql@16/bin'

with native.NativePostgres(BIN) as database:
    # The shared bootstrap only needs .sql(); reuse it unchanged on the native cluster.
    fixture.DisposablePostgres.bootstrap(database)
    if dump:
        print(database.sql(f"select pg_get_functiondef('{dump}'::regprocedure)"))
        sys.exit(0)
    prefix = (ROOT / 'supabase/tests/clinic_invoice_post.sql').read_text().split('set local role authenticated;')[0]
    print(database.sql(prefix + (ROOT / 'supabase/tests/h_payroll_incentives.sql').read_text()), flush=True)
    print('PASS H05 package origin + qty guard, H04 groups + OWNER-only access, H06 visit rate + tamper guard, H03 turnover components, H02 templates + history + access', flush=True)
