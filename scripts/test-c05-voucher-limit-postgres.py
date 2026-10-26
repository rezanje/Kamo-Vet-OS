#!/usr/bin/env python3
"""Exercise C05 capped transaction vouchers in disposable PostgreSQL 16."""
from pathlib import Path
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(fixture)


def rejected(db, sql, expected):
    try:
        db.sql(sql)
    except RuntimeError as error:
        assert expected in str(error), str(error)
    else:
        raise AssertionError(f"Expected rejection: {expected}")


with fixture.DisposablePostgres() as db:
    db.sql("""
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table profiles(id uuid primary key, role text not null);
create table vouchers(code text primary key);
create table sales(id integer generated always as identity primary key, voucher_code text);
create table invoices(id integer generated always as identity primary key, voucher_code text);
grant usage on schema public,auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on profiles to authenticated;
grant all on vouchers,sales,invoices to authenticated;
grant usage on all sequences in schema public to authenticated;
insert into profiles values
 ('fa100000-0000-4000-8000-000000000001','OWNER'),
 ('fa100000-0000-4000-8000-000000000002','CASHIER');
insert into vouchers(code) values ('LEGACY'),('CAPPED');
""")
    migration = (ROOT / "supabase/migrations/20261026001920_c05_voucher_usage_limit.sql").read_text()
    db.sql("begin;\n" + migration + "\ncommit;")
    role = """begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000001',true);
"""
    cashier = role.replace("000000000001", "000000000002")
    rejected(db, cashier + "update vouchers set max_uses=2 where code='CAPPED'; commit;",
             "C05_VOUCHER_CAP_MANAGER_REQUIRED")
    db.sql(role + "update vouchers set max_uses=2 where code='CAPPED'; commit;")
    assert db.sql("select max_uses from vouchers where code='CAPPED';") == "2"
    db.sql(cashier + "insert into sales(voucher_code) values('CAPPED'); commit;")
    db.sql(cashier + "insert into invoices(voucher_code) values('CAPPED'); commit;")
    rejected(db, cashier + "insert into sales(voucher_code) values('CAPPED'); commit;",
             "VOUCHER_USAGE_LIMIT_REACHED")
    rejected(db, cashier + "insert into invoices(voucher_code) values('CAPPED'); commit;",
             "VOUCHER_USAGE_LIMIT_REACHED")
    db.sql(cashier + "update invoices set voucher_code='CAPPED' where id=1; commit;")
    db.sql(cashier + "insert into sales(voucher_code) values('LEGACY'),('LEGACY'); commit;")
    assert db.sql("select count(*) from sales where voucher_code='CAPPED';") == "1"
    assert db.sql("select has_function_privilege('authenticated','public.guard_voucher_usage_limit()','EXECUTE');") == "f"
    print("C05 voucher cap: manager guard, cross-channel cap, same-code retry, legacy unlimited, and restricted trigger EXECUTE passed.")
