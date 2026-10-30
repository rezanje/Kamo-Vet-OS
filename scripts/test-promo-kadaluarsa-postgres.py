#!/usr/bin/env python3
"""Promo/voucher kedaluwarsa: throwaway native PostgreSQL verification.

Never accepts a database URL and never touches Production. It boots a disposable
cluster on a unix socket, applies EVERY repository migration except this job's
one, records the anchors this job patches, then applies the new migration twice
(idempotency) and runs the behaviour suite under real `authenticated` sessions.

Usage: python3 scripts/test-promo-kadaluarsa-postgres.py [/path/to/pg/bin]
       PG_BIN=/path/to/pg/bin python3 scripts/test-promo-kadaluarsa-postgres.py
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.dont_write_bytecode = True
from native_postgres import NativePostgres  # noqa: E402

BIN = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PG_BIN", "/usr/lib/postgresql/17/bin"))
NEW = "20261104050000_promo_kadaluarsa_otomatis.sql"
SUITE = "promo_kadaluarsa.sql"

SHIM = """
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
""" + (ROOT / "supabase/tests/fixtures/hosted_auth_uid.sql").read_text() + """
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create publication supabase_realtime;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;
"""

# Exactly the text this job's migration patches into the running guard. If a
# later release edits guard_promo_configuration, this assertion is what tells us
# before the patch silently reverts it.
ANCHOR = (
    "begin\n if auth.uid() is not null or current_setting('role',true) "
    "in('authenticated','anon','service_role') then"
)


def main():
    with NativePostgres(BIN) as db:
        db.sql(SHIM)
        migrations = [m for m in sorted((ROOT / "supabase/migrations").glob("*.sql")) if m.name != NEW]
        for migration in migrations:
            if migration.name.startswith("0068"):
                db.sql("insert into coa_accounts(code,name,type,normal_balance) "
                       "values('1101','Test cash','ASET','D'),('1102','Test bank','ASET','D') on conflict do nothing")
            try:
                db.sql("begin;\n" + migration.read_text() + "\ncommit;")
            except RuntimeError as error:
                raise RuntimeError(migration.name + ": " + str(error)) from error
        print(f"Applied {len(migrations)} repository migrations (everything except {NEW}).", flush=True)

        baseline = db.sql("select pg_get_functiondef('public.guard_promo_configuration()'::regprocedure)")
        hits = baseline.count(ANCHOR)
        if hits != 1:
            raise RuntimeError(f"Anchor not found exactly once in the pre-migration guard ({hits} hits).")
        print("Anchor check: guard_promo_configuration carries the expected anchor exactly once.", flush=True)

        new_sql = (ROOT / "supabase/migrations" / NEW).read_text()
        db.sql("begin;\n" + new_sql + "\ncommit;")
        print("Applied the new migration.", flush=True)
        patched = db.sql("select pg_get_functiondef('public.guard_promo_configuration()'::regprocedure)")
        if "KADALUARSA_SWEEP" not in patched:
            raise RuntimeError("Guard was not patched.")
        # The anchor's own `begin` line now sits above the inserted branch, so only the
        # manager check itself is still expected verbatim — exactly once.
        manager_line = ("if auth.uid() is not null or current_setting('role',true) "
                        "in('authenticated','anon','service_role') then\n  perform public.assert_promo_manager();")
        if patched.count(manager_line) != 1:
            raise RuntimeError("Patch removed or duplicated the OWNER/ADMIN check.")
        db.sql("begin;\n" + new_sql + "\ncommit;")
        twice = db.sql("select pg_get_functiondef('public.guard_promo_configuration()'::regprocedure)")
        if twice != patched:
            raise RuntimeError("Re-applying the migration changed the guard again (not idempotent).")
        print("Re-applied the new migration: idempotent, guard unchanged.", flush=True)

        output = db.sql((ROOT / "supabase/tests" / SUITE).read_text())
        print(next(line for line in output.splitlines() if line.startswith("PROMO_NATIVE_ASSERTIONS=")), flush=True)
        print(f"{SUITE}: passed.", flush=True)

        # Touched-area regressions on the same cluster.
        tests = ROOT / "supabase/tests"
        prefix = (tests / "pos_split_payments.sql").read_text().split("set local role authenticated;")[0]
        db.sql(prefix + (tests / "promo_edit.sql").read_text())
        print("promo_edit.sql: passed.", flush=True)
        db.sql((tests / "c05_campaign_codes.sql").read_text())
        print("c05_campaign_codes.sql: passed.", flush=True)
        db.sql((tests / "promo_excel_batch.sql").read_text())
        print("promo_excel_batch.sql: passed.", flush=True)
        print("ALL PROMO KADALUARSA POSTGRES CHECKS PASSED", flush=True)


if __name__ == "__main__":
    main()
