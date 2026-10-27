#!/usr/bin/env python3
"""R05 preset guard activation package: generate the four SQL files and rehearse them.

Generates, from the migration in the repository (single source for the anchors) and from the
function fingerprints measured on a throwaway cluster of the given PostgreSQL version:
  01-preflight-readonly.sql   02-apply.sql   03-readback-readonly.sql   04-rollback-only-if-decided.sql
then rehearses: preflight → apply → readback → presets saved/edited after release → refused re-apply →
rollback (rows preserved) → old guard behaviour → re-apply → drifted target refused.
Fictional fixtures only; no DB URL, no network.

Usage: python3 docs/runbooks/r05-preset-guard-activation/build-and-verify.py BIN_DIR [--write]
  BIN_DIR: PostgreSQL bin dir (target is 17.6). Without --write the generated files must match the
  committed ones exactly (exit 1 otherwise).
"""
import hashlib
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

VERSION, NAME = "20261027090000", "private_report_promo_history_presets"
MIGRATION = ROOT / "supabase/migrations" / f"{VERSION}_{NAME}.sql"
PRIOR = [
    ("20261023154500", "private_report_presets"),
    ("20261025110800", "private_report_branch_filter"),
    ("20261025173500", "private_report_opname_preset"),
    ("20261026000345", "private_report_sales_performer_filter"),
]
GUARD = "public.guard_private_report_preset()"
A, B = "fa100000-0000-4000-8000-000000000001", "fa100000-0000-4000-8000-000000000002"

migration_text = MIGRATION.read_text()
anchor = {name: re.search(pattern, migration_text, re.S).group(1) for name, pattern in {
    "old_path": r" old_path text := '([^']*)';", "new_path": r" new_path text := '([^']*)';",
    "old_filter": r"old_filter text := \$old\$(.*?)\$old\$;", "new_filter": r"new_filter text := \$new\$(.*?)\$new\$;"}.items()}


def lit(text):
    assert "$r05$" not in text
    return f"$r05${text}$r05$"


BOOTSTRAP = f"""
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
create table public.profiles(id uuid primary key, role text not null, is_active boolean not null);
create table public.role_modules(role text not null, module_id text not null);
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
grant select on public.profiles,public.role_modules to authenticated;
insert into public.profiles values ('{A}','FINANCE',true),('{B}','OWNER',true);
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
"""


def prior_state(db):
    db.sql(BOOTSTRAP)
    for version, name in PRIOR:
        db.sql(f"begin;\n{(ROOT / 'supabase/migrations' / f'{version}_{name}.sql').read_text()}\n"
               f"insert into supabase_migrations.schema_migrations(version,name) values('{version}','{name}');\ncommit;")


def fingerprint(db):
    return db.last(f"select md5(pg_get_functiondef('{GUARD}'::regprocedure));")


FN = f"to_regprocedure('{GUARD}')"


def common_checks():
    return f"""  ('guard function present', 'true', ({FN} is not null)::text),
  ('guard is not security definer', 'false', coalesce((select prosecdef::text from pg_proc where oid={FN}),'missing')),
  ('guard search_path is empty', 'true', coalesce((select (proconfig @> array['search_path=""'])::text from pg_proc where oid={FN}),'missing')),
  ('trigger private_report_preset_guard enabled on the guard', '1', (select count(*)::text from pg_trigger t
     where t.tgrelid='public.private_report_presets'::regclass and t.tgname='private_report_preset_guard'
       and t.tgfoid={FN} and not t.tgisinternal and t.tgenabled='O')),
  ('no EXECUTE on guard for anon/authenticated/service_role', 'false', coalesce((has_function_privilege('anon',{FN},'EXECUTE')
     or has_function_privilege('authenticated',{FN},'EXECUTE') or has_function_privilege('service_role',{FN},'EXECUTE'))::text,'missing')),
  ('RLS enabled and forced on private_report_presets', 'true', (select (relrowsecurity and relforcerowsecurity)::text from pg_class where oid='public.private_report_presets'::regclass)),
  ('policies on private_report_presets', 'private_report_presets_owner', (select string_agg(polname,',' order by polname) from pg_policy where polrelid='public.private_report_presets'::regclass)),
  ('info: current role can count all presets (bypasses RLS)', '', (select (rolsuper or rolbypassrls)::text from pg_roles where rolname=current_user)),
  ('info: saved presets (count only)', '', (select count(*)::text from public.private_report_presets)),
  ('info: presets using promo_id or the historical report (0 before first activation)', '', (select count(*)::text from public.private_report_presets
     where href ~ '^/laporan/nilai-persediaan/historis([?]|$)' or (href ~ '^/laporan/promo([?]|$)' and href ~ '[?&]promo_id='))),"""


def report(title, rows):
    return f"""-- {title}
-- Generated by build-and-verify.py from {MIGRATION.relative_to(ROOT)}; do not edit by hand.
-- Read only: runs inside a read-only transaction and ends with rollback. Prints counts only, no preset content.
-- Every row with an expected value must show ok = true; the last row SUMMARY must say "0 failed".
begin read only;
with checks(check_name, expected, actual) as (values
  ('info: server version', '', current_setting('server_version')),
{rows}
)
select check_name, expected, coalesce(actual,'missing') as actual, case when expected = '' then null else expected = coalesce(actual,'missing') end as ok from checks
union all
select 'SUMMARY', '0 failed', count(*) filter (where expected <> '' and expected is distinct from coalesce(actual,'missing')) || ' failed', null from checks;
rollback;
"""


def history(version):
    return f"(select count(*)::text from supabase_migrations.schema_migrations where version='{version}')"


def preflight(pre, post):
    occurrences = lambda key: f"((length(d) - length(replace(d, {lit(anchor[key])}, ''))) / length({lit(anchor[key])}))::text"
    rows = f"""  ('history: prerequisite {PRIOR[-1][0]} recorded', '1', {history(PRIOR[-1][0])}),
  ('history: {VERSION} not yet recorded', '0', {history(VERSION)}),
{common_checks()}
  ('guard fingerprint = repository pre-image', '{pre}', (select md5(pg_get_functiondef({FN})))),
  ('anchor: path list occurs once', '1', (select {occurrences('old_path')} from (select pg_get_functiondef({FN}) d) x)),
  ('anchor: report-specific key clause occurs once', '1', (select {occurrences('old_filter')} from (select pg_get_functiondef({FN}) d) x)),
  ('dry run: patched fingerprint = repository post-image', '{post}', (select md5(replace(replace(d, {lit(anchor['old_path'])}, {lit(anchor['new_path'])}),
     {lit(anchor['old_filter'])}, {lit(anchor['new_filter'])})) from (select pg_get_functiondef({FN}) d) x))"""
    return report(f"R05 preset guard activation — 01 PREFLIGHT ({VERSION} {NAME})", rows)


def readback(post):
    rows = f"""  ('history: {VERSION} recorded once as {NAME}', '1', (select count(*)::text from supabase_migrations.schema_migrations where version='{VERSION}' and name='{NAME}')),
{common_checks()}
  ('guard fingerprint = repository post-image', '{post}', (select md5(pg_get_functiondef({FN})))),
  ('promo_id clause present once', '1', (select ((length(d) - length(replace(d, 'promo_id=', ''))) / 9)::text from (select pg_get_functiondef({FN}) d) x)),
  ('historical report path present', 'true', (select (strpos(pg_get_functiondef({FN}), 'nilai-persediaan/historis') > 0)::text))"""
    return report(f"R05 preset guard activation — 03 READBACK ({VERSION} {NAME})", rows)


def apply_sql(pre, post):
    sha = hashlib.sha256(migration_text.encode()).hexdigest()
    return f"""-- R05 preset guard activation — 02 APPLY ({VERSION} {NAME}), one transaction.
-- Generated by build-and-verify.py; the block between the markers is the migration file verbatim (sha256 {sha}).
-- Run only after 01 shows "0 failed". Any error aborts everything: nothing is half-applied.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$ begin
 if exists (select 1 from supabase_migrations.schema_migrations where version = '{VERSION}') then
  raise exception 'R05_ACTIVATION_ALREADY_RECORDED';
 end if;
 if md5(pg_get_functiondef('{GUARD}'::regprocedure)) <> '{pre}' then
  raise exception 'R05_ACTIVATION_PREIMAGE_MISMATCH';
 end if;
end $$;
-- >>> {MIGRATION.relative_to(ROOT)}
{migration_text.rstrip()}
-- <<< end of migration
do $$ begin
 if md5(pg_get_functiondef('{GUARD}'::regprocedure)) <> '{post}' then
  raise exception 'R05_ACTIVATION_POSTIMAGE_MISMATCH';
 end if;
end $$;
insert into supabase_migrations.schema_migrations(version, name) values ('{VERSION}', '{NAME}');
commit;
"""


def rollback_sql(pre, post):
    return f"""-- R05 preset guard activation — 04 ROLLBACK, ONLY IF DECIDED. One transaction.
-- Generated by build-and-verify.py. Restores the guard function to its exact pre-image (fingerprint {pre})
-- and removes the {VERSION} history row. No preset row is read, changed or deleted: presets saved or edited
-- after activation stay readable and openable; until re-activation, saving or editing one that uses promo_id
-- or the historical report is refused by the old guard (deleting it still works).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $do$
declare
 definition text := pg_get_functiondef('{GUARD}'::regprocedure);
begin
 if md5(definition) <> '{post}' then raise exception 'R05_ROLLBACK_STATE_MISMATCH'; end if;
 if not exists (select 1 from supabase_migrations.schema_migrations where version = '{VERSION}') then
  raise exception 'R05_ROLLBACK_NOT_RECORDED';
 end if;
 execute replace(replace(definition, {lit(anchor['new_path'])}, {lit(anchor['old_path'])}), {lit(anchor['new_filter'])}, {lit(anchor['old_filter'])});
 if md5(pg_get_functiondef('{GUARD}'::regprocedure)) <> '{pre}' then raise exception 'R05_ROLLBACK_PREIMAGE_MISMATCH'; end if;
end $do$;
delete from supabase_migrations.schema_migrations where version = '{VERSION}';
commit;
"""


def build(bin_dir):
    with NativePostgres(bin_dir) as db:
        prior_state(db)
        pre = fingerprint(db)
        db.sql(f"begin;\n{migration_text}\ncommit;")
        post = fingerprint(db)
        version = db.last("show server_version;")
    return version, {"01-preflight-readonly.sql": preflight(pre, post), "02-apply.sql": apply_sql(pre, post),
                     "03-readback-readonly.sql": readback(post), "04-rollback-only-if-decided.sql": rollback_sql(pre, post)}, pre, post


def as_user(user, statement):
    return (f"begin;\nset local role authenticated;\nselect set_config('request.jwt.claim.role','authenticated',true);\n"
            f"select set_config('request.jwt.claim.sub','{user}',true);\n{statement}\ncommit;")


def expect_error(db, sql, code):
    try:
        db.sql(sql)
    except RuntimeError as error:
        assert code in str(error), str(error)
        return
    raise AssertionError(f"expected {code}")


def summary(output):
    line = output.splitlines()[-1]
    assert line.startswith("SUMMARY|0 failed|0 failed"), output
    return output


def snapshot(db):
    return db.last("select count(*) || ':' || md5(string_agg(id::text||'|'||user_id||'|'||name||'|'||href||'|'||saved_at, ',' order by id)) from private_report_presets;")


def rehearse(bin_dir, files, log):
    run = lambda name: files[name]
    with NativePostgres(bin_dir) as db:
        prior_state(db)
        db.sql(as_user(A, "insert into private_report_presets(id,name,href) values"
                          "('fa200000-0000-4000-8000-000000000001','Before release','/laporan/promo?periode=2026-10&kolom=x');"))
        log(f"server {db.last('show server_version;')}; pre-release fixture: {snapshot(db)}")
        log("01 preflight:\n" + summary(db.sql(run("01-preflight-readonly.sql"))))
        expect_error(db, "begin read only;\ninsert into supabase_migrations.schema_migrations(version) values('x');\nrollback;", "read-only")
        db.sql(run("02-apply.sql"))
        log("02 apply: ok\n03 readback:\n" + summary(db.sql(run("03-readback-readonly.sql"))))
        # Users save and edit presets after release.
        db.sql(as_user(A, "insert into private_report_presets(id,name,href) values"
                          "('fa200000-0000-4000-8000-000000000002','Promo vaksin','/laporan/promo?dari=2026-10-01&promo_id=p2'),"
                          "('fa200000-0000-4000-8000-000000000003','Valuasi akhir','/laporan/nilai-persediaan/historis?tanggal=2026-10-22&cabang=b1');"
                          "update private_report_presets set href='/laporan/promo?periode=2026-11&promo_id=p1' where id='fa200000-0000-4000-8000-000000000001';"))
        db.sql(as_user(B, "insert into private_report_presets(id,name,href) values('fa200000-0000-4000-8000-000000000004','B own','/laporan/promo?promo_id=p9');"))
        after_release = snapshot(db)
        log(f"after release activity (A saved 2, edited 1; B saved 1): {after_release}")
        expect_error(db, run("02-apply.sql"), "R05_ACTIVATION_ALREADY_RECORDED")
        assert snapshot(db) == after_release
        log("02 apply again: refused R05_ACTIVATION_ALREADY_RECORDED, rows unchanged")
        db.sql(run("04-rollback-only-if-decided.sql"))
        assert snapshot(db) == after_release
        log(f"04 rollback: ok, rows identical {snapshot(db)}")
        log("01 preflight after rollback:\n" + summary(db.sql(run("01-preflight-readonly.sql"))))
        expect_error(db, as_user(A, "insert into private_report_presets(name,href) values('x','/laporan/promo?promo_id=p3');"), "PRIVATE_PRESET_INVALID")
        expect_error(db, as_user(A, "update private_report_presets set name='rename' where id='fa200000-0000-4000-8000-000000000002';"), "PRIVATE_PRESET_INVALID")
        assert db.last(as_user(A, "select count(*) from private_report_presets;")) == "3"
        log("after rollback: old guard refuses new promo_id saves and edits of post-release rows; A still reads its 3 rows")
        expect_error(db, run("04-rollback-only-if-decided.sql"), "R05_ROLLBACK_STATE_MISMATCH")
        db.sql(run("02-apply.sql"))
        log("02 re-apply: ok\n03 readback:\n" + summary(db.sql(run("03-readback-readonly.sql"))))
        assert snapshot(db) == after_release
        db.sql(as_user(A, "update private_report_presets set name='Promo vaksin (ubah)' where id='fa200000-0000-4000-8000-000000000002';"))
        log("after re-apply: rows identical before the edit; editing a post-release promo preset works again")
    with NativePostgres(bin_dir) as db:
        prior_state(db)
        db.sql(f"do $$ declare d text := pg_get_functiondef('{GUARD}'::regprocedure); begin execute replace(d, 'maksimal 50', 'maksimal 49'); end $$;")
        out = db.sql(run("01-preflight-readonly.sql"))
        assert out.splitlines()[-1].startswith("SUMMARY|0 failed|2 failed") and "guard fingerprint = repository pre-image" in out, out
        before = fingerprint(db)
        expect_error(db, run("02-apply.sql"), "R05_ACTIVATION_PREIMAGE_MISMATCH")
        assert fingerprint(db) == before and db.last(f"select count(*) from supabase_migrations.schema_migrations where version='{VERSION}';") == "0"
        log("drifted target: preflight reports 2 failed (pre-image and dry-run fingerprints); apply refused R05_ACTIVATION_PREIMAGE_MISMATCH; function and history untouched")


def main():
    bin_dir, write = sys.argv[1], "--write" in sys.argv
    version, files, pre, post = build(bin_dir)
    stale = [name for name, text in files.items() if not (HERE / name).exists() or (HERE / name).read_text() != text]
    if write:
        for name, text in files.items():
            (HERE / name).write_text(text)
    elif stale:
        sys.exit(f"Generated files differ from committed ones on PostgreSQL {version}: {stale}. Rerun with --write.")
    lines = []
    log = lambda line: (lines.append(line), print(line, flush=True))
    log(f"PostgreSQL {version}; guard pre-image md5 {pre}, post-image md5 {post}; migration sha256 {hashlib.sha256(migration_text.encode()).hexdigest()}")
    rehearse(bin_dir, files, log)
    log("REHEARSAL PASS")
    (HERE / f"rehearsal-pg{version.split()[0]}.log").write_text("\n".join(lines) + "\n")


main()
