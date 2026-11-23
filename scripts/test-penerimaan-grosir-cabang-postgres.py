#!/usr/bin/env python3
"""Penerimaan faktur grosir di cabang lain (20261205100000_penerimaan_grosir_cabang.sql) on a throwaway native PostgreSQL.

Applies every repository migration from zero (fictional auth/storage shims), then runs the fixture section of
supabase/tests/wholesale_returns.sql followed by supabase/tests/penerimaan_grosir_cabang.sql (rolled back), and the
regression suite wholesale_returns.sql (pays and returns through the patched receipt RPC).
(sales_safe_posting.sql / wholesale_corrections.sql already fail on main in this fixture chain with
"Pengaturan akses berubah", so they are not chained here; correction validation of a cross-branch receipt is
covered inside penerimaan_grosir_cabang.sql.)
Fictional data only; no production connection.

  python3 -I scripts/test-penerimaan-grosir-cabang-postgres.py [PG_BIN] [--baseline]
  --baseline  rantai TANPA migrasi ini: suite cabang harus gagal.
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
args = [a for a in sys.argv[1:] if a != "--baseline"]
BASELINE = "--baseline" in sys.argv[1:]
BIN = Path(args[0] if args else os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin"))
TESTS = ROOT / "supabase/tests"
CANDIDATE = ROOT / "supabase/migrations/20261205100000_penerimaan_grosir_cabang.sql"


def suite():
    returns = (TESTS / "wholesale_returns.sql").read_text()
    head = returns.split("-- @@fixture-end")[0]
    return head + "\n" + (TESTS / "penerimaan_grosir_cabang.sql").read_text() + "\nrollback;\n"


if __name__ == "__main__":
    with NativePostgres(BIN) as db:
        hidden = CANDIDATE.with_suffix(".sql.off")
        if BASELINE:
            CANDIDATE.rename(hidden)
        try:
            fixture.DisposablePostgres.bootstrap(db)
        finally:
            if BASELINE:
                hidden.rename(CANDIDATE)
        try:
            out = db.sql(suite())
            ok = "PENERIMAAN CABANG PASS" in out
            detail = "PENERIMAAN CABANG PASS" if ok else out.splitlines()[-1:]
        except RuntimeError as error:
            ok, detail = False, " | ".join(str(error).strip().splitlines()[:6])[:1500]
        if BASELINE:
            print(("PASS RED (tanpa migrasi, suite cabang gagal seperti seharusnya): " if not ok else "FAIL RED: suite lulus tanpa migrasi: ") + str(detail))
            sys.exit(0 if not ok else 1)
        print(("PASS " if ok else "FAIL ") + str(detail), flush=True)
        if not ok:
            sys.exit(1)
        db.sql((TESTS / "wholesale_returns.sql").read_text())
        print("PASS regresi wholesale_returns.sql", flush=True)
