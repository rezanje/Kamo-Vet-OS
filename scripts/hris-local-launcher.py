#!/usr/bin/env python3
"""Independent fictional LOCAL build/server/gateway launcher; never prints keys.

Detached mode removes dependence on the acceptance script's process lifetime.
It cannot survive an environment-wide SIGKILL. State records observed child
exit codes; external termination of the supervisor itself cannot be recorded.
Production start requires this launcher's local build stamp because public
Supabase settings are embedded in Next browser bundles at build time.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path('/workspace/hris-local-runtime')


def local_environment(auth_path, inherited):
    config = json.loads(auth_path.read_text())
    if config.get('API_URL') != 'http://127.0.0.1:55421':
        raise ValueError('Refuse any API except the named fictional loopback target')
    if not all(isinstance(config.get(key), str) and config[key] for key in ['ANON_KEY', 'SERVICE_ROLE_KEY']):
        raise ValueError('Generated local auth keys required')
    return {**inherited, 'NEXT_PUBLIC_SUPABASE_URL': config['API_URL'],
            'NEXT_PUBLIC_SUPABASE_ANON_KEY': config['ANON_KEY'],
            'SUPABASE_SERVICE_ROLE_KEY': config['SERVICE_ROLE_KEY'], 'NEXT_TELEMETRY_DISABLED': '1'}


def private_json(path, data):
    # Runtime data is outside git; build stamp is inside ignored .next.
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix=path.name + '.', delete=False) as stream:
        json.dump(data, stream, indent=2)
        temporary = Path(stream.name)
    temporary.chmod(0o600)
    os.replace(temporary, path)


def build_identity(root, env):
    public_config = [env['NEXT_PUBLIC_SUPABASE_URL'], env['NEXT_PUBLIC_SUPABASE_ANON_KEY']]
    return {'buildId': (root / '.next/BUILD_ID').read_text().strip(),
            'localPublicConfigDigest': hashlib.sha256(json.dumps(public_config).encode()).hexdigest()}


def stamp_build(root, env):
    private_json(root / '.next/hris-local-build.json', build_identity(root, env))


def check_build(root, env):
    try:
        stamp = json.loads((root / '.next/hris-local-build.json').read_text())
        expected = build_identity(root, env)
    except (OSError, ValueError):
        raise ValueError('Verified local build required: run this launcher --mode build first') from None
    if stamp != expected:
        raise ValueError('Verified local build changed: run this launcher --mode build again')


def supervise(command, env, cwd, state, metadata):
    child = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL)
    private_json(state, {**metadata, 'status': 'running', 'supervisorPid': os.getpid(), 'childPid': child.pid})
    previous = {}
    for sig in [signal.SIGINT, signal.SIGTERM]:
        previous[sig] = signal.signal(sig, lambda received, _frame: child.send_signal(received) if child.poll() is None else None)
    try:
        code = child.wait()
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    private_json(state, {**metadata, 'status': 'exited', 'supervisorPid': os.getpid(),
                         'childPid': child.pid, 'returncode': code, 'signal': -code if code < 0 else None})
    return code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['dev', 'build', 'start', 'gateway'], default='dev')
    parser.add_argument('--port', type=int, default=3108, help='App bind port; gateway always uses 55421')
    parser.add_argument('--app-root', type=Path, default=ROOT)
    parser.add_argument('--runtime', type=Path, default=RUNTIME)
    parser.add_argument('--detach', action='store_true', help='Separate session with runtime log/state; no readiness claim')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        raise ValueError('App port must be between 1024 and 65535')
    args.app_root = args.app_root.resolve()
    args.runtime = args.runtime.resolve()
    args.runtime.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ) if args.mode == 'gateway' else local_environment(args.runtime / 'local-auth.json', os.environ)
    if args.mode == 'start':
        check_build(args.app_root, env)
    node = shutil.which('node')
    if not node:
        raise ValueError('Installed node required')
    port = 55421 if args.mode == 'gateway' else args.port
    label = f'{args.mode}-{port}'
    state = args.runtime / f'{label}.state.json'
    if args.mode != 'build':
        # Fail before detach if another listener owns this local fixture endpoint.
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', port))
    if args.detach:
        log = args.runtime / f'{label}.log'
        descriptor = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(descriptor, 'a') as stream:
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--mode', args.mode,
                                      '--port', str(args.port), '--app-root', str(args.app_root),
                                      '--runtime', str(args.runtime)], start_new_session=True,
                                     stdin=subprocess.DEVNULL, stdout=stream, stderr=stream, env=env)
        print(f'LOCAL {args.mode} supervisor PID {child.pid}; log {log}; state {state}; verify readiness separately', flush=True)
        return 0
    if args.mode == 'gateway':
        command = [node, str(ROOT / 'scripts/hris-local-gateway.mjs')]
    else:
        command = [node, str(args.app_root / 'node_modules/next/dist/bin/next'), args.mode]
        if args.mode != 'build':
            command += ['--hostname', '127.0.0.1', '--port', str(args.port)]
    print(f'LOCAL {args.mode} at loopback port {port}; state {state}', flush=True)
    code = supervise(command, env, args.app_root, state, {'mode': args.mode, 'port': port, 'appRoot': str(args.app_root)})
    if args.mode == 'build' and code == 0:
        stamp_build(args.app_root, env)
    return code if code >= 0 else 128 - code


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError):
        # Do not echo exception strings that might include malformed credential JSON.
        print('LOCAL launcher refused: check loopback fixture config, local build stamp, installed node and free port', file=sys.stderr)
        sys.exit(1)
