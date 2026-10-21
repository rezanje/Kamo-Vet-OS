#!/usr/bin/env python3
"""Full source migrations + fictional fixtures in a network-isolated owned container.
No host credentials, connection strings, remote DB, production mutations or ports.
"""
from pathlib import Path
import subprocess
import argparse
import time
import uuid
ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'vetos-master-lifecycle-' + uuid.uuid4().hex[:8]
parser=argparse.ArgumentParser()
parser.add_argument('--compatibility-migration',action='append',default=[])
parser.add_argument('--regression-suite',action='append',default=[])
options=parser.parse_args()
def sql(source, check=True, tuples=False):
    args = ['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
    if tuples: args += ['-Atq']
    result = subprocess.run(args, input=source, text=True, capture_output=True)
    if check and result.returncode: raise RuntimeError(result.stderr)
    return result
BOOT = """create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create publication supabase_realtime;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;
"""
try:
    subprocess.run(['docker','run','-d','--network','none','--name',CONTAINER,'-e','POSTGRES_PASSWORD=fictional-master-test','postgres:16'],check=True,capture_output=True)
    for _ in range(100):
        logs=subprocess.run(['docker','logs',CONTAINER],text=True,capture_output=True)
        if 'PostgreSQL init process complete' in logs.stdout and subprocess.run(['docker','exec',CONTAINER,'pg_isready','-U','postgres'],capture_output=True).returncode==0: break
        time.sleep(.1)
    sql(BOOT)
    migrations=sorted((ROOT/'supabase/migrations').glob('*.sql'))
    lifecycle=next(p for p in migrations if p.name.endswith('_master_data_lifecycle.sql'))
    migrations=[p for p in migrations if p!=lifecycle]+[Path(p).resolve() for p in options.compatibility_migration]+[lifecycle]
    for migration in migrations:
        if migration.name.startswith('0068'):
            sql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Test cash','ASET','D'),('1102','Test bank','ASET','D') on conflict do nothing")
        try: sql('begin;\n'+migration.read_text()+'\ncommit;')
        except RuntimeError as error: raise RuntimeError(migration.name+': '+str(error)) from error
    print(f'PASS {len(migrations)} source migrations (auth/storage shims, fictional pre-0068 COA).',flush=True)
    sql((ROOT/'supabase/tests/master_data_lifecycle.sql').read_text())
    print('PASS master_data_lifecycle.sql',flush=True)
    sql((ROOT/'supabase/tests/master_item_code_history.sql').read_text())
    print('PASS master_item_code_history.sql',flush=True)
    for name in options.regression_suite:
        path=(ROOT/'supabase/tests'/name).resolve()
        if path.parent!=(ROOT/'supabase/tests').resolve(): raise RuntimeError('Regression must be a repository test filename')
        sql(path.read_text());print('PASS regression '+name,flush=True)
    # These fixtures COMMIT only inside this disposable, network-less container.
    sql("""insert into auth.users(id) values('ba000000-0000-4000-8000-000000000001');
update profiles set role='OWNER',is_active=true where id='ba000000-0000-4000-8000-000000000001';
insert into brands(id,name) select ('bb000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Fictional race brand '||n from generate_series(1,6)n;
insert into units(id,nama) values('bc000000-0000-4000-8000-000000000001','race-unit-one'),('bc000000-0000-4000-8000-000000000002','race-unit-two');
insert into employees(id,nama) values('bd000000-0000-4000-8000-000000000001','Fictional JSON owner one'),('bd000000-0000-4000-8000-000000000002','Fictional JSON owner two');
insert into employee_import_details(employee_id) values('bd000000-0000-4000-8000-000000000001'),('bd000000-0000-4000-8000-000000000002');
insert into items(code,name) values('RACE-ONE','Fictional race item one'),('RACE-TWO','Fictional race item two');
""")
    auth="set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='ba000000-0000-4000-8000-000000000001';"
    args=['docker','exec','-i',CONTAINER,'psql','-X','-q','-U','postgres','-v','ON_ERROR_STOP=1']
    def start(source,name):
        p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        p.stdin.write("set application_name='"+name+"';"+source);p.stdin.close();p.stdin=None
        return p
    def wait_sql(condition):
        for _ in range(150):
            if sql("select ("+condition+")::int;",tuples=True).stdout.strip()=='1': return
            time.sleep(.02)
        raise RuntimeError('PostgreSQL barrier timed out: '+condition)
    def pair(first,second,fragment,label):
        # The first session waits behind an advisory barrier while holding its
        # real row/reference locks. Confirm second is waiting on an actual lock.
        gate=start("select pg_advisory_lock(983156);select pg_sleep(4);select pg_advisory_unlock(983156);",'master_gate')
        wait_sql("exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='master_gate' and l.locktype='advisory' and l.granted)")
        a=start(first.replace('BARRIER','select pg_advisory_xact_lock(983156);'),'master_first')
        wait_sql("exists(select 1 from pg_stat_activity where application_name='master_first' and wait_event_type='Lock')")
        b=start(second,'master_second')
        wait_sql("exists(select 1 from pg_stat_activity where application_name='master_second' and wait_event_type='Lock')")
        ao,ae=a.communicate(timeout=20);bo,be=b.communicate(timeout=20);gate.communicate(timeout=20)
        if a.returncode or b.returncode==0 or fragment not in be: raise RuntimeError(f'{label}: first={ae}, second={be}')
        print('PASS actual lock wait: '+label,flush=True)
    pair(auth+"begin;select id from brands where id='bb000000-0000-4000-8000-000000000001' for update;BARRIER select change_master_data_lifecycle('brands','bb000000-0000-4000-8000-000000000001','trash',0,'trash race first');commit;",
         "update items set brand_id='bb000000-0000-4000-8000-000000000001' where code='RACE-ONE';",'Sampah','trash wins / new FK rejected')
    pair("begin;update items set brand_id='bb000000-0000-4000-8000-000000000002' where code='RACE-TWO';BARRIER commit;",
         auth+"select change_master_data_lifecycle('brands','bb000000-0000-4000-8000-000000000002','trash',0,'reference race first');",'pemakaian atau riwayat','new FK wins / trash rejected')
    pair(auth+"begin;select id from units where id='bc000000-0000-4000-8000-000000000001' for update;BARRIER select change_master_data_lifecycle('units','bc000000-0000-4000-8000-000000000001','trash',0,'unit race first');commit;",
         "update items set unit='race-unit-one' where code='RACE-ONE';",'Sampah','trash wins / new text unit rejected')
    pair("begin;update items set unit='race-unit-two' where code='RACE-TWO';BARRIER commit;",
         auth+"select change_master_data_lifecycle('units','bc000000-0000-4000-8000-000000000002','trash',0,'unit reference first');",'pemakaian atau riwayat','new text unit wins / trash rejected')
    pair(auth+"begin;select id from brands where id='bb000000-0000-4000-8000-000000000003' for update;BARRIER select change_master_data_lifecycle('brands','bb000000-0000-4000-8000-000000000003','archive',0,'first archive');commit;",
         auth+"select change_master_data_lifecycle('brands','bb000000-0000-4000-8000-000000000003','archive',0,'competing archive');",'Data sudah berubah','competing same-version action')
    pair(auth+"begin;select id from brands where id='bb000000-0000-4000-8000-000000000005' for update;BARRIER select change_master_data_lifecycle('brands','bb000000-0000-4000-8000-000000000005','trash',0,'JSON trash first');commit;",
         "update employee_import_details set fields=jsonb_build_object('brand','bb000000-0000-4000-8000-000000000005') where employee_id='bd000000-0000-4000-8000-000000000001';",'Sampah','trash wins / new JSON snapshot rejected')
    pair("begin;update employee_import_details set fields=jsonb_build_object('brand','BB000000-0000-4000-8000-000000000006') where employee_id='bd000000-0000-4000-8000-000000000002';BARRIER commit;",
         auth+"select change_master_data_lifecycle('brands','bb000000-0000-4000-8000-000000000006','trash',0,'JSON reference first');",'pemakaian atau riwayat','uppercase JSON snapshot wins / trash rejected')
    sql("""insert into items(id,code,name) values('bf000000-0000-4000-8000-000000000001','CODE-RACE-ONE','Fictional code race one'),('bf000000-0000-4000-8000-000000000002','CODE-RACE-TWO','Fictional code race two');
insert into import_runs(id,kind,source_name,source_hash,created_by) values('b9000000-0000-4000-8000-000000000001','master_accurate','Fictional code race','fictional-code-race','ba000000-0000-4000-8000-000000000001');
""")
    pair(auth+"begin;select id from items where id='bf000000-0000-4000-8000-000000000001' for update;BARRIER select change_master_data_lifecycle('items','bf000000-0000-4000-8000-000000000001','trash',0,'code trash first');commit;",
         "insert into import_run_rows(run_id,source_row,source_code,status,payload) values('b9000000-0000-4000-8000-000000000001',1,'CODE-RACE-ONE','valid','{}');",'Sampah','trash wins / new import source code rejected')
    pair("begin;insert into import_run_rows(run_id,source_row,source_code,status,payload) values('b9000000-0000-4000-8000-000000000001',2,null,'valid',jsonb_build_object('code','CODE-RACE-TWO'));BARRIER commit;",
         auth+"select change_master_data_lifecycle('items','bf000000-0000-4000-8000-000000000002','trash',0,'code snapshot first');",'pemakaian atau riwayat','JSON code snapshot wins / trash rejected')
    sql("""insert into items(id,code,name) values
('cf000000-0000-4000-8000-000000000001','CODE-LOCK-SOURCE','Fictional source-code rename guard'),
('cf000000-0000-4000-8000-000000000002','CODE-LOCK-JSON','Fictional JSON-code rename guard'),
('cf000000-0000-4000-8000-000000000003','CODE-CHANGE-SOURCE','Fictional unused source-code rename'),
('cf000000-0000-4000-8000-000000000004','CODE-CHANGE-JSON','Fictional unused JSON-code rename');
""")
    pair("begin;insert into import_run_rows(run_id,source_row,source_code,status,payload) values('b9000000-0000-4000-8000-000000000001',11,'CODE-LOCK-SOURCE','valid','{}');BARRIER commit;",
         auth+"update items set code='CODE-LOCK-SOURCE-RENAMED' where id='cf000000-0000-4000-8000-000000000001';",'Kode SKU sudah memiliki riwayat','source code reference wins / rename rejected')
    pair("begin;insert into import_run_rows(run_id,source_row,source_code,status,payload) values('b9000000-0000-4000-8000-000000000001',12,null,'valid',jsonb_build_object('code','CODE-LOCK-JSON'));BARRIER commit;",
         auth+"update items set code='CODE-LOCK-JSON-RENAMED' where id='cf000000-0000-4000-8000-000000000002';",'Kode SKU sudah memiliki riwayat','JSON code reference wins / rename rejected')
    pair(auth+"begin;select id from items where id='cf000000-0000-4000-8000-000000000003' for update;BARRIER update items set code='CODE-CHANGED-SOURCE' where id='cf000000-0000-4000-8000-000000000003';commit;",
         "insert into import_run_rows(run_id,source_row,source_code,status,payload) values('b9000000-0000-4000-8000-000000000001',13,'CODE-CHANGE-SOURCE','valid','{}');",'Kode SKU sudah berubah','unused rename wins / waiting source-code writer rejects old identity')
    pair(auth+"begin;select id from items where id='cf000000-0000-4000-8000-000000000004' for update;BARRIER update items set code='CODE-CHANGED-JSON' where id='cf000000-0000-4000-8000-000000000004';commit;",
         "insert into import_run_rows(run_id,source_row,source_code,status,payload) values('b9000000-0000-4000-8000-000000000001',14,null,'valid',jsonb_build_object('code','CODE-CHANGE-JSON'));",'Kode SKU sudah berubah','unused rename wins / waiting JSON-code writer rejects old identity')
    if sql("select count(*) from import_run_rows where run_id='b9000000-0000-4000-8000-000000000001' and source_row in (13,14);",tuples=True).stdout.strip()!='0': raise RuntimeError('Rename race committed stale provenance')
    if sql("select count(*) from items where id in ('cf000000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000002') and code in ('CODE-LOCK-SOURCE','CODE-LOCK-JSON') and trashed_at is null;",tuples=True).stdout.strip()!='2': raise RuntimeError('Referenced identities changed during rename race')
    print('PASS code rename race provenance and unchanged referenced identities',flush=True)
    sql("""insert into auth.users(id) values('ba000000-0000-4000-8000-000000000002');
update profiles set role='ADMIN',is_active=true where id='ba000000-0000-4000-8000-000000000002';
insert into role_capabilities(role,all_branches,create_accounts) values('ADMIN',false,false) on conflict(role) do update set all_branches=false;
insert into branches(id,code,name,type) values('be000000-0000-4000-8000-000000000001','RACE-BRANCH','Fictional race branch','KLINIK');
insert into user_branches(user_id,branch_id) values('ba000000-0000-4000-8000-000000000002','be000000-0000-4000-8000-000000000001');
insert into employees(id,nama,branch_id) values('bd000000-0000-4000-8000-000000000003','Fictional branch employee','be000000-0000-4000-8000-000000000001');
""")
    branch_auth="set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='ba000000-0000-4000-8000-000000000002';"
    pair("begin;select id from employees where id='bd000000-0000-4000-8000-000000000003' for update;BARRIER delete from user_branches where user_id='ba000000-0000-4000-8000-000000000002';commit;",
         branch_auth+"select change_master_data_lifecycle('employees','bd000000-0000-4000-8000-000000000003','archive',0,'branch revoked while waiting');",'Cabang karyawan tidak dapat diakses','branch grant revoked during target lock wait')
    # Actor revocation commits while the lifecycle call is queued at target row.
    pair("begin;select id from brands where id='bb000000-0000-4000-8000-000000000004' for update;BARRIER update profiles set is_active=false where id='ba000000-0000-4000-8000-000000000001';commit;",
         auth+"select change_master_data_lifecycle('brands','bb000000-0000-4000-8000-000000000004','archive',0,'revoked while waiting');",'Akses master sudah dicabut','actor revoked during target lock wait')
    result=sql("select count(*) from master_data_lifecycle_audit;",tuples=True).stdout.strip()
    if result!='5': raise RuntimeError('Unexpected race audit count '+result)
    print('PASS race audit count and no partial side effects',flush=True)
finally:
    subprocess.run(['docker','rm','-f','-v',CONTAINER],capture_output=True)
