#!/usr/bin/env python3
"""A02 owner package: regenerate the read-only preflight/readback SQL and the atomic apply script from the
migration file, then rehearse everything on a throwaway native PostgreSQL cluster:

  preflight -> apply blocked by a held lock (lock_timeout, nothing applied) -> preflight -> apply -> readback
  -> A02 SQL suite -> empty-only teardown (succeeds on an empty table) -> preflight -> re-apply -> readback
  -> synthetic request -> freeze (writes refused, data kept and readable) -> teardown refused (data kept)

Never accepts a database URL and never reads production. The cluster lives in a fresh temp dir, listens on a
unix socket only, and is deleted. Only fictional data is created.

Usage (repo root):
  python3 docs/evidence/2026-10-27-a02-correction-requests/owner-apply/build-and-verify.py \
      --server-bin /usr/lib/postgresql/16/bin --label pg16
  python3 docs/evidence/2026-10-27-a02-correction-requests/owner-apply/build-and-verify.py \
      --server-bin <dir with postgres/initdb/pg_ctl 17.6> --client-bin /usr/lib/postgresql/16/bin --label pg17.6
Every run regenerates 01/02/03 and fails if they differ from the committed files (unless --write).
"""
from pathlib import Path
import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
VERSION, NAME = '20261027153000', 'purchase_correction_requests'
MIG = ROOT / f'supabase/migrations/{VERSION}_{NAME}.sql'
SUITE = ROOT / 'supabase/tests/purchase_correction_requests.sql'
FREEZE, TEARDOWN = HERE / '04-freeze-if-decided.sql', HERE / '05-teardown-empty-only.sql'
FUNCS = ['public.purchase_module_access()', 'public.purchase_correction_request_visible(uuid,uuid)',
         'public.create_purchase_correction_request(text,uuid,text,text)', 'public.process_purchase_correction_request(uuid,text)']
INDEXES = ['purchase_correction_requests_queue', 'purchase_correction_requests_po', 'purchase_correction_requests_invoice']
TABLE = f"to_regclass('public.{NAME}')"
GRANTS = "(select coalesce(string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ':' || a.privilege_type, ',' order by a.grantee, a.privilege_type), 'none') from aclexplode({acl}) a where a.grantee <> {owner})"
# Exact catalog shape of everything the migration creates. Expected values are read from the rehearsal cluster
# right after applying the migration; grants exclude the owner's own privileges (PG17 adds MAINTAIN).
SHAPE = [('owner: table', f"(select pg_get_userbyid(relowner) from pg_class where oid = {TABLE})"),
         ('grants: table (all roles except owner)', GRANTS.format(acl=f'(select relacl from pg_class where oid = {TABLE})', owner=f'(select relowner from pg_class where oid = {TABLE})')),
         ('rls: enabled / forced', f"(select relrowsecurity || ' / ' || relforcerowsecurity from pg_class where oid = {TABLE})"),
         ('policies (all on table)', f"(select string_agg(policyname || ' ' || permissive || ' ' || cmd || ' ' || roles::text || ' ' || coalesce(qual, '-') || ' ' || coalesce(with_check, '-'), ' ; ' order by policyname) from pg_policies where schemaname = 'public' and tablename = '{NAME}')"),
         ('triggers (all on table)', f"(select string_agg(pg_get_triggerdef(oid) || ' enabled=' || tgenabled::text, ' ; ' order by tgname) from pg_trigger where tgrelid = {TABLE} and not tgisinternal)"),
         ('constraints md5', f"(select md5(string_agg(conname || ' ' || pg_get_constraintdef(oid), ' ; ' order by conname)) from pg_constraint where conrelid = {TABLE})"),
         ('indexes md5', f"(select md5(string_agg(pg_get_indexdef(indexrelid), ' ; ' order by indexrelid::regclass::text)) from pg_index where indrelid = {TABLE})"),
         ('columns md5', f"(select md5(string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ' ; ' order by a.attnum)) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = {TABLE} and a.attnum > 0 and not a.attisdropped)")]
for _f in ['public.purchase_module_access()', 'public.purchase_correction_request_visible(uuid,uuid)',
           'public.create_purchase_correction_request(text,uuid,text,text)', 'public.process_purchase_correction_request(uuid,text)']:
    _p = f"(select {{}} from pg_proc where oid = to_regprocedure('{_f}'))"
    SHAPE += [('fingerprint (same as tested): ' + _f, _p.format('md5(prosrc)')),
              ('owner / volatility / security definer / config: ' + _f, _p.format("pg_get_userbyid(proowner) || ' ' || provolatile::text || ' ' || prosecdef || ' ' || coalesce(array_to_string(proconfig, ','), '-')")),
              ('grants (all roles except owner): ' + _f, GRANTS.format(acl=f"(select proacl from pg_proc where oid = to_regprocedure('{_f}'))", owner=f"(select proowner from pg_proc where oid = to_regprocedure('{_f}'))"))]

parser = argparse.ArgumentParser()
parser.add_argument('--server-bin', required=True, type=Path)
parser.add_argument('--client-bin', type=Path)
parser.add_argument('--label', required=True)
parser.add_argument('--write', action='store_true', help='write regenerated 01/02/03 instead of comparing')
args = parser.parse_args()
SBIN, CBIN = args.server_bin, args.client_bin or args.server_bin

WORK = Path(tempfile.mkdtemp(prefix='vetos-a02-owner-'))
DATA, SOCK, PORT = WORK / 'data', WORK / 'sock', '54337'
SOCK.mkdir()
AS_SERVER = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
if AS_SERVER:
    shutil.chown(WORK, 'postgres')
    shutil.chown(SOCK, 'postgres')
ENV = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
ENV.update(PSQLRC='/dev/null', TZ='Etc/UTC')
LOG = []


def psql(sql, check=True):
    r = subprocess.run([CBIN / 'psql', '-X', '-h', SOCK, '-p', PORT, '-U', 'postgres', '-d', 'postgres',
                        '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|'], input=sql, text=True, capture_output=True, env=ENV)
    if check and r.returncode:
        raise RuntimeError(r.stderr)
    return r


def rows(sql):
    return [line.split('|') for line in psql(sql).stdout.splitlines() if line]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def query(path, letter):
    text = Path(path).read_text()
    start = text.index(f'-- QUERY {letter}')
    nxt = text.find('-- QUERY ', start + 5)
    return text[start:nxt if nxt != -1 else None]


CHECKS_TAIL = """
)
select check_name, expected, actual,
  case when expected is null then null else actual is not distinct from expected end as ok
from checks
union all
select 'SUMMARY', '0 failed',
  count(*) filter (where expected is not null and actual is distinct from expected) || ' failed',
  count(*) filter (where expected is not null and actual is distinct from expected) = 0
from checks;
"""


def lit(value):
    return 'null' if value is None else "'" + value.replace("'", "''") + "'"


def checks(lines):
    return 'with checks(check_name, expected, actual) as (\n  ' + '\n  union all '.join(
        f"select {lit(n)}, {lit(e)}, ({a})::text" for n, e, a in lines) + CHECKS_TAIL


def render(shape):
    deps = [('dependency: table ' + t, 'true', f"to_regclass('{t}') is not null") for t in
            ['public.purchase_orders', 'public.purchase_invoices', 'public.branches', 'public.profiles', 'public.role_modules',
             'public.user_branches', 'public.activity_log_sources', 'public.activity_log']]
    cols = [('dependency: columns ' + t, str(len(c)), f"(select count(*) from information_schema.columns where table_schema = 'public' and table_name = '{t}' and column_name in ({', '.join(repr(x) for x in c)}))")
            for t, c in [('purchase_orders', ['id', 'no_po', 'branch_id']), ('purchase_invoices', ['id', 'no_faktur', 'po_id', 'branch_id']),
                         ('profiles', ['id', 'role', 'is_active']), ('role_modules', ['role', 'module_id']),
                         ('activity_log_sources', ['entity', 'module_id', 'label_key', 'value_keys', 'scope_kind', 'identity_keys',
                                                   'branch_columns', 'scope_parents', 'metadata_only', 'reader_roles'])]]
    pre = [('info: server version', None, "current_setting('server_version')"),
           ('info: database', None, 'current_database()'),
           ('not yet applied: table purchase_correction_requests absent', 'true', f"to_regclass('public.{NAME}') is null")]
    pre += [('not yet applied: function absent ' + f, 'true', f"to_regprocedure('{f}') is null") for f in FUNCS]
    pre += [('name free: index ' + i, 'true', f"to_regclass('public.{i}') is null") for i in INDEXES]
    pre += [('not yet applied: activity_log_sources row', '0', f"(select count(*) from public.activity_log_sources where entity = '{NAME}')")]
    pre += deps + cols
    pre += [('dependency: function ' + f, 'true', f"to_regprocedure('{f}') is not null") for f in
            ['public.user_can_access_branch(uuid)', 'public.capture_activity_log()', 'gen_random_uuid()']]
    pre += [('dependency: roles anon/authenticated/service_role', '3', "(select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))"),
            ('dependency: user_role has OWNER/ADMIN/DOCTOR', '3', "(select count(*) from pg_enum where enumtypid = to_regtype('public.user_role') and enumlabel in ('OWNER', 'ADMIN', 'DOCTOR'))")]
    preflight = f"""-- A02 PREFLIGHT — READ ONLY. Generated by build-and-verify.py from {MIG.name}; do not edit by hand.
-- Run each query on its own (select the query text, then Run). Nothing here writes.

-- QUERY A — readiness. Every row with an expected value must show ok = true; last row SUMMARY must say "0 failed".
{checks(pre)}
-- QUERY B — migration history. Must run without error (the apply script writes its history row in the same
-- transaction). Expect 0 rows for {VERSION}; the newest rows are for the release note only.
select 'A02 rows' as what, count(*)::text as value from supabase_migrations.schema_migrations where version = '{VERSION}'
union all
select * from (select 'newest ' || version, name from supabase_migrations.schema_migrations order by version desc limit 5) newest;
"""
    post = [('info: server version', None, "current_setting('server_version')"),
            ('info: database', None, 'current_database()'),
            ('applied: table present', 'true', f"{TABLE} is not null")]
    post += [('applied: index ' + i, 'true', f"to_regclass('public.{i}') is not null") for i in INDEXES]
    post += [(n, shape[n], sql) for n, sql in SHAPE]
    post += [('activity log: source readers', '{OWNER}', f"(select reader_roles::text from public.activity_log_sources where entity = '{NAME}')"),
             ('info: request rows', None, f"(select count(*) from public.{NAME})")]
    readback = f"""-- A02 READBACK — READ ONLY. Generated by build-and-verify.py from {MIG.name}; do not edit by hand.
-- Run right after the apply script, each query on its own.

-- QUERY A — the migration is fully in place. Every row with an expected value must show ok = true;
-- last row SUMMARY must say "0 failed".
{checks(post)}
-- QUERY B — migration history now records A02 exactly once.
select count(*) as a02_rows from supabase_migrations.schema_migrations where version = '{VERSION}';
"""
    apply = f"""-- A02 APPLY — WRITES. Generated by build-and-verify.py; do not edit by hand.
-- One transaction: the migration file verbatim (sha256 {sha(MIG)}) plus its history row.
-- Any error, including a lock wait over 5 s or running as a role other than postgres, rolls everything back;
-- nothing is half-applied. The readback expects every A02 object to be owned by postgres.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$ begin
  if current_user <> 'postgres' then
    raise exception 'A02 apply must run as postgres (current role: %); nothing was applied', current_user;
  end if;
end $$;

{MIG.read_text().rstrip()}

insert into supabase_migrations.schema_migrations(version, name) values ('{VERSION}', '{NAME}');
commit;
"""
    return {'01-preflight-readonly.sql': preflight, '02-apply.sql': apply, '03-readback-readonly.sql': readback}


def bootstrap():
    # Same test-only auth/storage shims as scripts/test-accurate-inventory-accounting-postgres.py.
    psql("""create extension pgcrypto;
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create publication supabase_realtime;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
""")
    migrations = [m for m in sorted((ROOT / 'supabase/migrations').glob('*.sql')) if m != MIG]
    for m in migrations:
        if m.name.startswith('0068'):
            psql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Fictional test cash','ASET','D'),('1102','Fictional test bank','ASET','D') on conflict do nothing;")
        version, _, name = m.stem.partition('_')
        try:
            psql(f"begin;\n{m.read_text()}\ninsert into supabase_migrations.schema_migrations(version, name) values ('{version}', '{name}') on conflict do nothing;\ncommit;")
        except RuntimeError as error:
            raise RuntimeError(m.name + ': ' + str(error)) from error
    LOG.append(f'applied {len(migrations)} earlier repository migrations with history rows (A02 excluded)')


def summary(path, letter='A'):
    result = rows(query(path, letter))
    failed = [r for r in result if r[3] == 'f']
    assert result[-1][0] == 'SUMMARY' and not failed, failed or result[-1]
    return result[-1][2]


DRIFT = [
    f'grant select on public.{NAME} to service_role;', f'grant truncate on public.{NAME} to authenticated;',
    f'grant insert on public.{NAME} to anon;', f'alter policy purchase_correction_requests_read on public.{NAME} to public;',
    f'alter policy purchase_correction_requests_read on public.{NAME} using (true);',
    f'create policy a02_drift on public.{NAME} for select to authenticated using (true);',
    'create role a02_drift_owner; alter function public.purchase_module_access() owner to a02_drift_owner;',
    'alter function public.purchase_module_access() volatile;',
    'grant execute on function public.create_purchase_correction_request(text,uuid,text,text) to public;',
    f'drop trigger a01_activity_delete on public.{NAME}; create trigger a01_activity_delete after delete on public.{NAME} for each row execute function public.capture_activity_log();',
    f'alter table public.{NAME} drop constraint purchase_correction_requests_status_check;',
    f'alter table public.{NAME} alter column detail drop not null;', f'create index a02_drift_idx on public.{NAME} (created_at);',
]
FREEZE_READBACK = ['grants (all roles except owner): public.create_purchase_correction_request(text,uuid,text,text)',
                   'grants (all roles except owner): public.process_purchase_correction_request(uuid,text)', 'SUMMARY']


def failed_checks(sql):
    return [r[0] for r in rows(sql) if len(r) == 4 and r[3] == 'f']


def expect_error(sql, needle):
    r = psql(sql, check=False)
    assert r.returncode and needle in r.stderr, (r.returncode, r.stderr[-400:])
    return r.stderr.strip().splitlines()[0]


def main():
    try:
        subprocess.run([*AS_SERVER, SBIN / 'initdb', '-D', DATA, '-U', 'postgres', '-E', 'UTF8', '--locale=C.UTF-8', '--auth=trust'],
                       check=True, capture_output=True, env=ENV)
        with open(DATA / 'postgresql.conf', 'a') as conf:
            conf.write(f"\nlisten_addresses = ''\nunix_socket_directories = '{SOCK}'\nport = {PORT}\ntimezone = 'Etc/UTC'\n")
        subprocess.run([*AS_SERVER, SBIN / 'pg_ctl', '-D', DATA, '-l', WORK / 'server.log', '-w', 'start'], check=True, capture_output=True, env=ENV)
        LOG.append('server: ' + rows('select version()')[0][0] + ' | client: ' +
                   subprocess.run([CBIN / 'psql', '--version'], capture_output=True, text=True).stdout.strip())
        bootstrap()

        # Exact shape of the objects as the migration creates them (applied, read, rolled back).
        probe = psql('begin;\n' + MIG.read_text() + '\n' + '\n'.join(
            f"select {lit('#' + n)}, ({sql})::text;" for n, sql in SHAPE) + '\nrollback;').stdout
        shape = dict(line[1:].split('|', 1) for line in probe.splitlines() if line.startswith('#'))
        assert set(shape) == {n for n, _ in SHAPE} and all(v for v in shape.values()), shape
        files = render(shape)
        for name, text in files.items():
            path = HERE / name
            if args.write:
                path.write_text(text)
            elif not path.exists() or path.read_text() != text:
                raise SystemExit(f'{name} differs from the regenerated text; rerun with --write and review the diff')
        LOG.append('package files regenerated byte-identical: ' + ', '.join(f'{n} {sha(HERE / n)}' for n in files))
        LOG.append(f'static files: {FREEZE.name} {sha(FREEZE)}, {TEARDOWN.name} {sha(TEARDOWN)}, migration {sha(MIG)}')
        pre, app, back = (HERE / n for n in files)

        LOG.append('preflight A: ' + summary(pre) + ' | B: ' + ' / '.join(' '.join(r) for r in rows(query(pre, 'B'))[:2]))

        # A held write lock on purchase_orders (an open checkout) must make the apply give up, not queue.
        holder = subprocess.Popen([CBIN / 'psql', '-X', '-h', SOCK, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=ENV)
        holder.stdin.write('begin; lock table public.purchase_orders in row exclusive mode; select pg_sleep(60);\n')
        holder.stdin.flush()
        for _ in range(100):
            if rows("select count(*) from pg_locks where relation = 'public.purchase_orders'::regclass and mode = 'RowExclusiveLock' and granted")[0][0] == '1':
                break
            time.sleep(0.05)
        started = time.time()
        err = expect_error(app.read_text(), 'lock timeout')
        waited = time.time() - started
        psql("select pg_terminate_backend(pid) from pg_stat_activity where query like '%pg_sleep(60)%' and pid <> pg_backend_pid()")
        holder.kill()
        holder.wait()
        for _ in range(100):
            if rows("select count(*) from pg_locks where relation = 'public.purchase_orders'::regclass and mode = 'RowExclusiveLock'")[0][0] == '0':
                break
            time.sleep(0.05)
        assert 4 < waited < 30, waited
        LOG.append(f'apply under a held purchase_orders write lock: refused after {waited:.1f}s ({err}); preflight after: ' + summary(pre))

        err = expect_error("create role a02_other_admin superuser; set role a02_other_admin;\n" + app.read_text(), 'must run as postgres')
        psql('drop role a02_other_admin;')
        LOG.append(f'apply as another superuser role: refused ({err}); preflight after: ' + summary(pre))
        psql(app.read_text())
        LOG.append('apply: ok | readback A: ' + summary(back) + ' | B: ' + rows(query(back, 'B'))[0][0] + ' history row')
        for change in DRIFT:
            caught = failed_checks('begin;\n' + change + '\n' + query(back, 'A') + '\nrollback;')
            assert caught, change
        LOG.append(f'readback catches each of {len(DRIFT)} single catalog drifts (each changed in a rolled-back transaction): ok | readback A after: ' + summary(back))
        psql(SUITE.read_text())
        LOG.append(f'{SUITE.name}: PASS (rolled back) | readback A: ' + summary(back))

        psql(TEARDOWN.read_text())
        LOG.append('teardown on empty table: ok | preflight A: ' + summary(pre) + ' | B: ' + rows(query(pre, 'B'))[0][1] + ' A02 rows')
        psql(app.read_text())
        LOG.append('re-apply: ok | readback A: ' + summary(back))

        fixture = SUITE.read_text()
        fixture = fixture[:fixture.index('set local role authenticated;')]
        psql(fixture + """set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',md5('a02-staff')::uuid::text,true);
select create_purchase_correction_request('purchase_order',md5('a02-po')::uuid,'owner-pkg-0001','Rincian sebelum dibekukan');
commit;""")
        as_user = "set role authenticated; set request.jwt.claim.role='authenticated'; select set_config('request.jwt.claim.sub',md5('{}')::uuid::text,false);\n"
        psql(FREEZE.read_text())
        frozen = failed_checks(query(back, 'A'))
        assert frozen == FREEZE_READBACK, frozen
        LOG.append('readback A after freeze fails exactly the expected rows: ' + '; '.join(frozen))
        err_create = expect_error(as_user.format('a02-staff') + "select create_purchase_correction_request('purchase_order',md5('a02-po')::uuid,'owner-pkg-0002','Rincian setelah dibekukan');", 'permission denied')
        err_process = expect_error(as_user.format('a02-owner') + f"select process_purchase_correction_request((select id from public.{NAME} limit 1),'Setelah dibekukan');", 'permission denied')
        readable = rows(as_user.format('a02-staff') + f'select count(*) from public.{NAME};')[-1][0]
        owner_reads = rows(as_user.format('a02-owner') + f"select count(*) from public.{NAME} where status = 'pending';")[-1][0]
        assert readable == '1' and owner_reads == '1', (readable, owner_reads)
        LOG.append(f'freeze: create refused ({err_create}); process refused ({err_process}); requester still reads {readable} row, Super Admin {owner_reads} pending')

        before = rows(f'select count(*) from public.{NAME}')[0][0]
        err = expect_error(TEARDOWN.read_text(), 'teardown refused')
        after = rows(f"select count(*), to_regprocedure('public.create_purchase_correction_request(text,uuid,text,text)') is not null from public.{NAME}")[0]
        history = rows(f"select count(*) from supabase_migrations.schema_migrations where version = '{VERSION}'")[0][0]
        assert after == [before, 't'] and history == '1', (before, after, history)
        LOG.append(f'teardown with data: refused ({err}); rows {before} -> {after[0]}, objects and history row kept')
        psql(f'delete from public.{NAME};')  # an administrator removing rows by hand still leaves audit history
        err = expect_error(TEARDOWN.read_text(), 'teardown refused')
        kept = rows(f"select count(*) from public.activity_log where row_entity = '{NAME}'")[0][0]
        assert rows(f"select {TABLE} is not null")[0][0] == 't' and int(kept) > 0, kept
        LOG.append(f'teardown after rows were deleted by hand: refused ({err}); {kept} audit rows and all objects kept')
        LOG.append('RESULT: PASS')
    finally:
        if (DATA / 'postmaster.pid').exists():
            subprocess.run([*AS_SERVER, SBIN / 'pg_ctl', '-D', DATA, '-m', 'immediate', 'stop'], capture_output=True, env=ENV)
        shutil.rmtree(WORK, ignore_errors=True)
        LOG.append('cleanup: temp cluster removed' if not WORK.exists() else f'cleanup FAILED: {WORK}')
        (HERE / f'rehearsal-{args.label}.log').write_text('\n'.join(LOG) + '\n')
        print('\n'.join(LOG))


if __name__ == '__main__':
    sys.dont_write_bytecode = True
    main()
