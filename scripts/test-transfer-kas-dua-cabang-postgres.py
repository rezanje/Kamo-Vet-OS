#!/usr/bin/env python3
"""Transfer Kas dua cabang (20261202100000_transfer_kas_dua_cabang.sql) on a throwaway native PostgreSQL.

Applies every repository migration from zero (fictional auth/storage shims), then runs
supabase/tests/internal_transfer_corrections.sql (regresi transfer satu cabang) followed by
supabase/tests/transfer_kas_dua_cabang.sql (cabang asal/tujuan, koreksi ganti cabang, batal, pengaman).
Fictional data only; no production connection.

  python3 -I scripts/test-transfer-kas-dua-cabang-postgres.py [PG_BIN] [--baseline]
  --baseline  rantai TANPA migrasi ini: suite dua cabang harus gagal.
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
CANDIDATE = ROOT / "supabase/migrations/20261202100000_transfer_kas_dua_cabang.sql"


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
        if not BASELINE:
            db.sql("reset role;\n" + (ROOT / "supabase/tests/internal_transfer_corrections.sql").read_text())
            print("PASS regresi transfer satu cabang (internal_transfer_corrections.sql)", flush=True)
        try:
            out = db.sql("reset role;\n" + ("" if not BASELINE else (ROOT / "supabase/tests/internal_transfer_corrections.sql").read_text().split("-- 12 Nov 2026: koreksi boleh")[0]) + (ROOT / "supabase/tests/transfer_kas_dua_cabang.sql").read_text())
            ok, detail = out.splitlines()[-1] == "DUA CABANG PASS", out.splitlines()[-1]
        except RuntimeError as error:
            ok, detail = False, " | ".join(str(error).strip().splitlines()[:6])[:1500]
    if BASELINE:
        print(("PASS RED (tanpa migrasi, suite dua cabang gagal seperti seharusnya): " if not ok else "FAIL RED: suite lulus tanpa migrasi: ") + detail)
        sys.exit(0 if not ok else 1)
    print(("PASS " if ok else "FAIL ") + detail)
    sys.exit(0 if ok else 1)
