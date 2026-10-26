#!/usr/bin/env python3
"""S04 policy schema/RLS fixture in disposable PostgreSQL; never touches a target."""
from pathlib import Path
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py"
)
fixture = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(fixture)


def denied(db: fixture.DisposablePostgres, sql: str, expected: str) -> None:
    try:
        db.sql(sql)
    except RuntimeError as error:
        assert expected in str(error), str(error)
    else:
        raise AssertionError(f"Expected denial: {expected}")


with fixture.DisposablePostgres() as db:
    db.sql("""
create extension pgcrypto;
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.profiles(id uuid primary key,role text not null,is_active boolean not null);
create table public.branches(id uuid primary key);
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
grant select on public.profiles,public.branches to authenticated;
insert into public.profiles values
 ('fa100000-0000-4000-8000-000000000001','OWNER',true),
 ('fa100000-0000-4000-8000-000000000002','ADMIN',true),
 ('fa100000-0000-4000-8000-000000000003','CASHIER',true),
 ('fa100000-0000-4000-8000-000000000004','OWNER',false);
insert into public.branches values('fb100000-0000-4000-8000-000000000001');
""")
    migration = (ROOT / "supabase/migrations/20261026002000_service_commission_policy.sql").read_text()
    db.sql("begin;\n" + migration + "\ncommit;")

    def session(user: str, role: str = "authenticated") -> str:
        return f"""begin;
set local role {role};
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-00000000000{user}',true);
"""

    insert = """insert into service_commission_policies(effective_from,mode)
values('2026-11-01','personal_rules');"""
    db.sql(session("1") + insert + "commit;")
    db.sql(session("2") + """insert into service_commission_policies
 (branch_id,effective_from,mode,doctor_share_pct,staff_share_pct)
 values('fb100000-0000-4000-8000-000000000001','2026-11-01','split',60,40);
commit;""")
    denied(db, session("3") + insert + "commit;", "row-level security policy")
    denied(db, session("4") + insert + "commit;", "row-level security policy")
    denied(db, session("1", "anon") + "select * from service_commission_policies;commit;", "permission denied")
    denied(db, session("1") + "update service_commission_policies set mode='both_full';commit;", "permission denied")
    denied(db, session("1") + "delete from service_commission_policies;commit;", "permission denied")
    denied(db, session("1") + """insert into service_commission_policies
      (effective_from,mode,doctor_share_pct,staff_share_pct)
      values('2026-11-02','split',60,30);commit;""", "service_commission_policy_shares")
    denied(db, session("1") + """insert into service_commission_policies
      (effective_from,mode,doctor_share_pct,staff_share_pct)
      values('2026-11-02','split',60.001,39.999);commit;""", "service_commission_policy_shares")
    denied(db, session("1") + """insert into service_commission_policies
      (effective_from,mode,doctor_share_pct,staff_share_pct)
      values('2026-11-02','both_full',60,40);commit;""", "service_commission_policy_shares")
    denied(db, session("1") + """insert into service_commission_policies
      (created_by,effective_from,mode)
      values('fa100000-0000-4000-8000-000000000003','2026-11-02','both_full');commit;""", "permission denied")
    db.sql(session("1") + """insert into service_commission_policies(effective_from,mode)
      values('2026-11-01','both_full');commit;""")
    result = db.sql(session("1") + "select count(*) from service_commission_policies;commit;")
    assert result.splitlines()[-1] == "3", result
    print("PASS: append-only choices, admin/owner insert, active-profile RLS, no anonymous/edit access, and share validation.")
