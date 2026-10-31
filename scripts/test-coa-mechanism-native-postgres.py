#!/usr/bin/env python3
"""COA/jurnal follow-up (I02, J02, P02) SQL regressions on throwaway native PostgreSQL.

Never accepts a database URL. Each suite gets a fresh cluster with every repository migration
and the same fictional auth/storage shims as scripts/test-accurate-inventory-accounting-postgres.py.

  i02_inventory_adjustment_atomic.sql  atomic adjustment: stock+document+journal, retry, guards
  stock_document_corrections.sql       official stock corrections still accept documents
  opname_posting_atomic.sql            opname posting unchanged; its journals now locked too
  pos_payment_method_corrections.sql   J02 reversal/replacement journals cannot be tampered;
                                       correction after shift close, OWNER/FINANCE only
  clinic_payment_method_corrections.sql J02 clinic Tunai<->Transfer correction journal + safeguards
  goods_receipt_cancellation.sql       P02 receipt lines only change through official RPCs

Usage: python3 scripts/test-coa-mechanism-native-postgres.py [/usr/lib/postgresql/16/bin]
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
SUITES = [
    "i02_inventory_adjustment_atomic.sql",
    "stock_document_corrections.sql",
    "opname_posting_atomic.sql",
    "pos_payment_method_corrections.sql",
    "clinic_payment_method_corrections.sql",
    "goods_receipt_cancellation.sql",
]

if __name__ == "__main__":
    for name in SUITES:
        with NativePostgres(BIN) as db:
            fixture.DisposablePostgres.bootstrap(db)
            db.sql((ROOT / "supabase/tests" / name).read_text())
            print("PASS " + name, flush=True)
