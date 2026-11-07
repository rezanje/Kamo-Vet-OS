#!/usr/bin/env python3
"""OWNER 'Tarik baris dari tagihan lunas': removes WHOLE lines from an already paid (advance-applied) RANAP invoice in place,
same invoice number, delta journals dated today, stock restored at the recorded cost, the leftover becomes the patient's advance balance
(migration 20261107150000_owner_tarik_baris_lunas.sql).

Native full schema, fictional fixtures, throwaway local cluster, no network.
  flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-owner-tarik-baris-lunas-postgres.py --pg-bin DIR --json out.json
  --baseline    chain WITHOUT the candidate migration: every owner case must FAIL (RED)
  --mutations   chain without the candidate once, then each mutant of the candidate in a cloned database; all must be killed
  --attach DIR  dev only: clone of the `postgres` DB (chain WITHOUT candidate, x.setup done) in a running cluster, candidate applied on top
"""
import argparse, contextlib, importlib.util, json, os, sys, tempfile, time
from decimal import Decimal
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('okr', ROOT / 'scripts/test-owner-koreksi-racikan-postgres.py'); assert spec and spec.loader
okr = importlib.util.module_from_spec(spec); spec.loader.exec_module(okr)
m, x, r, q, j, c = okr.m, okr.x, okr.r, okr.q, okr.j, okr.c
CANDIDATE = '20261107150000_owner_tarik_baris_lunas.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = []
RPC, QUOTE = 'clinic_owner_remove_invoice_lines', 'clinic_owner_invoice_lines_quote'
TGL = r.TGL
# own catalogue: procedure items (job order + jasa), BMHP components with cents (live shape of Infus Refill), plain stock item, a Jasa item for the next stage
CAT, INF, JBM, INJ, PLN, SVC, C1, C2, C3, C4 = (r.uid('e', 9300 + i) for i in range(10))
INF_PARTS = [(C1, 1, Decimal('9770.15')), (C2, 10, Decimal('701.52')), (C3, 5, Decimal('671.85')), (C4, 1, Decimal('9433.69'))]   # Infus Rl / Syringe 1 ML / Syringe 3 ML / Meloxicam Inj
INF_HPP = Decimal('29578.29')
CASH = '110003'
ACCTS = ('110003', '120002', '150001', '170001', '314001', '510002', '600001')


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:420], flush=True)


def err_has(err, *words): return bool(err) and all(w in err for w in words)


def prep(h):
    okr.prep(h)     # racikan materials A/B (+ layers)
    h.sql(f"""
insert into public.item_categories(id,name) values ({q(CAT)},'TINDAKAN');
insert into public.items(id,code,name,unit,item_type,is_active,sell_price,buy_price,category_id) values
 ({q(INF)},'TBL-INF','Infus Refill Fiktif','kali','Persediaan',true,30000,0,{q(CAT)}),
 ({q(INJ)},'TBL-INJ','Injeksi Fiktif','kali','Persediaan',true,50000,0,{q(CAT)}),
 ({q(JBM)},'TBL-JBM','Tindakan Jasa BMHP Fiktif','kali','Jasa',true,50000,0,{q(CAT)}),
 ({q(SVC)},'TBL-SVC','Jasa Tahap Berikut Fiktif','kali','Jasa',true,50000,0,null);
insert into public.items(id,code,name,unit,item_type,is_active,sell_price,buy_price) values
 ({q(PLN)},'TBL-PLN','Obat Biasa Fiktif','pcs','Persediaan',true,5000,1000),
 ({q(C1)},'TBL-C1','Infus Rl Fiktif','pcs','Persediaan',true,0,1),({q(C2)},'TBL-C2','Syringe 1 ML Fiktif','pcs','Persediaan',true,0,1),
 ({q(C3)},'TBL-C3','Syringe 3 ML Fiktif','pcs','Persediaan',true,0,1),({q(C4)},'TBL-C4','Meloxicam Inj Fiktif','pcs','Persediaan',true,0,1);
insert into public.stock(warehouse_id,item_id,qty) values ({q(r.WH)},{q(INF)},0),({q(r.WH)},{q(INJ)},0),({q(r.WH)},{q(PLN)},0),({q(r.WH)},{q(C1)},0),({q(r.WH)},{q(C2)},0),({q(r.WH)},{q(C3)},0),({q(r.WH)},{q(C4)},0);
""")


def layer(h, item, qty, cost, day='2026-01-01'):
    h.sql(f"insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values ({q(r.WH)},{q(item)},'{day}',{qty},{qty},{cost},'purchase');"
          f"update public.stock set qty=qty+{qty} where warehouse_id={q(r.WH)} and item_id={q(item)};")


def stock_for(h, with_inf=True, with_jbm=True, with_inj=True, with_pln=True):
    """Fresh EARLIEST layers per fixture so every fixture's HPP is known to the cent (constant costs, so leftovers of older fixtures are interchangeable)."""
    if with_inf:
        for item, qty, cost in INF_PARTS: layer(h, item, qty, cost)
    if with_jbm: layer(h, C4, 1, '9433.69')
    if with_inj: layer(h, C4, 1, '9433.69'); layer(h, INJ, 1, '2600.74')     # an older INJ layer makes the line HPP (2600.74) differ from its BMHP cost (9433.69), like the live Injeksi Non Antibiotik
    if with_pln: layer(h, PLN, 1, '1234.56', '2026-01-01'); layer(h, PLN, 2, '1300.10', '2026-01-02')


def doctor_rows(h, mr, specs):
    cur = m.rows(h, mr); rev = int(h.nilai(f"select clinical_revision from medical_records where id={q(mr)}"))
    new = []
    for item, name, qty, harga, kind, comps in specs:
        row = dict(item_id=item, nama_obat=name, qty=qty, harga=harga, satuan='kali' if kind != 'pcs' else 'pcs', jenis='jasa' if kind == 'jasa' else 'obat', faktor=1)
        if comps: row['bmhp_components'] = [dict(item_id=i, qty=qq, unit='pcs') for i, qq, _ in comps]
        new.append(row)
    err = h.gagal(m.edit(h.nilai(f"select visit_id from medical_records where id={q(mr)}"), mr, rev, cur + new, 'tbl-add-' + mr[-6:]), r.DOCTOR)
    if err: raise RuntimeError('doctor edit failed: ' + err[:300])


def read_cart(h, F): return json.loads(h.nilai(f"select clinic_read_inpatient_cashier({q(F['stay'])},{q(F['v'])});", r.STAFF))


def cashier_save(h, F, key, parts, rows=None, user=r.OWNER, reason='Bayar tahap Fiktif', dp_reason=None):
    cart = read_cart(h, F); rows = cart['rows'] if rows is None else rows
    return h.gagal(f"select clinic_save_inpatient_cashier({q(F['stay'])},{q(F['v'])},{q(key)},{q(TGL)},{q(cart['snapshot'])},{j(rows)},{j(parts)},null,false,{q(dp_reason) if dp_reason else 'null'},{q(reason)});", user), cart


def build(h, n, pay='advance', adv_amount=None, lines=('INF', 'JBM', 'INJ', 'PLN', 'RAC'), racik_price=80000):
    """Live case 1 shape: RANAP visit, advance received by BANK TRANSFER, 'Simpan & bayar' applies the advance to the whole stage invoice.
    Lines: Infus Refill (BMHP job order, hpp = BMHP cost), a Jasa with BMHP, a job-order line whose HPP != its BMHP cost, a plain stock item (qty 3), a racikan, plus 4 base lines.
    pay: 'advance' (Lunas by Uang Muka only), 'cash' (Tunai), 'bank' (Transfer), 'none' (Belum Lunas), 'mixed' (part advance + part Tunai)."""
    v, mr = m.visit(h, n)
    cust = h.nilai(f"select customer_id from visits where id={q(v)}"); stay = h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
    stock_for(h, 'INF' in lines, 'JBM' in lines, 'INJ' in lines, 'PLN' in lines)
    specs = []
    if 'INF' in lines: specs.append((INF, 'Infus Refill Fiktif', 1, 30000, 'obat', INF_PARTS))
    if 'JBM' in lines: specs.append((JBM, 'Tindakan Jasa BMHP Fiktif', 1, 50000, 'jasa', [(C4, 1, None)]))
    if 'INJ' in lines: specs.append((INJ, 'Injeksi Fiktif', 1, 50000, 'obat', [(C4, 1, None)]))
    if 'PLN' in lines: specs.append((PLN, 'Obat Biasa Fiktif', 3, 5000, 'pcs', None))
    if specs: doctor_rows(h, mr, specs)
    if 'RAC' in lines: okr.issue_racikan(h, v, mr, n, f'tbl-rac-{n}', racik_price, 2, 3)
    F = dict(v=v, mr=mr, stay=stay, cust=cust, n=n)
    cart = read_cart(h, F); total = int(sum(row['qty'] * row['harga'] for row in cart['rows'])); F['total'] = total
    before = {a: h.saldo(a) for a in ACCTS}; F['before'] = before; F['tb_before'] = h.angka('select coalesce(sum(debit)-sum(credit),0) from journal_lines')
    if pay in ('advance', 'mixed'):
        amt = total if pay == 'advance' else (adv_amount or total // 2)
        err = h.gagal(r.bayar_sql(v, f'tbl-adv-{n}', [dict(method='Transfer', amount=amt)]), r.OWNER)
        if err: raise RuntimeError('advance receipt failed: ' + err[:300])
        F['adv'] = h.nilai(f"select id from clinic_customer_advances where visit_id={q(v)} and status='aktif' order by created_at limit 1")
        F['adv_no'] = h.nilai(f"select no_uang_muka from clinic_customer_advances where id={q(F['adv'])}")
        F['receipt'] = h.nilai(f"select receipt_id from clinic_customer_advances where id={q(F['adv'])}")
        parts = [] if pay == 'advance' else [dict(method='Tunai', amount=total - amt)]
    elif pay == 'cash': parts = [dict(method='Tunai', amount=total)]
    elif pay == 'bank': parts = [dict(method='Transfer', amount=total)]
    else: parts = []
    err, _ = cashier_save(h, F, f'tbl-pay-{n}', parts, dp_reason='Uji fiktif tanpa uang muka' if pay == 'none' else None)
    if err: raise RuntimeError('cashier save failed: ' + err[:400])
    inv = h.aktif(v); F['inv'] = inv; F['no'] = h.no_tagihan(inv)
    for role, desc in dict(INF='Infus Refill Fiktif', JBM='Tindakan Jasa BMHP Fiktif', INJ='Injeksi Fiktif', PLN='Obat Biasa Fiktif', RAC='Obat Racik Fiktif', BASE1='Jasa Rawat Inap Fiktif', BASE2='Jasa Perawatan Fiktif', OBAT='Obat Fiktif', BASE4='Jasa Tambahan Fiktif').items():
        F[role] = h.nilai(f"select id from invoice_items where invoice_id={q(inv)} and deskripsi={q(desc)}") or None
    F['rx'] = {k: h.nilai(f"select prescription_item_id from invoice_items where id={q(F[k])}") for k in ('INF', 'JBM', 'INJ', 'PLN', 'RAC', 'BASE1') if F.get(k)}
    return F


def L(*ids, qty=None):
    out = []
    for i in ids:
        row = dict(invoice_item_id=i)
        if qty is not None: row['qty'] = qty
        out.append(row)
    return out


def call(h, F, lines, reason='Barang tidak jadi dipakai, dikoreksi Owner', key=None, user=r.OWNER, fn=RPC, inv=None):
    key = key or f'tk-{F["n"]}-{abs(hash(json.dumps(lines) + reason)) % 10**8}'
    return h.gagal(f"select {fn}({q(inv or F['inv'])},{j(lines)},{q(reason)},{q(key)});", user)


def callv(h, F, lines, reason='Barang tidak jadi dipakai, dikoreksi Owner', key=None, user=r.OWNER, inv=None):
    key = key or f'tk-{F["n"]}-{abs(hash(json.dumps(lines) + reason)) % 10**8}'
    try: return json.loads(h.nilai(f"select {RPC}({q(inv or F['inv'])},{j(lines)},{q(reason)},{q(key)});", user)), None
    except Exception as e: return None, str(e)


def quote(h, F, lines, user=r.OWNER):
    try: return json.loads(h.nilai(f"select {QUOTE}({q(F['inv'])},{j(lines)});", user)), None
    except Exception as e: return None, str(e)


ITEMS = (INF, INJ, PLN, C1, C2, C3, C4, JBM)


def snap(h, F):
    """Everything the correction may or may not touch, as one comparable value (no time-varying noise)."""
    return json.loads(h.nilai(f"""select jsonb_build_object(
 'invoice',(select to_jsonb(i) from invoices i where id={q(F['inv'])}),
 'items',(select coalesce(jsonb_agg(to_jsonb(ii) order by id),'[]') from invoice_items ii where invoice_id={q(F['inv'])}),
 'pays',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from invoice_payments p where invoice_id={q(F['inv'])}),
 'apps',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from clinic_advance_applications a where invoice_id={q(F['inv'])}),
 'advances',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from clinic_customer_advances a where visit_id={q(F['v'])}),
 'rx',(select coalesce(jsonb_agg(jsonb_build_array(p.id,p.billing_withdrawn_at is not null) order by p.id),'[]') from prescription_items p join medical_records mm on mm.id=p.medical_record_id where mm.visit_id={q(F['v'])}),
 'journals',(select count(*) from journal_entries),
 'tb',(select coalesce(sum(debit)-sum(credit),0) from journal_lines),
 'stock',(select coalesce(jsonb_object_agg(item_id::text,qty),'{{}}') from stock where warehouse_id={q(r.WH)} and item_id in ({','.join(q(i) for i in ITEMS)})),
 'layers',(select count(*) from stock_layers where item_id in ({','.join(q(i) for i in ITEMS)})),
 'moves',(select count(*) from stock_moves),
 'issues',(select coalesce(jsonb_agg(jsonb_build_array(id,posted_invoice_item_id) order by id),'[]') from compound_issues where posted_invoice_item_id in (select id from invoice_items where invoice_id={q(F['inv'])})),
 'audit',(case when to_regclass('clinic_private.owner_invoice_corrections') is null then 0 else (xpath('/row/c/text()',query_to_xml('select count(*) as c from clinic_private.owner_invoice_corrections',false,true,'')))[1]::text::int end)
)"""))


def fix(s): return {k: v for k, v in s.items() if k != 'audit'}


def refused(h, F, name, lines, words, reason='Barang tidak jadi dipakai, dikoreksi Owner', user=r.OWNER, key=None, inv=None):
    s0 = snap(h, F); err = call(h, F, lines, reason=reason, user=user, key=key, inv=inv); s1 = snap(h, F)
    check(name, err_has(err, *words) and s1 == s0, dict(error=(err or 'NO ERROR')[:220], changed=s1 != s0))
    return err


def jdelta(h, F, before_ids):
    rows = json.loads(h.nilai(f"""select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'source',e.source,'tanggal',e.tanggal::text,'ref',e.source_ref,
  'lines',(select coalesce(jsonb_agg(jsonb_build_object('code',a.code,'debit',l.debit,'credit',l.credit) order by a.code,l.debit,l.credit),'[]') from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=e.id)) order by e.created_at,e.id),'[]')
 from journal_entries e where e.source_ref={q(F['no'])}"""))
    return [x_ for x_ in rows if x_['id'] not in before_ids]


def jids(h, F): return set(json.loads(h.nilai(f"select coalesce(jsonb_agg(id),'[]') from journal_entries where source_ref={q(F['no'])}")))


def lines_of(entry): return sorted((l['code'], Decimal(str(l['debit'])), Decimal(str(l['credit']))) for l in entry['lines'])


def advance_row(h, F): return json.loads(h.nilai(f"select to_jsonb(a) from clinic_customer_advances a where id={q(F['adv'])}"))


def run(h, db=None, setup=True, baseline=False, sections=None):
    if setup: x.setup(h)
    prep(h)
    S = lambda name: sections is None or name in sections
    have = h.nilai(f"select (to_regprocedure('public.{RPC}(uuid,jsonb,text,text)') is not null)::text||'|'||(to_regprocedure('public.{QUOTE}(uuid,jsonb)') is not null)::text||'|'||(to_regclass('clinic_private.owner_invoice_corrections') is not null)::text")
    check('preflight: RPC, quote and audit table exist', have == 'true|true|true', dict(have=have))
    if S('main'): sec_main(h, have)
    if S('life'): sec_life(h)
    if S('gap'): sec_gap(h)
    if S('neg'): sec_neg(h)
    if S('scope'): sec_scope(h)
    if S('static'): sec_static(h)
    if db is not None and S('race'): races(h, db)


def sec_main(h, have):
    today = h.nilai('select current_date::text')
    # ------------------------------------------------------------------ the live case 1 shape
    F = build(h, 7001)
    inv0 = json.loads(h.nilai(f"select to_jsonb(i) from invoices i where id={q(F['inv'])}"))
    adv0 = advance_row(h, F)
    pay0 = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_array(metode,amount,kas_code,reversal_of) order by created_at),'[]') from invoice_payments where invoice_id={q(F['inv'])}"))
    check('fixture: stage invoice Lunas, paid ONLY by Uang Muka (one payment = total) from an advance received by Transfer to the BANK; no cash drawer money',
          inv0['paid_status'] == 'Lunas' and Decimal(str(inv0['total'])) == F['total'] and len(pay0) == 1 and pay0[0][0] == 'Uang Muka' and Decimal(str(pay0[0][1])) == F['total'] and pay0[0][2] == '314001'
          and Decimal(str(adv0['applied'])) == F['total'] and Decimal(str(adv0['amount'])) == F['total'] and h.nilai(f"select string_agg(kas_code,',') from clinic_payment_receipt_parts where receipt_id={q(F['receipt'])}") == '120002'
          and Decimal(str(inv0['discount'])) == 0 and Decimal(str(inv0['tax'])) == 0 and Decimal(str(inv0['dp_amount'])) == 0 and bool(inv0['stage_billing']),
          dict(total=F['total'], status=inv0['paid_status'], pays=pay0))
    hpp_rows = {k: Decimal(h.nilai(f"select hpp from invoice_items where id={q(F[k])}")) for k in ('INF', 'JBM', 'INJ', 'PLN', 'RAC')}
    check('fixture: line HPPs known to the cent: Infus Refill 29578.29 = its BMHP cost; Jasa BMHP 9433.69; Injeksi 2600.74 (!= its BMHP cost 9433.69); plain 3834.76; racikan 50901.00',
          hpp_rows == dict(INF=INF_HPP, JBM=Decimal('9433.69'), INJ=Decimal('2600.74'), PLN=Decimal('3834.76'), RAC=Decimal('50901.00')), dict(h={k: str(v) for k, v in hpp_rows.items()}))
    cart_after = read_cart(h, F)
    check('fixture: the cashier cart is empty after the paid save (nothing pending)', len(cart_after['rows']) == 0, dict(rows=len(cart_after['rows'])))

    # quote first: read-only, leaves NOTHING changed
    s0 = snap(h, F)
    qres, qerr = quote(h, F, L(F['INF']))
    s_q = snap(h, F)
    check('quote (read-only) of the Infus Refill line: delta 30000, hpp 29578.29, same invoice, advance balance 0 -> 30000, 4 components back to stock; NOTHING changed (rows, stock, layers, journals, audit)',
          qres is not None and s_q == s0 and Decimal(str(qres.get('removed_total'))) == 30000 and Decimal(str(qres.get('hpp_removed'))) == INF_HPP and qres.get('invoice_no') == F['no']
          and Decimal(str(qres['total_before'])) == F['total'] and Decimal(str(qres['total_after'])) == F['total'] - 30000
          and Decimal(str(qres['advance']['balance_before'])) == 0 and Decimal(str(qres['advance']['balance_after'])) == 30000 and len(qres.get('stock', [])) == 4 and qres.get('dry') is True,
          dict(error=(qerr or '')[:200], q=str(qres)[:300]))
    qd = h.gagal(f"select {QUOTE}({q(F['inv'])},{j(L(F['INF']))});", r.STAFF)
    check('NEG quote for a non-owner refused (ACCESS_DENIED)', err_has(qd, 'ACCESS_DENIED'), dict(error=(qd or '')[:120]))

    try: chk = json.loads(h.nilai(f"select clinic_owner_invoice_lines_check({q(F['inv'])});", r.OWNER))
    except Exception as e: chk = dict(error=str(e)[:200], lines=[])
    byid = {l_['invoice_item_id']: l_ for l_ in chk.get('lines', [])}
    check('check RPC (screen): every line listed; Infus, Jasa BMHP, plain, base lines eligible; racikan and the mismatching Injeksi NOT eligible with their own reason; nothing changed',
          len(byid) == len(s0['items']) and byid.get(F['INF'], {}).get('eligible') is True and byid.get(F['JBM'], {}).get('eligible') is True and byid.get(F['PLN'], {}).get('eligible') is True and byid.get(F['BASE1'], {}).get('eligible') is True
          and byid.get(F['RAC'], {}).get('eligible') is False and 'RECIPE_LINKED' in (byid.get(F['RAC'], {}).get('message') or '') and byid.get(F['INJ'], {}).get('eligible') is False and 'COST_MISMATCH' in (byid.get(F['INJ'], {}).get('message') or '')
          and snap(h, F) == s0, dict(error=chk.get('error'), n=len(byid)))
    cd = h.gagal(f"select clinic_owner_invoice_lines_check({q(F['inv'])});", r.STAFF)
    check('NEG check RPC for a non-owner refused (ACCESS_DENIED)', err_has(cd, 'ACCESS_DENIED'), dict(error=(cd or '')[:120]))
    # ------------------------------------------------------------------ GREEN: the live correction
    s_before = snap(h, F); jb = jids(h, F); items_before = {i['id']: i for i in s_before['items']}
    res, err = callv(h, F, L(F['INF']), key='tbl-main-1')
    s1 = snap(h, F); inv1 = s1['invoice']
    check('GREEN owner removes the Infus Refill line: ok, same invoice number, total 875200-style -30000, status Lunas, subtotal follows',
          err is None and res and res.get('status') == 'OK' and inv1['invoice_no'] == F['no'] and Decimal(str(inv1['total'])) == F['total'] - 30000 and Decimal(str(inv1['subtotal'])) == F['total'] - 30000
          and inv1['paid_status'] == 'Lunas' and Decimal(str(inv1['discount'])) == 0 and Decimal(str(inv1['tax'])) == 0 and inv1['id'] == F['inv'],
          dict(error=(err or '')[:300], total=inv1['total'], status=inv1['paid_status']))
    gone = [i for i in s_before['items'] if i['id'] not in {k['id'] for k in s1['items']}]
    kept_same = all(items_before[k['id']] == k for k in s1['items'])
    check('lines: ONLY the Infus Refill line is gone; every other line row is byte-identical (ids, hpp, bmhp snapshots, performers), racikan line included',
          len(gone) == 1 and gone[0]['id'] == F['INF'] and kept_same and len(s1['items']) == len(s_before['items']) - 1 and F['RAC'] in {k['id'] for k in s1['items']}, dict(gone=[g['id'] for g in gone]))
    check('racikan untouched: compound_issues.posted_invoice_item_id rows identical', s1['issues'] == s_before['issues'] and len(s1['issues']) == 3, dict(n=len(s1['issues'])))
    # payments / advance
    pays = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_array(metode,amount,kas_code,reversal_of is not null,tanggal::text) order by created_at,id),'[]') from invoice_payments where invoice_id={q(F['inv'])}"))
    orig_pay = h.nilai(f"select id from invoice_payments where invoice_id={q(F['inv'])} and amount>0")
    neg = json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(p)),'[]') from invoice_payments p where invoice_id={q(F['inv'])} and amount<0"))
    check('payments: original Uang Muka row kept, ONE reversal row -30000 (Uang Muka, 314001, reversal_of the original, dated today); received == new total',
          len(pays) == 2 and len(neg) == 1 and Decimal(str(neg[0]['amount'])) == -30000 and neg[0]['metode'] == 'Uang Muka' and neg[0]['kas_code'] == '314001' and neg[0]['reversal_of'] == orig_pay and neg[0]['tanggal'] == today
          and h.diterima(F['inv']) == float(F['total'] - 30000), dict(pays=pays))
    adv1 = advance_row(h, F)
    app = json.loads(h.nilai(f"select to_jsonb(a) from clinic_advance_applications a where invoice_id={q(F['inv'])}"))
    check('advance: application reduced to total-30000, advance.applied reduced by exactly 30000 (balance 30000, still active, NOT released so the next stage uses it), amount unchanged',
          Decimal(str(app['amount'])) == F['total'] - 30000 and app['released_at'] is None and Decimal(str(adv1['applied'])) == F['total'] - 30000 and Decimal(str(adv1['amount'])) == F['total']
          and Decimal(str(adv1['amount'])) - Decimal(str(adv1['applied'])) == 30000 and adv1['status'] == 'aktif' and adv1['released_at'] is None
          and Decimal(str(res['advance']['balance_after'])) == 30000, dict(app=app['amount'], adv=adv1['applied']))
    # stock
    st0, st1 = s_before['stock'], s1['stock']
    new_layers = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_array(item_id,qty_in,qty_left,unit_cost,source,exp_date,tanggal::text) order by item_id),'[]') from stock_layers where source='klinik-edit' and source_ref={q(F['no'])}"))
    want = sorted([(i, float(qq), float(cc)) for i, qq, cc in INF_PARTS])
    got = sorted([(l[0], float(l[1]), float(l[3])) for l in new_layers])
    check('stock: exactly the 4 BMHP components come back as NEW layers (no expiry date, source klinik-edit, dated today) at their recorded cost: value 29578.29 to the cent',
          got == want and all(l[5] is None and float(l[1]) == float(l[2]) and l[6] == today for l in new_layers) and sum(Decimal(str(l[1])) * Decimal(str(l[3])) for l in new_layers).quantize(Decimal('0.01')) == INF_HPP and len(new_layers) == 4,
          dict(layers=new_layers))
    check('stock: balances +1/+10/+5/+1 for the components; Infus Refill (job-order item), Injeksi and plain item unchanged (net 0); 4 stock moves klinik-edit; no other layer created',
          all(float(st1[i]) - float(st0[i]) == qq for i, qq, _ in INF_PARTS) and float(st1[INF]) == float(st0[INF]) and float(st1[PLN]) == float(st0[PLN]) and float(st1[INJ]) == float(st0[INJ])
          and s1['moves'] == s_before['moves'] + 4 and s1['layers'] == s_before['layers'] + 4 and h.nilai(f"select count(*) from stock_moves where source='klinik-edit' and source_ref={q(F['no'])}") == '4',
          dict(d={k: float(st1[k]) - float(st0[k]) for k in st0}))
    # journals
    dj = jdelta(h, F, jb)
    by = {e['source']: e for e in dj}
    rev_ok = 'klinik-edit' in by and lines_of(by['klinik-edit']) == sorted([('150001', Decimal(0), Decimal(30000)), ('510002', Decimal(30000), Decimal(0))])
    hpp_ok = 'klinik-hpp-edit' in by and lines_of(by['klinik-hpp-edit']) == sorted([('170001', INF_HPP, Decimal(0)), ('600001', Decimal(0), INF_HPP)])
    ar_ok = 'klinik-ar' in by and lines_of(by['klinik-ar']) == sorted([('150001', Decimal(30000), Decimal(0)), ('314001', Decimal(0), Decimal(30000))])
    check('journals: exactly 3 new entries dated TODAY (revenue Dr 510002/Cr 150001 30000; HPP Dr 170001/Cr 600001 29578.29; advance Dr 150001/Cr 314001 30000), each balanced',
          len(dj) == 3 and rev_ok and hpp_ok and ar_ok and all(e['tanggal'] == today for e in dj) and all(sum(Decimal(str(l['debit'])) for l in e['lines']) == sum(Decimal(str(l['credit'])) for l in e['lines']) for e in dj),
          dict(src=[e['source'] for e in dj], dates=[e['tanggal'] for e in dj]))
    after = {a: h.saldo(a) for a in ACCTS}
    dlt = {a: round(after[a] - F['before'][a], 2) for a in ACCTS}   # since before the fixture's receipt (the original sale and advance included)
    check('trial balance: debits == credits to the cent before and after; bank 120002 holds only the original transfer and cash 110003 did NOT move; 150001 net 0 for this invoice; 314001 holds exactly the 30000 leftover; revenue and HPP follow the remaining lines',
          h.angka('select coalesce(sum(debit)-sum(credit),0) from journal_lines') == 0 and s1['tb'] == 0 and s_before['tb'] == 0
          and h.saldo_ref('150001', F['no']) == 0 and h.saldo_ref('510002', F['no']) == -(float(F['total']) - 30000) and h.saldo_ref('600001', F['no']) == float(hpp_total(h, F)) and h.saldo_ref('170001', F['no']) == -float(hpp_total(h, F))
          and dlt['314001'] == -30000.0 and dlt['120002'] == float(F['total']) and dlt['110003'] == 0,
          dict(dlt=dlt, tb=(s_before['tb'], s1['tb'])))
    # prescription withdrawn and never billable again
    rxd = json.loads(h.nilai(f"select to_jsonb(p) from prescription_items p where id={q(F['rx']['INF'])}"))
    check('medical record: the prescription row is KEPT but withdrawn from billing (at, by owner, reason); other rows untouched',
          rxd['billing_withdrawn_at'] is not None and rxd['billing_withdrawn_by'] == r.OWNER and 'Barang tidak jadi dipakai' in (rxd['billing_withdrawal_reason'] or '')
          and h.nilai(f"select count(*) from prescription_items p join medical_records mm on mm.id=p.medical_record_id where mm.visit_id={q(F['v'])} and p.billing_withdrawn_at is not null") == '1', dict(rx=str(rxd)[:200]))
    cart2 = read_cart(h, F)
    check('cart/loader does NOT resurrect the line: pending cart still empty, nothing to bill', len(cart2['rows']) == 0 and cart2['quote']['pending'] == 0, dict(rows=len(cart2['rows']), pending=cart2['quote']['pending']))
    err_b = h.gagal(r.tagih_sql(F['v'], 'tbl-rebill', [dict(description='Infus Refill Fiktif', qty=1, price=30000, kind='obat', item_id=INF, unit='kali', prescription_item_id=F['rx']['INF'], recipe_id=None, discount_percent=0)], r.OWNER), r.OWNER)
    check('the withdrawn row cannot be billed again by any stage RPC (CART_INVALID)', bool(err_b) and 'CART_INVALID' in err_b, dict(error=(err_b or '')[:160]))
    # audit
    au = json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(a)),'[]') from clinic_private.owner_invoice_corrections a where invoice_id={q(F['inv'])}")) if have.endswith('true') else []
    check('audit row: actor, invoice + number, reason, request_key, removed line snapshot, totals before/after, hpp, stock effects, journals, advance before/after',
          len(au) == 1 and au[0]['actor_id'] == r.OWNER and au[0]['invoice_no'] == F['no'] and au[0]['request_key'] == 'tbl-main-1' and au[0]['reason'].startswith('Barang tidak jadi dipakai')
          and Decimal(str(au[0]['total_before'])) == F['total'] and Decimal(str(au[0]['total_after'])) == F['total'] - 30000 and Decimal(str(au[0]['hpp_removed'])) == INF_HPP and au[0]['created_at']
          and F['INF'] in json.dumps(au[0]['removed_lines']) and len(au[0]['stock_effects']) == 4 and len(au[0]['journal_ids']) == 3 and Decimal(str(au[0]['advance_balance_after'])) == 30000, dict(au=str(au[:1])[:300]))
    el = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_array(field_changed,old_value,new_value,edited_by)),'[]') from invoice_edit_log where invoice_id={q(F['inv'])}"))
    check('invoice_edit_log: one row total old -> new by the owner, reason mentions Tarik baris', len(el) == 1 and el[0][0] == 'total' and Decimal(el[0][1]) == F['total'] and Decimal(el[0][2]) == F['total'] - 30000 and el[0][3] == r.OWNER, dict(el=el))
    # replay
    sr = snap(h, F)
    res2, err2 = callv(h, F, L(F['INF']), key='tbl-main-1')
    check('replay: same request_key + same payload is idempotent (returns the stored result, nothing moves, one audit row)', err2 is None and res2 and res2.get('replayed') is True and snap(h, F) == sr, dict(error=(err2 or '')[:160]))
    e3 = call(h, F, L(F['BASE4']), key='tbl-main-1')
    check('replay with a DIFFERENT line under the same key refused (IDEMPOTENCY_CONFLICT), nothing changes', err_has(e3, 'IDEMPOTENCY_CONFLICT') and snap(h, F) == sr, dict(error=(e3 or '')[:160]))
    e4 = call(h, F, L(F['INF']), key='tbl-main-1', reason='Alasan lain yang cukup panjang')
    check('replay with a DIFFERENT reason under the same key refused (IDEMPOTENCY_CONFLICT)', err_has(e4, 'IDEMPOTENCY_CONFLICT') and snap(h, F) == sr, dict(error=(e4 or '')[:160]))
    refused(h, F, 'the same line again under a NEW key is refused (line no longer on the invoice), nothing changes', L(F['INF']), ['LINE_INVALID'], key='tbl-main-2')
    refused(h, F, 'GREEN-state negative: the Injeksi line (hpp 2600.74 != BMHP cost 9433.69) is refused (COST_MISMATCH), nothing changes', L(F['INJ']), ['COST_MISMATCH'], key='tbl-main-3')
    refused(h, F, 'racikan line refused (RECIPE_LINKED), nothing changes', L(F['RAC']), ['RECIPE_LINKED'], key='tbl-main-4')
    refused(h, F, 'partial quantity refused: plain line qty 3, asking for 1 (PARTIAL_NOT_ALLOWED)', L(F['PLN'], qty=1), ['PARTIAL_NOT_ALLOWED'], key='tbl-main-5')

    # ------------------------------------------------------------------ the leftover is really usable: next stage consumes the 30000
    nid = r.uid('e', 9390)
    rows = read_cart(h, F)['rows'] + [dict(id=nid, item_id=SVC, nama_obat='Jasa Tahap Berikut Fiktif', qty=1, harga=50000, satuan='kali', jenis='jasa')]
    e5, cart = cashier_save(h, F, 'tbl-next-1', [dict(method='Tunai', amount=20000)], rows=rows)
    adv2 = advance_row(h, F)
    inv_next = h.nilai(f"select id from invoices where visit_id={q(F['v'])} and voided_at is null and id<>{q(F['inv'])} order by created_at desc limit 1")
    check('next stage: the 30000 leftover of the SAME advance is applied automatically (its balance is 0 again) and only 20000 new money is needed (received as its own advance and applied); the corrected invoice is untouched',
          e5 is None and Decimal(str(adv2['applied'])) == Decimal(str(adv2['amount'])) and h.diterima(inv_next) == 50000.0 and h.angka(f"select coalesce(sum(amount),0) from clinic_advance_applications where invoice_id={q(inv_next)} and advance_id={q(F['adv'])}") == 30000.0
          and h.angka(f"select coalesce(sum(amount),0) from clinic_advance_applications where invoice_id={q(inv_next)}") == 50000.0
          and h.diterima(F['inv']) == float(F['total'] - 30000), dict(error=(e5 or '')[:240], applied=adv2['applied']))
    # P03 still guards a later stage
    layer(h, PLN, 5, '1234.56', '2026-01-03'); nid2 = r.uid('e', 9391)
    rows2 = read_cart(h, F)['rows'] + [dict(id=nid2, item_id=PLN, nama_obat='Obat Biasa Fiktif', qty=1, harga=100, satuan='pcs', jenis='obat')]
    e6, _ = cashier_save(h, F, 'tbl-floor-1', [dict(method='Tunai', amount=100)], rows=rows2)
    check('P03 untouched: a later stage line priced below its HPP is still refused (PRICE_BELOW_HPP)', err_has(e6, 'PRICE_BELOW_HPP'), dict(error=(e6 or '')[:200]))


def sec_life(h):
    F = None
    # ------------------------------------------------------------------ interaction with the advance lifecycle (ADVANCE_IMBALANCE)
    G = build(h, 7002)
    r0 = call(h, G, L(G['INF']), key='tbl-adv-int-1')
    e_void = h.gagal(r.batal_kwitansi_sql(G['receipt'], 'tbl-void-0'), r.OWNER)
    check('void receipt right after a correction is still refused with ADVANCE_USED (the advance is applied)', r0 is None and err_has(e_void, 'ADVANCE_USED'), dict(error=(e_void or '')[:160]))
    e_rel = h.gagal(r.lepas_sql(G['adv'], 'tbl-rel-1'), r.OWNER)
    adv_g = advance_row(h, G)
    check('release of the advance application after a correction works: applied back to 0, invoice no longer paid, payments sum to 0',
          e_rel is None and Decimal(str(adv_g['applied'])) == 0 and h.diterima(G['inv']) == 0 and h.status_bayar(G['inv']) == 'Belum Lunas', dict(error=(e_rel or '')[:200], applied=adv_g['applied']))
    e_void = h.gagal(r.batal_kwitansi_sql(G['receipt'], 'tbl-void-1'), r.OWNER)
    check('void receipt AFTER the release works: NO ADVANCE_IMBALANCE; receipt cancelled', e_void is None and h.nilai(f"select status from clinic_payment_receipts where id={q(G['receipt'])}") == 'batal', dict(error=(e_void or '')[:200]))
    aftg = {a: h.saldo(a) for a in ACCTS}
    check('after correction + release + void: advance liability 314001, bank 120002 and cash all back to their pre-fixture balance; the invoice is an open receivable of exactly the corrected total; revenue only what the remaining lines were; trial balance 0',
          aftg['314001'] == G['before']['314001'] and aftg['120002'] == G['before']['120002'] and aftg['110003'] == G['before']['110003'] and h.saldo_ref('150001', G['no']) == float(G['total'] - 30000)
          and h.saldo_ref('510002', G['no']) == -float(G['total'] - 30000) and h.angka('select coalesce(sum(debit)-sum(credit),0) from journal_lines') == 0,
          dict(delta={a: round(aftg[a] - G['before'][a], 2) for a in ACCTS}))
    # leftover consumed by a later invoice, then everything released + voided
    Hh = build(h, 7003)
    call(h, Hh, L(Hh['INF']), key='tbl-adv-int-2')
    nid3 = r.uid('e', 9392)
    rowsH = read_cart(h, Hh)['rows'] + [dict(id=nid3, item_id=SVC, nama_obat='Jasa Tahap Berikut Fiktif', qty=1, harga=30000, satuan='kali', jenis='jasa')]
    eH, _ = cashier_save(h, Hh, 'tbl-next-int', [], rows=rowsH)
    eR = h.gagal(r.lepas_sql(Hh['adv'], 'tbl-rel-2'), r.OWNER)
    eV = h.gagal(r.batal_kwitansi_sql(Hh['receipt'], 'tbl-void-2'), r.OWNER)
    advH = advance_row(h, Hh)
    check('leftover consumed by the next stage (30000), then release of ALL applications and void receipt: no imbalance, advance fully unwound',
          eH is None and eR is None and eV is None and Decimal(str(advH['applied'])) == 0 and advH['status'] == 'batal' and h.saldo('314001') - Hh['before']['314001'] == 0 and h.saldo('120002') - Hh['before']['120002'] == 0,
          dict(next=(eH or '')[:160], release=(eR or '')[:160], void=(eV or '')[:160]))


def sec_gap(h):
    # ------------------------------------------------------------------ Andri: the leftover should be PAID BACK by transfer. What do the EXISTING flows offer for a re-credited ranap advance?
    Rf = build(h, 7005)
    e_ok = call(h, Rf, L(Rf['INF']), key='tbl-refund-1')
    adv_r = advance_row(h, Rf); bal_r = Decimal(str(adv_r['amount'])) - Decimal(str(adv_r['applied']))
    try: src = h.nilai(f"select public.preview_clinic_refund_source({q(Rf['inv'])})::jsonb->>'eligible'", r.OWNER)
    except RuntimeError as e: src = 'ERR ' + str(e)[:80]
    e_vr = h.gagal(r.batal_kwitansi_sql(Rf['receipt'], 'tbl-refund-void'), r.OWNER)
    writers = h.nilai("""select coalesce(string_agg(p.oid::regprocedure::text,' | ' order by p.proname),'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','clinic_private') and p.prokind = 'f' and pg_get_functiondef(p.oid) ilike '%clinic_customer_advances%'
   and (pg_get_functiondef(p.oid) ~* 'set\\s+amount\\s*=' or p.proname ilike '%refund%' or p.proname ilike '%payout%' or p.proname ilike '%kembali%')
   and p.proname not in ('clinic_owner_remove_invoice_lines','owner_remove_invoice_lines','clinic_owner_invoice_lines_quote')""")
    check('GAP (documented, existing behaviour): after the correction the leftover 30000 is an advance balance, and NO existing flow can refund a PART of an advance: '
          'no function reduces clinic_customer_advances.amount or is an advance refund/payout; void receipt refuses (ADVANCE_USED); the per-line refund (J03) source check says the corrected invoice is not eligible',
          e_ok is None and bal_r == 30000 and writers == '' and err_has(e_vr, 'ADVANCE_USED') and src == 'false', dict(balance=str(bal_r), writers=writers, void=(e_vr or '')[:100], j03_eligible=src))


def sec_neg(h):
    O = build(h, 7008)
    # ------------------------------------------------------------------ negatives: role / branch / reason / payload — never a partial effect
    N = build(h, 7010)
    for label, user in (('ADMIN', r.ADMIN), ('DOCTOR', r.DOCTOR), ('STAFF', r.STAFF), ('FINANCE', r.FINANCE), ('inactive FINANCE', r.FIN_NONAKTIF), ('FINANCE other branch', r.FIN_LUAR)):
        refused(h, N, f'NEG {label} refused (ACCESS_DENIED), nothing changed', L(N['INF']), ['ACCESS_DENIED'], user=user)
    s0 = snap(h, N)
    err = h.gagal(f"set role authenticated;select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub',{q(r.OWNER)},false);"
                  f"select set_config('request.headers',{q(json.dumps({'x-kamo-operational-branch': r.BRANCH2}))},false);select {RPC}({q(N['inv'])},{j(L(N['INF']))},'Alasan cukup panjang','tbl-branch');")
    check('NEG OWNER working in ANOTHER branch (operational-branch header) refused (ACCESS_DENIED)', err_has(err, 'ACCESS_DENIED') and snap(h, N) == s0, dict(error=(err or '')[:160]))
    err = h.gagal(f"reset role;select {RPC}({q(N['inv'])},{j(L(N['INF']))},'Alasan cukup panjang','tbl-anon');")
    check('NEG no authenticated session refused', bool(err) and ('ACCESS_DENIED' in err or 'permission denied' in err) and snap(h, N) == s0, dict(error=(err or '')[:160]))
    for label, reason in (('missing', None), ('empty', ''), ('whitespace', '       '), ('4 significant chars', 'ab c  d'), ('too long', 'x' * 501)):
        err = h.gagal(f"select {RPC}({q(N['inv'])},{j(L(N['INF']))},{('null' if reason is None else q(reason))},{q('tbl-reason-' + label.split()[0])});", r.OWNER)
        check(f'NEG reason {label} -> REASON_REQUIRED, nothing changed', err_has(err, 'REASON_REQUIRED') and snap(h, N) == s0, dict(error=(err or '')[:160]))
    err = h.gagal(f"select {RPC}({q(N['inv'])},{j(L(N['INF']))},'Alasan cukup panjang',null);", r.OWNER)
    check('NEG request_key missing -> REASON_REQUIRED (kunci permintaan), nothing changed', err_has(err, 'REASON_REQUIRED') and snap(h, N) == s0, dict(error=(err or '')[:160]))
    refused(h, N, 'NEG empty line list refused (LINE_INVALID)', [], ['LINE_INVALID'])
    for label, payload in (('not an array', {'a': 1}), ('unknown line id', L(r.uid('e', 9999))), ('line without id', [dict(qty=1)]), ('duplicate line id', L(N['INF'], N['INF'])), ('line of ANOTHER invoice', L(O['BASE1']))):
        s0 = snap(h, N)
        err = h.gagal(f"select {RPC}({q(N['inv'])},{j(payload)},'Alasan cukup panjang',{q('tbl-bad-' + label.split()[0] + label.split()[-1])});", r.OWNER)
        check(f'NEG payload {label} refused (LINE_INVALID), NO partial effect', err_has(err, 'LINE_INVALID') and snap(h, N) == s0, dict(error=(err or '')[:160]))
    refused(h, N, 'NEG qty given on a whole-line removal that differs from the line qty refused (PARTIAL_NOT_ALLOWED)', L(N['PLN'], qty=2), ['PARTIAL_NOT_ALLOWED'])
    refused(h, N, 'NEG racikan line refused (RECIPE_LINKED) and racikan + a good line together are refused as a whole (no partial effect)', L(N['INF'], N['RAC']), ['RECIPE_LINKED'])
    refused(h, N, 'NEG a good line + the Injeksi line (hpp != BMHP cost) together refused (COST_MISMATCH), the good line is NOT removed either', L(N['INF'], N['INJ']), ['COST_MISMATCH'])
    Z = build(h, 7012, lines=('PLN',))     # every line of this invoice is individually eligible: only the 'last line' rule can refuse
    all_lines = json.loads(h.nilai(f"select jsonb_agg(jsonb_build_object('invoice_item_id',id)) from invoice_items where invoice_id={q(Z['inv'])}"))
    refused(h, Z, 'NEG removing EVERY line refused (LAST_LINE)', all_lines, ['LAST_LINE'])
    one_left = [l_ for l_ in all_lines[:-1]]
    s0z = snap(h, Z); okz = call(h, Z, one_left, key='tbl-allbutone')
    check('removing every line but one is allowed (the last line is what stays)', okz is None and h.angka(f"select count(*) from invoice_items where invoice_id={q(Z['inv'])}") == 1.0, dict(error=(okz or '')[:200]))
    refused(h, N, 'NEG a line whose prescription row was already withdrawn refused (LINE_WITHDRAWN), nothing changes', L(N['PLN']), ['LINE_WITHDRAWN'],
            key='tbl-wd') if plant_withdrawn(h, N) else None
    unplant_withdrawn(h, N)
    # removing a multi-line selection, plain stock line and jasa BMHP: allowed together (GREEN) in a separate fixture
    M = build(h, 7011)
    s0 = snap(h, M); jbm = jids(h, M)
    res, err = callv(h, M, L(M['PLN'], M['JBM']), key='tbl-multi-1')
    s1 = snap(h, M); dj = jdelta(h, M, jbm)
    rem = Decimal(15000 + 50000); hpp_rem = Decimal('3834.76') + Decimal('9433.69')
    adv_m = advance_row(h, M)
    check('GREEN two lines at once (plain stock item qty 3 + Jasa with BMHP): total -65000, hpp 13268.45 reversed, plain item back as one layer at 3834.76 (3 units: 1 @1234.56 + 2 @1300.10 -> avg cost), advance balance 65000',
          err is None and Decimal(str(s1['invoice']['total'])) == M['total'] - rem and Decimal(str(res['hpp_removed'])) == hpp_rem and Decimal(str(adv_m['amount'])) - Decimal(str(adv_m['applied'])) == rem
          and float(s1['stock'][PLN]) - float(s0['stock'][PLN]) == 3 and float(s1['stock'][C4]) - float(s0['stock'][C4]) == 1 and len(dj) == 3 and s1['tb'] == 0
          and h.angka(f"select round(coalesce(sum(qty_in*unit_cost),0),2) from stock_layers where item_id={q(PLN)} and source='klinik-edit' and source_ref={q(M['no'])}") == 3834.76, dict(error=(err or '')[:300], dj=[e['source'] for e in dj]))
    # a second correction on the SAME invoice later
    res_b, err_b = callv(h, M, L(M['BASE4']), key='tbl-multi-2')
    adv_m2 = advance_row(h, M)
    check('GREEN a SECOND correction on the same (already corrected) invoice works: total -60000 more, balance 125000, two reversal payment rows, trial balance 0',
          err_b is None and Decimal(str(adv_m2['amount'])) - Decimal(str(adv_m2['applied'])) == rem + 60000 and h.diterima(M['inv']) == float(M['total'] - rem - 60000)
          and h.angka(f"select count(*) from invoice_payments where invoice_id={q(M['inv'])} and amount<0") == 2.0 and h.angka('select coalesce(sum(debit)-sum(credit),0) from journal_lines') == 0, dict(error=(err_b or '')[:300]))


def sec_scope(h):
    # ------------------------------------------------------------------ scope limits: payment method / status / adjustments
    U = build(h, 7020, pay='none'); s0 = snap(h, U)
    refused(h, U, 'NEG unpaid invoice (Belum Lunas, nothing received) refused (INVOICE_NOT_PAID)', L(U['INF']), ['INVOICE_NOT_PAID'])
    # The stage cashier ALWAYS pays a stage invoice through an advance (receipt -> advance -> application), whatever method funded the advance.
    # Direct Tunai/Transfer payment rows on a stage invoice can only come from legacy/odd data: planted here, refused.
    K = build(h, 7021, pay='cash'); h.sql(f"update invoice_payments set metode='Tunai', kas_code='110003' where invoice_id={q(K['inv'])};")
    refused(h, K, 'NEG a stage invoice that carries a direct CASH (Tunai) payment row refused in v1 (PAYMENT_METHOD)', L(K['INF']), ['PAYMENT_METHOD'])
    B = build(h, 7022); h.sql(f"update invoice_payments set metode='Transfer', kas_code='120002' where invoice_id={q(B['inv'])};")
    refused(h, B, 'NEG a stage invoice that carries a direct bank TRANSFER payment row refused in v1 (PAYMENT_METHOD)', L(B['INF']), ['PAYMENT_METHOD'])
    X = build(h, 7023); h.sql(f"insert into invoice_payments(invoice_id,tanggal,amount,metode,kas_code) values ({q(X['inv'])},current_date,5,'Tunai','110003'),({q(X['inv'])},current_date,-5,'Tunai','110003');")
    refused(h, X, 'NEG a payment row that is not a pure Uang Muka application (an extra Tunai row pair) refused in v1 (PAYMENT_METHOD)', L(X['INF']), ['PAYMENT_METHOD'])
    X2 = build(h, 7036); h.sql(f"update clinic_advance_applications set released_at=now() where invoice_id={q(X2['inv'])};")
    refused(h, X2, 'NEG a payment whose advance application was already released (no live application behind it) refused (PAYMENT_METHOD)', L(X2['INF']), ['PAYMENT_METHOD'])
    # advance funded by CASH: allowed, and the cash drawer / bank do not move at all (the liability stays with the patient)
    C0 = build(h, 7037, pay='cash'); s0c = {a: h.saldo(a) for a in ACCTS}
    err_c = call(h, C0, L(C0['INF']), key='tbl-cashfund-1'); s1c = {a: h.saldo(a) for a in ACCTS}
    check('GREEN advance funded by CASH Tunai: correction works; cash drawer 110003 and bank 120002 balances do NOT move; 314001 +30000', err_c is None and s1c['110003'] == s0c['110003'] and s1c['120002'] == s0c['120002'] and round(s1c['314001'] - s0c['314001'], 2) == -30000.0, dict(error=(err_c or '')[:200]))
    # two advances (Transfer + Tunai) paid the invoice: the NEWEST advance is reduced first; a large removal spans both
    X3 = build(h, 7038, pay='mixed')
    apps = json.loads(h.nilai(f"select jsonb_agg(jsonb_build_object('adv',a.advance_id,'amount',a.amount,'created',ca.created_at) order by ca.created_at desc, a.id) from clinic_advance_applications a join clinic_customer_advances ca on ca.id=a.advance_id where a.invoice_id={q(X3['inv'])}"))
    big = L(X3['BASE1'], X3['BASE2'], X3['BASE4'], X3['PLN'], X3['JBM'])      # 100000+120000+60000+15000+50000 = 345000 > the newest application (277500)
    jb3 = jids(h, X3); res3, err3 = callv(h, X3, big, key='tbl-two-adv')
    apps_after = json.loads(h.nilai(f"select jsonb_agg(jsonb_build_object('adv',a.advance_id,'amount',a.amount,'released',a.released_at is not null) order by ca.created_at desc, a.id) from clinic_advance_applications a join clinic_customer_advances ca on ca.id=a.advance_id where a.invoice_id={q(X3['inv'])}"))
    dj3 = jdelta(h, X3, jb3); ar3 = sorted(Decimal(str(e_['lines'][0]['debit'] or 0)) for e_ in dj3 if e_['source'] == 'klinik-ar')
    dit3, stat3, neg3 = h.diterima(X3['inv']), h.status_bayar(X3['inv']), h.angka(f"select count(*) from invoice_payments where invoice_id={q(X3['inv'])} and amount<0")
    err3b = call(h, X3, L(X3['INF']), key='tbl-two-adv-2')
    check('two advances: a SECOND correction after an application was released completely still works (the live older application is reduced by 30000 more; the released one is fully reversed)',
          err3b is None and Decimal(h.nilai(f"select amount from clinic_advance_applications where invoice_id={q(X3['inv'])} and released_at is null")) == Decimal(str(apps[1]['amount'])) - 97500
          and h.diterima(X3['inv']) == float(X3['total'] - 375000), dict(error=(err3b or '')[:300]))
    check('two advances: a 345000 removal releases the NEWEST application (277500) completely and reduces the older one by 67500: two reversal payments, two klinik-ar journals, trial balance 0, invoice total follows',
          err3 is None and len(apps) == 2 and apps_after[0]['released'] is True and apps_after[0]['adv'] == apps[0]['adv'] and apps_after[1]['released'] is False and Decimal(str(apps_after[1]['amount'])) == Decimal(str(apps[1]['amount'])) - 67500
          and neg3 == 2.0 and ar3 == [Decimal(67500), Decimal(277500)] and h.angka('select coalesce(sum(debit)-sum(credit),0) from journal_lines') == 0
          and dit3 == float(X3['total'] - 345000) and stat3 == 'Lunas', dict(error=(err3 or '')[:300], apps=apps_after, ar=[str(v_) for v_ in ar3]))
    P = build(h, 7024)
    # loyalty points
    h.sql(f"insert into point_ledger(customer_id,delta,saldo,ref,description) values ({q(P['cust'])},12,12,{q(P['no'])},'poin uji');")
    refused(h, P, 'NEG invoice that earned loyalty points refused (POINTS_PRESENT), nothing changes', L(P['INF']), ['POINTS_PRESENT'])
    h.sql(f"delete from point_ledger where ref={q(P['no'])};")
    # period lock
    h.sql('update accounting_locks set closed_until=current_date where id;')
    refused(h, P, 'NEG accounting period locked up to today refused (PERIOD_LOCKED), nothing changes', L(P['INF']), ['PERIOD_LOCKED'])
    h.sql('update accounting_locks set closed_until=null where id;')
    h.sql("update accounting_locks set closed_until='2026-11-03' where id;")
    refused(h, P, 'NEG the ORIGINAL invoice date (2026-11-03) inside a closed period refused too (PERIOD_LOCKED): sales reports of a closed period must not change', L(P['INF']), ['PERIOD_LOCKED'])
    h.sql('update accounting_locks set closed_until=null where id;')
    h.sql('update inventory_costing_settings set closed_through=current_date where id;')
    refused(h, P, 'NEG inventory period closed up to today refused (PERIOD_LOCKED), nothing changes', L(P['INF']), ['PERIOD_LOCKED'])
    h.sql('update inventory_costing_settings set closed_through=null where id;')
    # voided / adjusted invoices
    P2 = build(h, 7025); h.sql(f"update invoices set voided_at=now() where id={q(P2['inv'])};")
    refused(h, P2, 'NEG voided invoice refused (INVOICE_VOID)', L(P2['INF']), ['INVOICE_VOID'])
    P3 = build(h, 7026); h.sql(f"update invoices set tax=1000 where id={q(P3['inv'])};")
    refused(h, P3, 'NEG invoice with tax refused (INVOICE_ADJUSTED)', L(P3['INF']), ['INVOICE_ADJUSTED'])
    P4 = build(h, 7027); h.sql(f"update invoices set discount=1000 where id={q(P4['inv'])};")
    refused(h, P4, 'NEG invoice with discount refused (INVOICE_ADJUSTED)', L(P4['INF']), ['INVOICE_ADJUSTED'])
    P5 = build(h, 7028); h.sql(f"update invoices set dp_amount=1000 where id={q(P5['inv'])};")
    refused(h, P5, 'NEG invoice with a DP on its head refused (INVOICE_ADJUSTED)', L(P5['INF']), ['INVOICE_ADJUSTED'])
    P6 = build(h, 7029); h.sql(f"update invoices set stage_billing=false where id={q(P6['inv'])};")
    refused(h, P6, 'NEG a non-stage (outpatient style) invoice refused (INVOICE_ADJUSTED: only RANAP stage invoices in v1)', L(P6['INF']), ['INVOICE_ADJUSTED'])
    P7 = build(h, 7030)
    h.sql(f"insert into clinic_refund_requests(invoice_id,branch_id,requested_by,request_key,payload,quoted_total,status) values ({q(P7['inv'])},{q(r.BRANCH)},{q(r.OWNER)},'tbl-ref','{{}}'::jsonb,100,'pending');")
    refused(h, P7, 'NEG invoice with a refund request refused (REFUND_EXISTS)', L(P7['INF']), ['REFUND_EXISTS'])
    P8 = build(h, 7031); h.sql(f"update invoices set correction_pending=true where id={q(P8['inv'])};")
    refused(h, P8, 'NEG invoice awaiting a correction (correction_pending) refused (INVOICE_ADJUSTED)', L(P8['INF']), ['INVOICE_ADJUSTED'])
    # BMHP data that is not exact: stock ledger of the component does not match the snapshot
    P9 = build(h, 7032)
    h.sql(f"delete from stock_moves where source='klinik-bmhp' and source_ref={q(P9['no'])} and item_id={q(C2)};")
    refused(h, P9, 'NEG BMHP component stock ledger does not match the line snapshot refused (STOCK_MISMATCH): never guess', L(P9['INF']), ['STOCK_MISMATCH'])
    P10 = build(h, 7033)
    h.sql(f"update invoice_items set hpp=hpp+0.5 where id={q(P10['INF'])};")
    refused(h, P10, 'NEG line HPP differing from its BMHP cost by 0.50 refused (COST_MISMATCH)', L(P10['INF']), ['COST_MISMATCH'])
    P11 = build(h, 7034)
    h.sql(f"delete from stock_moves where source='klinik' and source_ref={q(P11['no'])} and item_id={q(PLN)};")
    refused(h, P11, 'NEG plain stock line whose stock move is missing refused (STOCK_MISMATCH)', L(P11['PLN']), ['STOCK_MISMATCH'])
    P12 = build(h, 7035)
    h.sql(f"update invoice_items set hpp=hpp+1 where id={q(P12['PLN'])};")
    refused(h, P12, 'NEG plain stock line whose HPP != its stock-move cost refused (COST_MISMATCH)', L(P12['PLN']), ['COST_MISMATCH'])


def sec_static(h):
    # ------------------------------------------------------------------ audit table: append-only, no app grants, ACL, static
    ar = h.gagal("update clinic_private.owner_invoice_corrections set reason='diubah semua';"); ad = h.gagal('delete from clinic_private.owner_invoice_corrections;'); at = h.gagal('truncate clinic_private.owner_invoice_corrections;')
    check('audit rows are append-only (UPDATE, DELETE, TRUNCATE refused even for the superuser)', bool(ar) and bool(ad) and bool(at) and all('immutable' in e.lower() or 'append' in e.lower() or 'tidak' in e.lower() for e in (ar, ad, at)), dict(u=(ar or '')[:80], d=(ad or '')[:80], t=(at or '')[:80]))
    ag = h.gagal('select * from clinic_private.owner_invoice_corrections;', r.OWNER)
    check('audit table has no app grant (owner session cannot read or write it directly)', bool(ag) and 'permission denied' in ag, dict(error=(ag or '')[:100]))
    acl = h.nilai(f"select case when to_regprocedure('public.{RPC}(uuid,jsonb,text,text)') is null then 'missing' else has_function_privilege('authenticated','public.{RPC}(uuid,jsonb,text,text)','execute')||'|'||has_function_privilege('anon','public.{RPC}(uuid,jsonb,text,text)','execute')||'|'||has_function_privilege('public','public.{RPC}(uuid,jsonb,text,text)','execute') end")
    acl2 = h.nilai(f"select case when to_regprocedure('public.{QUOTE}(uuid,jsonb)') is null then 'missing' else has_function_privilege('authenticated','public.{QUOTE}(uuid,jsonb)','execute')||'|'||has_function_privilege('anon','public.{QUOTE}(uuid,jsonb)','execute')||'|'||has_function_privilege('public','public.{QUOTE}(uuid,jsonb)','execute') end")
    check('ACL: authenticated may execute RPC and quote, anon/public may not', acl == 'true|false|false' and acl2 == 'true|false|false', dict(rpc=acl, quote=acl2))
    cand = (MIG / CANDIDATE).read_text() if (MIG / CANDIDATE).exists() else ''
    check('static: new objects only: no create-or-replace, alter function, drop function/trigger in the migration; the P03 floor, billing, advance and journal functions are not redefined',
          bool(cand) and all(t not in cand.lower() for t in ('create or replace', 'alter function', 'drop function', 'drop trigger', 'function clinic_private.assert_invoice_price_floor', 'function public.clinic_save_inpatient_cashier',
                                                           'function public.clinic_release_advance_application', 'function public.clinic_void_payment_receipt', 'function public.clinic_write_journal', 'function clinic_private.bmhp_edit_plan')), dict(len=len(cand)))
    cons = h.nilai("select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.oid::text)) from pg_proc p where p.oid in ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure,'public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)'::regprocedure,'public.clinic_release_advance_application(uuid,text,text)'::regprocedure,'public.clinic_void_payment_receipt(uuid,text,text)'::regprocedure,'clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)'::regprocedure,'clinic_private.bmhp_edit_plan(uuid,jsonb,uuid,text)'::regprocedure,'public.clinic_write_journal(date,text,text,text,uuid,jsonb)'::regprocedure)")
    check('existing money functions are not replaced: their definitions hash is recorded for the report (compare RED vs GREEN)', bool(cons), dict(md5=cons))


def plant_withdrawn(h, F):
    h.sql("begin;alter table public.prescription_items disable trigger official_prescription_snapshot;"
          f"update prescription_items set billing_withdrawn_at=now(),billing_withdrawn_by={q(r.STAFF)},billing_withdrawal_reason='ditarik uji' where id={q(F['rx']['PLN'])};"
          "set constraints all immediate;alter table public.prescription_items enable trigger official_prescription_snapshot;commit;")
    return True


def unplant_withdrawn(h, F): return None


def races(h, db):
    def blocked(obs, sess):
        for _ in range(40):
            w = obs.sql(f"select coalesce(wait_event_type,'')||'/'||coalesce(wait_event,'') from pg_stat_activity where pid={sess.pid};")
            if w and w[-1].startswith('Lock/'): return w[-1]
            time.sleep(0.15)
        return 'NOT BLOCKED'

    def session(name, user):
        s = c.Session(db, name); s.sql(x.claims(user)); return s
    tk = lambda F, key, line='INF': f"select {RPC}({q(F['inv'])},{j(L(F[line]))},'Alasan cukup panjang',{q(key)});"
    # (1) correction vs a cashier save in flight (the cashier holds the visit coordinator): the correction WAITS (advisory), then succeeds; both effects present
    A = build(h, 7050); nid = r.uid('e', 9393)
    rowsA = read_cart(h, A)['rows'] + [dict(id=nid, item_id=SVC, nama_obat='Jasa Tahap Berikut Fiktif', qty=1, harga=50000, satuan='kali', jenis='jasa')]
    cartA = read_cart(h, A)
    pay_sql = f"select clinic_save_inpatient_cashier({q(A['stay'])},{q(A['v'])},'tbl-race-pay',{q(TGL)},{q(cartA['snapshot'])},{j(rowsA)},{j([dict(method='Tunai', amount=50000)])},null,false,null,'Bayar tahap Fiktif');"
    with c.Session(db, 'obs') as obs, session('cashier', r.OWNER) as a, session('correct', r.OWNER) as b:
        a.sql('begin;' + pay_sql); b.send(tk(A, 'tbl-race-1'))
        wait = blocked(obs, b); a.sql('commit;'); res = c.attempt(b, commit=False)
    advA = advance_row(h, A)
    check('race: correction started while a cashier save holds the visit coordinator WAITS (advisory), then succeeds; new stage invoice paid in cash, leftover 30000 now the advance balance',
          wait.endswith('advisory') and res['ok'] and Decimal(str(advA['amount'])) - Decimal(str(advA['applied'])) == 30000 and h.angka('select coalesce(sum(debit)-sum(credit),0) from journal_lines') == 0, dict(wait=wait, res=str(res)[:200]))
    # (2) cashier save started while a correction is in flight: waits, then is refused as stale (the advance balance changed under its quote)
    Bk = build(h, 7051); cartB = read_cart(h, Bk)
    nidB = r.uid('e', 9394)
    rowsB = cartB['rows'] + [dict(id=nidB, item_id=SVC, nama_obat='Jasa Tahap Berikut Fiktif', qty=1, harga=50000, satuan='kali', jenis='jasa')]
    sqlB = f"select clinic_save_inpatient_cashier({q(Bk['stay'])},{q(Bk['v'])},'tbl-race2-pay',{q(TGL)},{q(cartB['snapshot'])},{j(rowsB)},{j([dict(method='Tunai', amount=50000)])},null,false,null,'Bayar tahap Fiktif');"
    with c.Session(db, 'obs2') as obs, session('correct2', r.OWNER) as a, session('cashier2', r.OWNER) as b:
        a.sql('begin;' + tk(Bk, 'tbl-race2-1')); b.send(sqlB)
        wait2 = blocked(obs, b); a.sql('commit;'); res2 = c.attempt(b, commit=False)
    check('race: cashier save started while a correction is in flight WAITS (advisory), then is refused as stale (CART_STALE: the advance balance changed), nothing half-saved',
          wait2.endswith('advisory') and not res2['ok'] and 'CART_STALE' in res2.get('error', '') and h.angka(f"select count(*) from invoices where visit_id={q(Bk['v'])} and voided_at is null") == 1.0, dict(wait=wait2, res=str(res2)[:200]))
    # (3) two identical requests at once: one effect
    Cc = build(h, 7052); s3 = snap(h, Cc)
    with c.Session(db, 'obs3') as obs, session('twin-a', r.OWNER) as a, session('twin-b', r.OWNER) as b:
        a.sql('begin;' + tk(Cc, 'tbl-twin')); b.send(tk(Cc, 'tbl-twin'))
        wait3 = blocked(obs, b); a.sql('commit;'); res3 = c.attempt(b, commit=False)
    s3b = snap(h, Cc)
    check('race: two identical requests at the same time apply ONCE (second waits, then returns the stored result): one audit row, total -30000 only',
          wait3.endswith('advisory') and res3['ok'] and s3b['audit'] == s3['audit'] + 1 and Decimal(str(s3b['invoice']['total'])) == Decimal(str(s3['invoice']['total'])) - 30000 and s3b['moves'] == s3['moves'] + 4, dict(wait=wait3, res=str(res3)[:200]))
    # (4) correction vs release of the advance application: correction first, release waits, then unwinds the REDUCED application
    D = build(h, 7053)
    with c.Session(db, 'obs4') as obs, session('correct4', r.OWNER) as a, session('release4', r.OWNER) as b:
        a.sql('begin;' + tk(D, 'tbl-race4-1')); b.send(r.lepas_sql(D['adv'], 'tbl-race4-rel'))
        wait4 = blocked(obs, b); a.sql('commit;'); res4 = c.attempt(b, commit=False)
    advD = advance_row(h, D)
    check('race: release of the advance started while a correction is in flight WAITS (advisory), then unwinds exactly the reduced application: applied 0, payments sum 0, no imbalance',
          wait4.endswith('advisory') and res4['ok'] and Decimal(str(advD['applied'])) == 0 and h.diterima(D['inv']) == 0, dict(wait=wait4, res=str(res4)[:200]))
    # (5) release first: the correction waits and is then refused (invoice no longer paid)
    E = build(h, 7054); sE = snap(h, E)
    with c.Session(db, 'obs5') as obs, session('release5', r.OWNER) as a, session('correct5', r.OWNER) as b:
        a.sql('begin;' + r.lepas_sql(E['adv'], 'tbl-race5-rel')); b.send(tk(E, 'tbl-race5-1'))
        wait5 = blocked(obs, b); a.sql('commit;'); res5 = c.attempt(b, commit=False)
    check('race: correction started while a release holds the coordinator WAITS (advisory), then is refused (INVOICE_NOT_PAID) because the application was released; no half effect',
          wait5.endswith('advisory') and not res5['ok'] and 'INVOICE_NOT_PAID' in res5.get('error', '') and h.nilai(f"select count(*) from invoice_items where id={q(E['INF'])}") == '1', dict(wait=wait5, res=str(res5)[:200]))


def build_chain(db, exclude):
    okr.build(db, exclude)


MUTANTS = []


def apply_candidate(db, text): db.sql('begin;\n' + text + '\ncommit;')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin'); ap.add_argument('--attach')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--sections', help='comma separated: main,life,gap,neg,scope,static,race (dev / mutation use)'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only', help='run only mutants whose name contains one of these (comma separated)'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    SECTIONS = set(a.sections.split(',')) if a.sections else None
    extra = {}
    try:
        if a.attach:
            with okr.Attached(r.BIN, a.attach) as db:
                name = 'tbl_dev_%d' % int(time.time()); db.sql(f'create database {name} template postgres;'); os.environ['PGDATABASE'] = name
                if not a.baseline: apply_candidate(db, (MIG / CANDIDATE).read_text())
                run(x.Harness(db), db, setup=False, baseline=a.baseline, sections=SECTIONS)
        elif a.mutations:
            from importlib.machinery import SourceFileLoader
            mut = SourceFileLoader('mut', str(ROOT / 'scripts/test-owner-tarik-baris-lunas-mutants.py')).load_module()
            with r.NativePostgres(r.BIN) as db:
                okr.build(db, {CANDIDATE}); h = x.Harness(db); x.setup(h)
                cand = (MIG / CANDIDATE).read_text(); plan = [('M0 control (unmodified candidate)', cand, None)]; extra['mutants'] = {}
                for name, secs, pairs in mut.MUTANTS:
                    text, ok = cand, True
                    for old, new, expected in pairs:
                        n = text.count(old)
                        if n != expected: check(name + ' anchor occurs %d time(s)' % expected, False, dict(count=n, anchor=old[:60])); ok = False; break
                        text = text.replace(old, new)
                    if not ok or (a.only and not any(o in name for o in a.only.split(','))): continue
                    plan.append((name, text, set(','.join(secs).split(','))))
                for i, (name, text, secs) in enumerate(plan):
                    os.environ.pop('PGDATABASE', None)
                    db.sql(f'create database v{i} template postgres'); os.environ['PGDATABASE'] = f'v{i}'
                    before = len(RESULTS); crash = None
                    try:
                        apply_candidate(db, text); run(h, db, setup=False, sections=secs)
                    except Exception as e:
                        crash = 'battery aborted: ' + str(e).strip().splitlines()[0][:200]
                    fails = [cc['case'] for cc in RESULTS[before:] if cc['status'] == 'FAIL']
                    del RESULTS[before:]; os.environ.pop('PGDATABASE', None)
                    if i == 0: check(name + ' has 0 FAIL', not fails and not crash, (fails + [crash or ''])[:3])
                    else:
                        extra['mutants'][name] = dict(killed=bool(fails), failing=fails[:4], crash=crash)
                        check(name + ' KILLED', bool(fails), fails[:3] or [crash]); print('   failing:', fails[:4], flush=True)
        else:
            with r.NativePostgres(r.BIN) as db:
                okr.build(db, {CANDIDATE} if a.baseline else set()); run(x.Harness(db), db, baseline=a.baseline)
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(cc['status'] == s for cc in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='mutations' if a.mutations else 'RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


def hpp_total(h, F): return Decimal(h.nilai(f"select coalesce(sum(hpp),0) from invoice_items where invoice_id={q(F['inv'])}"))


if __name__ == '__main__': sys.exit(main())
