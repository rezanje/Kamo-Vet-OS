#!/usr/bin/env python3
"""I02 opname posting SQL regressions on a throwaway native PostgreSQL (no Docker, no DB URL).

Applies every repository migration with the same test-only auth/storage shims as
scripts/test-accurate-inventory-accounting-postgres.py, then runs the opname SQL tests and
the two-session race checks from scripts/test-opname-posting-postgres.py.

Usage: LC_ALL=en_US.UTF-8 python3 scripts/test-opname-posting-native-postgres.py [/opt/homebrew/opt/postgresql@16/bin]
"""
import importlib.util
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

BIN = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PG_BIN", "/opt/homebrew/opt/postgresql@16/bin"))
spec = importlib.util.spec_from_file_location("opname_posting", ROOT / "scripts/test-opname-posting-postgres.py")
posting = importlib.util.module_from_spec(spec)
spec.loader.exec_module(posting)


class Native(NativePostgres):
    bootstrap = posting.m.DisposablePostgres.bootstrap

    def command(self):
        return self.as_user + [self.psql, "-X", "-qAt", "-h", str(self.root), "-U", "postgres", "-v", "ON_ERROR_STOP=1"]


if __name__ == "__main__":
    with Native(BIN) as db:
        print("server:", db.sql("show server_version;"), flush=True)
        db.bootstrap()
        # Re-applying the I02 migration must be a no-op (idempotent create or replace).
        db.sql("begin;\n" + (ROOT / "supabase/migrations/20261028150000_i02_opname_uniform_variance.sql").read_text() + "\ncommit;")
        # That older file still names the old account codes; the chart-of-accounts migration
        # rewrites any such function again, so re-applying it restores the new codes.
        db.sql("begin;\n" + (ROOT / "supabase/migrations/20261105010000_coa_bagan_baru.sql").read_text() + "\ncommit;")
        if db.last("select public.stock_opname_account('inventory')||'/'||public.stock_opname_account('variance');") != "170001/720010":
            raise AssertionError("chart-of-accounts migration did not restore the opname accounts")
        print("PASS I02 migration re-applied idempotently (chart of accounts re-applied after it)", flush=True)
        for name in ["opname_posting_atomic.sql", "opname_price_report.sql", "stock_document_corrections.sql"]:
            db.sql((ROOT / "supabase/tests" / name).read_text())
            print("PASS " + name, flush=True)
        posting.races(db)
