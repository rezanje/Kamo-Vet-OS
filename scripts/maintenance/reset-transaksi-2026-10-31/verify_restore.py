"""Compare every table of a backup export with a restored cluster (row count + md5 over jsonb rows).
usage: REPLICA=name REPLICA_PORT=port verify_restore.py EXPORTDIR"""
import hashlib,json,os,subprocess,sys,glob
S=os.path.dirname(os.path.abspath(__file__)); D=sys.argv[1]
def h(lines): return hashlib.md5(','.join(sorted(hashlib.md5(l.encode()).hexdigest() for l in lines)).encode()).hexdigest()
man=json.load(open(D+'/manifest.json')); ok=bad=0; problems=[]
for f in sorted(glob.glob(D+'/*.ndjson')):
    name=os.path.basename(f)[:-7]; raw=open(f,'rb').read()
    assert hashlib.sha256(raw).hexdigest()==man[name]['sha256'], 'backup file altered: '+name
    lines=[l for l in raw.decode().split('\n') if l]
    s,t=name.split('.',1)
    r=subprocess.run([S+'/replica.sh','psql','-At'],input=f"select count(*)||'|'||md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by md5(to_jsonb(t)::text)),'')) from {s}.{t} t",text=True,capture_output=True)
    got=r.stdout.strip()
    if got==f'{len(lines)}|{h(lines)}': ok+=1
    else: bad+=1; problems.append((name,len(lines),got or r.stderr.strip()[:120]))
print('tables identical',ok,'different',bad); [print(' ',p) for p in problems[:40]]
