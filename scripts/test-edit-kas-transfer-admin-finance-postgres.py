#!/usr/bin/env python3
"""Edit Kas & Transfer untuk Admin/Finance (20261115410000) on a throwaway native PostgreSQL.

Applies every repository migration (including the target), then:
  * re-applies the target migration: it must be a no-op (idempotent text patches);
  * checks the running function bodies: no OWNER-only edit guard for cash entries, no fixed-date rule for
    transfer corrections, branch rule kept;
  * runs the SQL suites supabase/tests/internal_transfer_corrections.sql (ADMIN/FINANCE correct and cancel,
    date change posts the replacement on the new date and the reversal on the original date, branch change,
    future and closed dates refused) and supabase/tests/cash-entry-corrections.sql.
Fictional data only; no production connection.

Usage: python3 scripts/test-edit-kas-transfer-admin-finance-postgres.py [/usr/lib/postgresql/16/bin]
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
TARGET = ROOT / "supabase/migrations/20261115410000_edit_kas_transfer_admin_finance.sql"
CASH = "public.revise_cash_entry(text,uuid,integer,text,jsonb,text)"
TRANSFER = "public.mutate_cash_transfer(text,text,uuid,integer,jsonb,text)"


def ok(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("PASS " + msg, flush=True)


def body(db, sig):
    return db.last(f"select md5(pg_get_functiondef('{sig}'::regprocedure));")


def has(db, sig, text):
    return db.last(f"select position($t${text}$t$ in pg_get_functiondef('{sig}'::regprocedure))>0;") == "t"


if __name__ == "__main__":
    with NativePostgres(BIN) as db:
        fixture.DisposablePostgres.bootstrap(db)
        before = (body(db, CASH), body(db, TRANSFER))
        db.sql("begin;\n" + TARGET.read_text() + "\ncommit;")
        ok((body(db, CASH), body(db, TRANSFER)) == before, "re-applying the migration is a no-op")
        ok(not has(db, CASH, "Hanya Super Admin yang bisa mengedit kas"), "cash entry edit no longer OWNER-only")
        ok(has(db, CASH, "role not in ('OWNER','ADMIN','FINANCE')"), "cash entry edit still limited to OWNER/ADMIN/FINANCE")
        ok(not has(db, TRANSFER, "d<>doc.tanggal"), "transfer correction may change the date")
        ok(has(db, TRANSFER, "Koreksi transfer harus memakai cabang catatan asli"), "transfer correction keeps the branch")
        ok(db.last("select 'lock_timeout=5s'=any(proconfig) and exists(select 1 from unnest(proconfig) c where c like 'search_path=%') from pg_proc where oid='" + TRANSFER + "'::regprocedure;") == "t",
           "transfer function keeps search_path and lock timeout")
        ok(db.last("select has_function_privilege('authenticated','" + TRANSFER + "','execute') and has_function_privilege('authenticated','" + CASH + "','execute') and not has_function_privilege('anon','" + TRANSFER + "','execute');") == "t",
           "execute grants unchanged")
        # Cash suite first: it picks "the first" rekening, so it must run before the transfer suite adds more.
        db.sql((ROOT / "supabase/tests/cash-entry-corrections.sql").read_text())
        ok(True, "cash entry suite: FINANCE edit passes the access check, OWNER edit/void journals balance")
        db.sql("reset role;\n" + (ROOT / "supabase/tests/internal_transfer_corrections.sql").read_text())
        ok(True, "transfer suite: ADMIN/FINANCE correct & cancel, date change, branch/future guards, journals balance")
        print("ALL PASS", flush=True)
