#!/usr/bin/env python3
"""OWNER corrects the ingredient quantities of a racikan that is ALREADY on an invoice line (paid or unpaid):
the same invoice line's HPP is recomputed in place, a delta HPP journal dated today is posted, the selling price/total/payments
stay untouched (migration 20261107160000_owner_koreksi_racikan_tagihan.sql, Bella case INV-202611-0089 / INV-202611-0099).

Native full schema, fictional fixtures, throwaway local cluster, no network.
  flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-owner-koreksi-racikan-tagihan-postgres.py --pg-bin DIR --json out.json
  --baseline    chain WITHOUT the candidate migration: every new-RPC case must FAIL (RED), the 'live RPC refuses' cases PASS
  --mutations   chain without the candidate once, then each mutant (scripts/test-owner-koreksi-racikan-tagihan-mutants.py) in a cloned database
  --attach DIR  dev only: clone of the `postgres` DB (chain WITHOUT candidate, x.setup done) in a running cluster, candidate applied on top
The 67 cases of scripts/test-owner-koreksi-racikan-postgres.py (migration 120000) are run separately on the full chain (same script, unchanged).
"""
import argparse, hashlib, importlib.util, json, os, sys, time
from decimal import Decimal
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('okr_base', ROOT / 'scripts/test-owner-koreksi-racikan-postgres.py'); assert spec and spec.loader
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
x, r, q, j, c = base.x, base.r, base.q, base.j, base.c
MA, MB, MC = base.MA, base.MB, base.MC
CANDIDATE = '20261107160000_owner_koreksi_racikan_tagihan.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = []
OFF = 0
RPC = 'clinic_owner_correct_compound_invoiced'
QUOTE = 'clinic_owner_compound_invoiced_correction_quote'
LIVE = 'clinic_owner_correct_compound'          # the 120000 RPC: must stay byte-identical
NEWTAB = 'clinic_private.owner_compound_invoice_corrections'
NEW_NAMES = ('owner_correct_compound_invoiced', RPC, QUOTE)
D = Decimal


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:420], flush=True)


def J(s): return json.loads(s, parse_float=Decimal)
def err_has(err, *words): return bool(err) and all(w in err for w in words)


DIGEST_SQL = """select count(*)||'|'||md5(string_agg(k, E'\\n' order by k)) from (
 select 'f:'||p.oid::regprocedure::text||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'') as k
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private') and p.prokind in ('f','p') and p.proname <> all(%s)
 union all select 't:'||t.tgrelid::regclass::text||':'||pg_get_triggerdef(t.oid) from pg_trigger t
   where not t.tgisinternal and t.tgrelid::regclass::text not like '%%owner_compound_invoice_corrections'
 union all select 'c:'||table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,'')||':'||is_nullable from information_schema.columns
   where table_schema in ('public','clinic_private') and table_name <> 'owner_compound_invoice_corrections'
 union all select 'r:'||c.oid::regclass::text||':'||coalesce(c.relacl::text,'')||':'||c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','clinic_private') and c.relkind in ('r','v','S','m') and c.relname <> 'owner_compound_invoice_corrections'
 union all select 'k:'||conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace in ('public'::regnamespace,'clinic_private'::regnamespace) and conrelid::regclass::text not like '%%owner_compound_invoice_corrections'
 union all select 'i:'||indexdef from pg_indexes where schemaname in ('public','clinic_private') and tablename <> 'owner_compound_invoice_corrections'
 union all select 'p:'||tablename||':'||policyname||':'||coalesce(qual,'')||coalesce(with_check,'') from pg_policies where schemaname in ('public','clinic_private')
) z"""


def digest(h):
    names = '{' + ','.join(NEW_NAMES) + '}'
    return h.nilai(DIGEST_SQL % q(names))


def old_defs(h):
    """md5 of the live 120000 objects that must stay byte-identical."""
    return h.nilai("select md5(string_agg(pg_get_functiondef(p::regprocedure), E'\\n' order by p)) from unnest(array["
                   "'public.clinic_owner_correct_compound(uuid,jsonb,text,text)','clinic_private.owner_correct_compound(uuid,jsonb,text,text,boolean)',"
                   "'public.clinic_owner_compound_correction_quote(uuid,jsonb)','public.clinic_adjust_compound(uuid,jsonb,text)',"
                   "'clinic_private.assert_compound_adjustable(uuid,uuid)','clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)',"
                   "'public.clinic_post_invoice(uuid,text,jsonb,jsonb)','public.clinic_write_journal(date,text,text,text,uuid,jsonb)',"
                   "'public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)']) p")


# ---------------------------------------------------------------------------------------------------------------- fixtures
def save(h, rv, key, parts, price_user=r.OWNER):
    cart = base.read_cart(h, rv)
    err = h.gagal(f"select clinic_save_inpatient_cashier({q(rv['stay'])},{q(rv['v'])},{q(key + str(base.OFF))},'2026-11-03',{q(cart['snapshot'])},{j(cart['rows'])},{j(parts)},null,false,null,'Kasir Fiktif');", price_user)
    return err, cart


def link(h, rv):
    """Look up the invoice line / invoice of a racikan after the cashier saved it."""
    rv['line'] = h.nilai(f"select id from invoice_items where compound_recipe_id={q(rv['recipe'])}") or None
    rv['inv'] = h.nilai(f"select invoice_id from invoice_items where compound_recipe_id={q(rv['recipe'])}") or None
    rv['no'] = h.nilai(f"select i.invoice_no from invoices i join invoice_items ii on ii.invoice_id=i.id where ii.compound_recipe_id={q(rv['recipe'])}") or None
    return rv


def inv_visit(h, n, price=80000, paid=False, second=None):
    """Bella shape: ranap visit WITH a DP first stage invoice; racikan issued afterwards at FIFO cost A 2@12000 + B 1@8700.50 + 2@9100.25 (HPP 50901.00),
    then saved by the cashier into ITS OWN stage invoice (Belum Lunas without payment, or Lunas with a payment row when paid=True)."""
    rv = base.racik_visit(h, n, price=price)
    cart = base.read_cart(h, rv)
    err, _ = save(h, rv, f'okrt-save-{n}', [dict(method='Tunai', amount=cart['quote']['remaining'])] if paid else [])
    if err: raise RuntimeError('fixture save failed: ' + err[:300])
    link(h, rv)
    if second:   # a second racikan of the same visit on a second invoice (INV-0089 / INV-0099 of the live case)
        rv2 = base.issue_racikan(h, rv['v'], rv['mr'], n, f'okr-second-{n + base.OFF}', second)
        err, _ = save(h, rv2, f'okrt-save2-{n}', [])
        if err: raise RuntimeError('fixture save #2 failed: ' + err[:300])
        link(h, rv2); rv['second'] = rv2
    return rv


def snap(h, rv):
    """Everything the correction may or may not touch, as one comparable value (extends the 120000 suite's state)."""
    s = base.state(h, rv)
    s['line'] = json.loads(h.nilai(f"select coalesce(to_jsonb(ii),'null') from invoice_items ii where compound_recipe_id={q(rv['recipe'])}"))
    s['items'] = json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(ii) - 'hpp' order by ii.id),'[]') from invoice_items ii where invoice_id={q(rv['inv'])}")) if rv.get('inv') else []
    s['jr'] = J(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_array(e.source,e.tanggal,a.code,l.debit,l.credit) order by e.created_at,e.no_jurnal,l.debit desc,a.code),'[]') "
                        f"from journal_entries e join journal_lines l on l.entry_id=e.id join coa_accounts a on a.id=l.account_id where e.source_ref={q(rv['no'])}")) if rv.get('no') else []
    s['audit2'] = int(h.nilai(f"select case when to_regclass('{NEWTAB}') is null then 0 else (xpath('/row/c/text()',query_to_xml('select count(*) as c from {NEWTAB}',false,true,'')))[1]::text::int end"))
    s['points'] = h.nilai(f"select points from customers where id=(select customer_id from visits where id={q(rv['v'])})")
    s['jall'] = int(h.nilai('select count(*) from journal_entries'))
    return s


def pay_sql(h, rv, key, amount=None):
    """Stage invoices are paid through the ranap cashier (clinic_receive_invoice_payment refuses them with STAGE_RECEIPT): save with no pending rows + a payment part."""
    cart = base.read_cart(h, rv); amount = cart['quote']['remaining'] if amount is None else amount
    return f"select clinic_save_inpatient_cashier({q(rv['stay'])},{q(rv['v'])},{q(key + str(base.OFF))},'2026-11-03',{q(cart['snapshot'])},{j(cart['rows'])},{j([dict(method='Tunai', amount=amount)])},null,false,null,'Kasir Fiktif');"


def corr(h, rv, ings, reason='Bahan racikan disesuaikan setelah ditimbang ulang', key=None, user=r.OWNER, fn=RPC, recipe=None):
    key = key or 'kt-%s-%s' % (rv['n'] + base.OFF, hashlib.md5((json.dumps(ings, sort_keys=True) + reason).encode()).hexdigest()[:8])
    try:
        return None, json.loads(h.nilai(f"select {fn}({q(recipe or rv['recipe'])},{j(ings)},{q(reason)},{q(key)});", user))
    except RuntimeError as e:
        return str(e), None


def hpp_of(h, recipe): return base.hpp_of(h, recipe)
def qread(h, rv, ings):
    """Quote result or None (an error is reported by the checks that use it, never a harness crash)."""
    try: return J(h.nilai(f"select {QUOTE}({q(rv['recipe'])},{j(ings)});", r.OWNER))
    except RuntimeError: return None


def line_hpp(h, rv): return D(h.nilai(f"select hpp from invoice_items where compound_recipe_id={q(rv['recipe'])}"))
def ing(a=None, b=None, c_=None): return base.ing(a, b, c_)
def new_rows(after, before): return after[len(before):] if after[:len(before)] == before else after   # journal lines are ordered by creation; duplicates by value are legal


def audit_rows(h, rv):
    if h.nilai(f"select to_regclass('{NEWTAB}') is not null") != 't': return []
    return json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(a) order by created_at,id),'[]') from {NEWTAB} a where recipe_id={q(rv['recipe'])}"))


def jsum(jr):   # net HPP booked (600001 debit - credit) by 'klinik-hpp' + 'klinik-hpp-edit' of one invoice
    return sum((row[3] - row[4]) for row in jr if row[2] == '600001' and row[0] in ('klinik-hpp', 'klinik-hpp-edit'))


def run(h, db=None, setup=True, baseline=False, pre=None):
    if setup: x.setup(h)
    base.prep(h)
    today = h.nilai('select current_date')
    # ------------------------------------------------------------------ preflight: the new objects (RED = absent)
    objs = h.nilai(f"select concat_ws('|', to_regprocedure('public.{RPC}(uuid,jsonb,text,text)') is not null, to_regprocedure('public.{QUOTE}(uuid,jsonb)') is not null, "
                   f"to_regprocedure('clinic_private.owner_correct_compound_invoiced(uuid,jsonb,text,text,boolean)') is not null, to_regclass('{NEWTAB}') is not null)")
    check('preflight: the new RPC, quote, private core and audit table exist', objs == 't|t|t|t', dict(objs=objs))

    # ------------------------------------------------------------------ fixture mirroring Bella: racikan on an UNPAID invoice line
    a = inv_visit(h, 6101); s0 = snap(h, a)
    inv0 = h.nilai(f"select paid_status||'|'||total||'|'||(select count(*) from invoice_payments p where p.invoice_id=i.id) from invoices i where id={q(a['inv'])}")
    posted = h.nilai(f"select count(*)||'|'||count(posted_invoice_item_id) from compound_issues where recipe_id={q(a['recipe'])}")
    hj = [row for row in s0['jr'] if row[0] == 'klinik-hpp']
    check('fixture (Bella shape): racikan on its own UNPAID invoice line (Belum Lunas, no payment), HPP 50901.00 = journal, price 80000, all 3 issue rows linked to the line',
          inv0 == 'Belum Lunas|80000.00|0' and s0['line']['hpp'] == 50901.0 and s0['line']['harga'] == 80000.0 and posted == '3|3' and jsum(s0['jr']) == D('50901.00')
          and hj and D('50901.00') in [row[3] for row in hj], dict(inv=inv0, posted=posted, jr=s0['jr'][-2:]))
    err = h.gagal(f"select {LIVE}({q(a['recipe'])},{j(ing(2, 2))},'Koreksi uji alasan','okrt-live-1');", r.OWNER)
    check('RED: the live clinic_owner_correct_compound refuses the invoiced racikan (RECIPE_LINKED: sudah masuk invoice), nothing changes', err_has(err, 'RECIPE_LINKED', 'sudah masuk invoice') and snap(h, a) == s0, dict(error=(err or '')[:160]))
    err = h.gagal(f"select clinic_adjust_compound({q(a['recipe'])},{j(ing(2, 2))},'Koreksi uji');", r.OWNER)
    check('RED: the old clinic_adjust_compound refuses as well (RECIPE_LINKED / INVOICE_PAID)', bool(err) and ('RECIPE_LINKED' in err or 'INVOICE_PAID' in err), dict(error=(err or '')[:120]))

    # ------------------------------------------------------------------ GREEN: owner lowers ingredient B of the invoiced racikan (unpaid invoice)
    err, res = corr(h, a, ing(2, 2), key='okrt-a-1')
    s1 = snap(h, a); hnew = hpp_of(h, a['recipe'])
    check('GREEN owner lowers B 3 -> 2 on the UNPAID invoice line: ok, HPP 50901.00 -> 41800.75 (restored layer at its own cost 9100.25)',
          err is None and hnew == D('41800.75') and res and D(str(res['cost_before'])) == D('50901.00') and D(str(res['cost_after'])) == D('41800.75'), dict(error=(err or '')[:300], hnew=str(hnew)))
    check('the SAME invoice line hpp is recomputed in place to the cent: line id unchanged, hpp 41800.75 == sum(compound_issues qty*unit_cost); harga, qty, deskripsi, satuan untouched',
          s1['line'] and s1['line']['id'] == s0['line']['id'] and D(str(s1['line']['hpp'])) == D('41800.75') == hnew
          and {k: v for k, v in s1['line'].items() if k != 'hpp'} == {k: v for k, v in s0['line'].items() if k != 'hpp'}, dict(line=s1['line']))
    iss = [i for i in s1['issues']]; b1 = [i for i in iss if i[0] == MB]
    check('compound_issues consistent AND linked: A rows identical, B = 1 @ 8700.50 + 1 @ 9100.25, every row keeps posted_invoice_item_id = the line, none restored',
          sorted((float(i[1]), float(i[2])) for i in b1) == [(1.0, 8700.5), (1.0, 9100.25)] and all(i[5] == a['line'] and i[6] is None for i in iss)
          and [i for i in iss if i[0] == MA] == [i for i in s0['issues'] if i[0] == MA], dict(issues=iss))
    new_layers = [l for l in s1['layers'] if l not in s0['layers']]
    check('stock: ONLY the delta moves: B +1, A and C untouched, one racik-koreksi layer 1 @ 9100.25 dated today, one stock move',
          float(s1['stock'][MB]) - float(s0['stock'][MB]) == 1 and s1['stock'][MA] == s0['stock'][MA] and s1['stock'][MC] == s0['stock'][MC]
          and len(new_layers) == 1 and new_layers[0][1] == today and float(new_layers[0][2]) == 1 and float(new_layers[0][3]) == 1 and float(new_layers[0][4]) == 9100.25 and new_layers[0][5] == 'racik-koreksi'
          and s1['moves'] == s0['moves'] + 1, dict(new=new_layers, moves=(s0['moves'], s1['moves'])))
    dj = new_rows(s1['jr'], s0['jr'])
    check('delta journal: exactly ONE new entry dated today, source klinik-hpp-edit on the invoice number, HPP decrease = Dr 170001 / Cr 600001 9100.25, balanced; original journals untouched',
          s1['jall'] == s0['jall'] + 1 and sorted(dj) == sorted([['klinik-hpp-edit', today, '170001', D('9100.25'), D('0.00')], ['klinik-hpp-edit', today, '600001', D('0.00'), D('9100.25')]])
          and s1['jr'][:len(s0['jr'])] == s0['jr'] and sum(row[3] for row in dj) == sum(row[4] for row in dj), dict(dj=dj))
    check('journal vs line to the cent: net HPP booked on the invoice (klinik-hpp + klinik-hpp-edit) == the invoice HPP sum (41800.75 + 0 for the other lines of that invoice)',
          jsum(s1['jr']) == D(h.nilai(f"select coalesce(sum(hpp),0) from invoice_items where invoice_id={q(a['inv'])}")) == D('41800.75'), dict(net=str(jsum(s1['jr']))))
    check('invoice total/price/paid amounts UNCHANGED: invoice rows, other lines, payments, receipts, DP, prescription harga, master sale_price, recipe row, customer points identical',
          s1['invoice_rows'] == s0['invoice_rows'] and s1['items'] == s0['items'] and s1['payments'] == s0['payments'] and s1['receipts'] == s0['receipts'] and s1['harga'] == s0['harga'] == 80000
          and s1['sale'] == s0['sale'] and s1['recipe'] == s0['recipe'] and s1['points'] == s0['points'] and s1['invoices'] == s0['invoices'], dict(inv=s1['invoice_rows'] == s0['invoice_rows']))
    au = audit_rows(h, a)
    check('audit row: who / when / invoice+line / paid status / before+after ingredients / hpp before+after+delta / journal id / reason / request_key / stock effects',
          len(au) == 1 and au[0]['actor_id'] == r.OWNER and au[0]['invoice_id'] == a['inv'] and au[0]['invoice_item_id'] == a['line'] and au[0]['invoice_no'] == a['no'] and au[0]['paid_status'] == 'Belum Lunas'
          and D(str(au[0]['hpp_before'])) == D('50901.00') and D(str(au[0]['hpp_after'])) == D('41800.75') and D(str(au[0]['hpp_delta'])) == D('-9100.25') and D(str(au[0]['price'])) == D('80000.00')
          and au[0]['reason'].startswith('Bahan racikan disesuaikan') and au[0]['request_key'] == 'okrt-a-1' and au[0]['visit_id'] == a['v'] and au[0]['created_at'] and au[0]['stock_effects']
          and [i for i in au[0]['before_ingredients'] if i['item_id'] == MB][0]['quantity'] == 3 and [i for i in au[0]['after_ingredients'] if i['item_id'] == MB][0]['quantity'] == 2
          and au[0]['journal_entry_id'] == h.nilai(f"select id from journal_entries where source='klinik-hpp-edit' and source_ref={q(a['no'])}"), dict(au=au[:1]))
    # replay
    err1, res1 = corr(h, a, ing(2, 2), key='okrt-a-1')
    check('replay: same request_key + same payload is idempotent (stored result, no second movement, no second journal, one audit row)', err1 is None and res1 and res1.get('replayed') is True and snap(h, a) == s1, dict(error=(err1 or '')[:160]))
    err2, _ = corr(h, a, ing(2, 1), key='okrt-a-1')
    check('replay with a DIFFERENT payload under the same key is refused (IDEMPOTENCY_CONFLICT), nothing changes', err_has(err2, 'IDEMPOTENCY_CONFLICT') and snap(h, a) == s1, dict(error=(err2 or '')[:160]))
    # the live RPC is not loosened and still refuses after the new RPC acted
    err3 = h.gagal(f"select {LIVE}({q(a['recipe'])},{j(ing(2, 1))},'Koreksi uji alasan','okrt-live-2');", r.OWNER)
    check('the LIVE clinic_owner_correct_compound still refuses the invoiced racikan (not loosened)', err_has(err3, 'RECIPE_LINKED'), dict(error=(err3 or '')[:120]))
    # second correction of the same line: reverse-FIFO again; journals chain
    err, res = corr(h, a, ing(2, 1), key='okrt-a-2'); s2 = snap(h, a)
    dj2 = new_rows(s2['jr'], s1['jr'])
    check('second correction of the same line (B 2 -> 1): HPP 41800.75 -> 32700.50 (the 9100.25 layer comes back first), second delta journal 9100.25, net journal still == line hpp',
          err is None and line_hpp(h, a) == D('32700.50') == hpp_of(h, a['recipe']) and len(dj2) == 2 and jsum(s2['jr']) == D('32700.50') and all(i[5] == a['line'] for i in s2['issues']) and len(audit_rows(h, a)) == 2
          and h.nilai(f"select count(*) from journal_entries where source='klinik-hpp-edit' and source_ref={q(a['no'])}") == '2', dict(error=(err or '')[:200], line=str(line_hpp(h, a)), hpp=str(hpp_of(h, a['recipe'])), dj2=dj2, net=str(jsum(s2['jr'])), linked=[i[5] == a['line'] for i in s2['issues']], audits=len(audit_rows(h, a))))

    # ------------------------------------------------------------------ increase (new issues at current FIFO stay linked to the line, journal debits HPP)
    b = inv_visit(h, 6102); sb0 = snap(h, b)
    qj = qread(h, b, ing(4, 3))
    err, res = corr(h, b, ing(4, 3), key='okrt-b-1'); sb1 = snap(h, b); djb = new_rows(sb1['jr'], sb0['jr'])
    check('GREEN increase A 2 -> 4: 2 more issued at current FIFO @12000: HPP 50901.00 -> 74901.00; new issue rows linked to the same line; journal Dr 600001 / Cr 170001 24000.00',
          err is None and line_hpp(h, b) == D('74901.00') == hpp_of(h, b['recipe']) and all(i[5] == b['line'] and i[6] is None for i in sb1['issues'])
          and sum(float(i[1]) for i in sb1['issues'] if i[0] == MA) == 4 and float(sb1['stock'][MA]) == float(sb0['stock'][MA]) - 2
          and sorted(djb) == sorted([['klinik-hpp-edit', today, '600001', D('24000.00'), D('0.00')], ['klinik-hpp-edit', today, '170001', D('0.00'), D('24000.00')]])
          and jsum(sb1['jr']) == D('74901.00') and sb1['invoice_rows'] == sb0['invoice_rows'], dict(error=(err or '')[:240], djb=djb))
    qj = qj or {}
    check('quote of the same correction (taken before): HPP 50901.00 -> 74901.00, delta +24000.00, journal preview Dr 600001/Cr 170001 dated today, invoice no, line price, price not below HPP',
          qj and D(str(qj['cost_before'])) == D('50901.00') and D(str(qj['cost_after'])) == D('74901.00') and D(str(qj['hpp_delta'])) == D('24000.00') and qj['invoice_no'] == b['no']
          and qj['price_below_hpp_after'] is False and qj['price_below_hpp_before'] is False and D(str(qj['price'])) == D('80000.00') and qj['paid_status'] == 'Belum Lunas'
          and qj['journal']['date'] == today and sorted((l['code'], D(str(l['debit'])), D(str(l['credit']))) for l in qj['journal']['lines']) == [('170001', D('0'), D('24000.00')), ('600001', D('24000.00'), D('0'))], dict(q=qj))

    # ------------------------------------------------------------------ HPP above the price: allowed + reported (P03 semantics untouched)
    p3 = inv_visit(h, 6103); sp0 = snap(h, p3)
    qr = qread(h, p3, ing(5, 3)) or {}
    err, res = corr(h, p3, ing(5, 3), key='okrt-p3-1'); sp1 = snap(h, p3)
    check('HPP pushed above the price (A 2 -> 5: 86901.00 > 80000): the correction is applied and REPORTED (price_below_hpp_after true, before false), journal +36000.00; the price/total are not touched',
          err is None and res and res['price_below_hpp_after'] is True and res['price_below_hpp_before'] is False and line_hpp(h, p3) == D('86901.00') and jsum(sp1['jr']) == D('86901.00')
          and sp1['line']['harga'] == 80000.0 and sp1['invoice_rows'] == sp0['invoice_rows'] and qr.get('price_below_hpp_after') is True, dict(error=(err or '')[:200], res=str(res)[:200]))
    chk = h.nilai("select md5(pg_get_functiondef('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure))")
    q2 = base.racik_visit(h, 6104, price=50000)
    e2, _ = save(h, q2, 'okrt-p03-new', [])
    e3, _ = corr(h, q2, ing(2, 2), key='okrt-p03-2')
    check('P03 floor intact for NEW postings: a racikan priced below its HPP is still refused at the cashier (PRICE_BELOW_HPP) and the new RPC refuses a racikan that is not on an invoice line (NOT_INVOICED)',
          err_has(e2, 'PRICE_BELOW_HPP') and err_has(e3, 'NOT_INVOICED') and h.nilai(f"select count(*) from invoice_items where compound_recipe_id={q(q2['recipe'])}") == '0', dict(e2=(e2 or '')[:120], e3=(e3 or '')[:160]))
    e4 = h.gagal(pay_sql(h, p3, 'okrt-p3-pay'), r.OWNER)
    check('payment on the corrected unpaid invoice behaves exactly as before the correction (the floor is judged at posting/edit, not at receipt): accepted, invoice Lunas, line hpp kept',
          e4 is None and h.nilai(f"select paid_status from invoices where id={q(p3['inv'])}") == 'Lunas' and line_hpp(h, p3) == D('86901.00'), dict(error=(e4 or '')[:200]))

    # the price-below-HPP flag uses the P03 net price: line amount x the invoice discount share
    dsc = inv_visit(h, 6180)
    h.sistem(f"update invoices set discount=40000,total=40000 where id={q(dsc['inv'])};")
    err, res = corr(h, dsc, ing(1, 3), key='okrt-disc-1')
    check('price flags use the P03 net price (line 80000 x invoice discount share 0.5 = 40000): before 40000 < 50901 true, after A 2 -> 1 (HPP 38901.00) false; total untouched',
          err is None and res and D(str(res['net_price'])) == D('40000.00') and res['price_below_hpp_before'] is True and res['price_below_hpp_after'] is False and line_hpp(h, dsc) == D('38901.00')
          and D(h.nilai(f"select total from invoices where id={q(dsc['inv'])}")) == D('40000'), dict(error=(err or '')[:200], res=str(res)[:200]))

    # ------------------------------------------------------------------ mixed: A up, C added, B removed
    m = inv_visit(h, 6105); sm0 = snap(h, m)
    err, res = corr(h, m, ing(a=3, c_=4), key='okrt-m-1'); sm1 = snap(h, m); djm = new_rows(sm1['jr'], sm0['jr'])
    check('mixed: A 2 -> 3 (+1 @12000), C added 4 @500, B removed (3 restored): HPP 50901.00 -> 38000.00, delta -12901.00, every row (incl. new A and C rows) linked to the line, B rows gone, exact stock',
          err is None and line_hpp(h, m) == D('38000.00') == hpp_of(h, m['recipe']) and all(i[5] == m['line'] and i[6] is None for i in sm1['issues']) and not [i for i in sm1['issues'] if i[0] == MB]
          and sum(float(i[1]) for i in sm1['issues'] if i[0] == MA) == 3 and sum(float(i[1]) for i in sm1['issues'] if i[0] == MC) == 4
          and float(sm1['stock'][MA]) == float(sm0['stock'][MA]) - 1 and float(sm1['stock'][MC]) == float(sm0['stock'][MC]) - 4 and float(sm1['stock'][MB]) == float(sm0['stock'][MB]) + 3
          and sorted(djm) == sorted([['klinik-hpp-edit', today, '170001', D('12901.00'), D('0.00')], ['klinik-hpp-edit', today, '600001', D('0.00'), D('12901.00')]]) and jsum(sm1['jr']) == D('38000.00'),
          dict(error=(err or '')[:240], djm=djm))

    # ------------------------------------------------------------------ PAID invoice (Lunas + payment row): same behavior, money untouched
    pd = inv_visit(h, 6106, paid=True); spd0 = snap(h, pd)
    pst = h.nilai(f"select paid_status||'|'||(select count(*) from invoice_payments p where p.invoice_id=i.id) from invoices i where id={q(pd['inv'])}")
    err, res = corr(h, pd, ing(2, 2), key='okrt-paid-1'); spd1 = snap(h, pd)
    check('fixture: the racikan invoice is Lunas with a payment row; GREEN owner correction works: HPP 41800.75, journal -9100.25; invoices, payments, receipts, cash journals, paid_at untouched',
          pst == 'Lunas|1' and err is None and line_hpp(h, pd) == D('41800.75') and spd1['invoice_rows'] == spd0['invoice_rows'] and spd1['payments'] == spd0['payments'] and spd1['receipts'] == spd0['receipts']
          and [row for row in spd1['jr'] if row[0] != 'klinik-hpp-edit'] == spd0['jr'] and len(new_rows(spd1['jr'], spd0['jr'])) == 2 and jsum(spd1['jr']) == D('41800.75')
          and res and res['paid_status'] == 'Lunas', dict(pst=pst, error=(err or '')[:200]))

    # ------------------------------------------------------------------ Bella: two racikan, two invoices, same visit
    bl = inv_visit(h, 6107, price=80000, second=90000); b2 = bl['second']; sbl0 = snap(h, bl); sb20 = snap(h, b2)
    check('fixture (Bella): ONE visit, TWO racikan each on its own unpaid invoice line (different invoices)', bl['inv'] and b2['inv'] and bl['inv'] != b2['inv'] and bl['no'] != b2['no'], dict(a=bl['no'], b=b2['no']))
    err, _ = corr(h, bl, ing(2, 2), key='okrt-bl-1'); sbl1 = snap(h, bl); sb21 = snap(h, b2)
    check('Bella #1: correcting racikan 1 changes only ITS line/invoice/journal; racikan 2 (state, line, invoice, journals) is untouched', err is None and line_hpp(h, bl) == D('41800.75') and sb21['line'] == sb20['line'] and sb21['issues'] == sb20['issues']
          and sb21['invoice_rows'] == sb20['invoice_rows'] and sb21['jr'] == sb20['jr'], dict(error=(err or '')[:200]))
    err, _ = corr(h, b2, ing(a=3, c_=4), key='okrt-bl-2'); sb22 = snap(h, b2)
    check('Bella #2: correcting racikan 2 independently posts its own delta journal on ITS invoice number (38000.00), racikan 1 line stays 41800.75',
          err is None and line_hpp(h, b2) == D('38000.00') and line_hpp(h, bl) == D('41800.75') and jsum(sb22['jr']) == D('38000.00') and snap(h, bl)['jr'] == sbl1['jr'], dict(error=(err or '')[:200]))

    # ------------------------------------------------------------------ period / date: the journal is dated TODAY
    pl = inv_visit(h, 6108); spl = snap(h, pl)
    h.sistem("update accounting_locks set closed_until='2026-11-03' where id;")     # invoice date locked, today open: allowed (journal is dated today)
    err, _ = corr(h, pl, ing(2, 2), key='okrt-lock-old'); h.sistem('update accounting_locks set closed_until=null where id;')
    check('period locked up to the INVOICE date (today still open): allowed, the delta journal is dated today', err is None and new_rows(snap(h, pl)['jr'], spl['jr']) and all(row[1] == today for row in new_rows(snap(h, pl)['jr'], spl['jr'])), dict(error=(err or '')[:200]))
    nl = inv_visit(h, 6109); sn0 = snap(h, nl)
    h.sistem('update accounting_locks set closed_until=current_date where id;')
    err, _ = corr(h, nl, ing(2, 2), key='okrt-lock-today'); qerr = None
    try: h.nilai(f"select {QUOTE}({q(nl['recipe'])},{j(ing(2, 2))});", r.OWNER)
    except RuntimeError as e: qerr = str(e)
    h.sistem('update accounting_locks set closed_until=null where id;')
    check('NEG accounting period locked up to TODAY refused (Periode akuntansi ... ditutup), also in the quote, nothing changed', err_has(err, 'Periode akuntansi') and err_has(qerr, 'Periode akuntansi') and snap(h, nl) == sn0, dict(error=(err or '')[:200]))
    h.sistem('update inventory_costing_settings set closed_through=current_date where id;')
    err, _ = corr(h, nl, ing(2, 2), key='okrt-lock-inv'); h.sistem('update inventory_costing_settings set closed_through=null where id;')
    check('NEG inventory period closed through today refused (Periode persediaan ... ditutup), nothing changed', err_has(err, 'Periode persediaan') and snap(h, nl) == sn0, dict(error=(err or '')[:200]))

    # ------------------------------------------------------------------ negatives: role / branch / reason / payload - never a partial effect
    n1 = inv_visit(h, 6120); sn1 = snap(h, n1)
    for label, user in (('ADMIN', r.ADMIN), ('DOCTOR', r.DOCTOR), ('STAFF', r.STAFF), ('FINANCE', r.FINANCE), ('inactive FINANCE', r.FIN_NONAKTIF), ('FINANCE other branch', r.FIN_LUAR)):
        err, _ = corr(h, n1, ing(2, 2), user=user)
        check(f'NEG {label} refused (ACCESS_DENIED), nothing changed', err_has(err, 'ACCESS_DENIED') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
    err = h.gagal(f"set role authenticated;select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub',{q(r.OWNER)},false);"
                  f"select set_config('request.headers',{q(json.dumps({'x-kamo-operational-branch': r.BRANCH2}))},false);select {RPC}({q(n1['recipe'])},{j(ing(2, 2))},'Alasan cukup panjang','okrt-branch');")
    check('NEG OWNER working in ANOTHER branch (operational-branch header) refused by THIS function (ACCESS_DENIED: cabang racikan tidak diizinkan)', err_has(err, 'ACCESS_DENIED', 'cabang racikan') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
    err = h.gagal(f"reset role;select {RPC}({q(n1['recipe'])},{j(ing(2, 2))},'Alasan cukup panjang','okrt-anon');")
    check('NEG no authenticated session refused', bool(err) and ('ACCESS_DENIED' in err or 'permission denied' in err) and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
    for label, reason in (('missing', None), ('empty', ''), ('whitespace', '       '), ('4 significant chars', 'ab c  d'), ('too long', 'x' * 501)):
        err = h.gagal(f"select {RPC}({q(n1['recipe'])},{j(ing(2, 2))},{('null' if reason is None else q(reason))},{q('okrt-reason-' + label.split()[0])});", r.OWNER)
        check(f'NEG reason {label} -> REASON_REQUIRED, nothing changed', err_has(err, 'REASON_REQUIRED') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
    err = h.gagal(f"select {RPC}({q(n1['recipe'])},{j(ing(2, 2))},'Alasan cukup panjang','');", r.OWNER)
    check('NEG empty request key -> refused, nothing changed', err_has(err, 'REASON_REQUIRED', 'kunci') and snap(h, n1) == sn1, dict(error=(err or '')[:160]))
    err, _ = corr(h, n1, ing(2, 2), reason=' a b c d e ', key='okrt-reason-5'); sn1b = snap(h, n1)
    check('reason with exactly 5 significant characters is accepted', err is None and line_hpp(h, n1) == D('41800.75'), dict(error=(err or '')[:160]))
    n2 = inv_visit(h, 6121); sn2 = snap(h, n2)
    bad = [('empty array', []), ('not an array', {'a': 1}), ('zero quantity', ing(2, 0)), ('negative quantity', ing(2, -1)), ('NaN quantity', [dict(item_id=MA, quantity='NaN')]),
           ('over the 1e6 cap', ing(1000001, 3)), ('duplicate item', ing(2, 3) + [dict(item_id=MA, quantity=1)]), ('unknown item', [dict(item_id=r.uid('e', 9999), quantity=1)]),
           ('inactive new ingredient', ing(2, 3) + [dict(item_id=base.MX, quantity=1)]), ('non-material new ingredient', ing(2, 3) + [dict(item_id=x.SKU, quantity=1)]),
           ('missing item_id', [dict(quantity=2)]), ('over stock (A changed first, B too much)', ing(a=5, b=999))]
    for label, payload in bad:
        err = h.gagal(f"select {RPC}({q(n2['recipe'])},{j(payload)},'Alasan cukup panjang',{q('okrt-bad-' + label.split()[0] + label.split()[-1])});", r.OWNER)
        check(f'NEG payload {label} refused, NO partial effect (stock, layers, issues, line, journals)', bool(err) and any(w in err for w in ('RECIPE_INVALID', 'INGREDIENT_INVALID', 'STOCK_SHORT', 'LAYER_SHORT')) and snap(h, n2) == sn2, dict(error=(err or '')[:160]))
    err, _ = corr(h, n2, ing(2, 3), key='okrt-nochange')
    check('NEG unchanged composition refused (NO_CHANGE, no audit noise, no journal)', err_has(err, 'NO_CHANGE') and snap(h, n2) == sn2, dict(error=(err or '')[:160]))

    # ------------------------------------------------------------------ negatives: invoice / visit / recipe state
    v1 = inv_visit(h, 6130); h.sistem(f"update invoices set voided_at=now() where id={q(v1['inv'])};"); s = snap(h, v1)
    err, _ = corr(h, v1, ing(2, 2))
    check('NEG voided invoice refused (INVOICE_VOID: a racikan sits on one invoice line for ever, correcting a void invoice posts a journal against a void document), nothing changed', err_has(err, 'INVOICE_VOID') and snap(h, v1) == s, dict(error=(err or '')[:160]))
    cp = inv_visit(h, 6131); h.sistem(f"update invoices set correction_pending=true where id={q(cp['inv'])};"); s = snap(h, cp)
    err, _ = corr(h, cp, ing(2, 2))
    check('NEG invoice awaiting a cashier correction (correction_pending) refused (INVOICE_PENDING), nothing changed', err_has(err, 'INVOICE_PENDING') and snap(h, cp) == s, dict(error=(err or '')[:160]))
    for i, (label, plant_sql, word) in enumerate((
            ('line hpp differs from the issue history', "update invoice_items set hpp=hpp+1 where compound_recipe_id={r}", 'HPP_INCONSISTENT'),
            ('an issue row is not linked to the line', "update compound_issues set posted_invoice_item_id=null where id=(select id from compound_issues where recipe_id={r} order by id limit 1)", 'HPP_INCONSISTENT'),
            ('an issue row is marked restored', "update compound_issues set restored_at=now() where id=(select id from compound_issues where recipe_id={r} order by id limit 1)", 'HPP_INCONSISTENT'),
            ('an issue row is linked to ANOTHER invoice line', "update compound_issues set posted_invoice_item_id=(select id from invoice_items where compound_recipe_id is null order by id limit 1) where id=(select id from compound_issues where recipe_id={r} order by id limit 1)", 'HPP_INCONSISTENT'))):
        hv = inv_visit(h, 6132 + i)
        h.sistem(plant_sql.format(r=q(hv['recipe'])) + ';'); s = snap(h, hv)
        err, _ = corr(h, hv, ing(2, 2))
        check(f'NEG inconsistent history ({label}) refused ({word}), nothing changed', err_has(err, word) and snap(h, hv) == s, dict(error=(err or '')[:160]))
    wd = inv_visit(h, 6150)
    h.sql("begin;alter table public.prescription_items disable trigger official_prescription_snapshot;"
          f"update prescription_items set billing_withdrawn_at=now(),billing_withdrawn_by={q(r.STAFF)},billing_withdrawal_reason='ditarik uji' where id={q(wd['rx'])};"
          "set constraints all immediate;alter table public.prescription_items enable trigger official_prescription_snapshot;commit;")
    s = snap(h, wd); err, _ = corr(h, wd, ing(2, 2))
    check('NEG racikan row withdrawn from the bill refused (RECIPE_INVALID), nothing changed', err_has(err, 'RECIPE_INVALID', 'ditarik') and snap(h, wd) == s, dict(error=(err or '')[:160]))
    vr = inv_visit(h, 6151); h.sql(f"update compounding_recipes set status='void' where id={q(vr['recipe'])};"); s = snap(h, vr)
    err, _ = corr(h, vr, ing(2, 2))
    check('NEG void racikan refused (RECIPE_INVALID), nothing changed', err_has(err, 'RECIPE_INVALID', 'void') and snap(h, vr) == s, dict(error=(err or '')[:160]))
    # official recipe on an invoice line
    ver = h.nilai('select id from compound_formula_versions limit 1')
    ov, omr = x.visit(h, 6152 + base.OFF)
    h.sql(x.issue(ov, omr, x.payload(ver, f'okrt-off-{base.OFF}')), r.DOCTOR)
    orec = h.nilai(f"select id from compounding_recipes where request_key={q(f'okrt-off-{base.OFF}')}")
    orv = dict(recipe=orec, v=ov, mr=omr, rx=h.nilai(f"select id from prescription_items where compound_recipe_id={q(orec)}"), n=6152, stay=h.nilai(f'select id from inpatient_records where visit_id={q(ov)}'))
    base.plant(h, orv['rx'], 900000)
    oerr, _ = save(h, orv, 'okrt-off-save', [])
    link(h, orv); s = snap(h, orv)
    err, _ = corr(h, orv, [dict(item_id=x.MATERIAL, quantity=1)])
    check('NEG official (resep resmi) racikan on an invoice line refused (RECIPE_LINKED: komposisi resep resmi, the guard of THIS function, not the compounding_ingredients trigger), nothing changed', oerr is None and orv['line'] and err_has(err, 'RECIPE_LINKED', 'komposisi resep resmi') and snap(h, orv) == s, dict(save=(oerr or '')[:120], error=(err or '')[:160]))
    ck = inv_visit(h, 6153); h.sql(f"update visits set checked_out_at=now() where id={q(ck['v'])};"); s = snap(h, ck)
    err, _ = corr(h, ck, ing(2, 2))
    check('NEG visit checked out refused (VISIT_CLOSED), nothing changed', err_has(err, 'VISIT_CLOSED') and snap(h, ck) == s, dict(error=(err or '')[:160]))
    ar = inv_visit(h, 6154); h.sql(f"begin;alter table public.visits disable trigger user;update visits set archived_at=now(),archived_by={q(r.OWNER)},archive_reason='arsip uji fiktif' where id={q(ar['v'])};alter table public.visits enable trigger user;commit;"); s = snap(h, ar)
    err, _ = corr(h, ar, ing(2, 2))
    check('NEG visit archived refused (VISIT_CLOSED), nothing changed', err_has(err, 'VISIT_CLOSED') and snap(h, ar) == s, dict(error=(err or '')[:160]))
    dc = inv_visit(h, 6155)
    h.sistem(f"update inpatient_records set discharged_at=now(),condition_status='sembuh' where visit_id={q(dc['v'])};update visits set status='Selesai' where id={q(dc['v'])};"); s = snap(h, dc)
    err, _ = corr(h, dc, ing(2, 2))
    check('NEG discharged AND closed (status Selesai) visit refused (VISIT_CLOSED), nothing changed', err_has(err, 'VISIT_CLOSED') and snap(h, dc) == s, dict(error=(err or '')[:160]))
    do = inv_visit(h, 6156); h.sistem(f"update inpatient_records set discharged_at=now(),condition_status='sembuh' where visit_id={q(do['v'])};")
    err, _ = corr(h, do, ing(2, 2))
    check('discharged but still awaiting payment (status not Selesai): allowed (the owner must be able to fix an open bill)', err is None and line_hpp(h, do) == D('41800.75'), dict(error=(err or '')[:200]))
    nr = None
    try:
        nv = x.dp.visit(h, 6157 + base.OFF); nmr = r.uid(7, 6157 + base.OFF)
        h.sql(f"update items set sell_price=80000 where id={q(x.SKU)};")
        h.sql(x.issue(nv, nmr, dict(request_key=f'okrt-nr-{base.OFF}', dosage_instruction='Instruksi Fiktif', sale_item_id=x.SKU, recipe=base.recipe_json(2, 3))), r.OWNER)
        nrec = h.nilai(f"select id from compounding_recipes where request_key={q(f'okrt-nr-{base.OFF}')}")
        nr = dict(recipe=nrec, v=nv, rx=h.nilai(f"select id from prescription_items where compound_recipe_id={q(nrec)}"), n=6157)
        s = base.state(h, nr); err, _ = corr(h, nr, ing(2, 2))
        check('NEG racikan on a NON-rawat-inap visit refused (NOT_INPATIENT), nothing changed', err_has(err, 'NOT_INPATIENT') and base.state(h, nr) == s, dict(error=(err or '')[:160]))
    except RuntimeError as e:
        check('NEG non-ranap fixture', False, str(e)[:300])

    # ------------------------------------------------------------------ audit table, ACL, the live objects are byte-identical
    ar_ = h.gagal(f"update {NEWTAB} set reason='diubah semua';"); ad = h.gagal(f'delete from {NEWTAB};'); at = h.gagal(f'truncate {NEWTAB};')
    check('audit rows are append-only (UPDATE, DELETE, TRUNCATE refused even for the superuser)', bool(ar_) and bool(ad) and bool(at), dict(u=(ar_ or '')[:80], d=(ad or '')[:80], t=(at or '')[:80]))
    ag = h.gagal(f'select * from {NEWTAB};', r.OWNER); ai = h.gagal(f"insert into {NEWTAB}(id) values (gen_random_uuid());", r.OWNER)
    check('audit table has no app grant (owner session can neither read nor write it directly)', bool(ag) and 'permission denied' in ag and bool(ai) and 'permission denied' in ai, dict(r=(ag or '')[:100], w=(ai or '')[:100]))
    acl = h.nilai(f"select case when to_regprocedure('public.{RPC}(uuid,jsonb,text,text)') is null then 'missing' else has_function_privilege('authenticated','public.{RPC}(uuid,jsonb,text,text)','execute')||'|'||has_function_privilege('anon','public.{RPC}(uuid,jsonb,text,text)','execute')||'|'||has_function_privilege('public','public.{RPC}(uuid,jsonb,text,text)','execute')||'|'||has_function_privilege('service_role','public.{RPC}(uuid,jsonb,text,text)','execute') end")
    aclq = h.nilai(f"select case when to_regprocedure('public.{QUOTE}(uuid,jsonb)') is null then 'missing' else has_function_privilege('authenticated','public.{QUOTE}(uuid,jsonb)','execute')||'|'||has_function_privilege('anon','public.{QUOTE}(uuid,jsonb)','execute')||'|'||has_function_privilege('public','public.{QUOTE}(uuid,jsonb)','execute')||'|'||has_function_privilege('service_role','public.{QUOTE}(uuid,jsonb)','execute') end")
    aclp = h.nilai("select case when to_regprocedure('clinic_private.owner_correct_compound_invoiced(uuid,jsonb,text,text,boolean)') is null then 'missing' else has_function_privilege('authenticated','clinic_private.owner_correct_compound_invoiced(uuid,jsonb,text,text,boolean)','execute')::text||'|'||has_function_privilege('anon','clinic_private.owner_correct_compound_invoiced(uuid,jsonb,text,text,boolean)','execute') end")
    check('ACL: RPC and quote executable by authenticated only (not anon/public/service_role); the private core (with p_dry) is executable by nobody', acl == 'true|false|false|false' and aclq == 'true|false|false|false' and aclp == 'false|false', dict(acl=acl, aclq=aclq, aclp=aclp))
    now_defs = old_defs(h)
    now_dig = digest(h)
    check('DIGEST: every pre-existing function (definition + ACL), trigger, column, constraint, index, policy, table ACL is IDENTICAL before/after applying the migration (only the new objects are added)',
          pre is not None and pre == now_dig, dict(pre=pre, now=now_dig))
    check('the LIVE 120000 RPCs, clinic_adjust_compound, assert_compound_adjustable, assert_invoice_price_floor (P03), clinic_post_invoice, clinic_write_journal, the ranap cashier save keep their exact definitions',
          bool(now_defs) and now_defs == PRE_DEFS.get('v'), dict(defs=now_defs, pre=PRE_DEFS.get('v')))
    cand = (MIG / CANDIDATE).read_text() if (MIG / CANDIDATE).exists() else ''
    check('static: the migration redefines none of the live objects (no create/replace of the 120000 RPCs, price floor, adjust, post invoice, write journal, cashier save)',
          bool(cand) and not any(n in cand for n in ('function public.clinic_owner_correct_compound(', 'function clinic_private.owner_correct_compound(', 'function public.clinic_owner_compound_correction_quote(',
                                                       'function public.clinic_adjust_compound', 'assert_invoice_price_floor(', 'function public.clinic_post_invoice', 'function public.clinic_write_journal', 'function public.clinic_save_inpatient_cashier')), dict())

    # ------------------------------------------------------------------ quote: read-only = real effect
    qv = inv_visit(h, 6160); s0 = snap(h, qv)
    qt, qres = None, None
    try: qres = J(h.nilai(f"select {QUOTE}({q(qv['recipe'])},{j(ing(2, 2))});", r.OWNER))
    except RuntimeError as e: qt = str(e)
    check('quote (read-only): HPP 50901.00 -> 41800.75, delta -9100.25, invoice no, journal preview, stock effect; leaves NOTHING changed (stock, layers, issues, line, journals, audit, sequences of nothing)',
          qt is None and snap(h, qv) == s0 and qres and D(str(qres['cost_before'])) == D('50901.00') and D(str(qres['cost_after'])) == D('41800.75') and D(str(qres['hpp_delta'])) == D('-9100.25')
          and qres['invoice_no'] == qv['no'] and qres['journal']['date'] == today and [e for e in qres['stock'] if e['direction'] == 'kembali'] and D(str(qres['price'])) == D('80000.00'), dict(error=(qt or '')[:160], q=str(qres)[:200]))
    real = corr(h, qv, ing(2, 2), key='okrt-q-1')
    check('the real correction ends with exactly the cost, delta and journal the quote predicted', real[0] is None and line_hpp(h, qv) == D(str(qres['cost_after'])) and D(str(real[1]['hpp_delta'])) == D(str(qres['hpp_delta']))
          and sorted((l['code'], D(str(l['debit'])), D(str(l['credit']))) for l in real[1]['journal']['lines']) == sorted((l['code'], D(str(l['debit'])), D(str(l['credit']))) for l in qres['journal']['lines']), dict(error=(real[0] or '')[:160]))
    qd = h.gagal(f"select {QUOTE}({q(qv['recipe'])},{j(ing(2, 2))});", r.STAFF)
    check('NEG quote for a non-owner refused (ACCESS_DENIED)', err_has(qd, 'ACCESS_DENIED'), dict(error=(qd or '')[:120]))

    # ------------------------------------------------------------------ concurrency (two real sessions)
    if db is not None: races(h, db)


PRE_DEFS = {}


def races(h, db):
    def blocked(obs, sess):
        for _ in range(40):
            w = obs.sql(f"select coalesce(wait_event_type,'')||'/'||coalesce(wait_event,'') from pg_stat_activity where pid={sess.pid};")
            if w and w[-1].startswith('Lock/'): return w[-1]
            time.sleep(0.15)
        return 'NOT BLOCKED'

    def session(name, user):
        s = c.Session(db, name); s.sql(x.claims(user)); return s
    sqlc = lambda rv, ings, key: f"select {RPC}({q(rv['recipe'])},{j(ings)},'Alasan cukup panjang',{q(key)});"
    # (1) correction vs a cashier save of a NEW racikan on the same visit that is mid-flight (holds the coordinator): the correction WAITS, then applies
    k = inv_visit(h, 6170); k2 = base.issue_racikan(h, k['v'], k['mr'], 6170, f'okr-race-new-{base.OFF}', 90000); sk0 = snap(h, k)
    cart = base.read_cart(h, k2)
    save_sql = f"select clinic_save_inpatient_cashier({q(k2['stay'])},{q(k2['v'])},{q('okrt-race-save' + str(base.OFF))},'2026-11-03',{q(cart['snapshot'])},{j(cart['rows'])},{j([])},null,false,null,'Kasir Fiktif');"
    with c.Session(db, 'obs') as obs, session('cashier', r.OWNER) as a, session('correct', r.OWNER) as b:
        a.sql('begin;' + save_sql); b.send(sqlc(k, ing(2, 2), 'okrt-race-1'))
        wait = blocked(obs, b); a.sql('commit;'); res = c.attempt(b, commit=False)
    sk1 = snap(h, k); link(h, k2)
    check('race: correction started while a cashier save holds the visit coordinator WAITS (advisory), then applies; the other racikan\'s new invoice keeps its own HPP',
          wait.endswith('advisory') and res['ok'] and line_hpp(h, k) == D('41800.75') and k2['line'] and D(h.nilai(f"select hpp from invoice_items where id={q(k2['line'])}")) == D('50901.00') and sk1['audit2'] == sk0['audit2'] + 1,
          dict(wait=wait, res=str(res)[:200]))
    # (2) cashier save of a racikan whose correction is in flight (racikan not yet invoiced) is covered by the 120000 suite; here: payment waits behind a correction, then pays on the corrected line
    k3 = inv_visit(h, 6171); pay3 = pay_sql(h, k3, 'okrt-race2-pay')
    with c.Session(db, 'obs2') as obs, session('correct2', r.OWNER) as a, session('payer', r.OWNER) as b:
        a.sql('begin;' + sqlc(k3, ing(2, 2), 'okrt-race-2'))
        b.send(pay3)
        wait2 = blocked(obs, b); a.sql('commit;'); res2 = c.attempt(b, commit=False)
    s3 = snap(h, k3)
    check('race: invoice payment started while a correction is in flight WAITS (advisory), then pays; invoice Lunas, line hpp 41800.75, journals consistent',
          wait2.endswith('advisory') and res2['ok'] and h.nilai(f"select paid_status from invoices where id={q(k3['inv'])}") == 'Lunas' and line_hpp(h, k3) == D('41800.75') and jsum(s3['jr']) == D('41800.75'), dict(wait=wait2, res=str(res2)[:200]))
    # (3) correction waits behind a payment in flight and then applies to the now PAID invoice
    k4 = inv_visit(h, 6172); pay4 = pay_sql(h, k4, 'okrt-race3-pay')
    with c.Session(db, 'obs3') as obs, session('payer2', r.OWNER) as a, session('correct3', r.OWNER) as b:
        a.sql('begin;' + pay4)
        b.send(sqlc(k4, ing(2, 2), 'okrt-race-3'))
        wait3 = blocked(obs, b); a.sql('commit;'); res3 = c.attempt(b, commit=False)
    s4 = snap(h, k4)
    check('race: correction started while a payment holds the coordinator WAITS (advisory), then corrects the now PAID invoice (paid_status Lunas, payment kept)',
          wait3.endswith('advisory') and res3['ok'] and h.nilai(f"select paid_status from invoices where id={q(k4['inv'])}") == 'Lunas' and line_hpp(h, k4) == D('41800.75') and s4['payments'] >= 1, dict(wait=wait3, res=str(res3)[:200]))
    # (4) invoice void request waits behind a correction in flight (same coordinator), then is refused by the racikan finance rule: the invoice is not voided
    k5 = inv_visit(h, 6173)
    with c.Session(db, 'obs4') as obs, session('correct4', r.OWNER) as a, session('voider', r.OWNER) as b:
        a.sql('begin;' + sqlc(k5, ing(2, 2), 'okrt-race-4'))
        b.send(f"select clinic_void_reissue_invoice({q(k5['inv'])},'okrt-race4-void{base.OFF}','Uji bentrok void');")
        wait4 = blocked(obs, b); a.sql('commit;'); res4 = c.attempt(b, commit=False)
    check('race: invoice void request started while a correction is in flight WAITS (advisory); afterwards the invoice is NOT voided and the corrected HPP stays',
          wait4.endswith('advisory') and h.nilai(f"select voided_at is null from invoices where id={q(k5['inv'])}") == 't' and line_hpp(h, k5) == D('41800.75'), dict(wait=wait4, res=str(res4)[:240]))
    # (5) two identical requests at once: one effect
    k6 = inv_visit(h, 6174); s60 = snap(h, k6)
    with c.Session(db, 'obs5') as obs, session('twin-a', r.OWNER) as a, session('twin-b', r.OWNER) as b:
        a.sql('begin;' + sqlc(k6, ing(2, 2), 'okrt-twin')); b.send(sqlc(k6, ing(2, 2), 'okrt-twin'))
        wait5 = blocked(obs, b); a.sql('commit;'); res5 = c.attempt(b, commit=False)
    s61 = snap(h, k6)
    check('race: two identical requests at once apply ONCE (second waits, returns the stored result): B +1, ONE journal, one audit row',
          wait5.endswith('advisory') and res5['ok'] and float(s61['stock'][MB]) == float(s60['stock'][MB]) + 1 and s61['audit2'] == s60['audit2'] + 1 and s61['jall'] == s60['jall'] + 1, dict(wait=wait5, res=str(res5)[:200]))


def apply_candidate(db, text): db.sql('begin;\n' + text + '\ncommit;')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin'); ap.add_argument('--attach')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only', help='comma-separated substrings: run only mutants whose name contains one'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    extra = {}
    cand_path = MIG / CANDIDATE
    try:
        if a.attach:
            with base.Attached(r.BIN, a.attach) as db:
                name = 'okrt_dev_%d' % int(time.time()); db.sql(f'create database {name} template postgres;'); os.environ['PGDATABASE'] = name
                h = x.Harness(db); PRE_DEFS['v'] = old_defs(h); pre = digest(h)
                if not a.baseline: apply_candidate(db, cand_path.read_text())
                run(h, db, setup=False, baseline=a.baseline, pre=pre)
        elif a.mutations:
            from importlib.machinery import SourceFileLoader
            mut = SourceFileLoader('mut', str(ROOT / 'scripts/test-owner-koreksi-racikan-tagihan-mutants.py')).load_module()
            with r.NativePostgres(r.BIN) as db:
                base.build(db, {CANDIDATE}); h = x.Harness(db); x.setup(h); PRE_DEFS['v'] = old_defs(h); pre = digest(h)
                cand = cand_path.read_text(); plan = [('M0 control (unmodified candidate)', cand)]; extra['mutants'] = {}
                for name, pairs in mut.MUTANTS:
                    text, ok = cand, True
                    for old, new, expected in pairs:
                        n = text.count(old)
                        if n != expected: check(name + ' anchor occurs %d time(s)' % expected, False, dict(count=n, anchor=old[:60])); ok = False; break
                        text = text.replace(old, new)
                    if not ok or (a.only and not any(o in name for o in a.only.split(','))): continue
                    plan.append((name, text))
                for i, (name, text) in enumerate(plan):
                    os.environ.pop('PGDATABASE', None)
                    db.sql(f'create database v{i} template postgres'); os.environ['PGDATABASE'] = f'v{i}'; base.OFF = 100 * i
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
                base.build(db, {CANDIDATE}); h = x.Harness(db); x.setup(h); PRE_DEFS['v'] = old_defs(h); pre = digest(h)
                if not a.baseline: apply_candidate(db, cand_path.read_text())
                run(h, db, setup=False, baseline=a.baseline, pre=pre)
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(cc['status'] == s for cc in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='mutations' if a.mutations else 'RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
