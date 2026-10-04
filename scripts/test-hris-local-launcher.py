#!/usr/bin/env python3
"""Credential-free launcher regressions, without starting the app or fixture DB."""
import importlib.util
import json
from pathlib import Path
import tempfile
import os
import signal
import socket
import subprocess
import sys
import time
import unittest

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('launcher', Path(__file__).with_name('hris-local-launcher.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.auth = self.root / 'local-auth.json'
        self.config = {'API_URL': 'http://127.0.0.1:55421', 'ANON_KEY': 'fiction-anon', 'SERVICE_ROLE_KEY': 'fiction-service'}
        self.auth.write_text(json.dumps(self.config))

    def tearDown(self):
        self.tmp.cleanup()

    def test_reject_remote_api_before_launch(self):
        self.config['API_URL'] = 'https://example.supabase.co'
        self.auth.write_text(json.dumps(self.config))
        with self.assertRaisesRegex(ValueError, 'fictional loopback'):
            launcher.local_environment(self.auth, {})

    def test_all_database_keys_override_inherited_remote_values(self):
        env = launcher.local_environment(self.auth, {'NEXT_PUBLIC_SUPABASE_URL': 'remote', 'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'remote', 'SUPABASE_SERVICE_ROLE_KEY': 'remote'})
        self.assertEqual(env['NEXT_PUBLIC_SUPABASE_URL'], self.config['API_URL'])
        self.assertEqual(env['NEXT_PUBLIC_SUPABASE_ANON_KEY'], 'fiction-anon')
        self.assertEqual(env['SUPABASE_SERVICE_ROLE_KEY'], 'fiction-service')

    def test_missing_local_key_rejected(self):
        del self.config['ANON_KEY']
        self.auth.write_text(json.dumps(self.config))
        with self.assertRaises(ValueError):
            launcher.local_environment(self.auth, {})

    def test_production_refuses_unverified_build_and_stale_stamp(self):
        env = launcher.local_environment(self.auth, {})
        (self.root / '.next').mkdir()
        (self.root / '.next/BUILD_ID').write_text('first-build')
        with self.assertRaisesRegex(ValueError, 'local build'):
            launcher.check_build(self.root, env)
        launcher.stamp_build(self.root, env)
        launcher.check_build(self.root, env)
        (self.root / '.next/BUILD_ID').write_text('different-build')
        with self.assertRaisesRegex(ValueError, 'local build'):
            launcher.check_build(self.root, env)

    def test_changed_local_anon_requires_rebuild(self):
        env = launcher.local_environment(self.auth, {})
        (self.root / '.next').mkdir()
        (self.root / '.next/BUILD_ID').write_text('first-build')
        launcher.stamp_build(self.root, env)
        env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'changed-fiction-anon'
        with self.assertRaises(ValueError):
            launcher.check_build(self.root, env)

    def test_supervisor_records_signal_instead_of_claiming_clean_exit(self):
        state = self.root / 'state.json'
        code = launcher.supervise([sys.executable, '-c', 'import os,signal;os.kill(os.getpid(),signal.SIGKILL)'], {}, self.root, state, {'mode': 'fixture'})
        self.assertEqual(code, -signal.SIGKILL)
        observed = json.loads(state.read_text())
        self.assertEqual(observed['status'], 'exited')
        self.assertEqual(observed['signal'], signal.SIGKILL)

    def test_detached_launcher_uses_local_env_and_records_exit_without_keys(self):
        fake_bin = self.root / 'bin'
        fake_bin.mkdir()
        fake_node = fake_bin / 'node'
        fake_node.write_text(f'#!{sys.executable}\nimport os\nassert os.environ["NEXT_PUBLIC_SUPABASE_URL"] == "http://127.0.0.1:55421"\nassert os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"] == "fiction-anon"\nassert os.environ["SUPABASE_SERVICE_ROLE_KEY"] == "fiction-service"\n')
        fake_node.chmod(0o700)
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        result = subprocess.run([sys.executable, str(Path(launcher.__file__)), '--mode', 'dev', '--port', str(port), '--app-root', str(self.root), '--runtime', str(self.root), '--detach'], env={**os.environ, 'PATH': str(fake_bin), 'SUPABASE_SERVICE_ROLE_KEY': 'remote'}, text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        state = self.root / f'dev-{port}.state.json'
        for _ in range(100):
            if state.exists() and json.loads(state.read_text())['status'] == 'exited':
                break
            time.sleep(.02)
        observed = json.loads(state.read_text())
        self.assertEqual(observed['returncode'], 0)
        self.assertEqual(observed['status'], 'exited')
        combined = result.stdout + result.stderr + (self.root / f'dev-{port}.log').read_text() + state.read_text()
        self.assertNotIn('fiction-anon', combined)
        self.assertNotIn('fiction-service', combined)


if __name__ == '__main__':
    unittest.main()
