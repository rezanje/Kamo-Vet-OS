#!/usr/bin/env python3
"""Run an unchanged repository Docker-based PostgreSQL test script on a throwaway native cluster (no Docker).

Usage: python3 docs/evidence/2026-10-28-k03-j01-s04/run-native-pg.py <scripts/test-...py> [script args...]
Env PG_BIN selects the server (default /opt/homebrew/opt/postgresql@17/bin).

Every `docker ...` call (subprocess.run and subprocess.Popen, with or without `--host=...`) is translated to a
local equivalent. The cluster lives in a fresh temp dir, listens on a unix socket only, and is deleted
afterwards. It never accepts a database URL and never touches an existing cluster.
Known differences from the postgres:16 image: Homebrew build/minor version, macOS libc en_US.UTF-8 collation.
"""
from pathlib import Path
import os
import runpy
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
BIN = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
WORK = Path(tempfile.mkdtemp(prefix='vetos-k03j01s04-', dir='/tmp'))
DATA, SOCK, PORT = WORK / 'data', WORK / 'sock', '54331'
SOCK.mkdir()
for key in [k for k in os.environ if k.startswith('PG') and k != 'PG_BIN']:
    del os.environ[key]
os.environ.update(PSQLRC='/dev/null', TZ='Etc/UTC', LC_ALL='en_US.UTF-8')

real_run, RealPopen = subprocess.run, subprocess.Popen
conn = ['-h', str(SOCK), '-p', PORT, '-U', 'postgres']


def translate(args):
    """Return ('local', argv) for exec calls or ('done', CompletedProcess) for lifecycle calls."""
    args = [str(a) for a in args]
    rest = [a for a in args[1:] if not a.startswith('--host')]
    cmd = rest[0]
    if cmd == 'run':
        real_run([BIN / 'initdb', '-D', DATA, '-U', 'postgres', '-E', 'UTF8', '--locale=en_US.UTF-8', '--auth=trust'], check=True, capture_output=True)
        with open(DATA / 'postgresql.conf', 'a') as conf:
            conf.write(f"\nlisten_addresses = ''\nunix_socket_directories = '{SOCK}'\nport = {PORT}\ntimezone = 'Etc/UTC'\nlog_timezone = 'Etc/UTC'\nmax_connections = 50\n")
        real_run([BIN / 'pg_ctl', '-D', DATA, '-l', WORK / 'server.log', '-w', 'start'], check=True, capture_output=True)
        return 'done', subprocess.CompletedProcess(args, 0, 'started', '')
    if cmd == 'logs':
        return 'done', subprocess.CompletedProcess(args, 0, 'PostgreSQL init process complete', '')
    if cmd == 'exec':
        rest = rest[1:]
        if rest[0] == '-i':
            rest = rest[1:]
        tool, opts = rest[1], rest[2:]
        if tool == 'pg_isready':
            return 'local', [str(BIN / 'pg_isready'), *conn]
        if tool == 'psql':
            opts = [o for i, o in enumerate(opts) if not (o == '-U' or (i and opts[i - 1] == '-U'))]
            return 'local', [str(BIN / 'psql'), *conn, '-d', 'postgres', *opts]
    if cmd == 'rm':
        if (DATA / 'postmaster.pid').exists():
            real_run([BIN / 'pg_ctl', '-D', DATA, '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(WORK, ignore_errors=True)
        return 'done', subprocess.CompletedProcess(args, 0, '', '')
    raise RuntimeError(f'untranslated docker call: {args}')


def fake_run(args, *a, **kw):
    if not args or str(args[0]) != 'docker':
        return real_run(args, *a, **kw)
    kind, value = translate(args)
    return value if kind == 'done' else real_run(value, *a, **kw)


class FakePopen(RealPopen):
    def __init__(self, args, *a, **kw):
        if args and str(args[0]) == 'docker':
            kind, value = translate(args)
            assert kind == 'local', f'unsupported Popen docker call: {args}'
            args = value
        super().__init__(args, *a, **kw)


subprocess.run, subprocess.Popen = fake_run, FakePopen
script = Path(sys.argv[1]).resolve()
sys.argv = [str(script), *sys.argv[2:]]
print('server:', real_run([BIN / 'postgres', '--version'], capture_output=True, text=True).stdout.strip(), '| cluster: <temp>', flush=True)
try:
    runpy.run_path(str(script), run_name='__main__')
finally:
    if (DATA / 'postmaster.pid').exists():
        real_run([BIN / 'pg_ctl', '-D', DATA, '-m', 'immediate', 'stop'], capture_output=True)
    shutil.rmtree(WORK, ignore_errors=True)
    print('cleanup: temp cluster removed' if not WORK.exists() else f'cleanup FAILED: {WORK}', flush=True)
