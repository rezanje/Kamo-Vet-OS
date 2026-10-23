#!/usr/bin/env python3
"""Schema-only metadata for isolated feedback verification; never exports rows.

Capture uses the existing configured Management API credential for one exact
Supabase project with read_only=True. Snapshot is private and must stay outside
Git. Applying metadata is permitted only through the owned network-none test DB.
"""
import argparse,json,os,pathlib,re,urllib.request,urllib.error
CATALOG_QUERY="select jsonb_build_object(\n 'server_version',current_setting('server_version'), 'read_only',current_setting('transaction_read_only'),\n 'schemas',(select jsonb_agg(jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',(select jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'public'else pg_get_userbyid(x.grantee)end,'privilege',x.privilege_type,'grantable',x.is_grantable))from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner)))x)))from pg_namespace n where n.nspname in('public','private','clinic_private','kamo_maintenance')),\n 'tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,\n 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'generated',a.attgenerated,'identity',a.attidentity,'acl',(select jsonb_agg(jsonb_build_object('role',case when ca.grantee=0 then 'public'else pg_get_userbyid(ca.grantee)end,'privilege',ca.privilege_type,'grantable',ca.is_grantable))from aclexplode(a.attacl)ca))order by a.attnum)from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),\n 'constraints',(select jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid))order by k.conname)from pg_constraint k where k.conrelid=c.oid),\n 'indexes',(select jsonb_agg(jsonb_build_object('name',ci.relname,'definition',pg_get_indexdef(i.indexrelid),'constraint',exists(select 1 from pg_constraint where conindid=i.indexrelid)))from pg_index i join pg_class ci on ci.oid=i.indexrelid where i.indrelid=c.oid),\n 'acl',(select jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'public'else pg_get_userbyid(x.grantee)end,'privilege',x.privilege_type,'grantable',x.is_grantable))from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))x))order by n.nspname,c.relname)\n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','clinic_private','kamo_maintenance')and c.relkind='r'),\n 'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'acl',(select jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'public'else pg_get_userbyid(x.grantee)end,'privilege',x.privilege_type,'grantable',x.is_grantable))from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))x))order by n.nspname,p.proname,p.oid)\n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private','clinic_private','kamo_maintenance')and p.prokind='f'and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')),\n 'triggers',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))order by n.nspname,c.relname,t.tgname)from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','clinic_private','kamo_maintenance')and not t.tgisinternal),\n 'policies',(select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'permissive',permissive,'roles',roles,'cmd',cmd,'qual',qual,'check',with_check)order by schemaname,tablename,policyname)from pg_policies where schemaname in('public','private','clinic_private','kamo_maintenance')),\n 'views',(select jsonb_agg(jsonb_build_object('schema',schemaname,'name',viewname,'definition',definition)order by schemaname,viewname)from pg_views where schemaname in('public','private','clinic_private','kamo_maintenance')),\n 'enums',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,'labels',(select jsonb_agg(e.enumlabel order by e.enumsortorder)from pg_enum e where e.enumtypid=t.oid)))from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typtype='e'and n.nspname in('public','private','clinic_private','kamo_maintenance')),\n 'extensions',(select jsonb_agg(jsonb_build_object('name',extname,'version',extversion))from pg_extension)\n)as catalog"
PROJECT='koaglxcyjqfmgfzxszkj'
# These are deliberately not captured or reproduced. Covered catalog equality
# is not full security/platform equivalence; verify these before a target release.
UNVERIFIED_SECURITY_METADATA=[
 'Table and function ownership, including SECURITY DEFINER execution ownership',
 'View ownership, ACLs and security_invoker/security_barrier options',
 'Role attributes (including BYPASSRLS) and role membership/inheritance',
]
def qi(s):return '"'+s.replace('"','""')+'"'
def obj(s,n):return qi(s)+'.'+qi(n)
def fk(x):return x['schema'],x['name'],x['identity']
def tk(x):return x['schema'],x['name']
def norm(s):return re.sub(r'\s+',' ',s or'').strip()
def validate_catalog(target):
 if target.get('project_ref')!=PROJECT or target.get('read_only')!='on' or not target.get('server_version','').startswith('17.6'):raise ValueError('Unexpected project/version/read-only snapshot')
 text=json.dumps(target)
 patterns=[r'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}',r'sb_secret_[A-Za-z0-9_-]{10,}',r'sbp_[A-Za-z0-9]{20,}',r'postgres(?:ql)?://[^\s]+',r'[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}']
 if any(re.search(p,text)for p in patterns):raise ValueError('Snapshot withheld: sensitive-looking literal (value not logged)')
def normalize_array_casts(value):
 # PostgreSQL17 re-parses old stored varchar-array -> text[] coercions as
 # element casts during pg_restore. Normalize only literal varchar arrays.
 literal=r"'(?:''|[^'])*'::character varying"
 pattern=r"\(\(ARRAY\[("+literal+r"(?:, "+literal+r")*)\]\)::text\[\]\)"
 value=re.sub(pattern,lambda m:'(ARRAY['+', '.join('('+x+')::text'for x in re.findall(literal,m.group(1)))+'])',value)
 # pg_restore also flattens this existing associative AND subexpression.
 return value.replace('((fee_percent >= (0)::numeric) AND (fee_percent <= (100)::numeric))','(fee_percent >= (0)::numeric) AND (fee_percent <= (100)::numeric)')
def canonical(value,field=None):
 if isinstance(value,dict):return {k:canonical(v,k)for k,v in sorted(value.items())}
 if isinstance(value,list):
  values=[canonical(v)for v in value]
  return values if field in('columns','labels')else sorted(values,key=lambda x:json.dumps(x,sort_keys=True))
 if isinstance(value,str):return normalize_array_casts(value).strip()
 return value
def compare_catalog(local,target):
 result={}
 for kind,key in [('functions',fk),('tables',tk),('triggers',lambda x:(x['schema'],x['table'],x['name'])),('policies',lambda x:(x['schema'],x['table'],x['name'])),('views',tk),('enums',tk),('schemas',lambda x:x['name'])]:
  left={key(x):canonical(x)for x in local[kind]or[]};right={key(x):canonical(x)for x in target[kind]or[]}
  result[kind]={'localCount':len(left),'targetCount':len(right),'onlyLocal':[str(k)for k in left.keys()-right.keys()],'onlyTarget':[str(k)for k in right.keys()-left.keys()],'different':[str(k)for k in left.keys()&right.keys()if left[k]!=right[k]]}
 return result
def require_covered_parity(comparison):
 # Views are subject to the same fail-closed rule as every other covered kind.
 # Only the narrowly defined canonical normalization above is permitted.
 differences={kind:value for kind,value in comparison.items()if value['onlyLocal']or value['onlyTarget']or value['different']}
 if differences:raise AssertionError('Covered catalog mismatch: '+json.dumps(differences,sort_keys=True))
def apply_catalog(database,target):
 validate_catalog(target)
 if not getattr(database,'owned_network_none',False):raise ValueError('Schema overlay requires owned network-none test database')
 sql=database.sql;local=json.loads(sql(CATALOG_QUERY))
 if not local['server_version'].startswith('17.6'):raise ValueError('Isolated engine must be PostgreSQL17.6')
 lt={tk(x):x for x in local['tables']};tt={tk(x):x for x in target['tables']};lf={fk(x):x for x in local['functions']};tf={fk(x):x for x in target['functions']}
 summary={'engine':local['server_version'],'extraTargetTables':['.'.join(k)for k in tt.keys()-lt.keys()],'extraLocalTables':['.'.join(k)for k in lt.keys()-tt.keys()],'extraTargetFunctions':['.'.join(k[:2])+'('+k[2]+')'for k in tf.keys()-lf.keys()],'extraLocalFunctions':['.'.join(k[:2])+'('+k[2]+')'for k in lf.keys()-tf.keys()],'differentSharedFunctions':['.'.join(k[:2])for k in tf.keys()&lf.keys()if norm(tf[k]['definition'])!=norm(lf[k]['definition'])],'columnDrift':[],'residual':[]}

 # This is generated schema-only DDL for the owned local clone; no source rows.
 commands=['begin;','set check_function_bodies=off;']
 for schema in ['public','private','clinic_private','kamo_maintenance']:commands.append('create schema if not exists '+qi(schema)+';')
 for table in target['tables']:
  key=tk(table);qual=obj(*key)
  def col(c):
   if c['identity']:raise RuntimeError('Identity column requires explicit safe handling: '+qual+'.'+c['name'])
   tail=(' generated always as ('+c['default']+') stored')if c['generated']else(' default '+c['default']if c['default']else'')
   return qi(c['name'])+' '+c['type']+tail+(' not null'if c['not_null']else'')
  if key not in lt:commands.append('create table '+qual+'('+','.join(col(c)for c in table['columns'])+');')
  else:
   by={c['name']:c for c in lt[key]['columns']}
   for c in table['columns']:
    if c['name']not in by:commands.append('alter table '+qual+' add column '+col(c)+';')
    elif {k:v for k,v in c.items()if k!='acl'}!={k:v for k,v in by[c['name']].items()if k!='acl'}:
     summary['columnDrift'].append({'table':qual,'column':c['name'],'keys':[k for k in c if c[k]!=by[c['name']][k]]})
     # Cosmetic default qualification is handled only when column types match.
     if c['type']!=by[c['name']]['type']or c['generated']or c['identity']:summary['residual'].append('Column type/generated drift '+qual+'.'+c['name']);continue
     commands.append('alter table '+qual+' alter column '+qi(c['name'])+(' set not null;'if c['not_null']else' drop not null;'))
     commands.append('alter table '+qual+' alter column '+qi(c['name'])+(' set default '+c['default']+';'if c['default']else' drop default;'))
 # Order non-FK constraints before FKs, after all relation shells exist.
 for foreign in [False,True]:
  for table in target['tables']:
   current={c['name']:c for c in lt.get(tk(table),{}).get('constraints',[])or[]}
   for c in table.get('constraints')or[]:
    if(c['type']=='f')!=foreign:continue
    old=current.get(c['name'])
    if old and norm(old['definition'])==norm(c['definition']):continue
    if old:
     summary['residual'].append('Different existing constraint not replaced: '+'.'.join(tk(table))+'.'+c['name']);continue
    commands.append('alter table '+obj(*tk(table))+' add constraint '+qi(c['name'])+' '+c['definition']+';')
 for table in target['tables']:
  existing={i['name']for i in lt.get(tk(table),{}).get('indexes',[])or[]}
  for i in table.get('indexes')or[]:
   if not i['constraint']and i['name']not in existing:commands.append(i['definition']+';')
 # Represent one non-personal control scalar with an explicitly synthetic row;
 # no actual backup ID, payload, manifest, receipt or actor is copied.
 cutoff=target.get('operational_reset_cutoff')
 if cutoff is not None:
  import datetime
  cutoff=datetime.date.fromisoformat(cutoff).isoformat()
  commands.append("insert into kamo_maintenance.simulation_backups(id,requested_by,snapshot,sha256,manifest,reset_at)values(md5('integration-control-only')::uuid,md5('integration-fictional-control-actor')::uuid,'{\"synthetic_control_only\":true}',repeat('0',64),'{}','"+cutoff+" 00:00:00+07'::timestamptz)on conflict(id)do update set reset_at=excluded.reset_at;")
 # Match target routine bodies, retaining server-native catalog definitions.
 for key,f in tf.items():
  if key not in lf or f['definition']!=lf[key]['definition']:commands.append(f['definition']+';')
 # Remove only a known optional repository routine absent from the actual target.
 for key in lf.keys()-tf.keys():
  if key[:2]==('public','reprice_purchase_invoice_layers'):commands.append('drop function '+obj(*key[:2])+'('+key[2]+');')
  else:summary['residual'].append('Repository-only routine retained: '+'.'.join(key[:2]))
 # ACLs and policies reflect only the local test clone. No target access changes.
 roles=sorted({a['role']for t in target['tables']for a in t['acl']or[]}|{a['role']for f in target['functions']for a in f['acl']or[]})
 allowed={'public','postgres','anon','authenticated','service_role','supabase_admin','supabase_auth_admin','authenticator','dashboard_user'}
 if set(roles)-allowed:raise RuntimeError('Unsupported role names require review; no credentials generated')
 existingroles=set(sql('select rolname from pg_roles').splitlines())
 for role in set(roles)-{'public'}-existingroles:commands.append('create role '+qi(role)+' nologin;')
 for schema in target.get('schemas',[]):
  commands.append('alter schema '+qi(schema['name'])+' owner to '+qi(schema['owner'])+';');commands.append('revoke all on schema '+qi(schema['name'])+' from public,anon,authenticated,service_role;')
  for a in schema['acl']or[]:commands.append('grant '+a['privilege']+' on schema '+qi(schema['name'])+' to '+('public'if a['role']=='public'else qi(a['role']))+(' with grant option'if a['grantable']else'')+';')
 for table in target['tables']:
  qual=obj(*tk(table));commands+=['alter table '+qual+(' enable'if table['rls']else' disable')+' row level security;','alter table '+qual+(' force'if table['force_rls']else' no force')+' row level security;','revoke all on table '+qual+' from public,anon,authenticated,service_role;']
  for a in table['acl']or[]:commands.append('grant '+a['privilege']+' on table '+qual+' to '+('public'if a['role']=='public'else qi(a['role']))+(' with grant option'if a['grantable']else'')+';')
 # Preserve column-level grants separately: REVOKE ALL on a table may clear
 # them. Private closing totals intentionally expose only selected header fields.
 for table in target['tables']:
  previous={c['name']:c for c in lt.get(tk(table),{}).get('columns',[])}
  for column in table['columns']:
   if not column.get('acl')and not previous.get(column['name'],{}).get('acl'):continue
   qualified=obj(*tk(table));commands.append('revoke all('+qi(column['name'])+')on table '+qualified+' from public,anon,authenticated,service_role;')
   for a in column.get('acl')or[]:commands.append('grant '+a['privilege']+'('+qi(column['name'])+')on table '+qualified+' to '+('public'if a['role']=='public'else qi(a['role']))+(' with grant option'if a['grantable']else'')+';')
 for key,f in tf.items():
  qual=obj(*key[:2])+'('+key[2]+')';commands.append('revoke all on function '+qual+' from public,anon,authenticated,service_role;')
  for a in f['acl']or[]:commands.append('grant execute on function '+qual+' to '+('public'if a['role']=='public'else qi(a['role']))+(' with grant option'if a['grantable']else'')+';')
 localpol={(p['schema'],p['table'],p['name']):p for p in local['policies']};targetpol={(p['schema'],p['table'],p['name']):p for p in target['policies']}
 for key,p in localpol.items():
  if key not in targetpol or p!=targetpol[key]:commands.append('drop policy '+qi(p['name'])+' on '+obj(p['schema'],p['table'])+';')
 for key,p in targetpol.items():
  if key in localpol and p==localpol[key]:continue
  role=p['roles'];role=role if isinstance(role,list)else role.strip('{}').split(',')
  commands.append('create policy '+qi(p['name'])+' on '+obj(p['schema'],p['table'])+' as '+p['permissive']+' for '+p['cmd']+' to '+','.join('public'if r=='public'else qi(r)for r in role)+(' using('+p['qual']+')'if p['qual']else'')+(' with check('+p['check']+')'if p['check']else'')+';')
 ltr={(t['schema'],t['table'],t['name']):t for t in local['triggers']};ttr={(t['schema'],t['table'],t['name']):t for t in target['triggers']}
 for key,t in ltr.items():
  if key not in ttr or norm(t['definition'])!=norm(ttr[key]['definition']):commands.append('drop trigger '+qi(t['name'])+' on '+obj(t['schema'],t['table'])+';')
 for key,t in ttr.items():
  if key not in ltr or norm(t['definition'])!=norm(ltr[key]['definition']):commands.append(t['definition']+';')
  if t['enabled']=='D':commands.append('alter table '+obj(t['schema'],t['table'])+' disable trigger '+qi(t['name'])+';')
 for v in target['views']or[]:
  old=next((x for x in local['views']or[]if tk(x)==tk(v)),None)
  if not old or norm(old['definition'])!=norm(v['definition']):commands.append('create or replace view '+obj(*tk(v))+' as '+v['definition']+';')
 commands.append('commit;');overlay='\n'.join(commands)
 # Never output raw schema source. Private snapshot was checked before generation.
 sql(overlay)
 after=json.loads(sql(CATALOG_QUERY));summary['after']=compare_catalog(after,target);return summary
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=pathlib.Path,required=True);args=parser.parse_args();output=args.output.resolve();repo=pathlib.Path(__file__).resolve().parents[1]
 if output.is_relative_to(repo)or any((parent/'.git').is_file()or(parent/'.git/HEAD').is_file()for parent in output.parents):raise SystemExit('Private snapshot output must stay outside Git worktrees')
 token=os.getenv('SUPABASE_ACCESS_TOKEN')
 if not token:raise SystemExit('SUPABASE_ACCESS_TOKEN not available (value never logged)')
 req=urllib.request.Request('https://api.supabase.com/v1/projects/'+PROJECT+'/database/query',data=json.dumps({'query':CATALOG_QUERY,'read_only':True}).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=45)as response:target=json.load(response)[0]['catalog']
 except urllib.error.HTTPError as error:raise SystemExit('Read-only catalog HTTP '+str(error.code))from None
 control=urllib.request.Request('https://api.supabase.com/v1/projects/'+PROJECT+'/database/query',data=json.dumps({'query':"select max((reset_at at time zone 'Asia/Jakarta')::date)as cutoff from kamo_maintenance.simulation_backups",'read_only':True}).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(control,timeout=25)as response:target['operational_reset_cutoff']=json.load(response)[0]['cutoff']
 except urllib.error.HTTPError as error:raise SystemExit('Read-only control metadata HTTP '+str(error.code))from None
 target['project_ref']=PROJECT;validate_catalog(target);output.parent.mkdir(parents=True,exist_ok=True);fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w')as f:json.dump(target,f)
 print(json.dumps({'readOnly':True,'project':PROJECT,'tables':len(target['tables']or[]),'functions':len(target['functions']or[]),'privateSnapshot':str(output)}))
if __name__=='__main__':main()
