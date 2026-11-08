#!/usr/bin/env python3
"""PART A: OWNER changes the BMHP (bahan habis pakai) components of a PENDING procedure line in the RANAP cashier cart
(migration 20261107230000_owner_bmhp_tindakan_pending.sql). Case: 'Injeksi Antibiotik' blocked by P03 (HPP above price) because of its
Lacto-B quantity; Owner sets it to 3.4, the cashier then posts (and pays) with the price floor INTACT.

Native full schema, fictional fixtures, throwaway local cluster, no network.
  flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-owner-bmhp-pending-postgres.py --pg-bin DIR --json out.json
  --baseline    chain WITHOUT the candidate migration: every new-RPC case must FAIL (RED), the 'blocked today' cases PASS
  --mutations   chain without the candidate once, then each mutant (scripts/test-owner-bmhp-pending-mutants.py) in a cloned database
  --attach DIR  dev only: clone of the `postgres` DB (chain WITHOUT candidates, x.setup done) in a running cluster, candidate applied on top
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
CANDIDATE = '20261107230000_owner_bmhp_tindakan_pending.sql'
LATER = '20261107240000_owner_bmhp_tindakan_invoiced.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = []
RPC = 'clinic_owner_correct_cart_bmhp'
QUOTE = 'clinic_owner_cart_bmhp_quote'
HIST = 'clinic_owner_cart_bmhp_history'
NEWTAB = 'clinic_private.owner_bmhp_cart_overrides'
NEW_NAMES = ('owner_correct_cart_bmhp', 'owner_bmhp_normalize', 'owner_bmhp_sim', RPC, QUOTE, HIST)
comp = cm.comp
PRE_DEFS = {}
SECTIONS = None   # None = every section; mutants replay only the sections that can kill them
def S(name): return SECTIONS is None or name in SECTIONS


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:420], flush=True)


DIGEST_SQL = """select count(*)||'|'||md5(string_agg(k, E'\\n' order by k)) from (
 select 'f:'||p.oid::regprocedure::text||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'') as k
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private') and p.prokind in ('f','p') and p.proname <> all(%s)
 union all select 't:'||t.tgrelid::regclass::text||':'||pg_get_triggerdef(t.oid) from pg_trigger t
   where not t.tgisinternal and t.tgrelid::regclass::text not like '%%owner_bmhp%%'
 union all select 'c:'||table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,'')||':'||is_nullable from information_schema.columns
   where table_schema in ('public','clinic_private') and table_name not like 'owner_bmhp%%'
 union all select 'r:'||c.oid::regclass::text||':'||coalesce(c.relacl::text,'')||':'||c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','clinic_private') and c.relkind in ('r','v','S','m') and c.relname not like 'owner_bmhp%%'
 union all select 'k:'||conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace in ('public'::regnamespace,'clinic_private'::regnamespace) and conrelid::regclass::text not like '%%owner_bmhp%%'
 union all select 'i:'||indexdef from pg_indexes where schemaname in ('public','clinic_private') and tablename not like 'owner_bmhp%%'
 union all select 'p:'||tablename||':'||policyname||':'||coalesce(qual,'')||coalesce(with_check,'') from pg_policies where schemaname in ('public','clinic_private')
) z"""


def digest(h): return h.nilai(DIGEST_SQL % q('{' + ','.join(NEW_NAMES) + '}'))


def old_defs(h):
    """md5 of live objects Part A must NOT touch (the cashier engine, P03, posting, BMHP issue, the BMHP guards, draft save, edit permits writer)."""
    return h.nilai("select md5(string_agg(pg_get_functiondef(p::regprocedure), E'\\n' order by p)) from unnest(array["
                   "'public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)','public.clinic_save_inpatient_cart_draft(uuid,uuid,text,text,jsonb,text)',"
                   "'public.clinic_read_inpatient_cashier(uuid,uuid)','clinic_private.inpatient_payment_quote(uuid,uuid,jsonb)','clinic_private.pending_cashier_rows(uuid)',"
                   "'clinic_private.inpatient_cashier_snapshot(jsonb,jsonb)','clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)','public.clinic_post_invoice(uuid,text,jsonb,jsonb)',"
                   "'clinic_private.bmhp_issue(uuid,uuid,text,date)','public.guard_prescription_bmhp()','public.guard_invoice_item_bmhp()','clinic_private.job_order_complete(uuid,uuid,numeric,numeric,text,date)',"
                   "'public.clinic_edit_queued_record(uuid,uuid,integer,jsonb,jsonb,text,text)','public.clinic_write_journal(date,text,text,text,uuid,jsonb)']) p")


def snap(h, rv):
    """Everything the override may or may not touch, as one comparable value."""
    s = cm.stock_state(h)
    s['rx'] = cm.rx_row(h, rv)
    s['pending'] = h.nilai(f"select md5(clinic_private.pending_cashier_rows({q(rv['v'])})::text)")
    s['invoices'] = h.nilai(f"select count(*) from invoices where visit_id={q(rv['v'])}")
    s['items'] = h.nilai(f"select md5(coalesce(jsonb_agg(to_jsonb(ii) order by ii.id),'[]')::text) from invoice_items ii join invoices i on i.id=ii.invoice_id where i.visit_id={q(rv['v'])}")
    s['payments'] = h.nilai(f"select count(*) from invoice_payments p join invoices i on i.id=p.invoice_id where i.visit_id={q(rv['v'])}")
    s['journals'] = h.nilai('select count(*) from journal_entries')
    s['audit'] = audit_n(h)
    s['cartaudit'] = h.nilai(f"select count(*) from clinic_pending_cart_edits where visit_id={q(rv['v'])}")
    return s


def audit_n(h):
    return h.nilai(f"select case when to_regclass('{NEWTAB}') is null then '0' else (xpath('/row/c/text()',query_to_xml('select count(*) as c from {NEWTAB}',false,true,'')))[1]::text end")


def audit_rows(h, rv):
    if h.nilai(f"select to_regclass('{NEWTAB}') is not null") != 't': return []
    return json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(a) order by created_at,id),'[]') from {NEWTAB} a where prescription_item_id={q(rv['rx'])}"))


def snapshot_of(h, rv, user=r.OWNER): return cm.read_cart(h, rv, user)['snapshot']


def corr(h, rv, comps, reason='BMHP disesuaikan setelah dihitung ulang', key=None, user=r.OWNER, fn=RPC, snapshot=None, rx=None):
    key = key or 'bp-%s-%s' % (rv['n'], hashlib.md5((json.dumps(comps, sort_keys=True, default=str) + reason).encode()).hexdigest()[:8])
    snapshot = snapshot if snapshot is not None else snapshot_of(h, rv)
    try:
        return None, json.loads(h.nilai(f"select {fn}({q(rv['stay'])},{q(rv['v'])},{q(rx or rv['rx'])},{j(comps)},{q(reason)},{q(key)},{q(snapshot)});", user))
    except RuntimeError as e:
        return str(e), None


def quote(h, rv, comps, user=r.OWNER, snapshot=None, rx=None):
    snapshot = snapshot if snapshot is not None else snapshot_of(h, rv)
    try:
        return None, J(h.nilai(f"select {QUOTE}({q(rv['stay'])},{q(rv['v'])},{q(rx or rv['rx'])},{j(comps)},{q(snapshot)});", user))
    except RuntimeError as e:
        return str(e), None


def n(v): return D(str(v))
_BASE = {}
def prep_base(h):
    if not _BASE.get(id(h.db)): base.prep(h); _BASE[id(h.db)] = 1
def lac_left(h): return D(h.nilai(f"select coalesce(sum(qty_left),0) from stock_layers where item_id={q(LAC)}"))
def lac_stock(h): return D(h.nilai(f"select qty from stock where item_id={q(LAC)} and warehouse_id={q(r.WH)}"))


def run(h, db=None, setup=True, baseline=False, pre=None):
    _BASE.clear()
    if setup: x.setup(h)
    cm.prep(h)
    today = h.nilai('select current_date')
    if S('core'):
        # ------------------------------------------------------------------ preflight (RED = the objects are absent)
        objs = h.nilai(f"select concat_ws('|', to_regprocedure('public.{RPC}(uuid,uuid,uuid,jsonb,text,text,text)') is not null, to_regprocedure('public.{QUOTE}(uuid,uuid,uuid,jsonb,text)') is not null, "
                       f"to_regprocedure('public.{HIST}(uuid)') is not null, to_regclass('{NEWTAB}') is not null, to_regprocedure('clinic_private.owner_correct_cart_bmhp(uuid,uuid,uuid,jsonb,text,text,text,boolean)') is not null)")
        check('preflight: the override RPC, quote, history reader, audit table and private core exist', objs == 't|t|t|t|t', dict(objs=objs))

        # ------------------------------------------------------------------ the live case TODAY: Injeksi Antibiotik blocked by P03, nobody can fix it in the cashier
        a = cm.bmhp_visit(h, 8101); s0 = snap(h, a)
        check('fixture: pending Injeksi Antibiotik price 50000 with the doctor\'s BMHP Lacto-B 5 @12000 (cost 60000), unit/factor/base_qty normalised by the BMHP guard',
              cm.comps_of(h, a) == [dict(qty=5, name='Lacto-B Fiktif', unit='pcs', factor=1, item_id=LAC, base_qty=5.0)], dict(c=cm.comps_of(h, a)))
        err, cart = cm.save(h, a, 'bp-red-1', [])
        check('RED/today: the cashier refuses the line with PRICE_BELOW_HPP (HPP 60000 > price 50000), nothing is invoiced, BMHP stock untouched',
              err_has(err, 'PRICE_BELOW_HPP', 'Injeksi Antibiotik Fiktif', 'Rp60.000') and snap(h, a) == s0, dict(error=(err or '')[:200]))
        rows = cart['rows']; rows[0]['bmhp_components'] = [dict(item_id=LAC, qty=3.4, unit='pcs')]
        sql, _ = cm.save_sql(h, a, 'bp-red-2', [], rows=rows)
        err = h.gagal(sql, r.OWNER)
        check('RED/today: the cashier engine never writes bmhp_components (a rewritten row payload is ignored): still PRICE_BELOW_HPP, components unchanged',
              err_has(err, 'PRICE_BELOW_HPP') and cm.comps_of(h, a) == s0['rx']['bmhp_components'], dict(error=(err or '')[:160]))
        err = h.gagal(f"update prescription_items set bmhp_components={q(json.dumps([dict(item_id=LAC, qty=3.4, unit='pcs')]))}::jsonb where id={q(a['rx'])};", r.OWNER)
        check('RED/today: a direct app UPDATE of bmhp_components is refused (nobody, not even the Owner, can edit stored BMHP outside an audited RPC)', bool(err) and cm.comps_of(h, a) == s0['rx']['bmhp_components'], dict(error=(err or '')[:160]))

        # ------------------------------------------------------------------ quote: read-only, HPP before/after, floor result
        qerr, qj = quote(h, a, [comp(LAC, 3.4)])
        check('quote LAC 5 -> 3.4: cost 60000.00 -> 40800.00 (current FIFO @12000), HPP 60000.00 -> 40800.00, net price 50000, floor applies, BEFORE fails / AFTER passes, can_post false -> true; changes NOTHING',
              qj is not None and n(qj['cost_before']) == D('60000.00') and n(qj['cost_after']) == D('40800.00') and n(qj['hpp_before']) == D('60000.00') and n(qj['hpp_after']) == D('40800.00')
              and n(qj['net_price']) == D('50000.00') and qj['floor_applies'] is True and qj['price_below_hpp_before'] is True and qj['price_below_hpp_after'] is False
              and qj['can_post_before'] is False and qj['can_post_after'] is True and snap(h, a) == s0, dict(error=(qerr or '')[:200], q=str(qj)[:300]))
        qd, _ = quote(h, a, [comp(LAC, 3.4)], user=r.STAFF)
        check('NEG quote for a non-owner refused (ACCESS_DENIED)', err_has(qd, 'ACCESS_DENIED'), dict(error=(qd or '')[:120]))

        # ------------------------------------------------------------------ GREEN override
        old_snapshot = snapshot_of(h, a)
        err, res = corr(h, a, [comp(LAC, 3.4)], key='bp-a-1')
        s1 = snap(h, a)
        comps1 = cm.comps_of(h, a)
        check('GREEN Owner sets Lacto-B 5 -> 3.4: normalised on the pending row (name/unit/factor/base_qty from the master), nothing else on the row changes',
              err is None and comps1 == [dict(qty=3.4, name='Lacto-B Fiktif', unit='pcs', factor=1, item_id=LAC, base_qty=3.4)]
              and {k: v for k, v in s1['rx'].items() if k != 'bmhp_components'} == {k: v for k, v in s0['rx'].items() if k != 'bmhp_components'}, dict(error=(err or '')[:300], comps=comps1))
        check('NO stock, journal, invoice or payment effect at override time (BMHP stock only leaves at invoice posting): layers, stock, moves, journals, invoices, items, payments identical',
              all(s1[k] == s0[k] for k in ('stock', 'layers', 'moves', 'journals', 'invoices', 'items', 'payments')), dict())
        au = audit_rows(h, a)
        check('audit row: who / when / visit / record / row / item / before+after+original components / hpp before+after / floor flags / reason / request_key / snapshots',
              len(au) == 1 and au[0]['actor_id'] == r.OWNER and au[0]['visit_id'] == a['v'] and au[0]['prescription_item_id'] == a['rx'] and au[0]['request_key'] == 'bp-a-1' and au[0]['created_at']
              and au[0]['reason'].startswith('BMHP disesuaikan') and au[0]['before_components'][0]['qty'] == 5 and au[0]['after_components'][0]['qty'] == 3.4 and au[0]['original_components'][0]['qty'] == 5
              and n(au[0]['hpp_before']) == D('60000.00') and n(au[0]['hpp_after']) == D('40800.00') and au[0]['price_below_hpp_before'] is True and au[0]['price_below_hpp_after'] is False
              and au[0]['snapshot_before'] == old_snapshot and au[0]['snapshot_after'] == res['snapshot_after'], dict(au=au[:1]))
        check('the existing cart-edit history also records it (clinic_pending_cart_edits row keyed bmhp:<request_key>, before/after rows)',
              s1['cartaudit'] == str(int(s0['cartaudit']) + 1) and h.nilai(f"select count(*) from clinic_pending_cart_edits where request_key='bmhp:bp-a-1'") == '1', dict(n=s1['cartaudit']))
        check('result carries a fresh snapshot equal to the cart snapshot the cashier now reads (the screen continues without a stale token), and it differs from the old one',
              res and res['snapshot_after'] == snapshot_of(h, a) and res['snapshot_after'] != old_snapshot, dict(res=str(res)[:200]))
        sql_old, _ = cm.save_sql(h, a, 'bp-old-snap', [], snapshot=old_snapshot)
        e_old = h.gagal(sql_old, r.OWNER)
        check('CART_STALE interplay: a cashier save with the snapshot read BEFORE the override is refused (CART_STALE), nothing invoiced', err_has(e_old, 'CART_STALE') and snap(h, a)['invoices'] == s1['invoices'], dict(error=(e_old or '')[:160]))
        # replay
        e1, r1 = corr(h, a, [comp(LAC, 3.4)], key='bp-a-1', snapshot=old_snapshot)
        check('replay: same request_key + same payload returns the stored result (even though the snapshot moved), no second audit, no second change', e1 is None and r1 and r1.get('replayed') is True and snap(h, a) == s1, dict(error=(e1 or '')[:160]))
        e2, _ = corr(h, a, [comp(LAC, 3.0)], key='bp-a-1')
        check('replay with a DIFFERENT payload under the same key is refused (IDEMPOTENCY_CONFLICT), nothing changes', err_has(e2, 'IDEMPOTENCY_CONFLICT') and snap(h, a) == s1, dict(error=(e2 or '')[:160]))
        # history reader
        try: hist = json.loads(h.nilai(f"select {HIST}({q(a['v'])});", r.OWNER))
        except RuntimeError as e: hist = str(e)
        check('history reader (Owner): one entry with who, when, reason, before/after (names + qty), HPP before/after', isinstance(hist, list) and len(hist) == 1 and hist[0]['prescription_item_id'] == a['rx'] and hist[0]['reason'].startswith('BMHP')
              and hist[0]['after_components'][0]['qty'] == 3.4 and hist[0]['before_components'][0]['qty'] == 5 and hist[0].get('actor_name') is not None, dict(hist=str(hist)[:200]))
        eh = h.gagal(f"select {HIST}({q(a['v'])});", r.STAFF)
        check('NEG history reader for a non-owner refused (ACCESS_DENIED)', err_has(eh, 'ACCESS_DENIED'), dict(error=(eh or '')[:120]))
        ehb = h.gagal(f"set role authenticated;select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub',{q(r.OWNER)},false);"
                      f"select set_config('request.headers',{q(json.dumps({'x-kamo-operational-branch': r.BRANCH2}))},false);select {HIST}({q(a['v'])});")
        check('NEG history reader for an OWNER working in ANOTHER branch refused (ACCESS_DENIED)', err_has(ehb, 'ACCESS_DENIED'), dict(error=(ehb or '')[:120]))

        # ------------------------------------------------------------------ the cashier now posts with P03 intact; unpaid stage invoice, then HPP/stock to the cent
        pre_la = lac_left(h); pre_st = lac_stock(h); sj0 = snap(h, a)
        err, _ = cm.save(h, a, 'bp-post-1', [])
        cm.link(h, a); line = cm.line_row(h, a); s2 = snap(h, a)
        check('the cashier posts the pending line right after the override (price 50000 >= new HPP 40800): unpaid stage invoice created, floor not loosened',
              err is None and a['line'] and line and n(line['hpp']) == D('40800.00') and n(line['harga']) == D('50000.00'), dict(error=(err or '')[:300], hpp=(line or {}).get('hpp')))
        snapc = line['bmhp_components'] if line else {}
        check('invoice snapshot = overridden components exactly: version 1, cost 40800.00, one component Lacto-B qty 3.4 base_qty 3.4 cost 40800.00',
              snapc and snapc['version'] == 1 and n(snapc['cost']) == D('40800.00') and len(snapc['components']) == 1 and snapc['components'][0]['qty'] == 3.4 and snapc['components'][0]['base_qty'] == 3.4
              and n(snapc['components'][0]['cost']) == D('40800.00') and snapc['components'][0]['item_id'] == LAC, dict(snap=str(snapc)[:300]))
        check('stock exact to the cent: Lacto-B leaves by exactly 3.4 at FIFO @12000 (not 5), stock and layers agree, moves klinik-bmhp -3.4',
              pre_la - lac_left(h) == D('3.4') and pre_st - lac_stock(h) == D('3.4')
              and D(h.nilai(f"select coalesce(-sum(qty),0) from stock_moves where source='klinik-bmhp' and source_ref={q(a['no'])} and item_id={q(LAC)}")) == D('3.4'), dict(left=str(pre_la - lac_left(h))))
        jrn = cm.jr(h, a['no'])
        check('journals: HPP 40800.00 booked (klinik-hpp), every journal entry balanced, trial balance 0',
              cm.jsum(jrn) == D('40800.00') and cm.unbalanced_entries(h) == 0 and D(cm.all_balanced(h)) == 0, dict(net=str(cm.jsum(jrn))))
        check('quote == actual: the quote predicted line HPP 40800.00 / component cost 40800.00 and the posting produced exactly that', qj and n(qj['hpp_after']) == n(line['hpp']) and n(qj['cost_after']) == n(snapc['cost']), dict())
        chk = h.nilai("select md5(pg_get_functiondef('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure))")
        check('P03 function byte-identical (not loosened)', bool(chk) and chk == PRE_DEFS.get('p03', chk), dict(md5=chk))

        # ------------------------------------------------------------------ paid variant: cashier posts AND pays the whole visit after the override
        pv = cm.bmhp_visit(h, 8102)
        e_before, _ = cm.save(h, pv, 'bp-paid-red', [], paid=True)
        err, res = corr(h, pv, [comp(LAC, 3.4)], key='bp-p-1')
        err2, _ = cm.save(h, pv, 'bp-paid-1', paid=True)
        cm.link(h, pv)
        st = h.nilai(f"select paid_status||'|'||(select count(*) from invoice_payments p where p.invoice_id=i.id) from invoices i where id={q(pv['inv'])}") if pv['inv'] else ''
        check('PAID variant: before the override the cashier refuses to post+pay (PRICE_BELOW_HPP); after it posts and pays: stage invoice Lunas with its payment, line HPP 40800.00',
              err_has(e_before, 'PRICE_BELOW_HPP') and err is None and err2 is None and st.startswith('Lunas|') and n(cm.line_row(h, pv)['hpp']) == D('40800.00'), dict(before=(e_before or '')[:100], err=(err or '')[:100], err2=(err2 or '')[:200], st=st))

    if S('p03'):
        # ------------------------------------------------------------------ P03 still refuses a price below the NEW HPP
        lo = cm.bmhp_visit(h, 8103, price=30000); slo = snap(h, lo)
        err, res = corr(h, lo, [comp(LAC, 3.4)], key='bp-lo-1'); s_lo = snap(h, lo)
        err2, _ = cm.save(h, lo, 'bp-lo-save', [])
        check('P03 floor intact: price 30000 is still below the NEW HPP 40800 -> the override is accepted and REPORTED (below_after true) but the cashier still refuses PRICE_BELOW_HPP; nothing invoiced',
              err is None and res['price_below_hpp_after'] is True and res['can_post_after'] is False and err_has(err2, 'PRICE_BELOW_HPP', 'Rp40.800') and snap(h, lo)['invoices'] == s_lo['invoices'], dict(error=(err or '')[:100], err2=(err2 or '')[:160]))
        hi = cm.bmhp_visit(h, 8104); qh = quote(h, hi, [comp(LAC, 4.5)])[1] or {}
        err, res = corr(h, hi, [comp(LAC, 4.5)], key='bp-hi-1'); err2, _ = cm.save(h, hi, 'bp-hi-save', [])
        check('Owner lowers 5 -> 4.5 only (HPP 54000 still > 50000): quote and result say floor fails (can_post false), the cashier still refuses; no loosening',
              err is None and n(qh['hpp_after']) == D('54000.00') and qh['can_post_after'] is False and res['price_below_hpp_after'] is True and err_has(err2, 'PRICE_BELOW_HPP'), dict(error=(err or '')[:100], err2=(err2 or '')[:100]))

    if S('pesanan'):
        # ------------------------------------------------------------------ line HPP != component cost (live INV-0434 shape): older output layer is sold, quote simulates the same
        ol = cm.bmhp_visit(h, 8105, proc=PROCB, out_cost='2600.74', price=50000, comps=[comp(LAC, 5)])
        qo = quote(h, ol, [comp(LAC, 3.4)])[1] or {}
        err, res = corr(h, ol, [comp(LAC, 3.4)], key='bp-ol-1'); err2, _ = cm.save(h, ol, 'bp-ol-save', [])
        cm.link(h, ol); lo_line = cm.line_row(h, ol)
        check('pesanan flow with an OLDER output layer (live INV-0434 shape): components cost 40800.00 but the sold output layer costs 2600.74 -> quote predicts hpp_after 2600.74 AND cost_after 40800.00, and the posting matches both',
              qo and n(qo['cost_after']) == D('40800.00') and n(qo['hpp_after']) == D('2600.74') and err is None and err2 is None and n(lo_line['hpp']) == D('2600.74') and n(lo_line['bmhp_components']['cost']) == D('40800.00'),
              dict(q=str(qo)[:200], err=(err or '')[:80], err2=(err2 or '')[:120], hpp=(lo_line or {}).get('hpp')))

        # ------------------------------------------------------------------ service-type (jasa) line: HPP = BMHP cost, P03 does not apply
        sv = cm.bmhp_visit(h, 8106, proc=PROCJ, price=10000, comps=[comp(LAC, 5)])
        qs = quote(h, sv, [comp(LAC, 3.4)])[1] or {}
        err, res = corr(h, sv, [comp(LAC, 3.4)], key='bp-sv-1'); err2, _ = cm.save(h, sv, 'bp-sv-save', [])
        cm.link(h, sv)
        check('jasa line (price 10000 < HPP 40800 is allowed for services): quote floor_applies false and hpp_after == cost 40800.00, posting HPP equals the quote',
              qs and qs['floor_applies'] is False and n(qs['hpp_after']) == D('40800.00') and err is None and err2 is None and n(cm.line_row(h, sv)['hpp']) == D('40800.00'), dict(q=str(qs)[:200], err2=(err2 or '')[:120]))

    if S('mixed'):
        # ------------------------------------------------------------------ add an ingredient, drop one, alternative unit (box = 10 pcs)
        mx = cm.bmhp_visit(h, 8107, comps=[comp(LAC, 5), comp(CC, 2)]); cm.fresh(h, CB, 20); cm.fresh(h, CU, 20); smx = snap(h, mx)
        err, res = corr(h, mx, [comp(CB, 2), comp(CU, 0.5, 'kotak'), comp(CC, 3)], key='bp-mx-1')
        cmx = {c_['item_id']: c_ for c_ in cm.comps_of(h, mx)}
        check('mixed: LAC dropped, CC 2 -> 3, new CB 2 (ml) and CU 0.5 kotak (= 5 pcs via item_units factor 10) normalised by the master (names, units, factors, base_qty 5.0), nothing moved',
              err is None and set(cmx) == {CB, CC, CU} and cmx[CU]['unit'] == 'kotak' and cmx[CU]['factor'] == 10 and cmx[CU]['base_qty'] == 5.0 and cmx[CC]['qty'] == 3 and cmx[CB]['name'] == 'Bahan B Fiktif'
              and snap(h, mx)['stock'] == smx['stock'] and snap(h, mx)['moves'] == smx['moves'], dict(error=(err or '')[:200], comps=str(cmx)[:300]))
        pre_l = {i: D(h.nilai(f"select coalesce(sum(qty_left),0) from stock_layers where item_id={q(i)}")) for i in (LAC, CB, CC, CU)}
        err, _ = cm.save(h, mx, 'bp-mx-save', []); cm.link(h, mx); lm = cm.line_row(h, mx)
        post = {i: D(h.nilai(f"select coalesce(sum(qty_left),0) from stock_layers where item_id={q(i)}")) for i in (LAC, CB, CC, CU)}
        expect_cost = D('2') * D('9100.25') + D('3') * D('500') + D('5') * D('100')
        check('posting after the mixed override issues exactly the overridden components (LAC untouched, CB 2, CC 3, CU 5 base pcs) at current FIFO; line HPP = sum to the cent',
              err is None and pre_l[LAC] == post[LAC] and pre_l[CB] - post[CB] == 2 and pre_l[CC] - post[CC] == 3 and pre_l[CU] - post[CU] == 5 and n(lm['hpp']) == expect_cost and n(lm['bmhp_components']['cost']) == expect_cost,
              dict(err=(err or '')[:200], hpp=(lm or {}).get('hpp'), expect=str(expect_cost)))

    if S('bounds'):
        # ------------------------------------------------------------------ bounds are measured against the doctor's ORIGINAL recipe (no ratchet)
        bd = cm.bmhp_visit(h, 8108, comps=[comp(LAC, 5)], headroom=100)
        e51, _ = corr(h, bd, [comp(LAC, 51)], key='bp-bd-1')
        e50, _ = corr(h, bd, [comp(LAC, 50)], key='bp-bd-2')
        e51b, _ = corr(h, bd, [comp(LAC, 51)], key='bp-bd-3')
        e1k, _ = corr(h, bd, [comp(LAC, 5), comp(CB, 1001)], key='bp-bd-4')
        # lower bound (review non-blocking item): a NEW quantity below 0.01 of the unit is refused; the same quantity UNCHANGED from the current list stays accepted
        lo2 = cm.bmhp_visit(h, 8109, comps=[comp(LAC, 5), comp(CC, 0.005)]); slo2 = snap(h, lo2)
        q_keep = quote(h, lo2, [comp(LAC, 3), comp(CC, 0.005)]); q_below = quote(h, lo2, [comp(LAC, 5), comp(CC, 0.004)]); q_tiny = quote(h, lo2, [comp(LAC, 0.001)]); q_edge = quote(h, lo2, [comp(LAC, 5), comp(CC, 0.01)])
        check('lower bound: a NEW quantity below 0.01 (CC 0.004, LAC 0.001) is refused (BMHP_INVALID, kurang dari batas minimal 0,01); 0.01 exactly is accepted; an UNCHANGED existing 0.005 (not edited by the Owner) stays accepted; nothing changed',
              err_has(q_below[0], 'BMHP_INVALID', 'batas minimal 0,01') and err_has(q_tiny[0], 'BMHP_INVALID', 'batas minimal 0,01') and q_edge[0] is None and q_keep[0] is None and snap(h, lo2) == slo2,
              dict(keep=(q_keep[0] or '')[:120], below=(q_below[0] or '')[:120], tiny=(q_tiny[0] or '')[:120], edge=(q_edge[0] or '')[:120]))
        au = audit_rows(h, bd)
        check('bounds: > 10x the doctor\'s original (51 > 50) refused (BMHP_LIMIT); exactly 10x accepted; after that 51 is STILL refused (measured from the ORIGINAL, no ratchet); a NEW ingredient above 1000 base units refused; original kept in the audit',
              err_has(e51, 'BMHP_LIMIT') and e50 is None and err_has(e51b, 'BMHP_LIMIT') and err_has(e1k, 'BMHP_LIMIT') and len(au) == 1 and au[0]['original_components'][0]['qty'] == 5, dict(e51=(e51 or '')[:100], e50=(e50 or '')[:100], e51b=(e51b or '')[:100], e1k=(e1k or '')[:100]))

    if S('neg'):
        # ------------------------------------------------------------------ negatives: role / branch / reason / payload / row state - never a partial effect
        n1 = cm.bmhp_visit(h, 8120); other = cm.bmhp_visit(h, 8121); sn1 = snap(h, n1)
        for label, user in (('ADMIN', r.ADMIN), ('DOCTOR', r.DOCTOR), ('STAFF', r.STAFF), ('FINANCE', r.FINANCE), ('inactive FINANCE', r.FIN_NONAKTIF), ('FINANCE other branch', r.FIN_LUAR)):
            err, _ = corr(h, n1, [comp(LAC, 3.4)], user=user, key='bp-role-' + label.split()[0] + label.split()[-1])
            check(f'NEG {label} refused (ACCESS_DENIED), nothing changed', err_has(err, 'ACCESS_DENIED') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        snapshot = snapshot_of(h, n1)
        err = h.gagal(f"set role authenticated;select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub',{q(r.OWNER)},false);"
                      f"select set_config('request.headers',{q(json.dumps({'x-kamo-operational-branch': r.BRANCH2}))},false);select {RPC}({q(n1['stay'])},{q(n1['v'])},{q(n1['rx'])},{j([comp(LAC, 3.4)])},'Alasan cukup panjang','bp-branch',{q(snapshot)});")
        check('NEG OWNER working in ANOTHER branch (operational-branch header) refused (ACCESS_DENIED), nothing changed', err_has(err, 'ACCESS_DENIED') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        err = h.gagal(f"reset role;select {RPC}({q(n1['stay'])},{q(n1['v'])},{q(n1['rx'])},{j([comp(LAC, 3.4)])},'Alasan cukup panjang','bp-anon',{q(snapshot)});")
        check('NEG no authenticated session refused', bool(err) and ('ACCESS_DENIED' in err or 'permission denied' in err) and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        for label, reason in (('missing', None), ('empty', ''), ('whitespace', '       '), ('4 significant chars', 'ab c  d'), ('too long', 'x' * 501)):
            err = h.gagal(f"select {RPC}({q(n1['stay'])},{q(n1['v'])},{q(n1['rx'])},{j([comp(LAC, 3.4)])},{('null' if reason is None else q(reason))},{q('bp-reason-' + label.split()[0])},{q(snapshot)});", r.OWNER)
            check(f'NEG reason {label} -> REASON_REQUIRED, nothing changed', err_has(err, 'REASON_REQUIRED') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        err = h.gagal(f"select {RPC}({q(n1['stay'])},{q(n1['v'])},{q(n1['rx'])},{j([comp(LAC, 3.4)])},'Alasan cukup panjang','',{q(snapshot)});", r.OWNER)
        check('NEG empty request key -> REASON_REQUIRED (kunci), nothing changed', err_has(err, 'REASON_REQUIRED', 'kunci') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        err, _ = corr(h, n1, [comp(LAC, 3.4)], snapshot='0' * 32, key='bp-stale')
        check('NEG stale snapshot refused (CART_STALE), nothing changed', err_has(err, 'CART_STALE') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        err, _ = corr(h, n1, [comp(LAC, 3.4)], snapshot='', key='bp-nosnap')
        check('NEG empty snapshot refused (CART_STALE), nothing changed', err_has(err, 'CART_STALE') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        W4 = 'maksimal 4 desimal'
        bad = [('empty array', [], 'minimal satu bahan'), ('not an array', {'a': 1}, 'minimal satu bahan'), ('zero quantity', [comp(LAC, 0)], W4), ('negative quantity', [comp(LAC, -1)], W4),
               ('NaN quantity', [dict(item_id=LAC, qty='NaN')], W4), ('text quantity', [dict(item_id=LAC, qty='abc')], 'jumlah BMHP tidak valid'), ('5 decimals', [comp(LAC, 1.00001)], W4),
               ('5 decimals on an alternative unit', [comp(CU, 0.00001, 'kotak')], W4), ('over 100000', [comp(LAC, 100001)], W4),
               ('duplicate ingredient', [comp(LAC, 3), comp(LAC, 1)], W4), ('below 0.01 minimum', [comp(LAC, 0.001)], 'batas minimal 0,01'), ('unknown item', [comp(r.uid('e', 99999), 1)], 'yang ada di master'), ('inactive ingredient', [comp(CX, 1)], 'tidak aktif'),
               ('non-stock (service) ingredient', [comp(CS, 1)], 'yang ada di master'), ('null item_id', [dict(item_id=None, qty=1)], W4), ('missing item_id', [dict(qty=2)], W4),
               ('unknown unit', [comp(LAC, 1, 'galon')], 'tidak ditemukan'), ('more than 50 rows', [comp(LAC, 1)] * 51, 'minimal satu bahan'), ('item_id not a uuid', [dict(item_id='xyz', qty=1)], 'jumlah BMHP tidak valid')]
        for label, payload, word in bad:
            err = h.gagal(f"select {RPC}({q(n1['stay'])},{q(n1['v'])},{q(n1['rx'])},{j(payload)},'Alasan cukup panjang',{q('bp-bad-' + label.split()[0] + label.split()[-1])},{q(snapshot)});", r.OWNER)
            check(f'NEG payload {label} refused ({word}), NO partial effect', bool(err) and word in err and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        err, _ = corr(h, n1, [comp(LAC, 5)], key='bp-nochange')
        check('NEG unchanged components refused (NO_CHANGE, no audit noise)', err_has(err, 'NO_CHANGE') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        err, _ = corr(h, n1, [comp(LAC, 5, 'pcs')], key='bp-nochange2')
        check('NEG unchanged components with the unit spelled out refused (NO_CHANGE)', err_has(err, 'NO_CHANGE') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        # row state
        err, _ = corr(h, n1, [comp(LAC, 3.4)], rx=other['rx'], key='bp-other-visit')
        check('NEG a row of ANOTHER visit refused (ROW_INVALID), nothing changed', err_has(err, 'ROW_INVALID') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        err, _ = corr(h, n1, [comp(LAC, 3.4)], rx=r.uid('e', 999999), key='bp-nonexist')
        check('NEG unknown row refused (ROW_INVALID)', err_has(err, 'ROW_INVALID') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
        wd = cm.bmhp_visit(h, 8122)
        h.sql("begin;alter table public.prescription_items disable trigger official_prescription_snapshot;"
              f"update prescription_items set billing_withdrawn_at=now(),billing_withdrawn_by={q(r.STAFF)},billing_withdrawal_reason='ditarik uji' where id={q(wd['rx'])};"
              "set constraints all immediate;alter table public.prescription_items enable trigger official_prescription_snapshot;commit;")
        swd = snap(h, wd); err, _ = corr(h, wd, [comp(LAC, 3.4)], key='bp-wd')
        check('NEG a row withdrawn from the bill refused (ROW_INVALID), nothing changed', err_has(err, 'ROW_INVALID') and snap(h, wd) == swd, dict(error=(err or '')[:160]))
        # plain row without BMHP: the DP-first stage invoice rows are invoiced; make a pending plain row
        pl = cm.bmhp_visit(h, 8123)
        plain = r.uid(9, (8123 + cm.OFF) * 10 + 8)
        h.sql(f"insert into public.prescription_items(id,medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,jenis,kategori) values ({q(plain)},{q(pl['mr'])},'Jasa Tanpa BMHP Fiktif',{q(PROCJ)},1,'kali',1,10000,'jasa','Tindakan');")
        spl = snap(h, pl); err, _ = corr(h, pl, [comp(LAC, 3.4)], rx=plain, key='bp-plain')
        check('NEG a pending row WITHOUT BMHP refused (ROW_INVALID: BMHP cannot be added here), nothing changed', err_has(err, 'ROW_INVALID', 'tidak punya BMHP') and snap(h, pl) == spl, dict(error=(err or '')[:160]))
        # already invoiced row (the posted one from the GREEN section)
        ai = cm.bmhp_visit(h, 8128, price=80000); cm.save(h, ai, 'bp-inv-save', [])
        sa = snap(h, ai); err, _ = corr(h, ai, [comp(LAC, 3.0)], key='bp-invoiced', snapshot=snapshot_of(h, ai))
        check('NEG a row that is already on an invoice refused (ROW_INVALID: use the invoiced-line correction), nothing changed', err_has(err, 'ROW_INVALID') and snap(h, ai) == sa, dict(error=(err or '')[:160]))
        ck = cm.bmhp_visit(h, 8124); h.sql(f"update visits set checked_out_at=now() where id={q(ck['v'])};"); sck = snap(h, ck)
        err, _ = corr(h, ck, [comp(LAC, 3.4)], key='bp-ck')
        check('NEG visit checked out refused (VISIT_CLOSED or the cashier access check), nothing changed', bool(err) and ('VISIT_CLOSED' in err or 'ACCESS_DENIED' in err) and snap(h, ck) == sck, dict(error=(err or '')[:160]))
        ar = cm.bmhp_visit(h, 8125)
        h.sql(f"begin;alter table public.visits disable trigger user;update visits set archived_at=now(),archived_by={q(r.OWNER)},archive_reason='arsip uji fiktif' where id={q(ar['v'])};alter table public.visits enable trigger user;commit;")
        sar = snap(h, ar); err, _ = corr(h, ar, [comp(LAC, 3.4)], key='bp-ar')
        check('NEG visit archived refused (VISIT_CLOSED), nothing changed', err_has(err, 'VISIT_CLOSED') and snap(h, ar) == sar, dict(error=(err or '')[:160]))
        dc = cm.bmhp_visit(h, 8126)
        h.sistem(f"update inpatient_records set discharged_at=now(),condition_status='sembuh' where visit_id={q(dc['v'])};update visits set status='Selesai' where id={q(dc['v'])};")
        sdc = snap(h, dc); err, _ = corr(h, dc, [comp(LAC, 3.4)], key='bp-dc')
        check('NEG discharged AND closed (status Selesai) visit refused (VISIT_CLOSED), nothing changed', err_has(err, 'VISIT_CLOSED') and snap(h, dc) == sdc, dict(error=(err or '')[:160]))
        # compound row (racikan) -> the override must never touch it
        nr = None
        try:
            prep_base(h); rk = base.racik_visit(h, 8130 + cm.OFF, price=50000)
            sk = base.state(h, rk)
            err = h.gagal(f"select {RPC}({q(rk['stay'])},{q(rk['v'])},{q(rk['rx'])},{j([comp(LAC, 1)])},'Alasan cukup panjang','bp-rk',{q(base.read_cart(h, rk)['snapshot'])});", r.OWNER)
            check('NEG a racikan row refused (ROW_INVALID: racikan have their own correction), nothing changed', err_has(err, 'ROW_INVALID', 'racikan') and base.state(h, rk) == sk, dict(error=(err or '')[:160]))
        except RuntimeError as e:
            check('NEG racikan fixture', False, str(e)[:300])
        # no open shift of the actor
        ns = cm.bmhp_visit(h, 8127); snapshot_ns = snapshot_of(h, ns); sns = snap(h, ns)
        h.sistem(f"update cashier_shifts set status='closed' where id={q(r.SHIFT[r.OWNER])};")
        err, _ = corr(h, ns, [comp(LAC, 3.4)], snapshot=snapshot_ns, key='bp-noshift')
        h.sistem(f"update cashier_shifts set status='open' where id={q(r.SHIFT[r.OWNER])};")
        check('NEG an Owner WITHOUT an open klinik shift is refused (SHIFT_INVALID, same rule as the cashier), nothing changed', err_has(err, 'SHIFT_INVALID') and snap(h, ns) == sns, dict(error=(err or '')[:160]))

    if S('acl'):
        # ------------------------------------------------------------------ audit table, ACL, additive digest, the live objects are byte-identical
        ar_ = h.gagal(f"update {NEWTAB} set reason='diubah semua';"); ad = h.gagal(f'delete from {NEWTAB};'); at = h.gagal(f'truncate {NEWTAB};')
        exists_t = h.nilai(f"select to_regclass('{NEWTAB}') is not null") == 't'
        check('audit rows are append-only (UPDATE, DELETE, TRUNCATE refused even for the superuser)', exists_t and bool(ar_) and bool(ad) and bool(at) and all('does not exist' not in (e_ or '') for e_ in (ar_, ad, at)), dict(u=(ar_ or '')[:80], d=(ad or '')[:80], t=(at or '')[:80]))
        ag = h.gagal(f'select * from {NEWTAB};', r.OWNER); ai = h.gagal(f"insert into {NEWTAB}(id) values (gen_random_uuid());", r.OWNER)
        check('audit table has no app grant (owner session can neither read nor write it directly)', exists_t and bool(ag) and 'permission denied' in ag and bool(ai) and 'permission denied' in ai, dict(r=(ag or '')[:100], w=(ai or '')[:100]))

        def acl(sig):
            return h.nilai(f"select case when to_regprocedure('{sig}') is null then 'missing' else has_function_privilege('authenticated','{sig}','execute')::text||'|'||has_function_privilege('anon','{sig}','execute')||'|'||has_function_privilege('public','{sig}','execute')||'|'||has_function_privilege('service_role','{sig}','execute') end")
        sigs = [f'public.{RPC}(uuid,uuid,uuid,jsonb,text,text,text)', f'public.{QUOTE}(uuid,uuid,uuid,jsonb,text)', f'public.{HIST}(uuid)']
        got = [acl(s) for s in sigs]
        priv = [h.nilai(f"select case when to_regprocedure('{s}') is null then 'missing' else has_function_privilege('authenticated','{s}','execute')::text||'|'||has_function_privilege('anon','{s}','execute') end") for s in
                ('clinic_private.owner_correct_cart_bmhp(uuid,uuid,uuid,jsonb,text,text,text,boolean)', 'clinic_private.owner_bmhp_normalize(jsonb,jsonb,jsonb,boolean)', 'clinic_private.owner_bmhp_sim(uuid,uuid,numeric,text,jsonb)')]
        check('ACL: RPC, quote and history executable by authenticated only (not anon/public/service_role); the private core, normaliser and simulator are executable by nobody',
              got == ['true|false|false|false'] * 3 and priv == ['false|false'] * 3, dict(got=got, priv=priv))
        now_defs = old_defs(h); now_dig = digest(h)
        check('DIGEST: every pre-existing function (definition + ACL), trigger, column, constraint, index, policy, table ACL is IDENTICAL before/after applying the migration (only the new objects are added)',
              pre is not None and pre == now_dig, dict(pre=pre, now=now_dig))
        check('the live cashier save/read/quote/draft, P03, posting, bmhp_issue, BMHP guards, doctor edit and journal writer keep their exact definitions',
              bool(now_defs) and now_defs == PRE_DEFS.get('v'), dict(defs=now_defs, pre=PRE_DEFS.get('v')))
        cand = (MIG / CANDIDATE).read_text() if (MIG / CANDIDATE).exists() else ''
        check('static: the migration redefines none of the live objects (no create/replace of cashier save/read/draft, post invoice, P03, bmhp_issue, the BMHP guards, journal writer)',
              bool(cand) and not any(t in cand.lower() for t in ('function public.clinic_save_inpatient_cashier', 'function public.clinic_read_inpatient_cashier', 'function public.clinic_save_inpatient_cart_draft', 'function public.clinic_post_invoice',
                                                                  'function clinic_private.assert_invoice_price_floor', 'function clinic_private.bmhp_issue', 'function public.guard_prescription_bmhp', 'function public.guard_invoice_item_bmhp',
                                                                  'function public.clinic_write_journal', 'function public.clinic_edit_queued_record')), dict())

    # ------------------------------------------------------------------ concurrency (two real sessions)
    if db is not None and S('races'): races(h, db)


def races(h, db):
    def blocked(obs, sess):
        for _ in range(40):
            w = obs.sql(f"select coalesce(wait_event_type,'')||'/'||coalesce(wait_event,'') from pg_stat_activity where pid={sess.pid};")
            if w and w[-1].startswith('Lock/'): return w[-1]
            time.sleep(0.15)
        return 'NOT BLOCKED'

    def session(name, user):
        s = c.Session(db, name); s.sql(x.claims(user)); return s

    def ovr(rv, comps, key, snapshot):
        return f"select {RPC}({q(rv['stay'])},{q(rv['v'])},{q(rv['rx'])},{j(comps)},'Alasan cukup panjang',{q(key)},{q(snapshot)});"
    # (1) override vs a cashier save in flight (holds the coordinator): the override WAITS, then is refused as stale (rows moved to an invoice); the invoice keeps the ORIGINAL components
    k = cm.bmhp_visit(h, 8170, price=80000); cart = cm.read_cart(h, k); snap_k = cart['snapshot']
    save_k, _ = cm.save_sql(h, k, 'bp-race1-save', [])
    with c.Session(db, 'obs') as obs, session('cashier', r.OWNER) as a, session('override', r.OWNER) as b:
        a.sql('begin;' + save_k); b.send(ovr(k, [comp(LAC, 3.4)], 'bp-race-1', snap_k))
        wait = blocked(obs, b); a.sql('commit;'); res = c.attempt(b, commit=False)
    cm.link(h, k); line = cm.line_row(h, k)
    check('race: override started while a cashier save holds the visit coordinator WAITS (advisory), then is refused (CART_STALE: the row is already invoiced); the invoice keeps the ORIGINAL components 5 @12000',
          wait.endswith('advisory') and not res['ok'] and 'CART_STALE' in str(res) and line and n(line['hpp']) == D('60000.00') and audit_n(h) != '' and not audit_rows(h, k), dict(wait=wait, res=str(res)[:200]))
    # (2) cashier save started while an override is in flight waits, then is refused (CART_STALE), nothing invoiced
    k2 = cm.bmhp_visit(h, 8171, price=80000); snap2 = snapshot_of(h, k2); save2, _ = cm.save_sql(h, k2, 'bp-race2-save', [])
    with c.Session(db, 'obs2') as obs, session('override2', r.OWNER) as a, session('cashier2', r.OWNER) as b:
        a.sql('begin;' + ovr(k2, [comp(LAC, 3.4)], 'bp-race-2', snap2)); b.send(save2)
        wait2 = blocked(obs, b); a.sql('commit;'); res2 = c.attempt(b, commit=False)
    check('race: cashier save started while an override is in flight WAITS (advisory), then is refused (CART_STALE, old snapshot); nothing invoiced; the override is applied once',
          wait2.endswith('advisory') and not res2['ok'] and 'CART_STALE' in str(res2) and h.nilai(f"select count(*) from invoice_items where prescription_item_id={q(k2['rx'])}") == '0' and cm.comps_of(h, k2)[0]['qty'] == 3.4 and len(audit_rows(h, k2)) == 1, dict(wait=wait2, res=str(res2)[:200]))
    # (3) cart DRAFT save vs override
    k3 = cm.bmhp_visit(h, 8172, price=80000); cart3 = cm.read_cart(h, k3)
    draft = f"select clinic_save_inpatient_cart_draft({q(k3['stay'])},{q(k3['v'])},'bp-race3-draft',{q(cart3['snapshot'])},{j(cart3['rows'])},'Draft uji');"
    with c.Session(db, 'obs3') as obs, session('override3', r.OWNER) as a, session('draft3', r.OWNER) as b:
        a.sql('begin;' + ovr(k3, [comp(LAC, 3.4)], 'bp-race-3', cart3['snapshot'])); b.send(draft)
        wait3 = blocked(obs, b); a.sql('commit;'); res3 = c.attempt(b, commit=False)
    check('race: cart draft save started while an override is in flight WAITS (advisory), then is refused (CART_STALE); the override stays',
          wait3.endswith('advisory') and not res3['ok'] and 'CART_STALE' in str(res3) and cm.comps_of(h, k3)[0]['qty'] == 3.4, dict(wait=wait3, res=str(res3)[:200]))
    # (4) two identical requests at once: one effect
    k4 = cm.bmhp_visit(h, 8173, price=80000); snap4 = snapshot_of(h, k4); s40 = snap(h, k4)
    with c.Session(db, 'obs4') as obs, session('twin-a', r.OWNER) as a, session('twin-b', r.OWNER) as b:
        a.sql('begin;' + ovr(k4, [comp(LAC, 3.4)], 'bp-twin', snap4)); b.send(ovr(k4, [comp(LAC, 3.4)], 'bp-twin', snap4))
        wait4 = blocked(obs, b); a.sql('commit;'); res4 = c.attempt(b, commit=False)
    s41 = snap(h, k4)
    check('race: two identical requests at once apply ONCE (second waits, returns the stored result): one audit row, one cart-edit row, components 3.4',
          wait4.endswith('advisory') and res4['ok'] and 'replayed' in str(res4) and int(s41['audit']) == int(s40['audit']) + 1 and int(s41['cartaudit']) == int(s40['cartaudit']) + 1 and cm.comps_of(h, k4)[0]['qty'] == 3.4, dict(wait=wait4, res=str(res4)[:200]))
    # (5) override vs an Owner racikan correction on ANOTHER racikan of the same visit: serialised through the same coordinator, no deadlock, both apply
    try:
        prep_base(h)
        rk = base.racik_visit(h, 8174 + cm.OFF, price=80000)
        cm.fresh(h, LAC, 70)
        mine = r.uid(9, (8174 + cm.OFF) * 10 + 7)
        h.sql(f"insert into public.prescription_items(id,medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,jenis,kategori,bmhp_components) values ({q(mine)},{q(rk['mr'])},{q(cm.NAMES[PROC])},{q(PROC)},1,'kali',1,80000,'obat','Tindakan',{q(json.dumps([comp(LAC, 5)]))}::jsonb);")
        rv = dict(v=rk['v'], stay=rk['stay'], rx=mine, n=8174)
        snap5 = snapshot_of(h, rv)
        racsql = f"select clinic_owner_correct_compound({q(rk['recipe'])},{j(base.ing(2, 2))},'Koreksi racikan uji','bp-race5-rk');"
        with c.Session(db, 'obs5') as obs, session('override5', r.OWNER) as a, session('racikan5', r.OWNER) as b:
            a.sql('begin;' + ovr(rv, [comp(LAC, 3.4)], 'bp-race-5', snap5)); b.send(racsql)
            wait5 = blocked(obs, b); a.sql('commit;'); res5 = c.attempt(b, commit=False)
        check('race: an Owner racikan correction started while an override is in flight WAITS (advisory), then applies; the override stays (same coordinator, no deadlock)',
              wait5.endswith('advisory') and res5['ok'] and cm.comps_of(h, rv)[0]['qty'] == 3.4 and h.nilai(f"select count(*) from clinic_private.owner_compound_corrections where recipe_id={q(rk['recipe'])}") == '1', dict(wait=wait5, res=str(res5)[:200]))
    except RuntimeError as e:
        check('race 5 fixture (override vs racikan)', False, str(e)[:300])


def apply_candidate(db, text): db.sql('begin;\n' + text + '\ncommit;')


class Attached(r.NativePostgres):
    def __init__(self, bin_dir, root):
        super().__init__(bin_dir); self.root = Path(root); self.as_user = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
    def __enter__(self): return self
    def __exit__(self, *_): return None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin'); ap.add_argument('--attach')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only', help='comma-separated substrings: run only mutants whose name contains one'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    extra = {}
    cand_path = MIG / CANDIDATE
    try:
        if a.attach:
            with Attached(r.BIN, a.attach) as db:
                name = 'bp_dev_%d' % int(time.time()); db.sql(f'create database {name} template postgres;'); os.environ['PGDATABASE'] = name
                h = x.Harness(db); PRE_DEFS['v'] = old_defs(h); PRE_DEFS['p03'] = h.nilai("select md5(pg_get_functiondef('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure))"); pre = digest(h)
                if not a.baseline: apply_candidate(db, cand_path.read_text())
                run(h, db, setup=False, baseline=a.baseline, pre=pre)
        elif a.mutations:
            from importlib.machinery import SourceFileLoader
            mut = SourceFileLoader('mut', str(ROOT / 'scripts/test-owner-bmhp-pending-mutants.py')).load_module()
            with r.NativePostgres(r.BIN) as db:
                base.build(db, {CANDIDATE, LATER}); h = x.Harness(db); x.setup(h); PRE_DEFS['v'] = old_defs(h); PRE_DEFS['p03'] = h.nilai("select md5(pg_get_functiondef('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure))"); pre = digest(h)
                cand = cand_path.read_text(); plan = [('M0 control (unmodified candidate)', cand)]; extra['mutants'] = {}
                secs = {}
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
                    global SECTIONS
                    SECTIONS = secs.get(name)
                    os.environ.pop('PGDATABASE', None)
                    db.sql(f'create database v{i} template postgres'); os.environ['PGDATABASE'] = f'v{i}'; cm.OFF = 100 * i; base.OFF = 100 * i
                    before = len(RESULTS); crash = None
                    try:
                        apply_candidate(db, text); run(h, db, setup=False, pre=pre)
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
                base.build(db, {CANDIDATE, LATER}); h = x.Harness(db); x.setup(h); PRE_DEFS['v'] = old_defs(h); PRE_DEFS['p03'] = h.nilai("select md5(pg_get_functiondef('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure))"); pre = digest(h)
                if not a.baseline: apply_candidate(db, cand_path.read_text())
                run(h, db, setup=False, baseline=a.baseline, pre=pre)
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(cc['status'] == s for cc in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='mutations' if a.mutations else 'RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
