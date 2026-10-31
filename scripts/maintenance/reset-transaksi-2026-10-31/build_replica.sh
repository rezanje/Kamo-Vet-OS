#!/bin/bash
# build_replica.sh NAME PORT EXPORTDIR : fresh PG17 cluster with prod-identical schema, loaded from a backup export
set -e
S=/tmp/claude-0/-home-user-Kamo-Vet-OS/8951f758-6e5a-530d-9f68-09d7403b622a/scratchpad
export REPLICA=$1 REPLICA_PORT=$2
$S/replica.sh stop >/dev/null 2>&1 || true
$S/replica.sh init
$S/replica.sh psql -q -f $S/shim.sql >/dev/null 2>&1
python3 - <<PY
import subprocess,pathlib,sys
for m in sorted(pathlib.Path('/home/user/Kamo-Vet-OS/supabase/migrations').glob('*.sql')):
    if m.name.startswith('0068'):
        subprocess.run(['$S/replica.sh','psql','-qc',"insert into coa_accounts(code,name,type,normal_balance) values('1101','Test cash','ASET','D'),('1102','Test bank','ASET','D') on conflict do nothing"],check=True,capture_output=True)
    r=subprocess.run(['$S/replica.sh','psql','-q'],input='set search_path to "\$user", public, extensions;\nbegin;\n'+m.read_text()+'\ncommit;',text=True,capture_output=True)
    if r.returncode: print('FAIL',m.name,r.stderr[-800:]); sys.exit(1)
PY
$S/replica.sh psql -q -f $S/sync_full.sql >/dev/null
$S/replica.sh psql -q -f $S/arsip_ddl.sql >/dev/null
# parity with prod schema
$S/replica.sh psql -Atf $S/fp.sql > $S/fp_$1.json
python3 -c "
import json
p=dict(map(tuple,json.load(open('$S/fp_prod.json'))[0]['json_agg'])); l=dict(map(tuple,json.load(open('$S/fp_$1.json'))))
bad=sorted(set(p)^set(l))+[k for k in p if k in l and p[k]!=l[k]]
print('schema parity objects',len(p),'mismatch',len(bad),bad[:5]); assert not bad"
$S/replica.sh psql -qc "set session_replication_role=replica; do \$\$ begin execute (select 'truncate '||string_agg(format('%I.%I',n.nspname,c.relname),',')||' cascade' from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname in ('public','clinic_private','kamo_import','kamo_maintenance','arsip_20260801') or (n.nspname='auth' and c.relname='users') or (n.nspname='storage' and c.relname in ('objects','buckets')))); end \$\$;"
python3 $S/load.py $3 > $S/load_$1.log 2>&1 || { tail -5 $S/load_$1.log; exit 1; }
grep -c . $S/load_$1.log
