#!/usr/bin/env python3
"""Runs one existing native suite with or without the KOREKSI-SO-PER-BARIS candidate (helper of test-koreksi-so-per-baris-postgres.py --neighbours).
The neighbour's own fixture chain is patched only to tolerate main's hosted-data migrations (never part of the proof). The candidate migration lives in
supabase/migrations (numbered after everything else), so it is applied at the end of the chain with --with-cand and skipped with --without-cand.
Prints CAND_APPLIED=<n> so the caller can see that the candidate really was part of the chain."""
import argparse, importlib.util, sys, tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser(); ap.add_argument('nb'); ap.add_argument('--pg-bin', required=True)
g = ap.add_mutually_exclusive_group(required=True); g.add_argument('--with-cand', action='store_true'); g.add_argument('--without-cand', action='store_true')
a = ap.parse_args()

kr_spec = importlib.util.spec_from_file_location('krmain', ROOT / 'scripts/test-koreksi-so-per-baris-postgres.py')
kr = importlib.util.module_from_spec(kr_spec); sys.modules['krmain'] = kr; kr_spec.loader.exec_module(kr)
CAND_TEXT = kr.cand_text()
WITH = a.with_cand
APPLIED = [0]


class H2:
    def __init__(self, db): self.db = db

    def sql(self, source):
        if CAND_TEXT in source:
            if not WITH: return ''
            APPLIED[0] += 1
        return kr.Hook(self.db).sql(source)


nb_spec = importlib.util.spec_from_file_location('nbmod', (Path(a.nb) if a.nb.startswith('/') else ROOT / 'scripts' / a.nb))
nb = importlib.util.module_from_spec(nb_spec); sys.modules['nbmod'] = nb
nb_spec.loader.exec_module(nb)

for mod in (nb, getattr(nb, 'posting', None)):
    if mod is None: continue
    fx = getattr(mod, 'fixture', None) or getattr(getattr(mod, 'm', None), 'x', None)
    if fx is not None and hasattr(fx, 'DisposablePostgres'):
        orig = fx.DisposablePostgres.bootstrap
        def patched(self, _orig=orig):
            _orig(H2(self))
        fx.DisposablePostgres.bootstrap = patched

tmp = tempfile.mktemp(suffix='.json', dir='/opt/data/cache/scratch')
sys.argv = [a.nb, '--pg-bin', a.pg_bin, '--json', tmp]
try:
    nb.main()
except SystemExit as e:
    print('EXIT', e.code)
print('CAND_APPLIED=%d' % APPLIED[0])
