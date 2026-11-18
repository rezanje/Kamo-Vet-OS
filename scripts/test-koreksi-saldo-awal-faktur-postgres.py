#!/usr/bin/env python3
"""Koreksi nilai saldo awal per faktur oleh Owner (migrasi 20261124300000_koreksi_saldo_awal_per_faktur.sql).

Klaster PostgreSQL lokal sekali pakai, data fiktif, tanpa jaringan dan tanpa URL database.
Rantai migrasi penuh repo diputar dari nol, lalu supabase/tests/opening_invoice_corrections.sql dijalankan.

  mkdir -p /opt/data && python3 -I scripts/test-koreksi-saldo-awal-faktur-postgres.py [--pg-bin DIR] [--baseline]
  (default)   GREEN: rantai lengkap, tes harus lulus ('OIC PASS').
  --baseline  RED: rantai TANPA migrasi ini, tes harus gagal.
"""
import argparse
import importlib.util
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

_spec = importlib.util.spec_from_file_location("hris", ROOT / "scripts/test-hris-cabang-postgres.py")
hris = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hris)

MIGRATIONS = ROOT / "supabase/migrations"
CANDIDATE = "20261124300000_koreksi_saldo_awal_per_faktur.sql"
TEST = ROOT / "supabase/tests/opening_invoice_corrections.sql"


def build_chain(pg, exclude):
    pg.sql(hris.PLATFORM)
    pg.sql(hris.PERAN)
    files = [f for f in sorted(MIGRATIONS.glob("*.sql")) if f.name not in exclude]
    for f in files:
        if f.name in hris.SEBELUM:
            pg.sql(hris.SEBELUM[f.name])
        try:
            pg.sql("begin;\n" + f.read_text() + "\ncommit;")
        except RuntimeError as error:
            raise AssertionError(f"Migrasi {f.name} gagal di klaster bersih:\n{str(error)[:2000]}") from None
    print(f"rantai: {len(files)} migrasi berjalan dari nol", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg-bin", default="/usr/lib/postgresql/16/bin")
    ap.add_argument("--baseline", action="store_true")
    a = ap.parse_args()
    with NativePostgres(a.pg_bin) as pg:
        build_chain(pg, {CANDIDATE} if a.baseline else set())
        try:
            out = pg.sql(TEST.read_text())
            ok = out.splitlines()[-1] == "OIC PASS" if out else False
            detail = out.splitlines()[-1] if out else ""
        except RuntimeError as error:
            ok, detail = False, str(error).strip().splitlines()[0][:600]
    if a.baseline:
        print(("PASS RED (tanpa migrasi, tes gagal seperti seharusnya): " if not ok else "FAIL RED: tes lulus tanpa migrasi: ") + detail)
        return 0 if not ok else 1
    print(("PASS " if ok else "FAIL ") + detail)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
