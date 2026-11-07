#!/usr/bin/env python3
"""Order online dari gudang cabang mana pun (20261107030000) on a throwaway native PostgreSQL.

1. Applies every repository migration EXCEPT the candidate, proves the old rule (RETAIL refused) = RED.
2. Applies the candidate twice (second run must be a no-op), runs supabase/tests/online_semua_gudang.sql = GREEN.
3. Re-runs the existing online/return suite (supabase/tests/online_return_unit_posting.sql) as regression.
Fictional data only; no production connection.

Usage: python3 -I scripts/test-online-semua-gudang-postgres.py [/usr/lib/postgresql/16/bin]
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
CANDIDATE = ROOT / "supabase/migrations/20261107030000_online_semua_gudang.sql"
TEST = ROOT / "supabase/tests/online_semua_gudang.sql"
REGRESSION = ROOT / "supabase/tests/online_return_unit_posting.sql"


def ok(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("PASS " + msg, flush=True)


class _HoldBack:
    """Duck-typed stand-in for the shared fixture's bootstrap: same shims, every migration except the candidate."""

    def __init__(self, db):
        self.db = db
        self.count = 0

    def sql(self, source):
        if source == "begin;\n" + CANDIDATE.read_text() + "\ncommit;":
            return ""
        if source.startswith("begin;\n"):
            self.count += 1
        return self.db.sql(source)


def bootstrap_without_candidate(db):
    holder = _HoldBack(db)
    fixture.DisposablePostgres.bootstrap(holder)
    return holder.count


def definition(db):
    return db.last("select md5(pg_get_functiondef('public.post_online_order(text,jsonb,jsonb)'::regprocedure));")


if __name__ == "__main__":
    with NativePostgres(BIN) as db:
        count = bootstrap_without_candidate(db)
        ok(count > 300, f"baseline: {count} migrations applied without the candidate")
        try:
            db.sql(TEST.read_text())
            raise AssertionError("baseline unexpectedly accepted a RETAIL warehouse")
        except RuntimeError as error:
            ok("FAIL" in str(error) and "gudang toko (RETAIL) diterima => FAIL" in str(error),
               "RED: without the candidate a RETAIL warehouse is refused")
        db.sql("begin;\n" + CANDIDATE.read_text() + "\ncommit;")
        first = definition(db)
        db.sql("begin;\n" + CANDIDATE.read_text() + "\ncommit;")
        ok(definition(db) == first, "re-applying the candidate is a no-op")
        out = db.sql(TEST.read_text())
        for line in out.splitlines():
            if "=>" in line:
                print("  " + line, flush=True)
        ok("FAIL" not in out, "GREEN: online_semua_gudang.sql")
        db.sql(REGRESSION.read_text())
        ok(True, "regression: online_return_unit_posting.sql")
