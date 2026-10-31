#!/usr/bin/env python3
"""Exercise Accurate GL bridge races with real PostgreSQL waiting sessions.

Only an owned network-none Docker container is used. To include PR69/PR70 SQL:
  python3 scripts/test-accurate-inventory-accounting-races.py \
    --compatibility-migration /tmp/kamo-pr69-stock.sql \
    --compatibility-migration /tmp/kamo-pr70-monetary.sql
"""
import argparse
from decimal import Decimal
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("accurate_fixture_db", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


def identity(label):
    return str(uuid.UUID(hashlib.md5(("ar-" + label).encode()).hexdigest()))


OWNER = identity("owner")
AUTH = f"set role authenticated;set request.jwt.claim.sub='{OWNER}';"
REASON = "Fiction reviewed equity decision"


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def setup(database):
    database.sql(f"""insert into auth.users(id) values('{OWNER}');
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='OWNER',is_active=true where id='{OWNER}';
alter table profiles enable trigger guard_profile_privileges;
insert into branches(id,code,name,type) values('{identity('branch')}','AR-A','Race fiction branch','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values('{identity('wh')}','{identity('branch')}','AR-W','Race fiction warehouse','RETAIL');
insert into coa_accounts(code,name,type,normal_balance,is_header) values('170001','Fiction inventory','ASET','D',false),('410001','Fiction equity','EKUITAS','K',false) on conflict(code) do update set is_active=true,is_header=false;
""")
    for name in ["global-first", "bridge-first", "same-batch", "inversion", "revoked"]:
        database.sql(f"""insert into items(id,code,name,unit,item_type) values('{identity('item-'+name)}','AR-{name}','Fiction race {name}','pcs','Persediaan');
insert into import_runs(id,kind,source_name,source_hash,branch_id,warehouse_id,as_of_date,created_by,summary)
values('{identity('run-'+name)}','initial_stock','fiction.xlsx','ar-{name}','{identity('branch')}','{identity('wh')}','2026-01-01','{OWNER}','{{"valid":1}}');
insert into import_run_rows(run_id,source_row,status,payload) values('{identity('run-'+name)}',1,'valid',jsonb_build_object('item_id','{identity('item-'+name)}','warehouse_id','{identity('wh')}','base_qty',10,'base_unit_cost',12.5,'as_of','2026-01-01'));
""")


def preview(database, name):
    return json.loads(database.sql(AUTH + f"select preview_accurate_inventory_accounting('{identity('run-'+name)}',(select id from coa_accounts where code='410001'));"))


def post(name, reviewed):
    return f"select post_accurate_inventory_accounting('{identity('run-'+name)}',(select id from coa_accounts where code='410001'),{quote(json.dumps(reviewed))}::jsonb,{quote(REASON)});"


def start(database, name, command, authenticated=True):
    process = subprocess.Popen(database.command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(f"set application_name='{name}';" + (AUTH if authenticated else "") + command)
    process.stdin.close()
    return process


def finish(process, succeeds=True):
    process.wait(timeout=15)
    output, error = process.stdout.read(), process.stderr.read()
    if "deadlock detected" in error:
        raise AssertionError("Concurrent opening lock order deadlocked: " + error)
    if (process.returncode == 0) != succeeds:
        raise AssertionError(output + error)
    return output.strip(), error


def wait(database, name, event):
    for _ in range(300):
        result = database.sql("select exists(select 1 from pg_stat_activity where application_name=" + quote(name) + " and " + event + ");")
        if result == "t":
            return
        time.sleep(0.01)
    raise AssertionError("Missing actual waiting-session barrier: " + name)


def exact_retry_race(database):
    name = "same-batch"
    reviewed = preview(database, name)
    assert reviewed["can_post"], reviewed
    first = start(database, "ar-same-first", "begin;" + post(name, reviewed) + "select pg_sleep(1);commit;")
    wait(database, "ar-same-first", "wait_event='PgSleep'")
    second = start(database, "ar-same-second", post(name, reviewed))
    wait(database, "ar-same-second", "wait_event_type='Lock'")
    first_output, _ = finish(first)
    second_output, _ = finish(second)
    assert json.loads(first_output) == json.loads(second_output)
    counts = database.sql(f"select (select count(*) from accurate_inventory_accounting where run_id='{identity('run-'+name)}')||'|'||(select count(*) from journal_entries where source='accurate-stock-opening' and source_ref='{identity('run-'+name)}')||'|'||(select qty from stock where item_id='{identity('item-'+name)}');")
    receipt_count, journal_count, quantity = counts.split("|")
    assert receipt_count == "1" and journal_count == "1" and Decimal(quantity) == Decimal("10"), counts
    print("PASS: concurrent same-batch post and exact retry return one receipt/journal and one stock quantity.", flush=True)


def actor_revocation_race(database):
    reviewed = preview(database, "revoked")
    assert reviewed["can_post"], reviewed
    first = start(database, "ar-revoke-owner", f"begin;update profiles set is_active=false where id='{OWNER}';select pg_sleep(1);commit;", authenticated=False)
    wait(database, "ar-revoke-owner", "wait_event='PgSleep'")
    second = start(database, "ar-revoked-bridge", post("revoked", reviewed))
    wait(database, "ar-revoked-bridge", "wait_event_type='Lock'")
    finish(first)
    _, error = finish(second, succeeds=False)
    assert "OWNER aktif diperlukan" in error, error
    assert database.sql(f"select count(*) from stock_moves where source_ref='{identity('run-revoked')}';") == "0"
    database.sql(f"update profiles set is_active=true where id='{OWNER}';")
    print("PASS: actor revocation commits first; waiting bridge rechecks authorization and creates no stock effects.", flush=True)


def global_races(database):
    def global_post(key):
        return f"select create_opening_balance_atomic('{key}','2026-01-01','[{{\"code\":\"1301\",\"nilai\":125,\"sisi\":\"D\"}}]');"

    reviewed = preview(database, "global-first")
    first = start(database, "ar-global-first", "begin;" + global_post("ar-global-first") + "select pg_sleep(1);commit;")
    wait(database, "ar-global-first", "wait_event='PgSleep'")
    second = start(database, "ar-global-bridge", post("global-first", reviewed))
    wait(database, "ar-global-bridge", "wait_event_type='Lock'")
    finish(first)
    _, error = finish(second, succeeds=False)
    assert "Bukti berubah" in error, error
    assert database.sql(f"select count(*) from stock_moves where source_ref='{identity('run-global-first')}';") == "0"
    database.sql("delete from journal_lines where entry_id in(select id from journal_entries where source='saldo-awal');delete from journal_entries where source='saldo-awal';delete from opening_balance_create_requests;")
    print("PASS: PR70 global opening wins; waiting bridge rejects stale evidence without stock effects.", flush=True)

    # PR70 holds actor SHARE before seeking journals. This barrier exposes an
    # actor/journal inversion if the bridge takes actor UPDATE after journals.
    reviewed = preview(database, "inversion")
    first = start(database, "ar-owner-share-first", "begin;select id from profiles where id=auth.uid() for share;select pg_sleep(1);" + global_post("ar-owner-share-first") + "commit;")
    wait(database, "ar-owner-share-first", "wait_event='PgSleep'")
    second = start(database, "ar-owner-share-bridge", post("inversion", reviewed))
    bridge_output, _ = finish(second)
    _, error = finish(first, succeeds=False)
    assert "saldo awal global persediaan diblokir" in error, error
    assert json.loads(bridge_output)["amount"] == 125
    print("PASS: PR70 actor-before-journal interleaving has no deadlock and cannot double-post inventory.", flush=True)

    reviewed = preview(database, "bridge-first")
    first = start(database, "ar-bridge-first", "begin;" + post("bridge-first", reviewed) + "select pg_sleep(1);commit;")
    wait(database, "ar-bridge-first", "wait_event='PgSleep'")
    second = start(database, "ar-bridge-global", global_post("ar-bridge-global"))
    wait(database, "ar-bridge-global", "wait_event_type='Lock'")
    finish(first)
    _, error = finish(second, succeeds=False)
    assert "saldo awal global persediaan diblokir" in error, error
    assert database.sql("select count(*) from journal_entries where source='saldo-awal';") == "0"
    print("PASS: bridge wins; waiting PR70 global stock opening fully rolls back.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compatibility-migration", action="append", type=Path, default=[])
    args = parser.parse_args()
    with harness.DisposablePostgres() as database:
        database.bootstrap()
        for migration in args.compatibility_migration:
            database.sql("begin;\n" + migration.read_text() + "\ncommit;")
            print("Compatibility migration applied: " + migration.name, flush=True)
        setup(database)
        if database.sql("select to_regprocedure('public.create_opening_balance_atomic(text,date,jsonb)') is not null;") == "t":
            global_races(database)
        else:
            print("SKIP: PR70 global races require its compatibility migration.", flush=True)
        actor_revocation_race(database)
        exact_retry_race(database)


if __name__ == "__main__":
    main()
