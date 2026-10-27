#!/usr/bin/env python3
"""K06/K14 fictional PostgreSQL verification in a disposable, network-isolated container."""
from pathlib import Path
import importlib.util
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('k06_postgres_fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

with fixture.DisposablePostgres() as db:
    db.bootstrap()
    out = db.sql((ROOT / 'supabase/tests/inpatient_continuation_pet_hotel.sql').read_text())
    if 'PASS K06/K14' not in out:
        raise RuntimeError('K06/K14 SQL check did not reach its PASS line:\n' + out)
    print(out.splitlines()[-1])
