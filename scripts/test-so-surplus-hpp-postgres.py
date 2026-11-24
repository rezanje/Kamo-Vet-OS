#!/usr/bin/env python3
"""SO-SURPLUS-HPP (migrasi *_so_surplus_hpp_rata2.sql): selisih lebih opname pada HPP rata-rata + jurnal neto + koreksi.
Native throwaway PostgreSQL only (full migration chain, fictional fixtures). Never accepts a database URL.

  python3 -I scripts/test-so-surplus-hpp-postgres.py --pg-bin DIR [--json out.json] [--baseline | --diff | --mutations | --neighbours]
  (default)     chain + candidate: SQL suite supabase/tests/so_surplus_hpp.sql (>= 120 assertions), function identity (exactly the 4 reviewed
                patches + 1 new function), ACL, second application fails closed.
  --baseline    chain WITHOUT the candidate: the suite must fail early AND the defect must be shown (surplus layer Rp0, no surplus journal).
  --diff        differential: >= 200 randomised opnames run on the chain WITHOUT and WITH the candidate. Without surplus items every outcome
                (error, journals, moves, layers, FIFO takes, stock) must be identical; surplus items with no priced history identical too
                (journal only netted); surplus items with priced layers get the independently computed weighted average, shortage side identical.
  --mutations   every mutant of the candidate in a cloned database must be killed by the suite.
  --neighbours  existing opname suites (F1/F2/posting/cancel) with and without the candidate; differences are listed, never hidden.
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse, importlib.util, json, os, random, re, sys, tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bpbase', ROOT / 'scripts/test-batalkan-penerimaan-petshop-postgres.py')
bp = importlib.util.module_from_spec(spec); sys.modules['bpbase'] = bp; spec.loader.exec_module(bp)
MIGRATIONS, TESTS = bp.MIGRATIONS, bp.TESTS
_found = sorted(MIGRATIONS.glob('*_so_surplus_hpp_rata2.sql')) or sorted((ROOT / 'supabase/candidates').glob('*_so_surplus_hpp_rata2.sql'))
CANDFILE = _found[0]
CAND = CANDFILE.name
bp.CAND = CAND
SUITE = 'so_surplus_hpp.sql'
check, raw, clone, run_suite, apply = bp.check, bp.raw, bp.clone, bp.run_suite, bp.apply
NativePostgres, RESULTS = bp.NativePostgres, bp.RESULTS

# Hosted Supabase gives every new public function/table EXECUTE/ALL to anon, authenticated and service_role by default privileges; the bare native chain does not.
PRELUDE = ("alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;\n"
           "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;\n")

# Main carries data-fix migrations that need hosted rows (they fail on a bare chain) and a COA check for hosted-only accounts: tolerated/seeded
# for the throwaway chain only; they never take part in the proof.
SEED = ("insert into coa_accounts(code,name,type,normal_balance) select c,'Fiktif '||c,'BEBAN','D' from unnest(array['720002','720003','720004','740017','740005','720008','740021','740016','730002','720005','720006','720009','740002','740014','740013','740022','740012','760003']) c on conflict(code) do update set is_active=true,is_header=false;\n")
DATA_FIX_KEYS = ('koreksi_saldo_awal_fb', 'ralat_saldo_awal', 'sambung_jurnal_pengeluaran', 'saldo_awal_kas_toko_ke_cabang')
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


DATA_FIX = [f.read_text() for f in MIGRATIONS.glob('*.sql') if any(k in f.name for k in DATA_FIX_KEYS)]


def build_chain(db, exclude=()):
    tmp = Path(tempfile.mkdtemp(prefix='sxchain.', dir='/opt/data'))
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
    build_chain(db)
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')


def cand_text(): return CANDFILE.read_text()


def apply_cand(db, name, text=None, later=False):
    apply(db, name, PRELUDE + (text if text is not None else cand_text()), later=later)


PATCHED = ['post_opname_atomic(uuid,date,jsonb)', 'stock_correction_plan(text,uuid,jsonb)', 'correct_stock_document(text,uuid,jsonb,text,text,text)', 'capture_opname_price_report()']
NEW_FUNCS = ['opname_surplus_cost(uuid,uuid,numeric)']


def fn_digests(db, dbname):
    rc, out, err = raw(db, "select p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid))||'|'||p.prosecdef::text||'|'||coalesce(p.proconfig::text,'')||'|'||p.proowner::regrole::text||'|'||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private','admin_online_private','role_settings_private') and p.prokind in ('f','p') order by 1", dbname)
    assert rc == 0, err
    d = {}
    for l in out.splitlines():
        k, rest = l.split('|', 1); d[k] = rest
    return d


def norm(k): return k[7:] if k.startswith('public.') else k


def run_green(db, a):
    fresh(db)
    clone(db, 'before'); before = {norm(k): v for k, v in fn_digests(db, 'before').items()}
    clone(db, 'cand'); apply_cand(db, 'cand')
    after = {norm(k): v for k, v in fn_digests(db, 'cand').items()}
    changed = sorted(k for k in before if k in after and before[k] != after[k])
    new = sorted(k for k in after if k not in before)
    gone = sorted(k for k in before if k not in after)
    check('IDENTITY existing functions that changed == exactly the 4 reviewed patches (definer/config/ACL included in the digest)', changed == sorted(PATCHED) and not gone, (changed, gone))
    check('IDENTITY new functions are exactly opname_surplus_cost', new == sorted(NEW_FUNCS), new)
    check('IDENTITY opname_variance_charge_basis / charge_opname_variance_to_employees / stock_out_fifo / stock_in_fifo / opname_posting_journal byte-identical',
          all(before[k] == after[k] for k in before if re.match(r'(opname_variance_charge_basis|charge_opname_variance_to_employees|cancel_opname_variance_charge|stock_out_fifo|stock_in_fifo|opname_posting_journal|issue_stock_document_recorded|read_opname_price_report|read_opname_price_recap|post_inventory_adjustment_atomic)\(', k)), None)
    ok, passes, why = run_suite(db, 'cand', SUITE)
    check('SQL suite %s GREEN: %d assertions passed' % (SUITE, len(passes)), ok and len(passes) >= 120, why or 'passes=%d' % len(passes))
    try:
        apply(db, 'cand', cand_text(), later=False); twice = False
    except RuntimeError:
        twice = False  # the patch is idempotent-by-anchor: a second application finds the new text and fails closed
        twice = True
    check('second application of the migration fails closed (anchors no longer match; no silent re-apply)', twice)


def run_baseline(db, a):
    fresh(db)
    clone(db, 'red')
    ok, passes, why = run_suite(db, 'red', SUITE)
    check('RED: suite fails at the baseline (%d assertions passed before the first failure)' % len(passes), not ok and len(passes) <= 3, why)
    suite = (TESTS / SUITE).read_text()
    probe = suite[:suite.index('-- ═════════ S1 hanya')] + r"""
select pg_temp.post('s1',pg_temp.wa(),'{"p1":24}');
select 'DEFECT surplus layer unit_cost='||(pg_temp.layer(pg_temp.ref('s1'),'p1')).unit_cost||' journals='||pg_temp.jcount('opname',pg_temp.ref('s1'))||' gain_cost='||(pg_temp.rc('s1')->>'gain_cost')||' avg_of_other_layers=150';
rollback;
"""
    rc, out, err = raw(db, probe, 'red')
    line = [l for l in out.splitlines() if l.startswith('DEFECT')]
    check('RED defect shown on the old function: surplus of an item with HPP 150 enters at Rp0 and no journal exists', rc == 0 and bool(line) and 'unit_cost=0' in line[0] and 'journals=0' in line[0], line or err[-300:])


# ------------------------------------------------------------------ differential
DIFF_PRELUDE = r"""
begin;
insert into auth.users(id,raw_user_meta_data) values('d1000000-0000-4000-8000-000000000001','{"full_name":"DF owner"}');
update profiles set role='OWNER',is_active=true where id='d1000000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values('d2000000-0000-4000-8000-000000000001','DFA','DF klinik','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','DFW','DF gudang','VET');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) values('170001','Persediaan','ASET','D',false,true),('720010','Beban selisih','BEBAN','D',false,true),('810004','Pendapatan lain','PENDAPATAN','K',false,true) on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
create function pg_temp.runcase(seed int,spec jsonb) returns jsonb language plpgsql as $$
declare it jsonb;i int:=0;wh uuid:='d3000000-0000-4000-8000-000000000001';oid uuid:=gen_random_uuid();counts jsonb:='{}';iid uuid;l jsonb;n int;
 r jsonb;err text;ref text;out jsonb;ids uuid[]:='{}';
begin
 for it in select * from jsonb_array_elements(spec) loop
  i:=i+1;iid:=md5('df-'||seed||'-'||i)::uuid;ids:=ids||iid;
  insert into public.items(id,code,name,unit,item_type,buy_price,sell_price) values(iid,'DF-'||seed||'-'||i,'Barang DF '||seed||'-'||i,'PCS','Persediaan',(it->>'master')::numeric,1000);
  n:=0;
  for l in select * from jsonb_array_elements(it->'layers') loop
   n:=n+1;perform public.stock_in_fifo(wh,iid,(l->>'qty')::numeric,(l->>'cost')::numeric,'fixture','DF-'||seed||'-'||i||'-'||n,(now() at time zone 'Asia/Jakarta')::date-(10-n),null);
  end loop;
  if (it->>'drain')::boolean then perform public.stock_out_fifo(wh,iid,(select coalesce(sum(qty_left),0) from public.stock_layers where warehouse_id=wh and item_id=iid),'sale','DF-OUT-'||seed||'-'||i,(now() at time zone 'Asia/Jakarta')::date);end if;
  insert into public.stock(warehouse_id,item_id,qty) values(wh,iid,0) on conflict do nothing;
  counts:=counts||jsonb_build_object(iid::text,(select coalesce(sum(qty),0) from public.stock where warehouse_id=wh and item_id=iid)+(it->>'delta')::numeric);
 end loop;
 insert into public.opname_orders(id,no_opname,warehouse_id,penanggung_jawab) values(oid,'OPO.DF.'||seed,wh,'Penghitung');
 perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin
  r:=public.post_opname_atomic(oid,(now() at time zone 'Asia/Jakarta')::date,counts);ref:=r->>'no_hasil';
 exception when others then err:=sqlerrm;
 end;
 if err is not null then return jsonb_build_object('seed',seed,'err',err);end if;
 select jsonb_build_object('seed',seed,'err',null,
  'journal',(select coalesce(jsonb_object_agg(code,net),'{}') from (select a.code,sum(l2.debit-l2.credit) net from public.journal_lines l2 join public.coa_accounts a on a.id=l2.account_id join public.journal_entries e on e.id=l2.entry_id where e.source='opname' and e.source_ref=ref group by a.code) x),
  'journals',(select count(*) from public.journal_entries where source='opname' and source_ref=ref),
  'moves',(select coalesce(jsonb_agg(jsonb_build_object('i',array_position(ids,m.item_id),'q',m.qty,'c',round(m.unit_cost,6),'takes',(select coalesce(sum((t->>'qty')::numeric),0) from jsonb_array_elements(coalesce(m.fifo_takes,'[]')) t)) order by array_position(ids,m.item_id)),'[]') from public.stock_moves m where m.source='opname' and m.source_ref=ref),
  'layers',(select coalesce(jsonb_agg(jsonb_build_object('i',array_position(ids,l3.item_id),'in',l3.qty_in,'left',l3.qty_left,'c',round(l3.unit_cost,6),'src',l3.source) order by array_position(ids,l3.item_id),l3.tanggal,l3.created_at,l3.qty_in,l3.unit_cost),'[]') from public.stock_layers l3 where l3.item_id=any(ids)),
  'stock',(select coalesce(jsonb_agg(s.qty order by array_position(ids,s.item_id)),'[]') from public.stock s where s.warehouse_id=wh and s.item_id=any(ids)),
  'status',(select status::text from public.opname_orders where id=oid)) into out;
 return out;
end$$;
"""


def gen_cases(n, rnd):
    cases = []
    for seed in range(1, n + 1):
        kind = rnd.choice(['short'] * 5 + ['zero'] + ['surplus_nohist'] * 2 + ['surplus_hist'] * 3 + ['mixed_nohist'] + ['mixed_hist'] * 2 + ['drained'])
        items = []
        for _ in range(rnd.randint(1, 4)):
            layers = [dict(qty=rnd.randint(1, 12), cost=rnd.choice([0, 0, 25, 40, 55.5, 100, 120.25, 333])) for _ in range(rnd.randint(0, 3))]
            master = rnd.choice([0, 0, 30, 75, 210.5])
            have = sum(l['qty'] for l in layers)
            role = rnd.choice(['short', 'short', 'zero', 'surplus']) if kind in ('mixed_nohist', 'mixed_hist') else \
                   'short' if kind == 'short' else 'zero' if kind == 'zero' else 'surplus' if kind.startswith('surplus') else 'surplus' if kind == 'drained' else 'short'
            if kind in ('surplus_nohist', 'mixed_nohist') and role == 'surplus': layers = []
            if kind in ('surplus_hist', 'mixed_hist') and role == 'surplus' and not any(l['cost'] > 0 for l in layers): layers = [dict(qty=rnd.randint(1, 9), cost=rnd.choice([40, 100, 250]))]
            have = sum(l['qty'] for l in layers)
            drain = kind == 'drained' and role == 'surplus'
            if drain: layers = [dict(qty=rnd.randint(2, 6), cost=rnd.choice([60, 90]))]
            have = 0 if drain else sum(l['qty'] for l in layers)
            delta = 0 if role == 'zero' else (rnd.randint(1, 7) if role == 'surplus' else -rnd.randint(1, max(1, have))) if have or role == 'surplus' else 0
            if role == 'short' and have == 0: role, delta = 'zero', 0
            items.append(dict(layers=layers, master=master, delta=delta, drain=drain, role=role))
        if all(i['delta'] == 0 for i in items): items[0]['delta'] = 1; items[0]['role'] = 'surplus'
        cases.append(dict(seed=seed, kind=kind, spec=items))
    return cases


def case_sql(cases):
    return DIFF_PRELUDE + "".join("select 'CASE '||pg_temp.runcase(%d,%s::jsonb)::text;\n" % (c['seed'], "'" + json.dumps(c['spec']).replace("'", "''") + "'") for c in cases) + "rollback;\n"


def oracle_cost(item):
    """Independent re-implementation of the cost rule for a single-warehouse fixture (no other warehouses, FIFO method)."""
    live = [l for l in item['layers'] if l['cost'] > 0 and not item['drain']]
    if live: return round(sum(l['qty'] * l['cost'] for l in live) / sum(l['qty'] for l in live), 6), 'avg'
    pos = [l for l in item['layers'] if l['cost'] > 0]
    if pos: return pos[-1]['cost'], 'last'
    if item['master'] > 0: return item['master'], 'master'
    return 0, 'none'


def parse(out):
    d = {}
    for l in out.splitlines():
        if l.startswith('CASE '):
            j = json.loads(l[5:]); d[j['seed']] = j
    return d


def num(x): return round(float(x), 2)


def run_diff(db, a):
    rnd = random.Random(20261124)
    cases = gen_cases(240, rnd)
    fresh(db)
    clone(db, 'old'); clone(db, 'new'); apply_cand(db, 'new')
    outs = {}
    for name in ('old', 'new'):
        rc, out, err = raw(db, case_sql(cases), name)
        outs[name] = parse(out)
        check('DIFF %s: all %d cases executed' % (name, len(cases)), rc == 0 and len(outs[name]) == len(cases), (rc, len(outs[name]), err[-300:]))
    o, n = outs['old'], outs['new']
    byclass = {}
    bad = []
    for c in cases:
        s = c['seed']; ro, rn = o.get(s), n.get(s)
        if not ro or not rn: bad.append((s, 'missing')); continue
        has_surplus = any(i['delta'] > 0 for i in c['spec'])
        has_short = any(i['delta'] < 0 for i in c['spec'])
        surplus_priced = any(i['delta'] > 0 and oracle_cost(i)[1] in ('avg', 'last') for i in c['spec'])
        cls = 'A_no_surplus' if not has_surplus else ('C_surplus_priced' if surplus_priced else 'B_surplus_master_only')
        byclass.setdefault(cls, []).append(s)
        if cls == 'A_no_surplus':
            if ro != rn: bad.append((s, cls, 'outcome differs'))
        elif cls == 'B_surplus_master_only':
            same_core = all(ro.get(k) == rn.get(k) for k in ('err', 'moves', 'layers', 'stock', 'status'))
            if not same_core: bad.append((s, cls, 'moves/layers/stock differ'))
            elif ro.get('err') is None:
                pl_old = num(ro['journal'].get('720010', 0)) + num(ro['journal'].get('810004', 0))
                pl_new = num(rn['journal'].get('720010', 0)) + num(rn['journal'].get('810004', 0))
                if abs(pl_old - pl_new) > 0.01 or abs(num(ro['journal'].get('170001', 0)) - num(rn['journal'].get('170001', 0))) > 0.01: bad.append((s, cls, 'P&L or inventory differs'))
                if not has_short and ro['journal'] != rn['journal']: bad.append((s, cls, 'surplus-only journal differs'))
                if rn['journals'] > 1: bad.append((s, cls, 'more than one journal'))
        else:
            if ro.get('err') or rn.get('err'):
                if ro.get('err') != rn.get('err'): bad.append((s, cls, 'error differs: %s | %s' % (ro.get('err'), rn.get('err'))))
                continue
            # shortage side identical: negative moves and the layers consumed
            neg = lambda r: [m for m in r['moves'] if m['q'] < 0]
            if neg(ro) != neg(rn): bad.append((s, cls, 'shortage moves differ'))
            exp_gain = 0
            for idx, it in enumerate(c['spec'], start=1):
                if it['delta'] > 0:
                    cst, how = oracle_cost(it)
                    mv = [m for m in rn['moves'] if m['i'] == idx and m['q'] > 0]
                    if len(mv) != 1 or abs(mv[0]['c'] - cst) > 1e-6: bad.append((s, cls, 'item %d cost %s != oracle %s' % (idx, mv and mv[0]['c'], cst)))
                    exp_gain += round(it['delta'] * cst, 2)
            exp_loss = -sum(m['q'] * m['c'] for m in neg(ro))
            if rn['journals'] != 1: bad.append((s, cls, 'journals=%s' % rn['journals']))
            net = num(rn['journal'].get('720010', 0)) + num(rn['journal'].get('810004', 0))
            if abs(net - (num(exp_loss) - num(exp_gain))) > 0.02 * max(1, len(c['spec'])): bad.append((s, cls, 'net %s != loss-gain %s' % (net, num(exp_loss) - num(exp_gain))))
            if num(rn['journal'].get('720010', 0)) < -0.001: bad.append((s, cls, 'negative expense balance'))
            if has_short and num(rn['journal'].get('810004', 0)) != 0 and exp_gain <= exp_loss + 0.01: bad.append((s, cls, '810004 used although gain <= loss'))
            if sum(num(v) for v in rn['journal'].values()) != 0: bad.append((s, cls, 'unbalanced net'))
    check('DIFF classes: %s (>= 200 cases)' % {k: len(v) for k, v in byclass.items()}, len(cases) >= 200 and all(len(v) >= 20 for v in byclass.values()) and len(byclass) == 3, {k: len(v) for k, v in byclass.items()})
    check('DIFF A (no surplus): %d cases identical old vs new (error text, journals, moves, FIFO takes, layers, stock, status)' % len(byclass.get('A_no_surplus', [])), not [b for b in bad if len(b) > 1 and b[1] == 'A_no_surplus'], [b for b in bad if b[1:2] == ('A_no_surplus',)][:5])
    check('DIFF B (surplus without priced history): %d cases identical except the journal is netted (inventory and P&L equal, surplus-only journal byte-equal)' % len(byclass.get('B_surplus_master_only', [])), not [b for b in bad if len(b) > 1 and b[1] == 'B_surplus_master_only'], [b for b in bad if b[1:2] == ('B_surplus_master_only',)][:5])
    check('DIFF C (surplus with priced layers): %d cases: cost = independently computed weighted average / last known, shortage side identical, ONE netted balanced journal, no negative expense' % len(byclass.get('C_surplus_priced', [])), not [b for b in bad if len(b) > 1 and b[1] == 'C_surplus_priced'], [b for b in bad if b[1:2] == ('C_surplus_priced',)][:5])
    check('DIFF no case missing', not [b for b in bad if len(b) == 2], [b for b in bad if len(b) == 2][:5])
    errs_old = sum(1 for s in o if o[s].get('err')); errs_new = sum(1 for s in n if n[s].get('err'))
    check('DIFF refusals (cost-less shortages) are identical in count: %d old / %d new' % (errs_old, errs_new), errs_old == errs_new and errs_old > 0, (errs_old, errs_new))


# ------------------------------------------------------------------ mutants
def mutants():
    sx = lambda s: s
    return [
        ('M01 cost: weighted layer average replaced by plain mean of unit costs', "select sum(l.qty_left*l.unit_cost)/sum(l.qty_left) into v_cost from public.stock_layers l\n  where l.warehouse_id=p_warehouse", "select avg(l.unit_cost) into v_cost from public.stock_layers l\n  where l.warehouse_id=p_warehouse"),
        ('M02 cost: zero-cost layers count in the average', "and l.qty_left>0 and l.unit_cost>0 and not public.stock_layer_cost_was_reversed(l.id);\n if v_cost>0 then return query select round(v_cost,6),'HPP rata-rata lapisan gudang'", "and l.qty_left>0 and not public.stock_layer_cost_was_reversed(l.id);\n if v_cost>0 then return query select round(v_cost,6),'HPP rata-rata lapisan gudang'"),
        ('M03 cost: empty layers (qty_left=0) count in the average', "and l.qty_left>0 and l.unit_cost>0 and not public.stock_layer_cost_was_reversed(l.id);\n if v_cost>0 then return query select round(v_cost,6),'HPP rata-rata lapisan gudang'", "and l.unit_cost>0 and not public.stock_layer_cost_was_reversed(l.id);\n if v_cost>0 then return query select round(v_cost,6),'HPP rata-rata lapisan gudang'"),
        ('M04 cost: moving-average branch removed', "if v_method='moving_average' then", "if false then"),
        ('M05 cost: last-known step skipped', "if v_cost>0 then return query select round(v_cost,6),'harga masuk terakhir gudang'::text; return;end if;", "null;"),
        ('M06 cost: other-warehouse step uses the same warehouse', "where l.item_id=p_item and l.warehouse_id<>p_warehouse and l.qty_left>0", "where l.item_id=p_item and l.warehouse_id=p_warehouse and l.qty_left>0"),
        ('M07 cost: master price ignored', "if p_master>0 then return query select p_master,'harga beli master'::text; return;end if;", "null;"),
        ('M08 cost: master wins over layer history', "select method into v_method from public.inventory_costing_settings where id;", "select method into v_method from public.inventory_costing_settings where id;\n if p_master>0 then return query select p_master,'harga beli master'::text; return;end if;"),
        ('M09 cost: average rounded to whole rupiah', "return query select round(v_cost,6),'HPP rata-rata lapisan gudang'::text;", "return query select round(v_cost,0),'HPP rata-rata lapisan gudang'::text;"),
        ('M10 cost: reversed purchase layers not excluded from the average', "where l.warehouse_id=p_warehouse and l.item_id=p_item and l.qty_left>0 and l.unit_cost>0 and not public.stock_layer_cost_was_reversed(l.id);\n if v_cost>0 then return query select round(v_cost,6),'HPP rata-rata lapisan gudang'", "where l.warehouse_id=p_warehouse and l.item_id=p_item and l.qty_left>0 and l.unit_cost>0;\n if v_cost>0 then return query select round(v_cost,6),'HPP rata-rata lapisan gudang'"),
        ('M11 cost: Admin Online guard removed from the helper', " perform admin_online_private.deny_admin_online();\n select method into v_method", " select method into v_method"),
        ('M12 cost: search_path no longer empty', "language plpgsql security definer set search_path=''\nas $fn$", "language plpgsql security definer\nas $fn$"),
        ('M13 acl: helper executable by authenticated', "revoke all on function public.opname_surplus_cost(uuid,uuid,numeric) from public,anon,authenticated,service_role;", "revoke all on function public.opname_surplus_cost(uuid,uuid,numeric) from public,anon,service_role;"),
        ('M14 post: surplus still valued at the master price', "perform public.stock_in_fifo(wh.id,r.item_id,r.selisih,sur_cost,'opname',ref,p_tanggal,null);", "perform public.stock_in_fifo(wh.id,r.item_id,r.selisih,r.buy_price,'opname',ref,p_tanggal,null);"),
        ('M15 post: gain not rounded per row', "gain:=gain+round(r.selisih*sur_cost,2);", "gain:=gain+r.selisih*sur_cost;"),
        ('M16 post: surplus never offsets the shortage expense', "offset_amt:=least(gain,loss);", "offset_amt:=0;"),
        ('M17 post: offset may exceed the shortage (negative expense)', "offset_amt:=least(gain,loss);", "offset_amt:=gain;"),
        ('M18 post: remaining surplus credited to the variance account instead of income', "jsonb_build_object('code',acc_gain,'debit',0,'credit',gain-offset_amt)", "jsonb_build_object('code',acc_variance,'debit',0,'credit',gain-offset_amt)"),
        ('M19 post: surplus inventory debit omitted', "jsonb_build_array(jsonb_build_object('code',acc_inventory,'debit',gain,'credit',0),jsonb_build_object('code',acc_variance,'debit',0,'credit',offset_amt)", "jsonb_build_array(jsonb_build_object('code',acc_inventory,'debit',0,'credit',0),jsonb_build_object('code',acc_variance,'debit',0,'credit',offset_amt)"),
        ('M20 post: shortage side loses its gross debit to 720010', "(case when loss>0 then jsonb_build_array(jsonb_build_object('code',acc_variance,'debit',loss,'credit',0),jsonb_build_object('code',acc_inventory,'debit',0,'credit',loss))", "(case when loss>0 then jsonb_build_array(jsonb_build_object('code',acc_variance,'debit',loss-offset_amt,'credit',0),jsonb_build_object('code',acc_inventory,'debit',0,'credit',loss-offset_amt))"),
        ('M21 post: mixed description loses the net sign', "case when loss>=gain then 'kurang' else 'lebih' end", "'kurang'"),
        ('M22 post: unpriced surplus not flagged', "if sur_cost=0 then unpriced:=unpriced||", "if false then unpriced:=unpriced||"),
        ('M23 post: snapshot rows keep the master price (price report shows the old value)', "'master_buy_price',e->'buy_price','buy_price',(scost->(e->>'item_id')->>'cost')::numeric", "'master_buy_price',e->'buy_price','buy_price',e->'buy_price'"),
        ('M24 post: receipt net_variance sign flipped', "'net_variance',round(loss-gain,2)", "'net_variance',round(gain-loss,2)"),
        ('M25 post: receipt omits surplus_value', "'surplus_value',round(gain,2),", ""),
        ('M26 post: snapshot loses the rule marker', "'surplus_rule','hpp-rata-rata-v1',", ""),
        ('M27 post: only-surplus description changed', "else 'Selisih lebih stok opname '||ref||' ('||doc.no_opname||')' end", "else 'Selisih lebih opname '||ref||' ('||doc.no_opname||')' end"),
        ('M28 post: journal created even with nothing to book', " if gain>0 or loss>0 then\n  offset_amt:=least(gain,loss);", " if true then\n  offset_amt:=least(gain,loss);"),
        ('M29 correction plan: additions valued at the master price again', "if new_diff>0 and p_kind='opname' then select c.unit_cost into buy", "if false and new_diff>0 and p_kind='opname' then select c.unit_cost into buy"),
        ('M30 correction plan: rule also applied to inventory adjustments', "if new_diff>0 and p_kind='opname' then select c.unit_cost into buy", "if new_diff>0 then select c.unit_cost into buy"),
        ('M31 correction journal: no offset against the shortage', "off:=least(pos,neg);", "off:=0;"),
        ('M32 correction journal: offset takes the larger side', "off:=least(pos,neg);", "off:=greatest(pos,neg);"),
        ('M33 correction journal: income credit ignores the offset', "('810004',0::numeric,pos-off)", "('810004',0::numeric,pos)"),
        ('M34 correction journal: shortage debit lost', "('720010',neg,0::numeric)", "('720010',0::numeric,0::numeric)"),
        ('M35 capture: price-report source text of surplus rows not updated', "'HPP rata-rata (selisih lebih) yang dijurnal per unit'", "'Biaya masuk/acuan PO yang dijurnal per unit'"),
        ('M36 capture: price-report value source text not updated', "'HPP rata-rata stok masuk yang dijurnal'", "'Biaya masuk dari acuan PO yang dijurnal'"),
    ]


def literal_variants(text, old, new):
    """The migration holds each patch inside an E'' literal (quotes doubled, newlines as \\n): produce the literal form of a mutation."""
    esc = lambda s: s.replace('\\', '\\\\').replace("'", "''").replace('\n', '\\n')
    return esc(old), esc(new)


def run_mutations(db, a):
    fresh(db)
    base = cand_text()
    clone(db, 'ctl'); apply_cand(db, 'ctl', base)
    ok, passes, why = run_suite(db, 'ctl', SUITE)
    check('CONTROL: unmutated candidate passes the suite (%d assertions)' % len(passes), ok, why)
    want = len(passes)
    only = os.environ.get('BP_ONLY', '').split(',') if os.environ.get('BP_ONLY') else None
    killed = 0; total = 0
    for name, old, new in mutants():
        if only and not any(name.startswith(o) for o in only): continue
        total += 1
        eo, en = literal_variants(base, old, new)
        n_plain = base.count(old); n_lit = base.count(eo) if eo != old else 0
        if n_plain + n_lit < 1 or n_plain > 1 or n_lit > 1:
            check('MUTANT ' + name + ' (anchor found exactly once)', False, 'plain=%d literal=%d' % (n_plain, n_lit)); continue
        mutated = base.replace(old, new).replace(eo, en) if eo != old else base.replace(old, new)
        clone(db, 'mut')
        try:
            apply_cand(db, 'mut', mutated)
        except RuntimeError as e:
            killed += 1; check('MUTANT ' + name + ' -> killed (does not even apply: %s)' % str(e)[:80].replace('\n', ' '), True); continue
        ok, passes, why = run_suite(db, 'mut', SUITE)
        dead = not ok or len(passes) < want
        killed += dead
        check('MUTANT ' + name + ' -> %s' % ('KILLED: ' + why[:90] if dead else 'SURVIVED (suite still green, %d)' % len(passes)), dead, why)
    check('MUTANTS killed %d / %d (>= 30 required)' % (killed, total), killed == total and (total >= 30 or only is not None))


# ------------------------------------------------------------------ neighbours
NEIGH = ['test-f1-opname-akun-selisih-postgres.py', 'test-f2-beban-selisih-karyawan-postgres.py', 'test-opname-posting-postgres.py', 'test-opname-cancel-postgres.py', 'test-opname-posting-native-postgres.py']


def run_neighbours(db, a):
    import subprocess
    for nb in NEIGH:
        res = {}
        for tag, with_cand in (('without', False), ('with', True)):
            env = {**os.environ, 'SX_NEIGH': '1', 'SX_WITH_CAND': '1' if with_cand else '0'}
            r = subprocess.run([sys.executable, '-I', str(ROOT / 'scripts/so-surplus-neighbour.py'), nb, '--pg-bin', a.pg_bin, '--with-cand' if with_cand else '--without-cand'],
                               capture_output=True, text=True, env=env)
            res[tag] = (r.returncode, [l for l in r.stdout.splitlines() if l.startswith(('FAIL', 'PASS', 'SUMMARY')) or ' PASS' in l or 'passed' in l][-400:], r.stderr[-300:])
        fails = lambda t: sorted(l for l in res[t][1] if l.startswith('FAIL'))
        check('NEIGHBOUR %s: rc without=%s with=%s; FAIL lines only with candidate: %d' % (nb, res['without'][0], res['with'][0], len(set(fails('with')) - set(fails('without')))),
              True, dict(only_with=sorted(set(fails('with')) - set(fails('without')))[:10], only_without=sorted(set(fails('without')) - set(fails('with')))[:10]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json')
    for k in ('baseline', 'diff', 'mutations', 'neighbours'): ap.add_argument('--' + k, action='store_true')
    a = ap.parse_args()
    fn = run_baseline if a.baseline else run_diff if a.diff else run_mutations if a.mutations else run_neighbours if a.neighbours else run_green
    with NativePostgres(a.pg_bin) as db:
        fn(db, a)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(mode=fn.__name__, candidate=CAND, skipped_data_fix_migrations=SKIPPED, results=RESULTS), indent=1))
    fails = [r for r in RESULTS if r['status'] == 'FAIL']
    print('SUMMARY mode=%s pass=%d fail=%d' % (fn.__name__, len(RESULTS) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
