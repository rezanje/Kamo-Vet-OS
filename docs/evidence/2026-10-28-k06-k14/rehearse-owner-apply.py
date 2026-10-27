#!/usr/bin/env python3
"""Rehearse the K06/K14 owner package on a disposable database: every migration EXCEPT K06/K14, then
preflight -> apply -> apply again -> readback -> SQL acceptance -> rollback (empty) -> rollback refusal with data."""
from pathlib import Path
import importlib.util
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[3]
PKG = ROOT / 'docs/evidence/2026-10-28-k06-k14/owner-apply'
MIGRATION = '20261028120000_k06_k14_inpatient_continuation_pet_hotel.sql'
spec = importlib.util.spec_from_file_location('k06_fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def summary(db, name):
    out = db.sql((PKG / name).read_text())
    last = out.splitlines()[-1]
    print(name, '->', last)
    if not last.endswith('|t') or '0 failed' not in last:
        raise RuntimeError(f'{name} failed:\n{out}')


real_glob = Path.glob
Path.glob = lambda self, pattern: [p for p in real_glob(self, pattern) if p.name != MIGRATION]
with fixture.DisposablePostgres() as db:
    db.bootstrap()
    Path.glob = real_glob
    summary(db, 'preflight.sql')
    db.sql((PKG / 'apply.sql').read_text())
    db.sql((PKG / 'apply.sql').read_text())
    print('apply.sql -> applied twice (idempotent)')
    summary(db, 'readback.sql')
    out = db.sql((ROOT / 'supabase/tests/inpatient_continuation_pet_hotel.sql').read_text())
    print('acceptance ->', out.splitlines()[-1])
    db.sql((PKG / 'rollback.sql').read_text())
    if db.sql("select to_regprocedure('public.clinic_continue_visit_to_inpatient(uuid,text)') is null") != 't':
        raise RuntimeError('rollback left the RPC behind')
    summary(db, 'preflight.sql')
    print('rollback.sql -> clean rollback, preflight passes again')
    db.sql((PKG / 'apply.sql').read_text())
    sql = (ROOT / 'supabase/tests/inpatient_continuation_pet_hotel.sql').read_text()
    db.sql(sql.rsplit('rollback;', 1)[0] + 'commit;')
    try:
        db.sql((PKG / 'rollback.sql').read_text())
    except RuntimeError as error:
        if 'rollback refused' not in str(error):
            raise
        print('rollback.sql -> refused once real continuation/pet hotel data exists (as designed)')
    else:
        raise RuntimeError('rollback dropped columns that hold data')
    print('PASS K06/K14 owner package rehearsal')
