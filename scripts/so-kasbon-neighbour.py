#!/usr/bin/env python3
"""Runs one existing native opname suite with or without the SO-KASBON-NETO candidate (helper of test-so-kasbon-neto-postgres.py --neighbours).
The neighbour's own fixture chain is patched only to tolerate main's hosted-data migrations (never part of the proof). The candidate
migration lives in supabase/migrations, so it is skipped when the chain is built and (with --with-cand) applied afterwards: right after the
neighbour's own F2 candidate for the F2 suite (the candidate needs F2), after the whole chain for the others."""
import argparse, importlib.util, sys, tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser(); ap.add_argument('nb'); ap.add_argument('--pg-bin', required=True)
g = ap.add_mutually_exclusive_group(required=True); g.add_argument('--with-cand', action='store_true'); g.add_argument('--without-cand', action='store_true')
a = ap.parse_args()

kn_spec = importlib.util.spec_from_file_location('knmain', ROOT / 'scripts/test-so-kasbon-neto-postgres.py')
kn = importlib.util.module_from_spec(kn_spec); sys.modules['knmain'] = kn; kn_spec.loader.exec_module(kn)
CAND_TEXT = kn.cand_text()
WITH = a.with_cand
MARK = '-- F2 (meeting 12 Nov 2026' if 'f2' in a.nb else None


class H2:
    def __init__(self, db): self.db = db

    def sql(self, source):
        if CAND_TEXT in source and (MARK or not WITH): return ''
        return kn.Hook(self.db).sql(source)


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

if MARK and WITH:
    Base = nb.NativePostgres

    class Patched(Base):
        def sql(self, source):
            out = super().sql(source)
            if source.startswith('begin;\n' + MARK) or (source.startswith('begin;\n') and MARK in source[:400]):
                # hosted already ran the Admin Online fence over the F2 functions; replay it so the candidate's source guard sees the hosted definitions
                super().sql('select admin_online_private.fence_all(), admin_online_private.guard_all()')
                super().sql(kn.PRELUDE + 'begin;\n' + CAND_TEXT + '\ncommit;')
            return out
    nb.NativePostgres = Patched

tmp = tempfile.mktemp(suffix='.json', dir='/opt/data/cache/scratch')
sys.argv = [a.nb, '--pg-bin', a.pg_bin, '--json', tmp]
try:
    nb.main()
except SystemExit as e:
    print('EXIT', e.code)
