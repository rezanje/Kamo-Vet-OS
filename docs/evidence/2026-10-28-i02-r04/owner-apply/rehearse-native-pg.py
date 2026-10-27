#!/usr/bin/env python3
"""Rehearse the I02 owner package on a throwaway native PostgreSQL (no Docker, no DB URL, fictional data).

Applies every repository migration EXCEPT 20261028150000 (the state production has before the owner step),
then preflight -> apply -> apply again -> readback -> rollback, asserting every check row is ok=true.
Usage: LC_ALL=en_US.UTF-8 python3 docs/evidence/2026-10-28-i02-r04/owner-apply/rehearse-native-pg.py [pg_bin]
"""
import importlib.util
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

BIN = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PG_BIN", "/opt/homebrew/opt/postgresql@16/bin"))
NEW = "20261028150000_i02_opname_uniform_variance.sql"


def checks(db, name):
    rows = [line.split("|") for line in db.sql((HERE / name).read_text()).splitlines() if line.count("|") == 1]
    bad = [label for label, ok in rows if ok not in ("t",) and not label.isdigit()]
    if bad:
        raise AssertionError(f"{name}: failed checks {bad}")
    print(f"PASS {name}: {len(rows)} rows", flush=True)


with NativePostgres(BIN) as db:
    db.sql("""create extension if not exists pgcrypto;
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create publication supabase_realtime;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;""")
    for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        if migration.name == NEW:
            continue
        if migration.name.startswith("0068"):
            db.sql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Fictional cash','ASET','D'),('1102','Fictional bank','ASET','D') on conflict do nothing;")
        db.sql("begin;\n" + migration.read_text() + "\ncommit;")
    db.sql("insert into coa_accounts(code,name,type,normal_balance) values('1301','Fictional inventory','ASET','D'),('5902','Fictional variance','BEBAN','D') on conflict(code) do update set is_active=true,is_header=false;")
    checks(db, "preflight.sql")
    db.sql((HERE / "apply.sql").read_text())
    db.sql((HERE / "apply.sql").read_text())
    print("PASS apply.sql twice (idempotent)", flush=True)
    checks(db, "readback.sql")
    db.sql((HERE / "rollback.sql").read_text())
    checks(db, "preflight.sql")
    print("PASS rollback.sql restores the pre-I02 definition", flush=True)
