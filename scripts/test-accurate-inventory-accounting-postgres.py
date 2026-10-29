#!/usr/bin/env python3
"""Run repository SQL tests in an owned, network-isolated PostgreSQL 16 container.

Requires Docker and a cached postgres:16 image (docker pull postgres:16).
No external database, Supabase credentials, published ports, or shared volume is
used. Test-only auth/storage shims permit applying the repository migrations.

Usage:
  python3 scripts/test-accurate-inventory-accounting-postgres.py
  python3 scripts/test-accurate-inventory-accounting-postgres.py some_test.sql
"""
from pathlib import Path
import argparse
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "postgres:16"
DOCKER = ["docker", "--host=unix:///var/run/docker.sock"]


def docker(*args, **kwargs):
    result = subprocess.run(DOCKER + list(args), text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr + result.stdout)
    return result


class DisposablePostgres:
    def __init__(self):
        self.container = "kamo-accurate-accounting-test-" + uuid.uuid4().hex
        self.started = False

    def __enter__(self):
        docker("run", "--pull=never", "--rm", "-d", "--name", self.container,
               "--label", "kamo-purpose=fictional-accurate-accounting-test",
               "--network", "none", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", IMAGE)
        self.started = True
        try:
            for _ in range(200):
                ready = subprocess.run(DOCKER + ["exec", self.container, "pg_isready", "-U", "postgres"], capture_output=True)
                logs = docker("logs", self.container)
                if ready.returncode == 0 and "PostgreSQL init process complete" in logs.stdout + logs.stderr:
                    return self
                time.sleep(0.1)
            raise RuntimeError("Owned PostgreSQL test container did not become ready")
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        if self.started:
            docker("rm", "-f", "-v", self.container)
            self.started = False
            print("Removed owned PostgreSQL test container and volumes.", flush=True)

    def command(self):
        return DOCKER + ["exec", "-i", self.container, "psql", "-X", "-qAt", "-U", "postgres", "-v", "ON_ERROR_STOP=1"]

    def sql(self, source):
        result = subprocess.run(self.command(), input=source, text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr + result.stdout)
        return result.stdout.strip()

    def bootstrap(self):
        self.sql("""create extension pgcrypto;
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
-- Same text as Supabase hosted auth.uid() (catalog read 2026-10-29); migrations may fingerprint it.
create function auth.uid() returns uuid language sql stable as $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create publication supabase_realtime;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;
""")
        migrations = sorted((ROOT / "supabase/migrations").glob("*.sql"))
        for migration in migrations:
            if migration.name.startswith("0068"):
                self.sql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Fictional test cash','ASET','D'),('1102','Fictional test bank','ASET','D') on conflict do nothing;")
            try:
                self.sql("begin;\n" + migration.read_text() + "\ncommit;")
            except RuntimeError as error:
                raise RuntimeError(migration.name + ": " + str(error)) from error
        print(f"Applied {len(migrations)} repository migrations to isolated PostgreSQL {self.sql('show server_version')} with fictional auth/storage shims.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tests", nargs="*", default=["accurate_inventory_accounting.sql", "accurate_inventory_accounting_guards.sql", "accurate_inventory_accounting_review.sql"], help="SQL filenames within supabase/tests")
    parser.add_argument("--compatibility-migration", action="append", type=Path, default=[], help="Additional reviewed SQL migration applied only to this disposable container")
    args = parser.parse_args()
    tests_root = ROOT / "supabase/tests"
    tests = []
    for name in args.tests:
        path = (tests_root / name).resolve()
        if path.parent != tests_root.resolve() or path.suffix != ".sql" or not path.is_file():
            parser.error(f"Expected an existing SQL file directly in supabase/tests: {name}")
        tests.append(path)
    with DisposablePostgres() as database:
        database.bootstrap()
        for migration in args.compatibility_migration:
            database.sql("begin;\n" + migration.read_text() + "\ncommit;")
            print("Compatibility migration applied: " + migration.name, flush=True)
        for test in tests:
            try:
                database.sql(test.read_text())
            except RuntimeError as error:
                raise RuntimeError(test.name + ": " + str(error)) from error
            print(test.name + ": passed.", flush=True)


if __name__ == "__main__":
    main()
