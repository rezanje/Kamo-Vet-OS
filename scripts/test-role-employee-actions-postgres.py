#!/usr/bin/env python3
"""Local PG17 employee action tracer; exact originals and frozen dependencies."""
import fcntl
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
OUT = Path('/opt/data/kamo-role-settings-evidence/recompose2/employee-recompose-native-report.json')
DEPENDENCIES = ['20261106120000_role_settings_atomic.sql', '20261106140000_role_hris_user_actions.sql']
OWN = '20261106150000_role_employee_actions.sql'
KEY = 'people.editKaryawan'


def main():
    report = {'enabledIDs': [], 'checks': [], 'gaps': ['Create/import and three assignment keys remain unenforced; no claim of all HRIS coverage.', 'No hosted Auth/PostgREST/browser UAT.', 'No concurrent policy/identity lock proof in this focused tracer.']}
    def passed(name):
        report['checks'].append(name)
        print('PASS', name, flush=True)
    def git(*args):
        return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, check=True).stdout
    try:
        with open('/opt/data/kamo-heavy-test.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with tempfile.TemporaryDirectory(prefix='employee-action-', dir='/opt/data') as tmp:
                snapshot = Path(tmp)
                migrations = snapshot / 'supabase/migrations'
                migrations.mkdir(parents=True)
                originals = {}
                for line in git('ls-tree', '-r', BASE, '--', 'supabase/migrations').decode().splitlines():
                    meta, path = line.split('\t')
                    if not path.endswith('.sql'):
                        continue
                    raw = git('cat-file', 'blob', meta.split()[2])
                    assert raw == (ROOT / path).read_bytes(), path
                    originals[Path(path).name] = hashlib.sha256(raw).hexdigest()
                    (migrations / Path(path).name).write_bytes(raw)
                assert len(originals) == 365
                report['original_hashes'] = originals
                snapshots = {n: (ROOT / 'supabase/migrations' / n).read_bytes() for n in DEPENDENCIES}
                own = ROOT / 'supabase/migrations' / OWN
                if own.exists():
                    snapshots[OWN] = own.read_bytes()
                report['candidate_hashes'] = {n: hashlib.sha256(b).hexdigest() for n, b in snapshots.items()}
                report['core_dependency_sha256'] = report['candidate_hashes'][DEPENDENCIES[0]]
                spec = importlib.util.spec_from_file_location('employee_fullschema', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
                assert spec is not None and spec.loader is not None
                fixture = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(fixture)
                setattr(fixture, 'ROOT', snapshot)
                with NativePostgres('/opt/data/kamo-pg-harness/bin') as db:
                    fixture.DisposablePostgres.bootstrap(db)
                    report['server_version'] = db.last('show server_version')
                    assert 170000 <= int(db.last('show server_version_num')) < 180000
                    function_snapshot_sql = "select coalesce(jsonb_object_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',md5(concat_ws('|',pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),coalesce(p.proacl::text,''),coalesce(p.proconfig::text,''),p.prosecdef,p.provolatile,p.proleakproof,p.proparallel,p.prokind,p.prorettype::regtype::text))),'{}'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('pg_catalog','information_schema','pg_toast') and n.nspname !~ '^pg_(temp|toast_temp)' and p.prokind in ('f','p') and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')"
                    exact_base_functions = json.loads(db.last(function_snapshot_sql))
                    report['exact_base_function_count'] = len(exact_base_functions)
                    for name in DEPENDENCIES:
                        db.sql(snapshots[name].decode())
                    owner, admin, staff, branch, other, employee, second = [str(uuid.UUID(int=n)) for n in range(91001, 91008)]
                    db.sql(f"insert into auth.users(id,email) values('{owner}','owner@employee.invalid'),('{admin}','admin@employee.invalid'),('{staff}','staff@employee.invalid'); update profiles set role='OWNER',is_active=true where id='{owner}'; update profiles set role='ADMIN',is_active=true where id='{admin}'; insert into branches(id,name,code,type,is_active) values('{branch}','Employee A','EPA','BOTH',true),('{other}','Employee B','EPB','BOTH',true); insert into employees(id,nama,status,branch_id) values('{employee}','Employee original','Aktif','{branch}'),('{second}','Employee second','Aktif','{other}'); insert into user_branches(user_id,branch_id,role) values('{admin}','{branch}','PRIMARY'),('{staff}','{branch}','PRIMARY');")
                    def actor(who, statement):
                        return db.sql(f"begin;set local role authenticated;set local request.jwt.claim.sub='{who}';set local request.jwt.claim.role='authenticated';{statement};commit;")
                    def policy(actions, all_branches=True, modules=('hris', 'pengaturan', 'perusahaan')):
                        revision = db.last("select role_settings_private.snapshot('ADMIN')->>'revision'")
                        return actor(owner, f"select save_role_access_config('ADMIN','{revision}','{uuid.uuid4()}','custom','{json.dumps(list(modules))}','{{\"all_branches\":{str(all_branches).lower()},\"create_accounts\":true}}','employee proof','{json.dumps(actions)}')")
                    actor(admin, f"update employees set phone='original positive' where id='{employee}'")
                    assert db.last(f"select phone from employees where id='{employee}'") == 'original positive'
                    passed('eligible authenticated ADMIN original contact update succeeds before candidate')
                    report['alternate_employee_writers'] = json.loads(db.last("select coalesce(jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and (pg_get_functiondef(p.oid) ~* '(insert into|update|delete from)[[:space:]]+(public\\.)?(employees|employee_branch_assignments)' or p.proname='change_master_data_lifecycle')"))
                    original_functions = json.loads(db.last(function_snapshot_sql))
                    dependency_changed = sorted(k for k, v in exact_base_functions.items() if original_functions.get(k) != v)
                    if OWN in snapshots:
                        db.sql(snapshots[OWN].decode())
                    candidate_functions = json.loads(db.last(function_snapshot_sql))
                    own_changed = sorted(k for k, v in original_functions.items() if candidate_functions.get(k) != v)
                    assert not own_changed, own_changed
                    composed_changed = sorted(k for k, v in exact_base_functions.items() if candidate_functions.get(k) != v)
                    assert composed_changed == dependency_changed, (composed_changed, dependency_changed)
                    report['unchanged_original_function_count'] = len(exact_base_functions) - len(composed_changed)
                    report['exact_base_to_composed'] = {'base_count': len(exact_base_functions), 'composed_count': len(candidate_functions), 'changed_by_frozen_dependencies_only': dependency_changed, 'changed_by_employee_migration': own_changed, 'added_by_dependencies': sorted(k for k in original_functions if k not in exact_base_functions), 'added_by_employee_migration': sorted(k for k in candidate_functions if k not in original_functions), 'digest_fields': 'schema-qualified identity, definition, owner, ACL, proconfig, security-definer, volatility, leakproof, parallel, kind, return type; all non-system schemas; extension-owned excluded'}
                    passed('exact-base to composed function metadata (all schemas, owner/ACL/config) changes only frozen dependencies; employee migration changes no existing function')
                    report['disabled_requestedIDs'] = json.loads(db.last("select jsonb_agg(id order by id) from role_settings_private.action_catalog where id in ('people.simpanKaryawan','people.imporKaryawanExcel','people.simpanPenugasanCabang','people.akhiriPenugasanCabang','people.setCabangUtamaMassal') and not enforced"))
                    report['closure'] = 'Universal row guard on changed contact/job fields; includes SECURITY DEFINER writes without relying on RLS. No original public RPC writes these fields; account link and lifecycle-only mutations are intentionally excluded.'
                    def fingerprint():
                        tables = ['employees', 'employee_branch_assignments', 'employee_branch_change_log', 'employee_import_details', 'profiles', 'user_branches', 'user_account_edits', 'activity_log', 'employee_base_salaries', 'journal_entries', 'journal_lines', 'cashier_shifts', 'stock_moves', 'stock_layers']
                        return {t: db.last(f"select md5(coalesce(jsonb_agg(j order by j::text),'[]'::jsonb)::text) from (select to_jsonb(t) j from public.{t} t) q") for t in tables}
                    def denied(who, sql, match):
                        before = fingerprint()
                        try:
                            actor(who, sql)
                        except RuntimeError as error:
                            assert match in str(error), str(error)
                            assert fingerprint() == before, 'Denied mutation had effects'
                            report['zero_effect_denials'] = report.get('zero_effect_denials', 0) + 1
                            return
                        raise AssertionError('Expected custom denial but valid authenticated mutation succeeded: ' + sql)
                    policy([])
                    denied(admin, f"update employees set phone='must deny' where id='{employee}'", 'ROLE_ACTION_DENIED')
                    passed('custom deny blocks eligible ADMIN direct employee contact update with zero full-state effects')
                    for field, value in [('nama', "'Denied name'"), ('nik', "'DENIEDNIK'"), ('jabatan', "'Dokter'"), ('departemen', "'Denied department'"), ('email', "'contact@employee.invalid'"), ('tgl_masuk', "'2026-01-01'")]:
                        denied(admin, f"update employees set {field}={value} where id='{employee}'", 'ROLE_ACTION_DENIED')
                    passed('all seven contact/job fields covered by actual row mutation guards')
                    policy([KEY])
                    actor(admin, f"update employees set nama='Allowed name',nik='ALLOWNIK',phone='allowed',email='allowed@employee.invalid',departemen='Reception',tgl_masuk='2026-01-02' where id='{employee}'")
                    assert db.last(f"select nama from employees where id='{employee}'") == 'Allowed name'
                    passed('selected action permits legitimate in-scope contact edit without account identity changes')
                    policy([KEY], False)
                    denied(admin, f"update employees set phone='Out of scope' where id='{second}'", 'EMPLOYEE_SCOPE_DENIED')
                    policy([KEY])
                    db.sql(f"update profiles set is_active=false where id='{admin}'")
                    denied(admin, f"update employees set phone='inactive' where id='{employee}'", 'ROLE_ACTION_DENIED')
                    db.sql(f"update profiles set is_active=true where id='{admin}'")
                    denied(admin, f"update employees set profile_id='{staff}' where id='{employee}'", 'PEOPLE_ACCOUNT_RPC_REQUIRED')
                    denied(admin, f"insert into employee_base_salaries(employee_id,gaji_pokok) values('{employee}',100000)", 'row-level security')
                    actor(owner, f"insert into employee_base_salaries(employee_id,gaji_pokok) values('{employee}',100000)")
                    passed('inactive identity, account-link separation and original salary OWNER ceiling retained')
                    policy([])
                    actor(staff, f"select nama from employees where id='{employee}' for share")
                    actor(staff, f"update profiles set full_name='Personal name' where id='{staff}'")
                    actor(owner, f"update employees set phone='Owner control' where id='{employee}'")
                    assert db.last(f"select phone from employees where id='{employee}'") == 'Owner control'
                    passed('minimal clinical directory row locks, personal name and OWNER controls survive deny-all')
                    # Actual account configuration changes only the link, never HR contact/job fields.
                    fresh = str(uuid.uuid4())
                    db.sql(f"insert into auth.users(id,email) values('{fresh}','configured@employee.invalid')")
                    policy(['people.buatPengguna','people.tautkanPengguna','people.account_branch_direct_assign'])
                    actor(admin, f"select configure_employee_account('{fresh}','{employee}','Login name','STAFF',array['{branch}']::uuid[])")
                    assert db.last(f"select profile_id from employees where id='{employee}'") == fresh
                    assert db.last(f"select nama from employees where id='{employee}'") == 'Allowed name'
                    passed('060900 account configuration legitimately links employee with employeeEdit denied')
                    # Observe real epoch blocking in both directions, without sleeps.
                    import os
                    import time
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
                            if line.strip() == b'READY':
                                return
                    def finish(proc):
                        os.write(proc.stdin.fileno(), b'commit;\n\\q\n')
                        _, error = proc.communicate(timeout=8)
                        assert proc.returncode == 0, error
                    def blocked(waiter, holder):
                        deadline = time.monotonic() + 8
                        while time.monotonic() < deadline:
                            pids = json.loads(db.last(f'select to_json(pg_blocking_pids({waiter}))'))
                            if holder in pids:
                                report.setdefault('blocked_pid_evidence', []).append({'waiter': waiter, 'blocker': holder, 'pg_blocking_pids': pids})
                                return
                        raise AssertionError('Expected real blocking PID absent')
                    def auth(who):
                        return f"begin;set local role authenticated;set local request.jwt.claim.sub='{who}';set local request.jwt.claim.role='authenticated';"
                    def revoke_sql():
                        revision = db.last("select role_settings_private.snapshot('ADMIN')->>'revision'")
                        return f"select save_role_access_config('ADMIN','{revision}','{uuid.uuid4()}','custom','[\"hris\",\"pengaturan\",\"perusahaan\"]','{{\"all_branches\":true,\"create_accounts\":true}}','concurrent employee revoke','[]');"
                    policy([KEY])
                    reader, reader_pid = session(auth(admin) + f"update employees set phone='serialized' where id='{employee}';")
                    ready(reader)
                    writer, writer_pid = session(auth(owner) + revoke_sql())
                    blocked(writer_pid, reader_pid)
                    finish(reader)
                    ready(writer)
                    finish(writer)
                    denied(admin, f"update employees set phone='after revoke' where id='{employee}'", 'ROLE_ACTION_DENIED')
                    policy([KEY])
                    writer, writer_pid = session(auth(owner) + revoke_sql())
                    ready(writer)
                    reader, reader_pid = session(auth(admin) + f"update employees set phone='must rollback' where id='{employee}';")
                    blocked(reader_pid, writer_pid)
                    finish(writer)
                    reader.stdin.close()
                    reader.stdin = None
                    _, error = reader.communicate(timeout=8)
                    assert b'ROLE_ACTION_DENIED' in error, error
                    assert db.last(f"select phone from employees where id='{employee}'") == 'serialized'
                    passed('real employee mutation and committed policy revocation serialize in both observed blocker directions')
                    # ---- EMPLOYEE-SCOPE-FRESHNESS: authorization after a REAL employee-row wait.
                    branch_c, third = str(uuid.UUID(int=91008)), str(uuid.UUID(int=91009))
                    db.sql(f"insert into branches(id,name,code,type,is_active) values('{branch_c}','Employee C','EPC','BOTH',true); insert into employees(id,nama,status,branch_id) values('{third}','Employee third','Aktif','{branch_c}'); insert into employee_branch_assignments(employee_id,branch_id,role) values('{third}','{other}','SECONDARY') on conflict do nothing;")
                    def employee_phone(target):
                        return db.last(f"select coalesce(phone,'<null>') from employees where id='{target}'")
                    def row_wait(target, mutate, expect_error, label):
                        """Hold the exact employee row, observe pg_blocking_pids, commit `mutate`, release; reader outcome."""
                        before_phone = employee_phone(target)
                        holder, holder_pid = session(f"begin;select id from employees where id='{target}' for update;")
                        ready(holder)
                        reader, reader_pid = session(auth(admin) + f"update employees set phone='{label}' where id='{target}';")
                        blocked(reader_pid, holder_pid)
                        report['blocked_pid_evidence'][-1]['label'] = label
                        mutate()
                        before = fingerprint()
                        os.write(holder.stdin.fileno(), b'commit;\\q\n')
                        holder.communicate(timeout=8)
                        if expect_error:
                            reader.stdin.close(); reader.stdin = None
                            _, error = reader.communicate(timeout=8)
                            assert expect_error.encode() in error, (label, reader.returncode, error)
                            assert employee_phone(target) == before_phone, label
                            assert fingerprint() == before, 'Denied stale-scope mutation had effects: ' + label
                            report['zero_effect_denials'] = report.get('zero_effect_denials', 0) + 1
                        else:
                            ready(reader)
                            finish(reader)
                            assert employee_phone(target) == label, label
                    def restore_branches():
                        db.sql(f"insert into user_branches(user_id,branch_id,role) values('{admin}','{branch}','PRIMARY') on conflict do nothing; delete from user_branches where user_id='{admin}' and branch_id<>'{branch}'; insert into employee_branch_assignments(employee_id,branch_id,role) values('{third}','{other}','SECONDARY') on conflict do nothing;")
                    # (1) all_branches=false committed while the employee row is held; action grant retained.
                    policy([KEY], True)
                    row_wait(second, lambda: policy([KEY], False), 'EMPLOYEE_SCOPE_DENIED', 'STALE_ALL_BRANCHES')
                    assert db.last("select all_branches from role_capabilities where role='ADMIN'") == 'f'
                    assert db.last(f"select '{KEY}'=any(allowed) from role_settings_private.action_policies where role='ADMIN'") == 't'
                    passed('committed all_branches=false while employee row blocked (real PID) denies stale out-of-scope update with zero effects and the action grant retained')
                    # (2) user_branches deletion of the exact branch basis while row blocked.
                    policy([KEY], False)
                    row_wait(employee, lambda: db.sql(f"delete from user_branches where user_id='{admin}' and branch_id='{branch}'"), 'EMPLOYEE_SCOPE_DENIED', 'STALE_USER_BRANCH')
                    assert db.last(f"select count(*) from user_branches where user_id='{admin}'") == '0'
                    passed('committed user_branches deletion while employee row blocked (real PID) denies with zero effects')
                    restore_branches()
                    # (3) secondary assignment basis: admin only has branch B via assignment of a branch-C employee.
                    db.sql(f"insert into user_branches(user_id,branch_id,role) values('{admin}','{other}','SECONDARY') on conflict do nothing; delete from user_branches where user_id='{admin}' and branch_id='{branch}'")
                    policy([KEY], False)
                    actor(admin, f"update employees set phone='SECONDARY_LEGIT' where id='{third}'")
                    assert employee_phone(third) == 'SECONDARY_LEGIT'
                    row_wait(third, lambda: db.sql(f"delete from employee_branch_assignments where employee_id='{third}' and branch_id='{other}'"), 'EMPLOYEE_SCOPE_DENIED', 'STALE_SECONDARY')
                    passed('secondary-assignment basis works, then committed assignment deletion while row blocked (real PID) denies with zero effects')
                    restore_branches()
                    db.sql(f"delete from user_branches where user_id='{admin}' and branch_id<>'{branch}'")
                    # (4) legitimate explicit-branch grant with all_branches=false still works, with and without a row wait.
                    policy([KEY], False)
                    actor(admin, f"update employees set phone='EXPL_DIRECT' where id='{employee}'")
                    assert employee_phone(employee) == 'EXPL_DIRECT'
                    row_wait(employee, lambda: None, None, 'EXPL_AFTER_WAIT')
                    denied(admin, f"update employees set phone='out of scope 2' where id='{second}'", 'EMPLOYEE_SCOPE_DENIED')
                    passed('legit explicit-branch grant with all_branches=false succeeds directly and after a real row wait; unrelated branch still denied')
                    # (5) module deny and current-false action/cap still deny.
                    policy([KEY], True, modules=('pengaturan', 'perusahaan'))
                    denied(admin, f"update employees set phone='module denied' where id='{employee}'", 'ROLE_ACTION_DENIED')
                    policy([], True)
                    denied(admin, f"update employees set phone='action denied' where id='{employee}'", 'ROLE_ACTION_DENIED')
                    policy([KEY], False)
                    denied(admin, f"update employees set phone='cap false' where id='{second}'", 'EMPLOYEE_SCOPE_DENIED')
                    passed('module-deny, action-deny and current-false all_branches still deny with zero effects')
                    policy([KEY])
                    # (6) SECURITY DEFINER caller bypasses RLS: the trigger scope must still bind the persisted actor.
                    db.sql("create function public.employee_scope_sd_probe(p_id uuid) returns void language sql security definer set search_path='' as $$ update public.employees set phone='SD_PROBE' where id=p_id $$; grant execute on function public.employee_scope_sd_probe(uuid) to authenticated;")
                    policy([KEY], False)
                    denied(admin, f"select employee_scope_sd_probe('{second}')", 'EMPLOYEE_SCOPE_DENIED')
                    actor(admin, f"select employee_scope_sd_probe('{employee}')")
                    assert employee_phone(employee) == 'SD_PROBE'
                    db.sql("drop function public.employee_scope_sd_probe(uuid)")
                    policy([KEY])
                    passed('SECURITY DEFINER (RLS-bypassing) writer is still bound to persisted actor branch scope')
                    report['gaps'].append('Real qualified clinical mutation (visit/service state, qualification fixtures) is NOT exercised here: only SELECT FOR SHARE on the employee row plus personal-name update. Unproven by this tracer.')
                    report['gaps'].append('user_branches deletion and assignment deletion are committed as direct privileged DML (simulating a committed revocation), not via set_user_branch_assignment / assignment RPCs.')
                    report['gaps'].remove('No concurrent policy/identity lock proof in this focused tracer.')
                    report['gaps'].append('Identity NOWAIT contention prevention supplied by exact-hash core; employee trigger adds no profile-writing flow.')
                    report['enabledIDs'] = [KEY]
                    report['native_green'] = True
                for name in DEPENDENCIES:
                    assert (ROOT / 'supabase/migrations' / name).read_bytes() == snapshots[name], 'Dependency changed; rerun required'
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        sources = [Path(__file__), ROOT / 'supabase/migrations' / OWN, ROOT / 'src/app/(app)/hris/karyawan/actions.ts', ROOT / 'src/app/(app)/hris/karyawan/employee-actions-policy.test.ts']
        report['source_hashes'] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources if p.exists()}
        OUT.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
