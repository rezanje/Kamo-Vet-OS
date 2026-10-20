#!/usr/bin/env python3
"""Restore a protected KAMO data snapshot only into an owned localhost database."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ["-h127.0.0.1", "-p5432"]
# libpq routing variables can override an explicit host argument.
ENV = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
ENV["PGOPTIONS"] = "-c client_min_messages=warning -c TimeZone=UTC"


def verify_backup(path: Path, expected_sha: str) -> dict:
    raw = path.read_bytes()
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha) or hashlib.sha256(raw).hexdigest() != expected_sha:
        raise ValueError("Backup checksum mismatch")
    document = json.loads(raw)
    if document.get("format_version") != 1 or document.get("project_ref") != "koaglxcyjqfmgfzxszkj":
        raise ValueError("Not a supported KAMO backup")
    db = f"vetos_restore_{os.getpid()}_{time.time_ns()}"
    psql = ["psql", "-X", "-q", *LOCAL, "-d", db, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"]

    def sql(source: str) -> str:
        result = subprocess.run([*psql, "-At"], input=source, text=True, capture_output=True, env=ENV)
        if result.returncode:
            # Do not echo row values or PostgreSQL's statement context from private backups.
            codes = re.findall(r"(?:ERROR|FATAL):\s*([0-9A-Z]{5})\b", result.stderr)
            raise RuntimeError("Local restore rejected" + (f" ({codes[-1]})" if codes else ""))
        return result.stdout.strip()

    created = False
    try:
        subprocess.run(["createdb", *LOCAL, db], env=ENV, check=True, capture_output=True)
        created = True
        spec = importlib.util.spec_from_file_location("sale_fixture_bootstrap", ROOT / "scripts/test-posted-sales-postgres.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.DB = db
        module.PSQL = psql
        module.ENV = ENV
        module.bootstrap_database()
        encoded = base64.b64encode(raw).decode("ascii")
        # Keep private payload and TEMP state in the same local connection.
        restore_sql = "create temp table restore_document(value jsonb);insert into restore_document values(convert_from(decode('" + encoded + "','base64'),'UTF8')::jsonb);" + RESTORE_SQL
        manifest = json.loads(sql(restore_sql).splitlines()[-1])
        return {
            "backup_sha256": expected_sha,
            "manifest": manifest,
            "constraints_validated": True,
            "isolation_host": "127.0.0.1",
            "isolation_database": db,
        }
    finally:
        if created:
            subprocess.run(["dropdb", *LOCAL, "--if-exists", db], env=ENV, check=True, capture_output=True)


RESTORE_SQL = r"""
begin;
do $$begin
 if current_database() !~ '^vetos_restore_[a-z0-9_]+$' or inet_server_addr() is distinct from '127.0.0.1'::inet then
  raise exception 'Owned localhost restore database required';end if;
 if (kamo_maintenance.public_snapshot()->'schema') is distinct from (select value->'schema' from restore_document) then
  raise exception 'Backup schema differs from the production migrations';end if;
end$$;
create temp table original_fk as
 select c.conrelid::regclass::text as relation,c.conname,c.condeferrable,c.condeferred
 from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid=c.connamespace
 where n.nspname='public' and c.contype='f';
create temp table original_triggers as
 select g.tgrelid::regclass::text as relation,g.tgname,g.tgenabled
 from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid=g.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','auth') and not g.tgisinternal;
do $$declare r record;v_tables text;v_columns text;v_select text;begin
 select string_agg(format('public.%I',key),',' order by key) into v_tables from jsonb_each((select value->'tables' from restore_document));
 execute 'lock table auth.users,'||v_tables||' in access exclusive mode';
 for r in select * from original_fk loop execute format('alter table %s alter constraint %I deferrable initially deferred',r.relation,r.conname);end loop;
 execute 'set constraints all deferred';
 for r in select distinct relation from original_triggers loop execute 'alter table '||r.relation||' disable trigger user';end loop;
 execute 'truncate auth.users,'||v_tables;
 insert into auth.users(id,raw_user_meta_data) select id::uuid,'{}' from jsonb_array_elements_text((select value->'auth_ids' from restore_document)) x(id);
 for r in select c.oid,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname loop
  select string_agg(format('%I',attname),',' order by attnum),string_agg(format('x.%I',attname),',' order by attnum) into v_columns,v_select
   from pg_catalog.pg_attribute where attrelid=r.oid and attnum>0 and not attisdropped and attgenerated='';
  execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I,(select value->''tables''->%L from restore_document)) x',r.relname,v_columns,v_select,r.relname,r.relname);
 end loop;
 execute 'set constraints all immediate';
 for r in select * from original_fk loop execute format('alter table %s alter constraint %I %s initially %s',r.relation,r.conname,case when r.condeferrable then 'deferrable' else 'not deferrable' end,case when r.condeferred then 'deferred' else 'immediate' end);end loop;
 for r in select * from original_triggers loop execute format('alter table %s %s trigger %I',r.relation,case r.tgenabled when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' else 'enable' end,r.tgname);end loop;
 for r in select x.* from jsonb_to_recordset((select value->'sequences' from restore_document)) x(name text,last_value bigint,is_called boolean) loop
  perform pg_catalog.setval(format('public.%I',r.name)::regclass,r.last_value,r.is_called);
 end loop;
 if kamo_maintenance.snapshot_manifest(kamo_maintenance.public_snapshot()) is distinct from kamo_maintenance.snapshot_manifest((select value from restore_document)) then
  raise exception 'Restored data, constraints, trigger configuration or sequences differ';end if;
end$$;
commit;
select kamo_maintenance.snapshot_manifest(kamo_maintenance.public_snapshot())::text;
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    destination = args.receipt or args.backup.with_suffix(".restore-receipt.json")
    if destination.resolve() == args.backup.resolve():
        parser.error("Receipt must not overwrite the backup")
    try:
        receipt = verify_backup(args.backup, args.sha256)
        with tempfile.NamedTemporaryFile(mode="w", dir=destination.parent, delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(receipt, handle, indent=2)
        os.replace(temporary, destination)
        print(json.dumps({"verified": True, "tables": len(receipt["manifest"]["tables"]), "receipt": str(destination)}))
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print("Backup verification failed: " + (str(error) if isinstance(error, (ValueError, RuntimeError)) else "Local database command failed"))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
