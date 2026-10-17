#!/usr/bin/env python3
"""Check role capabilities on disposable PostgreSQL with fictional identities."""
import subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parents[1]
def run(*args,**kw):
 r=subprocess.run(['docker',*args],text=True,capture_output=True,**kw)
 if r.returncode: raise RuntimeError(r.stderr+r.stdout)
 return r
c=run('run','--rm','-d','--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16').stdout.strip()
try:
 for _ in range(100):
  if subprocess.run(['docker','exec',c,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.1)
 def sql(s):
  r=run('exec','-i',c,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1',input=s)
  return r.stdout
 base="""create role authenticated;create role anon;create schema auth;
 create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated;
 """
 for m in ['0001_core','0002_rls','0060_user_admin']:
  base+=(root/f'supabase/migrations/{m}.sql').read_text()
 base+="create table public.employees(id uuid primary key,status text default 'Aktif',profile_id uuid references profiles);alter table employees enable row level security;"
 base+=(root/'supabase/migrations/20261017090000_role_capabilities.sql').read_text()
 base+="grant all on all tables in schema public to authenticated;"
 sql(base)
 sql("""insert into auth.users(id) values ('aa000000-0000-4000-8000-000000000001'),('aa000000-0000-4000-8000-000000000002'),('aa000000-0000-4000-8000-000000000003');
 update profiles set role='OWNER' where id='aa000000-0000-4000-8000-000000000001';
 insert into branches(id,code,name,type)values('bb000000-0000-4000-8000-000000000001','TEST','Fiction clinic','KLINIK');
 insert into employees(id)values('cc000000-0000-4000-8000-000000000001');
 """)
 def actor(n):return "set role authenticated;select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-00000000000"+str(n)+"',false);"
 def check(source):sql(source)
 check(actor(2)+"""do $$begin
 if has_role_capability('all_branches') or has_role_capability('create_accounts') then raise exception 'staff defaults';end if;
 begin insert into role_capabilities values('STAFF',true,true);raise exception 'unauthorized grant';exception when insufficient_privilege then null;end;
 end$$;""")
 check(actor(1)+"insert into role_capabilities values('STAFF',true,true);")
 check(actor(2)+"""do $$begin
 if not has_role_capability('all_branches') or not has_role_capability('create_accounts') or not user_can_access_branch('bb000000-0000-4000-8000-000000000001') then raise exception 'delegated rights';end if;
 begin perform configure_employee_account('aa000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000001','Fiction','OWNER',array['bb000000-0000-4000-8000-000000000001']::uuid[]);raise exception 'escalation allowed';exception when raise_exception then if sqlerrm<>'ACCOUNT_ROLE_NOT_ALLOWED' then raise;end if;end;
 perform configure_employee_account('aa000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000001','Fiction','STAFF',array['bb000000-0000-4000-8000-000000000001']::uuid[]);
 if not exists(select 1 from employees where profile_id='aa000000-0000-4000-8000-000000000003') then raise exception 'missing link';end if;
 end$$;
 select set_config('request.headers','{"x-kamo-operational-branch":"bb000000-0000-4000-8000-000000000002"}',false);
 do $$begin if user_can_access_branch('bb000000-0000-4000-8000-000000000001') then raise exception 'scope widened';end if;end$$;
 """)
 check(actor(1)+"update role_capabilities set all_branches=false,create_accounts=false where role='STAFF';")
 check(actor(2)+"""do $$begin if has_role_capability('all_branches') or has_role_capability('create_accounts') then raise exception 'revocation failed';end if;end$$;""")
 print('PASS: actual migration, owner-only settings RLS, delegated account creation, escalation denied, branch scope and immediate revocation')
finally:run('rm','-f',c)
