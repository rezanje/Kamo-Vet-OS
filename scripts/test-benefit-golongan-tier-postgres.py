#!/usr/bin/env python3
"""Benefit golongan per level pelanggan — SQL regression on a throwaway native PostgreSQL.

Never accepts a database URL. A fresh cluster gets every repository migration and the same
fictional auth/storage shims as scripts/test-accurate-inventory-accounting-postgres.py, then runs
supabase/tests/benefit_golongan_per_tier.sql plus the existing customer spending/tier suite.

Usage: python3 scripts/test-benefit-golongan-tier-postgres.py [/usr/lib/postgresql/16/bin]
"""
import importlib.util
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
BIN = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin"))

if __name__ == "__main__":
    with NativePostgres(BIN) as db:
        fixture.DisposablePostgres.bootstrap(db)
        db.sql((ROOT / "supabase/tests/benefit_golongan_per_tier.sql").read_text())
        print("PASS benefit_golongan_per_tier.sql", flush=True)
        base = (ROOT / "supabase/tests/pos_merchant_fees.sql").read_text()
        source = base[:base.index("set local role authenticated;")] + (ROOT / "supabase/tests/customer_return_spending.sql").read_text()
        db.sql(source)
        print("PASS customer_return_spending.sql (tier refresh path unchanged)", flush=True)
