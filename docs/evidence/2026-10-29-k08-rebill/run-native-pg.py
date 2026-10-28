#!/usr/bin/env python3
"""Run a Docker-based repository SQL runner unchanged on a throwaway native PostgreSQL cluster (no Docker).

Default target: scripts/test-k08-inpatient-rebill-postgres.py. Another runner can be chosen with
K08_TARGET=<repo-relative path> (e.g. scripts/test-clinic-billing-consistency-postgres.py).

Every `docker ...` call the runner makes is translated to a local equivalent; the runner's bootstrap SQL,
migration order and test list are executed exactly as written. The cluster lives in a fresh temp dir,
listens on a unix socket only (listen_addresses=''), and is deleted afterwards. It never accepts a
database URL and never touches an existing cluster.

Usage: python3 docs/evidence/2026-10-29-k08-rebill/run-native-pg.py [/usr/lib/postgresql/16/bin]

Differences from the Docker postgres:16 image (reported, not assumed equivalent):
- PostgreSQL minor version and build come from the host distribution, not the official Debian image.
- Collation is C.UTF-8 (the host has no en_US.UTF-8 locale); affects text ordering only.
- When started as root, server-side binaries run as the `postgres` OS user (initdb refuses root).
"""
from pathlib import Path
import os
import runpy
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
BIN = Path(sys.argv[1] if len(sys.argv) > 1 else '/usr/lib/postgresql/16/bin')
WORK = Path(tempfile.mkdtemp(prefix='vetos-k08-rebill-native-'))
DATA, SOCK, PORT = WORK / 'data', WORK / 'sock', '54329'
SOCK.mkdir()
AS_SERVER = []
if os.geteuid() == 0:
    for path in (WORK, SOCK):
        shutil.chown(path, 'postgres', 'postgres')
    AS_SERVER = ['runuser', '-u', 'postgres', '--']

# Same client environment as inside the container: no user psqlrc, no inherited PG* settings.
for key in [k for k in os.environ if k.startswith('PG')]:
    del os.environ[key]
os.environ.update(PSQLRC='/dev/null', TZ='Etc/UTC', LC_ALL='C.UTF-8')

real_run = subprocess.run
conn = ['-h', str(SOCK), '-p', PORT, '-U', 'postgres']


def fake_run(args, *a, **kw):
    if not args or args[0] != 'docker':
        return real_run(args, *a, **kw)
    args = [x for x in args if not str(x).startswith('--host=')]
    cmd = args[1]
    if cmd == 'run':
        real_run([*AS_SERVER, BIN / 'initdb', '-D', DATA, '-U', 'postgres', '-E', 'UTF8', '--locale=C.UTF-8', '--auth=trust'], check=True, capture_output=True)
        with open(DATA / 'postgresql.conf', 'a') as conf:
            conf.write(f"\nlisten_addresses = ''\nunix_socket_directories = '{SOCK}'\nport = {PORT}\ntimezone = 'Etc/UTC'\nlog_timezone = 'Etc/UTC'\n")
        return real_run([*AS_SERVER, BIN / 'pg_ctl', '-D', DATA, '-l', WORK / 'server.log', '-w', 'start'], *a, **kw)
    if cmd == 'logs':
        return subprocess.CompletedProcess(args, 0, 'PostgreSQL init process complete', '')
    if cmd == 'exec':
        rest = args[2:]
        if rest[0] == '-i':
            rest = rest[1:]
        tool, opts = rest[1], rest[2:]
        if tool == 'pg_isready':
            return real_run([BIN / 'pg_isready', *conn], *a, **kw)
        if tool == 'psql':
            opts = [o for i, o in enumerate(opts) if not (o == '-U' or (i and opts[i - 1] == '-U'))]
            return real_run([BIN / 'psql', *conn, '-d', 'postgres', *opts], *a, **kw)
    if cmd == 'rm':
        if (DATA / 'postmaster.pid').exists():
            real_run([*AS_SERVER, BIN / 'pg_ctl', '-D', DATA, '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(WORK, ignore_errors=True)
        return subprocess.CompletedProcess(args, 0, '', '')
    raise RuntimeError(f'untranslated docker call: {args}')


subprocess.run = fake_run
print('server:', real_run([BIN / 'postgres', '--version'], capture_output=True, text=True).stdout.strip(), '| cluster:', WORK, flush=True)
try:
    runpy.run_path(str(ROOT / os.environ.get('K08_TARGET', 'scripts/test-k08-inpatient-rebill-postgres.py')), run_name='__main__')
finally:
    if (DATA / 'postmaster.pid').exists():
        real_run([*AS_SERVER, BIN / 'pg_ctl', '-D', DATA, '-m', 'immediate', 'stop'], capture_output=True)
    shutil.rmtree(WORK, ignore_errors=True)
    print('cleanup: temp cluster removed' if not WORK.exists() else f'cleanup FAILED: {WORK}', flush=True)
