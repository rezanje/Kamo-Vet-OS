#!/usr/bin/env python3
"""Lantai harga klinik (P03) dengan promo per baris (migrasi 20261111140000_lantai_harga_promo_per_baris.sql).
Native throwaway PostgreSQL only; never accepts a database URL.

  python3 -I scripts/test-promo-floor-line-postgres.py --pg-bin DIR [--json out.json] [--baseline | --mutations | --fuzz-n N]
  (default)   chain + candidate: SQL suite supabase/tests/promo_floor_line.sql, rule matrix unchanged (promo 0 = old rule),
              random differential against an exact copy of the OLD floor (full message text identical when no promo is in effect),
              random carts vs an independent Python model of the new rule (nets, zero-sum, boundaries), printed minimum price check,
              neighbouring rolled-back suites p03_price_floor.sql / p03_price_floor_pesan.sql.
  --baseline  chain WITHOUT the candidate (+ the bare column so the suite can run): the suite must FAIL at the real GROOM11 case (RED).
  --mutations every mutant of the candidate in a cloned database must be killed by the suite or the random model comparison.
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from fractions import Fraction
from pathlib import Path
import argparse, importlib.util, json, os, re, subprocess, sys, tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
from native_postgres import NativePostgres  # noqa: E402

CAND = '20261111140000_lantai_harga_promo_per_baris.sql'
MIGRATIONS = ROOT / 'supabase/migrations'
TESTS = ROOT / 'supabase/tests'
RESULTS = []


def check(name, ok, detail=''):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=str(detail)[:700]))
    print(RESULTS[-1]['status'], name, str(detail)[:300], flush=True)
    return ok


def build_chain(db, exclude):
    tmp = Path(tempfile.mkdtemp(prefix='pfchain.', dir='/opt/data'))
    try:
        (tmp / 'supabase/migrations').mkdir(parents=True)
        for f in MIGRATIONS.glob('*.sql'):
            if f.name not in exclude:
                (tmp / 'supabase/migrations' / f.name).symlink_to(f)
        old = fixture.ROOT
        fixture.ROOT = tmp
        try:
            fixture.DisposablePostgres.bootstrap(db)
        finally:
            fixture.ROOT = old
    finally:
        for f in (tmp / 'supabase/migrations').glob('*'):
            f.unlink()
        (tmp / 'supabase/migrations').rmdir(); (tmp / 'supabase').rmdir(); tmp.rmdir()


def raw(db, sql, dbname=None):
    """psql with stderr kept (NOTICE lines); returns (rc, stdout, stderr)."""
    env = {**os.environ, 'PSQLRC': '/dev/null'}
    if dbname: env['PGDATABASE'] = dbname
    r = subprocess.run(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                       input=sql, text=True, capture_output=True, env=env)
    return r.returncode, r.stdout, r.stderr


def clone(db, name, template='tpl_base'):
    os.environ.pop('PGDATABASE', None)
    db.sql('drop database if exists %s' % name)
    db.sql('create database %s template %s' % (name, template))


def apply(db, dbname, text):
    rc, out, err = raw(db, 'begin;\n' + text + '\ncommit;', dbname)
    if rc: raise RuntimeError(err + out)


def run_suite(db, dbname, name='promo_floor_line.sql'):
    rc, out, err = raw(db, (TESTS / name).read_text(), dbname)
    passes = [l[len('PF_PASS '):] for l in err.splitlines() if l.startswith('PF_PASS ') or 'PF_PASS ' in l]
    passes = [re.sub(r'^.*PF_PASS ', '', l) for l in err.splitlines() if 'PF_PASS ' in l]
    why = ''
    if rc:
        errs = [l for l in err.splitlines() if l.startswith('ERROR')]
        why = (errs[0] if errs else err.strip().splitlines()[-1] if err.strip() else 'error')[:400]
    return rc == 0, passes, why


# --------------------------------------------------------------------------- random differential / model
FUZZ_SQL = r"""
create schema if not exists zz;
insert into branches(id,code,name,type) values ('f0610000-0000-4000-8000-000000000001','FZVET','fz','KLINIK') on conflict do nothing;
insert into customers(id,name,phone) values('f0650000-0000-4000-8000-000000000001','fz','080000000606') on conflict do nothing;
insert into pets(id,customer_id,name) values('f0660000-0000-4000-8000-000000000001','f0650000-0000-4000-8000-000000000001','fz') on conflict do nothing;
insert into visits(id,branch_id,customer_id,pet_id) values('f0670000-0000-4000-8000-000000000001','f0610000-0000-4000-8000-000000000001','f0650000-0000-4000-8000-000000000001','f0660000-0000-4000-8000-000000000001') on conflict do nothing;
insert into items(id,code,name,unit,item_type,buy_price) values
 ('f0640000-0000-4000-8000-000000000003','FZMED','fz obat','pcs','Persediaan',1000),
 ('f0640000-0000-4000-8000-000000000004','FZSVC','fz jasa','jasa','Jasa',0),
 ('f0640000-0000-4000-8000-000000000005','FZPKG','fz paket','paket','Grup',0) on conflict do nothing;
insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values
 ('f0640000-0000-4000-8000-000000000005','f0640000-0000-4000-8000-000000000003',1,'pcs',1),
 ('f0640000-0000-4000-8000-000000000005','f0640000-0000-4000-8000-000000000004',1,'jasa',1) on conflict do nothing;
insert into invoices(id,visit_id) values('f06b0000-0000-4000-8000-000000000001','f0670000-0000-4000-8000-000000000001') on conflict do nothing;

-- spec: {"rows":[{"d":"R01","k":"obat|jasa","q":1,"p":100,"pct":0,"h":null,"promo":null|n,"pkg":bool,"noitem":bool}],"sub":n,"disc":n,"fn":"new|old"}
create or replace function zz.call(spec jsonb) returns text language plpgsql as $$
declare r jsonb;
begin
 delete from invoice_items where invoice_id='f06b0000-0000-4000-8000-000000000001';
 for r in select * from jsonb_array_elements(spec->'rows') loop
  insert into invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id,hpp,diskon_persen,satuan,package_item_id,package_qty,promo_discount)
  values('f06b0000-0000-4000-8000-000000000001',r->>'d',(r->>'q')::int,(r->>'p')::numeric,r->>'k',
   case when (r->>'noitem')::boolean then null when r->>'k'='jasa' then 'f0640000-0000-4000-8000-000000000004'::uuid else 'f0640000-0000-4000-8000-000000000003'::uuid end,
   nullif(r->>'h','')::numeric,(r->>'pct')::numeric,'pcs',
   case when (r->>'pkg')::boolean then 'f0640000-0000-4000-8000-000000000005'::uuid end,case when (r->>'pkg')::boolean then 1 end,
   case when r->'promo' is null or r->'promo'='null'::jsonb then null else (r->>'promo')::numeric end);
 end loop;
 begin
  if spec->>'fn'='old' then perform clinic_private.zz_old_floor('f06b0000-0000-4000-8000-000000000001',(spec->>'sub')::numeric,(spec->>'disc')::numeric);
  else perform clinic_private.assert_invoice_price_floor('f06b0000-0000-4000-8000-000000000001',(spec->>'sub')::numeric,(spec->>'disc')::numeric); end if;
  return 'ACCEPT';
 exception when others then return sqlerrm; end;
end$$;

create or replace function zz.gen(n int, seed float8) returns table(i int, spec jsonb) language plpgsql as $$
declare i_ int; k int; cnt int; rows_ jsonb; row_ jsonb; kind text; pkg boolean; noitem boolean; q int; p numeric; pct numeric; h numeric; g numeric; promo numeric;
  sub numeric; psum numeric; disc numeric; mode int; has_promo boolean; used_o boolean; used_j boolean;
  qs int[] := array[1,1,1,2,3,5,10]; ps numeric[] := array[0,500,1000,1001,5000,18000,90000,123456.78,2500.5,333.33,7777];
  pcts numeric[] := array[0,0,0,0,10,25,33.33,50,100]; hs numeric[] := array[null,0,500,999.99,1000,5000,11287.29,50000,0.01,3000];
begin
 perform setseed(seed);
 for i_ in 1..n loop
  cnt := 1 + floor(random()*5)::int; rows_ := '[]'::jsonb; sub := 0; psum := 0; has_promo := random() < 0.6; used_o := false; used_j := false;
  for k in 1..cnt loop
   mode := floor(random()*10)::int;
   kind := case when mode < 5 then 'obat' when mode < 7 then 'jasa' else 'obat' end;
   pkg := mode >= 7 and mode < 9 and random() < 0.8;
   if pkg and random() < 0.5 then kind := 'jasa'; end if;
   noitem := mode = 9;
   if pkg then
     if (kind = 'obat' and used_o) or (kind = 'jasa' and used_j) then pkg := false;
     elsif kind = 'obat' then used_o := true; else used_j := true; end if;
   end if;
   if pkg then noitem := false; end if;
   q := qs[1+floor(random()*array_length(qs,1))::int]; if pkg then q := 1; end if; p := ps[1+floor(random()*array_length(ps,1))::int];
   pct := pcts[1+floor(random()*array_length(pcts,1))::int]; h := hs[1+floor(random()*array_length(hs,1))::int];
   if kind = 'jasa' then h := null; end if;
   g := round(q*p*(1-pct/100),2);
   promo := null;
   if has_promo and random() < 0.55 then
     promo := case when random() < 0.12 then g when random() < 0.1 then 0 else round((random()*g)::numeric,2) end;
     psum := psum + promo;
   end if;
   sub := sub + g;
   rows_ := rows_ || jsonb_build_array(jsonb_build_object('d','R'||lpad(k::text,2,'0'),'k',kind,'q',q,'p',p,'pct',pct,'h',h,'promo',promo,'pkg',pkg,'noitem',noitem));
  end loop;
  mode := floor(random()*10)::int;
  disc := case
    when psum > 0 and mode < 3 then psum                                    -- discount = promo exactly
    when psum > 0 and mode < 7 then least(sub, psum + round((random()*(sub-psum))::numeric,2))   -- promo + other discounts
    when psum > 0 and mode < 8 then sub                                     -- whole invoice
    when psum > 0 then round((random()*psum)::numeric,2)                    -- discount below promo: invalid state, old rule
    when mode < 3 then 0 when mode < 5 then floor(sub/10) when mode < 7 then floor(sub/2) when mode < 8 then sub
    else round((random()*sub)::numeric,2) end;
  if disc > sub then disc := sub; end if;
  i := i_; spec := jsonb_build_object('rows',rows_,'sub',sub,'disc',disc,'fn','new'); return next;
 end loop;
end$$;
"""


def q2(x):  # PG round(numeric,2): half away from zero == ROUND_HALF_UP for the non-negative values here
    x = Fraction(x)
    n = x * 100
    fl = n.numerator // n.denominator
    return Fraction(fl + (1 if n - fl >= Fraction(1, 2) else 0), 100)


def model(spec):
    """Independent model of the new rule. Returns (outcome prefix or 'ACCEPT', ambiguous?)."""
    S = Fraction(str(spec['sub'])); D = Fraction(str(spec['disc']))
    rows = spec['rows']
    gross = {r['d']: q2(Fraction(r['q']) * Fraction(str(r['p'])) * (1 - Fraction(str(r['pct'])) / 100)) for r in rows}
    prom = {}
    for r in rows:
        pr = r.get('promo')
        prom[r['d']] = min(max(Fraction(str(pr)), 0), gross[r['d']]) if pr is not None else Fraction(0)
    P = sum(prom.values(), Fraction(0))
    use = P > 0 and P <= D
    if not use:
        P = Fraction(0); prom = {k: Fraction(0) for k in prom}
    share = (S - D) / (S - P) if S - P > 0 else Fraction(0)
    ambiguous = False
    first = None

    def judge(net_exact, hpp):
        nonlocal ambiguous
        frac = (net_exact * 100) % 1
        if abs(frac - Fraction(1, 2)) < Fraction(1, 10 ** 9): ambiguous = True
        net = q2(net_exact)
        if net <= 0: return 'PRICE_ZERO'
        if hpp is None: return 'COST_MISSING'
        if net < hpp: return 'PRICE_BELOW_HPP'
        return None
    goods = sorted([r for r in rows if not r['pkg'] and r['k'] == 'obat' and not r['noitem']], key=lambda r: r['d'])
    for r in goods:
        h = None if r['h'] is None else Fraction(str(r['h']))
        res = judge((gross[r['d']] - prom[r['d']]) * share, h)
        if res and first is None: first = res
    pk = [r for r in rows if r['pkg']]
    if pk and any(r['k'] == 'obat' and not r['noitem'] for r in pk):
        amount = sum((gross[r['d']] - prom[r['d']] for r in pk), Fraction(0))
        hpp = sum((Fraction(str(r['h'])) if r['h'] is not None else Fraction(0) for r in pk), Fraction(0))
        # NB: a package's amount is the sum of each row rounded gross; model rounds after summing exactly like SQL (sum of rounded rows)
        net_exact = amount * share
        frac = (net_exact * 100) % 1
        if abs(frac - Fraction(1, 2)) < Fraction(1, 10 ** 9): ambiguous = True
        net = q2(net_exact)
        res = 'PRICE_ZERO' if net <= 0 else ('PRICE_BELOW_HPP' if net < hpp else None)
        if res and first is None: first = res
    return (first or 'ACCEPT'), ambiguous


def fuzz_rows(db, dbname, n, seed):
    rc, out, err = raw(db, "select jsonb_build_object('i',i,'spec',spec)::text from zz.gen(%d, %s) order by i;" % (n, seed), dbname)
    assert rc == 0, err
    carts = [json.loads(l) for l in out.splitlines() if l.strip()]
    return carts


def call_batch(db, dbname, specs):
    """Run zz.call for many specs in one session; returns messages."""
    sql = '\n'.join("select 'FZ'||%d||E'\\t'||replace(zz.call(%s::jsonb),E'\\n','\\n');" % (i, "'" + json.dumps(s).replace("'", "''") + "'") for i, s in enumerate(specs))
    rc, out, err = raw(db, sql, dbname)
    assert rc == 0, err[:500]
    res = {}
    for l in out.splitlines():
        if l.startswith('FZ'):
            a, b = l.split('\t', 1); res[int(a[2:])] = b
    return [res[i] for i in range(len(specs))]


def prefix(msg):
    return 'ACCEPT' if msg == 'ACCEPT' else msg.split(':', 1)[0]


def run_fuzz(db, dbname, n, label, seed=0.31337):
    carts = fuzz_rows(db, dbname, n, seed)
    specs = [c['spec'] for c in carts]
    new = call_batch(db, dbname, specs)
    old = call_batch(db, dbname, [dict(s, fn='old') for s in specs])
    mism = []; amb = 0; with_promo = 0; promo_used = 0; kinds = {}
    for c, nm, om in zip(carts, new, old):
        exp, ambiguous = model(c['spec'])
        if ambiguous: amb += 1; continue
        kinds[prefix(nm)] = kinds.get(prefix(nm), 0) + 1
        if any(r.get('promo') not in (None, 0, 0.0) for r in c['spec']['rows']): with_promo += 1
        if prefix(nm) != exp: mism.append((c['i'], exp, prefix(nm), json.dumps(c['spec'])[:300]))
    check('%s: %d random carts: new floor == independent model (accept/refuse + prefix), %d tie-ambiguous skipped' % (label, n, amb), not mism, mism[:3])
    # no promo in effect => old floor byte-identical (full message)
    same = []; cnt = 0
    for c, nm, om in zip(carts, new, old):
        exp_old, _ = model(dict(c['spec'], rows=[dict(r, promo=None) for r in c['spec']['rows']]))
        in_effect = False
        S = Fraction(str(c['spec']['sub'])); D = Fraction(str(c['spec']['disc']))
        P = Fraction(0)
        for r in c['spec']['rows']:
            if r.get('promo') is not None:
                g = q2(Fraction(r['q']) * Fraction(str(r['p'])) * (1 - Fraction(str(r['pct'])) / 100))
                P += min(max(Fraction(str(r['promo'])), 0), g)
        in_effect = P > 0 and P <= D
        if not in_effect:
            cnt += 1
            if nm != om: same.append((c['i'], nm[:200], om[:200]))
    check('%s: %d carts with no promo in effect (none, zero, or promo > discount): message text identical to the OLD floor' % (label, cnt), cnt > 50 and not same, same[:2])
    check('%s: carts with promo in effect exist (%d) and every outcome kind occurs %s' % (label, with_promo, kinds), with_promo > 200 and all(k in kinds for k in ('ACCEPT', 'PRICE_BELOW_HPP', 'PRICE_ZERO', 'COST_MISSING')), kinds)
    return carts, new


def check_minimum(db, dbname, carts, new):
    """A printed minimum price, typed into the single refused goods row, makes that row pass (never too low)."""
    probes = []; meta = []
    for c, m in zip(carts, new):
        if not m.startswith('PRICE_BELOW_HPP'): continue
        lines = [l for l in m.split('\\n') if l.startswith('- ')]
        if len(lines) != 1 or '(paket)' in lines[0] or '(racikan)' in lines[0]: continue
        mm = re.search(r'harga minimum Rp([\d.]+) per ', lines[0])
        if not mm: continue
        name = re.match(r'- (\S+):', lines[0]).group(1)
        spec = json.loads(json.dumps(c['spec']))
        row = next(r for r in spec['rows'] if r['d'] == name)
        if row['pkg']: continue
        newp = int(mm.group(1).replace('.', ''))
        gold = q2(Fraction(row['q']) * Fraction(str(row['p'])) * (1 - Fraction(str(row['pct'])) / 100))
        row['p'] = newp
        gnew = q2(Fraction(row['q']) * newp * (1 - Fraction(str(row['pct'])) / 100))
        spec['sub'] = float(Fraction(str(spec['sub'])) + gnew - gold)
        # promo on the row cannot exceed the new (higher) value; discount stays; keep the cart valid
        probes.append(spec); meta.append(name)
        if len(probes) >= 400: break
    out = call_batch(db, dbname, probes) if probes else []
    bad = [(n, o[:160]) for n, o in zip(meta, out) if re.search(r'Harga neto %s ' % n, o)]
    check('minimum price check: %d refused single goods rows retried at the printed minimum all pass' % len(probes), len(probes) > 20 and not bad, bad[:2])


def prepare_fuzz_db(db, dbname, with_candidate=True):
    clone(db, dbname)
    # exact copy of the OLD floor next to the new one
    d = db.sql("select pg_get_functiondef('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure)")
    os.environ['PGDATABASE'] = dbname
    try:
        db.sql(d.replace('assert_invoice_price_floor', 'zz_old_floor', 1))
        if with_candidate:
            apply(db, dbname, (MIGRATIONS / CAND).read_text())
        db.sql(FUZZ_SQL)
    finally:
        os.environ.pop('PGDATABASE', None)


# --------------------------------------------------------------------------- mutants
def mutants():
    A = lambda s: s
    return [
        ('M01 even spread: promo ignored by the floor (old behaviour)', "v_use_promo := v_promo_total > 0 and v_promo_total <= p_discount;", "v_use_promo := false;"),
        ('M02 per-row promo ignored in the goods loop', "end as promo\n    from public.invoice_items ii\n    where ii.invoice_id = p_invoice_id and ii.package_item_id is null", "end * 0 as promo\n    from public.invoice_items ii\n    where ii.invoice_id = p_invoice_id and ii.package_item_id is null"),
        ('M03 negative promo allowed per row', "if v_promo < 0 or v_promo <> round(v_promo, 2) or v_promo > v_line_amount then", "if v_promo <> round(v_promo, 2) or v_promo > v_line_amount then"),
        ('M04 negative promo total allowed', "if v_promo_total < 0 or v_promo_total > v_discount then", "if v_promo_total > v_discount then"),
        ('M05 promo total may exceed the invoice discount', "if v_promo_total < 0 or v_promo_total > v_discount then", "if v_promo_total < 0 then"),
        ('M06 row promo may exceed the row value', "or v_promo <> round(v_promo, 2) or v_promo > v_line_amount then", "or v_promo <> round(v_promo, 2) then"),
        ('M07 more than 2 decimals allowed', "if v_promo < 0 or v_promo <> round(v_promo, 2) or v_promo > v_line_amount then", "if v_promo < 0 or v_promo > v_line_amount then"),
        ('M08 residual share denominator ignores promo', "(p_subtotal - p_discount) / (p_subtotal - v_promo_total)", "(p_subtotal - p_discount) / p_subtotal"),
        ('M09 fallback removed: promo used even when it exceeds the discount', "v_use_promo := v_promo_total > 0 and v_promo_total <= p_discount;", "v_use_promo := v_promo_total > 0;"),
        ('M10 promo not clamped to the row value in the floor', "select coalesce(sum(least(greatest(coalesce(ii.promo_discount, 0), 0),\n      round(ii.qty * ii.harga * (1 - coalesce(ii.diskon_persen, 0) / 100), 2))), 0)\n    into v_promo_total", "select coalesce(sum(greatest(coalesce(ii.promo_discount, 0), 0)), 0)\n    into v_promo_total"),
        ('M11 package: promo ignored', "v_net := round((v_line.amount - v_line.promo) * v_share, 2);\n    v_kind := case when v_net <= 0 then 'ZERO' when v_net < v_line.hpp then 'BELOW' end;", "v_net := round(v_line.amount * v_share, 2);\n    v_kind := case when v_net <= 0 then 'ZERO' when v_net < v_line.hpp then 'BELOW' end;"),
        ('M12 printed minimum (row) ignores promo', "case when v_line.promo > 0\n        then (coalesce(v_line.hpp, 0) / v_mshare + v_line.promo)", "case when false\n        then (coalesce(v_line.hpp, 0) / v_mshare + v_line.promo)"),
        ('M13 printed minimum (package) ignores promo', "greatest(ceil(case when v_line.promo > 0\n        then v_line.hpp / v_mshare + v_line.promo else v_line.hpp / v_mshare end), 1)", "greatest(ceil(v_line.hpp / v_mshare), 1)"),
        ('M14 edit: promo inherited although qty/price changed', "and o.qty=(v_line->>'qty')::integer and o.harga=(v_line->>'price')::numeric", "and true"),
        ('M15 edit: promo never inherited', "o.id=any(v_service_old_ids)\n          and o.id=nullif", "o.id=any(array[]::uuid[])\n          and o.id=nullif"),
        ('M16 post: promo_discount not written', "nullif(v_line.value->>'package_qty','')::numeric,\n      v_promo\n    ) returning id", "nullif(v_line.value->>'package_qty','')::numeric,\n      0\n    ) returning id"),
        ('M17 RULE loosened: net 1 sen below HPP passes', "v_net := round((v_line.amount - v_line.promo) * v_share, 2);\n    v_kind := case when v_net <= 0 then 'ZERO' when v_line.hpp is null then 'COST' when v_net < v_line.hpp then 'BELOW' end;", "v_net := round((v_line.amount - v_line.promo) * v_share, 2);\n    v_kind := case when v_net <= 0 then 'ZERO' when v_line.hpp is null then 'COST' when v_net < v_line.hpp - 0.01 then 'BELOW' end;"),
        ('M18 RULE loosened: net exactly zero is not PRICE_ZERO', "v_net := round((v_line.amount - v_line.promo) * v_share, 2);\n    v_kind := case when v_net <= 0 then 'ZERO' when v_line.hpp is null", "v_net := round((v_line.amount - v_line.promo) * v_share, 2);\n    v_kind := case when v_net < 0 then 'ZERO' when v_line.hpp is null"),
        ('M19 promo added back into the residual numerator', "(p_subtotal - p_discount) / (p_subtotal - v_promo_total)", "(p_subtotal - p_discount + v_promo_total) / (p_subtotal - v_promo_total)"),
        ('M20 table check constraint removed', "alter table public.invoice_items add constraint invoice_items_promo_discount_check check (promo_discount >= 0);", "-- constraint removed"),
        ('M21 column default removed', "add column promo_discount numeric(15,2) default 0;", "add column promo_discount numeric(15,2);"),
        ('M22 floor made directly callable', "revoke_placeholder", None),
        ('M23 goods loop: promo subtracted twice', "v_net := round((v_line.amount - v_line.promo) * v_share, 2);\n    v_kind := case when v_net <= 0 then 'ZERO' when v_line.hpp is null", "v_net := round((v_line.amount - 2 * v_line.promo) * v_share, 2);\n    v_kind := case when v_net <= 0 then 'ZERO' when v_line.hpp is null"),
        ('M25 reissue: promo not copied to the reissued invoice', "service_performers,id,bmhp_components,promo_discount -- LANTAI_PROMO_BARIS", "service_performers,id,bmhp_components,0 -- LANTAI_PROMO_BARIS"),
        ('M24 edit: inherits the promo of ANY unchanged row (source id not matched)', "and o.id=nullif(v_line->>'source_invoice_item_id','')::uuid and o.promo_discount>0", "and o.promo_discount>0"),
    ]


def run_mutations(db, a):
    build_chain(db, {CAND})
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')
    cand = (MIGRATIONS / CAND).read_text()
    # control + mutants
    plan = [('M00 control (unmodified candidate)', cand, 'control')]
    for name, old, new in mutants():
        if new is None:
            plan.append((name, cand + "\ngrant execute on function clinic_private.assert_invoice_price_floor(uuid,numeric,numeric) to authenticated;\n", 'suite')); continue
        n = cand.count(old)
        if n != 1:
            check(name + ' anchor occurs once', False, 'anchor count %d' % n); continue
        plan.append((name, cand.replace(old, new), 'mut'))
    only = set(a.only.split(',')) if a.only else None
    for i, (name, text, kind) in enumerate(plan):
        if only and name.split()[0] not in only: continue
        dbn = 'v%d' % i
        clone(db, dbn)
        crash = ''
        try:
            apply(db, dbn, text)
        except RuntimeError as e:
            crash = 'apply failed: ' + str(e).strip().splitlines()[0][:200]
        if crash:
            check(name + (' (control)' if kind == 'control' else ' KILLED-BY-CRASH?'), False, crash); continue
        ok, passes, why = run_suite(db, dbn)
        killed_by = []
        if not ok: killed_by.append('suite: ' + why)
        if ok or kind == 'control':
            # random model comparison on a clone of this variant (more kills; control must be clean)
            try:
                os.environ['PGDATABASE'] = dbn
                d = db.sql("select pg_get_functiondef('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure)")
                os.environ.pop('PGDATABASE', None)
                carts = fuzz_rows_on(db, dbn, a.mut_fuzz_n)
                if carts: killed_by.append('model: %s' % carts)
            except Exception as e:  # noqa
                killed_by.append('model-run-error: ' + str(e)[:150])
        if kind == 'control':
            check(name, ok and not killed_by, 'passes=%d %s' % (len(passes), killed_by))
        else:
            check(name + ' KILLED', bool(killed_by), killed_by[:1] or 'SURVIVED')
    return


def fuzz_rows_on(db, dbname, n):
    """Install the fuzz helpers (and the OLD floor copy is not needed) in the variant DB and compare with the model; return mismatch summary or ''."""
    os.environ['PGDATABASE'] = dbname
    try:
        db.sql(FUZZ_SQL)
    finally:
        os.environ.pop('PGDATABASE', None)
    # old copy is required by zz.call only for fn='old'; skip
    carts = fuzz_rows(db, dbname, n, 0.77)
    new = call_batch(db, dbname, [c['spec'] for c in carts])
    bad = []
    for c, nm in zip(carts, new):
        exp, amb = model(c['spec'])
        if not amb and prefix(nm) != exp: bad.append(c['i'])
    return ('%d/%d mismatches e.g. cart %s' % (len(bad), n, bad[:3])) if bad else ''


# --------------------------------------------------------------------------- modes
def run_baseline(db, a):
    build_chain(db, {CAND})
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')
    clone(db, 'red')
    rc, out, err = raw(db, 'alter table public.invoice_items add column promo_discount numeric(15,2) default 0;', 'red')
    ok, passes, why = run_suite(db, 'red')
    check('RED: suite fails on the real GROOM11 case at the baseline (first assertion A1)', not ok and 'PRICE_BELOW_HPP: Harga neto Anthel Cat Rp10.500' in why, why)
    rc, out, err = raw(db, "select 1", 'red')
    # neighbouring suites still pass on the baseline
    for name in ('p03_price_floor.sql', 'p03_price_floor_pesan.sql'):
        clone(db, 'nb'); rc, out, err = raw(db, (TESTS / name).read_text(), 'nb')
        check('baseline chain: neighbouring suite %s passes' % name, rc == 0, err.strip().splitlines()[-1] if rc else '')


def run_green(db, a):
    build_chain(db, {CAND})
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')
    # 1. rule matrix before / after: promo 0 everywhere = old rule
    clone(db, 'mx')
    rc, before, err = raw(db, (TESTS / 'p03_price_floor_rule_matrix.sql').read_text(), 'mx')
    assert rc == 0, err
    before = sorted(l for l in before.splitlines() if l.startswith('MX|'))
    apply(db, 'mx', (MIGRATIONS / CAND).read_text())
    rc, after, err = raw(db, (TESTS / 'p03_price_floor_rule_matrix.sql').read_text(), 'mx')
    after = sorted(l for l in after.splitlines() if l.startswith('MX|'))
    check('RULE UNCHANGED without promo: %d matrix carts (every refusal kind + ACCEPT) identical before and after the candidate' % len(before),
          len(before) > 600 and before == after, [(x, y) for x, y in zip(before, after) if x != y][:3])
    # 2. SQL suite
    clone(db, 'g')
    apply(db, 'g', (MIGRATIONS / CAND).read_text())
    ok, passes, why = run_suite(db, 'g')
    check('SQL suite promo_floor_line.sql GREEN: %d assertions passed' % len(passes), ok and len(passes) >= 60, why or 'passes=%d' % len(passes))
    # 3. neighbouring rolled-back suites with the candidate
    for name in ('p03_price_floor.sql', 'p03_price_floor_pesan.sql'):
        clone(db, 'nb'); apply(db, 'nb', (MIGRATIONS / CAND).read_text())
        rc, out, err = raw(db, (TESTS / name).read_text(), 'nb')
        check('with candidate: neighbouring suite %s passes' % name, rc == 0, err.strip().splitlines()[-1] if rc else '')
    # 4. random differential + model
    prepare_fuzz_db(db, 'fz')
    carts, new = run_fuzz(db, 'fz', a.fuzz_n, 'fuzz')
    check_minimum(db, 'fz', carts, new)
    # 5. zero-sum identity of the model (documented property): sum(gross - net) over ALL rows == discount before rounding
    viol = 0; tot = 0
    for c in carts:
        sp = c['spec']; S = Fraction(str(sp['sub'])); D = Fraction(str(sp['disc']))
        rows = sp['rows']
        gross = {r['d']: q2(Fraction(r['q']) * Fraction(str(r['p'])) * (1 - Fraction(str(r['pct'])) / 100)) for r in rows}
        prom = {r['d']: (min(max(Fraction(str(r['promo'])), 0), gross[r['d']]) if r.get('promo') is not None else Fraction(0)) for r in rows}
        P = sum(prom.values(), Fraction(0))
        if not (P > 0 and P <= D): P = Fraction(0); prom = {k: Fraction(0) for k in prom}
        if S - P <= 0 or sum(gross.values(), Fraction(0)) != S: continue
        share = (S - D) / (S - P)
        tot += 1
        if sum((gross[k] - (gross[k] - prom[k]) * share for k in gross), Fraction(0)) != D: viol += 1
    check('zero-sum: for %d carts the discount carried by all rows (row value - net) adds up to the invoice discount exactly' % tot, tot > 500 and viol == 0, viol)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true')
    ap.add_argument('--fuzz-n', type=int, default=3000); ap.add_argument('--mut-fuzz-n', type=int, default=400); ap.add_argument('--only')
    a = ap.parse_args()
    fn = run_baseline if a.baseline else run_mutations if a.mutations else run_green
    with NativePostgres(a.pg_bin) as db:
        fn(db, a)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(mode=fn.__name__, results=RESULTS), indent=1))
    fails = [r for r in RESULTS if r['status'] == 'FAIL']
    print('SUMMARY mode=%s pass=%d fail=%d' % (fn.__name__, len(RESULTS) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
