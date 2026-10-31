"""Download every storage object (all buckets) into OUTDIR/storage/<bucket>/<name>, with sha256 manifest.
usage: storage_backup.py OUTDIR"""
import json, os, sys, urllib.request, urllib.parse, hashlib
REF = 'koaglxcyjqfmgfzxszkj'; BASE = f'https://{REF}.supabase.co/storage/v1'
KEY = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.svc')).read().strip()
OUT = os.path.join(sys.argv[1], 'storage'); H = {'Authorization': 'Bearer ' + KEY, 'apikey': KEY}


def call(path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={**H, 'Content-Type': 'application/json'})
    return urllib.request.urlopen(req, timeout=120).read()


def walk(bucket, prefix=''):
    items = json.loads(call(f'/object/list/{bucket}', {'prefix': prefix, 'limit': 1000, 'offset': 0}))
    for it in items:
        name = (prefix + '/' if prefix else '') + it['name']
        if it.get('id') is None:
            yield from walk(bucket, name)
        else:
            yield name


man = {}
for b in json.loads(call('/bucket')):
    for name in walk(b['id']):
        data = call(f"/object/{b['id']}/{urllib.parse.quote(name)}")
        p = os.path.join(OUT, b['id'], name); os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'wb').write(data)
        man[f"{b['id']}/{name}"] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
json.dump(man, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1, sort_keys=True)
print('objects', len(man), 'bytes', sum(v['bytes'] for v in man.values()))
