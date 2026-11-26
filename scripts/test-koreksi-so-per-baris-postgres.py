#!/usr/bin/env python3
"""KOREKSI-SO-PER-BARIS (migrasi *_koreksi_so_per_baris.sql): koreksi SO/penyesuaian hanya memblokir baris yang DIUBAH dan bermasalah.
Native throwaway PostgreSQL only (full migration chain, fictional fixtures). Never accepts a database URL.

  python3 -I scripts/test-koreksi-so-per-baris-postgres.py --pg-bin DIR [--json out.json] [--baseline | --diff | --mutations | --concurrency | --neighbours]
  (default)      chain + candidate: SQL suite supabase/tests/koreksi_so_per_baris.sql, function identity (exactly 4 reviewed functions change, 1 new internal
                 function), ACL, second application fails closed, drift guard, Admin Online fence.
  --baseline     chain WITHOUT the candidate: the suite must fail early AND the defect must be shown (whole document refused for one untouched row).
  --diff         differential: >= 500 randomised documents on the chain WITHOUT and WITH the candidate (classes A all rows changed: identical; B subset changed:
                 untouched rows byte-identical + changed rows equal the old result; C rows with later movements: oracle; D fractional costs: old rounding defect).
  --mutations    every mutant of the candidate in a cloned database must be killed by the suite (>= 40 required).
  --concurrency  independent sessions with real locks (double click, stale token, correction vs charge, correction vs sale).
  --neighbours   existing suites that call the correction functions, with and without the candidate.
Env KR_ATTACH=<cluster root> runs against an already running dev cluster that holds tpl_base (development only).
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse, importlib.util, json, os, random, re, subprocess, sys, tempfile, threading, time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bpbase', ROOT / 'scripts/test-batalkan-penerimaan-petshop-postgres.py')
bp = importlib.util.module_from_spec(spec); sys.modules['bpbase'] = bp; spec.loader.exec_module(bp)
MIGRATIONS, TESTS = bp.MIGRATIONS, bp.TESTS
CANDFILE = sorted(MIGRATIONS.glob('*_koreksi_so_per_baris.sql'))[0]
CAND = CANDFILE.name
bp.CAND = CAND
SUITE = 'koreksi_so_per_baris.sql'
MIN_SUITE = 188
check, raw, clone, run_suite, apply = bp.check, bp.raw, bp.clone, bp.run_suite, bp.apply
NativePostgres, RESULTS, Sess, waiting, sleeping, q1 = bp.NativePostgres, bp.RESULTS, bp.Sess, bp.waiting, bp.sleeping, bp.q1

# Hosted Supabase gives every new public function/table EXECUTE/ALL to anon, authenticated and service_role by default privileges; the bare native chain does not.
PRELUDE = ("alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;\n"
           "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;\n")
SEED = ("insert into coa_accounts(code,name,type,normal_balance) select c,'Fiktif '||c,'BEBAN','D' from unnest(array['720002','720003','720004','740017','740005','720008','740021','740016','730002','720005','720006','720009','740002','740014','740013','740022','740012','760003']) c on conflict(code) do update set is_active=true,is_header=false;\n")
DATA_FIX_KEYS = ('koreksi_saldo_awal_fb', 'ralat_saldo_awal', 'sambung_jurnal_pengeluaran', 'saldo_awal_kas_toko_ke_cabang')
DATA_FIX = [f.read_text() for f in MIGRATIONS.glob('*.sql') if any(k in f.name for k in DATA_FIX_KEYS)]
SKIPPED = []


class Hook:
    def __init__(self, db): self.db = db

    def sql(self, source):
        if source.startswith('begin;\n-- Kategori pengeluaran rinci'): source = SEED + source
        if any(t in source for t in DATA_FIX):
            try: return self.db.sql(source)
            except RuntimeError as e:
                SKIPPED.append(str(e)[:80]); return ''
        return self.db.sql(source)


class Attached:
    """Development only: an already running cluster (KR_ATTACH) that holds tpl_base."""
    def __init__(self, root):
        self.root = Path(root); self.as_user = []
        p = Path('/opt/data/kamo-pg-harness/bin/psql'); self.psql = str(p)

    def __enter__(self): return self

    def __exit__(self, *_): pass

    def sql(self, source):
        r = subprocess.run([self.psql, '-X', '-qAt', '-h', str(self.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=source, text=True, capture_output=True, env={**os.environ, 'PSQLRC': '/dev/null'})
        if r.returncode: raise RuntimeError(r.stderr + r.stdout)
        return r.stdout.strip()


def build_chain(db, exclude=()):
    tmp = Path(tempfile.mkdtemp(prefix='krchain.', dir='/opt/data'))
    try:
        (tmp / 'supabase/migrations').mkdir(parents=True)
        (tmp / 'supabase/tests/fixtures').mkdir(parents=True)
        (tmp / 'supabase/tests/fixtures/hosted_auth_uid.sql').write_text((ROOT / 'supabase/tests/fixtures/hosted_auth_uid.sql').read_text())
        for f in MIGRATIONS.glob('*.sql'):
            if f.name != CAND and f.name not in exclude:
                (tmp / 'supabase/migrations' / f.name).symlink_to(f)
        old = bp.fixture.ROOT
        bp.fixture.ROOT = tmp
        try:
            bp.fixture.DisposablePostgres.bootstrap(Hook(db))
        finally:
            bp.fixture.ROOT = old
    finally:
        for f in (tmp / 'supabase/migrations').glob('*'): f.unlink()
        (tmp / 'supabase/migrations').rmdir()
        for f in (tmp / 'supabase/tests/fixtures').glob('*'): f.unlink()
        (tmp / 'supabase/tests/fixtures').rmdir(); (tmp / 'supabase/tests').rmdir(); (tmp / 'supabase').rmdir(); tmp.rmdir()


def fresh(db):
    if os.environ.get('KR_ATTACH'):
        os.environ.pop('PGDATABASE', None); return
    build_chain(db)
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')


def cand_text(): return CANDFILE.read_text()


def apply_cand(db, name, text=None):
    apply(db, name, PRELUDE + (text if text is not None else cand_text()), later=False)


CHANGED = ['stock_correction_plan(text,uuid,jsonb)', 'correct_stock_document(text,uuid,jsonb,text,text,text)', 'preview_stock_document_correction(text,uuid,jsonb)', 'guard_opname_correction_charge()']
NEWFN = ['stock_correction_charge_note(uuid)']


def fn_digests(db, dbname):
    rc, out, err = raw(db, "select p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid))||'|'||p.prosecdef::text||'|'||coalesce(p.proconfig::text,'')||'|'||p.proowner::regrole::text||'|'||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private','role_settings_private','admin_online_private') and p.prokind in ('f','p')", dbname)
    assert rc == 0, err
    d = {}
    for l in out.splitlines():
        k, rest = l.split('|', 1); d[k] = rest
    return d


def norm(k): return k[7:] if k.startswith('public.') else k


def suite_prefix(marker='-- ═════════ S1 '):
    suite = (TESTS / SUITE).read_text()
    return suite[:suite.index(marker)]


# ------------------------------------------------------------------ green
def run_green(db, a):
    fresh(db)
    clone(db, 'before'); before = {norm(k): v for k, v in fn_digests(db, 'before').items()}
    clone(db, 'cand'); apply_cand(db, 'cand')
    after = {norm(k): v for k, v in fn_digests(db, 'cand').items()}
    changed = sorted(k for k in before if k in after and before[k] != after[k])
    new = sorted(k for k in after if k not in before)
    gone = sorted(k for k in before if k not in after)
    check('IDENTITY existing functions that changed == exactly the 4 reviewed correction functions', changed == sorted(CHANGED) and not gone, (changed, gone))
    check('IDENTITY exactly one new function: stock_correction_charge_note(uuid)', new == NEWFN, new)
    if os.environ.get('KR_EVIDENCE'):
        Path(os.environ['KR_EVIDENCE'], 'native-md5.json').write_text(json.dumps(dict(
            pre={k: before[k].split('|')[0] for k in CHANGED + ['stock_correction_source(text,uuid)']}, post={k: after[k].split('|')[0] for k in CHANGED + NEWFN})))
    check('IDENTITY stock_correction_source/access/row_protected, guard_stock_correction_history, get_stock_document_correction(_result), opname_surplus_cost, post_opname_atomic, stock_out_fifo, stock_in_fifo byte-identical',
          all(before[k] == after[k] for k in before if re.match(r'(stock_correction_source|stock_correction_access|stock_correction_row_protected|guard_stock_correction_history|get_stock_document_correction|get_stock_document_correction_result|opname_surplus_cost|post_opname_atomic|post_inventory_adjustment_atomic|stock_out_fifo|stock_in_fifo|charge_opname_variance_to_employees|cancel_opname_variance_charge|opname_variance_charge_basis)\(', k)), 'unexpected drift')
    for k in CHANGED:
        b = before[k].split('|', 1)[1].split('|'); c = after[k].split('|', 1)[1].split('|')
        check('ACL/DEFINER/config/owner of %s unchanged by the migration' % k.split('(')[0], b[1:] == c[1:] and b[0] == c[0], (b, c))
    rc, out, err = raw(db, "select admin_online_private.fence_all()||'/'||admin_online_private.guard_all()", 'cand')
    after_fence = {norm(k): v for k, v in fn_digests(db, 'cand').items()}
    check('ADMIN_ONLINE fence: fence_all()/guard_all() on top of the candidate change nothing: %s' % out.strip(), rc == 0 and out.strip() == '0/0' and all(after_fence[k] == after[k] for k in CHANGED + NEWFN), (rc, out, err[-200:]))
    rc, out, err = raw(db, "select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('stock_correction_plan','correct_stock_document','preview_stock_document_correction','guard_opname_correction_charge','stock_correction_charge_note') and p.prosecdef and p.proconfig::text like '%search_path=%'", 'cand')
    check('all five functions are SECURITY DEFINER with a fixed (empty) search_path', rc == 0 and out.strip() == '5', out)
    ok, passes, why = run_suite(db, 'cand', SUITE)
    check('SQL suite %s GREEN: %d assertions passed' % (SUITE, len(passes)), ok and len(passes) >= MIN_SUITE, why or 'passes=%d' % len(passes))
    try:
        apply(db, 'cand', cand_text(), later=False); twice = False
    except RuntimeError:
        twice = True
    check('second application of the migration fails closed (md5 source guard and existing function)', twice)
    rc, out, err = raw(db, "select (select count(*) from public.stock_document_corrections)||'/'||(select count(*) from public.stock_document_correction_requests)", 'cand')
    check('migration touches no data (correction trail empty)', rc == 0 and out.strip() == '0/0', out)
    for fn, mutate in (('stock_correction_plan', "create or replace function public.stock_correction_plan(p_kind text,p_id uuid,p_rows jsonb) returns jsonb language sql security definer set search_path='' as $$select null::jsonb$$;"),
                       ('stock_correction_source', "create or replace function public.stock_correction_source(p_kind text,p_id uuid) returns jsonb language sql security definer set search_path='' as $$select null::jsonb$$;")):
        clone(db, 'drift')
        rc0, o0, e0 = raw(db, mutate, 'drift')
        try:
            apply_cand(db, 'drift'); drift_ok = False
        except RuntimeError as e:
            drift_ok = 'KOREKSI_PER_BARIS_SOURCE_CHANGED' in str(e)
        check('source guard: migration against a drifted %s is refused (KOREKSI_PER_BARIS_SOURCE_CHANGED)' % fn, rc0 == 0 and drift_ok)
    rc, out, err = raw(db, "select to_regprocedure('public.stock_correction_charge_note(uuid)') is null", 'drift')
    check('refused migration leaves no partial change (charge-note function absent)', out.strip() == 't', out)


# ------------------------------------------------------------------ baseline
def run_baseline(db, a):
    fresh(db)
    clone(db, 'red')
    ok, passes, why = run_suite(db, 'red', SUITE)
    check('RED: suite fails at the baseline (%d assertions passed before the first failure)' % len(passes), not ok and len(passes) <= 20, why)
    probe = suite_prefix('create temp table s1p as select pg_temp.pv') if False else None
    suite = (TESTS / SUITE).read_text()
    cut = suite.index("create temp table s1pre as")
    probe = suite[:cut] + r"""
select 'DEFECT preview th4->1,sh->0 on OPR9 shape: '||pg_temp.pve('s1','{"th4":1,"sh":0}');
select 'DEFECT preview only pel untouched, th4 only: '||pg_temp.pve('s1','{"th4":1}');
rollback;
"""
    rc, out, err = raw(db, probe, 'red')
    lines = [l for l in out.splitlines() if l.startswith('DEFECT')]
    check('RED defect shown on the old function: the OPR.00009-shaped correction (TH4, Shampoo) is refused as a whole because ANOTHER row (Pelontar) has a used layer', rc == 0 and len(lines) == 2 and all('OK' != l.rsplit(': ', 1)[-1] for l in lines) and 'terpakai' in lines[0], lines or err[-300:])


# ------------------------------------------------------------------ differential
DIFF_PRELUDE = r"""
begin;
insert into auth.users(id,raw_user_meta_data) values('d1000000-0000-4000-8000-000000000001','{"full_name":"DK owner"}');
update profiles set role='OWNER',is_active=true where id='d1000000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values('d2000000-0000-4000-8000-000000000001','DKA','DK klinik','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','DKW','DK gudang','VET');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) values('170001','Persediaan','ASET','D',false,true),('720010','Beban selisih','BEBAN','D',false,true),('810004','Pendapatan lain','PENDAPATAN','K',false,true),('182001','Kasbon karyawan','ASET','D',false,true) on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
create function pg_temp.snap(wh uuid,iid uuid) returns jsonb language sql as $$
 select jsonb_build_object('stock',(select qty from public.stock where warehouse_id=wh and item_id=iid),
  'layers',(select coalesce(jsonb_agg(jsonb_build_array(qty_left,unit_cost,qty_in,source) order by unit_cost,qty_in,qty_left,source),'[]') from public.stock_layers where warehouse_id=wh and item_id=iid),
  'nmoves',(select count(*) from public.stock_moves where warehouse_id=wh and item_id=iid))$$;
create function pg_temp.jn(cid text) returns jsonb language sql as $$
 select coalesce(jsonb_object_agg(code,net),'{}') from (select a.code,sum(l.debit-l.credit) net from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
  join public.journal_entries e on e.id=l.entry_id where e.source in('stock-correct-reverse','stock-correction') and e.source_ref=cid group by a.code) x$$;
create function pg_temp.runcase(seed int,spec jsonb) returns jsonb language plpgsql as $$
declare it jsonb;i int:=0;wh uuid:='d3000000-0000-4000-8000-000000000001';oid uuid:=gen_random_uuid();counts jsonb:='{}';iid uuid;l jsonb;n int;
 r jsonb;err text;ref text;rid uuid;pre jsonb:='{}';post jsonb:='{}';rws jsonb;pv jsonb;perr text;cr jsonb;cerr text;chg jsonb:=spec->'changes';x jsonb;cur numeric;lat numeric;
 ids uuid[]:='{}';sref text;cid text;mv numeric;tok text;nb numeric;
begin
 for it in select * from jsonb_array_elements(spec->'items') loop
  i:=i+1;iid:=md5('dk-'||seed||'-'||i)::uuid;ids:=ids||iid;
  insert into public.items(id,code,name,unit,item_type,buy_price,sell_price) values(iid,'DK-'||seed||'-'||i,'Barang DK '||seed||'-'||i,'PCS','Persediaan',(it->>'master')::numeric,100);
  n:=0;
  for l in select * from jsonb_array_elements(it->'layers') loop
   n:=n+1;perform public.stock_in_fifo(wh,iid,(l->>'qty')::numeric,(l->>'cost')::numeric,'fixture','DK-'||seed||'-'||i||'-'||n,(now() at time zone 'Asia/Jakarta')::date-(10-n),null);
  end loop;
  insert into public.stock(warehouse_id,item_id,qty) values(wh,iid,0) on conflict do nothing;
  counts:=counts||jsonb_build_object(iid::text,(select coalesce(sum(qty),0) from public.stock where warehouse_id=wh and item_id=iid)+(it->>'delta')::numeric);
 end loop;
 insert into public.opname_orders(id,no_opname,warehouse_id,penanggung_jawab) values(oid,'OPO.DK.'||seed,wh,'Penghitung');
 perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin
  r:=public.post_opname_atomic(oid,(now() at time zone 'Asia/Jakarta')::date,counts);ref:=r->>'no_hasil';rid:=(r->>'result_id')::uuid;
 exception when others then err:=sqlerrm;
 end;
 if err is not null then return jsonb_build_object('seed',seed,'err',err);end if;
 i:=0;
 for it in select * from jsonb_array_elements(spec->'items') loop
  i:=i+1;iid:=ids[i];lat:=coalesce((it->>'later')::numeric,0);
  if lat>0 then
   perform public.stock_out_fifo(wh,iid,lat,'sale','DKS-'||seed||'-'||i,(now() at time zone 'Asia/Jakarta')::date);
   update public.stock_moves set created_at=created_at+interval '1 hour' where source='sale' and source_ref='DKS-'||seed||'-'||i;
  end if;
  pre:=pre||jsonb_build_object(i::text,pg_temp.snap(wh,iid));
 end loop;
 rws:='[]';
 for x in select * from jsonb_array_elements(public.get_stock_document_correction('opname',rid)->'rows') loop
  i:=array_position(ids,(x->>'item_id')::uuid);
  rws:=rws||jsonb_build_array(jsonb_build_object('item_id',x->>'item_id','qty',coalesce((chg->>i::text)::numeric,(x->>'qty')::numeric)));
 end loop;
 begin pv:=public.preview_stock_document_correction('opname',rid,rws);tok:=pv->>'token';
 exception when others then perr:=sqlerrm;end;
 if perr is null then
  begin cr:=public.correct_stock_document('opname',rid,rws,'Uji diferensial','dk-'||seed,tok);
  exception when others then cerr:=sqlerrm;end;
 end if;
 i:=0;
 for it in select * from jsonb_array_elements(spec->'items') loop i:=i+1;post:=post||jsonb_build_object(i::text,pg_temp.snap(wh,ids[i]));end loop;
 cid:=cr->>'correction_id';
 select coalesce(sum(m.qty*m.unit_cost),0) into mv from public.stock_moves m where m.source in('stock-correct-reverse','stock-correction') and m.source_ref=cid;
 return jsonb_build_object('seed',seed,'err',null,'pre',pre,'post',post,'perr',perr,'cerr',cerr,
  'pv',case when pv is null then null else jsonb_build_object('applied',pv->'applied','blocked',coalesce((select jsonb_agg(jsonb_build_object('name',b->>'name','reason',b->>'reason') order by b->>'name') from jsonb_array_elements(pv->'blocked') b),'[]'::jsonb),'delta',pv->'value_delta') end,
  'cr',case when cr is null then null else jsonb_build_object('revision',cr->'revision','applied',cr->'applied','nblocked',jsonb_array_length(coalesce(cr->'blocked','[]'::jsonb))) end,
  'jcorr',pg_temp.jn(cid),'mv',mv,
  'unbal',(select count(*) from (select e.id from public.journal_entries e join public.journal_lines l on l.entry_id=e.id where e.source in('opname','stock-correct-reverse','stock-correction') and (e.source_ref=ref or e.source_ref=cid) group by e.id having sum(l.debit-l.credit)<>0) u),
  'ids',to_jsonb(ids::text[]));
end$$;
"""


def r2(x): return round(float(x) + 1e-9, 2)


def gen_cases(n, rnd):
    cases = []
    costs2 = [25, 40, 55.5, 100, 120.25, 333]
    costs_frac = [12.3456, 99.9999, 3.3333, 1234.5678, 7.1234]
    for seed in range(1, n + 1):
        cls = 'A' if seed % 10 in (1, 2, 3) else 'B' if seed % 10 in (4, 5, 6) else 'C' if seed % 10 in (7, 8, 9) else 'D'
        k = rnd.randint(2, 5) if cls != 'D' else rnd.randint(2, 4)
        items = []
        for _ in range(k):
            costs = costs_frac if cls == 'D' else costs2
            layers = [dict(qty=rnd.randint(2, 12), cost=rnd.choice(costs)) for _ in range(rnd.randint(1, 3))]
            have = sum(l['qty'] for l in layers)
            delta = rnd.choice([-rnd.randint(1, have), -rnd.randint(1, have), 0, rnd.randint(1, 6), rnd.randint(1, 6)])
            if cls == 'D' and delta == 0: delta = -1
            items.append(dict(layers=layers, master=rnd.choice([25, 60, 75]), delta=delta, later=0, cur=have + delta))
        if all(i['delta'] == 0 for i in items): items[0]['delta'] = -1; items[0]['cur'] = sum(l['qty'] for l in items[0]['layers']) - 1
        for it in items: it['cur'] = sum(l['qty'] for l in it['layers']) + it['delta']

        def newq(it):
            cur = it['cur']
            c = [cur + d for d in (-3, -2, -1, 1, 2, 3, 6) if cur + d >= 0 and cur + d != cur]
            return rnd.choice(c)
        changes = {}
        idx = list(range(1, len(items) + 1))
        if cls == 'A' or cls == 'D':
            for i in idx: changes[i] = newq(items[i - 1])
        elif cls == 'B':
            for i in rnd.sample(idx, rnd.randint(1, max(1, len(idx) - 1))): changes[i] = newq(items[i - 1])
        else:
            for i in rnd.sample(idx, rnd.randint(1, len(idx))): changes[i] = newq(items[i - 1])
            lat = rnd.sample(idx, rnd.randint(1, len(idx)))
            for i in lat:
                cur = items[i - 1]['cur']
                if cur >= 1: items[i - 1]['later'] = rnd.randint(1, cur)
            if all(items[i - 1]['later'] == 0 for i in idx):  # keep class C meaningful
                for it in items:
                    if it['cur'] >= 1: it['later'] = 1; break
        # a later sale on a changed row must not leave a requested qty below the later qty (irrelevant: that row is blocked), requests stay >= 0
        cases.append(dict(seed=seed, cls=cls, spec=dict(items=items, changes={str(k): v for k, v in changes.items()})))
    return cases


def case_sql(cases):
    return DIFF_PRELUDE + "".join("select 'CASE '||pg_temp.runcase(%d,%s::jsonb)::text;\n" % (c['seed'], "'" + json.dumps(c['spec']).replace("'", "''") + "'") for c in cases) + "rollback;\n"


def parse(out):
    d = {}
    for l in out.splitlines():
        if l.startswith('CASE '):
            j = json.loads(l[5:]); d[j['seed']] = j
    return d


def run_diff(db, a):
    rnd = random.Random(20261126)
    cases = gen_cases(int(os.environ.get('KR_DIFF_N', '540')), rnd)
    fresh(db)
    clone(db, 'old'); clone(db, 'new'); apply_cand(db, 'new')
    outs = {}
    for name in ('old', 'new'):
        rc, out, err = raw(db, case_sql(cases), name)
        outs[name] = parse(out)
        check('DIFF %s: all %d cases executed' % (name, len(cases)), rc == 0 and len(outs[name]) == len(cases), (rc, len(outs[name]), err[-300:]))
    o, n = outs['old'], outs['new']
    bad = {'A': [], 'B': [], 'C': [], 'D': [], 'X': []}
    cnt = {'A': 0, 'B': 0, 'C': 0, 'D': 0}
    stats = dict(new_ok=0, old_err=0, blocked_cases=0, partial=0, rounding_old_fail=0)
    for c in cases:
        s, cls = c['seed'], c['cls']; ro, rn = o.get(s), n.get(s)
        cnt[cls] += 1
        if not ro or not rn: bad['X'].append((s, 'missing')); continue
        if ro.get('err') or rn.get('err'):
            if ro.get('err') != rn.get('err'): bad['X'].append((s, 'SO posting error differs', ro.get('err'), rn.get('err')))
            continue
        items = c['spec']['items']; changes = {int(k): v for k, v in c['spec']['changes'].items()}
        nchg = len(changes)
        # invariants on the NEW side for every case: stock == sum of layers, journals balanced
        for i, snap in rn['post'].items():
            if abs(float(snap['stock']) - sum(float(l[0]) for l in snap['layers'])) > 1e-9: bad[cls].append((s, 'new: stock != sum(layers)', i)); break
        if rn['unbal'] != 0 or ro['unbal'] != 0: bad[cls].append((s, 'unbalanced journal', ro['unbal'], rn['unbal']))
        later = {i for i in range(1, len(items) + 1) if items[i - 1]['later'] > 0}
        if rn.get('cerr') is None and rn.get('perr') is None and rn.get('cr'):
            stats['new_ok'] += 1
        if ro.get('perr') or ro.get('cerr'): stats['old_err'] += 1
        if cls in ('A', 'B'):
            if rn.get('perr') or rn.get('cerr'): bad[cls].append((s, 'new refused a clean correction', rn.get('perr') or rn.get('cerr'))); continue
            if ro.get('perr') or ro.get('cerr'): bad[cls].append((s, 'old refused a clean correction', ro.get('perr') or ro.get('cerr'))); continue
            if rn['cr']['applied'] != nchg or rn['cr']['nblocked'] != 0 or rn['pv']['blocked'] != []: bad[cls].append((s, 'applied/blocked', rn['cr'], nchg))
            for i in range(1, len(items) + 1):
                si = str(i)
                if i in changes:
                    if float(rn['post'][si]['stock']) != changes[i]: bad[cls].append((s, 'new stock != requested', i)); break
                    if rn['post'][si]['layers'] != ro['post'][si]['layers'] or rn['post'][si]['stock'] != ro['post'][si]['stock']: bad[cls].append((s, 'changed row: layers/stock differ old vs new', i, rn['post'][si]['layers'], ro['post'][si]['layers'])); break
                else:
                    if rn['post'][si] != rn['pre'][si]: bad[cls].append((s, 'untouched row changed by new', i)); break
            if cls == 'A':
                # every row changed: the old full replay and the per-row plan must agree on value and on every account of the correction journals
                if r2(rn['pv']['delta']) != r2(ro['pv']['delta']): bad[cls].append((s, 'preview value_delta differs', rn['pv']['delta'], ro['pv']['delta']))
                for code in set(rn['jcorr']) | set(ro['jcorr']):
                    if abs(float(rn['jcorr'].get(code, 0)) - float(ro['jcorr'].get(code, 0))) > 0.0101: bad[cls].append((s, 'correction journal differs', code, rn['jcorr'].get(code), ro['jcorr'].get(code)))
            # new side: 170001 journal net of the correction == value of the correction moves (rounded per replacement row)
            if abs(float(rn['jcorr'].get('170001', 0)) - float(rn['mv'])) > 0.011 * max(1, nchg): bad[cls].append((s, 'new: 170001 journal != correction moves value', rn['jcorr'].get('170001'), rn['mv']))
            if abs(sum(float(v) for v in rn['jcorr'].values())) > 0.0001: bad[cls].append((s, 'new: correction journals unbalanced', rn['jcorr']))
        elif cls == 'C':
            blocked_exp = sorted(i for i in changes if i in later); applied_exp = sorted(i for i in changes if i not in later)
            if later and not (ro.get('perr') or ro.get('cerr')): bad[cls].append((s, 'old accepted a document that has a later movement'))
            names = lambda ix: sorted('Barang DK %d-%d' % (s, i) for i in ix)
            if not applied_exp:
                if not rn.get('perr') or not rn['perr'].startswith('Koreksi tidak bisa disimpan') or not all(nm in rn['perr'] for nm in names(blocked_exp)):
                    # >8 blocked rows are truncated; documents here have at most 5 rows
                    bad[cls].append((s, 'all-blocked: expected the refusal naming every blocked row', rn.get('perr'), names(blocked_exp)))
                if not later or not blocked_exp: bad[cls].append((s, 'class C case without a blocked row'))
                post_same = all(rn['post'][str(i)] == rn['pre'][str(i)] for i in range(1, len(items) + 1))
                if not post_same: bad[cls].append((s, 'refused correction left a trace'))
                continue
            stats['blocked_cases'] += 1 if blocked_exp else 0
            stats['partial'] += 1 if blocked_exp and applied_exp else 0
            if rn.get('perr') or rn.get('cerr'): bad[cls].append((s, 'new refused though some rows are clean', rn.get('perr') or rn.get('cerr'))); continue
            got_blocked = sorted(b['name'] for b in rn['pv']['blocked'])
            if got_blocked != names(blocked_exp) or rn['pv']['applied'] != len(applied_exp) or rn['cr']['applied'] != len(applied_exp) or rn['cr']['nblocked'] != len(blocked_exp):
                bad[cls].append((s, 'applied/blocked set != oracle', got_blocked, names(blocked_exp), rn['pv']['applied']))
            for i in range(1, len(items) + 1):
                si = str(i)
                if i in applied_exp:
                    if float(rn['post'][si]['stock']) != changes[i]: bad[cls].append((s, 'applied row stock != requested', i)); break
                elif rn['post'][si] != rn['pre'][si]: bad[cls].append((s, 'blocked/untouched row was touched', i)); break
            if abs(float(rn['jcorr'].get('170001', 0)) - float(rn['mv'])) > 0.011 * max(1, nchg): bad[cls].append((s, 'new: 170001 journal != moves value', rn['jcorr'].get('170001'), rn['mv']))
        else:  # D fractional costs
            if ro.get('perr') or ro.get('cerr'): stats['rounding_old_fail'] += 1
            if rn.get('perr') or rn.get('cerr'): bad[cls].append((s, 'new refused fractional-cost correction', rn.get('perr') or rn.get('cerr'))); continue
            if rn['cr']['applied'] != nchg: bad[cls].append((s, 'applied != changed', rn['cr'], nchg))
            if abs(float(rn['jcorr'].get('170001', 0)) - float(rn['mv'])) > 0.011 * max(1, nchg): bad[cls].append((s, 'new: 170001 journal != moves value (fractional)', rn['jcorr'].get('170001'), rn['mv']))
            if abs(sum(float(v) for v in rn['jcorr'].values())) > 0.0001: bad[cls].append((s, 'new: correction journals unbalanced', rn['jcorr']))
    check('DIFF classes: %s (>= 500 documents)' % cnt, sum(cnt.values()) >= 500 and all(v >= 40 for v in cnt.values()), cnt)
    check('DIFF A (every row changed, clean): %d documents: new == old on per-row stock and layers, preview value_delta and every account of the correction journals' % cnt['A'], not bad['A'], bad['A'][:3])
    check('DIFF B (subset changed, clean): %d documents: untouched rows byte-identical (stock, layers, kartu stok), changed rows == old result and == requested qty, journal == stock value' % cnt['B'], not bad['B'], bad['B'][:3])
    check('DIFF C (rows with later movements): %d documents: old refuses every one, new applies exactly the changed rows without a later movement and names the others; all-blocked refusal names every row, no trace' % cnt['C'], not bad['C'], bad['C'][:3])
    check('DIFF D (fractional costs): %d documents: new succeeds with balanced journals (old refused %d of them on rounding)' % (cnt['D'], stats['rounding_old_fail']), not bad['D'], bad['D'][:3])
    check('DIFF no case missing and SO posting identical on both sides', not bad['X'], bad['X'][:3])
    check('DIFF coverage: %(new_ok)d corrections saved by new, %(blocked_cases)d documents with blocked rows, %(partial)d partial (some applied, some blocked), old refused %(old_err)d' % stats, stats['new_ok'] >= 250 and stats['partial'] >= 20 and stats['blocked_cases'] >= 40, stats)


# ------------------------------------------------------------------ mutants
# Mutants that are PROVABLY equivalent: the guard they remove cannot fire once the guards before it hold. They are run and reported, never counted as killed.
#  M22: 'Lapisan FIFO tidak cukup untuk koreksi' needs needed > sum(virtual layers); but the stock check before it enforces r.qty-newqty <= current_qty, and the
#  virtual layers sum to current_qty (old_diff = 0) or current_qty - old_diff (old_diff < 0, enforced by the 'Bukti FIFO' guard), so needed <= sum(virtual) always.
EQUIVALENT = [
    ('M22 plan: lapisan FIFO tidak cukup tidak ditahan', "if needed>0 then raise exception using errcode='KR001',message='Lapisan FIFO tidak cukup untuk koreksi'", "if false then raise exception using errcode='KR001',message='Lapisan FIFO tidak cukup untuk koreksi'"),
]


def mutants():
    T = lambda *pairs: list(pairs)
    X = [
     ('M01 plan: semua baris dianggap diubah (baris tak diubah ikut diperiksa)', "is_changed:=newqty<>r.qty;", "is_changed:=true;"),
     ('M02 plan: baris tak diubah tidak lagi dilewati', "  if not is_changed then\n   replacement:=replacement+old_value;", "  if not is_changed and false then\n   replacement:=replacement+old_value;"),
     ('M03 plan: baris tak diubah kehilangan nilai pada rows', "'qty',r.qty,'selisih',old_diff,'value',old_value,'exp_date',r.exp_date)||case when old_diff<>0 then jsonb_build_object('src',rsrc,'src_ref',rref) else '{}'::jsonb end);\n   continue;\n  end if;\n  reason:=null;", "'qty',r.qty,'selisih',old_diff,'value',0,'exp_date',r.exp_date)||case when old_diff<>0 then jsonb_build_object('src',rsrc,'src_ref',rref) else '{}'::jsonb end);\n   continue;\n  end if;\n  reason:=null;"),
     ('M04 plan: baris tak diubah tidak membawa sumber (rantai revisi putus)', "'exp_date',r.exp_date)||case when old_diff<>0 then jsonb_build_object('src',rsrc,'src_ref',rref) else '{}'::jsonb end);\n   continue;\n  end if;\n  reason:=null;", "'exp_date',r.exp_date)||'{}'::jsonb);\n   continue;\n  end if;\n  reason:=null;"),
     ('M05 plan: nilai baris tertahan tidak masuk jumlah pengganti', "'reason',reason));\n   replacement:=replacement+old_value;", "'reason',reason));\n   replacement:=replacement+0;"),
     ('M06 plan: barang nonaktif tidak menahan baris', "if pre_block ? r.item_id::text then raise exception '%',pre_block->>r.item_id::text using errcode='KR001';end if;", "null;"),
     ('M07 plan: barang nonaktif lolos pemeriksaan master', "where id=r.item_id and is_active and coalesce(item_type,'Persediaan')='Persediaan' for share;", "where id=r.item_id and coalesce(item_type,'Persediaan')='Persediaan' for share;"),
     ('M08 plan: selisih kurang gudang non-VET tanpa faktur diizinkan', "if p_kind='opname' and new_diff<0 and exists(select 1 from public.warehouses w", "if false and p_kind='opname' and new_diff<0 and exists(select 1 from public.warehouses w"),
     ('M09 plan: saldo vs lapisan tidak dicocokkan', "if current_qty<0 or current_qty::text in('NaN','Infinity','-Infinity') or current_qty is distinct from", "if false and current_qty is distinct from"),
     ('M10 plan: revisi lanjutan tidak membandingkan lapisan/mutasi barang', "if (state->>'revision')::integer>0 and (\n    (select coalesce(jsonb_agg(x order by x->>'id'),'[]') from jsonb_array_elements(layers)x", "if false and (\n    (select coalesce(jsonb_agg(x order by x->>'id'),'[]') from jsonb_array_elements(layers)x"),
     ('M11 plan: bukti proof (lapisan setelah SO) tidak dibandingkan', "exists(select 1 from jsonb_array_elements(proof.layers_after)x where x is distinct from", "exists(select 1 from jsonb_array_elements(proof.layers_after)x where false and x is distinct from"),
     ('M12 plan: mutasi sesudah SO tidak menahan baris', "limit 1;\n    if found then raise exception using errcode='KR001',message='Stok sudah terpakai, terjual, diretur atau dipindahkan.", "limit 1;\n    if false then raise exception using errcode='KR001',message='Stok sudah terpakai, terjual, diretur atau dipindahkan."),
     ('M13 plan: pemeriksaan mutasi sesudah SO hanya untuk revisi 0 (baris pembawa sumber lolos)', "if (state->>'revision')::integer=0 or r.src is not null then", "if (state->>'revision')::integer=0 then"),
     ('M14 plan: lapisan lebih asal terpakai tidak menahan', "if l.qty_in<>old_diff or l.qty_left<>l.qty_in or l.unit_cost<>m.unit_cost then raise", "if false then raise"),
     ('M15 plan: lapisan lebih asal tidak dikembalikan 0 (tetap tersedia)', "     restored:=0;expiry:=l.exp_date;", "     expiry:=l.exp_date;"),
     ('M16 plan: pengambilan SO lama tidak dipulihkan ke lapisan', "     restored:=restored+take;", "     restored:=restored;"),
     ('M17 plan: lapisan melebihi qty_in tidak ditolak', "     if restored>l.qty_in then raise", "     if false then raise"),
     ('M18 plan: asal lapisan masuk tidak harus tepat 1', "  if old_diff>0 and (select count(*) from jsonb_to_recordset(layers)x(item_id uuid,source text,source_ref text) where x.item_id=r.item_id and x.source=rsrc and x.source_ref=rref)<>1 then", "  if false and old_diff>0 and (select count(*) from jsonb_to_recordset(layers)x(item_id uuid,source text,source_ref text) where x.item_id=r.item_id and x.source=rsrc and x.source_ref=rref)<>1 then"),
     ('M19 plan: jumlah pengambilan FIFO lama tidak diperiksa', "(select sum(x.qty) from jsonb_to_recordset(m.fifo_takes)x(qty numeric)) is distinct from -old_diff or", "false or"),
     ('M20 plan: jumlah lapisan virtual tidak diperiksa', "(select sum((x->>'qty')::numeric) from jsonb_array_elements(virtual)x) is distinct from current_qty-old_diff) then", "false) then"),
     ('M21 plan: stok tidak cukup tidak ditahan', "if current_qty+newqty-r.qty<0 then raise exception using errcode='KR001'", "if false then raise exception using errcode='KR001'"),
     ('M23 plan: pengurangan memakai lapisan Rp0 tidak ditahan', "if new_diff<0 and exists(select 1 from jsonb_to_recordset(takes)x(unit_cost numeric) where x.unit_cost=0) then", "if false and new_diff<0 and exists(select 1 from jsonb_to_recordset(takes)x(unit_cost numeric) where x.unit_cost=0) then"),
     ('M24 plan: harga master tidak valid tidak ditahan', "if buy is null or buy<0 or buy>1e12 or buy::text in('NaN','Infinity','-Infinity') then raise exception using errcode='KR001'", "if false then raise exception using errcode='KR001'"),
     ('M25 plan: selisih lebih opname memakai harga master, bukan rata-rata', "if new_diff>0 and p_kind='opname' then select c.unit_cost into buy from public.opname_surplus_cost(wh,r.item_id,buy) c;end if;", "null;"),
     ('M26 plan: nilai pengurangan bertanda terbalik', "value:=case when new_diff>0 then new_diff*buy else -cost end;", "value:=case when new_diff>0 then new_diff*buy else cost end;"),
     ('M27 plan: beban karyawan aktif tidak menahan baris', "if reason is null and charge.id is not null then", "if false and reason is null and charge.id is not null then"),
     ('M28 plan: dampak beban mengabaikan nilai HPP sesudah', "if price is null or price<>0 or old_value<>0 or round(value,2)<>0 then reason:=charge_note;end if;", "if price is null or price<>0 or old_value<>0 then reason:=charge_note;end if;"),
     ('M29 plan: dampak beban mengabaikan nilai HPP sebelum', "if price is null or price<>0 or old_value<>0 or round(value,2)<>0 then reason:=charge_note;end if;", "if price is null or price<>0 or round(value,2)<>0 then reason:=charge_note;end if;"),
     ('M30 plan: harga jual tidak dikenal dianggap tidak berdampak', "if price is null or price<>0 or old_value<>0 or round(value,2)<>0 then reason:=charge_note;end if;", "if price<>0 or old_value<>0 or round(value,2)<>0 then reason:=charge_note;end if;"),
     ('M31 plan: semua baris tertahan tidak berhenti', "if applied=0 then\n  select string_agg", "if false then\n  select string_agg"),
     ('M32 plan: tanpa perubahan tidak ditolak', "if not changed then raise exception 'Jumlah koreksi sama dengan hasil saat ini';end if;", "null;"),
     ('M33 plan: nilai jurnal vs stok tidak dicocokkan', "if abs(inventory-original)>0.000001 or abs(contra+original)>0.000001 then raise", "if false then raise"),
     ('M34 plan: rincian debit/kredit sumber tidak dicocokkan', "if exists(select 1 from (values('170001'::text,array['170001']),('720010'::text,array['720010','810004'])) a(code,codes) where (", "if false and exists(select 1 from (values('170001'::text,array['170001']),('720010'::text,array['720010','810004'])) a(code,codes) where ("),
     ('M35 plan: header penyesuaian tidak dicocokkan', "if p_kind='adjustment' and (state->>'revision')::integer=0 and", "if false and p_kind='adjustment' and (state->>'revision')::integer=0 and"),
     ('M36 plan: jurnal pengganti lupa nilai lama baris diterapkan', "new_in:=greatest(jr_in-ch_old_in+ch_new_in,0);", "new_in:=greatest(jr_in+ch_new_in,0);"),
     ('M37 plan: sisi keluar jurnal pengganti lupa nilai lama', "new_out:=greatest(jr_out-ch_old_out+ch_new_out,0);", "new_out:=greatest(jr_out+ch_new_out,0);"),
     ('M38 plan: nilai lama keluar memakai tanda salah', "ch_old_out:=ch_old_out+greatest(-old_value,0);", "ch_old_out:=ch_old_out+greatest(old_value,0);"),
     ('M39 plan: hasil tidak memuat daftar tertahan', "'blocked',blocked,'applied',applied,'charge_checked',true);", "'blocked','[]'::jsonb,'applied',applied,'charge_checked',true);"),
     ('M40 plan: token tidak mengikat daftar tertahan', "return result||jsonb_build_object('token',md5(result::text));", "return result||jsonb_build_object('token',md5((result-'blocked')::text));"),
     ('M41 plan: nilai opname kurang dibulatkan 2 desimal (aturan lama gagal rekonsiliasi)', "old_value:=round(coalesce(old_diff*m.unit_cost,0),9);", "old_value:=round(coalesce(old_diff*m.unit_cost,0),2);"),
     ('M42 plan: nilai baris revisi lanjutan tidak dicocokkan dengan mutasi', "if abs(old_value-coalesce(old_diff*m.unit_cost,0))>0.0051 then raise", "if false then raise"),
     ('M43 plan: nilai baris koreksi terakhir kosong diterima', "if r.value is null then raise exception 'Nilai baris koreksi terakhir tidak tercatat. Rekonsiliasi diperlukan';end if;", "null;"),
     ('M44 plan: bukti mutasi sumber tidak harus lengkap', "<>(case when old_diff=0 then 0 else 1 end) then raise exception 'Bukti mutasi sumber tidak lengkap. Rekonsiliasi diperlukan';end if;", "<>(case when old_diff=0 then 0 else 1 end) and false then raise exception 'Bukti mutasi sumber tidak lengkap. Rekonsiliasi diperlukan';end if;"),
     ('M45 plan: sumber efek baris tak memakai src revisi', "rsrc:=coalesce(r.src,state->>'source');rref:=coalesce(r.src_ref,state->>'ref');", "rsrc:=state->>'source';rref:=state->>'ref';"),
     ('M46 plan: faktur tagihan tidak menolak', "if (state->>'invoice_id') is not null then raise exception 'Hasil opname memiliki faktur tagihan.", "if false then raise exception 'Hasil opname memiliki faktur tagihan."),
     ('M47 plan: jurnal sumber void tidak menolak', "if entry.voided_at is not null or entry.branch_id is distinct from branch", "if false and entry.voided_at is not null or entry.branch_id is distinct from branch"),
     ('M48 plan: akun jurnal di luar tiga akun diterima', "(a.code not in('170001','720010','810004') or j.debit<0", "(false or j.debit<0"),
     ('M49 plan: mutasi sumber di luar rincian diterima', "if exists(select 1 from jsonb_to_recordset(moves)x(item_id uuid) where not exists(select 1 from jsonb_to_recordset(rows)y(item_id uuid) where x.item_id=y.item_id)) then", "if false and exists(select 1 from jsonb_to_recordset(moves)x(item_id uuid) where not exists(select 1 from jsonb_to_recordset(rows)y(item_id uuid) where x.item_id=y.item_id)) then"),
     ('M50 plan: jumlah negatif diterima', "or x.qty<0 or x.qty>1e9", "or x.qty>1e9"),
     ('M51 plan: periode tutup tidak diperiksa (tanggal dokumen dan jurnal)', ["perform public.purchase_payment_period((state->>'date')::date,(now() at time zone 'Asia/Jakarta')::date);", "perform public.purchase_payment_period(entry.tanggal,(now() at time zone 'Asia/Jakarta')::date);"], ["null;", "null;"]),
     ('M52 plan: status tutup buku tidak tersedia tidak menolak', "if not found then raise exception 'Status tutup buku tidak tersedia. Koreksi dihentikan';end if;", "null;"),
     ('M53 plan: akun jurnal tidak aktif diterima', "if (select count(*) from public.coa_accounts where code in('170001','720010','810004') and is_active and not is_header)<>3 then", "if false and (select count(*) from public.coa_accounts where code in('170001','720010','810004') and is_active and not is_header)<>3 then"),
     ('M54 plan: HPP average aktif tidak menolak', "if public.inventory_is_average() then raise exception 'Koreksi historis FIFO tidak tersedia saat HPP average aktif. Rekonsiliasi melalui Finance diperlukan';end if;\n state:=", "null;\n state:="),
     ('M55 correct: hasil simpan tanpa daftar tertahan', "'applied',plan->'applied','blocked',plan->'blocked');\n insert into public.stock_document_correction_requests", "'applied',plan->'applied','blocked','[]'::jsonb);\n insert into public.stock_document_correction_requests"),
     ('M56 correct: tanda beban sudah diperiksa tidak disimpan', "after_state:=jsonb_build_object('charge_checked',(plan->>'charge_checked')::boolean,", "after_state:=jsonb_build_object('charge_checked',false,"),
     ('M57 correct: token pratinjau tidak diperiksa', "if p_preview_token is null or p_preview_token is distinct from plan->>'token' then", "if false and p_preview_token is null or p_preview_token is distinct from plan->>'token' and false then"),
     ('M58 correct: pagar Admin Online dihapus (dan tidak dipasang ulang oleh guard_all/fence_all)', ["begin\n  perform admin_online_private.deny_admin_online();\n -- Take the existing costing-mode shared lock before document/stock/ledger locks.\n if public.inventory_is_average() then raise exception 'Koreksi historis FIFO tidak tersedia saat HPP average aktif. Rekonsiliasi melalui Finance diperlukan';end if;\n if auth.uid() is null", "select admin_online_private.guard_all();\nselect admin_online_private.fence_all();"], ["begin\n -- Take the existing costing-mode shared lock before document/stock/ledger locks.\n if public.inventory_is_average() then raise exception 'Koreksi historis FIFO tidak tersedia saat HPP average aktif. Rekonsiliasi melalui Finance diperlukan';end if;\n if auth.uid() is null", "select 1;"]),
     ('M59 preview: pagar Admin Online dihapus (dan tidak dipasang ulang oleh guard_all/fence_all)', ["declare plan jsonb;begin\n  perform admin_online_private.deny_admin_online();\n plan:=", "select admin_online_private.guard_all();\nselect admin_online_private.fence_all();"], ["declare plan jsonb;begin\n plan:=", "select 1;"]),
     ('M60 preview: daftar tertahan tidak dikembalikan', "'applied',plan->'applied','blocked',plan->'blocked');\nend$function$;", "'applied',plan->'applied','blocked','[]'::jsonb);\nend$function$;"),
     ('M61 charge-note: pagar Admin Online dihapus', "declare c public.opname_variance_charges%rowtype;names text;\nbegin\n  perform admin_online_private.deny_admin_online();", "declare c public.opname_variance_charges%rowtype;names text;\nbegin"),
     ('M62 charge-note: pesan tanpa petunjuk batalkan beban', "Batalkan beban karyawan dulu di halaman hasil opname %s (bagian Riwayat beban karyawan, tombol Batalkan beban), lalu koreksi baris ini.", "Lanjut."),
     ('M63 guard: pagar terakhir beban dihapus', "and coalesce(new.after_state->>'charge_checked', '') <> 'true' then", "and false then"),
     ('M64 guard: tanda charge_checked kosong diterima', "and coalesce(new.after_state->>'charge_checked', '') <> 'true' then", "and coalesce(new.after_state->>'charge_checked', 'true') <> 'true' then"),
     ('M65 acl: perencana dibuka untuk authenticated', "-- Pagar Admin Online (#549): idempotent.", "grant execute on function public.stock_correction_plan(text,uuid,jsonb) to authenticated;\n-- Pagar Admin Online (#549): idempotent."),
     ('M66 acl: catatan beban dibuka untuk anon', "-- Pagar Admin Online (#549): idempotent.", "grant execute on function public.stock_correction_charge_note(uuid) to anon;\n-- Pagar Admin Online (#549): idempotent."),
     ('M67 acl: simpan dibuka untuk anon', "-- Pagar Admin Online (#549): idempotent.", "grant execute on function public.correct_stock_document(text,uuid,jsonb,text,text,text) to anon;\n-- Pagar Admin Online (#549): idempotent."),
     ('M68 acl: pratinjau dicabut dari authenticated', "-- Pagar Admin Online (#549): idempotent.", "revoke execute on function public.preview_stock_document_correction(text,uuid,jsonb) from authenticated;\n-- Pagar Admin Online (#549): idempotent."),
     ('M69 definer: simpan tidak lagi SECURITY DEFINER', "CREATE OR REPLACE FUNCTION public.correct_stock_document(p_kind text, p_id uuid, p_rows jsonb, p_reason text, p_request_key text, p_preview_token text)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''", "CREATE OR REPLACE FUNCTION public.correct_stock_document(p_kind text, p_id uuid, p_rows jsonb, p_reason text, p_request_key text, p_preview_token text)\n RETURNS jsonb\n LANGUAGE plpgsql\n SET search_path TO ''"),
     ('M70 search_path: perencana tidak dikunci', "CREATE OR REPLACE FUNCTION public.stock_correction_plan(p_kind text, p_id uuid, p_rows jsonb)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''", "CREATE OR REPLACE FUNCTION public.stock_correction_plan(p_kind text, p_id uuid, p_rows jsonb)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER"),
    ]
    out = []
    for m in X:
        name, old, new = m
        out.append((name, old if isinstance(old, list) else [old], new if isinstance(new, list) else [new]))
    return out


def run_mutations(db, a):
    fresh(db)
    base = cand_text()
    clone(db, 'ctl'); apply_cand(db, 'ctl', base)
    ok, passes, why = run_suite(db, 'ctl', SUITE)
    check('CONTROL: unmutated candidate passes the suite (%d assertions)' % len(passes), ok, why)
    want = len(passes)
    only = os.environ.get('BP_ONLY', '').split(',') if os.environ.get('BP_ONLY') else None
    killed = 0; total = 0
    for name, olds, news in mutants():
        if only and not any(name.startswith(o) for o in only): continue
        total += 1
        bad_anchor = [o for o in olds if base.count(o) != 1]
        if bad_anchor:
            check('MUTANT ' + name + ' (anchor found exactly once)', False, 'count=%s' % [base.count(o) for o in olds]); continue
        mutated = base
        for o, n in zip(olds, news): mutated = mutated.replace(o, n)
        clone(db, 'mut')
        try:
            apply_cand(db, 'mut', mutated)
        except RuntimeError as e:
            killed += 1; check('MUTANT ' + name + ' -> killed (does not even apply: %s)' % str(e)[:80].replace('\n', ' '), True); continue
        ok, passes, why = run_suite(db, 'mut', SUITE)
        dead = not ok or len(passes) < want
        killed += dead
        check('MUTANT ' + name + ' -> %s' % ('KILLED: ' + why[:90] if dead else 'SURVIVED (suite still green, %d)' % len(passes)), dead, why)
    for name, olds, news in EQUIVALENT:
        if only and not any(name.startswith(o) for o in only): continue
        olds = olds if isinstance(olds, list) else [olds]; news = news if isinstance(news, list) else [news]
        if any(base.count(o) != 1 for o in olds):
            check('EQUIVALENT ' + name + ' (anchor found exactly once)', False); continue
        mutated = base
        for o, n in zip(olds, news): mutated = mutated.replace(o, n)
        clone(db, 'mut'); apply_cand(db, 'mut', mutated)
        ok, passes, why = run_suite(db, 'mut', SUITE)
        check('EQUIVALENT (not counted) ' + name + ' -> %s' % ('survives as predicted (unreachable guard, see EQUIVALENT comment)' if ok else 'unexpectedly killed: ' + why[:80]), True)
    check('MUTANTS killed %d / %d (>= 40 required; 1 provably equivalent mutant reported separately)' % (killed, total), killed == total and (total >= 40 or only is not None))


# ------------------------------------------------------------------ concurrency
OWNER = '9c100000-0000-4000-8000-000000000001'
CONC_FIX_HEAD = ("update accounting_locks set closed_until=null;\n")


def conc_fixture(db, dbname):
    suite = (TESTS / SUITE).read_text()
    pre = suite[:suite.index('-- ═════════ S1 ')]
    body = pre + r"""
select pg_temp.doc('c1','[{"c":"a","layers":[[10,100]],"count":8},{"c":"b","layers":[[10,100]],"count":12},{"c":"c","layers":[[10,100]],"count":10}]');
select pg_temp.doc('c2','[{"c":"a","layers":[[10,100]],"count":8},{"c":"b","layers":[[10,100]],"count":12},{"c":"c","layers":[[10,100]],"count":10}]');
select pg_temp.doc('c3','[{"c":"a","sell":150,"layers":[[10,100]],"count":8},{"c":"b","sell":0,"layers":[[10,100]],"count":12},{"c":"c","layers":[[10,100]],"count":10}]');
select pg_temp.doc('c4','[{"c":"a","layers":[[10,100]],"count":8},{"c":"b","layers":[[10,100]],"count":12},{"c":"c","layers":[[10,100]],"count":10}]');
select pg_temp.doc('c5','[{"c":"a","layers":[[10,100]],"count":8},{"c":"b","layers":[[10,100]],"count":12},{"c":"c","layers":[[10,100]],"count":10}]');
select pg_temp.doc('c6','[{"c":"a","sell":150,"layers":[[10,100]],"count":8},{"c":"b","sell":0,"layers":[[10,100]],"count":12},{"c":"c","layers":[[10,100]],"count":10}]');
commit;
"""
    rc, out, err = raw(db, body, dbname)
    assert rc == 0, err[-500:]


def conc_rows(db, dbname, label, ch):
    sql = f"""select set_config('request.jwt.claim.sub','5c100000-0000-4000-8000-000000000001',false);select set_config('request.jwt.claims','{{"role":"authenticated"}}',false);
select jsonb_build_object('rid',r.id,'rows',(select jsonb_agg(jsonb_build_object('item_id',x->>'item_id','qty',(x->>'qty')::numeric) order by x->>'item_id') from jsonb_array_elements(public.get_stock_document_correction('opname',r.id)->'rows') x))::text
 from opname_results r where r.no_hasil=(select no_hasil from opname_results r2 join opname_orders o on o.id=r2.order_id where o.no_opname='OPO.KR.{label}');"""
    rc, out, err = raw(db, sql, dbname)
    assert rc == 0, err
    j = json.loads([l for l in out.splitlines() if l.startswith('{')][-1])
    ids = {c: q1(db, dbname, f"select id from items where code='KR-{label}.{c}'") for c in 'abc'}
    inv = {v: k for k, v in ids.items()}
    rows = [dict(item_id=x['item_id'], qty=ch.get(inv[x['item_id']], x['qty'])) for x in j['rows']]
    return j['rid'], rows, ids


OWN_SESS = "set role authenticated; select set_config('request.jwt.claim.sub','5c100000-0000-4000-8000-000000000001',false); select set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false);"
OWN_CLAIMS = "select set_config('request.jwt.claim.sub','5c100000-0000-4000-8000-000000000001',false); select set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false);"


def preview_token(db, dbname, rid, rows):
    js = json.dumps(rows).replace("'", "''")
    rc, out, err = raw(db, OWN_SESS + f" select 'TOK '||((public.preview_stock_document_correction('opname','{rid}','{js}'::jsonb))->>'token');", dbname)
    assert rc == 0, err[-300:]
    return [l for l in out.splitlines() if l.startswith('TOK ')][-1][4:]


def corr_sql(rid, rows, key, hold=0.0, marker='', token=None):
    """token=None: the preview is taken inside the same statement (after any lock wait); token given: a preview taken EARLIER, as the screen does."""
    js = json.dumps(rows).replace("'", "''")
    head = '' if hold else f"/* {marker} */ "
    tok = f"'{token}'" if token else f"(public.preview_stock_document_correction('opname','{rid}','{js}'::jsonb))->>'token'"
    return (OWN_SESS + f" begin; {head}select public.correct_stock_document('opname','{rid}','{js}'::jsonb,'Balapan uji','{key}',{tok})::text;"
            + (f" /* {marker} */ select pg_sleep({hold});" if hold else '') + " commit;")


def run_concurrency(db, a):
    fresh(db)
    clone(db, 'cc'); apply_cand(db, 'cc')
    conc_fixture(db, 'cc')
    rc, out, err = raw(db, "update accounting_locks set closed_until=null", 'cc')
    # 1a. the screen previews first (token T), another correction commits meanwhile; saving with T afterwards is refused as stale
    rid, ra_rows, ids = conc_rows(db, 'cc', 'c1', {'a': 7})
    rid, rb_rows, _ = conc_rows(db, 'cc', 'c1', {'b': 13})
    tb = preview_token(db, 'cc', rid, rb_rows)
    A = Sess(db, 'cc', corr_sql(rid, ra_rows, 'ca', 2.5, 'race-holder-1'))
    s1 = sleeping(db, 'cc', 'race-holder-1')
    B = Sess(db, 'cc', corr_sql(rid, rb_rows, 'cb', 0, 'race-comp-1', token=tb))
    w1 = waiting(db, 'cc', 'race-comp-1')
    ra, rb = A.done(), B.done()
    nrev = q1(db, 'cc', f"select count(*) from stock_document_corrections where document_id='{rid}'")
    stock = q1(db, 'cc', "select string_agg(s.qty::text, ',' order by i.code) from stock s join items i on i.id=s.item_id where i.code like 'KR-c1.%'")
    check('RACE preview token taken before another correction committed: the second save waits on the document lock, then is refused as stale (Preview berubah); exactly one correction saved',
          s1 and w1 and ra[0] == 0 and rb[0] != 0 and 'Preview berubah' in rb[2] and nrev == '1' and stock == '7,12,10', (s1, w1, ra[0], rb[0], rb[2][-200:], nrev, stock))
    # 1b. both sessions preview inside their own statement: they serialise, the second one is judged on the first one's committed result (revision 2)
    rid5, r5a, _ = conc_rows(db, 'cc', 'c5', {'a': 7})
    rid5, r5b, _ = conc_rows(db, 'cc', 'c5', {'b': 13})
    A = Sess(db, 'cc', corr_sql(rid5, r5a, 'c5a', 2.5, 'race-holder-5'))
    sleeping(db, 'cc', 'race-holder-5')
    B = Sess(db, 'cc', corr_sql(rid5, r5b, 'c5b', 0, 'race-comp-5'))
    waiting(db, 'cc', 'race-comp-5')
    ra, rb = A.done(), B.done()
    revs = q1(db, 'cc', f"select string_agg(revision::text, ',' order by revision) from stock_document_corrections where document_id='{rid5}'")
    stock5 = q1(db, 'cc', "select string_agg(s.qty::text, ',' order by i.code) from stock s join items i on i.id=s.item_id where i.code like 'KR-c5.%'")
    check('RACE two corrections of one document, previews taken inside the statements: they serialise (revisions 1 and 2), the second works on the first one\'s result (its rows restore a to 8 and set b to 13)',
          ra[0] == 0 and rb[0] == 0 and revs == '1,2' and stock5 == '8,13,10', (ra[2][-150:], rb[2][-150:], revs, stock5))
    # 2. same key from two sessions (double click, same preview token): one effect, identical answer
    rid2, rr, ids2 = conc_rows(db, 'cc', 'c2', {'a': 7})
    t2 = preview_token(db, 'cc', rid2, rr)
    A = Sess(db, 'cc', corr_sql(rid2, rr, 'dup', 2.5, 'race-holder-2', token=t2))
    sleeping(db, 'cc', 'race-holder-2')
    B = Sess(db, 'cc', corr_sql(rid2, rr, 'dup', 0, 'race-comp-2', token=t2))
    waiting(db, 'cc', 'race-comp-2')
    ra, rb = A.done(), B.done()
    check('RACE same request key and preview token from two sessions (double click): one correction, identical answer',
          ra[0] == 0 and rb[0] == 0 and ra[1].strip() == rb[1].strip() and ra[1].strip() != '' and q1(db, 'cc', f"select count(*) from stock_document_corrections where document_id='{rid2}'") == '1', (ra[2][-150:], rb[2][-150:], ra[1][-100:], rb[1][-100:]))
    # 3. correction holds the lock; employee charge arrives: waits, then runs on the corrected document
    rid3, r3, ids3 = conc_rows(db, 'cc', 'c3', {'c': 9})
    A = Sess(db, 'cc', corr_sql(rid3, r3, 'c3a', 2.5, 'race-holder-3'))
    sleeping(db, 'cc', 'race-holder-3')

    def charge_sql(marker, rid_):
        return OWN_CLAIMS + (f" /* {marker} */ select public.charge_opname_variance_to_employees('{rid_}',jsonb_build_array(jsonb_build_object('employee_id','5c400000-0000-4000-8000-000000000001','amount',"
                             f"(public.opname_variance_charge_basis('{rid_}')->>'jual_total')::numeric)),'Balapan beban',gen_random_uuid())::text;")
    B = Sess(db, 'cc', charge_sql('race-charge-3', rid3))
    w3 = waiting(db, 'cc', 'race-charge-3')
    ra, rb = A.done(), B.done()
    ncorr = q1(db, 'cc', f"select count(*) from stock_document_corrections where document_id='{rid3}'")
    nchg = q1(db, 'cc', f"select count(*) from opname_variance_charges where result_id='{rid3}' and cancelled_at is null")
    check('RACE correction first, employee charge second: the charge waits on the document lock; the outcome is a serial one (correction saved; the charge is refused plainly because a corrected document cannot be charged (existing F2 rule); never half)',
          w3 and ra[0] == 0 and ncorr == '1' and rb[0] != 0 and 'belum dikoreksi' in rb[2] and nchg == '0', (w3, ra[0], rb[0], rb[2][-200:], ncorr, nchg))
    # 3c. the other order: the charge holds the document lock, a correction of an affecting row arrives, waits, then sees the active charge and holds the row
    rid6, r6, _ = conc_rows(db, 'cc', 'c6', {'a': 7})
    charge_hold = OWN_CLAIMS + (f" begin; select public.charge_opname_variance_to_employees('{rid6}',jsonb_build_array(jsonb_build_object('employee_id','5c400000-0000-4000-8000-000000000001','amount',"
                                f"(public.opname_variance_charge_basis('{rid6}')->>'jual_total')::numeric)),'Balapan beban 6',gen_random_uuid())::text; /* race-holder-6 */ select pg_sleep(2.5); commit;")
    A = Sess(db, 'cc', charge_hold)
    sleeping(db, 'cc', 'race-holder-6')
    B = Sess(db, 'cc', corr_sql(rid6, r6, 'c6b', 0, 'race-comp-6'))
    w6 = waiting(db, 'cc', 'race-comp-6')
    ra, rb = A.done(), B.done()
    check('RACE charge first, correction of an affecting row second: the correction waits on the document lock, then sees the active charge and is refused with the charge note; stock unchanged',
          w6 and ra[0] == 0 and rb[0] != 0 and 'Batalkan beban karyawan dulu' in rb[2] and q1(db, 'cc', "select s.qty from stock s join items i on i.id=s.item_id where i.code='KR-c6.a'") == '8', (w6, ra[0], rb[0], rb[2][-250:]))
    # 4. correction holds the lock on a changed item; a sale of that item arrives: waits on the stock row, then consumes from the corrected stock
    rid4, r4, ids4 = conc_rows(db, 'cc', 'c4', {'a': 7})
    A = Sess(db, 'cc', corr_sql(rid4, r4, 'c4a', 2.5, 'race-holder-4'))
    sleeping(db, 'cc', 'race-holder-4')
    sale = f"/* race-sale-4 */ select * from public.stock_out_fifo((select id from warehouses where code='KRWA'),'{ids4['a']}',7,'sale','RACE-SALE-4',current_date);"
    B = Sess(db, 'cc', sale)
    w4 = waiting(db, 'cc', 'race-sale-4')
    ra, rb = A.done(), B.done()
    left = q1(db, 'cc', f"select coalesce(sum(qty_left),0) from stock_layers where item_id='{ids4['a']}'")
    qty = q1(db, 'cc', f"select qty from stock where item_id='{ids4['a']}'")
    check('RACE sale of a corrected item started while the correction was open: waits on the stock row, then sells from the corrected stock (7 -> 0); layers = stock',
          w4 and ra[0] == 0 and rb[0] == 0 and qty == '0' and left == '0', (w4, ra[0], rb[0], rb[2][-200:], qty, left))
    check('RACE after all races: trial balance zero, no layer/stock mismatch',
          q1(db, 'cc', "select coalesce(sum(debit-credit),0)=0 from journal_lines") == 't' and q1(db, 'cc', "select count(*) from (select s.item_id from stock s left join (select item_id,warehouse_id,sum(qty_left) q from stock_layers group by 1,2) l on l.item_id=s.item_id and l.warehouse_id=s.warehouse_id where abs(s.qty-coalesce(l.q,0))>0.000001) x") == '0')


# ------------------------------------------------------------------ neighbours
# test-stock-document-corrections-postgres.py needs Docker (harness limit here): its SQL suite supabase/tests/stock_document_corrections.sql is run below on a native clone instead.
NEIGH = [('test-f1-opname-akun-selisih-postgres.py', 'F1 opname'),
         ('test-f2-beban-selisih-karyawan-postgres.py', 'F2 beban'), ('test-f2-beban-selisih-karyawan-neto-postgres.py', 'F2 neto'),
         ('test-so-surplus-hpp-postgres.py', 'SO surplus'), ('test-so-kasbon-neto-postgres.py', 'SO kasbon neto')]


def run_neighbours(db, a):
    def nb_run(nb, with_cand):
        r = subprocess.run([sys.executable, '-I', str(ROOT / 'scripts/koreksi-so-neighbour.py'), nb, '--pg-bin', a.pg_bin, '--with-cand' if with_cand else '--without-cand'], capture_output=True, text=True)
        lines = r.stdout.splitlines()
        applied = next((int(l.split('=')[1]) for l in lines if l.startswith('CAND_APPLIED=')), -1)
        return r.returncode, sum(1 for l in lines if l.startswith('PASS')), sorted(l[:240] for l in lines if l.startswith('FAIL')), r.stderr[-300:], applied
    for nb, label in NEIGH:
        rc0, p0, f0, e0, ap0 = nb_run(nb, False)
        rc1, p1, f1, e1, ap1 = nb_run(nb, True)
        check('NEIGHBOUR %s: without candidate rc=%s %d PASS %d FAIL; with candidate (applied %d time) rc=%s %d PASS %d FAIL (no new failures)' % (label, rc0, p0, len(f0), ap1, rc1, p1, len(f1)),
              ap0 == 0 and ap1 >= 1 and p0 > 0 and p1 >= p0 and set(f1) <= set(f0) and (rc1 == 0 or rc0 != 0), (f1[:3], e1))
    # the repository's own SQL suites that call the correction functions, run on the chain with the candidate on top
    fresh(db)
    clone(db, 'nx'); apply_cand(db, 'nx')
    for s in ('stock_document_corrections.sql', 'so_surplus_hpp.sql', 'so_kasbon_neto.sql', 'opname_posting_atomic.sql'):
        clone(db, 'nsx'); apply_cand(db, 'nsx')
        ok, passes, why = run_suite(db, 'nsx', s)
        check('NEIGHBOUR SQL suite %s on top of the candidate: %s (%d assertions)' % (s, 'GREEN' if ok else 'FAILS: ' + why[:200], len(passes)), ok, why)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json')
    for k in ('baseline', 'diff', 'mutations', 'concurrency', 'neighbours'): ap.add_argument('--' + k, action='store_true')
    a = ap.parse_args()
    fn = run_baseline if a.baseline else run_diff if a.diff else run_mutations if a.mutations else run_concurrency if a.concurrency else run_neighbours if a.neighbours else run_green
    cm = Attached(os.environ['KR_ATTACH']) if os.environ.get('KR_ATTACH') else NativePostgres(a.pg_bin)
    with cm as db:
        fn(db, a)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(mode=fn.__name__, candidate=CAND, skipped_data_fix_migrations=SKIPPED, results=RESULTS), indent=1))
    fails = [r for r in RESULTS if r['status'] == 'FAIL']
    print('SUMMARY mode=%s pass=%d fail=%d' % (fn.__name__, len(RESULTS) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
