#!/usr/bin/env python3
"""Focused offline quality checks; never provisions or runs the full app suite."""
import json
import os
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/verification/ranap-bayar'
env={**os.environ,'NODE_OPTIONS':'--no-experimental-webstorage --max-old-space-size=2048'}
route='src/app/(app)/klinik/rawat-inap/[id]/tagihan'
tests=[route+'/__tests__','src/components/__tests__/ranap-simpan-bayar.test.tsx','src/components/__tests__/ranap-payment-popup.test.tsx','src/lib/__tests__/tagihan-berjalan.test.ts','src/lib/__tests__/tagihan-berjalan-server.test.ts','src/lib/__tests__/tagihan-berjalan-sql.test.ts','src/lib/__tests__/uang-tagihan.test.ts']
changed=[route+'/actions.ts',route+'/page.tsx',route+'/SimpanBayarForm.tsx',route+'/__tests__/page.test.tsx',route+'/__tests__/simpan-bayar-actions.test.ts','src/components/__tests__/ranap-simpan-bayar.test.tsx','src/components/__tests__/ranap-payment-popup.test.tsx','src/lib/ranap-payment.ts']
commands=[('ui-targeted',['node','node_modules/vitest/vitest.mjs','run',*tests,'--maxWorkers=1','--reporter=default','--reporter=json','--outputFile=docs/verification/ranap-bayar/30-ui-final.json']),('targeted-typecheck',['node','node_modules/typescript/bin/tsc','-p','docs/verification/ranap-bayar/tsconfig.targeted.json']),('changed-file-eslint',['node','node_modules/eslint/bin/eslint.js',*changed]),('diff-check',['git','diff','--check'])]
results=[]
for name,command in commands:
    result=subprocess.run(command,cwd=ROOT,env=env,capture_output=True,text=True)
    log=OUT/('30-'+name+'.log');log.write_text(result.stdout+result.stderr)
    row=dict(check=name,command=command,exit_code=result.returncode,log=str(log.relative_to(ROOT)))
    results.append(row);print(json.dumps(row),flush=True)
(OUT/'30-quality-gates.json').write_text(json.dumps(results,indent=2))
raise SystemExit(int(any(row['exit_code'] for row in results)))
