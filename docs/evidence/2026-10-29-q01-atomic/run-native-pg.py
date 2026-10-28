#!/usr/bin/env python3
"""Run an existing Docker-based repository runner unchanged on a throwaway native PostgreSQL cluster.

Copy of docs/evidence/2026-10-28-c05-q01/run-native-pg.py, patched for a Linux container running as
root: initdb/pg_ctl run as the `postgres` OS user (initdb refuses root), the work dir is owned by
postgres, and the locale is C.UTF-8 (en_US.UTF-8 is not generated here). Every `docker ...` call the
runner makes is translated to a local equivalent; its bootstrap SQL, migration order and test list are
executed exactly as written. The cluster listens on a unix socket only and is deleted afterwards.

Usage: python3 docs/evidence/2026-10-29-q01-atomic/run-native-pg.py [scripts/test-c05-q01-postgres.py] [/usr/lib/postgresql/16/bin]

Known differences from the Docker postgres:16 image (report them, do not assume equivalence):
- PostgreSQL minor version and build are Ubuntu's, not the official Debian image.
- Collation is C.UTF-8, not glibc en_US.utf8 (affects text ordering only).
"""
from pathlib import Path
import os
import runpy
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
RUNNER = ROOT / (sys.argv[1] if len(sys.argv) > 1 else 'scripts/test-c05-q01-postgres.py')
BIN = Path(sys.argv[2] if len(sys.argv) > 2 else '/usr/lib/postgresql/16/bin')
WORK = Path(tempfile.mkdtemp(prefix='vetos-q01atomic-', dir='/tmp'))
DATA, SOCK, PORT = WORK / 'data', WORK / 'sock', '54329'
SOCK.mkdir()
AS_PG = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
if AS_PG:
    shutil.chown(WORK, 'postgres')
    shutil.chown(SOCK, 'postgres')

# Same client environment as inside the container: no user psqlrc, no inherited PG* settings.
for key in [k for k in os.environ if k.startswith('PG')]:
    del os.environ[key]
os.environ.update(PSQLRC='/dev/null', TZ='Etc/UTC', LC_ALL='C.UTF-8')

real_run = subprocess.run
conn = ['-h', str(SOCK), '-p', PORT, '-U', 'postgres']


def fake_run(args, *a, **kw):
    if not args or args[0] != 'docker':
        return real_run(args, *a, **kw)
    cmd = args[1]
    if cmd == 'run':
        real_run(AS_PG + [str(BIN / 'initdb'), '-D', str(DATA), '-U', 'postgres', '-E', 'UTF8', '--locale=C.UTF-8', '--auth=trust'], check=True, capture_output=True)
        conf = (f"\nlisten_addresses = ''\nunix_socket_directories = '{SOCK}'\nport = {PORT}\ntimezone = 'Etc/UTC'\nlog_timezone = 'Etc/UTC'\n")
        real_run(AS_PG + ['sh', '-c', f'cat >> {DATA}/postgresql.conf'], input=conf, text=True, check=True)
        return real_run(AS_PG + [str(BIN / 'pg_ctl'), '-D', str(DATA), '-l', str(WORK / 'server.log'), '-w', 'start'], *a, **kw)
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
            real_run(AS_PG + [str(BIN / 'pg_ctl'), '-D', str(DATA), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(WORK, ignore_errors=True)
        return subprocess.CompletedProcess(args, 0, '', '')
    raise RuntimeError(f'untranslated docker call: {args}')


subprocess.run = fake_run
print('server:', real_run([BIN / 'postgres', '--version'], capture_output=True, text=True).stdout.strip(), '| cluster:', WORK, '| runner:', RUNNER.relative_to(ROOT))
runpy.run_path(str(RUNNER), run_name='__main__')
print('cleanup: temp cluster removed' if not WORK.exists() else f'cleanup FAILED: {WORK}')
