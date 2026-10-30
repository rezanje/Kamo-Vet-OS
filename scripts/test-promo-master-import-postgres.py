#!/usr/bin/env python3
"""Full original PG17 chain + actual authenticated import RPC; no network/business stubs.
Run the WHOLE process under flock /opt/data/kamo-heavy-test.lock.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fixture = load('promo_fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
life = load('promo_life', ROOT / 'scripts/test-ranap-mitigasi-penuh-postgres.py')
q, j = life.q, life.j
RESULTS = []


class Harness(life.Harness):
    def sql(self, source, user=None):
        # Modern PostgREST claims only. Never seed legacy sub/role GUCs.
        prefix = (f"set role authenticated;select set_config('request.jwt.claims',"
                  f"{q(json.dumps({'sub': user, 'role': 'authenticated'}))},false);" if user else '')
        return self.db.sql(prefix + source)

    def sistem(self, source, user=life.OWNER):
        return self.db.sql(f"select set_config('request.jwt.claims',"
                           f"{q(json.dumps({'sub': user, 'role': 'authenticated'}))},false);" + source)


def check(name, fn):
    try:
        detail = fn()
        row = {'case': name, 'status': 'PASS', 'detail': detail}
    except Exception as error:
        row = {'case': name, 'status': 'FAIL', 'detail': str(error)}
    RESULTS.append(row)
    print(json.dumps(row), flush=True)


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def plan(name, **changes):
    result = dict(name=name, discount_type='percent', discount_value=10,
                  auto_apply=True, branch_ids=None, valid_from='2026-01-01',
                  valid_until='2099-12-31', min_qty=None, max_qty=None,
                  kelipatan=False, min_subtotal=None, suggest=name, item_ids=[life.ITEM])
    result.update(changes)
    return result


def call(h, entries, user=life.OWNER):
    return json.loads(h.nilai(f'select public.import_promo_master({j(entries)});', user))


def snapshot(h):
    return h.nilai("select md5(jsonb_build_array("
                   "(select jsonb_agg(to_jsonb(p) order by id) from promos p),"
                   "(select jsonb_agg(to_jsonb(p) order by promo_id,item_id) from promo_items p),"
                   "(select count(*) from invoices),(select count(*) from journal_entries),"
                   "(select count(*) from stock_moves))::text)")


def denied(h, entries, user=life.OWNER, expected=None):
    before = snapshot(h)
    error = h.gagal(f'select public.import_promo_master({j(entries)});', user)
    require(error is not None, 'Invalid/forbidden import was accepted')
    if expected:
        require(expected in error, error)
    require(snapshot(h) == before, 'Rejected batch left durable changes')
    return error.splitlines()[0]


def header_denied(h):
    before = snapshot(h)
    source = (f"select set_config('request.headers',{q(json.dumps({'x-kamo-operational-branch': life.BRANCH}))},false);"
              f"select public.import_promo_master({j([plan('Header mismatch',branch_ids=[life.BRANCH2])])});")
    error = h.gagal(source,life.OWNER)
    require(error and 'Cabang promo' in error, 'Operational branch boundary bypassed: '+str(error))
    require(snapshot(h)==before,'Forbidden branch left changes')
    return error.splitlines()[0]


def cmd(db):
    return db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']


def session(db, name, source):
    proc = subprocess.Popen(cmd(db), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True)
    assert proc.stdin is not None
    proc.stdin.write(f"set application_name={q(name)};set statement_timeout='15s';" + source + '\n')
    proc.stdin.flush()
    return proc


def finish(proc, source=''):
    if source:
        proc.stdin.write(source)
        proc.stdin.flush()
    proc.stdin.close()
    proc.stdin = None
    out, err = proc.communicate(timeout=20)
    return proc.returncode, out, err


def wait_lock(db, name, blocker_name):
    samples = []
    end = time.monotonic() + 10
    while time.monotonic() < end:
        out = db.last(f"select coalesce(jsonb_agg(jsonb_build_object('pid',a.pid,'type',a.wait_event_type,"
                      f"'event',a.wait_event,'blockers',pg_blocking_pids(a.pid),'expected',b.pid)),'[]') "
                      f"from pg_stat_activity a cross join pg_stat_activity b "
                      f"where a.application_name={q(name)} and b.application_name={q(blocker_name)}")
        samples = json.loads(out)
        if any(s['type'] == 'Lock' and s['event'] and s['expected'] in s['blockers'] for s in samples):
            return samples
        time.sleep(.03)
    raise AssertionError('Incomplete lock observation: ' + json.dumps(samples))


def concurrency(h):
    db = h.db
    db.sql('create table public.promo_test_gate(id int primary key);insert into public.promo_test_gate values(1);')
    db.sql("""create function public.promo_test_barrier() returns trigger language plpgsql as $$begin
      if current_setting('application_name')='promo-race-a' and new.name='Race B' then
        perform 1 from public.promo_test_gate where id=1 for update;
      end if;return new;end$$;
      create trigger zz_promo_test_barrier after insert or update on public.promos
      for each row execute function public.promo_test_barrier();""")
    claims = f"set local role authenticated;select set_config('request.jwt.claims',{q(json.dumps({'sub': life.OWNER, 'role': 'authenticated'}))},true);"
    gate = a = b = None
    barriers = []
    try:
        gate = session(db, 'promo-race-gate', 'begin;select * from public.promo_test_gate where id=1 for update;')
        # Confirm controller really holds a transaction before starting the writer.
        end = time.monotonic() + 5
        while time.monotonic() < end:
            if db.last("select count(*) from pg_stat_activity where application_name='promo-race-gate' and state='idle in transaction'") == '1':
                break
            time.sleep(.02)
        else:
            raise AssertionError('Controller never locked gate')
        a = session(db, 'promo-race-a', 'begin;' + claims + f"select import_promo_master({j([plan('Race B'),plan('Race A')])});commit;")
        barriers += wait_lock(db, 'promo-race-a', 'promo-race-gate')
        b = session(db, 'promo-race-b', 'begin;' + claims + f"select import_promo_master({j([plan('Race A'),plan('Race B')])});commit;")
        barriers += wait_lock(db, 'promo-race-b', 'promo-race-a')
        require(finish(gate, 'commit;')[0] == 0, 'Gate commit failed')
        gate = None
        ra, rb = finish(a), finish(b)
        a = b = None
        require(ra[0] == rb[0] == 0, json.dumps({'a':ra,'b':rb,'barriers':barriers}))
        require(h.nilai("select count(*) from promos where name in('Race A','Race B')") == '2', 'Duplicate or missing race masters')
        require(h.nilai("select count(*) from promo_items where promo_id in(select id from promos where name in('Race A','Race B'))") == '2', 'Lost race targets')
        return {'barriers': barriers, 'both_committed': True, 'masters': 2, 'targets': 2}
    finally:
        for proc in (a,b,gate):
            if proc is not None:
                if proc.poll() is None:
                    proc.kill()
                proc.communicate()
        db.sql('drop trigger zz_promo_test_barrier on public.promos;drop function public.promo_test_barrier();drop table public.promo_test_gate;')


def workbook_bridge(h, path):
    artifact=json.loads(path.read_text())
    digest=hashlib.sha256(Path(artifact['workbook']).read_bytes()).hexdigest()
    require(digest==artifact['sha256'],'Workbook source hash mismatch')
    # Exact server-action wire fields, excluding preview-only labels/codes.
    fields=tuple(plan('fields').keys())
    payload=[{k:p[k] for k in fields} for p in artifact['plans']]
    require(call(h,payload)=={'created':1,'updated':0},'Real parsed workbook rejected')
    require(h.nilai("select discount_value=20 and branch_ids=array['"+life.BRANCH+"'::uuid] and (select count(*) from promo_items where promo_id=p.id)=2 from promos p where name='Native Workbook'")=='t','Workbook master/targets differ from reviewed plan')
    return {'workbook':artifact['workbook'],'sha256':digest,'public_rpc_saved':True}


def suite(h, excel_plans=None):
    h.sql(life.dasar_sql())
    item2 = life.uid('e', 2)
    h.sql(f"insert into items(id,code,name,unit,item_type,is_active) values('{item2}','PROMO-JASA','Jasa promo','kali','Jasa',true);")
    if excel_plans:
        check('Actual filled template/parser/review output saves through public RPC',lambda:workbook_bridge(h,excel_plans))
    check('OWNER JSON-null all-branch multi-item clinic master', lambda: require(call(h,[plan('Native Global',item_ids=[life.ITEM,item2])]) == {'created':1,'updated':0}, 'Wrong create result'))
    original = h.nilai("select id from promos where name='Native Global'")
    check('JSON-null persists SQL NULL and exact product/service target set', lambda: require(h.nilai(f"select (branch_ids is null) and (select count(*) from promo_items where promo_id=p.id)=2 from promos p where id='{original}'") == 't', 'Wrong stored scope or targets'))
    check('Empty branch array is all branches; replay does not duplicate', lambda: require(call(h,[plan('Native Global',branch_ids=[],item_ids=[life.ITEM,item2])]) == {'created':0,'updated':1}, 'Replay duplicated'))
    check('Same-name case-insensitive update replaces targets, keeps UUID', lambda: require(call(h,[plan('native global',discount_value=15,item_ids=[item2])]) == {'created':0,'updated':1} and h.nilai(f"select id='{original}'::uuid and discount_value=15 and (select array_agg(item_id) from promo_items where promo_id=p.id)=array['{item2}'::uuid] from promos p where lower(name)='native global'") == 't', 'Wrong replacement'))
    check('ADMIN assigned branch save', lambda: require(call(h,[plan('Admin Clinic',branch_ids=[life.BRANCH])],life.ADMIN)['created']==1,'Admin denied'))
    check('ADMIN foreign branch denied and atomic', lambda: denied(h,[plan('Admin Foreign',branch_ids=[life.BRANCH2])],life.ADMIN,'Cabang promo'))
    for role in (life.FINANCE,life.STAFF,life.DOCTOR,life.FIN_NONAKTIF):
        check('Denied actual role '+life.PERAN[role]+(' inactive' if role==life.FIN_NONAKTIF else ''),lambda role=role:denied(h,[plan('Denied '+role)],role,'Hanya owner/manajer'))
    h.sql(f"update profiles set is_active=false where id='{life.ADMIN}';")
    check('Inactive ADMIN denied',lambda:denied(h,[plan('Inactive Admin')],life.ADMIN,'Hanya owner/manajer'))
    h.sql(f"update profiles set is_active=true where id='{life.ADMIN}';")
    for role in ('anon','service_role'):
        def acl(role=role):
            error = h.gagal(f"set role {role};select import_promo_master({j([plan('ACL')])});")
            require(error and 'permission denied' in error, 'Unexpected ACL result: '+str(error))
        check(role+' cannot execute RPC',acl)
    check('Unauthenticated JWT denied',lambda:denied(h,[plan('No JWT')],None,'Hanya owner/manajer'))
    check('Multi-promo valid batch commits together',lambda:require(call(h,[plan('Batch 1'),plan('Batch 2')])=={'created':2,'updated':0},'Wrong totals'))
    check('Invalid second promo rolls back prior INSERT',lambda:denied(h,[plan('Rollback New'),plan('Invalid',discount_value=101)],expected='Nilai diskon'))
    check('Invalid second promo rolls back prior UPDATE and target DELETE',lambda:denied(h,[plan('native global',discount_value=30,item_ids=[life.ITEM]),plan('Invalid',item_ids=[life.uid('e',99)])],expected='Ada barang'))
    for label,changes in [('empty items',{'item_ids':[]}),('null item',{'item_ids':[None]}),('negative minimum',{'min_qty':-1}),('reverse dates',{'valid_from':'2099-01-01','valid_until':'2026-01-01'}),('bad mode',{'discount_type':'package_total'}),('unknown key',{'automatic_trusted':True})]:
        check('Invalid '+label+' atomic',lambda changes=changes:denied(h,[plan('Invalid '+label,**changes)]))
    check('Duplicate batch names rejected atomically',lambda:denied(h,[plan('Dup'),plan(' dup ')],expected='Nama promo muncul'))
    check('More than 50 masters rejected atomically',lambda:denied(h,[plan('Too many '+str(i)) for i in range(51)],expected='1 sampai 50'))
    h.sql(f"insert into promos(name,promo_type,rule) values('Ambiguous','diskon_produk','{{}}'),(' ambiguous ','diskon_produk','{{}}');")
    check('Ambiguous existing names rejected',lambda:denied(h,[plan('AMBIGUOUS')],expected='lebih dari satu promo'))
    h.sql("insert into promos(name,promo_type,rule,discount_type,discount_value,min_qty,is_active) values('Package existing','diskon_produk','{\"discount_mode\":\"package_total\"}','nominal',1000,2,false);")
    check('Package-total existing master not overwritten',lambda:denied(h,[plan('Package existing')],expected='total per paket'))
    inactive_item, inactive_branch = life.uid('e',3), life.uid('e',4)
    h.sql(f"insert into items(id,code,name,unit,item_type,is_active) values('{inactive_item}','PROMO-INACTIVE','Inactive fixture','pcs','Persediaan',false);"
          f"insert into branches(id,code,name,type,is_active) values('{inactive_branch}','PROMO-OFF','Inactive fixture','KLINIK',false);")
    check('Inactive SKU rejected with no changes',lambda:denied(h,[plan('Inactive',item_ids=[inactive_item])],expected='Ada barang'))
    check('Inactive branch rejected',lambda:denied(h,[plan('Inactive Branch',branch_ids=[inactive_branch])],expected='Cabang promo'))
    check('Expired new activation uses existing 353 guard and rolls back whole file',lambda:denied(h,[plan('Expiry rollback first'),plan('Expired',valid_from='2000-01-01',valid_until='2000-12-31')],expected='KADALUARSA'))
    h.sql("insert into promos(name,promo_type,rule,is_active,valid_from,valid_until) values('Expired existing','diskon_produk','{}',false,'2000-01-01','2000-12-31');")
    check('Expired existing cannot reactivate without extending date',lambda:denied(h,[plan('Expired existing',valid_from='2000-01-01',valid_until='2000-12-31')],expected='KADALUARSA'))
    check('Extending expiry reactivates same master',lambda:require(call(h,[plan('Expired existing')])=={'created':0,'updated':1} and h.nilai("select is_active from promos where name='Expired existing'")=='t','Expiry extension failed'))
    check('OWNER operational branch header still restricts explicit targets',lambda:header_denied(h))
    check('More than 500 raw target rows rejected atomically',lambda:denied(h,[plan('Too many targets',item_ids=[life.ITEM]*501)],expected='500'))
    check('Opposite-order overlapping imports serialize without deadlock',lambda:concurrency(h))
    check('Master import does not create money or inventory documents',lambda:require(h.nilai("select (select count(*) from invoices)+(select count(*) from journal_entries)+(select count(*) from stock_moves)")=='0','Master import changed business ledgers'))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json',type=Path,required=True)
    parser.add_argument('--excel-plans',type=Path,help='Exact real workbook parser output emitted by the Vitest bridge')
    parser.add_argument('--lifecycle',action='store_true',help='Run unchanged full clinic money lifecycle cases with modern claims instead of import cases')
    args=parser.parse_args()
    result={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
            'migrations':len(list((ROOT/'supabase/migrations').glob('*.sql'))),
            'claims':'request.jwt.claims only','business_stubs':False,'network':False}
    try:
        with NativePostgres(os.environ.get('KAMO_PG_BIN','/opt/data/kamo-pg-harness/bin')) as db:
            fixture.DisposablePostgres.bootstrap(db)
            result['server_version']=db.sql('show server_version')
            if args.lifecycle:
                life.jalankan(Harness(db))
                RESULTS.extend({'case':r['kasus'],'status':r['status'],'detail':r['detail']} for r in life.HASIL)
            else:
                suite(Harness(db),args.excel_plans)
    except Exception as error:
        check('HARNESS',lambda:require(False,str(error)))
    result['cases']=RESULTS
    result['totals']={s:sum(r['status']==s for r in RESULTS) for s in ('PASS','FAIL')}
    args.json.write_text(json.dumps(result,indent=2))
    print(json.dumps(result['totals']),flush=True)
    sys.exit(bool(result['totals']['FAIL']))


if __name__=='__main__':
    main()
