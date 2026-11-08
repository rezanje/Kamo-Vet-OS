#!/usr/bin/env python3
"""PART B: OWNER corrects the BMHP (bahan habis pakai) components of a procedure line that is ALREADY on a RANAP invoice (paid or unpaid):
stock delta through the existing primitives, invoice_items.hpp + bmhp_components recomputed in place, delta HPP journal dated today, price/total/payments untouched
(migration 20261107240000_owner_bmhp_tindakan_invoiced.sql; mirror of clinic_owner_correct_compound_invoiced for racikan).

Native full schema, fictional fixtures, throwaway local cluster, no network.
  flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-owner-bmhp-invoiced-postgres.py --pg-bin DIR --json out.json
  --baseline    chain WITHOUT the candidate migration (part A IS in the chain): every new-RPC case must FAIL (RED), the 'refused today' cases PASS
  --mutations   chain without the candidate once, then each mutant (scripts/test-owner-bmhp-invoiced-mutants.py) in a cloned database
  --attach DIR  dev only: clone of the `postgres` DB (chain WITHOUT part A and B, x.setup done) in a running cluster; part A and the candidate are applied on top
"""
import argparse, hashlib, importlib.util, json, os, sys, time
from decimal import Decimal
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
import owner_bmhp_common as cm
x, r, q, j, c, D, J, err_has = cm.x, cm.r, cm.q, cm.j, cm.c, cm.D, cm.J, cm.err_has
spec = importlib.util.spec_from_file_location('okr_base', ROOT / 'scripts/test-owner-koreksi-racikan-postgres.py'); assert spec and spec.loader
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
LAC, CB, CC, CX, CS, CU, CD, PROC, PROCJ, PROCB = cm.LAC, cm.CB, cm.CC, cm.CX, cm.CS, cm.CU, cm.CD, cm.PROC, cm.PROCJ, cm.PROCB
PART_A = '20261107230000_owner_bmhp_tindakan_pending.sql'
CANDIDATE = '20261107240000_owner_bmhp_tindakan_invoiced.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = []
RPC = 'clinic_owner_correct_invoiced_bmhp'
QUOTE = 'clinic_owner_invoiced_bmhp_quote'
LINES = 'clinic_owner_invoice_bmhp_lines'
NEWTAB = 'clinic_private.owner_bmhp_invoice_corrections'
PERMITS = 'clinic_private.owner_bmhp_invoice_permits'
NEW_NAMES = ('owner_correct_invoiced_bmhp', RPC, QUOTE, LINES)
PATCHED = 'guard_invoice_item_bmhp'
ANCHOR = "  if tg_op = 'UPDATE' and new.bmhp_components is distinct from old.bmhp_components then"
comp = cm.comp
PRE = {}
SECTIONS = None
def S(name): return SECTIONS is None or name in SECTIONS


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:420], flush=True)


DIGEST_SQL = """select count(*)||'|'||md5(string_agg(k, E'\\n' order by k)) from (
 select 'f:'||p.oid::regprocedure::text||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'') as k
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private') and p.prokind in ('f','p') and p.proname <> all(%s)
 union all select 't:'||t.tgrelid::regclass::text||':'||pg_get_triggerdef(t.oid) from pg_trigger t
   where not t.tgisinternal and t.tgrelid::regclass::text not like '%%owner_bmhp%%'
 union all select 'c:'||table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,'')||':'||is_nullable from information_schema.columns
   where table_schema in ('public','clinic_private') and table_name not like 'owner_bmhp_invoice%%'
 union all select 'r:'||c.oid::regclass::text||':'||coalesce(c.relacl::text,'')||':'||c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','clinic_private') and c.relkind in ('r','v','S','m') and c.relname not like 'owner_bmhp_invoice%%'
 union all select 'k:'||conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace in ('public'::regnamespace,'clinic_private'::regnamespace) and conrelid::regclass::text not like '%%owner_bmhp_invoice%%'
 union all select 'i:'||indexdef from pg_indexes where schemaname in ('public','clinic_private') and tablename not like 'owner_bmhp_invoice%%'
 union all select 'p:'||tablename||':'||policyname||':'||coalesce(qual,'')||coalesce(with_check,'') from pg_policies where schemaname in ('public','clinic_private')
) z"""
def digest(h): return h.nilai(DIGEST_SQL % q('{' + ','.join(NEW_NAMES + (PATCHED,)) + '}'))


def old_defs(h):
    """md5 of the live objects Part B must NOT touch (guard_invoice_item_bmhp is the ONE patched function and is proven separately)."""
    return h.nilai("select md5(string_agg(pg_get_functiondef(p::regprocedure), E'\\n' order by p)) from unnest(array["
                   "'public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)','public.clinic_save_inpatient_cart_draft(uuid,uuid,text,text,jsonb,text)',"
                   "'clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)','public.clinic_post_invoice(uuid,text,jsonb,jsonb)','clinic_private.bmhp_issue(uuid,uuid,text,date)',"
                   "'public.guard_prescription_bmhp()','clinic_private.job_order_complete(uuid,uuid,numeric,numeric,text,date)','public.clinic_write_journal(date,text,text,text,uuid,jsonb)',"
                   "'public.clinic_owner_remove_invoice_lines(uuid,jsonb,text,text)','public.clinic_owner_correct_compound(uuid,jsonb,text,text)','public.clinic_owner_correct_compound_invoiced(uuid,jsonb,text,text)',"
                   "'public.clinic_owner_correct_cart_bmhp(uuid,uuid,uuid,jsonb,text,text,text)','clinic_private.owner_correct_cart_bmhp(uuid,uuid,uuid,jsonb,text,text,text,boolean)',"
                   "'clinic_private.owner_bmhp_normalize(jsonb,jsonb,jsonb,boolean)','clinic_private.owner_bmhp_sim(uuid,uuid,numeric,text,jsonb)','public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',"
                   "'public.clinic_void_reissue_invoice_core(uuid,text,text)']) p")


def guard_def(h): return h.nilai("select replace(encode(convert_to(pg_get_functiondef('public.guard_invoice_item_bmhp()'::regprocedure),'UTF8'),'base64'), E'\\n', '')")


def inv(h, n, paid=False, price=80000, comps=None, proc=PROC, out_cost=None, headroom=60, layers=True):
    """Posted fixture: ranap visit + DP-first stage invoice + the BMHP procedure on its OWN stage invoice (Belum Lunas without payment, or Lunas with a payment when paid)."""
    rv = cm.bmhp_visit(h, n, comps=comps, price=price, proc=proc, out_cost=out_cost, headroom=headroom, layers=layers)
    err, _ = cm.save(h, rv, f'bi-save-{n}', [], paid=paid)
    if err: raise RuntimeError('fixture save failed: ' + err[:300])
    cm.link(h, rv)
    return rv


def audit_n(h):
    return h.nilai(f"select case when to_regclass('{NEWTAB}') is null then '0' else (xpath('/row/c/text()',query_to_xml('select count(*) as c from {NEWTAB}',false,true,'')))[1]::text end")


def audit_rows(h, rv):
    if h.nilai(f"select to_regclass('{NEWTAB}') is not null") != 't': return []
    return json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(a) order by created_at,id),'[]') from {NEWTAB} a where invoice_item_id={q(rv['line'])}"))


def snap(h, rv):
    """Everything the correction may or may not touch, as one comparable value."""
    s = cm.stock_state(h)
    s['rx'] = cm.rx_row(h, rv)
    s['line'] = cm.line_row(h, rv)
    s['invoice'] = h.nilai(f"select to_jsonb(i) from invoices i where id={q(rv['inv'])}")
    s['others'] = h.nilai(f"select md5(coalesce(jsonb_agg(to_jsonb(ii) order by ii.id),'[]')::text) from invoice_items ii where ii.invoice_id in (select id from invoices where visit_id={q(rv['v'])}) and ii.id<>{q(rv['line'])}")
    s['invoices'] = h.nilai(f"select md5(coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]')::text) from invoices i where visit_id={q(rv['v'])}")
    s['payments'] = h.nilai(f"select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]')::text) from invoice_payments p join invoices i on i.id=p.invoice_id where i.visit_id={q(rv['v'])}")
    s['receipts'] = h.nilai(f"select count(*) from clinic_payment_receipts where visit_id={q(rv['v'])}")
    s['journals'] = h.nilai('select count(*) from journal_entries')
    s['jr'] = cm.jr(h, rv['no'])
    s['points'] = h.nilai(f"select points from customers where id=(select customer_id from visits where id={q(rv['v'])})")
    s['audit'] = audit_n(h)
    return s


def corr(h, rv, comps, reason='BMHP tagihan disesuaikan setelah dihitung ulang', key=None, user=r.OWNER, fn=RPC, line=None):
    key = key or 'bi-%s-%s' % (rv['n'], hashlib.md5((json.dumps(comps, sort_keys=True, default=str) + reason).encode()).hexdigest()[:8])
    try:
        return None, json.loads(h.nilai(f"select {fn}({q(line or rv['line'])},{j(comps)},{q(reason)},{q(key)});", user))
    except RuntimeError as e:
        return str(e), None


def quote(h, rv, comps, user=r.OWNER, line=None):
    try:
        return None, J(h.nilai(f"select {QUOTE}({q(line or rv['line'])},{j(comps)});", user))
    except RuntimeError as e:
        return str(e), None


def safe_gagal(h, source, user=None):
    """h.gagal that never aborts the battery: a harness-level error (e.g. a statement that cannot even be parsed in the RED chain) counts as a refusal."""
    try: return h.gagal(source, user)
    except RuntimeError as e: return 'HARNESS-REFUSED: ' + str(e)[:200]


def n(v): return D(str(v))
def new_rows(after, before): return after[len(before):] if after[:len(before)] == before else after
def layer_left(h, item): return D(h.nilai(f"select coalesce(sum(qty_left),0) from stock_layers where item_id={q(item)}"))
def stock_qty(h, item): return D(h.nilai(f"select qty from stock where item_id={q(item)} and warehouse_id={q(r.WH)}"))
_BASE = {}
def prep_base(h):
    if not _BASE.get(id(h.db)): base.prep(h); _BASE[id(h.db)] = 1


def own_layers(h, item, rows):
    """Deterministic layers for ONE fixture (item CD): rows = [(qty, cost, date)]; no headroom layers."""
    for qty, cost, date in rows: cm.fresh(h, item, qty, cost, date)


def run(h, db=None, setup=True, baseline=False, pre=None):
    _BASE.clear()
    if setup: x.setup(h)
    cm.prep(h)
    today = h.nilai('select current_date')
    if S('core'):
        objs = h.nilai(f"select concat_ws('|', to_regprocedure('public.{RPC}(uuid,jsonb,text,text)') is not null, to_regprocedure('public.{QUOTE}(uuid,jsonb)') is not null, to_regprocedure('public.{LINES}(uuid)') is not null, "
                       f"to_regclass('{NEWTAB}') is not null, to_regclass('{PERMITS}') is not null, to_regprocedure('clinic_private.owner_correct_invoiced_bmhp(uuid,jsonb,text,text,boolean)') is not null)")
        check('preflight: the correction RPC, quote, lines reader, audit table, permit table and private core exist', objs == 't|t|t|t|t|t', dict(objs=objs))

        # -------------------------------------------------------------- the live case TODAY: an invoiced BMHP line cannot be changed by anyone
        a = inv(h, 9101); s0 = snap(h, a)
        check('fixture: the procedure sits on its OWN unpaid stage invoice (Belum Lunas, no payment): price 80000, HPP 60000.00 = snapshot cost, journal klinik-hpp 60000.00, Lacto-B left the stock by 5',
              s0['line'] and n(s0['line']['hpp']) == D('60000.00') and n(s0['line']['bmhp_components']['cost']) == D('60000.00') and s0['line']['bmhp_components']['components'][0]['base_qty'] == 5.0
              and cm.jsum(s0['jr']) == D('60000.00') and json.loads(s0['invoice'])['paid_status'] == 'Belum Lunas', dict(line=str(s0['line'])[:300]))
        e1 = h.gagal(f"update invoice_items set bmhp_components=jsonb_set(bmhp_components,'{{cost}}','1') where id={q(a['line'])};")
        e2 = h.gagal(f"update invoice_items set hpp=1 where id={q(a['line'])};", r.OWNER)
        check('RED/today: the BMHP snapshot of a posted line cannot be rewritten by anyone (even the superuser: BMHP_INVALID) and the Owner cannot touch hpp directly (INVOICE_POSTED); nothing changes',
              err_has(e1, 'BMHP_INVALID', 'snapshot BMHP invoice tidak dapat diubah') and bool(e2) and snap(h, a) == s0, dict(e1=(e1 or '')[:100], e2=(e2 or '')[:100]))

        # -------------------------------------------------------------- quote: read-only, = real effect
        qerr, qj = quote(h, a, [comp(LAC, 3)])
        check('quote LAC 5 -> 3: cost 60000.00 -> 36000.00, HPP 60000.00 -> 36000.00, delta -24000.00, invoice no, paid status, price 80000, journal preview Dr 170001 / Cr 600001 dated today, stock effect "kembali" 2; changes NOTHING',
              qj is not None and n(qj['cost_before']) == D('60000.00') and n(qj['cost_after']) == D('36000.00') and n(qj['hpp_before']) == D('60000.00') and n(qj['hpp_after']) == D('36000.00') and n(qj['hpp_delta']) == D('-24000.00')
              and qj['invoice_no'] == a['no'] and qj['paid_status'] == 'Belum Lunas' and n(qj['price']) == D('80000.00') and qj['journal']['date'] == today and qj['hpp_differs_from_cost'] is False
              and sorted((l['code'], n(l['debit']), n(l['credit'])) for l in qj['journal']['lines']) == [('170001', D('24000'), D('0')), ('600001', D('0'), D('24000'))]
              and [(e['direction'], n(e['delta'])) for e in qj['stock']] == [('kembali', D('-2'))] and qj['price_below_hpp_after'] is False and snap(h, a) == s0, dict(error=(qerr or '')[:200], q=str(qj)[:300]))
        qd, _ = quote(h, a, [comp(LAC, 3)], user=r.STAFF)
        check('NEG quote for a non-owner refused (ACCESS_DENIED)', err_has(qd, 'ACCESS_DENIED'), dict(error=(qd or '')[:120]))

        # -------------------------------------------------------------- GREEN decrease on the UNPAID line
        err, res = corr(h, a, [comp(LAC, 3)], key='bi-a-1')
        s1 = snap(h, a); line1 = s1['line'] or {}
        check('GREEN Owner lowers Lacto-B 5 -> 3 on the UNPAID invoice line: ok, HPP 60000.00 -> 36000.00, line id unchanged, price/qty/description untouched',
              err is None and s1['line'] and line1['id'] == s0['line']['id'] and n(line1['hpp']) == D('36000.00')
              and {k: v for k, v in line1.items() if k not in ('hpp', 'bmhp_components')} == {k: v for k, v in s0['line'].items() if k not in ('hpp', 'bmhp_components')}, dict(error=(err or '')[:300], hpp=line1.get('hpp')))
        sn = line1.get('bmhp_components') or {'components': [{}]}
        check('snapshot replaced in place: version 1, cost 36000.00, one component Lacto-B qty 3 base_qty 3 cost 36000.00, the snapshot name kept',
              sn.get('version') == 1 and n(sn['cost']) == D('36000.00') and len(sn['components']) == 1 and sn['components'][0]['qty'] == 3 and sn['components'][0]['base_qty'] == 3.0
              and n(sn['components'][0]['cost']) == D('36000.00') and sn['components'][0]['item_id'] == LAC and sn['components'][0]['name'] == 'Lacto-B Fiktif', dict(sn=str(sn)[:300]))
        check('the prescription row carries the corrected list too (so void / re-billing uses it): qty 3, base_qty 3', s1['rx']['bmhp_components'][0]['qty'] == 3 and s1['rx']['bmhp_components'][0]['base_qty'] == 3.0
              and {k: v for k, v in s1['rx'].items() if k != 'bmhp_components'} == {k: v for k, v in s0['rx'].items() if k != 'bmhp_components'}, dict(rx=str(s1['rx']['bmhp_components'])))
        new_layers = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_array(tanggal,qty_in,qty_left,unit_cost,source,source_ref) order by created_at,id),'[]') from stock_layers where source='klinik-edit' and source_ref={q(a['no'])} and item_id={q(LAC)}"))
        check('stock: ONLY the delta moves: Lacto-B +2 exactly (stock and layers), one NEW layer 2 @ 12000 dated today, source klinik-edit, ref invoice no; one stock move; other stock untouched',
              stock_qty(h, LAC) - D(json.loads(s0['stock'])[LAC]) == 2 and len(new_layers) == 1 and new_layers[0][0] == today and n(new_layers[0][1]) == 2 and n(new_layers[0][3]) == D('12000') and new_layers[0][4] == 'klinik-edit'
              and int(s1['moves']) == int(s0['moves']) + 1 and {k: v for k, v in json.loads(s1['stock']).items() if k != LAC} == {k: v for k, v in json.loads(s0['stock']).items() if k != LAC}, dict(new=new_layers))
        dj = new_rows(s1['jr'], s0['jr'])
        check('delta journal: exactly ONE new entry dated today, source klinik-hpp-edit on the invoice number, Dr 170001 / Cr 600001 24000.00, balanced; original journals untouched',
              int(s1['journals']) == int(s0['journals']) + 1 and sorted(dj) == sorted([['klinik-hpp-edit', today, '170001', D('24000.00'), D('0.00')], ['klinik-hpp-edit', today, '600001', D('0.00'), D('24000.00')]])
              and s1['jr'][:len(s0['jr'])] == s0['jr'], dict(dj=dj))
        check('journal vs line to the cent: net HPP booked on the invoice (klinik-hpp + klinik-hpp-edit) == the invoice HPP sum (36000.00); every entry balanced, trial balance 0',
              cm.jsum(s1['jr']) == D(h.nilai(f"select coalesce(sum(hpp),0) from invoice_items where invoice_id={q(a['inv'])}")) == D('36000.00') and cm.unbalanced_entries(h) == 0 and D(cm.all_balanced(h)) == 0, dict(net=str(cm.jsum(s1['jr']))))
        check('price, totals and money UNTOUCHED: invoice rows (total, subtotal, paid_status, ...), other lines, payments, receipts, customer points identical',
              s1['invoices'] == s0['invoices'] and s1['others'] == s0['others'] and s1['payments'] == s0['payments'] and s1['receipts'] == s0['receipts'] and s1['points'] == s0['points'], dict())
        au = audit_rows(h, a)
        check('audit row: who / when / visit / invoice+line+rx / paid status / before+after+original components / cost+hpp before/after/delta / journal id / reason / request_key / stock effects',
              len(au) == 1 and au[0]['actor_id'] == r.OWNER and au[0]['invoice_id'] == a['inv'] and au[0]['invoice_item_id'] == a['line'] and au[0]['invoice_no'] == a['no'] and au[0]['paid_status'] == 'Belum Lunas'
              and au[0]['visit_id'] == a['v'] and au[0]['prescription_item_id'] == a['rx'] and n(au[0]['hpp_before']) == D('60000.00') and n(au[0]['hpp_after']) == D('36000.00') and n(au[0]['hpp_delta']) == D('-24000.00')
              and n(au[0]['cost_before']) == D('60000.00') and n(au[0]['cost_after']) == D('36000.00') and n(au[0]['price']) == D('80000.00') and au[0]['reason'].startswith('BMHP tagihan') and au[0]['request_key'] == 'bi-a-1'
              and au[0]['created_at'] and au[0]['stock_effects'] and au[0]['before_components'][0]['base_qty'] == 5 and au[0]['after_components'][0]['base_qty'] == 3 and au[0]['original_components'][0]['base_qty'] == 5
              and au[0]['journal_entry_id'] == h.nilai(f"select id from journal_entries where source='klinik-hpp-edit' and source_ref={q(a['no'])}"), dict(au=au[:1]))
        check('quote == actual: the quote predicted exactly the HPP, cost, delta, stock effect and journal lines the real correction produced',
              qj and n(qj['hpp_after']) == n(line1['hpp']) and n(qj['cost_after']) == n(sn['cost']) and n(qj['hpp_delta']) == n(res['hpp_delta']) and qj['stock'] == res['stock']
              and sorted((l['code'], n(l['debit']), n(l['credit'])) for l in qj['journal']['lines']) == sorted((l['code'], n(l['debit']), n(l['credit'])) for l in res['journal']['lines']), dict())
        # replay
        e1, r1 = corr(h, a, [comp(LAC, 3)], key='bi-a-1')
        check('replay: same request_key + same payload is idempotent (stored result, no second movement, no second journal, one audit row)', e1 is None and r1 and r1.get('replayed') is True and snap(h, a) == s1, dict(error=(e1 or '')[:160]))
        e2, _ = corr(h, a, [comp(LAC, 2)], key='bi-a-1')
        check('replay with a DIFFERENT payload under the same key is refused (IDEMPOTENCY_CONFLICT), nothing changes', err_has(e2, 'IDEMPOTENCY_CONFLICT') and snap(h, a) == s1, dict(error=(e2 or '')[:160]))
        # second correction: chain; bound measured from the ORIGINAL 5
        err, res2 = corr(h, a, [comp(LAC, 4)], key='bi-a-2'); s2 = snap(h, a)
        e51, _ = corr(h, a, [comp(LAC, 51)], key='bi-a-3')
        e50, _ = corr(h, a, [comp(LAC, 50)], key='bi-a-4')
        au = audit_rows(h, a)
        check('second correction on the same line (3 -> 4, +1 @ current FIFO 12000): HPP 36000.00 -> 48000.00, second delta journal 12000.00, net journal still == line hpp; bound stays 10x the ORIGINAL (51 refused BMHP_LIMIT, 50 accepted); original kept',
              err is None and n(s2['line']['hpp']) == D('48000.00') and cm.jsum(s2['jr']) == D('48000.00') and len(au) == 3 and err_has(e51, 'BMHP_LIMIT') and e50 is None and au[0]['original_components'][0]['base_qty'] == 5
              and au[-1]['original_components'][0]['base_qty'] == 5, dict(err=(err or '')[:160], e51=(e51 or '')[:100], e50=(e50 or '')[:100]))
        try: lines = json.loads(h.nilai(f"select {LINES}({q(a['inv'])});", r.OWNER))
        except RuntimeError as e: lines = str(e)
        check('lines reader (Owner): the BMHP line with its snapshot and the three corrections of the first fixture (newest first, with who/when/reason)', isinstance(lines, dict) and len(lines['lines']) == 1 and len(lines['lines'][0]['history']) == 3
              and lines['lines'][0]['history'][0]['actor_name'] is not None and lines['lines'][0]['bmhp']['version'] == 1 and lines['invoice_no'] == a['no'], dict(lines=str(lines)[:250]))
        el = h.gagal(f"select {LINES}({q(a['inv'])});", r.STAFF)
        check('NEG lines reader for a non-owner refused (ACCESS_DENIED)', err_has(el, 'ACCESS_DENIED'), dict(error=(el or '')[:120]))
        elb = h.gagal(f"set role authenticated;select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub',{q(r.OWNER)},false);"
                      f"select set_config('request.headers',{q(json.dumps({'x-kamo-operational-branch': r.BRANCH2}))},false);select {LINES}({q(a['inv'])});")
        check('NEG lines reader for an OWNER working in ANOTHER branch refused (ACCESS_DENIED)', err_has(elb, 'ACCESS_DENIED'), dict(error=(elb or '')[:120]))



        # -------------------------------------------------------------- guard: the permit is the ONLY way through, bound to transaction + actor + line
        pf = inv(h, 9102); sp = snap(h, pf)
        mk = f"update invoice_items set bmhp_components=bmhp_components where id={q(pf['line'])};"
        tamper = f"update invoice_items set bmhp_components=jsonb_set(bmhp_components,'{{cost}}','1') where id={q(pf['line'])};"
        g_none = safe_gagal(h, tamper)
        g_other_actor = safe_gagal(h, f"begin;insert into {PERMITS} values (txid_current(),{q(r.STAFF)},{q(pf['line'])});select set_config('request.jwt.claim.sub',{q(r.OWNER)},false);{tamper}commit;")
        g_other_line = safe_gagal(h, f"begin;insert into {PERMITS} values (txid_current(),{q(r.OWNER)},{q(a['line'])});select set_config('request.jwt.claim.sub',{q(r.OWNER)},false);{tamper}commit;")
        g_stale = safe_gagal(h, f"begin;insert into {PERMITS} values (1,{q(r.OWNER)},{q(pf['line'])});select set_config('request.jwt.claim.sub',{q(r.OWNER)},false);{tamper}commit;")
        if h.nilai(f"select to_regclass('{PERMITS}') is not null") == 't': h.sql(f"delete from {PERMITS} where transaction_id=1;")
        g_ok = safe_gagal(h, f"begin;insert into {PERMITS} values (txid_current(),{q(r.OWNER)},{q(pf['line'])});select set_config('request.jwt.claim.sub',{q(r.OWNER)},false);{tamper}delete from {PERMITS} where transaction_id=txid_current();commit;")
        check('permit guard: no permit / a permit of ANOTHER actor / a permit for ANOTHER line / a LEFTOVER permit of another transaction are all refused (BMHP_INVALID); only the exact (transaction, actor, line) permit opens the snapshot guard',
              err_has(g_none, 'BMHP_INVALID') and err_has(g_other_actor, 'BMHP_INVALID') and err_has(g_other_line, 'BMHP_INVALID') and err_has(g_stale, 'BMHP_INVALID') and g_ok is None, dict(none=(g_none or '')[:60], actor=(g_other_actor or '')[:60], line=(g_other_line or '')[:60], ok=(g_ok or '')[:100]))
        left = h.nilai(f"select count(*) from {PERMITS}") if h.nilai(f"select to_regclass('{PERMITS}') is not null") == 't' else 'x'
        check('no permit row is left behind after the corrections above (every correction deletes its own permit in the same transaction)', left == '0', dict(left=left))
        gp = safe_gagal(h, f"insert into {PERMITS} values (txid_current(),{q(r.OWNER)},{q(pf['line'])});", r.OWNER)
        check('the permit table has no app grant (an owner session cannot forge a permit)', h.nilai(f"select to_regclass('{PERMITS}') is not null") == 't' and bool(gp) and 'permission denied' in gp, dict(error=(gp or '')[:100]))

    if S('paths'):
        # -------------------------------------------------------------- increase at CURRENT FIFO cost, restore at the RECORDED cost (to the cent)
        rv = cm.bmhp_visit(h, 9110, comps=[comp(CD, 4)], layers=False)
        own_layers(h, CD, [(4, '100', '2026-01-01'), (50, '150', '2026-01-02')])
        err, _ = cm.save(h, rv, 'bi-d-save', []); cm.link(h, rv); sd0 = snap(h, rv)
        check('fixture (own layers): CD 4 issued @100 = cost 400.00, HPP 400.00', err is None and n(sd0['line']['hpp']) == D('400.00') and n(sd0['line']['bmhp_components']['cost']) == D('400.00'), dict(error=(err or '')[:200]))
        err, res = corr(h, rv, [comp(CD, 6)], key='bi-d-1'); sd1 = snap(h, rv); dj = new_rows(sd1['jr'], sd0['jr'])
        check('increase 4 -> 6: 2 more issued at CURRENT FIFO @150 (not the original @100): cost 400.00 -> 700.00, HPP 700.00, journal Dr 600001 / Cr 170001 300.00, source klinik-bmhp, snapshot cost 700.00 base_qty 6',
              err is None and n(sd1['line']['hpp']) == D('700.00') and n(sd1['line']['bmhp_components']['cost']) == D('700.00') and sd1['line']['bmhp_components']['components'][0]['base_qty'] == 6.0
              and sorted(dj) == sorted([['klinik-hpp-edit', today, '600001', D('300.00'), D('0.00')], ['klinik-hpp-edit', today, '170001', D('0.00'), D('300.00')]]) and cm.jsum(sd1['jr']) == D('700.00')
              and D(h.nilai(f"select coalesce(-sum(qty),0) from stock_moves where source='klinik-bmhp' and source_ref={q(rv['no'])} and item_id={q(CD)}")) == 6, dict(error=(err or '')[:200], dj=dj))
        err, res = corr(h, rv, [comp(CD, 5)], key='bi-d-2'); sd2 = snap(h, rv)
        lay = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_array(qty_in,unit_cost,round(qty_in*unit_cost,2)) order by created_at,id),'[]') from stock_layers where source='klinik-edit' and source_ref={q(rv['no'])} and item_id={q(CD)}"))
        check('decrease 6 -> 5: ONE unit comes back at the RECORDED average cost 700.00 / 6 = 116.67 (value to the cent), HPP 700.00 -> 583.33, snapshot cost 583.33, net journal 583.33',
              err is None and len(lay) == 1 and D(str(lay[0][2])) == D('116.67') and n(sd2['line']['hpp']) == D('583.33') and n(sd2['line']['bmhp_components']['cost']) == D('583.33') and cm.jsum(sd2['jr']) == D('583.33'), dict(error=(err or '')[:200], lay=lay))
        # mixed: drop CD? use own comps: LAC dropped, CB new, CC changed, CU alt unit
        mx = cm.bmhp_visit(h, 9111, comps=[comp(LAC, 5), comp(CC, 2)], price=100000)
        cm.fresh(h, CB, 20); cm.fresh(h, CU, 20)
        err, _ = cm.save(h, mx, 'bi-mx-save', []); cm.link(h, mx); sm0 = snap(h, mx)
        err, res = corr(h, mx, [comp(CB, 2), comp(CU, 0.5, 'kotak'), comp(CC, 3)], key='bi-mx-1'); sm1 = snap(h, mx)
        cmx = {e['item_id']: e for e in sm1['line']['bmhp_components']['components']}
        exp_cost = D('2') * D('9100.25') + D('3') * D('500') + D('5') * D('100')
        st0, st1 = json.loads(sm0['stock']), json.loads(sm1['stock'])
        check('mixed: LAC dropped (5 back @12000 = 60000), CC 2 -> 3 (+1 @500), new CB 2 @9100.25 and CU 0.5 kotak (= 5 pcs @100): snapshot = exactly {CB, CC, CU}, cost 20200.50, HPP 20200.50, journal delta -40799.50, stock exact',
              err is None and set(cmx) == {CB, CC, CU} and n(sm1['line']['hpp']) == exp_cost == D('20200.50') and cmx[CU]['unit'] == 'kotak' and cmx[CU]['factor'] == 10 and cmx[CU]['base_qty'] == 5.0
              and n(cmx[CC]['cost']) == D('1500') and n(cmx[CB]['cost']) == D('18200.50') and D(st1[LAC]) - D(st0[LAC]) == 5 and D(st0[CB]) - D(st1[CB]) == 2 and D(st0[CC]) - D(st1[CC]) == 1 and D(st0[CU]) - D(st1[CU]) == 5
              and cm.jsum(sm1['jr']) == D('20200.50') and n(res['hpp_delta']) == D('-40799.50'), dict(error=(err or '')[:200], cmx=str({k: v['cost'] for k, v in cmx.items()}), hpp=sm1['line'] and sm1['line']['hpp']))
        # PAID invoice: same behavior, money untouched
        pd = inv(h, 9112, paid=True); spd0 = snap(h, pd)
        pst = h.nilai(f"select paid_status||'|'||(select count(*) from invoice_payments p where p.invoice_id=i.id) from invoices i where id={q(pd['inv'])}")
        err, resp = corr(h, pd, [comp(LAC, 3)], key='bi-paid-1'); spd1 = snap(h, pd)
        check('PAID invoice (Lunas + payment row): the same correction works: HPP 36000.00, journal -24000.00; invoices, payments, receipts, cash journals, paid_at untouched, paid_status stays Lunas',
              pst.startswith('Lunas|') and err is None and n(spd1['line']['hpp']) == D('36000.00') and spd1['invoices'] == spd0['invoices'] and spd1['payments'] == spd0['payments'] and spd1['receipts'] == spd0['receipts']
              and [row for row in spd1['jr'] if row[0] != 'klinik-hpp-edit'] == spd0['jr'] and len(new_rows(spd1['jr'], spd0['jr'])) == 2 and resp and resp['paid_status'] == 'Lunas', dict(pst=pst, error=(err or '')[:200]))
        # service (jasa) line: HPP = cost; and an HPP that differs from the cost on a jasa line is refused
        sj = inv(h, 9113, proc=PROCJ, price=100000); ssj0 = snap(h, sj)
        err, ress = corr(h, sj, [comp(LAC, 3)], key='bi-sj-1'); ssj1 = snap(h, sj)
        check('jasa line: HPP = component cost 60000.00 -> 36000.00 exactly, floor_applies false, net journal 36000.00', err is None and n(ssj1['line']['hpp']) == D('36000.00') and ress['floor_applies'] is False and cm.jsum(ssj1['jr']) == D('36000.00'), dict(error=(err or '')[:200]))
        sj2 = inv(h, 9114, proc=PROCJ, price=100000); h.sistem(f"update invoice_items set hpp=hpp+5 where id={q(sj2['line'])};"); ssj2 = snap(h, sj2)
        err, _ = corr(h, sj2, [comp(LAC, 3)], key='bi-sj-2')
        check('NEG a jasa line whose HPP differs from its snapshot cost is refused (HPP_INCONSISTENT), nothing changed', err_has(err, 'HPP_INCONSISTENT') and snap(h, sj2) == ssj2, dict(error=(err or '')[:160]))
        # live INV-0434 shape: the sold output layer is OLDER than the line's own components -> HPP != component cost
        ol = inv(h, 9115, proc=PROCB, out_cost='2600.74', price=80000); sol0 = snap(h, ol)
        check('fixture (live INV-0434 shape): pesanan line HPP 2600.74 (the OLDER output layer FIFO sold) while the snapshot cost is 60000.00 (explains the live Non Antibiotik 2600.74 vs 9433.68)',
              n(sol0['line']['hpp']) == D('2600.74') and n(sol0['line']['bmhp_components']['cost']) == D('60000.00') and cm.jsum(sol0['jr']) == D('2600.74'), dict(hpp=sol0['line']['hpp']))
        e_dn, _ = corr(h, ol, [comp(LAC, 4)], key='bi-ol-1')
        check('NEG lowering such a line would drive its HPP to <= 0 (2600.74 - 12000): refused (COST_MISSING), no partial effect', err_has(e_dn, 'COST_MISSING') and snap(h, ol) == sol0, dict(error=(e_dn or '')[:200]))
        err, reso = corr(h, ol, [comp(LAC, 6)], key='bi-ol-2'); sol1 = snap(h, ol)
        check('raising it (5 -> 6): HPP 2600.74 + 12000.00 = 14600.74 (the difference to the component cost stays and is REPORTED: hpp_differs_from_cost), cost 72000.00, net journal == line hpp',
              err is None and n(sol1['line']['hpp']) == D('14600.74') and n(sol1['line']['bmhp_components']['cost']) == D('72000.00') and reso['hpp_differs_from_cost'] is True and cm.jsum(sol1['jr']) == D('14600.74'), dict(error=(err or '')[:200]))
        # HPP above the price: applied and REPORTED, P03 untouched
        hp = inv(h, 9116, price=65000); shp0 = snap(h, hp)
        qh = quote(h, hp, [comp(LAC, 7)])[1] or {}
        err, resh = corr(h, hp, [comp(LAC, 7)], key='bi-hp-1'); shp1 = snap(h, hp)
        check('HPP pushed above the price (5 -> 7: 84000 > 65000): applied and REPORTED (price_below_hpp_after true, before false), journal +24000.00; price and total not touched',
              err is None and resh['price_below_hpp_after'] is True and resh['price_below_hpp_before'] is False and qh.get('price_below_hpp_after') is True and n(shp1['line']['hpp']) == D('84000.00')
              and shp1['invoices'] == shp0['invoices'] and n(shp1['line']['harga']) == D('65000.00'), dict(error=(err or '')[:200]))
        low = cm.bmhp_visit(h, 9117, price=30000); e_low, _ = cm.save(h, low, 'bi-p03-new', [])
        chk = h.nilai("select md5(pg_get_functiondef('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure))")
        check('P03 floor intact for NEW postings after all this: a price below the HPP is still refused at the cashier (PRICE_BELOW_HPP) and the P03 function is byte-identical', err_has(e_low, 'PRICE_BELOW_HPP') and chk == PRE.get('p03', chk), dict(error=(e_low or '')[:120]))
        # corrected line later voided + reissued keeps the corrected components (the stock stays where the correction put it)

    if S('neg'):
        n1 = inv(h, 9120); sn1 = snap(h, n1)
        for label, user in (('ADMIN', r.ADMIN), ('DOCTOR', r.DOCTOR), ('STAFF', r.STAFF), ('FINANCE', r.FINANCE), ('inactive FINANCE', r.FIN_NONAKTIF), ('FINANCE other branch', r.FIN_LUAR)):
            err, _ = corr(h, n1, [comp(LAC, 3)], user=user, key='bi-role-' + label.split()[0] + label.split()[-1])
            check(f'NEG {label} refused (ACCESS_DENIED), nothing changed', err_has(err, 'ACCESS_DENIED') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        err = h.gagal(f"set role authenticated;select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub',{q(r.OWNER)},false);"
                      f"select set_config('request.headers',{q(json.dumps({'x-kamo-operational-branch': r.BRANCH2}))},false);select {RPC}({q(n1['line'])},{j([comp(LAC, 3)])},'Alasan cukup panjang','bi-branch');")
        check('NEG OWNER working in ANOTHER branch (operational-branch header) refused by THIS function (ACCESS_DENIED: cabang tagihan tidak diizinkan), nothing changed', err_has(err, 'ACCESS_DENIED', 'cabang tagihan') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        err = h.gagal(f"reset role;select {RPC}({q(n1['line'])},{j([comp(LAC, 3)])},'Alasan cukup panjang','bi-anon');")
        check('NEG no authenticated session refused', bool(err) and ('ACCESS_DENIED' in err or 'permission denied' in err) and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        for label, reason in (('missing', None), ('empty', ''), ('whitespace', '       '), ('4 significant chars', 'ab c  d'), ('too long', 'x' * 501)):
            err = h.gagal(f"select {RPC}({q(n1['line'])},{j([comp(LAC, 3)])},{('null' if reason is None else q(reason))},{q('bi-reason-' + label.split()[0])});", r.OWNER)
            check(f'NEG reason {label} -> REASON_REQUIRED, nothing changed', err_has(err, 'REASON_REQUIRED') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        err = h.gagal(f"select {RPC}({q(n1['line'])},{j([comp(LAC, 3)])},'Alasan cukup panjang','');", r.OWNER)
        check('NEG empty request key -> REASON_REQUIRED (kunci), nothing changed', err_has(err, 'REASON_REQUIRED', 'kunci') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        W4 = 'maksimal 4 desimal'
        bad = [('empty array', [], 'minimal satu bahan'), ('not an array', {'a': 1}, 'minimal satu bahan'), ('zero quantity', [comp(LAC, 0)], W4), ('negative quantity', [comp(LAC, -1)], W4), ('NaN quantity', [dict(item_id=LAC, qty='NaN')], W4),
               ('text quantity', [dict(item_id=LAC, qty='abc')], 'jumlah BMHP tidak valid'), ('5 decimals', [comp(LAC, 1.00001)], W4), ('over 100000', [comp(LAC, 100001)], W4), ('duplicate ingredient', [comp(LAC, 3), comp(LAC, 1)], W4),
               ('unknown item', [comp(r.uid('e', 99999), 1)], 'yang ada di master'), ('inactive new ingredient', [comp(CX, 1)], 'tidak aktif'), ('non-stock (service) ingredient', [comp(CS, 1)], 'yang ada di master'),
               ('missing item_id', [dict(qty=2)], W4), ('unknown unit', [comp(LAC, 1, 'galon')], 'tidak ditemukan'), ('over the 10x bound (51 of an original 5)', [comp(LAC, 51)], 'BMHP_LIMIT'),
               ('new ingredient over 1000', [comp(LAC, 5), comp(CB, 1001)], 'BMHP_LIMIT'), ('more than 50 rows', [comp(LAC, 1)] * 51, 'minimal satu bahan')]
        for label, payload, word in bad:
            err = h.gagal(f"select {RPC}({q(n1['line'])},{j(payload)},'Alasan cukup panjang',{q('bi-bad-' + label.split()[0] + label.split()[-1])});", r.OWNER)
            check(f'NEG payload {label} refused ({word}), NO partial effect (stock, layers, line, rx, journals)', bool(err) and word in err and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        err, _ = corr(h, n1, [comp(LAC, 5)], key='bi-nochange')
        check('NEG unchanged components refused (NO_CHANGE, no audit noise, no journal)', err_has(err, 'NO_CHANGE') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        # stock short: nothing left to issue the extra unit from
        sh = cm.bmhp_visit(h, 9121, comps=[comp(CD, 4)], layers=False); own_layers(h, CD, [(4, '100', '2025-12-01')])
        cm.save(h, sh, 'bi-sh-save', []); cm.link(h, sh)
        h.sistem(f"update stock set qty=0 where warehouse_id={q(r.WH)} and item_id={q(CD)};update stock_layers set qty_left=0 where item_id={q(CD)};")
        ssh = snap(h, sh); err, _ = corr(h, sh, [comp(CD, 5)], key='bi-short')
        check('NEG increase with no stock left refused (STOCK_SHORT), NO partial effect', err_has(err, 'STOCK_SHORT') and snap(h, sh) == ssh, dict(error=(err or '')[:160]))
        # invoice / line / visit state
        v1 = inv(h, 9130); h.sistem(f"update invoices set voided_at=now() where id={q(v1['inv'])};"); s = snap(h, v1)
        err, _ = corr(h, v1, [comp(LAC, 3)])
        check('NEG voided invoice refused (INVOICE_VOID), nothing changed', err_has(err, 'INVOICE_VOID') and snap(h, v1) == s, dict(error=(err or '')[:160]))
        cp = inv(h, 9131); h.sistem(f"update invoices set correction_pending=true where id={q(cp['inv'])};"); s = snap(h, cp)
        err, _ = corr(h, cp, [comp(LAC, 3)])
        check('NEG invoice awaiting a cashier correction (correction_pending) refused (INVOICE_PENDING), nothing changed', err_has(err, 'INVOICE_PENDING') and snap(h, cp) == s, dict(error=(err or '')[:160]))
        ri = inv(h, 9132); h.sistem(f"update invoices set reissued_from=(select id from invoices where visit_id={q(ri['v'])} order by created_at limit 1) where id={q(ri['inv'])};"); s = snap(h, ri)
        err, _ = corr(h, ri, [comp(LAC, 3)])
        check('NEG a reissued replacement invoice refused (INVOICE_ADJUSTED), nothing changed', err_has(err, 'INVOICE_ADJUSTED') and snap(h, ri) == s, dict(error=(err or '')[:160]))
        rf = inv(h, 9133)
        h.sistem(f"insert into clinic_refund_requests(invoice_id,branch_id,requested_by,request_key,payload,quoted_total,status) values ({q(rf['inv'])},{q(r.BRANCH)},{q(r.OWNER)},'bi-rf-{cm.OFF}','{{}}',1,'pending');"); s = snap(h, rf)
        err, _ = corr(h, rf, [comp(LAC, 3)])
        check('NEG an invoice with a refund request refused (REFUND_EXISTS), nothing changed', err_has(err, 'REFUND_EXISTS') and snap(h, rf) == s, dict(error=(err or '')[:160]))
        wd = inv(h, 9134)
        h.sql("begin;alter table public.prescription_items disable trigger official_prescription_snapshot;"
              f"update prescription_items set billing_withdrawn_at=now(),billing_withdrawn_by={q(r.STAFF)},billing_withdrawal_reason='ditarik uji' where id={q(wd['rx'])};"
              "set constraints all immediate;alter table public.prescription_items enable trigger official_prescription_snapshot;commit;")
        s = snap(h, wd); err, _ = corr(h, wd, [comp(LAC, 3)])
        check('NEG a line whose prescription row was withdrawn refused (LINE_INVALID), nothing changed', err_has(err, 'LINE_INVALID', 'ditarik') and snap(h, wd) == s, dict(error=(err or '')[:160]))
        ck = inv(h, 9135); h.sql(f"update visits set checked_out_at=now() where id={q(ck['v'])};"); s = snap(h, ck)
        err, _ = corr(h, ck, [comp(LAC, 3)])
        check('NEG visit checked out refused (VISIT_CLOSED), nothing changed', err_has(err, 'VISIT_CLOSED') and snap(h, ck) == s, dict(error=(err or '')[:160]))
        ar = inv(h, 9136); h.sql(f"begin;alter table public.visits disable trigger user;update visits set archived_at=now(),archived_by={q(r.OWNER)},archive_reason='arsip uji fiktif' where id={q(ar['v'])};alter table public.visits enable trigger user;commit;"); s = snap(h, ar)
        err, _ = corr(h, ar, [comp(LAC, 3)])
        check('NEG visit archived refused (VISIT_CLOSED), nothing changed', err_has(err, 'VISIT_CLOSED') and snap(h, ar) == s, dict(error=(err or '')[:160]))
        dc = inv(h, 9137); h.sistem(f"update inpatient_records set discharged_at=now(),condition_status='sembuh' where visit_id={q(dc['v'])};update visits set status='Selesai' where id={q(dc['v'])};"); s = snap(h, dc)
        err, _ = corr(h, dc, [comp(LAC, 3)])
        check('NEG discharged AND closed (status Selesai) visit refused (VISIT_CLOSED), nothing changed', err_has(err, 'VISIT_CLOSED') and snap(h, dc) == s, dict(error=(err or '')[:160]))
        do = inv(h, 9138); h.sistem(f"update inpatient_records set discharged_at=now(),condition_status='sembuh' where visit_id={q(do['v'])};")
        err, _ = corr(h, do, [comp(LAC, 3)], key='bi-discharged-open')
        check('discharged but still awaiting payment (status not Selesai): allowed (the owner must be able to fix an open bill)', err is None and n(cm.line_row(h, do)['hpp']) == D('36000.00'), dict(error=(err or '')[:200]))
        # plain line (no BMHP snapshot) of the DP-first invoice
        pl = inv(h, 9139)
        plain = h.nilai(f"select ii.id from invoice_items ii join invoices i on i.id=ii.invoice_id where i.visit_id={q(pl['v'])} and ii.bmhp_components is null order by ii.created_at,ii.id limit 1")
        s = snap(h, pl); err, _ = corr(h, pl, [comp(LAC, 3)], line=plain, key='bi-plain')
        check('NEG a line without a BMHP snapshot refused (NOT_BMHP), nothing changed', err_has(err, 'NOT_BMHP') and snap(h, pl) == s, dict(error=(err or '')[:160]))
        err, _ = corr(h, pl, [comp(LAC, 3)], line=r.uid('e', 999998), key='bi-unknown-line')
        check('NEG unknown line refused (LINE_INVALID)', err_has(err, 'LINE_INVALID'), dict(error=(err or '')[:160]))
        # racikan line
        try:
            prep_base(h); rk = base.racik_visit(h, 9140 + cm.OFF, price=80000); e0, _ = cm.save(h, dict(rk, rx=rk['rx']), 'bi-rk-save', [])
            rkline = h.nilai(f"select id from invoice_items where compound_recipe_id={q(rk['recipe'])}")
            sk = base.state(h, rk); err, _ = corr(h, rk, [comp(LAC, 3)], line=rkline, key='bi-rk')
            check('NEG a racikan invoice line refused (RECIPE_LINKED: racikan have their own correction), nothing changed', e0 is None and err_has(err, 'RECIPE_LINKED') and base.state(h, rk) == sk, dict(save=(e0 or '')[:100], error=(err or '')[:160]))
        except RuntimeError as e:
            check('NEG racikan fixture', False, str(e)[:300])
        # periods
        pl2 = inv(h, 9141); spl = snap(h, pl2)
        h.sistem("update accounting_locks set closed_until='2026-11-03' where id;")
        err, _ = corr(h, pl2, [comp(LAC, 3)], key='bi-lock-old'); h.sistem('update accounting_locks set closed_until=null where id;')
        check('period locked up to the INVOICE date (today still open): allowed, the delta journal is dated today', err is None and all(row[1] == today for row in new_rows(snap(h, pl2)['jr'], spl['jr'])) and new_rows(snap(h, pl2)['jr'], spl['jr']), dict(error=(err or '')[:200]))
        nl = inv(h, 9142); sn0 = snap(h, nl)
        h.sistem('update accounting_locks set closed_until=current_date where id;'); err, _ = corr(h, nl, [comp(LAC, 3)], key='bi-lock-today'); qe, _ = quote(h, nl, [comp(LAC, 3)]); h.sistem('update accounting_locks set closed_until=null where id;')
        check('NEG accounting period locked up to TODAY refused (Periode akuntansi ... ditutup), also in the quote, nothing changed', err_has(err, 'Periode akuntansi') and err_has(qe, 'Periode akuntansi') and snap(h, nl) == sn0, dict(error=(err or '')[:200]))
        h.sistem('update inventory_costing_settings set closed_through=current_date where id;'); err, _ = corr(h, nl, [comp(LAC, 3)], key='bi-lock-inv'); h.sistem('update inventory_costing_settings set closed_through=null where id;')
        check('NEG inventory period closed through today refused (Periode persediaan ... ditutup), nothing changed', err_has(err, 'Periode persediaan') and snap(h, nl) == sn0, dict(error=(err or '')[:200]))
        # average costing
        av = inv(h, 9143); sav = snap(h, av)
        h.sistem("update inventory_costing_settings set method='moving_average' where id;"); err, _ = corr(h, av, [comp(LAC, 3)], key='bi-avg'); h.sistem("update inventory_costing_settings set method='fifo' where id;")
        check('NEG moving-average costing refused (AVERAGE_UNSUPPORTED), nothing changed', err_has(err, 'AVERAGE_UNSUPPORTED') and snap(h, av) == sav, dict(error=(err or '')[:160]))
        # inconsistent history: never guess
        for i, (label, plant, word) in enumerate((
                ('stock card differs from the line (an extra klinik-bmhp move)', "insert into stock_moves(warehouse_id,item_id,qty,unit_cost,source,source_ref) select warehouse_id,item_id,-1,1,'klinik-bmhp',source_ref from stock_moves where source='klinik-bmhp' and source_ref={no} limit 1", 'STOCK_MISMATCH'),
                ('snapshot cost differs from its components (planted through a valid permit)', "begin;insert into {permits} values (txid_current(),{owner},{line});select set_config('request.jwt.claim.sub',{owner},false);update invoice_items set bmhp_components=jsonb_set(bmhp_components,'{{cost}}','1') where id={line};delete from {permits};commit", 'HPP_INCONSISTENT'),
                ('invoice HPP journal differs from the line hpp (an extra hpp-edit journal)', "select public.clinic_write_journal(current_date,'uji','klinik-hpp-edit',{no},{branch},'[{{\"code\":\"600001\",\"debit\":5,\"credit\":0}},{{\"code\":\"170001\",\"debit\":0,\"credit\":5}}]'::jsonb)", 'JOURNAL_MISMATCH'))):
            hv = inv(h, 9150 + i)
            try: h.sistem(plant.format(no=q(hv['no']), permits=PERMITS, owner=q(r.OWNER), line=q(hv['line']), branch=q(r.BRANCH)) + ';')
            except RuntimeError as e:
                check(f'NEG inconsistent history ({label}) refused ({word}), nothing changed', False, dict(fixture=str(e)[:160])); continue
            s = snap(h, hv)
            err, _ = corr(h, hv, [comp(LAC, 3)], key=f'bi-inc-{i}')
            check(f'NEG inconsistent history ({label}) refused ({word}), nothing changed', err_has(err, word) and snap(h, hv) == s, dict(error=(err or '')[:200]))
        # non-ranap: remove the stay (outpatient-like): the correction refuses (NOT_INPATIENT)
        no = inv(h, 9155)
        e = h.gagal(f"begin;alter table public.inpatient_records disable trigger user;delete from inpatient_records where visit_id={q(no['v'])};alter table public.inpatient_records enable trigger user;commit;")
        if e is None:
            s = snap(h, no); err, _ = corr(h, no, [comp(LAC, 3)], key='bi-noinp')
            check('NEG an invoice of a visit WITHOUT a rawat-inap stay refused (NOT_INPATIENT), nothing changed', err_has(err, 'NOT_INPATIENT') and snap(h, no) == s, dict(error=(err or '')[:160]))
        else:
            check('NEG non-ranap fixture', False, e[:200])

        # an ingredient deactivated AFTER posting: the prescription row is rewritten too and its guard refuses inactive items, so it must be taken out (stock back at the recorded cost)
        ia = cm.bmhp_visit(h, 9160, comps=[comp(CD, 4), comp(CC, 1)], layers=False); own_layers(h, CD, [(4, '100', '2025-12-02'), (50, '150', '2026-01-03')]); cm.fresh(h, CC, 5)
        cm.save(h, ia, 'bi-ia-save', []); cm.link(h, ia)
        h.sql(f"begin;alter table public.items disable trigger user;update items set is_active=false where id={q(CD)};alter table public.items enable trigger user;commit;")
        sia = snap(h, ia)
        e_up, _ = corr(h, ia, [comp(CD, 5), comp(CC, 1)], key='bi-ia-up'); e_keep, _ = corr(h, ia, [comp(CD, 4), comp(CC, 2)], key='bi-ia-keep'); e_down, _ = corr(h, ia, [comp(CD, 3), comp(CC, 1)], key='bi-ia-down')
        unchanged = snap(h, ia) == sia
        e_out, _ = corr(h, ia, [comp(CC, 1)], key='bi-ia-out')
        h.sql(f"begin;alter table public.items disable trigger user;update items set is_active=true where id={q(CD)};alter table public.items enable trigger user;commit;")
        check('an ingredient deactivated after posting: increasing, keeping or reducing it is refused (tidak aktif) with no effect; taking it OUT of the list works (its whole recorded cost 400.00 comes back)',
              all(err_has(e_, 'tidak aktif') for e_ in (e_up, e_keep, e_down)) and unchanged and e_out is None and n(cm.line_row(h, ia)['hpp']) == D('500.00') and len(cm.line_row(h, ia)['bmhp_components']['components']) == 1,
              dict(up=(e_up or '')[:80], keep=(e_keep or '')[:80], down=(e_down or '')[:80], out=(e_out or '')[:120]))

    if S('acl'):
        ar_ = h.gagal(f"update {NEWTAB} set reason='diubah semua';"); ad = h.gagal(f'delete from {NEWTAB};'); at = h.gagal(f'truncate {NEWTAB};')
        exists_t = h.nilai(f"select to_regclass('{NEWTAB}') is not null") == 't'
        check('audit rows are append-only (UPDATE, DELETE, TRUNCATE refused even for the superuser)', exists_t and bool(ar_) and bool(ad) and bool(at) and all('does not exist' not in (e_ or '') for e_ in (ar_, ad, at)), dict(u=(ar_ or '')[:80], d=(ad or '')[:80], t=(at or '')[:80]))
        ag = h.gagal(f'select * from {NEWTAB};', r.OWNER); ai = h.gagal(f"insert into {NEWTAB}(id) values (gen_random_uuid());", r.OWNER)
        check('audit table has no app grant (owner session can neither read nor write it directly)', exists_t and bool(ag) and 'permission denied' in ag and bool(ai) and 'permission denied' in ai, dict(r=(ag or '')[:100], w=(ai or '')[:100]))

        def acl(sig):
            return h.nilai(f"select case when to_regprocedure('{sig}') is null then 'missing' else has_function_privilege('authenticated','{sig}','execute')::text||'|'||has_function_privilege('anon','{sig}','execute')||'|'||has_function_privilege('public','{sig}','execute')||'|'||has_function_privilege('service_role','{sig}','execute') end")
        got = [acl(s) for s in (f'public.{RPC}(uuid,jsonb,text,text)', f'public.{QUOTE}(uuid,jsonb)', f'public.{LINES}(uuid)')]
        priv = acl('clinic_private.owner_correct_invoiced_bmhp(uuid,jsonb,text,text,boolean)'); gacl = acl('public.guard_invoice_item_bmhp()')
        check('ACL: RPC, quote and lines reader executable by authenticated only; the private core and the patched trigger function by nobody',
              got == ['true|false|false|false'] * 3 and priv == 'false|false|false|false' and gacl == 'false|false|false|false', dict(got=got, priv=priv, guard=gacl))
        now_defs = old_defs(h); now_dig = digest(h)
        check('DIGEST: every pre-existing function (definition + ACL), trigger, column, constraint, index, policy, table ACL is IDENTICAL before/after applying the migration, except the ONE patched function guard_invoice_item_bmhp and the new objects',
              pre is not None and pre == now_dig, dict(pre=pre, now=now_dig))
        check('the cashier, draft, P03, posting, bmhp_issue, BMHP guard, job order, journal writer, tarik-baris, racikan RPCs, part A and the invoice edit/reissue cores keep their exact definitions',
              bool(now_defs) and now_defs == PRE.get('v'), dict(defs=now_defs, pre=PRE.get('v')))
        old_g = PRE.get('guard_b64'); new_g = guard_def(h)
        import base64
        NEWTXT = ("  if tg_op = 'UPDATE' and new.bmhp_components is distinct from old.bmhp_components\n     and not exists (select 1 from clinic_private.owner_bmhp_invoice_permits pp where pp.transaction_id = txid_current()\n"
                  "       and pp.actor = auth.uid() and pp.invoice_item_id = new.id) then")
        ok_g = False
        if old_g and new_g:
            od, nd = base64.b64decode(old_g).decode(), base64.b64decode(new_g).decode()
            ok_g = od.count(ANCHOR) == 1 and nd == od.replace(ANCHOR, NEWTXT)
        check('PATCH proof: the new guard_invoice_item_bmhp == the old definition with ONLY the anchor line extended by the permit condition (all other lines, the INSERT branch and the messages identical)', ok_g, dict(old=bool(old_g)))
        cand = (MIG / CANDIDATE).read_text() if (MIG / CANDIDATE).exists() else ''
        check('static: the migration redefines none of the other live objects (no create/replace of post invoice, cashier, P03, bmhp_issue, tarik-baris, racikan RPCs, edit/void cores, journal writer, stock primitives)',
              bool(cand) and not any(t in cand.lower() for t in ('function public.clinic_post_invoice', 'function public.clinic_save_inpatient_cashier', 'function clinic_private.assert_invoice_price_floor', 'function clinic_private.bmhp_issue',
                                                                  'function public.clinic_owner_remove_invoice_lines', 'function public.clinic_owner_correct_compound', 'function public.clinic_edit_invoice_core', 'function public.clinic_write_journal',
                                                                  'function public.stock_in_fifo', 'function public.stock_out_fifo', 'function public.guard_prescription_bmhp', 'function clinic_private.owner_bmhp_normalize')), dict())

    if db is not None and S('races'):
        try: races(h, db)
        except RuntimeError as e: check('races: the concurrency battery could not run', False, str(e)[:300])


def races(h, db):
    def blocked(obs, sess):
        for _ in range(40):
            w = obs.sql(f"select coalesce(wait_event_type,'')||'/'||coalesce(wait_event,'') from pg_stat_activity where pid={sess.pid};")
            if w and w[-1].startswith('Lock/'): return w[-1]
            time.sleep(0.15)
        return 'NOT BLOCKED'

    def session(name, user):
        s = c.Session(db, name); s.sql(x.claims(user)); return s
    sqlc = lambda rv, comps, key: f"select {RPC}({q(rv['line'])},{j(comps)},'Alasan cukup panjang',{q(key)});"
    # (1) correction vs a cashier save of ANOTHER pending row on the same visit (holds the coordinator): the correction WAITS, then applies
    k = inv(h, 9170)
    extra = r.uid(9, (9170 + cm.OFF) * 10 + 8)
    h.sql(f"insert into public.prescription_items(id,medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,jenis,kategori) values ({q(extra)},{q(k['mr'])},'Jasa Tambahan BMHP Fiktif',{q(PROCJ)},1,'kali',1,10000,'jasa','Tindakan');")
    save_k, _ = cm.save_sql(h, k, 'bi-race1-save', []); sk0 = snap(h, k)
    with c.Session(db, 'obs') as obs, session('cashier', r.OWNER) as a, session('correct', r.OWNER) as b:
        a.sql('begin;' + save_k); b.send(sqlc(k, [comp(LAC, 3)], 'bi-race-1'))
        wait = blocked(obs, b); a.sql('commit;'); res = c.attempt(b, commit=False)
    sk1 = snap(h, k)
    check('race: correction started while a cashier save holds the visit coordinator WAITS (advisory), then applies; the cashier\'s new invoice is intact',
          wait.endswith('advisory') and res['ok'] and n(sk1['line']['hpp']) == D('36000.00') and h.nilai(f"select count(*) from invoice_items where prescription_item_id={q(extra)}") == '1' and int(sk1['audit']) == int(sk0['audit']) + 1, dict(wait=wait, res=str(res)[:200]))
    # (2) payment waits behind a correction, then pays the corrected invoice
    k3 = inv(h, 9171)
    cart3 = cm.read_cart(h, k3)
    pay3 = (f"select clinic_save_inpatient_cashier({q(k3['stay'])},{q(k3['v'])},{q('bi-race2-pay' + str(cm.OFF))},'2026-11-03',{q(cart3['snapshot'])},{j(cart3['rows'])},{j([dict(method='Tunai', amount=cart3['quote']['remaining'])])},null,false,null,'Kasir Fiktif');")
    with c.Session(db, 'obs2') as obs, session('correct2', r.OWNER) as a, session('payer', r.OWNER) as b:
        a.sql('begin;' + sqlc(k3, [comp(LAC, 3)], 'bi-race-2')); b.send(pay3)
        wait2 = blocked(obs, b); a.sql('commit;'); res2 = c.attempt(b, commit=False)
    s3 = snap(h, k3)
    check('race: invoice payment started while a correction is in flight WAITS (advisory), then pays; invoice Lunas, line hpp 36000.00, journals consistent',
          wait2.endswith('advisory') and res2['ok'] and h.nilai(f"select paid_status from invoices where id={q(k3['inv'])}") == 'Lunas' and n(s3['line']['hpp']) == D('36000.00') and cm.jsum(s3['jr']) == D('36000.00'), dict(wait=wait2, res=str(res2)[:200]))
    # (3) correction waits behind a payment in flight and then corrects the now PAID invoice
    k4 = inv(h, 9172); cart4 = cm.read_cart(h, k4)
    pay4 = (f"select clinic_save_inpatient_cashier({q(k4['stay'])},{q(k4['v'])},{q('bi-race3-pay' + str(cm.OFF))},'2026-11-03',{q(cart4['snapshot'])},{j(cart4['rows'])},{j([dict(method='Tunai', amount=cart4['quote']['remaining'])])},null,false,null,'Kasir Fiktif');")
    with c.Session(db, 'obs3') as obs, session('payer2', r.OWNER) as a, session('correct3', r.OWNER) as b:
        a.sql('begin;' + pay4); b.send(sqlc(k4, [comp(LAC, 3)], 'bi-race-3'))
        wait3 = blocked(obs, b); a.sql('commit;'); res3 = c.attempt(b, commit=False)
    check('race: correction started while a payment holds the coordinator WAITS (advisory), then corrects the now PAID invoice (Lunas kept)',
          wait3.endswith('advisory') and res3['ok'] and h.nilai(f"select paid_status from invoices where id={q(k4['inv'])}") == 'Lunas' and n(snap(h, k4)['line']['hpp']) == D('36000.00'), dict(wait=wait3, res=str(res3)[:200]))
    # (4) owner tarik-baris (on the same invoice) waits behind a correction in flight and is then refused by ITS own rule (not paid): same coordinator, no deadlock
    k5 = inv(h, 9173)
    tarik = f"select clinic_owner_remove_invoice_lines({q(k5['inv'])},{j([dict(invoice_item_id=k5['line'])])},'Uji bentrok tarik','bi-race4-tarik{cm.OFF}');"
    with c.Session(db, 'obs4') as obs, session('correct4', r.OWNER) as a, session('tarik', r.OWNER) as b:
        a.sql('begin;' + sqlc(k5, [comp(LAC, 3)], 'bi-race-4')); b.send(tarik)
        wait4 = blocked(obs, b); a.sql('commit;'); res4 = c.attempt(b, commit=False)
    check('race: owner tarik-baris started while a correction is in flight WAITS (advisory) and is then refused by its own rule (INVOICE_NOT_PAID); no deadlock, the corrected HPP stays',
          wait4.endswith('advisory') and not res4['ok'] and 'deadlock' not in str(res4).lower() and n(snap(h, k5)['line']['hpp']) == D('36000.00'), dict(wait=wait4, res=str(res4)[:200]))
    # (5) invoice void request waits behind a correction in flight; afterwards it is not corrupted (corrected snapshot carried by the void/reissue)
    k6 = inv(h, 9174)
    with c.Session(db, 'obs5') as obs, session('correct5', r.OWNER) as a, session('voider', r.OWNER) as b:
        a.sql('begin;' + sqlc(k6, [comp(LAC, 3)], 'bi-race-5')); b.send(f"select clinic_void_reissue_invoice({q(k6['inv'])},'bi-race5-void{cm.OFF}','Uji bentrok void');")
        wait5 = blocked(obs, b); a.sql('commit;'); res5 = c.attempt(b, commit=False)
    vs = h.nilai(f"select (select voided_at is not null from invoices where id={q(k6['inv'])})::text||'|'||coalesce((select (bmhp_components->>'cost') from invoice_items ii join invoices i on i.id=ii.invoice_id where i.reissued_from={q(k6['inv'])} and ii.bmhp_components is not null limit 1),'-')")
    check('race: invoice void+reissue started while a correction is in flight WAITS (advisory); afterwards no deadlock and, if the reissue happened, the replacement invoice carries the CORRECTED snapshot (cost 36000.00)',
          wait5.endswith('advisory') and 'deadlock' not in str(res5).lower() and (vs.startswith('false|') or vs.startswith('true|36000')), dict(wait=wait5, res=str(res5)[:200], vs=vs))
    # (6) two identical requests at once: one effect
    k7 = inv(h, 9175); s70 = snap(h, k7)
    with c.Session(db, 'obs6') as obs, session('twin-a', r.OWNER) as a, session('twin-b', r.OWNER) as b:
        a.sql('begin;' + sqlc(k7, [comp(LAC, 3)], 'bi-twin')); b.send(sqlc(k7, [comp(LAC, 3)], 'bi-twin'))
        wait6 = blocked(obs, b); a.sql('commit;'); res6 = c.attempt(b, commit=False)
    s71 = snap(h, k7)
    check('race: two identical requests at once apply ONCE (second waits, returns the stored result): Lacto-B +2 once, ONE journal, one audit row',
          wait6.endswith('advisory') and res6['ok'] and 'replayed' in str(res6) and D(json.loads(s71['stock'])[LAC]) - D(json.loads(s70['stock'])[LAC]) == 2 and int(s71['audit']) == int(s70['audit']) + 1 and int(s71['journals']) == int(s70['journals']) + 1, dict(wait=wait6, res=str(res6)[:200]))
    # (7) Owner racikan correction of an INVOICED racikan on the same visit waits behind a correction in flight, then applies
    try:
        prep_base(h)
        rk = base.racik_visit(h, 9176 + cm.OFF, price=80000)
        mine = r.uid(9, (9176 + cm.OFF) * 10 + 7)
        cm.fresh(h, LAC, 70)
        h.sql(f"insert into public.prescription_items(id,medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,jenis,kategori,bmhp_components) values ({q(mine)},{q(rk['mr'])},{q(cm.NAMES[PROC])},{q(PROC)},1,'kali',1,80000,'obat','Tindakan',{q(json.dumps([comp(LAC, 5)]))}::jsonb);")
        e0, _ = cm.save(h, dict(rk, rx=mine), 'bi-race7-save', [])
        rv = dict(v=rk['v'], stay=rk['stay'], rx=mine, n=9176); cm.link(h, rv)
        racsql = f"select clinic_owner_correct_compound_invoiced({q(rk['recipe'])},{j(base.ing(2, 2))},'Koreksi racikan uji','bi-race7-rk');"
        with c.Session(db, 'obs7') as obs, session('correct7', r.OWNER) as a, session('racikan7', r.OWNER) as b:
            a.sql('begin;' + sqlc(rv, [comp(LAC, 3)], 'bi-race-7')); b.send(racsql)
            wait7 = blocked(obs, b); a.sql('commit;'); res7 = c.attempt(b, commit=False)
        check('race: an Owner racikan (invoiced) correction started while a BMHP correction is in flight WAITS (advisory), then applies; both stay (same coordinator, no deadlock)',
              e0 is None and wait7.endswith('advisory') and res7['ok'] and n(cm.line_row(h, rv)['hpp']) == D('36000.00') and h.nilai(f"select count(*) from clinic_private.owner_compound_invoice_corrections where recipe_id={q(rk['recipe'])}") == '1', dict(save=(e0 or '')[:100], wait=wait7, res=str(res7)[:200]))
    except RuntimeError as e:
        check('race 7 fixture (BMHP correction vs racikan correction)', False, str(e)[:300])
    # (8) cart DRAFT save on the same visit waits behind a correction
    k8 = inv(h, 9177)
    extra8 = r.uid(9, (9177 + cm.OFF) * 10 + 8)
    h.sql(f"insert into public.prescription_items(id,medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,jenis,kategori) values ({q(extra8)},{q(k8['mr'])},'Jasa Tambahan BMHP Fiktif',{q(PROCJ)},1,'kali',1,10000,'jasa','Tindakan');")
    cart8 = cm.read_cart(h, k8)
    draft = f"select clinic_save_inpatient_cart_draft({q(k8['stay'])},{q(k8['v'])},'bi-race8-draft',{q(cart8['snapshot'])},{j(cart8['rows'])},'Draft uji');"
    with c.Session(db, 'obs8') as obs, session('correct8', r.OWNER) as a, session('draft8', r.OWNER) as b:
        a.sql('begin;' + sqlc(k8, [comp(LAC, 3)], 'bi-race-8')); b.send(draft)
        wait8 = blocked(obs, b); a.sql('commit;'); res8 = c.attempt(b, commit=False)
    check('race: cart draft save started while a correction is in flight WAITS (advisory) and then completes (or is stale-refused); no deadlock, the corrected HPP stays',
          wait8.endswith('advisory') and 'deadlock' not in str(res8).lower() and n(snap(h, k8)['line']['hpp']) == D('36000.00'), dict(wait=wait8, res=str(res8)[:200]))
    # trial balance after every race and fixture of the run
    check('trial balance 0 and no unbalanced journal entry after ALL fixtures, corrections and races', cm.unbalanced_entries(h) == 0 and D(cm.all_balanced(h)) == 0, dict(tb=cm.all_balanced(h)))


def apply_sql(db, text): db.sql('begin;\n' + text + '\ncommit;')


class Attached(r.NativePostgres):
    def __init__(self, bin_dir, root):
        super().__init__(bin_dir); self.root = Path(root); self.as_user = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
    def __enter__(self): return self
    def __exit__(self, *_): return None


def prepare(db, h):
    PRE['v'] = old_defs(h); PRE['p03'] = h.nilai("select md5(pg_get_functiondef('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure))")
    PRE['guard_b64'] = guard_def(h); return digest(h)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin'); ap.add_argument('--attach')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only', help='comma-separated substrings: run only mutants whose name contains one'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    global SECTIONS
    extra = {}
    cand_path = MIG / CANDIDATE
    try:
        if a.attach:
            with Attached(r.BIN, a.attach) as db:
                name = 'bi_dev_%d' % int(time.time()); db.sql(f'create database {name} template postgres;'); os.environ['PGDATABASE'] = name
                apply_sql(db, (MIG / PART_A).read_text())
                h = x.Harness(db); pre = prepare(db, h)
                if not a.baseline: apply_sql(db, cand_path.read_text())
                run(h, db, setup=False, baseline=a.baseline, pre=pre)
        elif a.mutations:
            from importlib.machinery import SourceFileLoader
            mut = SourceFileLoader('mut', str(ROOT / 'scripts/test-owner-bmhp-invoiced-mutants.py')).load_module()
            with r.NativePostgres(r.BIN) as db:
                base.build(db, {CANDIDATE}); h = x.Harness(db); x.setup(h); pre = prepare(db, h)
                cand = cand_path.read_text(); plan = [('M0 control (unmodified candidate)', cand)]; extra['mutants'] = {}; secs = {}
                for name, pairs, *rest in mut.MUTANTS:
                    secs[name] = set(rest[0]) if rest else None
                    text, ok = cand, True
                    for old, new, expected in pairs:
                        cnt = text.count(old)
                        if cnt != expected: check(name + ' anchor occurs %d time(s)' % expected, False, dict(count=cnt, anchor=old[:60])); ok = False; break
                        text = text.replace(old, new)
                    if not ok or (a.only and not any(o in name for o in a.only.split(','))): continue
                    plan.append((name, text))
                for i, (name, text) in enumerate(plan):
                    SECTIONS = secs.get(name)
                    os.environ.pop('PGDATABASE', None)
                    db.sql(f'create database v{i} template postgres'); os.environ['PGDATABASE'] = f'v{i}'; cm.OFF = 100 * i; base.OFF = 100 * i
                    before = len(RESULTS); crash = None
                    try:
                        apply_sql(db, text); run(h, db, setup=False, pre=pre)
                    except Exception as e:
                        crash = 'battery aborted: ' + str(e).strip().splitlines()[0][:200] if str(e).strip() else 'battery aborted'
                    fails = [cc['case'] for cc in RESULTS[before:] if cc['status'] == 'FAIL']
                    del RESULTS[before:]; os.environ.pop('PGDATABASE', None)
                    if i == 0: check(name + ' has 0 FAIL', not fails and not crash, (fails + [crash or ''])[:3])
                    else:
                        extra['mutants'][name] = dict(killed=bool(fails), failing=fails[:4], crash=crash)
                        check(name + ' KILLED', bool(fails), fails[:3] or [crash]); print('   failing:', fails[:4], 'crash:', crash, flush=True)
        else:
            with r.NativePostgres(r.BIN) as db:
                base.build(db, {CANDIDATE}); h = x.Harness(db); x.setup(h); pre = prepare(db, h)
                if not a.baseline: apply_sql(db, cand_path.read_text())
                run(h, db, setup=False, baseline=a.baseline, pre=pre)
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(cc['status'] == s for cc in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='mutations' if a.mutations else 'RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
