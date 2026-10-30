#!/usr/bin/env python3
"""Run existing original public-RPC regressions with temp paths confined here.
Only local cluster/temp placement is adapted; no business function is substituted.
"""
import importlib.util
from pathlib import Path
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'scripts'))
spec=importlib.util.spec_from_file_location('unified',ROOT/'scripts/test-ranap-bayar-postgres.py')
assert spec and spec.loader
unified=importlib.util.module_from_spec(spec);spec.loader.exec_module(unified)
import native_postgres
native_postgres.NativePostgres.__enter__=unified.LocalPostgres.__enter__
original=tempfile.TemporaryDirectory
class ScopedDirectory(original):
    def __init__(self,*args,**kw):
        kw['dir']=ROOT
        super().__init__(*args,**kw)
tempfile.TemporaryDirectory=ScopedDirectory
name=sys.argv.pop(1)
assert name in ('test-ranap-rekap-dp-postgres.py','test-ranap-racikan-postgres.py')
spec=importlib.util.spec_from_file_location('existing',ROOT/'scripts'/name)
assert spec and spec.loader
existing=importlib.util.module_from_spec(spec);spec.loader.exec_module(existing)
sys.exit(existing.main())
