#!/usr/bin/env python3
"""Run the concurrency_tests() of scripts/test-posted-sales-postgres.py on a throwaway native cluster.

That runner expects a local server on 127.0.0.1:5432; this starts one (trust auth, as the `postgres`
OS user when run as root), points the runner at it with PGUSER=postgres, runs only bootstrap +
concurrency_tests (its SQL suite list stops earlier on main at an unrelated opname guard in
posted_sale_cancellations.sql), then stops and deletes the cluster.

Usage: python3 docs/evidence/2026-10-29-q01-atomic/run-posted-sales-races.py [/usr/lib/postgresql/16/bin]
"""
from pathlib import Path
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
BIN = sys.argv[1] if len(sys.argv) > 1 else '/usr/lib/postgresql/16/bin'
AS_PG = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
work = tempfile.mkdtemp(prefix='vetos-q01races-', dir='/tmp')
if AS_PG:
    shutil.chown(work, 'postgres')
subprocess.run(AS_PG + [f'{BIN}/initdb', '-D', f'{work}/data', '-U', 'postgres', '-E', 'UTF8', '--locale=C.UTF-8', '-A', 'trust'],
               check=True, capture_output=True)
subprocess.run(AS_PG + [f'{BIN}/pg_ctl', '-D', f'{work}/data', '-l', f'{work}/log', '-w', 'start', '-o',
                        f'-c listen_addresses=127.0.0.1 -c port=5432 -k {work} -c timezone=Etc/UTC'], check=True, capture_output=True)
os.environ.update(PGUSER='postgres', PATH=BIN + ':' + os.environ['PATH'])
try:
    print('server:', subprocess.run([f'{BIN}/postgres', '--version'], capture_output=True, text=True).stdout.strip(), flush=True)
    spec = importlib.util.spec_from_file_location('posted_sales', ROOT / 'scripts/test-posted-sales-postgres.py')
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    runner.ENV.update(PGUSER='postgres', PATH=os.environ['PATH'])
    subprocess.run(['createdb', '-h127.0.0.1', '-p5432', runner.DB], check=True)
    runner.bootstrap_database()
    runner.concurrency_tests()
    print('posted-sales concurrency_tests: passed', flush=True)
finally:
    subprocess.run(AS_PG + [f'{BIN}/pg_ctl', '-D', f'{work}/data', '-m', 'fast', '-w', 'stop'], capture_output=True)
    shutil.rmtree(work, ignore_errors=True)
    print('cleanup: temp cluster removed' if not os.path.exists(work) else f'cleanup FAILED: {work}', flush=True)
