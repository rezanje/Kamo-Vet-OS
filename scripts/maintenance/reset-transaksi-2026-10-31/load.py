"""Load an export dir into a local replica (LOCAL ONLY; triggers off via session_replication_role for the copy).
usage: load.py EXPORTDIR [schema.table ...]  (default all files)"""
import json,sys,subprocess,os,glob
S=os.path.dirname(os.path.abspath(__file__)); D=sys.argv[1]
def psql(sql):
    r=subprocess.run([S+'/replica.sh','psql','-qAt'],input=sql,text=True,capture_output=True)
    if r.returncode: raise RuntimeError(r.stderr[-2000:])
    return r.stdout
gen=set(psql("select table_schema||'.'||table_name||'.'||column_name from information_schema.columns where is_generated='ALWAYS'").split())
files=sys.argv[2:] or sorted(os.path.basename(f)[:-7] for f in glob.glob(D+'/*.ndjson'))
for name in files:
    rows=[l for l in open(f'{D}/{name}.ndjson',encoding='utf-8').read().split('\n') if l]
    if not rows: continue
    s,t=name.split('.',1)
    cols=psql(f"select string_agg(quote_ident(column_name),',' order by ordinal_position) from information_schema.columns where table_schema='{s}' and table_name='{t}' and is_generated<>'ALWAYS'").strip()
    if not cols: print('skip (no local table)',name); continue
    data='['+','.join(rows)+']'
    tag='$kamo_load_q7$'; assert tag not in data
    psql(f"set session_replication_role=replica; insert into {s}.{t}({cols}) overriding system value select {cols} from jsonb_populate_recordset(null::{s}.{t},{tag}{data}{tag}::jsonb);")
    print(name,len(rows),flush=True)
psql("set session_replication_role=origin; select setval(pg_get_serial_sequence(format('%I.%I',table_schema,table_name),column_name),coalesce((xpath('/row/m/text()',query_to_xml(format('select max(%I) m from %I.%I',column_name,table_schema,table_name),false,true,'')))[1]::text::bigint,1)) from information_schema.columns where (identity_generation is not null or column_default like 'nextval%') and table_schema in ('public','clinic_private','kamo_import','kamo_maintenance')")
print('sequences synced')
