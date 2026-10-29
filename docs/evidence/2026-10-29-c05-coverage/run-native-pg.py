#!/usr/bin/env python3
"""Run scripts/test-c05-coverage-postgres.py unchanged on a throwaway native PostgreSQL 16 cluster (no Docker).

Every `docker ...` call the runner makes is translated to a local equivalent; the runner's bootstrap SQL,
migration order, test list and races are executed exactly as written.
The cluster lives in a fresh temp dir, listens on a unix socket only (listen_addresses=''), and is
deleted afterwards. It never accepts a database URL and never touches an existing cluster.

Usage (Linux, as root; initdb/pg_ctl run as the `postgres` OS user because initdb refuses root):
  python3 docs/evidence/2026-10-29-c05-coverage/run-native-pg.py [/usr/lib/postgresql/16/bin]
When not root, the server runs as the current user.

Known differences from the Docker postgres:16 image (report them, do not assume equivalence):
- PostgreSQL minor version and build are the distribution's, not the official Debian image.
- Cluster locale is C.UTF-8 (en_US.UTF-8 is not installed here); affects text ordering only.
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
WORK = Path(tempfile.mkdtemp(prefix='vetos-c05cov-', dir='/tmp'))
DATA, SOCK, PORT = WORK / 'data', WORK / 'sock', '54339'
SOCK.mkdir()
AS_SERVER = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
if AS_SERVER:
    for path in (WORK, SOCK):
        shutil.chown(path, 'postgres')

# Same client environment as inside the container: no user psqlrc, no inherited PG* settings.
for key in [k for k in os.environ if k.startswith('PG')]:
    del os.environ[key]
os.environ.update(PSQLRC='/dev/null', TZ='Etc/UTC', LC_ALL='C.UTF-8')

real_run = subprocess.run
conn = ['-h', str(SOCK), '-p', PORT, '-U', 'postgres']


def server(*args, **kw):
    return real_run([*AS_SERVER, *map(str, args)], cwd=WORK, **kw)


def fake_run(args, *a, **kw):
    if not args or args[0] != 'docker':
        return real_run(args, *a, **kw)
    cmd = args[1]
    if cmd == 'run':
        server(BIN / 'initdb', '-D', DATA, '-U', 'postgres', '-E', 'UTF8', '--locale=C.UTF-8', '--auth=trust', check=True, capture_output=True)
        with open(DATA / 'postgresql.conf', 'a') as conf:
            conf.write(f"\nlisten_addresses = ''\nunix_socket_directories = '{SOCK}'\nport = {PORT}\ntimezone = 'Etc/UTC'\nlog_timezone = 'Etc/UTC'\n")
        return server(BIN / 'pg_ctl', '-D', DATA, '-l', WORK / 'server.log', '-w', 'start', **kw)
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
            server(BIN / 'pg_ctl', '-D', DATA, '-m', 'immediate', 'stop', capture_output=True)
        shutil.rmtree(WORK, ignore_errors=True)
        return subprocess.CompletedProcess(args, 0, '', '')
    raise RuntimeError(f'untranslated docker call: {args}')


subprocess.run = fake_run
print('server:', real_run([BIN / 'postgres', '--version'], capture_output=True, text=True).stdout.strip(), '| cluster:', WORK)
runpy.run_path(str(ROOT / 'scripts/test-c05-coverage-postgres.py'), run_name='__main__')
print('cleanup: temp cluster removed' if not WORK.exists() else f'cleanup FAILED: {WORK}')
