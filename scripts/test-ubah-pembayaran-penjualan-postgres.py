#!/usr/bin/env python3
"""Ubah pembayaran penjualan satu langkah (migrasi *_ubah_pembayaran_penjualan.sql) on a throwaway native PostgreSQL.

Applies every repository migration from zero (fictional auth/storage shims), then runs the fixture + helper part of
supabase/tests/backdate_petshop.sql (up to "-- ── 0. objek baru") followed by supabase/tests/ubah_pembayaran_penjualan.sql.
Fictional data only; no production connection.

  python3 -I scripts/test-ubah-pembayaran-penjualan-postgres.py [PG_BIN] [--baseline]
  --baseline  rantai TANPA migrasi ini: suite harus gagal.
"""
import importlib.util
import os
import re
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
CANDIDATE = sorted((ROOT / "supabase/migrations").glob("*_ubah_pembayaran_penjualan.sql"))[0]
MARK = "-- ── 0. objek baru"


def suite():
    base = (ROOT / "supabase/tests/backdate_petshop.sql").read_text()
    return base[:base.index(MARK)] + (ROOT / "supabase/tests/ubah_pembayaran_penjualan.sql").read_text()


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
            ok, detail = out.splitlines()[-1] == "UBAH PEMBAYARAN PASS", out.splitlines()[-1]
        except RuntimeError as error:
            text = str(error)
            passes = re.findall(r"BP_PASS (UP[^\n]*)", text)
            errs = [l for l in text.splitlines() if l.startswith("ERROR")]
            ok, detail = False, (errs[0] if errs else text.strip().splitlines()[0])[:800] + f" (lulus sebelum gagal: {len(passes)})"
    if BASELINE:
        print(("PASS RED (tanpa migrasi, suite gagal seperti seharusnya): " if not ok else "FAIL RED: suite lulus tanpa migrasi: ") + detail)
        sys.exit(0 if not ok else 1)
    print(("PASS " if ok else "FAIL ") + detail)
    sys.exit(0 if ok else 1)
