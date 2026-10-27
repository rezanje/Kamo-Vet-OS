#!/usr/bin/env python3
"""Check the R01/R05 private URL guard in disposable Postgres, rolling back the patch."""
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
    for migration in (
        "20261023154500_private_report_presets.sql",
        "20261025110800_private_report_branch_filter.sql",
        "20261025173500_private_report_opname_preset.sql",
    ):
        database.sql("begin;\n" + (ROOT / "supabase/migrations" / migration).read_text() + "\ncommit;")
    patch = (ROOT / "supabase/migrations/20261026000345_private_report_sales_performer_filter.sql").read_text()
    role = """set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000001',true);
"""
    href = "/laporan/penjualan-barang?dari=2026-10-01&pelaksana_id=fa100000-0000-4000-8000-000000000002"
    denied(database, "begin;\n" + role + f"insert into private_report_presets(name,href) values('R01','{href}');\nrollback;",
           "PRIVATE_PRESET_INVALID: parameter laporan tidak didukung")
    denied(database, "begin; alter function public.guard_private_report_preset() security definer;\n"
           + patch + "\nrollback;", "R05_PRIVATE_PRESET_GUARD_DRIFT")
    result = database.sql("begin;\n" + patch + "\n" + role + f"""
insert into private_report_presets(name,href) values('R01','{href}');
select href from private_report_presets where name='R01';
rollback;""")
    assert href in result, result
    denied(database, "begin;\n" + patch + "\n" + role
           + "insert into private_report_presets(name,href) values('Other','/laporan/promo?pelaksana_id=x');\nrollback;",
           "PRIVATE_PRESET_INVALID: parameter laporan tidak didukung")
    denied(database, "begin;\n" + patch + "\n" + role
           + "insert into private_report_presets(name,href) values('Unknown','/laporan/penjualan-barang?token=secret');\nrollback;",
           "PRIVATE_PRESET_INVALID: parameter laporan tidak didukung")
    assert database.sql("select has_table_privilege('anon','public.private_report_presets','SELECT');").splitlines()[-1] == "f"
    assert database.sql("select has_function_privilege('authenticated','public.guard_private_report_preset()','EXECUTE');").splitlines()[-1] == "f"
    print("PASS: exact performer URL accepted only on item sales; guard grants unchanged; patch rolled back.")
