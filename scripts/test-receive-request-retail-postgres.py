#!/usr/bin/env python3
"""Socket-only PG17, full migration chain, original public receipt RPC; no network.
Run under flock /opt/data/kamo-heavy-test.lock. --red never applies the candidate.
"""
import argparse
import hashlib
import json
from pathlib import Path
import uuid
from decimal import Decimal
import concurrent.futures
import time
from native_postgres import NativePostgres

ROOT = Path(__file__).resolve().parents[1]
OUT = Path('/opt/data/kamo-panduraya-stock-evidence')
CANDIDATE = ROOT / 'supabase/migrations/20261105050000_receive_request_retail_warehouse.sql'
SUITE = ROOT / 'supabase/tests/receive_request_retail_warehouse.sql'
ANCHOR = "select id into v_wh from warehouses where branch_id=p_branch_id and is_active and type<>'TRANSIT' order by code,id limit 1;"
OWNER = 'fa100000-0000-4000-8000-000000000001'
FOREIGN = 'fa100000-0000-4000-8000-000000000002'
PET = 'fa200000-0000-4000-8000-000000000001'
DC = 'fa200000-0000-4000-8000-000000000002'
VET = 'fa200000-0000-4000-8000-000000000003'
WEB = 'fa200000-0000-4000-8000-000000000004'
ONLINE = 'fa300000-0000-4000-8000-000000000001'
RETAIL = 'fa300000-0000-4000-8000-000000000002'
SOURCE = 'fa300000-0000-4000-8000-000000000003'
TRANSIT = 'fa300000-0000-4000-8000-000000000004'
SIG = 'public.receive_stock_request_atomic(uuid,uuid,jsonb)'

def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()

def actor(branch=PET, user: str | None=OWNER, role='authenticated'):
    claims = json.dumps({'role': role, 'sub': user} if user else {'role': role})
    return (f"set role {role};select set_config('request.jwt.claims','{claims}',false);"
            f"select set_config('request.headers','{{\"x-kamo-operational-branch\":\"{branch}\"}}',false);")

def fixture(db, branch=PET, transit=True, requested=3):
    request, line, item = [str(uuid.uuid4()) for _ in range(3)]
    source = TRANSIT if transit else SOURCE
    code = 'RF-' + uuid.UUID(request).hex[:16]
    db.sql(f"""insert into items(id,code,name,unit,item_type,buy_price,sell_price)
values('{item}','{code}','Fictional FIFO item','pcs','Persediaan',0,20);
insert into item_units(item_id,unit,factor,buy_price,sell_price) values('{item}','box',12,0,240);
select stock_in_fifo('{source}','{item}',12,3,'test','{request}-1',current_date-2);
select stock_in_fifo('{source}','{item}',24,5,'test','{request}-2',current_date-1);
insert into stock_requests(id,no_request,from_branch_id,to_warehouse_id,status,approved_by,transit_warehouse_id)
values('{request}','{code}','{branch}','{SOURCE}','Dikirim','{OWNER}',{chr(39)+TRANSIT+chr(39) if transit else 'null'});
insert into stock_request_items(id,request_id,item_id,nama,qty_diminta,qty_disetujui,qty_dikirim,satuan,faktor)
values('{line}','{request}','{item}','Fictional FIFO item',{requested},3,3,'box',12);""")
    return {'request': request, 'line': line, 'item': item, 'branch': branch, 'source': source}

def rpc(f, qty=3, condition='baik', branch=None, line=None):
    payload = json.dumps([{'id': line or f['line'], 'qty_diterima': qty, 'kondisi': condition}])
    return f"select * from {SIG.split('(')[0]}('{f['request']}','{branch or f['branch']}','{payload}');"

def qty(db, wh, f):
    return str(Decimal(db.last(f"select coalesce((select qty from stock where warehouse_id='{wh}' and item_id='{f['item']}'),0);")).normalize())

def snapshot(db):
    # All business schemas, including private stock writers; all ACLs/RLS/policies.
    return json.loads(db.last("""select json_build_object(
'functions',(select json_object_agg(p.oid::regprocedure::text,json_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl::text,'owner',p.proowner,'config',p.proconfig,'definer',p.prosecdef)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not like 'pg_%' and n.nspname not in ('information_schema','auth','storage') and p.prokind in ('f','p')),
'relations',(select json_object_agg(c.oid::regclass::text,json_build_object('acl',c.relacl::text,'owner',c.relowner,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname not in ('information_schema','auth','storage')),
'policies',(select coalesce(json_agg(row_to_json(x) order by schemaname,tablename,policyname),'[]') from pg_policies x where schemaname not like 'pg_%' and schemaname not in ('information_schema','auth','storage')));"""))

def state(db):
    tables = ['stock','stock_layers','stock_moves','stock_receipts','stock_receipt_items','stock_requests','stock_request_items','inventory_cost_events','journal_entries','journal_lines']
    return db.last('select json_build_object(' + ','.join(f"'{t}',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from {t} x)" for t in tables) + ')::text;')

def bootstrap(db, originals):
    # Platform-only shims from test-accurate-inventory-accounting-postgres.py;
    # every business function and writer comes from the actual migration chain.
    hosted_uid = (ROOT / 'supabase/tests/fixtures/hosted_auth_uid.sql').read_text()
    db.sql("""create extension pgcrypto;
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
""" + hosted_uid + """
create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create publication supabase_realtime;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;
""")
    for migration in originals:
        if migration.name.startswith('0068'):
            db.sql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Fictional test cash','ASET','D'),('1102','Fictional test bank','ASET','D') on conflict do nothing;")
        try:
            db.sql('begin;\n' + migration.read_text() + '\ncommit;')
        except RuntimeError as error:
            raise RuntimeError(migration.name + ': ' + str(error)) from error
    print(f'Applied {len(originals)} original repository migrations on PostgreSQL {db.last("show server_version;")}.',flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--red', action='store_true')
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    report_path = OUT / 'receipt-fix-report.json'
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    phase = 'red' if args.red else 'green'
    result = {'status': 'running', 'tests': [], 'gaps': []}
    report[phase] = result
    try:
        with NativePostgres('/opt/data/kamo-pg-harness/bin') as db:
            migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
            originals = [p for p in migrations if p != CANDIDATE]
            bootstrap(db, originals)
            result['server_version'] = db.last('show server_version;')
            assert int(db.last('show server_version_num;')) // 10000 == 17
            result['original_chain_count'] = len(originals)
            result['chain_count_including_candidate'] = len(originals) + (0 if args.red else 1)
            result['chain_sha256'] = sha(''.join(p.name + ':' + sha(p.read_text()) + '\n' for p in originals))
            before = snapshot(db)
            original = before['functions'][SIG.removeprefix('public.')]['definition']
            live = json.loads((OUT / 'fix-preflight.json').read_text())['db']['receipt_definition'][0]['definition']
            assert original == live, 'Repository full-chain receipt differs from live preflight'
            result['original_receipt_sha256'] = sha(original)
            result['original_catalog_sha256'] = sha(json.dumps(before,sort_keys=True))
            fixture_sql, assertion_sql = SUITE.read_text().split('-- POST_RECEIPT_ASSERTION',1)
            db.sql(fixture_sql)
            if args.red:
                f = fixture(db)
                response = db.sql(actor() + rpc(f))
                observed = {'online_qty': qty(db, ONLINE, f), 'retail_qty': qty(db, RETAIL, f), 'response': response.splitlines()[-1]}
                result['observed'] = observed
                assert observed == {**observed, 'online_qty': '36', 'retail_qty': '0'}, observed
                result['status'] = 'expected_failure'
                result['tests'].append('original public RPC actually stocks ONLINE=36 instead of RETAIL=36')
                result['failure'] = 'RETAIL destination assertion failed: actual 0, expected 36; ONLINE actual 36'
                print('RED: ' + result['failure'], flush=True)
                return
            # Preserve the original FIFO writer's actual movement-value precision.
            baseline = fixture(db,WEB)
            db.sql(actor(WEB)+rpc(baseline))
            baseline_net = db.last(f"select sum(qty*unit_cost) from stock_moves where source_ref='{baseline['request']}';")
            result['original_fifo_movement_net'] = baseline_net
            db.sql('begin;\n' + CANDIDATE.read_text() + '\ncommit;')
            after = snapshot(db)
            changed = [key for key in before['functions'] if before['functions'][key] != after['functions'][key]]
            assert changed == [SIG.removeprefix('public.')], changed
            replacement = CANDIDATE.read_text().split('$replacement$')[1]
            expected = original.replace(ANCHOR, replacement)
            assert original.count(ANCHOR) == 1 and after['functions'][changed[0]]['definition'] == expected
            for key in ['acl','owner','config','definer']:
                assert before['functions'][changed[0]][key] == after['functions'][changed[0]][key]
            assert before['relations'] == after['relations'] and before['policies'] == after['policies']
            assert before['functions'].keys() == after['functions'].keys()
            result['catalog_invariants'] = {'unchanged_other_business_functions': len(before['functions'])-1, 'unchanged_relations': len(before['relations']), 'unchanged_policies': len(before['policies']), 'exact_one_anchor': True, 'metadata_unchanged': True}
            result['fixed_receipt_sha256'] = sha(expected)
            # Primary two-warehouse regression, FIFO costing and units.
            f = fixture(db)
            db.sql(actor() + rpc(f))
            db.sql(assertion_sql.replace('__ITEM__',f['item']).replace('__REQUEST__',f['request']))
            assert qty(db, RETAIL, f) == '36' and qty(db, ONLINE, f) == '0'
            assert db.last(f"select sum(qty_left*unit_cost) from stock_layers where warehouse_id='{RETAIL}' and item_id='{f['item']}';") == '156'
            movement_value = db.last(f"select json_build_object('net',sum(qty*unit_cost),'moves',json_agg(to_jsonb(x))) from stock_moves x where source_ref='{f['request']}';")
            result['movement_cost_observed'] = json.loads(movement_value)
            fixed_net = db.last(f"select sum(qty*unit_cost) from stock_moves where source_ref='{f['request']}';")
            assert fixed_net == baseline_net, movement_value
            if Decimal(fixed_net) != 0:
                result['gaps'].append('Existing original FIFO stock_moves aggregate division residual '+fixed_net+' is unchanged; exact layer cost156 is conserved. Exact raw movement-net zero is not satisfied by original writer; writer is outside scope.')
            result['tests'].append('PETSHOP two destinations: RETAIL only, factor12, FIFO cost156 conserved')
            # An identical replay is read-only; a changed payload must reject before effects.
            prior = state(db)
            replay = db.sql(actor() + rpc(f)).splitlines()[-1]
            assert state(db) == prior
            result['tests'].append('identical replay preserves every stock, receipt, cost and journal row')

            def reject(label, fixture_row, sql=None, expected=None, identity=None):
                prior = state(db)
                try:
                    db.sql((identity or actor(fixture_row['branch'])) + (sql or rpc(fixture_row)))
                except RuntimeError as error:
                    if expected:
                        assert expected in str(error), str(error)
                else:
                    raise AssertionError(label + ': rejected operation succeeded')
                assert state(db) == prior, label + ': partial state survived'
                result['tests'].append(label)

            reject('changed receipt replay rejects atomically', f, rpc(f,2), 'rincian berbeda')
            # Missing and inactive RETAIL fail closed, without falling back to ONLINE.
            for label, change in [('missing', "type='EXPIRED'"), ('inactive', 'is_active=false')]:
                row = fixture(db)
                db.sql(f"update warehouses set {change} where id='{RETAIL}';")
                reject(label + ' RETAIL rejects with friendly error, no fallback', row, expected='tepat satu gudang RETAIL aktif')
                db.sql(f"update warehouses set type='RETAIL',is_active=true where id='{RETAIL}';")
            extra = str(uuid.uuid4())
            db.sql(f"insert into warehouses(id,branch_id,code,name,type) values('{extra}','{PET}','ZZ-SECOND-RETAIL','Fictional ambiguous retail','RETAIL');")
            reject('ambiguous active RETAIL rejects atomically', fixture(db), expected='tepat satu gudang RETAIL aktif')
            db.sql(f"update warehouses set is_active=false where id='{extra}';")
            for kind, branch in [('DC',PET),('EXPIRED',PET),('RETAIL',WEB)]:
                wh = str(uuid.uuid4())
                db.sql(f"insert into warehouses(id,branch_id,code,name,type) values('{wh}','{branch}','{('Z' if branch==WEB else '0')}-{wh[:12]}','Fictional unrelated warehouse','{kind}');")
            excluded = fixture(db)
            db.sql(actor() + rpc(excluded))
            assert qty(db,RETAIL,excluded)=='36'
            assert db.last(f"select count(*) from stock where item_id='{excluded['item']}' and qty<>0 and warehouse_id<>'{RETAIL}';")=='0'
            result['tests'].append('ONLINE TRANSIT DC EXPIRED foreign RETAIL and inactive RETAIL excluded')
            # Distinct legitimate non-store branches retain exact original code-order rule.
            dc_receiving = str(uuid.uuid4())
            db.sql(f"insert into warehouses(id,branch_id,code,name,type) values('{dc_receiving}','{DC}','0-DC-DEST','Fictional DC receiver','DC');")
            for branch, destination, name in [(VET,'fa300000-0000-4000-8000-000000000005','KLINIK/VET'),(DC,dc_receiving,'DC/DC'),(WEB,'fa300000-0000-4000-8000-000000000006','ONLINE/ONLINE')]:
                # Unrelated foreign RETAIL sorts later; legitimate ONLINE remains usable.
                destination = db.last(f"select id from warehouses where branch_id='{branch}' and is_active and type<>'TRANSIT' order by code,id limit 1;")
                row = fixture(db,branch)
                db.sql(actor(branch) + rpc(row))
                assert qty(db,destination,row)=='36'
                result['tests'].append(name + ' distinct nonPETSHOP original selector unchanged')
            # Partial receipt returns untouched transit quantities to the source DC.
            partial = fixture(db)
            answer = db.sql(actor() + rpc(partial,2)).splitlines()[-1]
            assert Decimal(answer.split('|')[-1]) == -1 and qty(db,RETAIL,partial)=='24' and qty(db,SOURCE,partial)=='12' and qty(db,TRANSIT,partial)=='0'
            assert Decimal(db.last(f"select sum(qty_left*unit_cost) from stock_layers where item_id='{partial['item']}';"))==156
            assert Decimal(db.last(f"select sum(qty_left*unit_cost) from stock_layers where item_id='{partial['item']}' and warehouse_id='{RETAIL}';"))==96
            assert Decimal(db.last(f"select sum(qty_left*unit_cost) from stock_layers where item_id='{partial['item']}' and warehouse_id='{SOURCE}';"))==60
            assert db.last(f"select coalesce(sum(qty*unit_cost)=0,false) from stock_moves where source_ref='{partial['request']}';")=='t'
            result['tests'].append('partial receipt factor12 FIFO96 plus return60 equals original156; selisih -1')
            damaged = fixture(db)
            db.sql(actor() + rpc(damaged,3,'rusak'))
            assert qty(db,RETAIL,damaged)=='0' and qty(db,SOURCE,damaged)=='36'
            result['tests'].append('damaged condition returns full shipment without destination stock')
            surplus = fixture(db,requested=2)
            assert Decimal(db.sql(actor() + rpc(surplus)).splitlines()[-1].split('|')[-1]) == 1
            assert qty(db,RETAIL,surplus)=='36'
            result['tests'].append('surplus against ordered qty preserves shipped ceiling and selisih +1')
            # No-transit requests keep their direct-source behavior.
            direct = fixture(db,transit=False)
            db.sql(actor() + rpc(direct))
            assert qty(db,RETAIL,direct)=='36' and qty(db,SOURCE,direct)=='0'
            result['tests'].append('original direct-source no-transit receipt preserved')
            pending = fixture(db)
            reject('foreign branch actor denied', pending, identity=actor(PET,FOREIGN), expected='Akses transaksi stok ditolak')
            reject('wrong request branch denied', pending, rpc(pending,branch=DC), expected='Permintaan/cabang tidak cocok')
            db.sql(f"update profiles set is_active=false where id='{OWNER}';")
            reject('inactive receiver denied', pending, expected='Akses transaksi stok ditolak')
            db.sql(f"update profiles set is_active=true where id='{OWNER}';")
            reject('anonymous receipt denied', pending, identity=actor(PET,None,'anon'), expected='permission denied')
            reject('failed line read rolls back inserted receipt', pending, rpc(pending,line=str(uuid.uuid4())), expected='Rincian/qty penerimaan tidak valid')
            reject('quantity above shipped ceiling denied', pending, rpc(pending,4), expected='Rincian/qty penerimaan tidak valid')
            unauthorized = fixture(db)
            db.sql(f"update stock_requests set approved_by='{FOREIGN}' where id='{unauthorized['request']}';")
            reject('nonapprover cannot authorize shipment receipt',unauthorized,expected='persetujuan gudang yang sah')
            # Retain the original open-shift fallback without granting STAFF the POS module.
            db.sql(f"insert into user_branches(user_id,branch_id) values('{FOREIGN}','{PET}'),('{FOREIGN}','{VET}');delete from role_modules where role='STAFF';")
            staff_pet = fixture(db)
            reject('STAFF without POS module or open shift denied',staff_pet,identity=actor(PET,FOREIGN),expected='Akses transaksi stok ditolak')
            db.sql(f"insert into cashier_shifts(branch_id,opened_by,status,shift_type) values('{PET}','{FOREIGN}','open','petshop');")
            db.sql(actor(PET,FOREIGN)+rpc(staff_pet))
            assert qty(db,RETAIL,staff_pet)=='36'
            result['tests'].append('authorized STAFF petshop open-shift fallback preserved')
            staff_vet = fixture(db,VET)
            reject('clinic receipt requires original clinic shift without POS module',staff_vet,identity=actor(VET,FOREIGN),expected='Shift klinik penerimaan belum terbuka')
            db.sql(f"insert into cashier_shifts(branch_id,opened_by,status,shift_type) values('{VET}','{FOREIGN}','open','klinik');")
            db.sql(actor(VET,FOREIGN)+rpc(staff_vet))
            assert qty(db,'fa300000-0000-4000-8000-000000000005',staff_vet)=='36'
            result['tests'].append('authorized STAFF clinic module and open-shift fallback preserved')
            # Two lines: valid first moves stock, second actual FIFO shortage rolls everything back.
            shortage = fixture(db)
            missing_item = str(uuid.uuid4())
            missing_line = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
            db.sql(f"insert into items(id,code,name,unit,item_type) values('{missing_item}','RF-SHORTAGE','Fictional shortage','pcs','Persediaan');insert into stock_request_items(id,request_id,item_id,nama,qty_diminta,qty_disetujui,qty_dikirim,satuan,faktor) values('{missing_line}','{shortage['request']}','{missing_item}','Fictional shortage',1,1,1,'pcs',1);")
            payload = json.dumps([{'id':shortage['line'],'qty_diterima':3,'kondisi':'baik'},{'id':missing_line,'qty_diterima':1,'kondisi':'baik'}])
            reject('second-line stock shortage rolls back first-line FIFO, receipt and journals',shortage,f"select * from public.receive_stock_request_atomic('{shortage['request']}','{PET}','{payload}');",expected='Stok gudang asal tidak cukup')
            # Real two-session race, with verified row-lock contention, not a sequential retry.
            race = fixture(db)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(db.sql,actor()+ 'begin;' + rpc(race) + '/* receipt-race-lock */ select pg_sleep(1.5);commit;')
                deadline = time.monotonic()+5
                while db.last("select count(*) from pg_stat_activity where wait_event='PgSleep' and query like '%receipt-race-lock%';")!='1':
                    assert time.monotonic()<deadline,'first receipt did not acquire lock'
                    time.sleep(.02)
                second = pool.submit(db.sql,actor()+rpc(race))
                blocked = False
                while time.monotonic()<deadline:
                    if int(db.last("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%receive_stock_request_atomic%';"))>0:
                        blocked=True
                        break
                    time.sleep(.02)
                first_reply, second_reply = first.result(timeout=10),second.result(timeout=10)
                assert blocked, 'second receipt never waited on first row lock'
            first_number = next(x for x in first_reply.splitlines() if x.startswith('TRM-'))
            second_number = next(x for x in second_reply.splitlines() if x.startswith('TRM-'))
            assert first_number == second_number
            assert db.last(f"select count(*) from stock_receipts where stock_request_id='{race['request']}';")=='1'
            assert db.last(f"select count(*) from stock_receipt_items i join stock_receipts r on r.id=i.stock_receipt_id where r.stock_request_id='{race['request']}';")=='1'
            assert qty(db,RETAIL,race)=='36' and qty(db,TRANSIT,race)=='0'
            assert db.last(f"select sum(qty*unit_cost) from stock_moves where source_ref='{race['request']}';")==baseline_net
            result['tests'].append('concurrent original RPC: observed row lock, same receipt, one detail, stock once, cost conserved')
            # Include private stock writers and RLS again after all RPC regressions.
            assert snapshot(db) == after
            result['status'] = 'passed_with_gap' if result['gaps'] else 'passed'
    except BaseException as error:
        result['status'] = 'failed'
        result['error'] = str(error)
        raise
    finally:
        result['test_count'] = len(result['tests'])
        result['source_hashes'] = {str(p.relative_to(ROOT)): sha(p.read_text()) for p in [Path(__file__), SUITE, CANDIDATE] if p.exists()}
        report_path.write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(result,indent=2), flush=True)

if __name__ == '__main__':
    main()
