"""Logical export of KAMO prod tables via Supabase Management API (read-only queries).
Each row is stored as PostgreSQL's own jsonb text (exact numerics), one row per line.
usage: export.py OUTDIR  -> OUTDIR/<schema>.<table>.ndjson + manifest.json (rows, sha256)"""
import json, os, sys, urllib.request, hashlib, time
REF = 'koaglxcyjqfmgfzxszkj'; TOK = os.environ['SUPABASE_ACCESS_TOKEN']; OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)


def q(sql):
    for a in range(6):
        try:
            req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query',
                                         data=json.dumps({'query': sql, 'read_only': True}).encode(),
                                         headers={'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json'})
            r = json.load(urllib.request.urlopen(req, timeout=120))
            if isinstance(r, dict) and r.get('message'):
                raise RuntimeError(r['message'])
            return r
        except Exception:
            if a == 5:
                raise
            time.sleep(2 ** a)


tables = q("""select n.nspname s,c.relname t,
 coalesce((select string_agg(quote_ident(a.attname),',' order by k.ord) from pg_index i cross join unnest(i.indkey) with ordinality k(attnum,ord)
   join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum where i.indrelid=c.oid and i.indisprimary),'ctid') pk
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p')
 and (n.nspname in ('public','clinic_private','kamo_import','kamo_maintenance','private','arsip_20260801')
   or (n.nspname='auth' and c.relname='users') or (n.nspname='storage' and c.relname in ('objects','buckets'))) order by 1,2""")
man = {}
for t in tables:
    s, tn, pk = t['s'], t['t'], t['pk']
    page = 1 if tn == 'simulation_backups' else (1500 if tn == 'activity_log' else 4000)
    rows, off = [], 0
    while True:
        r = q(f"select count(*) n, coalesce(string_agg(x, chr(10) order by o),'') d from (select to_jsonb(z)::text x, row_number() over () o "
              f"from (select * from {s}.{tn} order by {pk} limit {page} offset {off}) z) y")
        d = [l for l in r[0]['d'].split('\n') if l]
        assert len(d) == r[0]['n'], (tn, len(d), r[0]['n'])
        rows += d; off += page
        if len(d) < page:
            break
    raw = ('\n'.join(rows) + ('\n' if rows else '')).encode()
    open(f'{OUT}/{s}.{tn}.ndjson', 'wb').write(raw)
    man[f'{s}.{tn}'] = {'rows': len(rows), 'sha256': hashlib.sha256(raw).hexdigest()}
    print(s, tn, len(rows), flush=True)
json.dump(man, open(f'{OUT}/manifest.json', 'w'), indent=1, sort_keys=True)
print('DONE', len(man), flush=True)
