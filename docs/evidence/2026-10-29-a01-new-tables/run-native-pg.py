#!/usr/bin/env python3
"""Run a repository Docker-based SQL runner unchanged on a throwaway native PostgreSQL cluster.

Same idea as docs/evidence/2026-10-26-k02-bmhp/run-native-pg.py, adapted for a Linux
container where the session runs as root: initdb/pg_ctl run as the `postgres` OS user
(runuser), the cluster lives in a fresh temp dir under /tmp owned by `postgres`, listens
on a unix socket only (listen_addresses=''), and is deleted afterwards. psql connects as
the `postgres` database role over that socket. It never accepts a database URL and never
touches an existing cluster.

Usage (from the repository root, as root):
  python3 docs/evidence/2026-10-29-a01-new-tables/run-native-pg.py \
      scripts/test-activity-audit-postgres.py [runner args...]
Environment: PG_BIN (default /usr/lib/postgresql/16/bin).
Docker calls (subprocess.run and the Popen race helpers) are translated to the local cluster.
Runners that already start their own native cluster (e.g. test-clinic-record-history-postgres.py,
pass the bin dir as runner arg) get their initdb/pg_ctl calls re-run as `postgres` with C.UTF-8.

Known differences from the Docker postgres:16 image (report them, do not assume equivalence):
- PostgreSQL minor version/build is the distribution package, not the official image.
- Collation is C.UTF-8 (en_US.UTF-8 is not installed here); affects text ordering only.
"""
from pathlib import Path
import os
import runpy
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
BIN = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
RUNNER = (ROOT / sys.argv[1]).resolve()
if RUNNER.parent != (ROOT / 'scripts').resolve() or not RUNNER.name.startswith('test-'):
    raise SystemExit('Expected a scripts/test-*.py runner')
WORK = Path(tempfile.mkdtemp(prefix='vetos-a01-native-'))
DATA, SOCK, PORT = WORK / 'data', WORK / 'sock', '54337'
SOCK.mkdir()
shutil.chown(WORK, 'postgres', 'postgres')
shutil.chown(SOCK, 'postgres', 'postgres')
AS_PG = ['runuser', '-u', 'postgres', '--']

for key in [k for k in os.environ if k.startswith('PG') and k != 'PG_BIN']:
    del os.environ[key]
os.environ.update(PSQLRC='/dev/null', TZ='Etc/UTC', LC_ALL='C.UTF-8')

real_run = subprocess.run
conn = ['-h', str(SOCK), '-p', PORT, '-U', 'postgres']


def as_postgres(args):
    """Native runners call initdb/pg_ctl themselves; as root they must run as `postgres`."""
    args = [str(x).replace('en_US.UTF-8', 'C.UTF-8') for x in args]
    if '-D' in args:
        work = Path(args[args.index('-D') + 1]).parent
        real_run(['chown', '-R', 'postgres:postgres', str(work)], check=True)
    return AS_PG + args


def fake_run(args, *a, **kw):
    if isinstance(args, (list, tuple)) and args and Path(str(args[0])).name in ('initdb', 'pg_ctl') and os.geteuid() == 0:
        return real_run(as_postgres(args), *a, **kw)
    if not args or args[0] != 'docker':
        return real_run(args, *a, **kw)
    args = [args[0]] + [x for x in args[1:] if not str(x).startswith('--host')]
    cmd = args[1]
    if cmd == 'run':
        real_run(AS_PG + [str(BIN / 'initdb'), '-D', str(DATA), '-U', 'postgres', '-E', 'UTF8', '--locale=C.UTF-8', '--auth=trust'],
                 check=True, capture_output=True)
        conf = f"\nlisten_addresses = ''\nunix_socket_directories = '{SOCK}'\nport = {PORT}\ntimezone = 'Etc/UTC'\nlog_timezone = 'Etc/UTC'\n"
        real_run(AS_PG + ['sh', '-c', f'cat >> "{DATA / "postgresql.conf"}"'], input=conf, text=True, check=True)
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


real_popen = subprocess.Popen


def psql_args(args):
    """Translate a `docker exec [-i] <container> psql ...` command (race tests use Popen)."""
    args = [x for x in args[1:] if not str(x).startswith('--host')]
    rest = args[1:]
    if rest and rest[0] == '-i':
        rest = rest[1:]
    opts = rest[2:]
    opts = [o for i, o in enumerate(opts) if not (o == '-U' or (i and opts[i - 1] == '-U'))]
    return [BIN / 'psql', *conn, '-d', 'postgres', *opts]


def fake_popen(args, *a, **kw):
    if isinstance(args, (list, tuple)) and args and args[0] == 'docker' and 'exec' in args and 'psql' in args:
        return real_popen(psql_args(list(args)), *a, **kw)
    return real_popen(args, *a, **kw)


subprocess.run = fake_run
subprocess.Popen = fake_popen
print('server:', real_run([BIN / 'postgres', '--version'], capture_output=True, text=True).stdout.strip(), '| cluster:', WORK, flush=True)
sys.argv = [str(RUNNER)] + sys.argv[2:]
try:
    runpy.run_path(str(RUNNER), run_name='__main__')
finally:
    if (DATA / 'postmaster.pid').exists():
        real_run(AS_PG + [str(BIN / 'pg_ctl'), '-D', str(DATA), '-m', 'immediate', 'stop'], capture_output=True)
    shutil.rmtree(WORK, ignore_errors=True)
    print('cleanup: temp cluster removed' if not WORK.exists() else f'cleanup FAILED: {WORK}', flush=True)
