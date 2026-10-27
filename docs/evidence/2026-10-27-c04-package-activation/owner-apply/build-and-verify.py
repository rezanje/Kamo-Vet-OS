#!/usr/bin/env python3
"""C04 owner package: (re)generate the read-only preflight/readback SQL, the apply SQL and the rollback SQL
from the migration's own anchor list, derive the expected fingerprints from a throwaway native PostgreSQL
cluster, then rehearse with fictional data only:

  before-tests -> preflight -> apply -> readback -> after-tests -> rollback refused (package promo exists)
  -> rollback -> preflight -> before-tests -> re-apply -> readback -> after-tests

Never accepts a database URL. The cluster lives in a fresh temp dir, unix socket only, and is deleted.
Usage (repo root):
  python3 docs/evidence/2026-10-27-c04-package-activation/owner-apply/build-and-verify.py [pg bin dir]
Default bin dir: /usr/lib/postgresql/16/bin. Production runs PostgreSQL 17.6; rehearse with a 17 bin dir too.
The bin dir needs initdb, pg_ctl, postgres and psql (a symlinked psql from another major works); set
LD_LIBRARY_PATH when the server binaries ship their own libraries (e.g. @embedded-postgres/linux-x64).
When run as root, the cluster runs as the local `postgres` OS user.
"""
from pathlib import Path
import hashlib
import importlib.util
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
VERSION, NAME = '20261026002100', 'promo_package_total_mode'
MIG = ROOT / f'supabase/migrations/{VERSION}_{NAME}.sql'
BIN = Path(sys.argv[1] if len(sys.argv) > 1 else '/usr/lib/postgresql/16/bin')
EDITOR = 'public.edit_promo(uuid,text,jsonb,uuid[])'
GUARD = 'public.assert_active_package_promo_target()'
TRIGGERS = ('promo_package_target_header_guard', 'promo_package_target_items_guard')

source = MIG.read_text()
texts = dict((m[0], m[2]) for m in re.findall(r" ((?:old|new)_\w+) text:=\$(old|new)\$(.*?)\$\2\$;", source, re.S))
ORDER = ['fields', 'record', 'targets', 'rule']  # the migration's replace() order
PATCHES = [(texts['old_' + k], texts['new_' + k]) for k in ORDER]
assert len(texts) == 8 and all('$a$' not in t for t in texts.values()), sorted(texts)

WORK = Path(tempfile.mkdtemp(prefix='c04o-', dir='/tmp'))
DATA, SOCK, PORT = WORK / 'data', WORK / 's', '54332'
AS_PG = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
ENV = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
ENV.update(PSQLRC='/dev/null', TZ='Etc/UTC')
LOG = []
MAJOR = ['unknown']


def log(line):
    print(line, flush=True)
    LOG.append(line)


def psql(sql, check=True):
    r = subprocess.run([str(BIN / 'psql'), '-X', '-h', str(SOCK), '-p', PORT, '-U', 'postgres', '-d', 'postgres',
                        '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|'], input=sql, text=True, capture_output=True, env=ENV)
    if check and r.returncode:
        raise RuntimeError(r.stderr)
    return r


def one(sql):
    return psql(sql).stdout.strip()


def dq(text):
    return '$a$' + text + '$a$'


def patch_values(new_first=False):
    return ',\n  '.join(f"({i}, {dq(new if new_first else old)}, {dq(old if new_first else new)})"
                        for i, (old, new) in enumerate(PATCHES, 1))


SUMMARY = """
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

COMMON = f"""  select 'info: server version', null, current_setting('server_version')
  union all select 'info: database', null, current_database()
  union all select 'prerequisite: {EDITOR} exists', 'true', (to_regprocedure('{EDITOR}') is not null)::text
  union all select 'editor security definer', 'true', (select prosecdef::text from pg_proc where oid = to_regprocedure('{EDITOR}'))
  union all select 'editor search_path empty', 'true', (select coalesce(proconfig @> array['search_path=""']::text[], false)::text from pg_proc where oid = to_regprocedure('{EDITOR}'))
  union all select 'editor grant: anon', 'false', has_function_privilege('anon', '{EDITOR}', 'EXECUTE')::text
  union all select 'editor grant: service_role', 'false', has_function_privilege('service_role', '{EDITOR}', 'EXECUTE')::text
  union all select 'owner of editor (SQL Editor applies as postgres)', 'postgres', (select pg_get_userbyid(proowner) from pg_proc where oid = to_regprocedure('{EDITOR}'))
  union all select 'owner of ' || t, 'postgres', (select pg_get_userbyid(relowner) from pg_class where oid = to_regclass(t)) from unnest(array['public.promos', 'public.promo_items']) t
  union all select 'info: transactions open > 1 minute', null, (select count(*) from pg_stat_activity where state <> 'idle' and xact_start < now() - interval '1 minute')::text
  union all select 'editor grant: authenticated', 'true', has_function_privilege('authenticated', '{EDITOR}', 'EXECUTE')::text
  union all select 'prerequisite: promo_configuration_guard triggers', '2', (select count(*) from pg_trigger where tgname = 'promo_configuration_guard' and tgrelid in ('public.promos'::regclass, 'public.promo_items'::regclass))::text
  union all select 'info: promos total', null, (select count(*) from public.promos)::text
  union all select 'info: active promos', null, (select count(*) from public.promos where is_active)::text"""


def render(pre, post_editor, post_guard):
    preflight = f"""-- C04 PREFLIGHT — READ ONLY. Generated by build-and-verify.py; do not edit by hand.
-- Run each query on its own (select the query text, then Run). Nothing here writes.

-- QUERY A — readiness. Every row with an expected value must show ok = true; last row SUMMARY must say "0 failed".
with patches(n, old_text, new_text) as (values
  {patch_values()}
), anchors as (
  select n, old_text, new_text, pg_get_functiondef(to_regprocedure('{EDITOR}')) as def from patches
), checks(check_name, expected, actual) as (
{COMMON}
  union all select 'not yet applied: constraint promos_discount_mode_valid', '0', (select count(*) from pg_constraint where conname = 'promos_discount_mode_valid')::text
  union all select 'not yet applied: {GUARD} absent', 'true', (to_regprocedure('{GUARD}') is null)::text
  union all select 'not yet applied: C04 triggers', '0', (select count(*) from pg_trigger where tgname in {TRIGGERS})::text
  union all select 'fingerprint (same as repository): {EDITOR}', '{pre}', (select md5(prosrc) from pg_proc where oid = to_regprocedure('{EDITOR}'))
  union all select 'anchor ' || n || ' found exactly once', '1', ((length(def) - length(replace(def, old_text, ''))) / length(old_text))::text from anchors
  union all select 'data: promos already storing discount_mode (app flag is off, expect none)', '0', (select count(*) from public.promos where rule ? 'discount_mode')::text{SUMMARY}
-- QUERY B — migration history. Expect NO row {VERSION}. Note the newest rows (C04 is older than several
-- applied versions, so it is applied out of order on purpose). If the table does not exist, tell the developer.
select version, name from supabase_migrations.schema_migrations
where version >= '20261025' or version = '{VERSION}' order by version desc;

-- QUERY C — keep a copy of the editor definition before C04 (export as CSV next to the backup note).
-- Only needed for the fallback rollback path.
select '{EDITOR}' as sig, pg_get_functiondef(to_regprocedure('{EDITOR}')) as definition_before_c04;
"""
    readback = f"""-- C04 READBACK — READ ONLY. Generated by build-and-verify.py; do not edit by hand.
-- Run right after the apply step, each query on its own.

-- QUERY A — the migration is fully in place. Every row with an expected value must show ok = true;
-- last row SUMMARY must say "0 failed". "data: package promos" is 0 until the app flag is turned on.
with patches(n, old_text, new_text) as (values
  {patch_values()}
), anchors as (
  select n, old_text, new_text, pg_get_functiondef(to_regprocedure('{EDITOR}')) as def from patches
), checks(check_name, expected, actual) as (
{COMMON}
  union all select 'applied: constraint promos_discount_mode_valid (not validated)', 'false', (select string_agg(convalidated::text, ',') from pg_constraint where conname = 'promos_discount_mode_valid' and conrelid = 'public.promos'::regclass)
  union all select 'applied: {GUARD} present', 'true', (to_regprocedure('{GUARD}') is not null)::text
  union all select 'guard security definer', 'true', (select prosecdef::text from pg_proc where oid = to_regprocedure('{GUARD}'))
  union all select 'guard search_path empty', 'true', (select coalesce(proconfig @> array['search_path=""']::text[], false)::text from pg_proc where oid = to_regprocedure('{GUARD}'))
  union all select 'guard grant: ' || r, 'false', case when to_regprocedure('{GUARD}') is not null then has_function_privilege(r, '{GUARD}', 'EXECUTE')::text end from unnest(array['anon', 'authenticated', 'service_role']) r
  union all select 'applied: C04 triggers enabled, deferrable, initially deferred', '2', (select count(*) from pg_trigger where tgname in {TRIGGERS} and tgenabled = 'O' and tgdeferrable and tginitdeferred)::text
  union all select 'fingerprint (same as tested): {EDITOR}', '{post_editor}', (select md5(prosrc) from pg_proc where oid = to_regprocedure('{EDITOR}'))
  union all select 'fingerprint (same as tested): {GUARD}', '{post_guard}', (select md5(prosrc) from pg_proc where oid = to_regprocedure('{GUARD}'))
  union all select 'patch ' || n || ' present exactly once', '1', ((length(def) - length(replace(def, new_text, ''))) / length(new_text))::text from anchors
  union all select 'data: package promos', null, (select count(*) from public.promos where rule->>'discount_mode' = 'package_total')::text{SUMMARY}
-- QUERY B — history: exactly one row {VERSION} {NAME}.
select version, name from supabase_migrations.schema_migrations where version = '{VERSION}';
"""
    apply = (f"-- C04 APPLY — WRITES. One transaction: the exact migration plus its history row.\n"
             f"-- Run only after a passing preflight, a recorded backup and the release slot from the coordinator.\n"
             f"-- lock_timeout: if a long transaction holds promos, give up (nothing changes) instead of queueing checkout reads.\n"
             f"begin;\nset local lock_timeout = '5s';\n{source.rstrip()}\n"
             f"insert into supabase_migrations.schema_migrations(version, name) values ('{VERSION}', '{NAME}');\n"
             f"commit;\n")
    rollback = f"""-- C04 ROLLBACK — WRITES. Generated by build-and-verify.py; do not edit by hand.
-- Run only on an explicit rollback decision, after setting PROMO_PACKAGE_TOTAL_ENABLED off and redeploying.
-- One transaction. Refuses while any promo stores discount_mode (a package promo was created).
begin;
do $rb$
declare
  editor_oid oid := to_regprocedure('{EDITOR}');
  definition text;
  patch record;
  stored integer;
begin
  select count(*) into stored from public.promos where rule ? 'discount_mode';
  if stored > 0 then
    raise exception 'C04_ROLLBACK_REFUSED: % promo(s) store discount_mode; decide those promos first', stored;
  end if;
  drop trigger if exists promo_package_target_header_guard on public.promos;
  drop trigger if exists promo_package_target_items_guard on public.promo_items;
  drop function if exists {GUARD};
  alter table public.promos drop constraint if exists promos_discount_mode_valid;
  definition := pg_get_functiondef(editor_oid);
  for patch in select * from (values
  {patch_values(new_first=True)}
  ) p(n, new_text, old_text) order by n desc loop
    if (length(definition) - length(replace(definition, patch.new_text, ''))) / length(patch.new_text) <> 1 then
      raise exception 'C04_ROLLBACK_DRIFT: patch % not found exactly once', patch.n;
    end if;
    definition := replace(definition, patch.new_text, patch.old_text);
  end loop;
  execute definition;
  if (select md5(prosrc) from pg_proc where oid = editor_oid) <> '{pre}' then
    raise exception 'C04_ROLLBACK_FINGERPRINT: editor did not return to the pre-C04 body';
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version = '{VERSION}';
  end if;
end $rb$;
commit;
"""
    installed = f"""  if to_regprocedure('{GUARD}') is null
     or (select md5(prosrc) from pg_proc where oid = to_regprocedure('{GUARD}')) is distinct from '{post_guard}'
     or (select md5(prosrc) from pg_proc where oid = to_regprocedure('{EDITOR}')) is distinct from '{post_editor}'
     or (select count(*) from pg_trigger where tgname in {TRIGGERS} and tgenabled = 'O') <> 2 then
    raise exception 'C04_INSTALL_DRIFT: C04 objects differ from the tested build; stop and send this to the developer';
  end if;"""
    fingerprint = "md5((to_jsonb(p) - 'is_active')::text)"
    targets = ("coalesce((select string_agg(i.item_id::text, ',' order by i.item_id) from public.promo_items i "
               "where i.promo_id = p.id), '')")
    contain = f"""-- C04 CONTAINMENT — WRITES. Generated by build-and-verify.py; do not edit by hand.
-- Incident use only, on the coordinator's decision, after PROMO_PACKAGE_TOTAL_ENABLED is off and redeployed
-- (that stops new package promos; this stops existing ones from pricing). One transaction, safe to re-run.
-- Only flips is_active to false on ACTIVE package-total promos and records each one's fingerprint for 07.
-- Never touches sales, receipts, stock, journals, legacy promos or any other promo field; restores nothing.
-- Stops (nothing changes) if the installed C04 objects differ from the tested build.
begin;
set local lock_timeout = '5s';
do $contain$
begin
{installed}
  create schema if not exists ops_c04;
  revoke all on schema ops_c04 from public, anon, authenticated, service_role;
  create table if not exists ops_c04.frozen_package_promos (
    promo_id uuid primary key,
    frozen_at timestamptz not null default now(),
    row_fingerprint text not null,
    targets text not null,
    thawed_at timestamptz,
    resolution text
  );
  revoke all on table ops_c04.frozen_package_promos from public, anon, authenticated, service_role;
  perform 1 from public.promos where rule->>'discount_mode' = 'package_total' and is_active order by id for update;
  insert into ops_c04.frozen_package_promos as f (promo_id, row_fingerprint, targets)
  select p.id, {fingerprint}, {targets}
  from public.promos p where p.rule->>'discount_mode' = 'package_total' and p.is_active
  on conflict (promo_id) do update set frozen_at = now(), row_fingerprint = excluded.row_fingerprint,
    targets = excluded.targets, thawed_at = null, resolution = null;
  update public.promos set is_active = false
  where rule->>'discount_mode' = 'package_total' and is_active;
end $contain$;
-- Result: frozen promos still waiting for a decision (ids stay in this SQL Editor session only).
select promo_id, frozen_at from ops_c04.frozen_package_promos where thawed_at is null order by promo_id;
commit;
"""
    thaw = f"""-- C04 THAW — WRITES. Generated by build-and-verify.py; do not edit by hand.
-- Reverses 06 only for promos that nobody changed since they were frozen. One transaction.
-- If any frozen promo was edited, retargeted, deleted or re-activated since 06 (for example a manager's forward
-- repair), NOTHING is re-activated: the error lists them. Record the decision for each listed promo, then re-run:
--   update ops_c04.frozen_package_promos set thawed_at = now(), resolution = '<decision>' where promo_id = '<id>';
-- Re-activation still passes the C04 target guard and the checkout FIFO floor; sales are never touched.
begin;
set local lock_timeout = '5s';
do $thaw$
declare drifted text;
begin
{installed}
  if to_regclass('ops_c04.frozen_package_promos') is null then
    raise exception 'C04_THAW_NOTHING_FROZEN';
  end if;
  perform 1 from public.promos where id in (select promo_id from ops_c04.frozen_package_promos where thawed_at is null)
  order by id for update;
  select string_agg(f.promo_id::text, ', ' order by f.promo_id) into drifted
  from ops_c04.frozen_package_promos f left join public.promos p on p.id = f.promo_id
  where f.thawed_at is null
    and (p.id is null or p.is_active or {fingerprint} is distinct from f.row_fingerprint
         or {targets} is distinct from f.targets);
  if drifted is not null then
    raise exception 'C04_THAW_DRIFT: changed since freeze, decide each one first: %', drifted;
  end if;
  update public.promos set is_active = true
  where id in (select promo_id from ops_c04.frozen_package_promos where thawed_at is null);
  update ops_c04.frozen_package_promos set thawed_at = now(), resolution = 'thawed unchanged' where thawed_at is null;
end $thaw$;
commit;
"""
    files = {'01-preflight-readonly.sql': preflight, '02-apply-writes.sql': apply,
             '03-readback-readonly.sql': readback, '04-rollback-only-if-decided.sql': rollback,
             '06-contain-package-promos-writes.sql': contain, '07-thaw-unchanged-package-promos-writes.sql': thaw}
    for name, text in files.items():
        (HERE / name).write_text(text)
    return files


def summary(sql_text, label, expect_ok=True):
    out = psql(sql_text.split('-- QUERY B')[0]).stdout
    row = [line for line in out.splitlines() if line.startswith('SUMMARY|')][0]
    failed = [line for line in out.splitlines() if line.endswith('|f')]
    log(f'{label}: {row}' + (f'  failing: {failed}' if failed else ''))
    assert row.endswith('|t') == expect_ok, out
    return out


FIXTURE_PREFIX = None


def suite(names, label):
    global FIXTURE_PREFIX
    if FIXTURE_PREFIX is None:
        FIXTURE_PREFIX = (ROOT / 'supabase/tests/pos_split_payments.sql').read_text().split('set local role authenticated;')[0]
    for name in names:
        text = (ROOT / 'supabase/tests' / name).read_text()
        psql((FIXTURE_PREFIX + text) if name.startswith('promo_edit') or name.startswith('promo_package') else text)
    log(f'{label}: PASS ' + ', '.join(names))


LEGACY = """{prefix}set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{{"role":"authenticated"}}',true);
do $$declare id uuid:=md5('c04-package')::uuid; v text; snap jsonb; rejected boolean:=false;begin
 v:=read_promo_edit(id)->>'version';
 -- exactly what the live app sends for a legacy promo (no discount_mode key)
 snap:=edit_promo(id,v,pg_temp.package_payload('per_unit')-'discount_mode',array['e5500000-0000-4000-8000-000000000001']::uuid[]);
 if snap->'promo'->'rule' ? 'discount_mode' then raise exception 'legacy edit stored a mode';end if;
 begin
  perform edit_promo(id,snap->>'version',pg_temp.package_payload('package_total'),array['e5500000-0000-4000-8000-000000000001']::uuid[]);
 exception when others then rejected:=true;end;
 if {expect_reject} and not rejected then raise exception 'package payload accepted before C04';end if;
 if not {expect_reject} and rejected then raise exception 'package payload refused after C04';end if;
end$$;rollback;"""


def legacy_check(expect_reject, label):
    body = (ROOT / 'supabase/tests/promo_package_total.sql').read_text().split('set local role authenticated;')[0]
    psql(LEGACY.format(prefix=FIXTURE_PREFIX + body, expect_reject=str(expect_reject).lower()))
    log(f'{label}: PASS live-app legacy edit payload accepted; package payload '
        + ('refused (editor without C04)' if expect_reject else 'accepted'))


def guard_check(label):
    r = psql("""begin;
insert into promos(id,name,promo_type,rule,discount_type,discount_value,min_qty,is_active)
values('e9900000-0000-4000-8000-0000000000c4','Fiction guard','diskon_produk','{"suggest":"Fiction","discount_mode":"package_total"}','nominal',10000,5,true);
commit;""", check=False)
    assert r.returncode and 'C04_PACKAGE_TARGET_INCOMPLETE' in r.stderr, r.stderr
    log(f'{label}: PASS active package promo without its one target refused at commit (C04_PACKAGE_TARGET_INCOMPLETE)')


def main():
    spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
    fx = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fx)
    staged = WORK / 'repo'
    (staged / 'supabase/migrations').mkdir(parents=True)
    for m in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if m.name != MIG.name:
            os.symlink(m, staged / 'supabase/migrations' / m.name)
    os.chmod(WORK, 0o755)
    for path in (SOCK, DATA):
        path.mkdir()
        if AS_PG:
            shutil.chown(path, 'postgres')
    subprocess.run(AS_PG + [str(BIN / 'initdb'), '-D', str(DATA), '-U', 'postgres', '-A', 'trust'], check=True, capture_output=True)
    subprocess.run(AS_PG + [str(BIN / 'pg_ctl'), '-D', str(DATA), '-l', str(DATA / 'server.log'), '-o',
                            f"-p {PORT} -k {SOCK} -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)
    try:
        class Local(fx.DisposablePostgres):
            def sql(self, text):
                return one(text)
        fx.ROOT = staged
        Local().bootstrap()
        fx.ROOT = ROOT
        versions = sorted({m.name.split('_', 1)[0]: m.name.split('_', 1)[1][:-4] for m in (staged / 'supabase/migrations').iterdir()}.items())
        psql('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);'
             + ''.join(f"insert into supabase_migrations.schema_migrations(version,name) values('{v}','{n}');" for v, n in versions))
        MAJOR[0] = one('show server_version_num')[:2]
        log(f'PostgreSQL {one("show server_version")}: {len(versions)} history versions applied, everything on main except {VERSION} (production-like).')
        pre = one(f"select md5(prosrc) from pg_proc where oid=to_regprocedure('{EDITOR}')")
        # Derive post-apply fingerprints, then return to the pre-C04 state with the generated rollback.
        psql(f'begin;\n{source}\ncommit;')
        post_editor = one(f"select md5(prosrc) from pg_proc where oid=to_regprocedure('{EDITOR}')")
        post_guard = one(f"select md5(prosrc) from pg_proc where oid=to_regprocedure('{GUARD}')")
        files = render(pre, post_editor, post_guard)
        psql(files['04-rollback-only-if-decided.sql'])
        log(f'fingerprints: editor before {pre}, after {post_editor}; guard {post_guard}')

        suite(['promo_edit.sql', 'promo_excel_batch.sql', 'pos_split_payments.sql', 'clinic_billing_lifecycle.sql'], 'before-tests')
        legacy_check(True, 'before-tests')
        summary(files['01-preflight-readonly.sql'], 'preflight')
        summary(files['03-readback-readonly.sql'], 'readback before apply (must fail)', expect_ok=False)
        psql(files['02-apply-writes.sql'])
        log('apply: committed (migration + history row)')
        summary(files['03-readback-readonly.sql'], 'readback')
        summary(files['01-preflight-readonly.sql'], 'preflight after apply (must fail)', expect_ok=False)
        assert one(f"select count(*) from supabase_migrations.schema_migrations where version='{VERSION}'") == '1'
        suite(['promo_edit.sql', 'promo_package_total.sql', 'promo_excel_batch.sql', 'pos_split_payments.sql', 'clinic_billing_lifecycle.sql'], 'after-tests')
        legacy_check(False, 'after-tests')
        guard_check('after-tests')
        r = psql(files['02-apply-writes.sql'], check=False)
        assert r.returncode and 'already exists' in r.stderr, r.stderr
        log('second apply: refused, nothing changed')

        psql("""insert into promos(id,name,promo_type,rule,discount_type,discount_value,min_qty,is_active)
values('e9900000-0000-4000-8000-0000000000c5','Fiction rollback blocker','diskon_produk','{"suggest":"Fiction","discount_mode":"package_total"}','nominal',10000,5,false);""")
        r = psql(files['04-rollback-only-if-decided.sql'], check=False)
        assert r.returncode and 'C04_ROLLBACK_REFUSED' in r.stderr, r.stderr
        summary(files['03-readback-readonly.sql'], 'rollback refused while a package promo exists; readback still')
        psql("delete from promos where id='e9900000-0000-4000-8000-0000000000c5';")
        psql(files['04-rollback-only-if-decided.sql'])
        log('rollback: committed')
        summary(files['01-preflight-readonly.sql'], 'preflight after rollback')
        assert one(f"select count(*) from supabase_migrations.schema_migrations where version='{VERSION}'") == '0'
        suite(['promo_edit.sql', 'promo_excel_batch.sql', 'pos_split_payments.sql', 'clinic_billing_lifecycle.sql'], 'after-rollback tests')
        legacy_check(True, 'after-rollback tests')

        psql(files['02-apply-writes.sql'])
        summary(files['03-readback-readonly.sql'], 're-apply readback')
        suite(['promo_package_total.sql', 'promo_edit.sql'], 're-apply tests')
        guard_check('re-apply tests')
        log('sha256: ' + ', '.join(f'{n} {hashlib.sha256((HERE / n).read_bytes()).hexdigest()}' for n in sorted(files))
            + f', migration {hashlib.sha256(MIG.read_bytes()).hexdigest()}')
        log('RESULT: all rehearsal steps passed')
    finally:
        subprocess.run(AS_PG + [str(BIN / 'pg_ctl'), '-D', str(DATA), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(WORK, ignore_errors=True)
        (HERE / f'rehearsal-pg{MAJOR[0]}.log').write_text('\n'.join(LOG) + '\n')


if __name__ == '__main__':
    main()
