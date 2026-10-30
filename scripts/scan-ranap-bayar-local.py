#!/usr/bin/env python3
"""Supporting added-line scan, not a substitute for independent review."""
import json
from pathlib import Path
import re
import subprocess
ROOT=Path(__file__).resolve().parents[1]
files=subprocess.check_output(['git','diff','--cached','--name-only'],cwd=ROOT,text=True).splitlines()
findings=[]
patterns={'literal-credential':r'''(?i)(api_key|secret|password|passwd)\s*=\s*["'][^"']{6,}["']''','shell-injection':r'os\.system\(|shell=True','eval':r'\beval\(','unsafe-deserialization':r'pickle\.loads?\('}
selected=[f for f in files if (f.startswith('src/') and '__tests__' not in f) or f.startswith('supabase/migrations/')]
for filename in selected:
    diff=subprocess.check_output(['git','diff','--cached','--',filename],cwd=ROOT,text=True)
    added=[l[1:] for l in diff.splitlines() if l.startswith('+') and not l.startswith('+++')]
    for name,pattern in patterns.items():
        for line in added:
            if re.search(pattern,line):findings.append(dict(file=filename,check=name,line=line))
result=dict(scope='supporting static scan of added production lines only',files=selected,findings=findings,independent_review='parent pending')
(ROOT/'docs/verification/ranap-bayar/31-static-scan.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
raise SystemExit(int(bool(findings)))
