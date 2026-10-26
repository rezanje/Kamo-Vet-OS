#!/usr/bin/env python3
"""K07 fictional PostgreSQL verification in a disposable, in-memory container."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import subprocess
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py'
spec = importlib.util.spec_from_file_location('k07_postgres_fixture', source)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class InMemoryPostgres(fixture.DisposablePostgres):
    def __enter__(self):
        fixture.docker('run', '--pull=never', '--rm', '-d', '--name', self.container,
                       '--label', 'kamo-purpose=fictional-inpatient-rx-evidence-test',
                       '--network', 'none', '--tmpfs', '/var/lib/postgresql/data:rw,size=512m',
                       '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', fixture.IMAGE)
        self.started = True
        try:
            for _ in range(200):
                ready = subprocess.run(fixture.DOCKER + ['exec', self.container, 'pg_isready', '-U', 'postgres'], capture_output=True)
                logs = fixture.docker('logs', self.container)
                if ready.returncode == 0 and 'PostgreSQL init process complete' in logs.stdout + logs.stderr:
                    return self
                time.sleep(0.1)
            raise RuntimeError('Owned PostgreSQL test container did not become ready')
        except BaseException:
            self.__exit__(None, None, None)
            raise


with InMemoryPostgres() as db:
    db.bootstrap()
    base = (ROOT / 'supabase/tests/inpatient_consent.sql').read_text()
    if not base.rstrip().endswith('rollback;'):
        raise RuntimeError('Inpatient fixture no longer ends with ROLLBACK; review setup')
    rx = (ROOT / 'supabase/tests/inpatient_rx_evidence.sql').read_text()
    paid_stay = (ROOT / 'supabase/tests/inpatient_paid_stay_source.sql').read_text()
    # Commit fictional rows only inside this disposable tmpfs database so two
    # independent psql sessions can exercise the same request concurrently.
    db.sql(base.rsplit('rollback;', 1)[0] + rx + paid_stay + '\ncommit;')
    same_request = """begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"ca100000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','ca100000-0000-4000-8000-000000000001',true);
select public.clinic_record_rx_evidence(
  (select id from public.inpatient_records where visit_id='ca600000-0000-4000-8000-000000000004'),
  'ca910000-0000-4000-8000-000000000001','handover',1,null,null,
  'rx-evidence-concurrent-demo-01');
commit;"""
    with ThreadPoolExecutor(max_workers=2) as pool:
        attempts = list(pool.map(db.sql, [same_request, same_request]))
    returned = [attempt.splitlines()[-1] for attempt in attempts]
    if len(set(returned)) != 1:
        raise RuntimeError('Concurrent identical requests returned different evidence IDs')
    count = db.sql("select count(*) from public.inpatient_rx_evidence where request_key='rx-evidence-concurrent-demo-01';")
    if count != '1':
        raise RuntimeError('Concurrent identical requests created duplicate evidence')
    db.sql((ROOT / 'supabase/tests/inpatient_redischarged_source.sql').read_text())
    print('PASS K07 fictional handover, administration, concurrent retry, void, stay-to-fee binding, source integrity and cross-branch guards')
