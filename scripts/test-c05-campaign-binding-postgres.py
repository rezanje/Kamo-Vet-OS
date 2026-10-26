#!/usr/bin/env python3
"""Check C05 configuration constraints and manager RLS in disposable PostgreSQL."""
from pathlib import Path
import importlib.util

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("fixture", ROOT/"scripts/test-accurate-inventory-accounting-postgres.py")
fixture=importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(fixture)

def denied(db,sql,expected):
    try: db.sql(sql)
    except RuntimeError as error: assert expected in str(error),str(error)
    else: raise AssertionError(f"Expected {expected}")

with fixture.DisposablePostgres() as db:
    db.sql("""
create extension pgcrypto;
create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table profiles(id uuid primary key,role text not null,is_active boolean not null);
create table vouchers(id uuid primary key,code text not null);
create table promos(id uuid primary key,name text not null);
grant usage on schema public,auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on profiles,vouchers,promos to authenticated;
insert into profiles values
 ('fa100000-0000-4000-8000-000000000001','OWNER',true),
 ('fa100000-0000-4000-8000-000000000002','CASHIER',true);
insert into vouchers values('fa200000-0000-4000-8000-000000000001','SOURCEV');
insert into promos values('fa300000-0000-4000-8000-000000000001','Source promo');
""")
    migration=(ROOT/"supabase/migrations/20261026003600_c05_campaign_binding_config.sql").read_text()
    db.sql("begin;\n"+migration+"\ncommit;")
    owner="""begin; set local role authenticated;
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000001',true);
"""
    cashier=owner.replace("000000000001","000000000002")
    db.sql(owner+"""insert into campaign_code_bindings(code,binding_type,voucher_id)
values('ALIASV','transaction_voucher','fa200000-0000-4000-8000-000000000001'); commit;""")
    db.sql(owner+"""insert into campaign_code_bindings(code,binding_type,promo_id,calculation_mode)
values('ALIASP','product_promo','fa300000-0000-4000-8000-000000000001','existing_promo'); commit;""")
    denied(db,owner+"""insert into campaign_code_bindings(code,binding_type,promo_id,calculation_mode)
values('BAD','product_promo','fa300000-0000-4000-8000-000000000001','existing_voucher'); commit;""","campaign_binding_target")
    denied(db,owner+"""insert into campaign_code_bindings(code,binding_type,promo_id)
values('SOURCEV','product_promo','fa300000-0000-4000-8000-000000000001'); commit;""","CAMPAIGN_CODE_COLLIDES_WITH_VOUCHER")
    denied(db,"insert into vouchers values('fa200000-0000-4000-8000-000000000002','ALIASP');","CAMPAIGN_CODE_COLLIDES_WITH_ALIAS")
    assert db.sql(cashier+"select count(*) from campaign_code_bindings; commit;").splitlines()[-1]=="0"
    denied(db,cashier+"""insert into campaign_code_bindings(code,binding_type,promo_id)
values('CASHIER','product_promo','fa300000-0000-4000-8000-000000000001'); commit;""","row-level security")
    assert db.sql(owner+"select count(*) from campaign_code_bindings; commit;").splitlines()[-1]=="2"
    print("C05 manager RLS, exclusive source binding, optional mode, cross-type rejection and alias/voucher collision guards passed.")
