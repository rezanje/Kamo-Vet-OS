#!/usr/bin/env python3
"""Grooming trigger UPDATE fix on a throwaway native PostgreSQL (no Docker, no DB URL).

Applies every repository migration with the shims of scripts/test-accurate-inventory-accounting-postgres.py,
then rehearses the owner package: preflight -> rollback (original body; the new test must FAIL with the
production error) -> apply -> readback -> apply again (idempotent) -> new test + regressions.

Usage: LC_ALL=en_US.UTF-8 python3 scripts/test-grooming-trigger-update-postgres.py [/opt/homebrew/opt/postgresql@16/bin]
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
spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
PKG = ROOT / "docs/evidence/2026-10-29-grooming-trigger-update/owner-apply"
TESTS = ROOT / "supabase/tests"
PRELUDE = (TESTS / "clinic_invoice_post.sql").read_text().split("set local role authenticated;")[0]
NEW_TEST = PRELUDE + (TESTS / "grooming_trigger_update.sql").read_text()


class Native(NativePostgres):
    bootstrap = fixture.DisposablePostgres.bootstrap


def main():
    with Native(BIN) as db:
        print("server:", db.sql("show server_version;"), flush=True)
        db.bootstrap()
        print("preflight (fix already in migrations):", db.sql((PKG / "preflight.sql").read_text()).splitlines()[0], flush=True)
        db.sql((PKG / "rollback.sql").read_text())
        print("preflight after rollback:", db.sql((PKG / "preflight.sql").read_text()).splitlines()[0], flush=True)
        try:
            db.sql(NEW_TEST)
            raise SystemExit("RED check failed: original body unexpectedly passed the UPDATE test")
        except RuntimeError as error:
            assert 'has no field "sale_id"' in str(error), str(error)
            print('RED as expected on original body: record "new" has no field "sale_id"', flush=True)
        try:
            db.sql((TESTS / "compound_recipient_instructions.sql").read_text())
            raise SystemExit("RED check failed: original body unexpectedly allowed the compound instruction sync")
        except RuntimeError as error:
            assert 'has no field "sale_id"' in str(error), str(error)
            print("RED as expected on original body: editing a compound's dosage instruction fails (sync UPDATE of prescription_items)", flush=True)
        db.sql((PKG / "apply.sql").read_text())
        print("readback:", " | ".join(db.sql((PKG / "readback.sql").read_text()).splitlines()), flush=True)
        db.sql((PKG / "apply.sql").read_text())
        print("PASS apply.sql re-run is a no-op", flush=True)
        db.sql(NEW_TEST)
        print("PASS grooming_trigger_update.sql", flush=True)
        db.sql((TESTS / "branch_grooming_requirements.sql").read_text())
        print("PASS existing regression: branch_grooming_requirements.sql", flush=True)
        db.sql(PRELUDE + (TESTS / "clinic_service_performers.sql").read_text())
        print("PASS existing regression: clinic_service_performers.sql", flush=True)
        for name in ["clinic_refund_source.sql", "clinic_refund_post.sql"]:
            db.sql(PRELUDE + (TESTS / name).read_text())
            print("PASS existing regression: " + name, flush=True)
        for name in ["compound_recipient_instructions.sql", "clinic_invoice_post.sql", "clinic_billing_lifecycle.sql", "clinic_procedure_bmhp.sql", "pos_split_payments.sql"]:
            db.sql((TESTS / name).read_text())
            print("PASS existing regression: " + name, flush=True)


if __name__ == "__main__":
    main()
