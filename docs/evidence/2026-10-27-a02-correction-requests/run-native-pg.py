#!/usr/bin/env python3
"""Run a Docker-based repository Postgres test script on a throwaway native cluster (no Docker).

Usage: python3 docs/evidence/2026-10-27-a02-correction-requests/run-native-pg.py \
         [--bin /usr/lib/postgresql/16/bin] scripts/test-purchase-correction-requests-postgres.py [script args]

Each `docker ...` call is translated to a local equivalent. The cluster lives in a fresh temp
dir, listens on a unix socket only (listen_addresses=''), and is deleted afterwards. It never
accepts a database URL and never touches an existing cluster. When run as root, server
processes run as the `postgres` OS user (initdb refuses root).
"""
from pathlib import Path
import argparse
import os
import runpy
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser()
parser.add_argument('--bin', default='/usr/lib/postgresql/16/bin')
parser.add_argument('script')
args, script_args = parser.parse_known_args()
BIN = Path(args.bin)
WORK = Path(tempfile.mkdtemp(prefix='vetos-native-pg-'))
DATA, SOCK, PORT = WORK / 'data', WORK / 'sock', '54331'
SOCK.mkdir()
AS_SERVER = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
if AS_SERVER:
    shutil.chown(WORK, 'postgres')
    shutil.chown(SOCK, 'postgres')
for key in [k for k in os.environ if k.startswith('PG')]:
    del os.environ[key]
os.environ.update(PSQLRC='/dev/null', TZ='Etc/UTC')
real_run = subprocess.run
real_popen = subprocess.Popen
conn = ['-h', str(SOCK), '-p', PORT, '-U', 'postgres']


def translate(args):
    rest = [a for a in args[1:] if not a.startswith('--host=')]
    cmd = rest[0]
    if cmd == 'exec':
        rest = [a for a in rest[1:] if a != '-i']
        tool, opts = rest[1], rest[2:]
        if tool == 'pg_isready':
            return [BIN / 'pg_isready', *conn]
        if tool == 'psql':
            opts = [o for i, o in enumerate(opts) if not (o == '-U' or (i and opts[i - 1] == '-U'))]
            return [BIN / 'psql', *conn, '-d', 'postgres', *opts]
    raise RuntimeError(f'untranslated docker call: {args}')


def fake_run(args, *a, **kw):
    if not args or args[0] != 'docker':
        return real_run(args, *a, **kw)
    rest = [x for x in args[1:] if not x.startswith('--host=')]
    if rest[0] == 'run':
        real_run([*AS_SERVER, BIN / 'initdb', '-D', DATA, '-U', 'postgres', '-E', 'UTF8', '--locale=C.UTF-8', '--auth=trust'], check=True, capture_output=True)
        with open(DATA / 'postgresql.conf', 'a') as conf:
            conf.write(f"\nlisten_addresses = ''\nunix_socket_directories = '{SOCK}'\nport = {PORT}\ntimezone = 'Etc/UTC'\nlog_timezone = 'Etc/UTC'\n")
        return real_run([*AS_SERVER, BIN / 'pg_ctl', '-D', DATA, '-l', WORK / 'server.log', '-w', 'start'], *a, **kw)
    if rest[0] == 'logs':
        return subprocess.CompletedProcess(args, 0, 'PostgreSQL init process complete', '')
    if rest[0] == 'rm':
        if (DATA / 'postmaster.pid').exists():
            real_run([*AS_SERVER, BIN / 'pg_ctl', '-D', DATA, '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(WORK, ignore_errors=True)
        return subprocess.CompletedProcess(args, 0, '', '')
    return real_run(translate(args), *a, **kw)


class FakePopen(real_popen):
    def __init__(self, args, *a, **kw):
        if args and args[0] == 'docker':
            args = translate(args)
        super().__init__(args, *a, **kw)


subprocess.run = fake_run
subprocess.Popen = FakePopen
print('server:', real_run([BIN / 'postgres', '--version'], capture_output=True, text=True).stdout.strip(), '| cluster:', WORK, flush=True)
try:
    sys.argv = [str(ROOT / args.script), *script_args]
    runpy.run_path(str(ROOT / args.script), run_name='__main__')
finally:
    if WORK.exists():
        fake_run(['docker', 'rm'])
print('cleanup: temp cluster removed' if not WORK.exists() else f'cleanup FAILED: {WORK}')
