"""Clinic last-stock-unit races on a dedicated LOCAL PostgreSQL fixture only.

Requires the main migrations with local auth/storage shims in vetos_meeting_pg.
Never connects to a URL or production. Fixture database is created separately.
"""
import json
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

CONTAINER = 'vetos_meeting_pg'
DATABASE = 'vetos_clinic_race'
ROOT = Path(__file__).resolve().parents[1]

def execute(sql, check=True):
    result = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DATABASE,
                             '-v', 'ON_ERROR_STOP=1', '-qAt'], input=sql, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result

def scalar(sql):
    return execute(sql).stdout.strip().splitlines()[-1]

assert scalar('select current_database()') == DATABASE
assert scalar("select count(*) from public.branches where code='INVTEST'") == '0', 'Use a fresh dedicated fixture database'
source = (ROOT / 'supabase/tests/clinic_invoice_post.sql').read_text()
fixture = source.split('set local role authenticated;')[0] + '\ncommit;'
execute(fixture)

def authenticated(sql, owner=False):
    actor = 'd1000000-0000-4000-8000-000000000002' if owner else 'd1000000-0000-4000-8000-000000000001'
    return ("begin; set local role authenticated; "
            "select set_config('request.jwt.claim.role','authenticated',true); "
            f"select set_config('request.jwt.claim.sub','{actor}',true); " + sql)

def compete(first, second):
    with ThreadPoolExecutor(max_workers=2) as pool:
        future = pool.submit(execute, first + '\nselect pg_sleep(2); commit;', False)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            sleeping = scalar("select count(*) from pg_stat_activity where datname=current_database() "
                              "and pid<>pg_backend_pid() and wait_event='PgSleep'")
            if int(sleeping):
                break
            if future.done():
                raise AssertionError(future.result().stderr)
            time.sleep(0.02)
        else:
            raise AssertionError('First session did not reach the transaction barrier')
        rejected = pool.submit(execute, second + '\ncommit;', False)
        a, b = future.result(timeout=15), rejected.result(timeout=15)
    assert a.returncode == 0, a.stderr
    assert b.returncode != 0 and 'STOCK_SHORT' in b.stderr, b.stderr
    return a.stdout.strip().splitlines()[2]

def invoice(visit, key):
    return ("select public.clinic_post_invoice(" + f"'{visit}','{key}',"
            "jsonb_build_object('tanggal',current_date::text,'subtotal',100,'discount',0,'tax',0,'total',100,"
            "'dp_amount',0,'paid_status','Lunas','metode_bayar','Tunai',"
            "'shift_id','da000000-0000-4000-8000-000000000001'),"
            "'[{\"description\":\"Last medicine\",\"qty\":1,\"price\":100,\"kind\":\"obat\","
            "\"item_id\":\"d8000000-0000-4000-8000-000000000005\",\"unit\":\"pcs\"}]'::jsonb);")

first_invoice = invoice('d6000000-0000-4000-8000-000000000002', 'meeting-invoice-first')
invoice_id = compete(authenticated(first_invoice), authenticated(invoice('d6000000-0000-4000-8000-000000000003', 'meeting-invoice-second')))
state = json.loads(scalar("select json_build_object(" 
    "'stock',(select qty from stock where warehouse_id='d3000000-0000-4000-8000-000000000001' and item_id='d8000000-0000-4000-8000-000000000005'),"
    "'invoices',(select count(*) from invoices),"
    "'moves',(select count(*) from stock_moves where item_id='d8000000-0000-4000-8000-000000000005'),"
    "'hpp',(select sum(hpp) from invoice_items),"
    "'journals',(select count(*) from journal_entries),"
    "'debits',(select sum(debit) from journal_lines),"
    "'credits',(select sum(credit) from journal_lines))"))
assert state == {'stock': 0, 'invoices': 1, 'moves': 1, 'hpp': 5, 'journals': 2, 'debits': 105, 'credits': 105}, state
retry = execute(authenticated(first_invoice) + 'commit;').stdout.strip().splitlines()[-1]
assert retry == invoice_id
assert scalar('select count(*) from invoices') == '1'
print('PASS invoice race: one commit, competing STOCK_SHORT, zero stock, one move, HPP5, balanced journals105, same-key retry no duplication')

execute("update stock set qty=1 where item_id='d8000000-0000-4000-8000-000000000002';"
        "update stock_layers set qty_left=1,qty_in=1 where item_id='d8000000-0000-4000-8000-000000000002';")
def recipe(record, visit, key):
    return ("select public.clinic_issue_compound(" + f"'{record}','{visit}',"
            "'{\"recipe_name\":\"Last ingredient\",\"dosage_form\":\"puyer\",\"ingredients\":[{"
            "\"item_id\":\"d8000000-0000-4000-8000-000000000002\",\"quantity\":1,\"unit\":\"gram\",\"unit_price\":100}]}'::jsonb,"
            f"'{key}');")

first_recipe = recipe('d7000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001', 'meeting-recipe-first')
recipe_id = compete(authenticated(first_recipe, True), authenticated(recipe('d7000000-0000-4000-8000-000000000004', 'd6000000-0000-4000-8000-000000000004', 'meeting-recipe-second'), True))
state = json.loads(scalar("select json_build_object("
    "'stock',(select qty from stock where warehouse_id='d3000000-0000-4000-8000-000000000001' and item_id='d8000000-0000-4000-8000-000000000002'),"
    "'recipes',(select count(*) from compounding_recipes),"
    "'issues',(select count(*) from compound_issues),"
    "'historicalCost',(select sum(qty*unit_cost) from compound_issues),"
    "'moves',(select count(*) from stock_moves where item_id='d8000000-0000-4000-8000-000000000002'))"))
assert state == {'stock': 0, 'recipes': 1, 'issues': 1, 'historicalCost': 5, 'moves': 1}, state
retry = execute(authenticated(first_recipe, True) + 'commit;').stdout.strip().splitlines()[-1]
assert retry == recipe_id
assert scalar('select count(*) from compound_issues') == '1'
print('PASS compound race: one commit, competing STOCK_SHORT, zero stock, one issue/move, immutable historical cost5, same-key retry no duplication')
