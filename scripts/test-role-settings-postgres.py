#!/usr/bin/env python3
"""Socket-only original full-schema PG17 role settings proof. No hosted access."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import uuid
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres
CANDIDATE = '20261106120000_role_settings_atomic.sql'
INPUT_EVIDENCE = Path('/opt/data/kamo-role-settings-evidence')  # read-only inputs (planned catalog)
EVIDENCE = Path('/opt/data/kamo-role-settings-evidence/recompose2')  # all new output
spec = importlib.util.spec_from_file_location('fullschema', ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
assert spec is not None and spec.loader is not None
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
IDS = {role: str(uuid.UUID(int=i+1)) for i, role in enumerate(['OWNER','ADMIN','FINANCE','STAFF','DOCTOR','INACTIVE'])}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', action='store_true')
    parser.add_argument('--action-slice', type=int, default=0)
    args = parser.parse_args()
    candidate_bytes=(ROOT/'supabase/migrations'/CANDIDATE).read_bytes()
    report = {'run_id':str(uuid.uuid4()), 'baseline': args.baseline, 'action_slice':args.action_slice, 'checks': [], 'gaps': [], 'harness_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    report['candidate_dependencies']={name:{'present':(ROOT/'supabase/migrations'/name).exists(),'applied':name==CANDIDATE,'sha256':hashlib.sha256((ROOT/'supabase/migrations'/name).read_bytes()).hexdigest() if (ROOT/'supabase/migrations'/name).exists() else None} for name in [CANDIDATE,'20261106130000_role_bank_actions.sql','20261106140000_role_hris_user_actions.sql']}
    domain_bytes={name:(ROOT/'supabase/migrations'/name).read_bytes() for name in ['20261106130000_role_bank_actions.sql','20261106140000_role_hris_user_actions.sql']}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    def passed(name):
        report['checks'].append(name)
        print('PASS', name, flush=True)
    lock = open('/opt/data/kamo-heavy-test.lock','a')
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
      with tempfile.TemporaryDirectory(prefix='roles-main-', dir='/opt/data') as tmp:
        migrations = Path(tmp)/'supabase/migrations'
        migrations.mkdir(parents=True)
        base_names = subprocess.run(['git','ls-tree','-r','--name-only','0d5e2434325157faff90c37ff7959a9798072ef9','--','supabase/migrations'],cwd=ROOT,capture_output=True,text=True,check=True).stdout.splitlines()
        originals = sorted(ROOT/name for name in base_names if name.endswith('.sql'))
        assert len(originals) == 365
        report['original_hashes'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in originals}
        base = subprocess.run(['git','ls-tree','-r','0d5e2434325157faff90c37ff7959a9798072ef9','--','supabase/migrations'],cwd=ROOT,capture_output=True,text=True,check=True).stdout
        for p in originals:
            oid = next(line.split()[2] for line in base.splitlines() if line.endswith('\t'+str(p.relative_to(ROOT))))
            original = subprocess.run(['git','cat-file','blob',oid],cwd=ROOT,capture_output=True,check=True).stdout
            assert original == p.read_bytes(), p.name+' original changed'
            (migrations/p.name).symlink_to(p)
        fixture.ROOT = Path(tmp)
        with NativePostgres('/opt/data/kamo-pg-harness/bin') as db:
            fixture.DisposablePostgres.bootstrap(db)
            report['server_version'] = db.last('show server_version')
            assert 170000 <= int(db.last('show server_version_num')) < 180000
            passed('365 byte-identical original migrations; runtime PG17')
            funcs = "select jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl::text,'config',p.proconfig,'definer',p.prosecdef,'owner',p.proowner)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'"
            before = json.loads(db.last(funcs))
            report['original_function_count']=len(before)
            report['original_function_metadata_sha256']={k:hashlib.sha256(json.dumps(v,sort_keys=True).encode()).hexdigest() for k,v in before.items()}
            writers = {sig:meta['definition'] for sig,meta in before.items() if re.search(r'\b(insert\s+into|update|delete\s+from|truncate)\s+(?:public\.)?role_(?:modules|capabilities)\b',meta['definition'],re.I)}
            report['existing_config_function_writers'] = writers
            assert not writers, 'Review legitimate existing config writers before guards'
            policies = "select coalesce(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname),'[]') from pg_policies p where schemaname='public'"
            policies_before = db.last(policies)
            report['original_policy_sha256']=hashlib.sha256(policies_before.encode()).hexdigest()
            report['original_policy_count']=len(json.loads(policies_before))
            report['application_config_writers']=['Original akses-grup/actions.ts save/reset role_modules delete+insert; capability upsert. No original SQL config-writing function found. configure_employee_account/edit_user_account write profiles/employee/user_branches, not role configuration.']
            for role,ident in IDS.items():
                db.sql(f"insert into auth.users(id,email) values('{ident}','{role.lower()}@fiction.invalid') on conflict do nothing; update profiles set role='{role if role != 'INACTIVE' else 'OWNER'}',is_active={'false' if role == 'INACTIVE' else 'true'} where id='{ident}';")
            def actor(role, sql, dbrole='authenticated'):
                ident = IDS.get(role, role)
                return f"begin; set local role {dbrole}; set local request.jwt.claim.sub='{ident}'; set local request.jwt.claim.role='{dbrole}'; set local request.jwt.claims='{{\"sub\":\"{ident}\",\"role\":\"{dbrole}\",\"user_role\":\"OWNER\"}}'; {sql}; commit;"
            def call(role, sql, dbrole='authenticated'):
                return db.sql(actor(role,sql,dbrole))
            def config(role, who='OWNER'):
                return json.loads(call(who,f"select public.get_role_access_config('{role}')"))
            def save(role, rev, key=None, modules=None, caps=None, mode='custom', reason='native proof', who='OWNER'):
                key = key or str(uuid.uuid4())
                modules = [] if modules is None else modules
                caps = {'all_branches':False,'create_accounts':False} if caps is None and mode=='custom' else caps
                literal = lambda x: "'"+json.dumps(x).replace("'","''")+"'::jsonb"
                return f"select public.save_role_access_config('{role}','{rev}','{key}','{mode}',{literal(modules)},{literal(caps)},'{reason}')"
            def denied(sql, who='OWNER', match=None, dbrole='authenticated'):
                try: call(who,sql,dbrole)
                except RuntimeError as e:
                    if match: assert match in str(e), str(e)
                    return
                raise AssertionError('Expected denial: '+sql)
            command=db.as_user+[db.psql,'-X','-qAt','-h',str(db.root),'-U','postgres','-v','ON_ERROR_STOP=1']
            def live(sql):
                p=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
                p.stdin.write(sql+'\n'); p.stdin.flush()
                return p
            def finish(p,sql=''):
                try:
                    if sql: os.write(p.stdin.fileno(),(sql+'\n').encode())
                    p.stdin.close()
                except BrokenPipeError:
                    pass
                p.stdin=None
                out,err=p.communicate(timeout=15)
                return p.returncode,out,err
            def wait_block(name,blocker):
                deadline=time.monotonic()+8
                while time.monotonic()<deadline:
                    rows=json.loads(db.last("select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait_event_type',wait_event_type,'wait_event',wait_event)),'[]') from pg_stat_activity where application_name='"+name+"' and wait_event_type='Lock'"))
                    if rows and blocker in rows[0]['blockers']:
                        report.setdefault('observed_locks',[]).append(rows[0]); print('LOCK',name,rows[0],flush=True); return rows[0]
                    time.sleep(.03)
                raise AssertionError('No actual expected blocker observed: '+name)
            if args.baseline:
                # Existing two-request API can persist deletion before replacement fails.
                db.sql("insert into role_modules(role,module_id) values('STAFF','klinik');")
                call('OWNER',"delete from role_modules where role='STAFF'")
                denied("insert into role_modules(role,module_id) values('STAFF',repeat('x',25))",match='too long')
                assert db.last("select count(*) from role_modules where role='STAFF'")=='0'
                passed('RED old public table API commits destructive partial save')
                # This must fail on the original schema, not on a fabricated substitute.
                config('STAFF')
                raise AssertionError('Original unexpectedly has atomic RPC')
            candidate = ROOT/'supabase/migrations'/CANDIDATE
            report['candidate_sha256'] = hashlib.sha256(candidate_bytes).hexdigest()
            # Legacy fixtures must not be rewritten by installation.
            db.sql("insert into role_modules(role,module_id) values('STAFF','klinik'),('FINANCE','dashboard'),('DOCTOR','crm');")
            saved_before = db.last("select jsonb_agg(to_jsonb(m) order by role,module_id) from role_modules m")
            db.sql('begin;'+candidate_bytes.decode()+'commit;')
            assert saved_before == db.last("select jsonb_agg(to_jsonb(m) order by role,module_id) from role_modules m")
            after=json.loads(db.last(funcs))
            assert all(after[k]==v for k,v in before.items()), 'Existing function drift'
            assert policies_before == db.last(policies), 'Existing policy drift'
            passed('all original public functions metadata and policies unchanged; no install-time role rewrites')
            if args.action_slice:
                c=config('STAFF')
                planned=json.loads((INPUT_EVIDENCE/'planned-action-catalog.json').read_text())['entries']
                assert 'actions' in c and 'action_catalog' in c, 'ACTION_SOURCE_GAP: reader lacks action state/catalogue'
                assert c['actions']=={'source':'legacy','allowed':[]}
                assert len(c['action_catalog'])==116
                assert {x['id'] for x in c['action_catalog']}=={x['id'] for x in planned}
                assert all(x['enforced'] is False and x['label'] and x['group'] for x in c['action_catalog'])
                passed('116 exact planned actions disabled; compact legacy action snapshot')
                if args.action_slice >= 2:
                    key=str(uuid.uuid4())
                    q=save('STAFF',c['revision'],key=key)[:-1]+",'[]'::jsonb)"
                    r=json.loads(call('OWNER',q))
                    custom=config('STAFF')
                    assert custom['actions']=={'source':'custom','allowed':[]}
                    assert custom['revision']!=c['revision']
                    assert 'action_catalog' not in custom['audit'][0]['before'] and 'action_catalog' not in custom['audit'][0]['after']
                    assert json.loads(call('OWNER',q))=={**r,'already_applied':True}
                    call('OWNER',save('STAFF',custom['revision'],modules=['pos']))
                    assert config('STAFF')['actions']==custom['actions'], 'legacy7 must preserve action policy'
                    no_op=config('STAFF')
                    call('OWNER',save('STAFF',no_op['revision'],modules=['pos']))
                    assert config('STAFF')['revision']!=no_op['revision'], 'logical epoch must advance for no-op'
                    denied(save('STAFF',no_op['revision'],modules=['pos']),match='ROLE_REVISION_CONFLICT')
                    call('OWNER',save('STAFF',config('STAFF')['revision'],mode='reset'))
                    assert config('STAFF')['actions']=={'source':'legacy','allowed':[]}
                    assert config('STAFF')['revision']!=c['revision'], 'ABA reset must not restore old revision'
                    denied(save('STAFF',config('STAFF')['revision'])[:-1]+",'[\"unknown\"]'::jsonb)",match='ROLE_ACTION_INVALID')
                    passed('eight-argument save/reset/replay; compact audit; legacy7 preserves; no-op stale revision refused')
                if args.action_slice >= 3:
                    assert call('OWNER',"select public.role_action_allowed('bank.cash_accounts.create')")=='f'
                    db.sql("update role_settings_private.action_catalog set enforced=true where id='bank.cash_accounts.create'")
                    assert call('OWNER',"select public.role_action_allowed('bank.cash_accounts.create')")=='t'
                    assert call('ADMIN',"select public.role_action_allowed('bank.cash_accounts.create')")=='t'
                    assert call('INACTIVE',"select public.role_action_allowed('bank.cash_accounts.create')")=='f'
                    assert call('OWNER',"select public.role_action_allowed('unknown')")=='f'
                    a=save('ADMIN',config('ADMIN')['revision'],modules=['kas-bank'])[:-1]+",'[]'::jsonb)"
                    call('OWNER',a)
                    assert call('ADMIN',"select public.role_action_allowed('bank.cash_accounts.create')")=='f'
                    denied("select public.require_role_action('bank.cash_accounts.create')",who='ADMIN',match='ROLE_ACTION_DENIED')
                    a=save('ADMIN',config('ADMIN')['revision'],modules=['kas-bank'])[:-1]+",'[\"bank.cash_accounts.create\"]'::jsonb)"
                    call('OWNER',a)
                    assert call('ADMIN',"select public.role_action_allowed('bank.cash_accounts.create')")=='t'
                    call('OWNER',save('ADMIN',config('ADMIN')['revision']))
                    assert call('ADMIN',"select public.role_action_allowed('bank.cash_accounts.create')")=='f', 'v2 module denial cannot be bypassed'
                    for table in ['epochs','action_policies','action_catalog','action_modules']:
                        denied(f'update role_settings_private.{table} set '+('epoch=epoch' if table=='epochs' else 'allowed=allowed' if table=='action_policies' else 'id=id'),match='permission denied')
                    for selection in ['[\"bank.cash_accounts.create\",\"bank.cash_accounts.create\"]','[null]','[\"bank.cash_accounts.view_balance_history\"]']:
                        denied(save('ADMIN',config('ADMIN')['revision'])[:-1]+",'"+selection+"'::jsonb)",match='ROLE_ACTION_INVALID')
                    passed('real authenticated action gate: enabled/legacy/custom/Owner/inactive/unknown/v2 module ceiling')
                if args.action_slice >= 4:
                    action='bank.cash_accounts.create'
                    # Gate waits on exact epoch owner; committed actor revocation
                    # is visible after that wait, not hidden by statement snapshot.
                    holder=live("begin;select 1 from role_settings_private.epochs where role='ADMIN' for update;select pg_backend_pid();")
                    holder.stdout.readline(); holder_pid=int(holder.stdout.readline())
                    gate=live("set application_name='action-after-epoch';"+actor('ADMIN',f"select public.role_action_allowed('{action}')"))
                    wait_block('action-after-epoch',holder_pid)
                    db.sql(f"update profiles set is_active=false where id='{IDS['ADMIN']}'")
                    assert finish(holder,'commit;')[0]==0
                    rc,out,err=finish(gate)
                    assert rc==0 and out.strip()=='f', (rc,out,err)
                    db.sql(f"update profiles set is_active=true where id='{IDS['ADMIN']}'")
                    passed('actual blocked epoch gate sees committed inactive actor after wait')
                    # Config UPDATE and action SHARE serialize in both directions.
                    call('OWNER',save('ADMIN',config('ADMIN')['revision'],modules=['kas-bank'],mode='custom')[:-1]+",'[\"bank.cash_accounts.create\"]'::jsonb)")
                    holder=live(actor('ADMIN',f"select public.role_action_allowed('{action}')").replace('commit;','select pg_backend_pid();'))
                    assert holder.stdout.readline().strip()=='t'
                    holder_pid=int(holder.stdout.readline())
                    rev=config('ADMIN')['revision']
                    updater=live("set application_name='action-policy-update';"+actor('OWNER',save('ADMIN',rev,modules=['kas-bank'])[:-1]+",'[]'::jsonb)"))
                    wait_block('action-policy-update',holder_pid)
                    revoker=live("set application_name='action-actor-revoker';begin;update profiles set is_active=false where id='"+IDS['ADMIN']+"';commit;")
                    wait_block('action-actor-revoker',holder_pid)
                    assert finish(holder,'commit;')[0]==0
                    # Both post-fence transactions can finish in either order.
                    rc,out,err=finish(updater)
                    assert rc==0 or 'could not obtain lock on relation "public.profiles"' in err, (rc,out,err)
                    assert finish(revoker)[0]==0
                    if rc!=0:
                        call('OWNER',save('ADMIN',rev,modules=['kas-bank'])[:-1]+",'[]'::jsonb)")
                    db.sql(f"update profiles set is_active=true where id='{IDS['ADMIN']}'")
                    assert call('ADMIN',f"select public.role_action_allowed('{action}')")=='f'
                    passed('epoch SHARE prevents config UPDATE; current profile fence prevents committed revocation through action commit')
                    # A nonOwner must not queue behind the epoch at all.
                    holder=live("begin;select 1 from role_settings_private.epochs where role='STAFF' for update;select pg_backend_pid();")
                    holder.stdout.readline(); holder_pid=int(holder.stdout.readline())
                    denied("set local statement_timeout='500ms';"+save('STAFF',config('STAFF')['revision']),who='ADMIN',match='ROLE_OWNER_REQUIRED')
                    assert finish(holder,'commit;')[0]==0
                    passed('nonOwner refuses before blocked epoch; no expensive authorization wait')
                if args.action_slice >= 5:
                    # Exact independent three-session original RPC schedule: a
                    # third party holds larger B; original editor owns A then
                    # waits on B; gate + original bank RPC must not form a cycle.
                    A=IDS['OWNER']; B=IDS['FINANCE']
                    db.sql("update role_settings_private.action_catalog set enforced=true where id='bank.cash_transfer.create'")
                    version=db.last(f"select public.user_account_edit_snapshot('{B}')->>'version'")
                    third=live(f"begin;select id from profiles where id='{B}' for update;select pg_backend_pid();")
                    third.stdout.readline(); third_pid=int(third.stdout.readline())
                    editor=live("set application_name='fix1-original-editor';set deadlock_timeout='1s';set statement_timeout='10s';"+actor('OWNER',f"select public.edit_user_account('{B}','Fix1 legitimate original edit','FINANCE',array[]::uuid[],'{version}','{uuid.uuid4()}')"))
                    editor_lock=wait_block('fix1-original-editor',third_pid)
                    bank=live("\\set VERBOSITY verbose\nset application_name='fix1-original-bank';set deadlock_timeout='1s';set statement_timeout='10s';"+actor('OWNER',"select pg_backend_pid();select public.role_action_allowed('bank.cash_transfer.create');select public.mutate_cash_transfer('independent-proof','create',null,null,'{}'::jsonb,null)"))
                    bank_pid=int(bank.stdout.readline())
                    report['original_account_bank_pids']={'target_holder':third_pid,'editor':editor_lock['pid'],'bank':bank_pid}
                    deadline=time.monotonic()+5
                    while bank.poll() is None and time.monotonic()<deadline:
                        rows=json.loads(db.last("select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait_event',wait_event)),'[]') from pg_stat_activity where application_name='fix1-original-bank'"))
                        if rows and editor_lock['pid'] in rows[0]['blockers']:
                            report.setdefault('observed_locks',[]).append(rows[0]); break
                        time.sleep(.03)
                    assert finish(third,'commit;')[0]==0
                    bank_result=finish(bank); editor_result=finish(editor)
                    report['original_account_bank_journey']={'editor':editor_result,'bank':bank_result,'editor_lock':editor_lock}
                    assert editor_result[0]==0, editor_result
                    assert bank_result[0]!=0 and '55P03' in bank_result[2], bank_result
                    assert all('40P01' not in r[2] and 'deadlock detected' not in r[2] for r in [bank_result,editor_result])
                    assert db.last(f"select full_name from profiles where id='{B}'")=='Fix1 legitimate original edit'
                    # A new attempt reaches the unchanged bank business checks,
                    # not a profile wait. Empty financial input is NOT a posting.
                    denied("select public.mutate_cash_transfer('independent-proof','create',null,null,'{}'::jsonb,null)",match='Tanggal transfer tidak valid')
                    passed('three-session original account -> bank journey: immediate 55P03 retry; original edit commits; no 40P01')
                    # A held action fence must not serialize unrelated original
                    # account/profile writes (the former global SRX did so).
                    holder=live(actor('OWNER',"select public.role_action_allowed('bank.cash_transfer.create')").replace('commit;','select pg_backend_pid();'))
                    assert holder.stdout.readline().strip()=='t'; holder_pid=int(holder.stdout.readline())
                    db.sql(f"set statement_timeout='1s';update profiles set full_name='Independent target progresses' where id='{B}'")
                    assert finish(holder,'commit;')[0]==0
                    passed('actor fence permits unrelated profile UPDATE while action transaction is open')
                    # Commit a role downgrade while blocked on epoch; forged JWT
                    # OWNER must not mask the freshly committed actual role.
                    holder=live("begin;select 1 from role_settings_private.epochs where role='ADMIN' for update;select pg_backend_pid();")
                    holder.stdout.readline(); holder_pid=int(holder.stdout.readline())
                    gate=live("set application_name='fix1-role-after-epoch';"+actor('OWNER',f"select public.role_action_allowed('{action}')"))
                    wait_block('fix1-role-after-epoch',holder_pid)
                    db.sql(f"update profiles set role='ADMIN' where id='{A}'")
                    assert finish(holder,'commit;')[0]==0
                    rc,out,err=finish(gate); assert rc==0 and out.strip()=='f', (rc,out,err)
                    db.sql(f"update profiles set role='OWNER' where id='{A}'")
                    passed('fresh actual role downgrade after epoch wait denies despite forged JWT Owner')
                    for name,data in domain_bytes.items():
                        assert hashlib.sha256(data).hexdigest()==report['candidate_dependencies'][name]['sha256']
                        db.sql(data.decode()); report['candidate_dependencies'][name]['applied']=True
                    # Real People wrapper: lower UUID target is held; actor row
                    # remains free until the complete sorted set can be obtained.
                    upper=str(uuid.UUID(int=90))
                    db.sql(f"insert into auth.users(id,email) values('{upper}','fix1-upper@fiction.invalid');update profiles set role='OWNER',is_active=true where id='{upper}'")
                    version=db.last(f"select public.user_account_edit_snapshot('{B}')->>'version'")
                    def effects_hash():
                        # Every public table (incl. audit/request ledgers) + role_settings_private ledgers.
                        names=json.loads(db.last("select jsonb_agg(schemaname||'.'||tablename order by schemaname,tablename) from pg_tables where schemaname in ('public','role_settings_private','people_actions_private') "))
                        return {t:db.last("select md5(coalesce(string_agg(to_jsonb(x)::text,chr(10) order by to_jsonb(x)::text),'')) from "+t+" x") for t in names}
                    third=live(f"begin;select id from profiles where id='{B}' for update;select pg_backend_pid();")
                    third.stdout.readline(); third_pid=int(third.stdout.readline())
                    wrapper_key=str(uuid.uuid4())
                    wrapper_sql=actor(upper,f"select public.edit_user_account('{B}','Sorted wrapper commits','FINANCE',array[]::uuid[],'{version}','{wrapper_key}')")
                    # Sorted-wrapper ORDERING (still meaningful under NOWAIT): the actor Profile
                    # SHARE is the first, blocking step; then the Employee set; the target Profile is
                    # last and never waited for. Observed with real blocker PIDs, not sleeps.
                    ord_branch=str(uuid.UUID(int=9100)); ord_employee=str(uuid.UUID(int=9101))
                    db.sql(f"insert into branches(id,name,code,type,is_active) values('{ord_branch}','Fix1 order','FXO','BOTH',true);insert into employees(id,nama,status,branch_id,profile_id) values('{ord_employee}','Fix1 actor employee','Aktif','{ord_branch}','{upper}')")
                    effects_before=effects_hash()
                    actor_holder=live(f"begin;select id from profiles where id='{upper}' for update;select pg_backend_pid();")
                    actor_holder.stdout.readline(); actor_holder_pid=int(actor_holder.stdout.readline())
                    editor=live("\\set VERBOSITY verbose\nset application_name='fix1-sorted-wrapper-actor';set statement_timeout='8s';"+wrapper_sql)
                    wait_block('fix1-sorted-wrapper-actor',actor_holder_pid)
                    assert finish(actor_holder,'commit;')[0]==0
                    rc,out,err=finish(editor); assert rc!=0 and '40001' in err and 'PEOPLE_ACCOUNT_BUSY' in err, (rc,out,err)
                    employee_holder=live(f"begin;select id from employees where id='{ord_employee}' for update;select pg_backend_pid();")
                    employee_holder.stdout.readline(); employee_holder_pid=int(employee_holder.stdout.readline())
                    editor=live("\\set VERBOSITY verbose\nset application_name='fix1-sorted-wrapper-employee';set statement_timeout='8s';"+wrapper_sql)
                    wait_block('fix1-sorted-wrapper-employee',employee_holder_pid)
                    # While waiting on the Employee step the actor Profile SHARE is ALREADY held (actor-first) ...
                    try:
                        db.sql(f"set lock_timeout='1s';begin;select id from profiles where id='{upper}' for update nowait;rollback;")
                        raise AssertionError('actor Profile SHARE must already be held while waiting for Employee')
                    except RuntimeError as exc:
                        assert 'could not obtain lock' in str(exc), exc
                    assert finish(employee_holder,'commit;')[0]==0
                    rc,out,err=finish(editor); assert rc!=0 and '40001' in err and 'PEOPLE_ACCOUNT_BUSY' in err, (rc,out,err)
                    assert effects_hash()==effects_before, 'ordering probes must leave zero effects'
                    # CURRENT contract (reviewed fix2): the target Profile lock is last and
                    # NOWAIT. A held target must fail closed IMMEDIATELY (40001 PEOPLE_ACCOUNT_BUSY),
                    # never wait on the target. The old wait_block('fix1-sorted-wrapper') observation
                    # of a Lock wait is obsolete: a waiting backend would be a contract violation.
                    editor=live("\\set VERBOSITY verbose\nset application_name='fix1-sorted-wrapper';set statement_timeout='8s';"+wrapper_sql)
                    started=time.monotonic()
                    rc,out,err=finish(editor)
                    assert rc!=0 and '40001' in err and 'PEOPLE_ACCOUNT_BUSY' in err, (rc,out,err)
                    assert 'statement timeout' not in err and '40P01' not in err and 'deadlock detected' not in err, err
                    assert time.monotonic()-started<7, 'PEOPLE_ACCOUNT_BUSY must be immediate (NOWAIT), not a statement-timeout wait'
                    report.setdefault('people_account_busy',[]).append({'holder_pid':third_pid,'sqlstate':'40001','message':'PEOPLE_ACCOUNT_BUSY','stderr':[l for l in err.splitlines() if 'PEOPLE_ACCOUNT_BUSY' in l][0]})
                    # Zero effects: no profile/ledger/audit/request-key row changed and the target is still held.
                    assert db.last(f"select full_name from profiles where id='{B}'")!='Sorted wrapper commits'
                    assert effects_hash()==effects_before, 'failed-closed PEOPLE_ACCOUNT_BUSY must have zero effects'
                    # Actor row stays free and unrelated targets progress while the target is held.
                    db.sql(f"begin;select id from profiles where id='{upper}' for update nowait;rollback;")
                    db.sql(f"set statement_timeout='1s';update profiles set full_name='Unrelated actor progresses' where id='{IDS['STAFF']}'")
                    assert finish(third,'commit;')[0]==0
                    # Same call (same request key/payload/version) succeeds after release.
                    editor=live("set application_name='fix1-sorted-wrapper-retry';set statement_timeout='8s';"+wrapper_sql)
                    rc,out,err=finish(editor); assert rc==0 and '40P01' not in err and 'PEOPLE_ACCOUNT_BUSY' not in err, (rc,out,err)
                    assert db.last(f"select full_name from profiles where id='{B}'")=='Sorted wrapper commits'
                    passed('actual People sorted account wrapper: held target fails closed PEOPLE_ACCOUNT_BUSY (40001) immediately with zero effects; actor/unrelated targets stay free; same call commits after release')
                return
            print('FIRST READER'   ,json.dumps(config('STAFF')),flush=True)
            passed('authenticated public reader returns legacy config')
            tables=json.loads(db.last("select jsonb_agg(tablename order by tablename) from pg_tables where schemaname='public' and tablename not in ('role_modules','role_capabilities','profiles') and tablename not like 'activity_log%'"))
            def business_snapshot():
                return {t:db.last("select md5(coalesce(string_agg(to_jsonb(x)::text,chr(10) order by to_jsonb(x)::text),'')) from public.\""+t+'" x') for t in tables}
            business_before=business_snapshot()
            report['business_table_hashes_before']=business_before
            initial=config('STAFF')
            payload=save('STAFF',initial['revision'],modules=['penjualan'],caps={'all_branches':True,'create_accounts':False})
            result=json.loads(call('OWNER',payload))
            assert result['role']=='STAFF' and result['already_applied'] is False
            updated=config('STAFF')
            assert updated['modules']==['penjualan'] and updated['capabilities']=={'all_branches':True,'create_accounts':False}
            assert updated['revision']==result['revision'] and len(updated['audit'])==1
            assert updated['audit'][0]['id']==result['audit_id'] and updated['audit'][0]['created_by']==IDS['OWNER'] and updated['audit'][0]['reason']=='native proof'
            assert updated['audit'][0]['before']=={k:v for k,v in initial.items() if k not in ('audit','action_catalog')}
            assert updated['audit'][0]['after']=={k:v for k,v in updated.items() if k not in ('audit','action_catalog')}
            assert call('STAFF','select public.sales_module_access()')=='t'
            passed('atomic public save modules/caps/audit and original sales_module_access integration')
            denied("delete from role_modules where role='STAFF'",match='muat ulang')
            passed('old direct config writer cannot bypass version/audit RPC')
            call('OWNER',f"select public.save_role_access_config('STAFF','{updated['revision']}','{uuid.uuid4()}','reset','[]',null,'reset original defaults')")
            assert config('STAFF')['source']=='defaults'
            passed('reset accepts actual JSON RPC null (SQL NULL)')
            assert config('STAFF')['modules']==['klinik','kasir','quest-staff']
            assert config('FINANCE')['modules']==['dashboard','pos-shift']
            assert config('DOCTOR')['modules']==['crm','kasir','quest-staff']
            assert config('ADMIN')['source']=='defaults' and len(config('ADMIN')['modules'])==17
            passed('existing legacy extras and original STAFF/FINANCE/ADMIN/DOCTOR defaults preserved')
            # Same actor/key/full payload replay; no fresh audit or writes.
            replay=json.loads(call('OWNER',payload))
            assert replay=={**result,'already_applied':True}
            assert config('STAFF')['source']=='defaults', 'replay must not reapply old state'
            key=result['request_key']
            other_owner=str(uuid.UUID(int=99))
            db.sql(f"insert into auth.users(id,email) values('{other_owner}','other-owner@fiction.invalid');update profiles set role='OWNER',is_active=true where id='{other_owner}';")
            denied(payload,who=other_owner,match='ROLE_REQUEST_KEY_REUSED')
            denied(save('STAFF',initial['revision'],key=key,modules=['crm']),match='ROLE_REQUEST_KEY_REUSED')
            denied(save('DOCTOR',config('DOCTOR')['revision'],key=key),match='ROLE_REQUEST_KEY_REUSED')
            denied(save('STAFF',initial['revision']),match='ROLE_REVISION_CONFLICT')
            passed('exact cached replay, changed payload/cross-role key reuse and stale revision denial')
            for who in ['ADMIN','FINANCE','STAFF','DOCTOR']:
                assert config('STAFF',who)['audit']==[]
                denied(save('STAFF',config('STAFF')['revision']),who=who,match='ROLE_OWNER_REQUIRED')
            denied("select public.get_role_access_config('STAFF')",who='INACTIVE',match='ROLE_AUTH_REQUIRED')
            denied(save('STAFF',config('STAFF')['revision']),who='INACTIVE',match='ROLE_OWNER_REQUIRED')
            denied("select public.get_role_access_config('STAFF')",who=IDS['OWNER'],dbrole='anon',match='permission denied')
            denied(save('STAFF',config('STAFF')['revision']),dbrole='service_role',match='permission denied')
            for scope in ['OWNER','INVALID','staff','']:
                denied(f"select public.get_role_access_config('{scope}')",match='ROLE_SCOPE_INVALID')
                denied(save(scope,'0'*32),match='ROLE_SCOPE_INVALID')
            passed('active identity read; Owner-only write; forged JWT Owner/nonOwner/inactive/anonymous/service/scope fail closed')
            for modules,caps in [(['unknown'],None),(['__role_v2__'],None),(['pos','pos'],None),([None],None),([],{'all_branches':True,'create_accounts':True,'cap_extra':True}),([],{'all_branches':1,'create_accounts':False}),([],{'all_branches':False})]:
                denied(save('STAFF',config('STAFF')['revision'],modules=modules,caps=caps),match='ROLE_INPUT_INVALID')
            denied(save('STAFF',config('STAFF')['revision'],reason='x'),match='ROLE_INPUT_INVALID')
            denied(save('STAFF',config('STAFF')['revision'],reason=' '*1001+'abc'),match='ROLE_INPUT_INVALID')
            passed('unknown/duplicate/null modules, reserved marker, cap_extra/nonboolean/missing caps and invalid reason rejected')
            defaults={
                'STAFF':['klinik','kasir','quest-staff'],
                'FINANCE':['dashboard','buku-besar','kas-bank','aset-tetap','pajak','laporan','pos-shift'],
                'ADMIN':None,'DOCTOR':None}
            for target in defaults:
                empty=json.loads(call('OWNER',save(target,config(target)['revision'])))
                c=config(target)
                assert c['source']=='custom' and c['modules']==[] and c['revision']==empty['revision']
                assert call(target,'select public.sales_module_access()')=='f'
                assert db.last(f"select count(*) from role_modules where role='{target}' and module_id='__role_v2__'")=='1'
                call('OWNER',save(target,c['revision'],modules=['penjualan','kasir','quest-staff','pos-shift'],caps={'all_branches':True,'create_accounts':True}))
                assert call(target,'select public.sales_module_access()')=='t'
                assert call(target,"select public.has_role_capability('all_branches') and public.has_role_capability('create_accounts')")=='t'
                reset=json.loads(call('OWNER',save(target,config(target)['revision'],mode='reset')))
                c=config(target)
                assert c['source']=='defaults' and c['revision']==reset['revision']
                assert c['modules']==defaults[target] if defaults[target] is not None else len(c['modules'])==17
                assert c['capabilities']=={'all_branches':target in ('ADMIN','FINANCE'),'create_accounts':target=='ADMIN'}
            passed('all four targets: explicit v2 empty denies original sales helper; grants live; reset restores exact original menu/capability defaults')
            # Raw capability-row presence changes revision even with equal defaults.
            prior=config('FINANCE')
            db.sql("insert into role_capabilities(role,all_branches,create_accounts) values('FINANCE',true,false)")
            present=config('FINANCE')
            assert prior['capabilities']==present['capabilities'] and prior['modules']==present['modules'] and prior['revision']!=present['revision']
            db.sql("delete from role_capabilities where role='FINANCE'")
            assert config('FINANCE')['revision']==prior['revision']
            # Revision covers actual source rows, not a fabricated effective hash.
            raw_digest=db.last("select md5(jsonb_build_object('modules',(select coalesce(jsonb_agg(to_jsonb(m) order by m.module_id),'[]') from role_modules m where role='STAFF'),'capability',(select to_jsonb(c) from role_capabilities c where role='STAFF'),'actions',(select to_jsonb(a) from role_settings_private.action_policies a where role='STAFF'),'epoch',(select epoch from role_settings_private.epochs where role='STAFF'))::text)")
            assert raw_digest==config('STAFF')['revision']
            passed('revision includes actual source rows and absent-vs-present default capability row; explicit no-JWT DBA maintenance works')
            # DML/RLS/private schema cannot be bypassed using JWT/GUC flags.
            call('OWNER',save('STAFF',config('STAFF')['revision'],modules=['pos']))
            for table in ['role_modules','role_capabilities']:
                denied(f"set local kamo.role_settings_permit='true'; delete from {table}",match='muat ulang') if table=='role_modules' else None
                denied(f"truncate {table}",match='muat ulang')
            denied("insert into role_modules(role,module_id) values('STAFF','crm')",match='muat ulang')
            denied("insert into role_modules(role,module_id) values('STAFF','crm')",dbrole='service_role',match='muat ulang')
            denied("insert into role_capabilities(role,all_branches,create_accounts) values('STAFF',true,true)",match='muat ulang')
            for who in ['OWNER','ADMIN']:
                for sql in ["select * from role_settings_private.audit","delete from role_settings_private.audit","truncate role_settings_private.audit","insert into role_settings_private.permits values(txid_current(),auth.uid(),'STAFF')","update role_settings_private.requests set payload='{}'"]:
                    denied(sql,who=who,match='permission denied')
            for op in ['delete from','update']:
                try: db.sql(op+" role_settings_private.audit"+(" set reason='tamper'" if op=='update' else ''))
                except RuntimeError as e: assert 'ROLE_AUDIT_IMMUTABLE' in str(e)
                else: raise AssertionError('DBA audit mutation allowed')
            try: db.sql('truncate role_settings_private.audit')
            except RuntimeError as e: assert 'ROLE_AUDIT_IMMUTABLE' in str(e)
            else: raise AssertionError('audit truncate allowed')
            assert db.last('select count(*) from role_settings_private.permits')=='0'
            passed('unforgeable private permit; config truncate/direct DML denied; private replay/audit denied; immutable audit including DBA truncate')
            # Caller rollback unwinds configuration, audit, request cache, and activity.
            before_rollback=config('STAFF')
            key_rollback=str(uuid.uuid4())
            db.sql(actor('OWNER',save('STAFF',before_rollback['revision'],key=key_rollback,modules=['pos'])).replace('commit;','rollback;'))
            assert config('STAFF')==before_rollback
            assert db.last(f"select count(*) from role_settings_private.requests where request_key='{key_rollback}'")=='0'
            passed('transaction rollback preserves configuration/audit/replay')
            # Independent sessions, actual blocker PID and lock event before release.
            revision=config('STAFF')['revision']
            winner=live(actor('OWNER',save('STAFF',revision,modules=['pos'])).replace('commit;', 'select pg_backend_pid();'))
            winning_result=json.loads(winner.stdout.readline())
            winner_pid=int(winner.stdout.readline())
            loser=live("set application_name='role-revision-loser';"+actor('OWNER',save('STAFF',revision,modules=['crm'])))
            wait_block('role-revision-loser',winner_pid)
            assert finish(winner,'commit;')[0]==0
            rc,out,err=finish(loser)
            assert rc!=0 and 'ROLE_REVISION_CONFLICT' in err
            assert config('STAFF')['revision']==winning_result['revision'] and config('STAFF')['modules']==['pos']
            passed('two independent same-version sessions: observed exact blocker; exactly one commit wins')
            # Owner revoked in committed independent transaction while genuinely blocked.
            owner=IDS['OWNER']
            replay_payload=save('STAFF',config('STAFF')['revision'],key=str(uuid.uuid4()),modules=['penjualan'])
            replay_result=json.loads(call('OWNER',replay_payload))
            for kind in ['target-advisory','target-table','request-advisory-replay']:
                if kind=='target-advisory': block_sql='select pg_advisory_xact_lock(724061,3);'
                elif kind=='target-table': block_sql='lock table public.role_modules in row exclusive mode;'
                else: block_sql=f"select pg_advisory_xact_lock(hashtextextended('role-settings-request:{replay_result['request_key']}',0));"
                holder=live('begin;'+block_sql+'select pg_backend_pid();')
                line=holder.stdout.readline().strip()
                while not line: line=holder.stdout.readline().strip()
                holder_pid=int(line)
                current=config('STAFF')
                pending=replay_payload if kind=='request-advisory-replay' else save('STAFF',current['revision'],modules=['crm'])
                waiter=live("set application_name='role-"+kind+"';"+actor('OWNER',pending))
                wait_block('role-'+kind,holder_pid)
                db.sql(f"update profiles set is_active=false where id='{owner}'")
                assert db.last(f"select is_active from profiles where id='{owner}'")=='f'
                assert finish(holder,'commit;')[0]==0
                rc,out,err=finish(waiter)
                assert rc!=0 and 'ROLE_OWNER_REQUIRED' in err,err
                db.sql(f"update profiles set is_active=true where id='{owner}'")
                assert config('STAFF')==current
                passed(kind+' committed revocation observed before release; no config/audit/replay mutation')
            # Current decision remains fenced through caller commit.
            c=config('STAFF')
            holder=live(actor('OWNER',save('STAFF',c['revision'],modules=['pos'])).replace('commit;','select pg_backend_pid();'))
            json.loads(holder.stdout.readline()); holder_pid=int(holder.stdout.readline())
            revoker=live("set application_name='role-post-fence-revoker';begin;update profiles set is_active=false where id='"+owner+"';commit;")
            wait_block('role-post-fence-revoker',holder_pid)
            assert finish(holder,'commit;')[0]==0
            assert finish(revoker)[0]==0
            denied(replay_payload,match='ROLE_OWNER_REQUIRED')
            db.sql(f"update profiles set is_active=true where id='{owner}'")
            passed('Owner authorization table fence protects final effects; replay after committed revocation denied')
            # Owner audit is bounded; malformed/isolation calls fail without writes.
            for i in range(51):
                call('OWNER',save('FINANCE',config('FINANCE')['revision'],reason='bounded audit '+str(i)))
            assert len(config('FINANCE')['audit'])==50
            assert config('FINANCE','FINANCE')['audit']==[]
            try: db.sql(actor('OWNER',save('STAFF',config('STAFF')['revision'])).replace('begin;','begin isolation level repeatable read;'))
            except RuntimeError as e: assert 'ROLE_RETRY_READ_COMMITTED' in str(e)
            else: raise AssertionError('stale-snapshot isolation accepted')
            passed('latest 50 audit entries Owner-only; non-READ-COMMITTED writes fail closed')
            assert business_before==business_snapshot(), 'Unrelated business state changed'
            report['business_table_count']=len(tables)
            passed('all unrelated public business-table contents unchanged (stock/money/shifts/clinical included)')
            assert all(json.loads(db.last(funcs))[k]==v for k,v in before.items())
            assert db.last(policies)==policies_before
            passed('final original function/ACL/owner/security/search_path and policy invariants')
            # Exercise original account and cashier financial/shift regressions.
            # The account test has one privileged fixture mutation after RESET ROLE
            # but retains a JWT. Explicitly clear JWT for that fixture-only write;
            # original business RPCs and assertions remain byte-identical.
            source=(ROOT/'supabase/tests/user_account_edit.sql').read_text()
            fixture_line="update role_capabilities set create_accounts=false where role='ADMIN';"
            assert source.count(fixture_line)==1
            source=source.replace(fixture_line,
                "select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true),set_config('request.jwt.claims','{}',true);"+
                fixture_line+"select set_config('request.jwt.claim.role','authenticated',true);")
            db.sql(source)
            passed('original user_account_edit.sql regression; only privileged config fixture JWT cleared')
            for name in ['pos_split_payments.sql','cashier_atomic_fifo_floor.sql']:
                db.sql((ROOT/'supabase/tests'/name).read_text())
                passed('original unchanged regression '+name)
            report['gaps']=['Foundation only; all116 planned actions disabled until domain activation proof; no hosted install/browser/release approval.',
                'Core save retains table-wide config serialization and profiles SHARE NOWAIT authorization fence; action authorization uses only current actor FOR SHARE NOWAIT after epochs.',
                'Unrelated business snapshot mostly consists of pristine migration seed/empty tables; original cashier/account regression fixtures exercise populated paths separately.']
    except BaseException as e:
        report['error'] = str(e)
        print('FAIL',str(e),flush=True)
        raise
    finally:
        suffix = ('action-slice-'+str(args.action_slice)) if args.action_slice else ('red' if args.baseline else 'green')
        assert report['harness_sha256']==hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'Harness changed during native run'
        report['status']='failed' if 'error' in report else ('passed_native_foundation_actions' if args.action_slice else 'passed_native_core_regressions')
        report['log_sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(EVIDENCE.glob('backend-*.log'))}
        report['check_count']=len(report['checks'])
        (EVIDENCE/f'backend-report-{suffix}.json').write_text(json.dumps(report,indent=2))
        (EVIDENCE/'backend-report.json').write_text(json.dumps(report,indent=2))
        (EVIDENCE/('action-foundation-native-'+report['run_id']+'.json')).write_text(json.dumps(report,indent=2))

if __name__ == '__main__':
    main()
