#!/usr/bin/env python3
"""Preserve byte-exact raw logs, then normalize display-only trailing whitespace."""
import hashlib
import json
from pathlib import Path
import tarfile
ROOT=Path(__file__).resolve().parents[1]
E=ROOT/'docs/verification/ranap-bayar'
archive=E/'raw-logs.tar.gz'
assert not archive.exists(),'Never overwrite original raw evidence'
logs=sorted(E.glob('*.log'))
manifest={p.name:dict(sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size) for p in logs}
with tarfile.open(archive,'w:gz') as output:
    for p in logs:output.add(p,arcname=p.name)
with tarfile.open(archive,'r:gz') as saved:
    for name,row in manifest.items():
        content=saved.extractfile(name)
        assert content is not None
        assert hashlib.sha256(content.read()).hexdigest()==row['sha256']
(E/'raw-logs-manifest.json').write_text(json.dumps(manifest,indent=2))
for p in logs:
    text=p.read_text();normalized='\n'.join(line.rstrip() for line in text.splitlines()).rstrip()
    p.write_text(normalized+'\n' if normalized else '')
print(json.dumps(dict(raw_logs=len(logs),archive=str(archive.relative_to(ROOT)),verified_sha256=True,display_change='trailing whitespace only')))
