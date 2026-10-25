#!/usr/bin/env python3
"""K07 fictional PostgreSQL verification in a disposable, in-memory container."""
from pathlib import Path
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
    db.sql(base.rsplit('rollback;', 1)[0] + rx + '\nrollback;')
    print('PASS K07 fictional handover, administration, retry, void, source integrity and cross-branch guards')
