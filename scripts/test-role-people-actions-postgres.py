#!/usr/bin/env python3
"""Original-schema PG17 people ingress proof; fictional local Auth rows only."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres
BASE = '0d5e2434325157faff90c37ff7959a9798072ef9'
INPUT_EVIDENCE = Path('/opt/data/kamo-role-settings-evidence')  # read-only historical inputs
EVIDENCE = INPUT_EVIDENCE / 'recompose2'  # all new output
EVIDENCE.mkdir(parents=True, exist_ok=True)
CANDIDATES = ['20261106120000_role_settings_atomic.sql', '20261106140000_role_hris_user_actions.sql']
spec = importlib.util.spec_from_file_location('fullschema', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
assert spec is not None and spec.loader is not None
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', action='store_true')
    parser.add_argument('--fix-case', choices=['truncate','active','locks','reciprocal'])
    parser.add_argument('--slice', choices=['direct', 'alternate'], default='alternate')
    args = parser.parse_args()
    report = {'baseline': args.baseline, 'checks': [], 'enabledkeys': []}
    def passed(name):
        report['checks'].append(name)
        print('PASS', name, flush=True)
    # Isolated disposable cluster: never queue behind another worker's flock.
    from contextlib import nullcontext
    with nullcontext():
        with tempfile.TemporaryDirectory(prefix='people-proof-', dir='/opt/data') as tmp:
            migrations = Path(tmp) / 'supabase/migrations'
            migrations.mkdir(parents=True)
            tree = subprocess.run(['git', 'ls-tree', '-r', BASE, '--', 'supabase/migrations'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
            originals = [line.split('\t')[1] for line in tree.splitlines() if line.endswith('.sql')]
            assert len(originals) == 365
            report['original_hashes'] = {}
            for path in originals:
                original = subprocess.run(['git', 'show', BASE + ':' + path], cwd=ROOT, capture_output=True, check=True).stdout
                assert (ROOT / path).read_bytes() == original, path
                report['original_hashes'][Path(path).name] = hashlib.sha256(original).hexdigest()
                (migrations / Path(path).name).write_bytes(original)
            snapshots = {name: (ROOT / 'supabase/migrations' / name).read_bytes() for name in CANDIDATES}
            assert hashlib.sha256(snapshots[CANDIDATES[0]]).hexdigest() == '9ffdac979c4c033ee89adfff82639e8ad8ee5f3ee176fcc69c2f14bcbaef0ea9'
            employee_snapshot = (ROOT / 'supabase/migrations/20261106150000_role_employee_actions.sql').read_bytes()
            report['candidate_sha256'] = {name: hashlib.sha256(data).hexdigest() for name, data in snapshots.items()}
            fixture.ROOT = Path(tmp)
            with NativePostgres('/opt/data/kamo-pg-harness/bin') as db:
                fixture.DisposablePostgres.bootstrap(db)
                report['server_version'] = db.last('show server_version')
                assert 170000 <= int(db.last('show server_version_num')) < 180000
                db.sql(snapshots[CANDIDATES[0]].decode())
                original_functions_sql = "select jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'"
                original_functions = json.loads(db.last(original_functions_sql))
                if not args.baseline:
                    db.sql(snapshots[CANDIDATES[1]].decode())
                    db.sql(employee_snapshot.decode())
                passed('365 exact base originals + snapshotted foundation + PG17')
                ids = {name: str(uuid.UUID(int=2000 + i)) for i, name in enumerate(['OWNER', 'ADMIN', 'STAFF', 'BRANCH_A', 'BRANCH_B'])}
                for role in ['OWNER', 'ADMIN', 'STAFF']:
                    db.sql(f"insert into auth.users(id,email) values('{ids[role]}','people-{role.lower()}@fiction.invalid');update profiles set role='{role}',full_name='People {role}',is_active=true where id='{ids[role]}';")
                db.sql(f"insert into branches(id,code,name,type,is_active) values('{ids['BRANCH_A']}','PPA','People A','BOTH',true),('{ids['BRANCH_B']}','PPB','People B','BOTH',true);insert into user_branches(user_id,branch_id,role) values('{ids['STAFF']}','{ids['BRANCH_A']}','PRIMARY');")
                def call(role, sql):
                    return db.sql(f"begin;set local role authenticated;set local request.jwt.claim.sub='{ids[role]}';set local request.jwt.claim.role='authenticated';{sql};commit;")
                def denied(role, sql, match):
                    state_sql = "select md5(jsonb_build_object('profiles',(select jsonb_agg(to_jsonb(t) order by id) from profiles t),'grants',(select jsonb_agg(to_jsonb(t) order by user_id,branch_id) from user_branches t),'employees',(select jsonb_agg(to_jsonb(t) order by id) from employees t),'edits',(select jsonb_agg(to_jsonb(t) order by id) from user_account_edits t),'activity',(select jsonb_agg(to_jsonb(t) order by id) from activity_log t))::text)"
                    before = db.last(state_sql)
                    audit_before = db.last("select jsonb_build_array((select count(*) from user_account_edits),(select count(*) from activity_log),(select count(*) from user_branches))")
                    try:
                        call(role, sql)
                    except RuntimeError as error:
                        assert match in str(error), str(error)
                        assert db.last(state_sql) == before, 'Denied request changed account, grants, employee link or audit'
                        report['zero_effect_denials'] = report.get('zero_effect_denials', 0) + 1
                        return
                    print('UNEXPECTED_ALLOWED', json.dumps({'sql':sql,'before':before,'after':db.last(state_sql),'audit_grants_before':audit_before,'audit_grants_after':db.last("select jsonb_build_array((select count(*) from user_account_edits),(select count(*) from activity_log),(select count(*) from user_branches))")}), flush=True)
                    raise AssertionError('Expected denial: ' + sql)
                def policy(actions, all_branches=True, create_accounts=True):
                    revision = db.last("select role_settings_private.snapshot('ADMIN')->>'revision'")
                    return call('OWNER', f"select save_role_access_config('ADMIN','{revision}','{uuid.uuid4()}','custom','[\"pengaturan\",\"perusahaan\",\"hris\"]','{{\"all_branches\":{str(all_branches).lower()},\"create_accounts\":{str(create_accounts).lower()}}}','people proof','{json.dumps(actions)}')")
                def edit_sql(name='Policy denied', request=None):
                    snapshot = json.loads(call('OWNER', f"select get_user_account_for_edit('{ids['STAFF']}')"))
                    return f"select edit_user_account('{ids['STAFF']}','{name}','STAFF',array['{ids['BRANCH_A']}']::uuid[],'{snapshot['version']}','{request or uuid.uuid4()}')"
                if args.fix_case in ('truncate', None):
                    assert int(db.last('select count(*) from user_branches')) > 0
                    denied('STAFF', 'truncate public.user_branches', 'permission denied')
                    for table in ['profiles','employees']:
                        denied('STAFF', f'truncate public.{table} cascade', 'permission denied')
                    for role in ['anon','authenticated']:
                        for table in ['profiles','employees','user_branches']:
                            assert db.last(f"select has_table_privilege('{role}','public.{table}','TRUNCATE')") == 'f'
                    passed('PEOPLE-TRUNCATE-01 nonempty grants, profiles/employees CASCADE denied; complete state/audit unchanged')
                    if args.fix_case == 'truncate': return
                if args.fix_case in ('active', None):
                    fresh = str(uuid.uuid4()); employee = str(uuid.uuid4())
                    db.sql(f"insert into auth.users(id,email) values('{fresh}','inactive@fiction.invalid'); insert into employees(id,nama,status,branch_id) values('{employee}','Inactive fixture','Aktif','{ids['BRANCH_A']}')")
                    call('OWNER', f"select set_user_account_active('{fresh}',false)")
                    policy(['people.buatPengguna','people.tautkanPengguna','people.account_branch_direct_assign'])
                    denied('ADMIN', f"select configure_employee_account('{fresh}','{employee}','Must not activate','STAFF',array['{ids['BRANCH_A']}']::uuid[])", 'ROLE_ACTION_DENIED')
                    assert db.last(f"select is_active from profiles where id='{fresh}'") == 'f'
                    policy(['people.buatPengguna','people.tautkanPengguna','people.account_branch_direct_assign','people.togglePengguna'])
                    call('ADMIN', f"select configure_employee_account('{fresh}','{employee}','Authorized activation','STAFF',array['{ids['BRANCH_A']}']::uuid[])")
                    assert db.last(f"select is_active from profiles where id='{fresh}'") == 't'
                    assert db.last(f"select profile_id from employees where id='{employee}'") == fresh
                    passed('PEOPLE-ACTIVE-02 inactive STAFF configure requires toggle; zero complete profile/grant/employee/audit effects')
                    if args.fix_case == 'active': return
                policy([])
                denied('ADMIN', edit_sql(), 'ROLE_ACTION_DENIED')
                assert db.last(f"select full_name from profiles where id='{ids['STAFF']}'") == 'People STAFF'
                assert db.last('select count(*) from user_account_edits') == '0'
                passed('custom deny blocks real account editor before any name/grant/audit effect')
                policy(['people.simpanEditPengguna','people.account_branch_direct_assign'])
                # First tracer: the old permissive direct writer bypasses the bounded edit RPC.
                denied('ADMIN', f"insert into user_branches(user_id,branch_id,role) values('{ids['OWNER']}','{ids['BRANCH_B']}','PRIMARY')", 'row-level security')
                passed('direct authenticated ADMIN cannot grant OWNER branch behind bounded RPC')
                denied('OWNER', f"delete from user_branches where user_id='{ids['STAFF']}'", 'PEOPLE_ACCOUNT_RPC_REQUIRED')
                passed('direct authenticated OWNER delete cannot bypass bounded RPC/audit')
                if args.slice == 'direct':
                    return
                def assign(role, target, branch, remove=False):
                    return call(role, f"select public.set_user_branch_assignment('{ids[target]}','{ids[branch]}','SECONDARY',{str(remove).lower()})")
                assign('ADMIN', 'STAFF', 'BRANCH_B')
                assert db.last(f"select count(*) from user_branches where user_id='{ids['STAFF']}'") == '2'
                assert db.last(f"select count(*) from user_account_edits where profile_id='{ids['STAFF']}'") == '1'
                assign('ADMIN', 'STAFF', 'BRANCH_B', True)
                assert db.last(f"select count(*) from user_branches where user_id='{ids['STAFF']}'") == '1'
                assert db.last(f"select count(*) from user_account_edits where profile_id='{ids['STAFF']}'") == '2'
                passed('actual authenticated alternate assign/unassign compose original atomic account edit and audit')
                call('ADMIN', f"select public.set_user_branch_assignment('{ids['STAFF']}','{ids['BRANCH_B']}','PRIMARY',false)")
                assert db.last(f"select role from user_branches where user_id='{ids['STAFF']}' and branch_id='{ids['BRANCH_B']}'") == 'PRIMARY'
                passed('alternate PRIMARY branch metadata is preserved')
                assign('ADMIN', 'STAFF', 'BRANCH_B', True)
                denied('ADMIN', f"select public.set_user_branch_assignment('{ids['OWNER']}','{ids['BRANCH_B']}','PRIMARY',false)", 'ACCOUNT_EDIT_DENIED')
                denied('ADMIN', f"select public.set_user_branch_assignment('{ids['STAFF']}','{ids['BRANCH_A']}','PRIMARY',true)", 'memerlukan penugasan cabang')
                denied('STAFF', f"select public.set_user_branch_assignment('{ids['STAFF']}','{ids['BRANCH_B']}','PRIMARY',false)", 'ACCOUNT_EDIT_DENIED')
                passed('target-role, minimum STAFF branch, nonmanager denials retain original ceilings')
                policy(['people.simpanEditPengguna','people.account_branch_direct_assign'], all_branches=False)
                denied('ADMIN', f"select public.set_user_branch_assignment('{ids['STAFF']}','{ids['BRANCH_B']}','PRIMARY',false)", 'ACCOUNT_EDIT_DENIED')
                passed('bounded ADMIN cannot mutate out-of-scope target branches')
                # Existing authenticated account editor remains usable despite direct-DML closure.
                snapshot = json.loads(call('OWNER', f"select get_user_account_for_edit('{ids['STAFF']}')"))
                call('OWNER', f"select edit_user_account('{ids['STAFF']}','Staff renamed','STAFF',array['{ids['BRANCH_A']}']::uuid[],'{snapshot['version']}','{uuid.uuid4()}')")
                assert db.last(f"select full_name from profiles where id='{ids['STAFF']}'") == 'Staff renamed'
                passed('original real edit_user_account definer still writes through unchanged business implementation')
                denied('OWNER', f"update profiles set full_name='Bypassed name' where id='{ids['STAFF']}'", 'PEOPLE_ACCOUNT_RPC_REQUIRED')
                denied('OWNER', f"update profiles set is_active=false where id='{ids['STAFF']}'", 'PEOPLE_ACCOUNT_RPC_REQUIRED')
                denied('OWNER', f"update profiles set role='OWNER' where id='{ids['STAFF']}'", 'PEOPLE_ACCOUNT_RPC_REQUIRED')
                call('STAFF', f"update profiles set full_name='Personal name' where id='{ids['STAFF']}'")
                assert db.last(f"select full_name from profiles where id='{ids['STAFF']}'") == 'Personal name'
                passed('direct privilege/active/other-name writes closed; personal self-name remains usable')
                fresh = str(uuid.uuid4()); employee = str(uuid.uuid4())
                db.sql(f"insert into auth.users(id,email) values('{fresh}','people-new@fiction.invalid'); insert into employees(id,nama,status,branch_id) values('{employee}','Fixture employee','Aktif','{ids['BRANCH_A']}')")
                configure = f"select configure_employee_account('{fresh}','{employee}','Configured','STAFF',array['{ids['BRANCH_A']}']::uuid[])"
                policy([])
                denied('ADMIN', configure, 'ROLE_ACTION_DENIED')
                assert db.last(f"select profile_id is null from employees where id='{employee}'") == 't'
                passed('custom deny prevents original configure account and HRIS link effects')
                denied('ADMIN', f"select set_user_account_active('{ids['STAFF']}',false)", 'ROLE_ACTION_DENIED')
                all_keys = ['people.simpanEditPengguna','people.account_branch_direct_assign','people.togglePengguna','people.tautkanPengguna','people.buatPengguna']
                for missing in all_keys:
                    policy([key for key in all_keys if key != missing])
                    if missing in ['people.buatPengguna','people.tautkanPengguna','people.account_branch_direct_assign']:
                        denied('ADMIN', configure, 'ROLE_ACTION_DENIED')
                policy(all_keys)
                db.sql(f"update profiles set role='OWNER' where id='{fresh}'")
                denied('ADMIN', configure, 'ACCOUNT_NOT_UNCONFIGURED')
                db.sql(f"update profiles set role='STAFF' where id='{fresh}'")
                call('ADMIN', configure)
                assert db.last(f"select profile_id from employees where id='{employee}'") == fresh
                assert db.last(f"select full_name from profiles where id='{fresh}'") == 'Configured'
                passed('real configure allowed composite and each dependent create/link/branch denial has zero effects')
                call('ADMIN', f"select set_user_account_active('{ids['STAFF']}',false)")
                assert db.last(f"select is_active from profiles where id='{ids['STAFF']}'") == 'f'
                call('ADMIN', f"select set_user_account_active('{ids['STAFF']}',true)")
                denied('ADMIN', f"select set_user_account_active('{ids['OWNER']}',false)", 'ACCOUNT_EDIT_DENIED')
                denied('OWNER', f"select set_user_account_active('{ids['OWNER']}',false)", 'ACCOUNT_EDIT_DENIED')
                passed('bounded activation allowed and original target/self ceilings retained')
                employee2 = str(uuid.uuid4())
                db.sql(f"insert into employees(id,nama,status) values('{employee2}','Link fixture','Aktif')")
                link = f"select link_employee_account('{ids['STAFF']}','{employee2}')"
                policy([]); denied('ADMIN', link, 'ROLE_ACTION_DENIED')
                denied('ADMIN', f"update employees set profile_id='{ids['STAFF']}' where id='{employee2}'", 'PEOPLE_ACCOUNT_RPC_REQUIRED')
                policy(all_keys); call('ADMIN', link)
                assert db.last(f"select profile_id from employees where id='{employee2}'") == ids['STAFF']
                passed('actual link RPC positive/custom deny and direct HRIS link bypass closure')
                replay = edit_sql('Replay proof')
                call('ADMIN', replay); call('ADMIN', replay)
                policy([]); denied('ADMIN', replay, 'ROLE_ACTION_DENIED')
                assert db.last(f"select full_name from profiles where id='{ids['STAFF']}'") == 'Replay proof'
                passed('cached successful account request replay denied after committed policy revocation')
                policy(all_keys)
                db.sql(f"update profiles set is_active=false where id='{ids['ADMIN']}'")
                denied('ADMIN', replay, 'ROLE_ACTION_DENIED')
                db.sql(f"update profiles set is_active=true,role='STAFF' where id='{ids['ADMIN']}'")
                denied('ADMIN', replay, 'ACCOUNT_EDIT_DENIED')
                db.sql(f"update profiles set role='ADMIN' where id='{ids['ADMIN']}'")
                passed('current active identity and current role replace cached actor authority')
                # Both epoch-lock directions: real public actions, observed blockers.
                import os, time
                def session(sql):
                    proc = subprocess.Popen(db.as_user + [db.psql,'-X','-qAt','-h',str(db.root),'-U','postgres','-v','ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
                    os.write(proc.stdin.fileno(), b'select pg_backend_pid();\n')
                    pid = int(proc.stdout.readline())
                    os.write(proc.stdin.fileno(), sql.encode() + b'\n\\echo READY\n')
                    return proc, pid
                def ready(proc):
                    while True:
                        line = proc.stdout.readline()
                        assert line, proc.stderr.read().decode()
                        if line.strip() == b'READY': return
                def auth_sql(role):
                    return f"begin;set local role authenticated;set local request.jwt.claim.sub='{ids[role]}';set local request.jwt.claim.role='authenticated';"
                def revoke_sql():
                    revision = db.last("select role_settings_private.snapshot('ADMIN')->>'revision'")
                    return f"select save_role_access_config('ADMIN','{revision}','{uuid.uuid4()}','custom','[\"pengaturan\",\"perusahaan\",\"hris\"]','{{\"all_branches\":true,\"create_accounts\":true}}','concurrent revoke','[]');"
                def blocked(waiter, holder):
                    deadline = time.monotonic()+8
                    while time.monotonic()<deadline:
                        pids = json.loads(db.last(f"select to_json(pg_blocking_pids({waiter}))"))
                        if holder in pids:
                            report.setdefault('blocked_pid_evidence',[]).append({'waiter':waiter,'blocker':holder,'pg_blocking_pids':pids})
                            return
                    raise AssertionError('no observed blocking PID')
                if args.fix_case in ('locks', None):
                    outcomes = []
                    for kind in ['link','configure','linked_branch','linked_edit','linked_active']:
                        target = str(uuid.uuid4()); emp = str(uuid.uuid4())
                        db.sql(f"insert into auth.users(id,email) values('{target}','{target}@fiction.invalid'); insert into employees(id,nama,status,branch_id,profile_id) values('{emp}','Cycle {kind}','Aktif','{ids['BRANCH_A']}'," + (f"'{target}'" if kind.startswith('linked') else 'null') + ');')
                        db.sql(f"update profiles set full_name='Cycle target' where id='{target}'")
                        if kind.startswith('linked'):
                            db.sql(f"insert into user_branches(user_id,branch_id,role) values('{target}','{ids['BRANCH_A']}','PRIMARY')")
                        if kind == 'link': op = f"select link_employee_account('{target}','{emp}');"
                        elif kind == 'configure': op = f"select configure_employee_account('{target}','{emp}','Cycle configured','STAFF',array['{ids['BRANCH_A']}']::uuid[]);"
                        elif kind == 'linked_branch': op = f"select set_user_branch_assignment('{target}','{ids['BRANCH_B']}','SECONDARY',false);"
                        elif kind == 'linked_active': op = f"select set_user_account_active('{target}',false);"
                        else:
                            snap = json.loads(call('OWNER',f"select get_user_account_for_edit('{target}')"))
                            op = f"select edit_user_account('{target}','Cycle edited','STAFF',array['{ids['BRANCH_A']}']::uuid[],'{snap['version']}','{uuid.uuid4()}');"
                        lifecycle, lpid = session("set deadlock_timeout='150ms';" + auth_sql('OWNER') + f"set local statement_timeout='6s';select id from employees where id='{emp}' for update;")
                        ready(lifecycle)
                        action, apid = session("set deadlock_timeout='150ms';" + auth_sql('OWNER') + "set local statement_timeout='6s';" + op)
                        # Every linked writer must wait before acquiring actor/target
                        # profiles; original lifecycle can therefore finish first.
                        if kind in ['link','configure']:
                            blocked(apid,lpid)
                            # New protocol: actor Profile is SHARE-locked first, target Profile untouched.
                            db.sql(f"begin;select id from profiles where id='{target}' for update nowait;rollback;")
                            try:
                                db.sql(f"begin;select id from profiles where id='{ids['OWNER']}' for update nowait;rollback;")
                                raise AssertionError('actor Profile SHARE prelock missing')
                            except RuntimeError as error:
                                assert 'could not obtain lock' in str(error), str(error)
                        else:
                            deadline=time.monotonic()+2
                            while time.monotonic()<deadline:
                                if lpid in json.loads(db.last(f'select to_json(pg_blocking_pids({apid}))')): break
                                if db.last(f"select coalesce((select state from pg_stat_activity where pid={apid}),'exited')") == 'idle in transaction': break
                            if lpid in json.loads(db.last(f'select to_json(pg_blocking_pids({apid}))')):
                                blocked(apid,lpid)
                            elif action.poll() is None:
                                try: os.write(action.stdin.fileno(),b'commit;\n\\q\n')
                                except BrokenPipeError: pass
                        os.write(lifecycle.stdin.fileno(), f"select change_master_data_lifecycle('employees','{emp}','archive',0,'Native cycle proof');commit;\n\\q\n".encode())
                        lifecycle.stdin.close(); lifecycle.stdin=None
                        lo, le = lifecycle.communicate(timeout=9)
                        if action.poll() is None:
                            try: os.write(action.stdin.fileno(),b'commit;\n\\q\n')
                            except BrokenPipeError: pass
                        action.stdin.close(); action.stdin=None
                        ao, ae = action.communicate(timeout=9)
                        outcome={'kind':kind,'lifecycle_pid':lpid,'action_pid':apid,'lifecycle_exit':lifecycle.returncode,'action_exit':action.returncode,'lifecycle_stdout':lo.decode(),'lifecycle_error':le.decode(),'action_stdout':ao.decode(),'action_error':ae.decode()}
                        print('CYCLE_RESULT',json.dumps(outcome),flush=True)
                        outcomes.append(outcome)
                        (EVIDENCE/'people-fix2-lock-observations.json').write_text(json.dumps({'outcomes':outcomes,'blocked_pid_evidence':report.get('blocked_pid_evidence',[])},indent=2)+'\n')
                    assert len(report.get('blocked_pid_evidence',[])) == 5, 'Every original-account writer must wait on Employee before Profile'
                    for outcome in outcomes:
                        assert outcome['lifecycle_stdout'].strip(), outcome
                    report['lifecycle_cycles']=outcomes
                    (EVIDENCE/'people-fix2-lock-observations.json').write_text(json.dumps(report,indent=2)+'\n')
                    assert all(o['lifecycle_exit']==0 and 'deadlock' not in (o['lifecycle_error']+o['action_error']).lower() for o in outcomes), outcomes
                    assert all(o['action_exit']==0 or 'EMPLOYEE_NOT_AVAILABLE' in o['action_error'] for o in outcomes)
                    passed('PEOPLE-LOCK-03 original lifecycle progresses; link/configure state refusal; linked branch/edit/active progress without deadlock')
                    if args.fix_case == 'locks': return
                if args.fix_case in ('reciprocal', None):
                    # PEOPLE-LOCK-03 residual: every pair below interleaves a REAL original
                    # writer (set_employee_primary_branches / change_master_data_lifecycle)
                    # against the REAL link/configure writer, with observed pg_blocking_pids.
                    def bl(pid): return json.loads(db.last(f"select to_json(pg_blocking_pids({pid}))"))
                    def observe(waiter, holder, secs=8):
                        deadline = time.monotonic() + secs
                        while time.monotonic() < deadline:
                            pids = bl(waiter)
                            if holder in pids: return pids
                            time.sleep(0.05)
                        return None
                    def finish(proc):
                        try: os.write(proc.stdin.fileno(), b'commit;\n\\q\n')
                        except (BrokenPipeError, OSError, ValueError): pass
                        try: proc.stdin.close()
                        except (BrokenPipeError, OSError, ValueError): pass
                        proc.stdin = None
                        out, err = proc.communicate(timeout=25)
                        return {'exit': proc.returncode, 'out': out.decode().replace('READY', '').strip()[:200], 'err': err.decode()[:500]}
                    def release(proc, verb):
                        os.write(proc.stdin.fileno(), (verb + ';\n\\q\n').encode()); proc.communicate(timeout=8)
                    def sess(role, op):
                        return session("set deadlock_timeout='200ms';" + auth_sql(role) + "set local statement_timeout='12s';" + op)
                    def mkfix(tag, target=None):
                        tgt = target or str(uuid.uuid4()); emp = str(uuid.uuid4())
                        if target is None: db.sql(f"insert into auth.users(id,email) values('{tgt}','{tgt}@fiction.invalid')")
                        db.sql(f"insert into employees(id,nama,status,branch_id) values('{emp}','Recip {tag}','Aktif','{ids['BRANCH_A']}')")
                        return tgt, emp
                    def op_of(kind, tgt, emp):
                        if kind == 'spb': return f"select set_employee_primary_branches(array['{emp}']::uuid[],'{ids['BRANCH_B']}','recip');"
                        if kind == 'link': return f"select link_employee_account('{tgt}','{emp}');"
                        if kind == 'configure': return f"select configure_employee_account('{tgt}','{emp}','Recip configured','STAFF',array['{ids['BRANCH_A']}']::uuid[]);"
                        return f"select change_master_data_lifecycle('employees','{emp}','archive',0,'Native reciprocal proof');"
                    def state_of(tgt, emp):
                        return db.last(f"select jsonb_build_array((select profile_id from employees where id='{emp}'),(select branch_id from employees where id='{emp}'),(select status from employees where id='{emp}'),(select role::text||'/'||is_active||'/'||full_name from profiles where id='{tgt}'),(select count(*) from user_branches where user_id='{tgt}'))::text")
                    recip = []
                    def run(label, ordering, a_kind, b_kind, a_role='OWNER', b_role='OWNER', a_mode='same', self_target=False, ok_a=None, ok_b=None):
                        tgt, emp = mkfix(label, ids['OWNER'] if self_target else None)
                        if a_mode == 'same': atgt, aemp = tgt, emp
                        elif a_mode == 'other_target': atgt, aemp = mkfix(label + '-a')[0], emp
                        else: atgt, aemp = mkfix(label + '-a')
                        a_op, b_op = op_of(a_kind, atgt, aemp), op_of(b_kind, tgt, emp)
                        r = {'label': label, 'ordering': ordering, 'a': a_kind, 'b': b_kind, 'a_role': a_role, 'b_role': b_role, 'self_target': self_target, 'a_mode': a_mode, 'state_before': state_of(tgt, emp)}
                        required = []
                        if ordering == 'branch':
                            x, xp = session(f"begin;select id from branches where id='{ids['BRANCH_B']}' for update;"); ready(x)
                            a, ap = sess(a_role, a_op); r.update(x_pid=xp, a_pid=ap)
                            r['A_blocking_pids_on_X'] = observe(ap, xp); required.append('A_blocking_pids_on_X')
                            b, bp = sess(b_role, b_op); r['b_pid'] = bp
                            time.sleep(1.0)
                            r['B_blocking_pids_while_A_holds_actor_share'] = bl(bp)
                            release(x, 'rollback')
                            time.sleep(0.6)
                            r['A_blocking_pids_after_X_release'] = bl(ap)
                            rb = finish(b); ra = finish(a)
                        elif ordering == 'u09':
                            x, xp = session("begin;select pg_advisory_xact_lock(hashtextextended('u09-user-account-edit',0));"); ready(x)
                            b, bp = sess(b_role, b_op); r.update(x_pid=xp, b_pid=bp)
                            r['B_blocking_pids_on_U09_holder'] = observe(bp, xp); required.append('B_blocking_pids_on_U09_holder')
                            a, ap = sess(a_role, a_op); r['a_pid'] = ap
                            r['A_blocking_pids'] = observe(ap, xp if a_mode == 'distinct' else bp); required.append('A_blocking_pids')
                            release(x, 'commit')
                            time.sleep(0.6)
                            rb = finish(b); ra = finish(a)
                        else:  # actor_excl: original lifecycle holds Employee, waits on actor SHARE behind X
                            x, xp = session(f"begin;select id from profiles where id='{ids[a_role]}' for update;"); ready(x)
                            a, ap = sess(a_role, a_op); r.update(x_pid=xp, a_pid=ap)
                            r['A_blocking_pids_on_X'] = observe(ap, xp); required.append('A_blocking_pids_on_X')
                            b, bp = sess(b_role, b_op); r['b_pid'] = bp
                            time.sleep(1.0)
                            r['B_blocking_pids_before_X_release'] = bl(bp)
                            release(x, 'rollback')
                            r['B_blocking_pids_on_lifecycle'] = observe(bp, ap); required.append('B_blocking_pids_on_lifecycle')
                            ra = finish(a); rb = finish(b)
                        r['A'] = ra; r['B'] = rb; r['state_after'] = state_of(tgt, emp)
                        r['deadlock_40P01'] = 'deadlock detected' in (ra['err'] + rb['err']).lower()
                        def fits(res, want): return (res['exit'] == 0) if want is None else (res['exit'] != 0 and want in res['err'])
                        r['A_expected'] = ok_a or 'exit 0'; r['B_expected'] = ok_b or 'exit 0'
                        r['pass'] = (not r['deadlock_40P01']) and fits(ra, ok_a) and fits(rb, ok_b) and all(r.get(k) for k in required)
                        print('RECIPROCAL_RESULT', json.dumps(r), flush=True)
                        recip.append(r)
                        return r
                    run('spb-vs-link/branch-held', 'branch', 'spb', 'link')
                    run('spb-vs-configure/branch-held', 'branch', 'spb', 'configure')
                    run('spb-vs-link/employee-held', 'u09', 'spb', 'link')
                    run('spb-vs-configure/employee-held', 'u09', 'spb', 'configure')
                    run('lifecycle-vs-link/employee-held', 'u09', 'lifecycle', 'link')
                    run('lifecycle-vs-configure/employee-held', 'u09', 'lifecycle', 'configure')
                    run('lifecycle-vs-link/actor-excl-held', 'actor_excl', 'lifecycle', 'link', ok_b='EMPLOYEE_NOT_AVAILABLE')
                    run('lifecycle-vs-configure/actor-excl-held', 'actor_excl', 'lifecycle', 'configure', ok_b='EMPLOYEE_NOT_AVAILABLE')
                    run('two-tab-same-actor/link-vs-configure-distinct', 'u09', 'configure', 'link', a_mode='distinct')
                    run('two-tab-same-actor/configure-vs-link-same-employee', 'u09', 'link', 'configure', a_mode='other_target', ok_a='EMPLOYEE_ALREADY_LINKED')
                    run('self-target-link/spb-same-actor', 'branch', 'spb', 'link', self_target=True, ok_b='PEOPLE_ACCOUNT_BUSY')
                    run('admin-explicit-grant/spb-vs-configure', 'u09', 'spb', 'configure', a_role='ADMIN', b_role='ADMIN')
                    run('admin-explicit-grant/spb-vs-link/branch-held', 'branch', 'spb', 'link', a_role='ADMIN', b_role='ADMIN')
                    # Uncontended self-target controls: upgrade path works and original refusals remain.
                    solo = str(uuid.uuid4()); self_e = str(uuid.uuid4())
                    db.sql(f"insert into auth.users(id,email) values('{solo}','{solo}@fiction.invalid');update profiles set role='OWNER',full_name='Solo owner',is_active=true where id='{solo}';insert into employees(id,nama,status,branch_id) values('{self_e}','Solo self','Aktif','{ids['BRANCH_A']}')")
                    solo_sql = f"begin;set local role authenticated;set local request.jwt.claim.sub='{solo}';set local request.jwt.claim.role='authenticated';"
                    db.sql(solo_sql + f"select link_employee_account('{solo}','{self_e}');rollback;")
                    assert db.last(f"select profile_id is null from employees where id='{self_e}'") == 't'
                    try:
                        db.sql(solo_sql + f"select configure_employee_account('{solo}','{self_e}','Self','STAFF',array['{ids['BRANCH_A']}']::uuid[]);commit;")
                        raise AssertionError('self configure must be refused')
                    except RuntimeError as error:
                        assert 'ACCOUNT_NOT_UNCONFIGURED' in str(error), str(error)
                    assert db.last(f"select profile_id is null from employees where id='{self_e}'") == 't'
                    report['reciprocal_cases'] = recip
                    (EVIDENCE / 'people-fix2-reciprocal-observations.json').write_text(json.dumps(recip, indent=2) + '\n')
                    failed = [c for c in recip if not c['pass']]
                    assert not failed, 'Reciprocal lock failures: ' + json.dumps([{k: c.get(k) for k in ('label', 'deadlock_40P01', 'A', 'B')} for c in failed])
                    passed('PEOPLE-LOCK-03 residual: set_employee_primary_branches/lifecycle vs link/configure reciprocal pairs, two-tab same actor and self-target complete without 40P01')
                    if args.fix_case == 'reciprocal': return
                operation = edit_sql('Concurrent action')
                actor, actor_pid = session(auth_sql('ADMIN') + operation + ';')
                ready(actor)
                writer, writer_pid = session(auth_sql('OWNER') + revoke_sql())
                blocked(writer_pid, actor_pid)
                os.write(actor.stdin.fileno(),b'commit;\n\\q\n'); actor.communicate(timeout=8)
                ready(writer); os.write(writer.stdin.fileno(),b'commit;\n\\q\n'); writer.communicate(timeout=8)
                policy(all_keys)
                operation = edit_sql('Must not commit')
                writer, writer_pid = session(auth_sql('OWNER') + revoke_sql())
                ready(writer)
                actor, actor_pid = session(auth_sql('ADMIN') + operation + ';')
                blocked(actor_pid, writer_pid)
                os.write(writer.stdin.fileno(),b'commit;\n\\q\n'); writer.communicate(timeout=8)
                actor.stdin.close(); actor.stdin = None
                _, error = actor.communicate(timeout=8)
                assert b'ROLE_ACTION_DENIED' in error, error
                assert db.last(f"select full_name from profiles where id='{ids['STAFF']}'") == 'Concurrent action'
                passed('actual blocked PID evidence both action-reader/config-writer directions; committed revoke denies waiting action')
                policy(all_keys)
                owner_snapshot = json.loads(db.last(f"select user_account_edit_snapshot('{ids['OWNER']}')"))
                holder, holder_pid = session(f"begin;select id from profiles where id='{ids['OWNER']}' for update;")
                ready(holder)
                denied_edit = f"select edit_user_account('{ids['OWNER']}','People OWNER','OWNER',array[]::uuid[],'{owner_snapshot['version']}','{uuid.uuid4()}');"
                waiter, waiter_pid = session(auth_sql('ADMIN') + denied_edit)
                # Target Profile is the LAST lock and is NOWAIT: no wait, clean 40001 retry error.
                waiter.stdin.close(); waiter.stdin = None
                _, error = waiter.communicate(timeout=8)
                assert b'PEOPLE_ACCOUNT_BUSY' in error and waiter.returncode != 0, error
                os.write(holder.stdin.fileno(),b'rollback;\n\\q\n'); holder.communicate(timeout=8)
                waiter, waiter_pid = session(auth_sql('ADMIN') + denied_edit)
                waiter.stdin.close(); waiter.stdin = None
                _, error = waiter.communicate(timeout=8)
                assert b'ACCOUNT_EDIT_DENIED' in error, error
                passed('target Profile lock is last and NOWAIT: held target fails closed PEOPLE_ACCOUNT_BUSY without waiting; original denial after release')
                policy(['people.simpanEditPengguna'])
                denied('ADMIN', f"select set_user_branch_assignment('{ids['STAFF']}','{ids['BRANCH_B']}','PRIMARY',false)", 'ROLE_ACTION_DENIED')
                policy(['people.account_branch_direct_assign'])
                denied('ADMIN', f"select set_user_branch_assignment('{ids['STAFF']}','{ids['BRANCH_A']}','SECONDARY',false)", 'ROLE_ACTION_DENIED')
                assert db.last(f"select role from user_branches where user_id='{ids['STAFF']}' and branch_id='{ids['BRANCH_A']}'") == 'PRIMARY'
                policy(all_keys, all_branches=False)
                denied('ADMIN', configure.replace("'STAFF'", "'FINANCE'"), 'ACCOUNT_ROLE_NOT_ALLOWED')
                policy(all_keys, create_accounts=False)
                denied('ADMIN', configure, 'ACCOUNT_CREATOR_REQUIRED')
                policy(all_keys)
                passed('alternate metadata writes require edit AND branch permissions; configure intrinsic ceilings retained')
                report['enabledkeys'] = all_keys
                report['foundation_action_core_ready'] = db.last("select to_regprocedure('public.require_role_action(text)') is not null") == 't'
                current_functions = json.loads(db.last(original_functions_sql))
                modified = {'edit_user_account(uuid,text,text,uuid[],text,uuid)', 'configure_employee_account(uuid,uuid,text,text,uuid[])', 'link_employee_account(uuid,uuid)'}
                assert all(current_functions[key] == value for key, value in original_functions.items() if key not in modified)
                # Fingerprint actual original business bodies, not merely unrelated
                # functions: strip ONLY the reviewed guards/lock protocol changes.
                guards = {
                    'configure_employee_account(uuid,uuid,text,text,uuid[])': " perform people_actions_private.lock_accounts(p_profile_id,p_employee_id);\n perform public.preflight_employee_account(p_employee_id,p_role,p_branch_ids);\n if not exists(select 1 from public.profiles where id=p_profile_id and role='STAFF') then raise exception 'ACCOUNT_NOT_UNCONFIGURED'; end if;\n if exists(select 1 from public.profiles where id=p_profile_id and not is_active) then perform public.require_role_action('people.togglePengguna'); end if;\n",
                    'link_employee_account(uuid,uuid)': " perform people_actions_private.lock_accounts(p_profile_id,p_employee_id);\n perform public.require_role_action('people.tautkanPengguna');\n if not public.user_account_edit_allowed(p_profile_id) then raise exception 'ACCOUNT_EDIT_DENIED'; end if;\n",
                }
                business_fingerprints = {}
                for key in modified:
                    before = original_functions[key]; after = current_functions[key]
                    assert {k:v for k,v in before.items() if k!='definition'} == {k:v for k,v in after.items() if k!='definition'}, key
                    definition = after['definition']
                    if key in guards:
                        anchor = 'begin\n' + guards[key]
                        assert definition.count(anchor)==1, key
                        definition = definition.replace(anchor,'begin\n',1)
                    else:
                        gate = "\n perform public.require_role_action('people.simpanEditPengguna');\n if new_ids is distinct from (select coalesce(array_agg(branch_id order by branch_id),array[]::uuid[]) from public.user_branches where user_id=p_profile_id) then perform public.require_role_action('people.account_branch_direct_assign'); end if;"
                        assert definition.count(gate)==1
                        definition = definition.replace(gate,'',1)
                        definition = definition.replace(" perform people_actions_private.lock_accounts(p_profile_id);", " perform pg_advisory_xact_lock(hashtextextended('u09-user-account-edit',0));\n lock table public.user_branches in share row exclusive mode;\n perform id from public.profiles where id in(auth.uid(),p_profile_id) order by id for update;",1)
                    assert definition == before['definition'], 'Original business body changed: '+key
                    business_fingerprints[key] = hashlib.sha256(definition.encode()).hexdigest()
                report['original_business_body_sha256_after_removing_narrow_guards'] = business_fingerprints
                report['employee_compatibility_sha256'] = hashlib.sha256(employee_snapshot).hexdigest()
                report['unchanged_pre_domain_function_metadata_count'] = len(original_functions) - len(modified)
                report['explicitly_extended_original_functions'] = sorted(modified)
                report['original_function_metadata_sha256'] = hashlib.sha256(json.dumps(original_functions, sort_keys=True).encode()).hexdigest()
                passed('all unrelated original function bodies/ACLs/security/search paths unchanged; three explicit account extensions')
                assert db.last('select count(*) from people_actions_private.branch_assignment_permits') == '0'
                denied('OWNER', 'insert into people_actions_private.branch_assignment_permits values(txid_current(),auth.uid(),auth.uid(),auth.uid(),\'PRIMARY\')', 'permission denied')
                denied('OWNER', f"update user_branches set role='SECONDARY' where user_id='{ids['STAFF']}'", 'PEOPLE_ACCOUNT_RPC_REQUIRED')
                passed('transaction permits cleaned and unforgeable; direct branch UPDATE rejected')
                report['gaps'] = ['47 other people keys remain disabled: HR administration, salary floors/reads, employee lifecycle and directories need their own complete ingress and native proofs.', 'Local native Auth/storage fixtures and mocked Auth app-unit boundaries are NOT hosted Auth/PostgREST/browser UAT; no signup/reset/network/deploy was performed.', 'Lock protocol: actor Profile SHARE -> complete Employee set FOR UPDATE -> U09/user_branches -> target Profile FOR UPDATE NOWAIT (40001 PEOPLE_ACCOUNT_BUSY retry, never waits). Callers/app code do not yet auto-retry 40001. Original set_employee_primary_branches and lifecycle remain unmodified. No broad HR completion claimed.', 'Independent parent review, combined domain integration and full build remain required.']
                report['status'] = 'verified five-key core account-write subset only'
                entries = [entry for entry in json.loads((INPUT_EVIDENCE / 'planned-action-catalog.json').read_text())['entries'] if entry['id'].startswith('people.')]
                report['remaining52_keycoverage'] = [{**entry, 'enforced': entry['id'] in all_keys, 'gap': None if entry['id'] in all_keys else 'Complete HR/read ingress and native policy proof outstanding.'} for entry in entries]
                assert len(report['remaining52_keycoverage']) == 52
                assert len([entry for entry in report['remaining52_keycoverage'] if entry['enforced']]) == 5
                report['dependencies'] = {'configure': ['people.buatPengguna','people.tautkanPengguna','people.account_branch_direct_assign (nonempty grants)'], 'edit': ['people.simpanEditPengguna','people.account_branch_direct_assign (grant changes)'], 'alternate_branch': ['people.simpanEditPengguna','people.account_branch_direct_assign'], 'link': ['people.tautkanPengguna'], 'activation': ['people.togglePengguna']}
                report['owned_source_sha256'] = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in ['scripts/test-role-people-actions-postgres.py', 'supabase/migrations/20261106140000_role_hris_user_actions.sql']}
                log_names = ['people-account-edit-red.log','people-account-edit-green.log','people-profiles-red.log','people-profiles-green.log','people-configure-red.log','people-configure-green.log','people-configure-target-red.log','people-active-red.log','people-app-account-red.log','people-account-completed-native.log']
                report['logs'] = {name: str(INPUT_EVIDENCE / name) for name in log_names}
                focused = INPUT_EVIDENCE / 'people-account-focused-green.log'
                assert '14 passed' in focused.read_text(), 'Focused app tests must be run first'
                report['historical_focused_verification_not_rerun_by_fix_worker'] = {'vitest': '14 passed / 3 files', 'log': str(focused), 'log_sha256': hashlib.sha256(focused.read_bytes()).hexdigest()}
                report['review_status'] = 'Self-review only; independent parent review and combined integration still required.'
                report['candidate_bytes_still_current'] = (ROOT / 'supabase/migrations' / CANDIDATES[1]).read_bytes() == snapshots[CANDIDATES[1]] and (ROOT / 'supabase/migrations/20261106150000_role_employee_actions.sql').read_bytes() == employee_snapshot
                assert report['candidate_bytes_still_current'], 'Dependency changed during proof: rerun required'
                for name, data in snapshots.items():
                    (EVIDENCE / ('people-fix2-green-snapshot-' + name)).write_bytes(data)
                (EVIDENCE / 'action-people-fix2-native-report.json').write_text(json.dumps(report, indent=2) + '\n')
                print(json.dumps({key: value for key, value in report.items() if key not in ['original_hashes', 'remaining52_keycoverage']}, indent=2), flush=True)


if __name__ == '__main__':
    main()
