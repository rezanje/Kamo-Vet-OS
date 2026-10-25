#!/usr/bin/env python3
"""Exercise the R05 URL guard before/after migration in owned, isolated PG16."""
from pathlib import Path
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py"
)
fixture = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(fixture)


def denied(database: fixture.DisposablePostgres, sql: str, expected: str) -> None:
    try:
        database.sql(sql)
    except RuntimeError as error:
        assert expected in str(error), str(error)
    else:
        raise AssertionError(f"Expected rejection: {expected}")


with fixture.DisposablePostgres() as database:
    database.sql("""
create extension pgcrypto;
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$
 select current_setting('request.jwt.claim.role',true) $$;
create table public.profiles(id uuid primary key, role text not null, is_active boolean not null);
create table public.role_modules(role text not null, module_id text not null);
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
grant select on public.profiles,public.role_modules to authenticated;
insert into public.profiles values
 ('fa100000-0000-4000-8000-000000000001','OWNER',true),
 ('fa100000-0000-4000-8000-000000000002','OWNER',true);
""")
    baseline = (ROOT / "supabase/migrations/20261023154500_private_report_presets.sql").read_text()
    patch = (ROOT / "supabase/migrations/20261025110800_private_report_branch_filter.sql").read_text()
    database.sql("begin;\n" + baseline + "\ncommit;")
    role = """begin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000001',true);
"""
    branch_url = "/laporan/penjualan-rinci?dari=2026-10-01&cabang_id=20000000-0000-4000-8000-000000000002"
    denied(database, role + f"insert into private_report_presets(name,href) values('Branch','{branch_url}');\ncommit;",
           "PRIVATE_PRESET_INVALID: parameter laporan tidak didukung")
    print("RED: existing database rejects the allowed branch UUID filter.", flush=True)
    denied(database, "begin; alter function public.guard_private_report_preset() security definer;\n"
           + patch + "\nrollback;", "R05_PRIVATE_PRESET_GUARD_DRIFT")
    database.sql("begin;\n" + patch + "\ncommit;")
    assert database.sql("select md5(prosrc) from pg_proc where oid='public.guard_private_report_preset()'::regprocedure;") != "84e128692f8cb7da9e3dc0b72396a19a"
    result = database.sql(role + f"""
insert into private_report_presets(name,href) values('Branch','{branch_url}');
select href from private_report_presets where name='Branch';
commit;""")
    assert branch_url in result, result
    denied(database, role + "insert into private_report_presets(name,href) values('Unknown','/laporan/penjualan-rinci?token=secret');\ncommit;",
           "PRIVATE_PRESET_INVALID: parameter laporan tidak didukung")
    other_rows = database.sql(role.replace("000000000001", "000000000002")
                              + "select count(*) from private_report_presets;\ncommit;")
    assert other_rows.splitlines()[-1] == "0", other_rows
    assert database.sql("select has_table_privilege('anon','public.private_report_presets','SELECT');") == "f"
    assert database.sql("select has_function_privilege('authenticated','public.guard_private_report_preset()','EXECUTE');") == "f"
    print("GREEN: branch URL persists; unknown keys, other-account reads, and direct trigger EXECUTE stay blocked.", flush=True)
