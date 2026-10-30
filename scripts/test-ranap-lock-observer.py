#!/usr/bin/env python3
"""Unit tests of barrier observation only, not business or database integration."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('observer_suite', ROOT / 'scripts/test-ranap-mitigasi-concurrency-postgres.py')
assert spec is not None and spec.loader is not None
suite = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suite)


class Observer:
    def __init__(self, states):
        self.states = iter(states)
        self.calls = 0

    def sql(self, statement):
        self.calls += 1
        return [json.dumps(next(self.states))]


class LockObservationTest(unittest.TestCase):
    def test_matching_blocker_without_event_is_not_a_complete_barrier(self):
        incomplete = {'pid': 11, 'blockers': [22], 'wait_event_type': None, 'wait_event': None}
        waiting = {**incomplete, 'wait_event_type': 'Lock', 'wait_event': 'advisory'}
        observer = Observer([incomplete, waiting])
        waiter = SimpleNamespace(pid=11, name='waiter', p=SimpleNamespace(poll=lambda: None))
        blocker = SimpleNamespace(pid=22, name='blocker')
        evidence = []
        suite.wait_block(observer, waiter, blocker, evidence)
        self.assertEqual(observer.calls, 2)
        self.assertEqual(evidence, [waiting])

    def test_unrelated_blocker_does_not_satisfy_barrier(self):
        unrelated = {'pid': 11, 'blockers': [33], 'wait_event_type': 'Lock', 'wait_event': 'advisory'}
        expected = {**unrelated, 'blockers': [22]}
        observer = Observer([unrelated, expected])
        waiter = SimpleNamespace(pid=11, name='waiter', p=SimpleNamespace(poll=lambda: None))
        blocker = SimpleNamespace(pid=22, name='blocker')
        evidence = []
        suite.wait_block(observer, waiter, blocker, evidence)
        self.assertEqual(observer.calls, 2)
        self.assertEqual(evidence, [expected])


if __name__ == '__main__':
    unittest.main()
