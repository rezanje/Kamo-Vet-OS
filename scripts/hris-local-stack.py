#!/usr/bin/env python3
"""Apply unchanged repository migration sources to a disposable LOCAL Supabase DB.

This is an explicit fresh bootstrap, not `supabase db reset`: historical version
0106 occurs twice, and 0068 requires the two COA accounts usually seeded later.
Never accepts remote connection strings, containers or credentials.
"""
from pathlib import Path
import argparse
import collections
import os
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "supabase_db_vetos_hris_acceptance"
DOCKER = ["docker", "--host=unix:///var/run/docker.sock"]
ENV = {k: v for k, v in os.environ.items() if k not in
       ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]}


def sql(source: str):
    result = subprocess.run([*DOCKER, "exec", "-i", CONTAINER, "psql", "-U", "postgres",
                             "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
                            env=ENV, input=source, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fresh-prerequisites", action="store_true")
    args = parser.parse_args()
    migrations = sorted((ROOT / "supabase/migrations").glob("*.sql"))
    versions = collections.Counter(p.name.split("_", 1)[0] for p in migrations)
    print("Source files:", len(migrations), "duplicate historical versions:",
          {k: v for k, v in versions.items() if v > 1}, flush=True)
    sql("create schema if not exists local_acceptance; create table if not exists "
        "local_acceptance.applied_sources(filename text primary key, applied_at timestamptz default now());")
    applied = set(sql("copy(select filename from local_acceptance.applied_sources)to stdout;").splitlines())
    for migration in migrations:
        if migration.name in applied:
            continue
        if migration.name == "0068_kas_bank.sql" and args.fresh_prerequisites:
            print("EXPLICIT fresh prerequisite: COA1101/1102 before0068 (seed otherwise runs after migrations)", flush=True)
            sql("insert into public.coa_accounts(code,name,type,normal_balance)values"
                "('1101','Fiction local cash','ASET','D'),('1102','Fiction local bank','ASET','D')"
                "on conflict(code)do nothing;")
        print("APPLY", migration.name, flush=True)
        sql("begin;\n" + migration.read_text() + "\ninsert into local_acceptance.applied_sources(filename)values('"
            + migration.name.replace("'", "''") + "');\ncommit;")
    count = sql("copy(select count(*)from local_acceptance.applied_sources)to stdout;").strip()
    if count != str(len(migrations)):
        raise RuntimeError("Incomplete migration source chain: " + count)
    sql("notify pgrst,'reload schema';")
    print("PASS: all", count, "unchanged migration sources applied to LOCAL PostgreSQL", flush=True)


if __name__ == "__main__":
    main()
