#!/usr/bin/env python3
"""Runs one existing native opname suite with or without the SO-SURPLUS-HPP candidate (helper of test-so-surplus-hpp-postgres.py --neighbours).
The neighbour's own fixture chain is patched only to tolerate main's hosted-data migrations (never part of the proof) and, with --with-cand,
to apply the candidate right after the neighbour's own last candidate (F1 / F2) or after the whole chain for the others."""
import argparse, importlib.util, sys, tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser(); ap.add_argument('nb'); ap.add_argument('--pg-bin', required=True)
g = ap.add_mutually_exclusive_group(required=True); g.add_argument('--with-cand', action='store_true'); g.add_argument('--without-cand', action='store_true')
a = ap.parse_args()

sx_spec = importlib.util.spec_from_file_location('sxmain', ROOT / 'scripts/test-so-surplus-hpp-postgres.py')
sx = importlib.util.module_from_spec(sx_spec); sys.modules['sxmain'] = sx; sx_spec.loader.exec_module(sx)
CAND_TEXT = sx.cand_text()
WITH = a.with_cand

nb_spec = importlib.util.spec_from_file_location('nbmod', ROOT / 'scripts' / a.nb)
nb = importlib.util.module_from_spec(nb_spec); sys.modules['nbmod'] = nb
nb_spec.loader.exec_module(nb)

MARK = {'test-f1-opname-akun-selisih-postgres.py': '-- F1 (meeting 12 Nov 2026', 'test-f2-beban-selisih-karyawan-postgres.py': '-- F2 (meeting 12 Nov 2026'}.get(a.nb)

for mod in (nb, getattr(nb, 'posting', None)):
    if mod is None: continue
    fx = getattr(mod, 'fixture', None) or getattr(getattr(mod, 'm', None), 'x', None)
    if fx is not None and hasattr(fx, 'DisposablePostgres'):
        orig = fx.DisposablePostgres.bootstrap
        def patched(self, _orig=orig):
            _orig(sx.Hook(self))
            if WITH and MARK is None: self.sql(sx.PRELUDE + 'begin;\n' + CAND_TEXT + '\ncommit;')
        fx.DisposablePostgres.bootstrap = patched

if MARK and WITH:
    Base = nb.NativePostgres

    class Patched(Base):
        def sql(self, source):
            out = super().sql(source)
            if source.startswith('begin;\n' + MARK) or (source.startswith('begin;\n') and MARK in source[:400]):
                super().sql(sx.PRELUDE + 'begin;\n' + CAND_TEXT + '\ncommit;')
            return out
    nb.NativePostgres = Patched

tmp = tempfile.mktemp(suffix='.json', dir='/opt/data/cache/scratch')
sys.argv = [a.nb, '--pg-bin', a.pg_bin, '--json', tmp]
try:
    nb.main()
except SystemExit as e:
    print('EXIT', e.code)
