#!/usr/bin/env python3
"""Rincian promo per barang di invoice klinik (20261108090000) on a throwaway native PostgreSQL.

1. Applies every repository migration EXCEPT the candidate and proves the table is absent = RED.
2. Applies the candidate twice (second run must not change the schema), runs
   supabase/tests/rincian_promo_baris_klinik.sql = GREEN.
Fictional data only; no production connection.

Usage: python3 -I scripts/test-rincian-promo-baris-klinik-postgres.py [/usr/lib/postgresql/16/bin]
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
CANDIDATE = ROOT / "supabase/migrations/20261108090000_rincian_promo_baris_klinik.sql"
TEST = ROOT / "supabase/tests/rincian_promo_baris_klinik.sql"


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


def schema(db):
    return db.last("""select md5(string_agg(x, ';' order by x)) from (
      select column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') x
        from information_schema.columns where table_schema='public' and table_name='invoice_promo_lines'
      union all select conname||':'||pg_get_constraintdef(oid) from pg_constraint where conrelid='public.invoice_promo_lines'::regclass
      union all select polname||':'||pg_get_expr(polqual, polrelid, true)||':'||coalesce(pg_get_expr(polwithcheck, polrelid, true),'')
        from pg_policy where polrelid='public.invoice_promo_lines'::regclass
      union all select tgname from pg_trigger where tgrelid='public.invoice_promo_lines'::regclass and not tgisinternal) s;""")


if __name__ == "__main__":
    with NativePostgres(BIN) as db:
        holder = _HoldBack(db)
        fixture.DisposablePostgres.bootstrap(holder)
        ok(holder.count > 300, f"baseline: {holder.count} migrations applied without the candidate")
        ok(db.last("select to_regclass('public.invoice_promo_lines') is null;") == "t",
           "RED: without the candidate there is nowhere to keep per-item clinic promos")
        db.sql("begin;\n" + CANDIDATE.read_text() + "\ncommit;")
        first = schema(db)
        db.sql("begin;\n" + CANDIDATE.read_text() + "\ncommit;")
        ok(schema(db) == first, "re-applying the candidate keeps the same schema")
        out = db.sql(TEST.read_text())
        ok("rincian_promo_baris_klinik: passed" in out, "GREEN: rincian_promo_baris_klinik.sql")
