#!/usr/bin/env python3
"""OWNER corrects the composition (BMHP/ingredients) of an already issued RANAP racikan, also when the visit has DP/payments,
as long as the racikan row is not on any invoice line (migration 20261107900000_owner_koreksi_racikan.sql).

Native full schema, fictional fixtures, throwaway local cluster, no network.
  flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-owner-koreksi-racikan-postgres.py --pg-bin DIR --json out.json
  --baseline    chain WITHOUT the candidate migration: every owner case must FAIL (RED), the 'existing refusal' cases PASS
  --mutations   chain without the candidate once, then each mutant of the candidate in a cloned database; all must be killed
  --attach DIR  dev only: clone of the `postgres` DB (chain WITHOUT candidate, x.setup done) in a running cluster, candidate applied on top
"""
import argparse, importlib.util, json, os, sys, tempfile, time
from decimal import Decimal
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('medical', ROOT / 'scripts/test-rekam-full-edit-postgres.py'); assert spec and spec.loader
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
x, r, q, j = m.x, m.r, m.q, m.j
c = x.c
CANDIDATE = '20261107900000_owner_koreksi_racikan.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = []
OFF = 0
MA, MB, MC, MX, SKU2 = (r.uid('e', 9100 + i) for i in range(5))    # materials A, B, C, X (inactive), second SKU
RPC = 'clinic_owner_correct_compound'


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:420], flush=True)


def prep(h):
    """Own materials. B has TWO FIFO layers with cents so the restored cost can be asserted to the cent."""
    h.sql(f"""
insert into public.items(id,code,name,unit,item_type,is_active,is_compound_material,sell_price,buy_price) values
 ({q(MA)},'OKR-A','Bahan A Fiktif','ml','Persediaan',true,true,9000,1000),
 ({q(MB)},'OKR-B','Bahan B Fiktif','ml','Persediaan',true,true,9000,1000),
 ({q(MC)},'OKR-C','Bahan C Fiktif','ml','Persediaan',true,true,1000,100),
 ({q(MX)},'OKR-X','Bahan nonaktif Fiktif','ml','Persediaan',false,true,1000,100);
insert into public.stock(warehouse_id,item_id,qty) values ({q(r.WH)},{q(MA)},50),({q(r.WH)},{q(MB)},21),({q(r.WH)},{q(MC)},30),({q(r.WH)},{q(MX)},5);
insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
 ({q(r.WH)},{q(MA)},'2026-10-01',50,50,12000,'purchase'),
 ({q(r.WH)},{q(MB)},'2026-10-01',1,1,8700.50,'purchase'),
 ({q(r.WH)},{q(MB)},'2026-10-15',20,20,9100.25,'purchase'),
 ({q(r.WH)},{q(MC)},'2026-10-01',30,30,500,'purchase'),
 ({q(r.WH)},{q(MX)},'2026-10-01',5,5,100,'purchase');
""")


def recipe_json(a=2, b=3, name='Obat Racik Probiotik'):
    ing = []
    if a: ing.append(dict(item_id=MA, quantity=a, unit='ml', unit_price=9000))
    if b: ing.append(dict(item_id=MB, quantity=b, unit='ml', unit_price=9000))
    return dict(recipe_name=name, dosage_instruction='Instruksi Fiktif', dosage_form='sirup', ingredients=ing)


def plant(h, rx, harga):
    h.sql("begin;alter table public.prescription_items disable trigger official_prescription_snapshot;"
          f"update public.prescription_items set harga={harga} where id={q(rx)};"
          f"update public.clinic_compound_sales set sale_price={harga} where recipe_id=(select compound_recipe_id from public.prescription_items where id={q(rx)});"
          "set constraints all immediate;alter table public.prescription_items enable trigger official_prescription_snapshot;commit;")


def racik_visit(h, n, price=50000, a=2, b=3, status=None):
    """Live shape: ranap visit WITH DP 200000 (first stage invoice posted), racikan issued afterwards at FIFO cost, row not invoiced."""
    n += OFF
    v, mr = x.visit(h, n)
    # fresh EARLIEST FIFO layers per fixture so every racikan is issued at the same known cost (A 2 @12000; B 1 @8700.50 + 2 @9100.25)
    h.sql(f"""insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
 ({q(r.WH)},{q(MA)},'2026-01-01',{a},{a},12000,'purchase'),({q(r.WH)},{q(MB)},'2026-01-01',1,1,8700.50,'purchase'),({q(r.WH)},{q(MB)},'2026-01-02',2,2,9100.25,'purchase');
update public.stock set qty=qty+{a} where warehouse_id={q(r.WH)} and item_id={q(MA)};
update public.stock set qty=qty+3 where warehouse_id={q(r.WH)} and item_id={q(MB)};
update public.items set sell_price={price} where id={q(x.SKU)};""")
    key = f'okr-{n}'
    h.sql(x.issue(v, mr, dict(request_key=key, dosage_instruction='Instruksi Fiktif', sale_item_id=x.SKU, recipe=recipe_json(a, b))), r.OWNER)
    recipe = h.nilai(f"select id from compounding_recipes where request_key={q(key)}")
    rx = h.nilai(f"select id from prescription_items where compound_recipe_id={q(recipe)}")
    if status: h.sql(f"update compounding_recipes set status={q(status)} where id={q(recipe)};")
    stay = h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
    return dict(v=v, mr=mr, recipe=recipe, rx=rx, stay=stay, n=n)


def hpp_of(h, recipe): return Decimal(h.nilai(f"select coalesce(round(sum(qty*unit_cost),2),0) from compound_issues where recipe_id={q(recipe)}"))


def state(h, rv):
    """Everything the correction may or may not touch, as one comparable value."""
    return json.loads(h.nilai(f"""select jsonb_build_object(
 'stock',(select jsonb_object_agg(item_id::text,qty) from stock where warehouse_id={q(r.WH)} and item_id in ({q(MA)},{q(MB)},{q(MC)},{q(MX)})),
 'layers',(select coalesce(jsonb_agg(jsonb_build_array(item_id,tanggal,qty_in,qty_left,unit_cost,source) order by item_id,tanggal,created_at,id),'[]') from stock_layers where item_id in ({q(MA)},{q(MB)},{q(MC)},{q(MX)})),
 'issues',(select coalesce(jsonb_agg(jsonb_build_array(item_id,qty,unit_cost,physical_unit_cost,stock_layer_id,posted_invoice_item_id,restored_at) order by item_id,stock_layer_id),'[]') from compound_issues where recipe_id={q(rv['recipe'])}),
 'ingredients',(select coalesce(jsonb_agg(jsonb_build_array(item_id,quantity,unit,unit_price) order by item_id),'[]') from compounding_ingredients where recipe_id={q(rv['recipe'])}),
 'moves',(select count(*) from stock_moves),
 'journals',(select count(*) from journal_entries),
 'invoices',(select count(*) from invoices where visit_id={q(rv['v'])}),
 'invoice_rows',(select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from invoices i where visit_id={q(rv['v'])}),
 'payments',(select count(*) from invoice_payments p join invoices i on i.id=p.invoice_id where i.visit_id={q(rv['v'])}),
 'receipts',(select count(*) from clinic_payment_receipts where visit_id={q(rv['v'])}),
 'harga',(select harga from prescription_items where id={q(rv['rx'])}),
 'sale',(select sale_price from clinic_compound_sales where recipe_id={q(rv['recipe'])}),
 'recipe',(select to_jsonb(r) from compounding_recipes r where id={q(rv['recipe'])}),
 'audit',(case when to_regclass('clinic_private.owner_compound_corrections') is null then 0 else (xpath('/row/c/text()',query_to_xml('select count(*) as c from clinic_private.owner_compound_corrections',false,true,'')))[1]::text::int end)
)"""))


def fix(st):
    """Comparable view without the audit counter (for 'nothing but the audit changed' checks)."""
    return {k: v for k, v in st.items() if k != 'audit'}


def call(h, rv, ings, reason='Komposisi disesuaikan setelah penimbangan ulang', key=None, user=r.OWNER, fn=RPC):
    key = key or f'k-{rv["n"]}-{abs(hash(json.dumps(ings)+reason)) % 10**8}'
    return h.gagal(f"select {fn}({q(rv['recipe'])},{j(ings)},{q(reason)},{q(key)});", user)


def ing(a=None, b=None, c_=None):
    out = []
    for item, qty in ((MA, a), (MB, b), (MC, c_)):
        if qty is not None: out.append(dict(item_id=item, quantity=qty))
    return out


def read_cart(h, rv): return json.loads(h.nilai(f"select clinic_read_inpatient_cashier({q(rv['stay'])},{q(rv['v'])});", r.STAFF))


def pay(h, rv, key, user=r.OWNER, amount=None):
    cart = read_cart(h, rv)
    total = sum(row['qty'] * row['harga'] for row in cart['rows'])
    parts = [dict(method='Tunai', amount=amount if amount is not None else -(-total // 1))]
    return h.gagal(f"select clinic_save_inpatient_cashier({q(rv['stay'])},{q(rv['v'])},{q(key + str(OFF))},'2026-11-03',{q(cart['snapshot'])},{j(cart['rows'])},{j(parts)},null,false,null,'Kasir Fiktif');", user), cart


def err_has(err, *words): return bool(err) and all(w in err for w in words)


def audit_rows(h, rv): return json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(a) order by created_at,id),'[]') from clinic_private.owner_compound_corrections a where recipe_id={q(rv['recipe'])}")) if h.nilai("select to_regclass('clinic_private.owner_compound_corrections') is not null") == 't' else []


def run(h, db=None, setup=True, baseline=False):  # baseline: same battery against the chain WITHOUT the candidate (RED)
    if setup: x.setup(h)
    prep(h)
    # ------------------------------------------------------------------ the live case: what is refused TODAY (passes in RED and GREEN)
    a = racik_visit(h, 5101)
    st0 = state(h, a); hpp0 = hpp_of(h, a['recipe'])
    dp_live = h.nilai(f"select coalesce(sum(dp_amount),0)||'|'||count(*) from invoices where visit_id={q(a['v'])} and voided_at is null")
    check('fixture: ranap visit with DP, racikan priced Rp50.000 with FIFO cost 50901.00 above price, row not on any invoice line',
          Decimal(dp_live.split('|')[0]) > 0 and hpp0 == Decimal('50901.00') and st0['harga'] == 50000 and st0['sale'] == 50000
          and h.nilai(f"select count(*) from invoice_items where prescription_item_id={q(a['rx'])} or compound_recipe_id={q(a['recipe'])}") == '0',
          dict(dp=dp_live, hpp=str(hpp0), harga=st0['harga']))
    err = h.gagal(f"select clinic_adjust_compound({q(a['recipe'])},{j(ing(2, 2))},'Koreksi uji');", r.OWNER)
    check('RED: the existing clinic_adjust_compound refuses the live case with INVOICE_PAID (DP on the visit)', err_has(err, 'INVOICE_PAID') and fix(state(h, a)) == fix(st0), dict(error=(err or '')[:160]))
    err, cart = pay(h, a, 'okr-red-pay')
    check('RED: the P03 floor refuses the cashier payment (PRICE_BELOW_HPP, nothing saved)',
          err_has(err, 'PRICE_BELOW_HPP') and fix(state(h, a)) == fix(st0), dict(error=(err or '')[:200]))

    # ------------------------------------------------------------------ GREEN: the owner lowers an ingredient
    err = call(h, a, ing(2, 2), key='okr-a-1')
    st1 = state(h, a); hpp1 = hpp_of(h, a['recipe'])
    check('GREEN owner lowers B from 3 to 2 (visit has DP): ok, HPP 50901.00 -> 41800.75 (restored layer at its own cost 9100.25), below the price',
          err is None and hpp1 == Decimal('41800.75') and hpp1 < 50000, dict(error=(err or '')[:240], hpp=str(hpp1)))
    sb0, sb1 = st0['stock'][MB], st1['stock'][MB]
    new_layers = [l for l in st1['layers'] if l not in st0['layers']]
    check('stock: ONLY the delta moves: B +1, A and C untouched, one racik-koreksi layer 1 @ 9100.25, one stock move',
          float(sb1) - float(sb0) == 1 and st1['stock'][MA] == st0['stock'][MA] and st1['stock'][MC] == st0['stock'][MC]
          and len(new_layers) == 1 and new_layers[0][1] == str(time.strftime('%Y-%m-%d', time.gmtime())) and float(new_layers[0][2]) == 1 and float(new_layers[0][3]) == 1 and float(new_layers[0][4]) == 9100.25 and new_layers[0][5] == 'racik-koreksi'
          and st1['moves'] == st0['moves'] + 1,
          dict(sb0=sb0, sb1=sb1, new=new_layers, moves=(st0['moves'], st1['moves'])))
    iss0 = {i[0] + str(i[4]): i for i in st0['issues']}; iss1 = {i[0] + str(i[4]): i for i in st1['issues']}
    a_same = [k for k in iss0 if k.startswith(MA)] and all(iss1.get(k) == iss0[k] for k in iss0 if k.startswith(MA))
    b1 = [i for i in st1['issues'] if i[0] == MB]
    check('compound_issues consistent: A rows identical, B = 1 @ 8700.50 + 1 @ 9100.25 (reverse FIFO restore), none restored/posted',
          a_same and sorted((float(i[1]), float(i[2])) for i in b1) == [(1.0, 8700.5), (1.0, 9100.25)] and all(i[5] is None and i[6] is None for i in st1['issues']),
          dict(b=b1))
    check('ingredient snapshot: B quantity 2, unit_price/unit untouched; recipe total_price and master sale_price untouched',
          [i for i in st1['ingredients'] if i[0] == MB][0][1:] == [2, 'ml', 9000] and st1['recipe'] == st0['recipe'] and st1['sale'] == st0['sale'],
          dict(ing=st1['ingredients']))
    check('NEVER touches the price: prescription_items.harga stays 50000; no invoice/payment/receipt/journal change; DP intact',
          err is None and st1['harga'] == 50000 and st1['invoice_rows'] == st0['invoice_rows'] and st1['payments'] == st0['payments'] and st1['receipts'] == st0['receipts']
          and st1['journals'] == st0['journals'] and st1['invoices'] == st0['invoices'], dict(j=(st0['journals'], st1['journals'])))
    au = audit_rows(h, a)
    check('audit row: who / when / before + after ingredients / cost before + after / reason / request_key / visit',
          len(au) == 1 and au[0]['actor_id'] == r.OWNER and Decimal(str(au[0]['cost_before'])) == Decimal('50901.00') and Decimal(str(au[0]['cost_after'])) == Decimal('41800.75')
          and au[0]['reason'].startswith('Komposisi disesuaikan') and au[0]['request_key'] == 'okr-a-1' and au[0]['visit_id'] == a['v']
          and [i for i in au[0]['before_ingredients'] if i['item_id'] == MB][0]['quantity'] == 3 and [i for i in au[0]['after_ingredients'] if i['item_id'] == MB][0]['quantity'] == 2 and au[0]['created_at'], dict(au=au[:1]))
    # replay
    err1 = call(h, a, ing(2, 2), key='okr-a-1')
    check('replay: same request_key + same payload is idempotent (no error, no second movement, one audit row)', err1 is None and state(h, a) == st1, dict(error=(err1 or '')[:160]))
    err2 = call(h, a, ing(2, 1), key='okr-a-1')
    check('replay with a DIFFERENT payload under the same key is refused (IDEMPOTENCY_CONFLICT), nothing changes', err_has(err2, 'IDEMPOTENCY_CONFLICT') and state(h, a) == st1, dict(error=(err2 or '')[:160]))
    # the cashier now succeeds with the floor intact
    err, cart = pay(h, a, 'okr-a-pay')
    inv = h.nilai(f"select ii.harga||'|'||ii.hpp||'|'||ii.compound_recipe_id from invoice_items ii where ii.compound_recipe_id={q(a['recipe'])}")
    check('cashier: save + invoice posting now succeeds at price 50000 with HPP 41800.75 (P03 floor intact, row now on an invoice line)',
          err is None and inv.startswith('50000.00|41800.75|') and h.nilai(f"select count(*) from compound_issues where recipe_id={q(a['recipe'])} and posted_invoice_item_id is not null") == '3',
          dict(error=(err or '')[:240], line=inv))
    err = call(h, a, ing(2, 1), key='okr-a-after-invoice')
    check('after the invoice: a second correction is refused (RECIPE_LINKED: sudah masuk invoice), nothing changes', err_has(err, 'RECIPE_LINKED') and fix(state(h, a)) == fix(state(h, a)) and len(audit_rows(h, a)) == 1, dict(error=(err or '')[:200]))
    err = h.gagal(f"select clinic_adjust_compound({q(a['recipe'])},{j(ing(2, 2))},'Koreksi uji');", r.OWNER)
    check('the EXISTING clinic_adjust_compound is not loosened (still refuses)', bool(err) and ('RECIPE_LINKED' in err or 'INVOICE_PAID' in err), dict(error=(err or '')[:120]))

    # ------------------------------------------------------------------ P03 still refuses a price below the NEW HPP
    b = racik_visit(h, 5102); stb = state(h, b)
    err = call(h, b, ing(2, 2), key='okr-b-1')
    hpp_b = hpp_of(h, b['recipe']); plant(h, b['rx'], 41000)
    err2, _ = pay(h, b, 'okr-b-pay')
    check('P03 intact: after the correction a price BELOW the new HPP (41000 < 41800.75) is still refused and nothing is saved',
          err is None and err_has(err2, 'PRICE_BELOW_HPP') and h.nilai(f"select count(*) from invoice_items where compound_recipe_id={q(b['recipe'])}") == '0', dict(e1=(err or '')[:100], e2=(err2 or '')[:200], hpp=str(hpp_b)))

    # ------------------------------------------------------------------ increase + add + remove in one correction; statuses
    cc = racik_visit(h, 5103); st = state(h, cc)
    err = call(h, cc, ing(a=3, c_=4), key='okr-c-1')
    s2 = state(h, cc); h2 = hpp_of(h, cc['recipe'])
    ia = [i for i in s2['issues'] if i[0] == MA]; ic = [i for i in s2['issues'] if i[0] == MC]
    check('mixed: A 2->3 issued at current FIFO @12000, C added 4 @500, B removed (all 3 restored, rows gone): HPP 38000.00, exact stock',
          err is None and h2 == Decimal('38000.00') and sum(float(i[1]) for i in ia) == 3 and sum(float(i[1]) for i in ic) == 4 and not [i for i in s2['issues'] if i[0] == MB]
          and float(s2['stock'][MA]) == float(st['stock'][MA]) - 1 and float(s2['stock'][MC]) == float(st['stock'][MC]) - 4 and float(s2['stock'][MB]) == float(st['stock'][MB]) + 3
          and [i[0] for i in s2['ingredients']] == sorted([MA, MC]) and sum(float(l[3]) for l in s2['layers'] if l[0] == MB) == sum(float(l[3]) for l in st['layers'] if l[0] == MB) + 3,
          dict(error=(err or '')[:240], hpp=str(h2)))
    for status in ('ready', 'handed_over'):
        s = racik_visit(h, 5110 if status == 'ready' else 5111, status=status)
        err = call(h, s, ing(2, 2), key='okr-status-' + status)
        check(f'status {status} (Diserahkan = label farmasi saja, tidak ada tagihan): allowed while not on an invoice', err is None and hpp_of(h, s['recipe']) == Decimal('41800.75') and h.nilai(f"select status from compounding_recipes where id={q(s['recipe'])}") == status, dict(error=(err or '')[:200]))
    s = racik_visit(h, 5112, status='void'); s0 = state(h, s)
    err = call(h, s, ing(2, 2))
    check('NEG status void refused (RECIPE_INVALID), nothing changed', err_has(err, 'RECIPE_INVALID') and state(h, s) == s0, dict(error=(err or '')[:160]))

    # ------------------------------------------------------------------ negatives: role / branch / reason / payload — never a partial effect
    n1 = racik_visit(h, 5120); s0 = state(h, n1)
    for label, user in (('ADMIN', r.ADMIN), ('DOCTOR', r.DOCTOR), ('STAFF', r.STAFF), ('FINANCE', r.FINANCE), ('inactive FINANCE', r.FIN_NONAKTIF), ('FINANCE other branch', r.FIN_LUAR)):
        err = call(h, n1, ing(2, 2), user=user)
        check(f'NEG {label} refused (ACCESS_DENIED), nothing changed', err_has(err, 'ACCESS_DENIED') and state(h, n1) == s0, dict(error=(err or '')[:160]))
    err = h.gagal(f"set role authenticated;select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub',{q(r.OWNER)},false);"
                  f"select set_config('request.headers',{q(json.dumps({'x-kamo-operational-branch': r.BRANCH2}))},false);select {RPC}({q(n1['recipe'])},{j(ing(2, 2))},'Alasan cukup panjang','okr-branch');")
    check('NEG OWNER working in ANOTHER branch (operational-branch header) refused (ACCESS_DENIED)', err_has(err, 'ACCESS_DENIED') and state(h, n1) == s0, dict(error=(err or '')[:160]))
    err = h.gagal(f"reset role;select {RPC}({q(n1['recipe'])},{j(ing(2, 2))},'Alasan cukup panjang','okr-anon');")
    check('NEG no authenticated session refused', bool(err) and ('ACCESS_DENIED' in err or 'permission denied' in err) and state(h, n1) == s0, dict(error=(err or '')[:160]))
    for label, reason in (('missing', None), ('empty', ''), ('whitespace', '       '), ('4 significant chars', 'ab c  d'), ('too long', 'x' * 501)):
        err = h.gagal(f"select {RPC}({q(n1['recipe'])},{j(ing(2, 2))},{('null' if reason is None else q(reason))},{q('okr-reason-' + label.split()[0])});", r.OWNER)
        check(f'NEG reason {label} -> REASON_REQUIRED, nothing changed', err_has(err, 'REASON_REQUIRED') and state(h, n1) == s0, dict(error=(err or '')[:160]))
    err = call(h, n1, ing(2, 2), reason=' a b c d e ', key='okr-reason-5')
    check('reason with exactly 5 significant characters is accepted', err is None, dict(error=(err or '')[:160]))
    n2 = racik_visit(h, 5121); s0 = state(h, n2)
    bad = [('empty array', []), ('not an array', {'a': 1}), ('zero quantity', ing(2, 0)), ('negative quantity', ing(2, -1)), ('NaN quantity', [dict(item_id=MA, quantity='NaN')]),
           ('over the 1e6 cap', ing(1000001, 3)), ('duplicate item', ing(2, 3) + [dict(item_id=MA, quantity=1)]), ('unknown item', [dict(item_id=r.uid('e', 9999), quantity=1)]),
           ('inactive new ingredient', ing(2, 3) + [dict(item_id=MX, quantity=1)]), ('non-material new ingredient', ing(2, 3) + [dict(item_id=x.SKU, quantity=1)]),
           ('missing item_id', [dict(quantity=2)]), ('over stock (A changed first, B too much)', ing(a=5, b=999))]
    for label, payload in bad:
        err = h.gagal(f"select {RPC}({q(n2['recipe'])},{j(payload)},'Alasan cukup panjang',{q('okr-bad-' + label.split()[0] + label.split()[-1])});", r.OWNER)
        check(f'NEG payload {label} refused, NO partial effect', bool(err) and any(w in err for w in ('RECIPE_INVALID', 'INGREDIENT_INVALID', 'STOCK_SHORT', 'LAYER_SHORT')) and state(h, n2) == s0, dict(error=(err or '')[:160]))
    err = call(h, n2, ing(2, 3), key='okr-nochange')
    check('NEG unchanged composition refused (no audit noise)', err_has(err, 'NO_CHANGE') and state(h, n2) == s0, dict(error=(err or '')[:160]))

    # ------------------------------------------------------------------ the racikan is on an invoice line / sealed / closed / not ranap
    p = racik_visit(h, 5130, price=80000)
    e, _ = pay(h, p, 'okr-p-pay'); sp = state(h, p)
    err = call(h, p, ing(2, 2))
    check('NEG racikan already on an ACTIVE invoice line refused (RECIPE_LINKED), nothing changed', e is None and err_has(err, 'RECIPE_LINKED') and state(h, p) == sp, dict(pay=(e or '')[:120], error=(err or '')[:160]))
    vd = racik_visit(h, 5131); inv3 = r.uid('b', 5131 + OFF)
    plant_err = h.gagal("begin;insert into clinic_private.posting_ctx(txid,kind,visit_id) values(txid_current(),'stage'," + q(vd['v']) + ");"
        f"insert into invoices(id,visit_id,voided_at) values({q(inv3)},{q(vd['v'])},now());"
        f"insert into invoice_items(invoice_id,deskripsi,qty,harga,jenis,prescription_item_id) values({q(inv3)},'Plant sudah ditagih',1,1,'obat',{q(vd['rx'])});"
        "delete from clinic_private.posting_ctx where txid=txid_current();commit;")
    s0 = state(h, vd)
    err = call(h, vd, ing(2, 2))
    check('NEG racikan row with a VOIDED invoice line also refused (a racikan can only ever sit on one invoice line; it could not be re-billed)', plant_err is None and err_has(err, 'RECIPE_LINKED') and state(h, vd) == s0, dict(plant=(plant_err or '')[:160], error=(err or '')[:160]))
    wd = racik_visit(h, 5132)
    h.sql("begin;alter table public.prescription_items disable trigger official_prescription_snapshot;"
          f"update prescription_items set billing_withdrawn_at=now(),billing_withdrawn_by={q(r.STAFF)},billing_withdrawal_reason='ditarik uji' where id={q(wd['rx'])};"
          "set constraints all immediate;alter table public.prescription_items enable trigger official_prescription_snapshot;commit;")
    s0 = state(h, wd); err = call(h, wd, ing(2, 2))
    check('NEG racikan row withdrawn from the bill refused, nothing changed', bool(err) and 'RECIPE_INVALID' in err and state(h, wd) == s0, dict(error=(err or '')[:160]))
    ofc = racik_visit(h, 5133); s0 = state(h, ofc)
    ver = h.nilai('select id from compound_formula_versions limit 1')
    ov, omr = x.visit(h, 5134 + OFF)
    h.sql(x.issue(ov, omr, x.payload(ver, f'okr-off-{OFF}')), r.DOCTOR)
    orec = h.nilai(f"select id from compounding_recipes where request_key={q(f'okr-off-{OFF}')}")
    so = state(h, dict(recipe=orec, v=ov, rx=h.nilai(f"select id from prescription_items where compound_recipe_id={q(orec)}"), n=5134))
    err = call(h, dict(recipe=orec, v=ov, n=5134), [dict(item_id=x.MATERIAL, quantity=1)])
    check('NEG official (resep resmi) racikan refused (RECIPE_LINKED: resep resmi), nothing changed',
          err_has(err, 'RECIPE_LINKED', 'komposisi resep resmi') and state(h, dict(recipe=orec, v=ov, rx=h.nilai(f"select id from prescription_items where compound_recipe_id={q(orec)}"), n=5134)) == so, dict(error=(err or '')[:160]))
    cl = racik_visit(h, 5135); h.sql(f"update visits set checked_out_at=now() where id={q(cl['v'])};"); s0 = state(h, cl)
    err = call(h, cl, ing(2, 2))
    check('NEG visit checked out refused (VISIT_CLOSED), nothing changed', err_has(err, 'VISIT_CLOSED') and state(h, cl) == s0, dict(error=(err or '')[:160]))
    dc = racik_visit(h, 5136)
    h.sistem(f"update inpatient_records set discharged_at=now(),condition_status='sembuh' where visit_id={q(dc['v'])};update visits set status='Selesai' where id={q(dc['v'])};"); s0 = state(h, dc)
    err = call(h, dc, ing(2, 2))
    check('NEG discharged AND closed (status Selesai) visit refused (VISIT_CLOSED), nothing changed', err_has(err, 'VISIT_CLOSED') and state(h, dc) == s0, dict(error=(err or '')[:160]))
    dp_open = racik_visit(h, 5137)
    h.sistem(f"update inpatient_records set discharged_at=now(),condition_status='sembuh' where visit_id={q(dp_open['v'])};")
    err = call(h, dp_open, ing(2, 2))
    check('discharged but still awaiting payment (status not Selesai): allowed (owner must be able to fix the bill before paying)', err is None, dict(error=(err or '')[:200]))
    # not ranap: a visit without any inpatient_records
    nv = dpvisit = None
    try:
        nv = x.dp.visit(h, 5138 + OFF); nmr = r.uid(7, 5138 + OFF)
        h.sql(f"update items set sell_price=50000 where id={q(x.SKU)};")
        h.sql(x.issue(nv, nmr, dict(request_key=f'okr-nr-{OFF}', dosage_instruction='Instruksi Fiktif', sale_item_id=x.SKU, recipe=recipe_json(2, 3))), r.OWNER)
        nrec = h.nilai(f"select id from compounding_recipes where request_key={q(f'okr-nr-{OFF}')}")
        nrv = dict(recipe=nrec, v=nv, rx=h.nilai(f"select id from prescription_items where compound_recipe_id={q(nrec)}"), n=5138)
        s0 = state(h, nrv); err = call(h, nrv, ing(2, 2))
        check('NEG racikan on a NON-rawat-inap visit refused (NOT_INPATIENT: use the existing Ubah komposisi), nothing changed', err_has(err, 'NOT_INPATIENT') and state(h, nrv) == s0, dict(error=(err or '')[:160]))
    except RuntimeError as e:
        check('NEG non-ranap fixture', False, str(e)[:300])

    # ------------------------------------------------------------------ audit table: append-only, no app grants, ACL
    ar = h.gagal("update clinic_private.owner_compound_corrections set reason='diubah semua';"); ad = h.gagal('delete from clinic_private.owner_compound_corrections;'); at = h.gagal('truncate clinic_private.owner_compound_corrections;')
    check('audit rows are append-only (UPDATE, DELETE, TRUNCATE refused even for the superuser)', bool(ar) and bool(ad) and bool(at), dict(u=(ar or '')[:80], d=(ad or '')[:80], t=(at or '')[:80]))
    ag = h.gagal('select * from clinic_private.owner_compound_corrections;', r.OWNER)
    check('audit table has no app grant (owner session cannot read or write it directly)', bool(ag) and 'permission denied' in ag, dict(error=(ag or '')[:100]))
    acl = h.nilai(f"select case when to_regprocedure('public.{RPC}(uuid,jsonb,text,text)') is null then 'missing' else has_function_privilege('authenticated','public.{RPC}(uuid,jsonb,text,text)','execute')||'|'||has_function_privilege('anon','public.{RPC}(uuid,jsonb,text,text)','execute')||'|'||has_function_privilege('public','public.{RPC}(uuid,jsonb,text,text)','execute') end")
    check('ACL: authenticated may execute, anon/public may not', acl == 'true|false|false', dict(acl=acl))
    defs = h.nilai("select md5(pg_get_functiondef('clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure))||'|'||(pg_get_functiondef('clinic_private.assert_compound_adjustable(uuid,uuid)'::regprocedure) like '%INVOICE_PAID%')::text||'|'||(pg_get_functiondef('public.clinic_adjust_compound(uuid,jsonb,text)'::regprocedure) like '%assert_compound_adjustable%')::text")
    cand = (MIG / CANDIDATE).read_text()
    check('static: the migration never redefines assert_invoice_price_floor / assert_compound_adjustable / clinic_adjust_compound; their live definitions keep the INVOICE_PAID guard',
          defs.endswith('|true|true') and not any(f'function {n}' in cand and 'create' in cand.split(f'function {n}')[0].splitlines()[-1].lower() for n in ('clinic_private.assert_invoice_price_floor', 'clinic_private.assert_compound_adjustable', 'public.clinic_adjust_compound')), dict(defs=defs))

    # ------------------------------------------------------------------ read-only quote
    qv = racik_visit(h, 5140); s0 = state(h, qv)
    qt = h.gagal(f"select clinic_owner_compound_correction_quote({q(qv['recipe'])},{j(ing(2, 2))});", r.OWNER)
    qres = None
    try: qres = json.loads(h.nilai(f"select clinic_owner_compound_correction_quote({q(qv['recipe'])},{j(ing(2, 2))});", r.OWNER))
    except Exception as e: qres = dict(error=str(e)[:200])
    check('quote (read-only): reports cost before 50901.00, after 41800.75, price 50000 and leaves NOTHING changed (stock, layers, issues, audit)',
          qt is None and state(h, qv) == s0 and Decimal(str(qres.get('cost_before'))) == Decimal('50901.00') and Decimal(str(qres.get('cost_after'))) == Decimal('41800.75') and Decimal(str(qres.get('price'))) == 50000 and qres.get('price_below_hpp_after') is False and qres.get('price_below_hpp_before') is True, dict(q=qres))
    real = call(h, qv, ing(2, 2), key='okr-q-1')
    check('the real correction ends with exactly the cost the quote predicted', real is None and hpp_of(h, qv['recipe']) == Decimal(str(qres.get('cost_after'))), dict(error=(real or '')[:160]))
    qd = h.gagal(f"select clinic_owner_compound_correction_quote({q(qv['recipe'])},{j(ing(2, 2))});", r.STAFF)
    check('NEG quote for a non-owner refused (ACCESS_DENIED)', err_has(qd, 'ACCESS_DENIED'), dict(error=(qd or '')[:120]))

    # ------------------------------------------------------------------ concurrency (two real sessions)
    if db is not None: races(h, db)


def races(h, db):
    def blocked(obs, sess):
        for _ in range(40):
            w = obs.sql(f"select coalesce(wait_event_type,'')||'/'||coalesce(wait_event,'') from pg_stat_activity where pid={sess.pid};")
            if w and w[-1].startswith('Lock/'): return w[-1]
            time.sleep(0.15)
        return 'NOT BLOCKED'

    def session(name, user):
        s = c.Session(db, name); s.sql(x.claims(user)); return s
    # (1) correction vs a cashier save that is mid-flight (holds the coordinator): the correction waits, then is refused (row now invoiced)
    k = racik_visit(h, 5150, price=80000); sk0 = state(h, k)
    cart = read_cart(h, k); total = sum(row['qty'] * row['harga'] for row in cart['rows'])
    pay_sql = f"select clinic_save_inpatient_cashier({q(k['stay'])},{q(k['v'])},{q('okr-race-pay' + str(OFF))},'2026-11-03',{q(cart['snapshot'])},{j(cart['rows'])},{j([dict(method='Tunai', amount=total)])},null,false,null,'Kasir Fiktif');"
    with c.Session(db, 'obs') as obs, session('cashier', r.OWNER) as a, session('correct', r.OWNER) as b:
        a.sql('begin;' + pay_sql); b.send(f"select {RPC}({q(k['recipe'])},{j(ing(2, 2))},'Alasan cukup panjang','okr-race-1');")
        wait = blocked(obs, b); a.sql('commit;'); res = c.attempt(b, commit=False)
    sk1 = state(h, k)
    check('race: correction started while a cashier save holds the visit coordinator WAITS (advisory), then is refused because the racikan got invoiced; invoice kept the original HPP',
          wait.endswith('advisory') and not res['ok'] and 'RECIPE_LINKED' in res.get('error', '') and sk1['invoices'] == sk0['invoices'] + 1
          and h.nilai(f"select count(*) from compound_issues where recipe_id={q(k['recipe'])} and posted_invoice_item_id is not null") == '3' and sk1['audit'] == sk0['audit'], dict(wait=wait, res=str(res)[:200]))
    # (2) cashier save waits behind a correction in flight, then sees the lowered HPP and succeeds at price 50000
    k2 = racik_visit(h, 5151)
    with c.Session(db, 'obs2') as obs, session('correct2', r.OWNER) as a, session('cashier2', r.OWNER) as b:
        cart2 = read_cart(h, k2)
        sql2 = f"select clinic_save_inpatient_cashier({q(k2['stay'])},{q(k2['v'])},{q('okr-race2-pay' + str(OFF))},'2026-11-03',{q(cart2['snapshot'])},{j(cart2['rows'])},{j([dict(method='Tunai', amount=50000)])},null,false,null,'Kasir Fiktif');"
        a.sql(f"begin;select {RPC}({q(k2['recipe'])},{j(ing(2, 2))},'Alasan cukup panjang','okr-race2-1');"); b.send(sql2)
        wait2 = blocked(obs, b); a.sql('commit;'); res2 = c.attempt(b, commit=False)
    line = h.nilai(f"select hpp from invoice_items where compound_recipe_id={q(k2['recipe'])}")
    check('race: cashier save started while a correction is in flight WAITS, then posts with the LOWERED HPP 41800.75 and the floor intact',
          wait2.endswith('advisory') and res2['ok'] and line and Decimal(line) == Decimal('41800.75'), dict(wait=wait2, res=str(res2)[:200], line=line))
    # (3) two identical requests at once: one effect
    k3 = racik_visit(h, 5152); s3 = state(h, k3)
    with c.Session(db, 'obs3') as obs, session('twin-a', r.OWNER) as a, session('twin-b', r.OWNER) as b:
        a.sql(f"begin;select {RPC}({q(k3['recipe'])},{j(ing(2, 2))},'Alasan cukup panjang','okr-twin');"); b.send(f"select {RPC}({q(k3['recipe'])},{j(ing(2, 2))},'Alasan cukup panjang','okr-twin');")
        wait3 = blocked(obs, b); a.sql('commit;'); res3 = c.attempt(b, commit=False)
    s3b = state(h, k3)
    check('race: two identical requests at the same time apply ONCE (second waits, then returns the stored result): B +1 only, one audit row',
          wait3.endswith('advisory') and res3['ok'] and float(s3b['stock'][MB]) == float(s3['stock'][MB]) + 1 and s3b['audit'] == s3['audit'] + 1, dict(wait=wait3, res=str(res3)[:200]))


def build(db, exclude):
    tmp = Path(tempfile.mkdtemp(prefix='chain.', dir=ROOT))
    try:
        (tmp / 'supabase/migrations').mkdir(parents=True)
        for f in sorted(MIG.glob('*.sql')):
            if f.name not in exclude: (tmp / 'supabase/migrations' / f.name).symlink_to(f)
        r.fixture.ROOT = tmp
        r.fixture.DisposablePostgres.bootstrap(db)
    finally:
        for f in (tmp / 'supabase/migrations').glob('*'): f.unlink()
        (tmp / 'supabase/migrations').rmdir(); (tmp / 'supabase').rmdir(); tmp.rmdir()


MUTANTS = []   # filled by the mutants file next to this script (name, old text, new text), each anchor must occur exactly once


class Attached(r.NativePostgres):
    def __init__(self, bin_dir, root):
        super().__init__(bin_dir); self.root = Path(root); self.as_user = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
    def __enter__(self): return self
    def __exit__(self, *_): return None


def apply_candidate(db, text): db.sql('begin;\n' + text + '\ncommit;')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin'); ap.add_argument('--attach')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only', help='run only mutants whose name contains this'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    global OFF
    extra = {}
    try:
        if a.attach:
            with Attached(r.BIN, a.attach) as db:
                name = 'okr_dev_%d' % int(time.time()); db.sql(f'create database {name} template postgres;'); os.environ['PGDATABASE'] = name
                if not a.baseline: apply_candidate(db, (MIG / CANDIDATE).read_text())
                run(x.Harness(db), db, setup=False, baseline=a.baseline)
        elif a.mutations:
            from importlib.machinery import SourceFileLoader
            mut = SourceFileLoader('mut', str(ROOT / 'scripts/test-owner-koreksi-racikan-mutants.py')).load_module()
            with r.NativePostgres(r.BIN) as db:
                build(db, {CANDIDATE}); h = x.Harness(db); x.setup(h)
                cand = (MIG / CANDIDATE).read_text(); plan = [('M0 control (unmodified candidate)', cand)]; extra['mutants'] = {}
                for name, pairs in mut.MUTANTS:
                    text, ok = cand, True
                    for old, new, expected in pairs:
                        n = text.count(old)
                        if n != expected: check(name + ' anchor occurs %d time(s)' % expected, False, dict(count=n, anchor=old[:60])); ok = False; break
                        text = text.replace(old, new)
                    if not ok or (a.only and a.only not in name): continue
                    plan.append((name, text))
                for i, (name, text) in enumerate(plan):
                    os.environ.pop('PGDATABASE', None)
                    db.sql(f'create database v{i} template postgres'); os.environ['PGDATABASE'] = f'v{i}'; OFF = 100 * i
                    before = len(RESULTS); crash = None
                    try:
                        apply_candidate(db, text); run(h, db, setup=False)
                    except Exception as e:
                        crash = 'battery aborted: ' + str(e).strip().splitlines()[0][:200]
                    fails = [cc['case'] for cc in RESULTS[before:] if cc['status'] == 'FAIL']
                    del RESULTS[before:]; os.environ.pop('PGDATABASE', None)
                    if i == 0: check(name + ' has 0 FAIL', not fails and not crash, (fails + [crash or ''])[:3])
                    else:
                        extra['mutants'][name] = dict(killed=bool(fails), failing=fails[:4], crash=crash)
                        check(name + ' KILLED', bool(fails), fails[:3]); print('   failing:', fails[:4], flush=True)
        else:
            with r.NativePostgres(r.BIN) as db:
                build(db, {CANDIDATE} if a.baseline else set()); run(x.Harness(db), db, baseline=a.baseline)
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(cc['status'] == s for cc in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='mutations' if a.mutations else 'RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
