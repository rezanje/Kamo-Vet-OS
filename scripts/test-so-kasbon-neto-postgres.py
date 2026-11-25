#!/usr/bin/env python3
"""SO-KASBON-NETO (migrasi *_so_kasbon_neto.sql): beban ke karyawan memakai selisih NETO per dokumen opname.
Native throwaway PostgreSQL only (full migration chain, fictional fixtures). Never accepts a database URL.

  python3 -I scripts/test-so-kasbon-neto-postgres.py --pg-bin DIR [--json out.json] [--baseline | --diff | --mutations | --neighbours]
  (default)     chain + candidate: SQL suite supabase/tests/so_kasbon_neto.sql (>= 80 assertions), function identity (exactly the 3 reviewed
                F2 functions change, nothing new), ACL, second application fails closed, hosted-parity ACL (anon/authenticated/service_role defaults).
  --baseline    chain WITHOUT the candidate: the suite must fail early AND the defect must be shown (gross charge 1.500 for the net example).
  --diff        differential: >= 200 randomised opnames on the chain WITHOUT and WITH the candidate. Shortage-only opnames: basis, refusal text,
                charge result, journal lines, kasbon rows identical. Opnames with surplus: independent python oracle (net rule) and invariants.
  --mutations   every mutant of the candidate in a cloned database must be killed by the suite (>= 20 required).
  --neighbours  existing opname suites (F2 charge suite, posting, cancel, SO-surplus suite) with and without the candidate; differences are listed.
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse, importlib.util, json, os, random, re, subprocess, sys, tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bpbase', ROOT / 'scripts/test-batalkan-penerimaan-petshop-postgres.py')
bp = importlib.util.module_from_spec(spec); sys.modules['bpbase'] = bp; spec.loader.exec_module(bp)
MIGRATIONS, TESTS = bp.MIGRATIONS, bp.TESTS
CANDFILE = sorted(MIGRATIONS.glob('*_so_kasbon_neto.sql'))[0]
CAND = CANDFILE.name
bp.CAND = CAND
SUITE = 'so_kasbon_neto.sql'
check, raw, clone, run_suite, apply = bp.check, bp.raw, bp.clone, bp.run_suite, bp.apply
NativePostgres, RESULTS = bp.NativePostgres, bp.RESULTS

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


def build_chain(db, exclude=()):
    tmp = Path(tempfile.mkdtemp(prefix='knchain.', dir='/opt/data'))
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


def apply_cand(db, name, text=None):
    apply(db, name, PRELUDE + (text if text is not None else cand_text()), later=False)


CHANGED = ['opname_variance_charge_basis(uuid)', 'charge_opname_variance_to_employees(uuid,jsonb,text,uuid)', 'read_opname_variance_charge(uuid)']


def fn_digests(db, dbname):
    rc, out, err = raw(db, "select p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid))||'|'||p.prosecdef::text||'|'||coalesce(p.proconfig::text,'')||'|'||p.proowner::regrole::text||'|'||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private','role_settings_private','admin_online_private') and p.prokind in ('f','p')", dbname)
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
    check('IDENTITY existing functions that changed == exactly the 3 reviewed F2 functions (definer/config/ACL included in the digest)', changed == sorted(CHANGED) and not gone, (changed, gone))
    check('IDENTITY no new function is created', not new, new)
    check('IDENTITY cancel_opname_variance_charge, opname_posting_journal, post_opname_atomic, opname_surplus_cost, opname_variance_charge_actor/allowed, guard triggers byte-identical',
          all(before[k] == after[k] for k in before if re.match(r'(cancel_opname_variance_charge|opname_posting_journal|post_opname_atomic|opname_surplus_cost|stock_correction_plan|correct_stock_document|capture_opname_price_report|opname_variance_charge_actor|opname_variance_charge_allowed|guard_opname_correction_charge|guard_opname_variance_charge|stock_out_fifo|stock_in_fifo|read_opname_price_report)\(', k)), 'unexpected drift')
    for k in CHANGED:
        b = before[k].split('|', 1)[1]; c = after[k].split('|', 1)[1]
        check('ACL/DEFINER/config of %s unchanged by the migration (create or replace keeps owner/ACL/search_path)' % k.split('(')[0], b.split('|', 1)[1:] == c.split('|', 1)[1:] or b == c or b.split('|')[1:] == c.split('|')[1:], (b, c))
    rc, out, err = raw(db, "select admin_online_private.fence_all()||'/'||admin_online_private.guard_all()", 'cand')
    after_fence = {norm(k): v for k, v in fn_digests(db, 'cand').items()}
    check('ADMIN_ONLINE fence: fence_all()/guard_all() on top of the candidate change nothing (the three functions keep their deny_admin_online call): %s' % out.strip(), rc == 0 and out.strip() == '0/0' and all(after_fence[k] == after[k] for k in CHANGED), (rc, out, err[-200:]))
    ok, passes, why = run_suite(db, 'cand', SUITE)
    check('SQL suite %s GREEN: %d assertions passed' % (SUITE, len(passes)), ok and len(passes) >= 80, why or 'passes=%d' % len(passes))
    try:
        apply(db, 'cand', cand_text(), later=False); twice = False
    except RuntimeError:
        twice = True
    check('second application of the migration fails closed (source md5 guard and existing columns; no silent re-apply)', twice)
    rc, out, err = raw(db, "select count(*) from public.opname_variance_charges", 'cand')
    check('migration leaves the charge trail empty / untouched (no data change)', rc == 0 and out.strip() == '0', out)
    # source guard: a drifted definition is refused before anything changes
    clone(db, 'drift')
    rc0, o0, e0 = raw(db, "create or replace function public.read_opname_variance_charge(p_result_id uuid) returns jsonb language sql security definer set search_path='' as $$select null::jsonb$$;", 'drift')
    try:
        apply_cand(db, 'drift'); drift_ok = False
    except RuntimeError as e:
        drift_ok = 'SO_KASBON_NETO_SOURCE_CHANGED' in str(e)
    check('source guard: a migration run against a drifted function definition is refused (SO_KASBON_NETO_SOURCE_CHANGED)', rc0 == 0 and drift_ok)
    rc, out, err = raw(db, "select count(*) from information_schema.columns where table_name='opname_variance_charges' and column_name in ('jual_kurang','jual_lebih')", 'drift')
    check('refused migration leaves no partial change (columns not added)', out.strip() == '0', out)


def run_baseline(db, a):
    fresh(db)
    clone(db, 'red')
    ok, passes, why = run_suite(db, 'red', SUITE)
    check('RED: suite fails at the baseline (%d assertions passed before the first failure)' % len(passes), not ok and len(passes) <= 12, why)
    suite = (TESTS / SUITE).read_text()
    probe = suite[:suite.index('-- ═════════ S1 hanya kurang')] + r"""
select pg_temp.mk('s2',150);select pg_temp.lay('s2',10,100);select pg_temp.mk('g2',150);select pg_temp.lay('g2',5,100);
select pg_temp.post('s2','{"s2":0,"g2":6}');
select 'DEFECT gross charge basis jual_total='||(pg_temp.basis('s2')->>'jual_total')||' hpp_part='||(pg_temp.basis('s2')->>'hpp_part')||' net_company_720010='||(pg_temp.gs('opname',pg_temp.ref('s2'),'720010'));
select pg_temp.charge('s2',pg_temp.lines(1500));
select 'DEFECT after charge 720010='||pg_temp.g(pg_temp.ref('s2'),'720010');
rollback;
"""
    rc, out, err = raw(db, probe, 'red')
    lines = [l for l in out.splitlines() if l.startswith('DEFECT')]
    check('RED defect shown on the old functions: employee charged the GROSS 1.500 while the company books net 900, and 720010 ends at -100', rc == 0 and len(lines) == 2 and 'jual_total=1500' in lines[0] and 'net_company_720010=900' in lines[0] and '720010=-100' in lines[1], lines or err[-300:])


# ------------------------------------------------------------------ differential
DIFF_PRELUDE = r"""
begin;
insert into auth.users(id,raw_user_meta_data) values('d1000000-0000-4000-8000-000000000001','{"full_name":"DK owner"}');
update profiles set role='OWNER',is_active=true where id='d1000000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values('d2000000-0000-4000-8000-000000000001','DKA','DK klinik','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','DKW','DK gudang','VET');
insert into public.employees(id,nama,status,branch_id) values('d4000000-0000-4000-8000-000000000001','DK satu','Aktif','d2000000-0000-4000-8000-000000000001'),('d4000000-0000-4000-8000-000000000002','DK dua','Aktif','d2000000-0000-4000-8000-000000000001');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) values('170001','Persediaan','ASET','D',false,true),('720010','Beban selisih','BEBAN','D',false,true),('810004','Pendapatan lain','PENDAPATAN','K',false,true),('182001','Kasbon karyawan','ASET','D',false,true) on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
create function pg_temp.runcase(seed int,spec jsonb) returns jsonb language plpgsql as $$
declare it jsonb;i int:=0;wh uuid:='d3000000-0000-4000-8000-000000000001';oid uuid:=gen_random_uuid();counts jsonb:='{}';iid uuid;l jsonb;n int;
 r jsonb;err text;ref text;rid uuid;basis jsonb;ch jsonb;total numeric;a1 numeric;lines jsonb;e1 uuid:='d4000000-0000-4000-8000-000000000001';e2 uuid:='d4000000-0000-4000-8000-000000000002';
 cerr text;crow jsonb;gl jsonb;adv numeric;
begin
 for it in select * from jsonb_array_elements(spec) loop
  i:=i+1;iid:=md5('dk-'||seed||'-'||i)::uuid;
  insert into public.items(id,code,name,unit,item_type,buy_price,sell_price) values(iid,'DK-'||seed||'-'||i,'Barang DK '||seed||'-'||i,'PCS','Persediaan',(it->>'master')::numeric,(it->>'sell')::numeric);
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
 basis:=public.opname_variance_charge_basis(rid);
 total:=(basis->>'jual_total')::numeric;
 if basis->'refuse' is not null and jsonb_typeof(basis->'refuse')='object' then
  begin
   perform public.charge_opname_variance_to_employees(rid,jsonb_build_array(jsonb_build_object('employee_id',e1,'amount',greatest(total,1))),'Uji diferensial',gen_random_uuid());
   cerr:='CHARGE_ACCEPTED_DESPITE_REFUSE';
  exception when others then cerr:=sqlerrm;end;
 else
  a1:=round(total/2,2);
  lines:=case when seed%2=0 and a1>0 and total-a1>0 then jsonb_build_array(jsonb_build_object('employee_id',e1,'amount',a1),jsonb_build_object('employee_id',e2,'amount',total-a1))
              else jsonb_build_array(jsonb_build_object('employee_id',e1,'amount',total)) end;
  begin ch:=public.charge_opname_variance_to_employees(rid,lines,'Uji diferensial',gen_random_uuid());
  exception when others then cerr:=sqlerrm;end;
  select to_jsonb(c)-'id'-'request_key'-'request_payload'-'actor_id'-'result_id'-'no_hasil'-'journal_id'-'advance_ids'-'created_at'-'log_label'-'lines'-'minus_lines'-'jual_kurang'-'jual_lebih'-'branch_id'-'warehouse_id'-'tanggal' into crow from public.opname_variance_charges c where c.result_id=rid;
 end if;
 select coalesce(jsonb_object_agg(code,net),'{}') into gl from (select a.code,sum(l2.debit-l2.credit) net from public.journal_lines l2 join public.coa_accounts a on a.id=l2.account_id join public.journal_entries e on e.id=l2.entry_id where e.source='opname-beban-karyawan' and e.source_ref=ref group by a.code) x;
 select coalesce(sum(jumlah),0) into adv from public.cash_advances where alasan like '%'||ref||'%';
 return jsonb_build_object('seed',seed,'err',null,
  'basis',basis-'result_id'-'order_id'-'branch_id'-'warehouse_id'-'today',
  'cerr',cerr,'charge',case when ch is null then null else ch-'charge_id'-'result_id'-'journal_id'-'advance_ids' end,'row',crow,'gl',gl,'adv',adv,
  'so720010',(select coalesce(sum(l2.debit-l2.credit),0) from public.journal_lines l2 join public.coa_accounts a on a.id=l2.account_id join public.journal_entries e on e.id=l2.entry_id where e.source='opname' and e.source_ref=ref and a.code='720010'),
  'all720010',(select coalesce(sum(l2.debit-l2.credit),0) from public.journal_lines l2 join public.coa_accounts a on a.id=l2.account_id join public.journal_entries e on e.id=l2.entry_id where e.source in('opname','opname-beban-karyawan') and e.source_ref=ref and a.code='720010'));
end$$;
"""

NEW_KEYS = ('plus_lines', 'plus_count', 'jual_kurang', 'jual_lebih', 'hpp_lebih', 'hpp_neto')


def gen_cases(n, rnd):
    cases = []
    for seed in range(1, n + 1):
        kind = rnd.choice(['short'] * 6 + ['zero', 'drainshort'] + ['mixed'] * 5 + ['surplus_only'] * 2)
        items = []
        for _ in range(rnd.randint(1, 4)):
            layers = [dict(qty=rnd.randint(2, 12), cost=rnd.choice([25, 40, 55.5, 100, 120.25, 333])) for _ in range(rnd.randint(1, 3))]
            have = sum(l['qty'] for l in layers)
            sell = rnd.choice([0, 30, 60, 99.99, 150, 150, 220, 1000])
            master = rnd.choice([0, 0, 30, 75])
            role = {'short': 'short', 'zero': 'zero', 'drainshort': 'short', 'surplus_only': 'surplus'}.get(kind) or rnd.choice(['short', 'short', 'surplus', 'surplus', 'zero'])
            delta = 0 if role == 'zero' else (-rnd.randint(1, have) if role == 'short' else rnd.randint(1, 7))
            items.append(dict(layers=layers, master=master, sell=sell, delta=delta, role=role))
        if all(i['delta'] == 0 for i in items): items[0]['delta'] = -1; items[0]['role'] = 'short'
        cases.append(dict(seed=seed, kind=kind, spec=items))
    return cases


def case_sql(cases):
    return DIFF_PRELUDE + "".join("select 'CASE '||pg_temp.runcase(%d,%s::jsonb)::text;\n" % (c['seed'], "'" + json.dumps(c['spec']).replace("'", "''") + "'") for c in cases) + "rollback;\n"


def parse(out):
    d = {}
    for l in out.splitlines():
        if l.startswith('CASE '):
            j = json.loads(l[5:]); d[j['seed']] = j
    return d


def r2(x): return float(round(x + 1e-9, 2)) if x >= 0 else -float(round(-x + 1e-9, 2))
def num(x): return round(float(x), 2)


def oracle(spec, got_new):
    """Independent re-implementation of the NET rule from the fixture itself (layer costs are single-warehouse FIFO, weighted-average surplus cost)."""
    kurang = lebih = hppk = 0.0
    for it in spec:
        if it['delta'] < 0:
            q = -it['delta']; left = q; cost = 0.0
            for l in it['layers']:
                t = min(left, l['qty']); cost += t * l['cost']; left -= t
                if left <= 0: break
            kurang += q * it['sell']; hppk += cost
        elif it['delta'] > 0:
            lebih += it['delta'] * it['sell']
    return r2(kurang), r2(lebih), r2(hppk)


def run_diff(db, a):
    rnd = random.Random(20261125)
    cases = gen_cases(240, rnd)
    fresh(db)
    clone(db, 'old'); clone(db, 'new'); apply_cand(db, 'new')
    outs = {}
    for name in ('old', 'new'):
        rc, out, err = raw(db, case_sql(cases), name)
        outs[name] = parse(out)
        check('DIFF %s: all %d cases executed' % (name, len(cases)), rc == 0 and len(outs[name]) == len(cases), (rc, len(outs[name]), err[-300:]))
    o, n = outs['old'], outs['new']
    byclass = {}; bad = []
    for c in cases:
        s = c['seed']; ro, rn = o.get(s), n.get(s)
        if not ro or not rn: bad.append((s, 'missing')); continue
        has_surplus = any(i['delta'] > 0 for i in c['spec']); has_short = any(i['delta'] < 0 for i in c['spec'])
        cls = 'A_no_surplus' if not has_surplus else 'B_with_surplus'
        byclass.setdefault(cls, []).append(s)
        if ro.get('err') or rn.get('err'):
            if ro.get('err') != rn.get('err') and cls == 'A_no_surplus': bad.append((s, cls, 'SO error differs'))
            continue
        if cls == 'A_no_surplus':
            bn = {k: v for k, v in rn['basis'].items() if k not in NEW_KEYS}
            if ro['basis'] != bn: bad.append((s, cls, 'basis differs', {k: (ro['basis'].get(k), bn.get(k)) for k in bn if ro['basis'].get(k) != bn.get(k)}))
            if rn['basis'].get('plus_count') != 0 or num(rn['basis'].get('jual_lebih')) != 0 or num(rn['basis'].get('jual_kurang')) != num(rn['basis']['jual_total']): bad.append((s, cls, 'new keys not neutral'))
            for k in ('cerr', 'charge', 'gl', 'adv', 'so720010', 'all720010'):
                if ro.get(k) != rn.get(k): bad.append((s, cls, k + ' differs', ro.get(k), rn.get(k)))
            orow = ro.get('row'); nrow = rn.get('row')
            if orow != nrow: bad.append((s, cls, 'trail row differs', orow, nrow))
        else:
            ku, le, hp = oracle(c['spec'], rn)
            b = rn['basis']
            if not has_short:
                # surplus-only: nothing to charge, TANPA_KURANG on both sides
                if b['refuse'] is None or b['refuse']['code'] != 'TANPA_KURANG' or ro['basis']['refuse'] is None or ro['basis']['refuse']['code'] != 'TANPA_KURANG': bad.append((s, cls, 'surplus-only should be TANPA_KURANG', b['refuse'], ro['basis']['refuse']))
                continue
            net = max(r2(ku) - r2(le), 0)
            if abs(num(b['jual_kurang']) - ku) > 0.011 or abs(num(b['jual_lebih']) - le) > 0.011: bad.append((s, cls, 'sides != oracle', (b['jual_kurang'], b['jual_lebih']), (ku, le)))
            if abs(num(b['jual_total']) - net) > 0.011: bad.append((s, cls, 'net != oracle', b['jual_total'], net))
            if abs(num(ro['basis']['jual_total']) - ku) > 0.011: bad.append((s, cls, 'old gross != oracle kurang', ro['basis']['jual_total'], ku))
            if ro['basis']['minus_lines'] != b['minus_lines']: bad.append((s, cls, 'shortage lines changed'))
            if net <= 0:
                code = (b.get('refuse') or {}).get('code')
                want = 'HARGA_JUAL_KOSONG' if ku <= 0 else 'LEBIH_MENUTUPI'
                if code != want or not (rn.get('cerr') or '').startswith('BEBAN_KARYAWAN_' + want): bad.append((s, cls, 'refusal', code, rn.get('cerr')))
                if rn.get('charge') is not None or num(rn['adv']) != 0: bad.append((s, cls, 'charge created despite net 0'))
            else:
                if rn.get('cerr'): bad.append((s, cls, 'charge failed', rn['cerr'])); continue
                # company's remaining 720010 expense on the SO journal = loss - min(gain, loss); hpp part is min(net, that)
                left720 = num(rn['so720010'])
                if left720 < -0.001: bad.append((s, cls, 'SO 720010 negative'))
                if abs(num(b['hpp_neto']) - max(left720, 0)) > 0.011: bad.append((s, cls, 'hpp_neto != SO journal 720010', b['hpp_neto'], left720))
                if abs(num(b['hpp_part']) - min(net, max(left720, 0))) > 0.011: bad.append((s, cls, 'hpp_part', b['hpp_part'], net, left720))
                if abs(num(b['hpp_part']) + num(b['gain_part']) - net) > 0.011: bad.append((s, cls, 'parts != net'))
                if abs(num(rn['adv']) - net) > 0.011: bad.append((s, cls, 'kasbon sum != net', rn['adv'], net))
                if abs(num(rn['gl'].get('182001', 0)) - net) > 0.011: bad.append((s, cls, '182001 != net'))
                if abs(num(rn['gl'].get('720010', 0)) + num(b['hpp_part'])) > 0.011 and not (b['hpp_part'] == 0 and '720010' not in rn['gl']): bad.append((s, cls, 'Cr 720010 != hpp_part', rn['gl']))
                if num(rn['all720010']) < -0.011: bad.append((s, cls, 'expense account negative after charge', rn['all720010']))
                if abs(sum(float(v) for v in rn['gl'].values())) > 0.001: bad.append((s, cls, 'charge journal unbalanced'))
                if num(rn['adv']) > num(ro['adv']) + 0.011: bad.append((s, cls, 'new charge larger than old gross'))
                if rn['row'] is None or abs(num(rn['row']['total']) - net) > 0.011: bad.append((s, cls, 'trail total'))
    check('DIFF classes: %s (>= 200 cases)' % {k: len(v) for k, v in byclass.items()}, len(cases) >= 200 and all(len(v) >= 40 for v in byclass.values()) and len(byclass) == 2, {k: len(v) for k, v in byclass.items()})
    badA = [b for b in bad if len(b) > 1 and b[1] == 'A_no_surplus']; badB = [b for b in bad if len(b) > 1 and b[1] == 'B_with_surplus']
    check('DIFF A (no surplus, shortage-only/zero): %d cases identical old vs new (basis minus new keys, refusal text, charge result, journal lines, kasbon sum, trail row, SO error)' % len(byclass.get('A_no_surplus', [])), not badA, badA[:3])
    check('DIFF B (with surplus): %d cases match the independent NET oracle (sides, net floor at 0, hpp_neto = SO journal 720010, parts, journal balanced, 720010 never negative, kasbon = net, refusals)' % len(byclass.get('B_with_surplus', [])), not badB, badB[:3])
    check('DIFF no case missing', not [b for b in bad if len(b) == 2], [b for b in bad if len(b) == 2][:3])
    nz = sum(1 for c in cases if (c['seed'] in n and n[c['seed']].get('charge') is not None))
    smaller = sum(1 for c in byclass.get('B_with_surplus', []) if n[c].get('charge') and o[c].get('charge') and num(n[c]['charge']['total']) < num(o[c]['charge']['total']))
    refused0 = sum(1 for c in byclass.get('B_with_surplus', []) if (n[c].get('basis') or {}).get('refuse') and n[c]['basis']['refuse'].get('code') == 'LEBIH_MENUTUPI')
    check('DIFF coverage: %d charges created, %d surplus cases charged LESS than before, %d refused LEBIH_MENUTUPI' % (nz, smaller, refused0), nz >= 100 and smaller >= 15 and refused0 >= 5, (nz, smaller, refused0))
    errs_old = sum(1 for s in o if o[s].get('err')); errs_new = sum(1 for s in n if n[s].get('err'))
    check('DIFF SO posting refusals identical in count: %d old / %d new' % (errs_old, errs_new), errs_old == errs_new, (errs_old, errs_new))


# ------------------------------------------------------------------ mutants
def mutants():
    A = lambda name, old, new: (name, old, new)
    return [
        A('M01 net: nilai beban memakai kotor (kurang saja)', "v_total := greatest(v_jual_kurang - v_jual_lebih, 0);", "v_total := v_jual_kurang;"),
        A('M02 net: lantai nol dihapus', "v_total := greatest(v_jual_kurang - v_jual_lebih, 0);", "v_total := v_jual_kurang - v_jual_lebih;"),
        A('M03 net: lebih dihitung dengan HPP, bukan harga jual', "coalesce(sum((e->>'nilai_selisih_jual')::numeric), 0),\n           coalesce(sum((e->>'nilai_selisih_modal')::numeric) filter (where jsonb_typeof(e->'nilai_selisih_modal') = 'string'), 0),\n           count(*)\n      into v_plus", "coalesce(sum((e->>'nilai_selisih_modal')::numeric), 0),\n           coalesce(sum((e->>'nilai_selisih_modal')::numeric) filter (where jsonb_typeof(e->'nilai_selisih_modal') = 'string'), 0),\n           count(*)\n      into v_plus"),
        A('M04 net: sisi lebih tidak dibulatkan', "v_jual_lebih := round(v_jual_plus, 2);", "v_jual_lebih := v_jual_plus;"),
        A('M05 net: sisi kurang tidak dibulatkan', "v_jual_kurang := round(v_jual, 2);", "v_jual_kurang := v_jual;"),
        A('M06 net: baris lebih diambil dari baris kurang (filter terbalik)', "     where (e->>'selisih')::numeric > 0;\n    -- Beban yang masih tercatat", "     where (e->>'selisih')::numeric < 0;\n    -- Beban yang masih tercatat"),
        A('M07 hpp: kredit 720010 pada jurnal asal diabaikan', "v_hpp_net := least(v_hpp_total, greatest(v_journal_loss - v_journal_credit, 0));", "v_hpp_net := least(v_hpp_total, greatest(v_journal_loss, 0));"),
        A('M08 hpp: bagian HPP memakai HPP kotor, bukan beban tersisa', "v_hpp_part := least(v_total, v_hpp_net);", "v_hpp_part := least(v_total, v_hpp_total);"),
        A('M09 hpp: beban tersisa tanpa lantai nol', "v_hpp_net := least(v_hpp_total, greatest(v_journal_loss - v_journal_credit, 0));", "v_hpp_net := least(v_hpp_total, v_journal_loss - v_journal_credit);"),
        A('M10 hpp: beban tersisa tanpa batas HPP kotor', "v_hpp_net := least(v_hpp_total, greatest(v_journal_loss - v_journal_credit, 0));", "v_hpp_net := greatest(v_journal_loss - v_journal_credit, 0);"),
        A('M11 refuse: penolakan LEBIH_MENUTUPI dihapus', "    elsif v_total <= 0 then\n      v_code := 'LEBIH_MENUTUPI';", "    elsif false then\n      v_code := 'LEBIH_MENUTUPI';"),
        A('M12 refuse: HARGA_JUAL_KOSONG menguji nilai neto', "    elsif v_jual_kurang <= 0 then", "    elsif v_total <= 0 then"),
        A('M13 refuse: pesan LEBIH_MENUTUPI menukar dua angka', "trim_scale(v_jual_lebih)::text, trim_scale(v_jual_kurang)::text);", "trim_scale(v_jual_kurang)::text, trim_scale(v_jual_lebih)::text);"),
        A('M14 basis: baris lebih tidak dikembalikan', "'plus_lines', v_plus, 'plus_count', v_plus_count,", "'plus_lines', '[]'::jsonb, 'plus_count', v_plus_count,"),
        A('M15 basis: HPP lebih memakai nilai jual', "'hpp_lebih', round(v_hpp_plus, 2),", "'hpp_lebih', round(v_jual_plus, 2),"),
        A('M16 basis: hpp_neto tidak dikembalikan dengan nilai benar', "'hpp_neto', v_hpp_net,", "'hpp_neto', v_hpp_total,"),
        A('M17 basis: jual_total mengembalikan kotor', "'jual_total', v_total,", "'jual_total', v_jual_kurang,"),
        A('M18 charge: bukti jual_kurang tidak disimpan', "v_advances, v_journal, v_kurang, v_lebih);", "v_advances, v_journal, null, null);"),
        A('M19 charge: bukti jual_lebih tertukar dengan kurang', "v_advances, v_journal, v_kurang, v_lebih);", "v_advances, v_journal, v_kurang, v_kurang);"),
        A('M20 charge: deskripsi jurnal tanpa keterangan neto', "|| case when v_lebih > 0 then ' — neto: kurang Rp ' || trim_scale(v_kurang)::text || ' − lebih Rp ' || trim_scale(v_lebih)::text else '' end;", ";"),
        A('M21 charge: keterangan neto menukar kurang dan lebih', "' — neto: kurang Rp ' || trim_scale(v_kurang)::text || ' − lebih Rp ' || trim_scale(v_lebih)::text", "' — neto: kurang Rp ' || trim_scale(v_lebih)::text || ' − lebih Rp ' || trim_scale(v_kurang)::text"),
        A('M22 charge: pembagian dicocokkan dengan nilai kotor', "if v_sum is distinct from v_total then", "if v_sum is distinct from v_kurang then"),
        A('M23 charge: nilai kurang tidak diambil dari dasar', "  v_kurang := (v_basis->>'jual_kurang')::numeric;\n", "  v_kurang := v_total;\n"),
        A('M24 read: riwayat tidak memuat bukti neto', "'jual_kurang', c.jual_kurang, 'jual_lebih', c.jual_lebih,", ""),
        A('M25 table: batasan neto dilonggarkan (total bebas)', " and jual_kurang > 0 and jual_lebih >= 0 and total = greatest(jual_kurang - jual_lebih, 0)));", " and jual_kurang > 0 and jual_lebih >= 0));"),
        A('M26 table: lebih boleh negatif', "jual_kurang > 0 and jual_lebih >= 0 and total", "jual_kurang > 0 and total"),
        A('M27 table: kolom jual_kurang dibulatkan ke rupiah', "add column jual_kurang numeric(15,2)", "add column jual_kurang numeric(15,0)"),
        A('M28 table: kolom bukti NOT NULL', "add column jual_kurang numeric(15,2), add column jual_lebih numeric(15,2);", "add column jual_kurang numeric(15,2) not null default 0, add column jual_lebih numeric(15,2) not null default 0;"),
        A('M29 acl: fungsi dasar dibuka untuk authenticated', "do $check$ begin", "grant execute on function public.opname_variance_charge_basis(uuid) to authenticated;\ndo $check$ begin"),
        A('M30 acl: fungsi baca dibuka untuk anon', "do $check$ begin", "grant execute on function public.read_opname_variance_charge(uuid) to anon;\ndo $check$ begin"),
        A('M31 acl: fungsi catat dibuka untuk service_role', "do $check$ begin", "grant execute on function public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid) to service_role;\ndo $check$ begin"),
        A('M32 definer: dasar tidak lagi SECURITY DEFINER', "create or replace function public.opname_variance_charge_basis(p_result_id uuid) returns jsonb\nlanguage plpgsql volatile security definer set search_path = ''", "create or replace function public.opname_variance_charge_basis(p_result_id uuid) returns jsonb\nlanguage plpgsql volatile set search_path = ''"),
        A('M33 search_path: baca tidak lagi dikunci', "create or replace function public.read_opname_variance_charge(p_result_id uuid) returns jsonb\nlanguage plpgsql volatile security definer set search_path = ''", "create or replace function public.read_opname_variance_charge(p_result_id uuid) returns jsonb\nlanguage plpgsql volatile security definer"),
        A('M34 lock_timeout: catat kehilangan lock_timeout', "security definer set search_path = '' set lock_timeout = '8s' as $$\ndeclare\n  v_actor text := public.opname_variance_charge_actor(); v_uid uuid := auth.uid(); v_reason text; v_norm jsonb;", "security definer set search_path = '' as $$\ndeclare\n  v_actor text := public.opname_variance_charge_actor(); v_uid uuid := auth.uid(); v_reason text; v_norm jsonb;"),
        A('M35 jurnal: bagian pendapatan lain dihitung dari nilai kotor', "'gain_part', v_total - v_hpp_part,", "'gain_part', v_jual_kurang - v_hpp_part,"),
        A('M36 jurnal: jurnal yang divoid ikut dihitung', "       and a.code = '720010' and j.voided_at is null;\n  end if;", "       and a.code = '720010';\n  end if;"),
        A('M37 jurnal: jurnal penyesuaian bersumber opname tidak ikut dihitung', "(l.entry_id = any (v_rec.journal_ids) or (j.source = 'opname' and j.source_ref = v_res.no_hasil))", "l.entry_id = any (v_rec.journal_ids)"),
        A('M39 pagar Admin Online dihapus dari catat', "begin\n  perform admin_online_private.deny_admin_online();\n  if v_actor is null then", "begin\n  if v_actor is null then"),
        A('M40 pagar Admin Online dihapus dari baca', "begin\n  perform admin_online_private.deny_admin_online();\n  if auth.uid() is null or auth.role()", "begin\n  if auth.uid() is null or auth.role()"),
        A('M38 jurnal: penyesuaian dicocokkan hanya dengan sumber (nomor hasil apa pun)', "(l.entry_id = any (v_rec.journal_ids) or (j.source = 'opname' and j.source_ref = v_res.no_hasil))", "(l.entry_id = any (v_rec.journal_ids) or j.source = 'opname')"),
    ]


def run_mutations(db, a):
    fresh(db)
    base = cand_text()
    clone(db, 'ctl'); apply_cand(db, 'ctl', base)
    ok, passes, why = run_suite(db, 'ctl', SUITE)
    check('CONTROL: unmutated candidate passes the suite (%d assertions)' % len(passes), ok, why)
    want = len(passes)
    only = os.environ.get('BP_ONLY', '').split(',') if os.environ.get('BP_ONLY') else None
    killed = 0; total = 0; equivalent = []
    for name, old, new in mutants():
        if only and not any(name.startswith(o) for o in only): continue
        total += 1
        if base.count(old) != 1:
            check('MUTANT ' + name + ' (anchor found exactly once)', False, 'count=%d' % base.count(old)); continue
        mutated = base.replace(old, new)
        clone(db, 'mut')
        try:
            apply_cand(db, 'mut', mutated)
        except RuntimeError as e:
            killed += 1; check('MUTANT ' + name + ' -> killed (does not even apply: %s)' % str(e)[:80].replace('\n', ' '), True); continue
        ok, passes, why = run_suite(db, 'mut', SUITE)
        dead = not ok or len(passes) < want
        killed += dead
        check('MUTANT ' + name + ' -> %s' % ('KILLED: ' + why[:90] if dead else 'SURVIVED (suite still green, %d)' % len(passes)), dead, why)
    check('MUTANTS killed %d / %d (>= 20 required)' % (killed, total), killed == total and (total >= 20 or only is not None))


# ------------------------------------------------------------------ neighbours
NEIGH_F2_ORIGINAL = 'test-f2-beban-selisih-karyawan-postgres.py'
NEIGH_F2_NET = 'test-f2-beban-selisih-karyawan-neto-postgres.py'


def run_neighbours(db, a):
    def nb_run(nb, with_cand):
        r = subprocess.run([sys.executable, '-I', str(ROOT / 'scripts/so-kasbon-neighbour.py'), nb, '--pg-bin', a.pg_bin, '--with-cand' if with_cand else '--without-cand'], capture_output=True, text=True)
        lines = r.stdout.splitlines()
        return r.returncode, sum(1 for l in lines if l.startswith('PASS')), sorted(l for l in lines if l.startswith('FAIL')), r.stderr[-300:]
    rc0, p0, f0, e0 = nb_run(NEIGH_F2_ORIGINAL, False)
    check('NEIGHBOUR F2 charge suite WITHOUT the candidate (baseline): rc=%s, %d PASS, %d FAIL' % (rc0, p0, len(f0)), rc0 == 0 and p0 >= 34 and not f0, (f0[:3], e0))
    rc1, p1, f1, e1 = nb_run(NEIGH_F2_ORIGINAL, True)
    check('NEIGHBOUR F2 charge suite WITH the candidate, ORIGINAL (gross) expectations: %d FAIL, all on the mixed-opname figures that intentionally became NET (informational)' % len(f1), len(f1) >= 1 and all(('225' in x or '250' in x or '180' in x or 'battery' in x or 'jurnal' in x or 'kasbon' in x or 'ringkasan' in x or 'gaji' in x) for x in f1), f1[:8])
    rc2, p2, f2, e2 = nb_run(NEIGH_F2_NET, True)
    check('NEIGHBOUR F2 charge suite WITH the candidate, NET expectations for the one mixed opname: rc=%s, %d/34 PASS, %d FAIL (permissions, validation, idempotency, cancel, correction guard, period, kasbon rules unchanged)' % (rc2, p2, len(f2)), rc2 == 0 and p2 >= 34 and not f2, (f2[:3], e2))
    # SO-SURPLUS suite on the chain with the candidate on top (state after #580 + this migration)
    fresh(db)
    clone(db, 'sx'); apply_cand(db, 'sx')
    ok, passes, why = run_suite(db, 'sx', 'so_surplus_hpp.sql')
    check('NEIGHBOUR so_surplus_hpp.sql still GREEN on top of the candidate (%d assertions)' % len(passes), ok and len(passes) >= 151, why)


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
