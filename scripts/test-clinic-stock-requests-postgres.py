#!/usr/bin/env python3
"""Permintaan barang klinik ke DC / cabang lain (20261106050000) di PostgreSQL lokal sekali pakai.

Seluruh migrasi repo diputar dari nol, lalu supabase/tests/clinic_stock_requests.sql dijalankan sebagai
pengguna `authenticated` dengan header cabang operasional. Data fiktif; tidak pernah terhubung ke Production.

    python3 scripts/test-clinic-stock-requests-postgres.py   # KAMO_PG_BIN=/usr/lib/postgresql/16/bin
"""
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

_spec = importlib.util.spec_from_file_location("hris", ROOT / "scripts/test-hris-cabang-postgres.py")
hris = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hris)

BIN = os.environ.get("KAMO_PG_BIN", "/opt/data/kamo-pg-harness/bin")


def main():
    with NativePostgres(BIN) as pg:
        pg.sql(hris.PLATFORM)
        pg.sql(hris.PERAN)
        berkas = sorted((ROOT / "supabase/migrations").glob("*.sql"))
        for f in berkas:
            if f.name in hris.SEBELUM:
                pg.sql(hris.SEBELUM[f.name])
            try:
                pg.sql("begin;\n" + f.read_text() + "\ncommit;")
            except RuntimeError as error:
                raise AssertionError(f"Migrasi {f.name} gagal:\n{str(error)[:2000]}") from None
        print(f"PASS: {len(berkas)} migrasi berjalan dari nol", flush=True)
        hasil = pg.sql((ROOT / "supabase/tests/clinic_stock_requests.sql").read_text())
        assert "CLINIC_STOCK_REQUESTS_OK" in hasil, hasil
        print("PASS: penolakan lama tereproduksi; permintaan klinik ke DC tersimpan atomik, ulang identik, penolakan sah", flush=True)


if __name__ == "__main__":
    main()
