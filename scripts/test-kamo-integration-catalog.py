#!/usr/bin/env python3
"""Fail-closed parity regression tests using synthetic metadata only."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('catalog', Path(__file__).with_name('kamo-integration-catalog.py'))
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


class CatalogParityTest(unittest.TestCase):
    def setUp(self):
        self.target = {kind: [] for kind in ('functions', 'tables', 'triggers', 'policies', 'views', 'enums', 'schemas')}
        self.target['views'] = [{'schema': 'public', 'name': 'fiction_branch_sales',
                                 'definition': 'SELECT id FROM sales WHERE branch_id = current_branch();'}]

    def check(self, local):
        catalog.require_covered_parity(catalog.compare_catalog(local, self.target))

    def test_unchanged_metadata_passes(self):
        self.check(copy.deepcopy(self.target))

    def test_removed_branch_predicate_fails(self):
        local = copy.deepcopy(self.target)
        local['views'][0]['definition'] = 'SELECT id FROM sales;'
        with self.assertRaisesRegex(AssertionError, 'views'):
            self.check(local)

    def test_changed_branch_predicate_fails(self):
        local = copy.deepcopy(self.target)
        local['views'][0]['definition'] = 'SELECT id FROM sales WHERE true;'
        with self.assertRaisesRegex(AssertionError, 'views'):
            self.check(local)

    def test_missing_or_extra_view_fails(self):
        for views in ([], self.target['views'] + [{'schema': 'public', 'name': 'extra', 'definition': 'SELECT 1;'}]):
            with self.subTest(views=len(views)), self.assertRaisesRegex(AssertionError, 'views'):
                self.check(dict(self.target, views=views))

    def test_documented_cast_normalization_only(self):
        before = "SELECT ((ARRAY['a'::character varying, 'b'::character varying])::text[]);"
        after = "SELECT (ARRAY[('a'::character varying)::text, ('b'::character varying)::text]);"
        self.assertEqual(catalog.canonical(before), catalog.canonical(after))
        self.assertNotEqual(catalog.canonical(before), catalog.canonical(after.replace("'b'", "'c'")))


if __name__ == '__main__':
    unittest.main()
