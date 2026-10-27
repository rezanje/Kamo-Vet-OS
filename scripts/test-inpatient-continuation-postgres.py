#!/usr/bin/env python3
"""K06/K14 fictional PostgreSQL verification in a disposable, network-isolated container.

1. supabase/tests/inpatient_continuation_pet_hotel.sql (rolled back).
2. Race: commits that file's fixture (up to @@COMMIT_POINT) inside the disposable database, then two
   independent sessions admit two different continuation visits of the SAME patient at the same time.
   Exactly one may win; the other must be refused with the one-live-stay error.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import importlib.util
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('k06_postgres_fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
SQL = (ROOT / 'supabase/tests/inpatient_continuation_pet_hotel.sql').read_text()
MARK = '-- @@COMMIT_POINT'
if MARK not in SQL or not SQL.rstrip().endswith('rollback;'):
    raise RuntimeError('K06/K14 fixture layout changed; review the race setup')

ADMIT = """begin;
set local role authenticated;
select set_config('request.jwt.claims','{{"role":"authenticated","sub":"d6100000-0000-4000-8000-000000000001"}}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d6100000-0000-4000-8000-000000000001',true);
select pg_sleep(0.2);
select public.clinic_admit_inpatient_typed(
  (select id from public.visits where continued_from_visit_id='{source}'),'DEMO race','{key}','{kind}');
commit;"""


def attempt(db, args):
    try:
        return ('ok', db.sql(ADMIT.format(**args)).splitlines()[-1])
    except RuntimeError as error:
        return ('refused', str(error))


with fixture.DisposablePostgres() as db:
    db.bootstrap()
    out = db.sql(SQL)
    if 'PASS K06/K14' not in out:
        raise RuntimeError('K06/K14 SQL check did not reach its PASS line:\n' + out)
    print(out.splitlines()[-1])

    db.sql(SQL.split(MARK)[0] + '\ncommit;')
    races = [
        {'source': 'd6600000-0000-4000-8000-000000000001', 'key': 'race-a', 'kind': 'pet_hotel'},
        {'source': 'd6600000-0000-4000-8000-000000000003', 'key': 'race-b', 'kind': 'sakit'},
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda args: attempt(db, args), races))
    wins = [r for r in results if r[0] == 'ok']
    refused = [r for r in results if r[0] == 'refused']
    if len(wins) != 1 or len(refused) != 1 or 'pasien sudah memiliki rawat inap aktif' not in refused[0][1]:
        raise RuntimeError(f'Concurrent admissions of one patient were not serialized: {results}')
    live = db.sql("""select count(*) from public.inpatient_records r join public.visits v on v.id=r.visit_id
      where v.pet_id='d6400000-0000-4000-8000-000000000001' and r.discharged_at is null;""")
    if live != '1':
        raise RuntimeError(f'Expected one live stay after the race, found {live}')
    print('PASS K06 race: two continuation visits of one patient admitted concurrently -> exactly one live stay')
