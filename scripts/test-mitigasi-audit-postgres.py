#!/usr/bin/env python3
"""Mitigasi audit 11 Nov 2026 (migrasi 20261113100000_mitigasi_audit_integrasi_1111.sql): F1 edit promo klinik, F2 tutup shift klinik basi,
R1 izin pembelian, R2 laci petshop milik pelaku, R3 kwitansi Tunai tanpa shift. Native throwaway PostgreSQL only; never accepts a database URL.

  flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-mitigasi-audit-postgres.py --pg-bin DIR --json out.json [--baseline | --mutations | --attach ROOT]
  (default)    chain (all migrations of main) + candidate: klinik sections f1 f2 r3, petshop SQL suite r2 (+ race), pembelian SQL suite r1.
  --baseline   chain WITHOUT the candidate: every case about the new behaviour must FAIL (RED).
  --mutations  every mutant of the candidate in cloned databases must be killed by the sections listed for it.
  --attach ROOT dev only: reuse a running cluster that holds tpl_chain (chain, no x.setup) and tpl_full (chain + x.setup).
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
import argparse, importlib.util, json, os, re, subprocess, sys, tempfile, time
from decimal import Decimal
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
os.environ['PGTZ'] = 'Asia/Jakarta'


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod


bk = _load('bk', 'scripts/test-batalkan-penerimaan-klinik-postgres.py')
bp = _load('bp', 'scripts/test-batalkan-penerimaan-petshop-postgres.py')
okr, x, r, q, j, c = bk.okr, bk.x, bk.r, bk.q, bk.j, bk.c
OWNER, ADMIN, FINANCE, STAFF = r.OWNER, r.ADMIN, r.FINANCE, r.STAFF
CAND = '20261113100000_mitigasi_audit_integrasi_1111.sql'
LATER = sorted(p.name for p in (Path(__file__).resolve().parents[1] / 'supabase/migrations').glob('*.sql') if p.name > CAND)
MIG = ROOT / 'supabase/migrations'; TESTS = ROOT / 'supabase/tests'
RESULTS = []
NEXT = [21000]


def check(name, ok, detail=''):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=str(detail)[:600]))
    print(RESULTS[-1]['status'], name, str(detail)[:300], flush=True)
    return ok


def nxt():
    NEXT[0] += 3; return NEXT[0]


def D(v): return Decimal(str(v))


def has(err, *words): return bool(err) and all(w in err for w in words)


# ------------------------------------------------------------------------------------------------ klinik fixtures (as in the integration audit)
ITEM2 = r.uid(8, 2)


def setup_item2(h, cost=11287.29):
    h.sistem(f"insert into public.items(id,code,name,unit,item_type,buy_price,sell_price) values({q(ITEM2)},'MT-ANTHEL','Anthel Cat fiktif','pcs','Persediaan',{cost},18000) on conflict do nothing;"
             f"insert into public.stock(warehouse_id,item_id,qty) values({q(r.WH)},{q(ITEM2)},100) on conflict do nothing;"
             f"insert into public.stock_layers(warehouse_id,item_id,qty_in,qty_left,unit_cost,source,tanggal) values({q(r.WH)},{q(ITEM2)},100,100,{cost},'manual',current_date);")


def groom_lines(n, grooming=90000, anthel=18000, promo=45000, qty_anthel=1, promo_on=True):
    ls = r.baris(n, 2, 3)
    ls[0] = dict(ls[0], description='Grooming VET Lengkap + CU', price=grooming, qty=1)
    ls[1] = dict(ls[1], description='Anthel Cat', price=anthel, qty=qty_anthel, item_id=ITEM2)
    if promo_on: ls[0]['promo_discount'] = promo
    return ls


def groom_visit(h, n):
    cust = r.buat_pelanggan(h, n); v = r.buat_kunjungan(h, n, cust, admitted=False)
    h.sistem(f"update public.prescription_items set item_id={q(ITEM2)} where id={q(r.uid(9, n*10+3))};")
    return cust, v


def post_groom(h, n, metode='QRIS', promo_on=True, lines=None, discount=45000, user=OWNER):
    cust, v = groom_visit(h, n)
    ls = lines or groom_lines(n, promo_on=promo_on)
    sub = r.nilai_baris(ls)
    ganti = dict(discount=discount, total=sub - discount, paid_status='Lunas', metode_bayar=metode, dp_amount=0, dp_date=None)
    err = h.gagal(r.tagih_biasa_sql(v, f'k{n}-post', ls, user, alasan='Uji fiktif', ganti=ganti), user)
    if err: return None, err
    inv = h.aktif(v)
    return dict(n=n, v=v, inv=inv, no=h.no_tagihan(inv), lines=ls, total=sub - discount, cust=cust), None


def edit_sql(inv, key, lines, discount, total=None, sub=None, paid_status='Belum Lunas', metode='QRIS', reason='Koreksi harga Owner', voucher=None, dp=0):
    sub = sub if sub is not None else r.nilai_baris(lines)
    payload = {"subtotal": sub, "discount": discount, "tax": 0, "total": total if total is not None else sub - discount, "dp_amount": dp,
               "paid_status": paid_status, "metode_bayar": metode, "voucher_code": voucher, "reason": reason}
    return f"select public.clinic_edit_invoice({q(inv)},{q(key)},{j(payload)},{j(lines)});"


def lines_with_source(h, inv, mods=None, promo=None):
    """p_lines persis seperti aplikasi (source_invoice_item_id = id baris lama). mods: {jenis: dict}; promo: {jenis: rupiah} dikirim sebagai promo_discount."""
    rows = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object('id',id,'description',deskripsi,'qty',qty,'price',harga,'kind',jenis,'item_id',item_id,'unit',satuan,'prescription_item_id',prescription_item_id,'recipe_id',compound_recipe_id,'discount_percent',diskon_persen) order by created_at,id),'[]') from public.invoice_items where invoice_id={q(inv)}"))
    out = []
    for rw in rows:
        l = dict(description=rw['description'], qty=int(rw['qty']), price=int(float(rw['price'])), kind=rw['kind'], item_id=rw['item_id'], unit=rw['unit'] or 'pcs',
                 prescription_item_id=rw['prescription_item_id'], recipe_id=rw['recipe_id'], discount_percent=float(rw['discount_percent'] or 0), source_invoice_item_id=rw['id'])
        l.update((mods or {}).get(rw['kind'], {}))
        if promo and rw['kind'] in promo: l['promo_discount'] = promo[rw['kind']]
        out.append(l)
    return out


def promo_of(h, inv): return D(h.angka(f"select coalesce(sum(promo_discount),0) from public.invoice_items where invoice_id={q(inv)}"))
def promo_of_kind(h, inv, kind): return D(h.angka(f"select coalesce(sum(promo_discount),0) from public.invoice_items where invoice_id={q(inv)} and jenis={q(kind)}"))
def null_promos(h, inv): return int(h.angka(f"select count(*) from public.invoice_items where invoice_id={q(inv)} and promo_discount is null"))


# ------------------------------------------------------------------------------------------------ F1
def section_f1(h):
    setup_item2(h)
    F, err = post_groom(h, nxt())
    if not F: check('F1 fixture: nota GROOM11 terbit', False, err); return
    bk.do_cancel(h, F['inv'], f"c-{F['n']}")
    # F1-1: baris grooming BERUBAH (90.000 -> 100.000), diskon invoice tetap 45.000 (repro audit K3c)
    ls = lines_with_source(h, F['inv'], {'jasa': dict(price=100000)})
    e = h.gagal(edit_sql(F['inv'], f"e1-{F['n']}", ls, 45000), OWNER)
    check('F1-1 Owner ubah HARGA baris promo (90.000->100.000), diskon invoice 45.000: diterima (tidak PRICE_BELOW_HPP)', e is None, (e or '')[:300])
    check('F1-1b promo dibawa dari database: dibatasi diskon invoice (sebanding 50.000 -> 45.000), tidak ada NULL tersisa', e is None and promo_of(h, F['inv']) == 45000 and promo_of_kind(h, F['inv'], 'jasa') == 45000 and null_promos(h, F['inv']) == 0,
          dict(promo=str(promo_of(h, F['inv'])), nulls=null_promos(h, F['inv'])))
    check('F1-1c uang tidak berubah: diskon invoice tetap 45.000, subtotal 118.000, neraca nol', e is None and D(h.angka(f"select discount from public.invoices where id={q(F['inv'])}")) == 45000
          and D(h.angka(f"select subtotal from public.invoices where id={q(F['inv'])}")) == 118000 and bk.tb(h) == 0, {})
    # F1-2: diskon dinaikkan ke 50.000 (50% harga baru): promo sebanding 50.000 persis
    G, _ = post_groom(h, nxt()); bk.do_cancel(h, G['inv'], f"c-{G['n']}")
    ls = lines_with_source(h, G['inv'], {'jasa': dict(price=100000)})
    e = h.gagal(edit_sql(G['inv'], f"e2-{G['n']}", ls, 50000), OWNER)
    check('F1-2 diskon invoice 50.000 (50% harga baru): diterima, promo baris = 50.000', e is None and promo_of_kind(h, G['inv'], 'jasa') == 50000 and promo_of_kind(h, G['inv'], 'obat') == 0, (e or str(promo_of(h, G['inv']))))
    # F1-3: qty baris promo 1 -> 2 (promo sebanding 90.000), diskon invoice 90.000
    H, _ = post_groom(h, nxt()); bk.do_cancel(h, H['inv'], f"c-{H['n']}")
    ls = lines_with_source(h, H['inv'], {'jasa': dict(qty=2)})
    e = h.gagal(edit_sql(H['inv'], f"e3-{H['n']}", ls, 90000), OWNER)
    check('F1-3 qty baris promo 1->2, diskon 90.000: diterima, promo baris = 90.000', e is None and promo_of_kind(h, H['inv'], 'jasa') == 90000, (e or str(promo_of(h, H['inv']))))
    # F1-4: diskon invoice diturunkan (20.000) sementara harga baris promo naik: promo dibatasi 20.000
    I, _ = post_groom(h, nxt()); bk.do_cancel(h, I['inv'], f"c-{I['n']}")
    ls = lines_with_source(h, I['inv'], {'jasa': dict(price=100000)})
    e = h.gagal(edit_sql(I['inv'], f"e4-{I['n']}", ls, 20000), OWNER)
    check('F1-4 diskon invoice 20.000: promo dibawa tetapi dibatasi 20.000 (tidak melebihi diskon)', e is None and promo_of(h, I['inv']) == 20000, (e or str(promo_of(h, I['inv']))))
    # F1-5: baris tak berubah tetap mewarisi (K2a)
    J, _ = post_groom(h, nxt()); bk.do_cancel(h, J['inv'], f"c-{J['n']}")
    ls = lines_with_source(h, J['inv'], {'obat': dict(price=20000)})
    e = h.gagal(edit_sql(J['inv'], f"e5-{J['n']}", ls, 45000), OWNER)
    check('F1-5 baris promo TIDAK berubah (hanya harga Anthel naik): promo tetap 45.000 di Grooming', e is None and promo_of_kind(h, J['inv'], 'jasa') == 45000 and promo_of_kind(h, J['inv'], 'obat') == 0, (e or ''))
    tot = int(h.angka(f"select total from public.invoices where id={q(J['inv'])}"))
    e2 = bk.settle(h, dict(inv=J['inv'], v=J['v']), [dict(method='QRIS', amount=tot)], f"s-{J['n']}")
    check('F1-5b bayar lagi sesuai total baru: Lunas, bank = total, piutang 0, neraca nol', e2 is None and h.status_bayar(J['inv']) == 'Lunas' and bk.net(h, J['no'])['120002'] == tot and bk.net(h, J['no'])['150001'] == 0 and bk.tb(h) == 0, (e2 or ''))
    # F1-6: bentuk INV-0777 (108.000 tanpa promo di baris, diskon 45.000 lewat edit): tanpa promo_discount dari klien aturan LAMA persis (ditolak)
    nn = nxt(); K, _ = post_groom(h, nn, promo_on=False, discount=0, lines=groom_lines(nn, promo_on=False)); bk.do_cancel(h, K['inv'], f"c-{K['n']}")
    ls = lines_with_source(h, K['inv'])
    e = h.gagal(edit_sql(K['inv'], f"e6-{K['n']}", ls, 45000), OWNER)
    check('F1-6 INV-0777 tanpa promo_discount dari klien: tetap PRICE_BELOW_HPP (database tidak menebak baris promo; aturan tidak dilonggarkan)', has(e, 'PRICE_BELOW_HPP'), (e or 'DITERIMA')[:200])
    # F1-7: sama, tetapi klien menyebut promo 45.000 pada Grooming (baris yang benar): diterima
    ls = lines_with_source(h, K['inv'], promo={'jasa': 45000})
    e = h.gagal(edit_sql(K['inv'], f"e7-{K['n']}", ls, 45000), OWNER)
    check('F1-7 INV-0777 + promo_discount 45.000 pada baris Grooming: diterima; tersimpan di baris itu', e is None and promo_of_kind(h, K['inv'], 'jasa') == 45000 and promo_of_kind(h, K['inv'], 'obat') == 0 and bk.tb(h) == 0, (e or ''))
    # F1-8: batas klien
    L, _ = post_groom(h, nxt(), promo_on=False, discount=0, lines=groom_lines(NEXT[0], promo_on=False)); bk.do_cancel(h, L['inv'], f"c-{L['n']}")
    base = lines_with_source(h, L['inv'])
    def tryp(p, disc, key, kind='jasa'):
        return h.gagal(edit_sql(L['inv'], f"b-{L['n']}-{key}", lines_with_source(h, L['inv'], promo={kind: p}), disc), OWNER)
    check('F1-8a promo klien melebihi nilai baris (Anthel 18.000, promo 20.000) ditolak LINE_INVALID', has(tryp(20000, 45000, 'a', 'obat'), 'LINE_INVALID'), '')
    check('F1-8b jumlah promo klien melebihi diskon invoice ditolak', has(tryp(45000, 30000, 'b'), 'LINE_INVALID'), '')
    check('F1-8c promo klien negatif ditolak', has(tryp(-1, 45000, 'c'), 'LINE_INVALID'), '')
    check('F1-8d promo klien 3 desimal ditolak', has(tryp(100.123, 45000, 'd'), 'LINE_INVALID'), '')
    # F1-9: promo klien 10.000 pada Anthel (nilai 18.000): neto Anthel 8.000 < HPP 11.287 -> lantai MENOLAK (promo tidak melonggarkan)
    e = tryp(10000, 10000, 'e', 'obat')
    check('F1-9 promo klien memindahkan diskon ke Anthel sehingga neto < HPP: PRICE_BELOW_HPP (lantai tidak dilonggarkan)', has(e, 'PRICE_BELOW_HPP'), (e or 'DITERIMA')[:200])
    # F1-10: harga Anthel di bawah HPP tetap ditolak walau baris promo membawa promo
    M, _ = post_groom(h, nxt()); bk.do_cancel(h, M['inv'], f"c-{M['n']}")
    ls = lines_with_source(h, M['inv'], {'jasa': dict(price=100000), 'obat': dict(price=11000)})
    e = h.gagal(edit_sql(M['inv'], f"e10-{M['n']}", ls, 45000), OWNER)
    check('F1-10 Anthel di bawah HPP (11.000 < 11.287) tetap ditolak walau Grooming membawa promo', has(e, 'PRICE_BELOW_HPP'), (e or 'DITERIMA')[:200])
    # F1-11: nilai promo tidak pernah melebihi nilai barisnya dan jumlahnya <= diskon pada semua nota hasil edit di atas
    bad = h.angka("select count(*) from public.invoice_items i join public.invoices v on v.id=i.invoice_id where i.promo_discount > round(i.qty*i.harga*(1-coalesce(i.diskon_persen,0)/100),2)")
    over = h.angka("select count(*) from (select i.invoice_id from public.invoice_items i join public.invoices v on v.id=i.invoice_id group by i.invoice_id, v.discount having coalesce(sum(i.promo_discount),0) > v.discount) z")
    nulls = h.angka("select count(*) from public.invoice_items where promo_discount is null")
    check('F1-11 invarian: promo <= nilai baris; jumlah promo <= diskon invoice; tidak ada promo NULL tersisa', bad == 0 and over == 0 and nulls == 0, dict(bad=bad, over=over, nulls=nulls))
    # F1-13: DUA baris promo berubah sekaligus: jumlah promo yang dibawa dibatasi diskon invoice (kumulatif), tidak per baris
    n13 = nxt(); ls13 = r.baris(n13, 2, 3, 4)
    ls13[0] = dict(ls13[0], description='Grooming VET Lengkap + CU', price=90000, qty=1, promo_discount=45000)
    ls13[1] = dict(ls13[1], description='Anthel Cat', price=18000, qty=1, item_id=ITEM2)
    ls13[2] = dict(ls13[2], description='Jasa Tambahan', price=60000, qty=1, promo_discount=30000)
    P13, err13 = post_groom(h, n13, lines=ls13, discount=75000)
    if not P13: check('F1-13 fixture: nota dua baris promo terbit', False, err13)
    else:
        bk.do_cancel(h, P13['inv'], f"c-{P13['n']}")
        ls = lines_with_source(h, P13['inv'])
        for l in ls:
            if l['kind'] == 'jasa': l['price'] = int(l['price'] * 1.2) if l['price'] != 18000 else l['price']
        # kedua baris jasa naik 20% (promo sebanding 54.000 + 36.000 = 90.000 > diskon 75.000): dijepit kumulatif ke 75.000 persis
        e = h.gagal(edit_sql(P13['inv'], f"e13-{P13['n']}", ls, 75000), OWNER)
        check('F1-13 dua baris promo berubah: diterima; jumlah promo dibatasi diskon invoice secara kumulatif (75.000 persis), Anthel tidak menanggung', e is None and promo_of(h, P13['inv']) == 75000 and promo_of_kind(h, P13['inv'], 'obat') == 0 and null_promos(h, P13['inv']) == 0, (e or str(promo_of(h, P13['inv']))))
    # F1-12: bukan Owner / aturan akses edit tidak berubah (STAFF tetap ditolak seperti sebelumnya) dan tanpa promo klien edit biasa tetap jalan
    N, _ = post_groom(h, nxt(), promo_on=False, discount=0, lines=groom_lines(NEXT[0], promo_on=False)); bk.do_cancel(h, N['inv'], f"c-{N['n']}")
    ls = lines_with_source(h, N['inv'], {'jasa': dict(price=95000)})
    e = h.gagal(edit_sql(N['inv'], f"e12-{N['n']}", ls, 0), OWNER)
    check('F1-12 edit biasa tanpa promo (harga Grooming 95.000, diskon 0): diterima seperti sebelumnya; promo tersimpan 0', e is None and promo_of(h, N['inv']) == 0 and null_promos(h, N['inv']) == 0, (e or ''))


# ------------------------------------------------------------------------------------------------ F2
def app_expected(h, shift_id):
    """Model independen bagian klinik src/lib/tutup-shift.ts (pemasukanShift + hitungShift), dibaca lewat JSON lalu dihitung di Python."""
    d = json.loads(h.nilai(f"""select jsonb_build_object(
      'opening',(select opening_balance from public.cashier_shifts where id={q(shift_id)}),
      'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'total',total,'dp',dp_amount,'paid',paid_status,'metode',metode_bayar,'carry',shift_cash_carry)) from public.invoices where shift_id={q(shift_id)} and voided_at is null),'[]'),
      'pays',coalesce((select jsonb_agg(jsonb_build_object('inv',p.invoice_id,'amount',p.amount,'metode',p.metode,'checkout',p.checkout_payment)) from public.invoice_payments p join public.invoices i on i.id=p.invoice_id where i.shift_id={q(shift_id)} and i.voided_at is null),'[]'),
      'receipts',coalesce((select jsonb_agg(jsonb_build_object('shift',rc.shift_id,'vshift',rc.void_shift_id,'parts',(select coalesce(jsonb_agg(jsonb_build_object('metode',pt.metode,'amount',pt.amount)),'[]'::jsonb) from public.clinic_payment_receipt_parts pt where pt.receipt_id=rc.id))) from public.clinic_payment_receipts rc where rc.shift_id={q(shift_id)} or rc.void_shift_id={q(shift_id)}),'[]'),
      'cancels',coalesce((select jsonb_agg(jsonb_build_object('cash',cash_amount,'mode',shift_mode)) from public.clinic_receipt_cancellations where cancel_shift_id={q(shift_id)} and shift_mode='shift_berjalan'),'[]'),
      'expenses',coalesce((select jsonb_agg(jsonb_build_object('jumlah',jumlah,'metode',metode_bayar)) from public.expenses where shift_id={q(shift_id)}),'[]'))"""))
    ids = {i['id'] for i in d['invoices']}
    tunai = Decimal(0); susulan = {}; mixed = set()
    for p in d['pays']:
        amt = D(p['amount'])
        if p['checkout'] and p['inv'] in ids:
            mixed.add(p['inv'])
            if (p['metode'] or 'Tunai') == 'Tunai': tunai += amt
            continue
        susulan[p['inv']] = susulan.get(p['inv'], Decimal(0)) + amt
    for rc in d['receipts']:
        for pt in rc['parts']:
            if pt['metode'] != 'Tunai': continue
            if rc['shift'] == shift_id: tunai += D(pt['amount'])
            if rc['vshift'] == shift_id: tunai -= D(pt['amount'])
    for cn in d['cancels']:
        if D(cn['cash'] or 0) > 0: tunai -= D(cn['cash'])
    for i in d['invoices']:
        if i['id'] in mixed or (i['metode'] or 'Tunai') != 'Tunai': continue
        paid = susulan.get(i['id'], Decimal(0))
        v = D(i['carry']) if i['carry'] is not None else (D(i['total']) if i['paid'] == 'Lunas' and paid == 0 else D(i['dp'] or 0))
        tunai += v
    exp = sum((D(e['jumlah']) for e in d['expenses'] if e['metode'] == 'Tunai'), Decimal(0))
    return (D(d['opening']) + tunai - exp).quantize(Decimal('0.01'))


def sql_expected(h, shift_id):
    try: return D(h.nilai(f"select clinic_private.klinik_shift_expected_cash({q(shift_id)}::uuid)")).quantize(Decimal('0.01'))
    except RuntimeError: return None   # fungsi belum ada (baseline): hasil None membuat kasus gagal, bukan membatalkan seksi


def close_sql(shift_id, expected, breakdown_tunai=None):
    bt = expected if breakdown_tunai is None else breakdown_tunai
    return (f"update public.cashier_shifts set status='closed', closed_at=now(), closing_balance={expected}, expected_cash={expected}, selisih=0, "
            f"closing_breakdown='{{\"Tunai\":{bt},\"Transfer\":0,\"Debit\":0,\"Kredit\":0,\"QRIS\":0,\"E-Wallet\":0}}' where id={q(shift_id)} and status='open';")


def blocked(obs, sess):
    for _ in range(40):
        w = obs.sql(f"select coalesce(wait_event_type,'')||'/'||coalesce(wait_event,'') from pg_stat_activity where pid={sess.pid};")
        if w and w[-1].startswith('Lock/'): return w[-1]
        time.sleep(0.15)
    return 'NOT BLOCKED'


def section_f2(h, db):
    # RS4 (dulu): shift klinik yang TIDAK tersentuh pembatalan penerimaan: perilaku lama utuh (angka apa pun diterima; penjaga hanya untuk shift tersentuh)
    sh = r.SHIFT[ADMIN]
    e = h.gagal(close_sql(sh, 12345))
    st = h.nilai(f"select status||'|'||expected_cash from public.cashier_shifts where id={q(sh)}")
    check('F2-0 shift klinik TIDAK tersentuh pembatalan: penutupan dengan angka apa pun tetap diterima (perilaku lama utuh)', e is None and st.startswith('closed'), dict(err=(e or '')[:200], st=st))
    h.sistem(f"update public.cashier_shifts set status='open', closed_at=null where id={q(sh)};")
    # RS2: SQL = model aplikasi pada banyak keadaan (tanpa pembatalan, dengan pembatalan, kwitansi, campuran, pengeluaran)
    def same(label, shift_id):
        a, s = app_expected(h, shift_id), sql_expected(h, shift_id)
        check(f'F2-m {label}: fungsi database = model aplikasi (tutup-shift.ts)', a == s, dict(app=str(a), sql=str(s)))
    fin = r.SHIFT[FINANCE]; own = r.SHIFT[OWNER]; stf = r.SHIFT[STAFF]
    same('shift kosong', fin)
    A = bk.rj(h, nxt(), 'Tunai', user=FINANCE); same('tagihan Tunai Lunas', fin)
    B = bk.rj(h, nxt(), 'QRIS', user=FINANCE); same('+ tagihan QRIS', fin)
    Cc = bk.rj(h, nxt(), 'Tunai', status='DP', dp=30000, user=FINANCE); same('+ DP Tunai', fin)
    Sp = bk.rj(h, nxt(), user=FINANCE, split=[{'method': 'Tunai', 'amount': 60000, 'kas_code': '110003'}, {'method': 'QRIS', 'amount': 40000, 'kas_code': '120002'}], slots=(1,)); same('+ split checkout Tunai 60.000 + QRIS 40.000 (invoice campuran)', fin)
    R1_ = bk.ranap(h, nxt(), 'cash', user=FINANCE); same('+ kwitansi Tunai rawat inap', fin)
    R2_ = bk.ranap(h, nxt(), 'qris', user=FINANCE); same('+ kwitansi QRIS', fin)
    h.sistem(f"insert into public.expenses(branch_id,kategori,jumlah,metode_bayar,shift_id) select branch_id,'Uji',7000,'Tunai',id from public.cashier_shifts where id={q(fin)};")
    same('+ pengeluaran Tunai 7.000', fin)
    def must(label, err):
        if err: check(f'F2 fixture: {label}', False, str(err)[:300])
    must('batal tagihan A', bk.do_cancel(h, A['inv'], f"c-{A['n']}")[0]); same('setelah batal penerimaan Tunai (shift asal terbuka)', fin)
    must('batal split', bk.do_cancel(h, Sp['inv'], f"c-{Sp['n']}")[0]); same('setelah batal split (checkout dibalik)', fin)
    must('batal kwitansi R1', bk.do_cancel(h, R1_['inv'], f"c-{R1_['n']}")[0]); same('setelah batal kwitansi Tunai (shift asal terbuka)', fin)
    must('bayar lagi A', bk.settle(h, dict(inv=A['inv'], v=A['v']), [dict(method='Tunai', amount=A['total'])], f"s-{A['n']}")); same('setelah bayar lagi Tunai (susulan)', fin)
    # shift asal TUTUP milik STAFF, dibatalkan Owner -> jatuh di shift berjalan Owner
    T = bk.rj(h, nxt(), 'Tunai', user=STAFF); bk.set_shift(h, STAFF, 'closed')
    try:
        terr, tres = bk.do_cancel(h, T['inv'], f"c-{T['n']}")
        check('F2 fixture: batal tagihan STAFF (shift tutup) jatuh di shift Owner (mode shift_berjalan, cash_amount = total)', terr is None and tres['shift_mode'] == 'shift_berjalan' and D(tres['cash_amount']) == D(T['total']), dict(err=terr, mode=(tres or {}).get('shift_mode'), cash=(tres or {}).get('cash_amount'), cs=(tres or {}).get('cancel_shift_id'), own=str(app_expected(h, own)), own_id=own, stf=stf))
        same('shift asal tutup: shift Owner (shift_berjalan)', own); same('shift asal tutup: shift STAFF yang sudah tutup', stf)
    finally: bk.set_shift(h, STAFF, 'open')
    # RS1: balapan s5 (tutup shift dengan angka dibaca sebelum Owner membatalkan penerimaan Tunai)
    Fv = bk.rj(h, nxt(), 'Tunai', user=FINANCE)
    shift = r.SHIFT[FINANCE]
    opening = D(h.nilai(f"select opening_balance from public.cashier_shifts where id={q(shift)}"))
    stale_expected = app_expected(h, shift)   # app membaca: tagihan masih Lunas Tunai di shift ini
    def sess(name, user):
        s = c.Session(db, name); s.sql(x.claims(user)); return s
    with c.Session(db, 'obs5') as obs, sess('sa', OWNER) as a, sess('sb', FINANCE) as b:
        a.sql('begin;' + bk.cancel_sql(Fv['inv'], f"race-close-{Fv['n']}"))
        b.send(close_sql(shift, stale_expected))
        wait = blocked(obs, b)
        a.sql('commit;'); res = c.attempt(b, commit=False)
    row = json.loads(h.nilai(f"select to_jsonb(s) from public.cashier_shifts s where id={q(shift)}"))
    check('F2-1 balapan: tutup shift dengan angka dibaca SEBELUM batal penerimaan Tunai: DITOLAK (Hitung ulang), shift tetap terbuka', wait.startswith('Lock/') and row['status'] == 'open' and not res.get('ok', True)
          and 'Hitung ulang' in str(res.get('error', '')), dict(wait=wait, res=str(res)[:200], status=row['status'], expected=row['expected_cash']))
    # RS3: angka yang benar sesudah batal diterima; selisih dihitung dari angka itu
    fresh = app_expected(h, shift)
    e = h.gagal(close_sql(shift, fresh))
    st = h.nilai(f"select status||'|'||expected_cash||'|'||selisih from public.cashier_shifts where id={q(shift)}")
    check('F2-2 angka yang dihitung ulang (sesudah batal) diterima dan tersimpan', e is None and st.startswith('closed') and D(st.split('|')[1]) == fresh and fresh != stale_expected, dict(err=(e or '')[:200], st=st, fresh=str(fresh), stale=str(stale_expected)))
    h.sistem(f"update public.cashier_shifts set status='open', closed_at=null where id={q(shift)};")
    # penutupan tanpa angka (expected_cash kosong): bukan angka basi, tidak diperiksa
    h.sistem(f"update public.cashier_shifts set expected_cash=null where id={q(shift)};")
    e = h.gagal(f"update public.cashier_shifts set status='closed', closed_at=now() where id={q(shift)};")
    check('F2-3 penutupan tanpa angka (expected_cash kosong) pada shift tersentuh: tidak diperiksa (tidak ada angka basi)', e is None, (e or '')[:200])
    h.sistem(f"update public.cashier_shifts set status='open', closed_at=null, expected_cash=null where id={q(shift)};")
    # angka basi DUA arah: terlalu besar dan terlalu kecil, pada shift tersentuh
    check('F2-4 angka terlalu kecil (kurang 1 rupiah) pada shift tersentuh ditolak', has(h.gagal(close_sql(shift, fresh - 1)), 'Hitung ulang'), '')
    check('F2-5 angka terlalu besar (lebih 1 rupiah) pada shift tersentuh ditolak', has(h.gagal(close_sql(shift, fresh + 1)), 'Hitung ulang'), '')
    check('F2-6 tak ada perubahan efek samping: shift tetap terbuka setelah penolakan', h.nilai(f"select status from public.cashier_shifts where id={q(shift)}") == 'open', '')
    # shift OWNER (shift_berjalan dari STAFF tutup): angka yang benar diterima, angka tanpa pengurangan ditolak
    wrong = app_expected(h, own) + D(T['total'])
    check('F2-7 shift Owner yang memuat pengurangan shift_berjalan: angka tanpa pengurangan ditolak', has(h.gagal(close_sql(own, wrong)), 'Hitung ulang'), dict(wrong=str(wrong)))
    ok_ = h.gagal(close_sql(own, app_expected(h, own)))
    check('F2-8 ... angka yang benar diterima', ok_ is None, (ok_ or '')[:200])
    h.sistem(f"update public.cashier_shifts set status='open', closed_at=null where id={q(own)};")
    # petshop tidak terpengaruh: tidak ada shift klinik lain yang disentuh penjaga ini (shift STAFF tak tersentuh? STAFF disentuh sebagai asal) - cukup: penutupan shift jenis lain bebas
    check('F2-9 fungsi penghitung tidak dapat dipanggil aplikasi (tanpa hak authenticated/anon)',
          h.nilai("select (not has_function_privilege('authenticated','clinic_private.klinik_shift_expected_cash(uuid)','execute') and not has_function_privilege('anon','clinic_private.klinik_shift_expected_cash(uuid)','execute'))::text") == 'true', '')


# ------------------------------------------------------------------------------------------------ R3
def section_r3(h):
    own = r.SHIFT[OWNER]
    # K1 (probe hostile): kwitansi Tunai, shift asal tutup, pelaku tanpa shift terbuka
    Y = bk.ranap(h, nxt(), 'cash')
    cash_parts = D(h.nilai(f"select coalesce(sum(amount),0) from public.clinic_payment_receipt_parts where receipt_id={q(Y['receipt'])} and metode='Tunai'"))
    bk.set_shift(h, OWNER, 'closed')
    try:
        perr, pv = bk.preview(h, Y['inv'])
        before = bk.net(h, Y['no'])
        err, res = bk.do_cancel(h, Y['inv'], f"r3-{Y['n']}")
    finally: bk.set_shift(h, OWNER, 'open')
    vs = h.nilai(f"select coalesce(void_shift_id::text,'NULL') from public.clinic_payment_receipts where id={q(Y['receipt'])}")
    aud = json.loads(h.nilai(f"select to_jsonb(a) from public.clinic_receipt_cancellations a where invoice_id={q(Y['inv'])}")) if err is None else {}
    check('R3-1 kwitansi Tunai, shift asal tutup, pelaku tanpa shift terbuka: mode tanpa_shift, cash_amount = Tunai kwitansi (bukan nonkas/0)',
          err is None and res['shift_mode'] == 'tanpa_shift' and D(res['cash_amount']) == cash_parts and cash_parts > 0 and vs == 'NULL', dict(err=(err or '')[:160], res=res, cash_parts=str(cash_parts), void_shift_id=vs))
    check('R3-1b catatan audit sama dengan hasil; kunci kwitansi_tunai_tanpa_shift terisi', err is None and aud.get('shift_mode') == 'tanpa_shift' and D(aud.get('cash_amount')) == cash_parts and aud.get('cancel_shift_id') is None
          and D(res.get('kwitansi_tunai_tanpa_shift', 0)) == cash_parts, dict(aud={k: aud.get(k) for k in ('shift_mode', 'cash_amount', 'cancel_shift_id')}))
    check('R3-1c pratinjau (sebelum batal) menyebut tanpa_shift dan jumlah yang sama', perr is None and pv['shift_mode'] == 'tanpa_shift' and D(pv['cash_amount']) == cash_parts, dict(perr=perr, pv={k: pv.get(k) for k in ('shift_mode', 'cash_amount')} if pv else None))
    after = bk.net(h, Y['no'])
    check('R3-1d jurnal tidak berubah oleh perbaikan: Kas 110003 net 0 setelah batal, Piutang 150001 = total, neraca nol', err is None and after['110003'] == 0 and after['150001'] == Y['total'] and bk.tb(h) == 0, dict(after={k: str(v) for k, v in after.items()}))
    check('R3-1e tidak ada hitungan ganda: shift Owner tidak memuat angka ini (shift_berjalan hanya untuk mode shift_berjalan)', sql_expected(h, own) == app_expected(h, own), dict(sql=str(sql_expected(h, own)), app=str(app_expected(h, own))))
    # K2: kwitansi QRIS tanpa shift terbuka: nonkas, tanpa tanda
    Z = bk.ranap(h, nxt(), 'qris'); bk.set_shift(h, OWNER, 'closed')
    try: err, res = bk.do_cancel(h, Z['inv'], f"r3-{Z['n']}")
    finally: bk.set_shift(h, OWNER, 'open')
    check('R3-2 kwitansi QRIS tanpa shift terbuka: nonkas, cash_amount 0, tanpa tanda', err is None and res['shift_mode'] == 'nonkas' and D(res['cash_amount']) == 0 and D(res.get('kwitansi_tunai_tanpa_shift', 0)) == 0, dict(err=(err or '')[:160], res=res))
    # K3: kwitansi Tunai dari shift FINANCE yang tutup, Owner PUNYA shift terbuka: void_shift = shift Owner, tidak ditandai, tidak ganda
    W = bk.ranap(h, nxt(), 'cash', user=FINANCE); bk.set_shift(h, FINANCE, 'closed')
    try:
        perr3, pv3 = bk.preview(h, W['inv'])
        check('R3-3a pratinjau saat Owner punya shift terbuka: tidak ditandai tanpa_shift (nonkas, 0)', perr3 is None and pv3['shift_mode'] == 'nonkas' and D(pv3['cash_amount']) == 0 and D(pv3.get('kwitansi_tunai_tanpa_shift', 0)) == 0, dict(perr=perr3, pv={k: pv3.get(k) for k in ('shift_mode', 'cash_amount', 'kwitansi_tunai_tanpa_shift')} if pv3 else None))
        err, res = bk.do_cancel(h, W['inv'], f"r3-{W['n']}")
        vs = h.nilai(f"select coalesce(void_shift_id::text,'NULL') from public.clinic_payment_receipts where id={q(W['receipt'])}")
        check('R3-3 kwitansi Tunai, Owner punya shift terbuka: dicatat di shift Owner (void_shift_id), tanpa tanda tanpa_shift, cash_amount tidak menggandakan',
              err is None and vs == own and res['shift_mode'] == 'nonkas' and D(res['cash_amount']) == 0 and D(res.get('kwitansi_tunai_tanpa_shift', 0)) == 0, dict(err=(err or '')[:160], res=res, vs=vs))
        check('R3-3b hitungan shift Owner = model aplikasi (kwitansi dibatalkan dikurangkan sekali)', sql_expected(h, own) == app_expected(h, own), dict(sql=str(sql_expected(h, own)), app=str(app_expected(h, own))))
    finally: bk.set_shift(h, FINANCE, 'open')
    # K4: shift asal kwitansi masih terbuka: saling meniadakan di shift asal
    V = bk.ranap(h, nxt(), 'cash', user=FINANCE)
    err, res = bk.do_cancel(h, V['inv'], f"r3-{V['n']}")
    check('R3-4 shift asal kwitansi terbuka: void_shift_id = shift asal, tanpa tanda', err is None and h.nilai(f"select void_shift_id from public.clinic_payment_receipts where id={q(V['receipt'])}") == r.SHIFT[FINANCE]
          and D(res.get('kwitansi_tunai_tanpa_shift', 0)) == 0, dict(err=(err or '')[:160], res=res))
    # K5: penerimaan langsung Tunai tanpa shift: perilaku lama utuh (tanpa_shift + cash_amount = total)
    U = bk.rj(h, nxt(), 'Tunai', user=ADMIN); bk.set_shift(h, ADMIN, 'closed'); bk.set_shift(h, OWNER, 'closed')
    try: err, res = bk.do_cancel(h, U['inv'], f"r3-{U['n']}")
    finally: bk.set_shift(h, ADMIN, 'open'); bk.set_shift(h, OWNER, 'open')
    check('R3-5 penerimaan langsung Tunai tanpa shift: tetap tanpa_shift, cash_amount = total (perilaku #498 utuh)', err is None and res['shift_mode'] == 'tanpa_shift' and D(res['cash_amount']) == U['total'] and D(res.get('kwitansi_tunai_tanpa_shift', 0)) == 0, dict(err=(err or '')[:160], res=res))
    # K6: uang muka (transfer) dipakai: tidak ada Tunai, tidak ditandai
    Ad = bk.ranap(h, nxt(), 'advance'); bk.set_shift(h, OWNER, 'closed')
    try: err, res = bk.do_cancel(h, Ad['inv'], f"r3-{Ad['n']}")
    finally: bk.set_shift(h, OWNER, 'open')
    check('R3-6 uang muka transfer dipakai, tanpa shift: nonkas, tanpa tanda', err is None and res['shift_mode'] == 'nonkas' and D(res.get('kwitansi_tunai_tanpa_shift', 0)) == 0, dict(err=(err or '')[:160], res=res))
    check('R3-7 neraca saldo nol di akhir', bk.tb(h) == 0, str(bk.tb(h)))


# ------------------------------------------------------------------------------------------------ database plumbing
def raw(db, sql, dbname):
    env = {**os.environ, 'PSQLRC': '/dev/null', 'PGDATABASE': dbname}
    p = subprocess.run(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True, env=env)
    return p.returncode, p.stdout, p.stderr


CREATED = []


def mkdb(db, name, template):
    os.environ.pop('PGDATABASE', None)
    db.sql('drop database if exists %s' % name); db.sql('create database %s template %s' % (name, template)); CREATED.append(name)


def drop_created(db):
    os.environ.pop('PGDATABASE', None)
    while CREATED:
        db.sql('drop database if exists %s' % CREATED.pop())


def apply_text(db, name, text):
    rc, out, err = raw(db, 'begin;\n' + text + '\ncommit;', name)
    if rc: raise RuntimeError((err + out)[-1500:])
    # Migrasi yang ditulis SESUDAH kandidat (mis. tanggal efektif petshop) dipasang di atasnya, urutan nyata; rantai dasar hanya memuat yang lebih lama.
    for later in LATER:
        rc, out, err = raw(db, 'begin;\n' + (MIG / later).read_text() + '\ncommit;', name)
        if rc: raise RuntimeError(later + ': ' + (err + out)[-1500:])


def suite_result(label, rc, err, expect_min):
    passes = [re.sub(r'^.*MT_PASS ', '', l) for l in err.splitlines() if 'MT_PASS ' in l]
    why = ''
    if rc:
        errs = [l for l in err.splitlines() if l.startswith('ERROR')]
        why = (errs[0] if errs else err.strip().splitlines()[-1] if err.strip() else 'error')[:400]
    return rc == 0 and len(passes) >= expect_min, passes, why


def section_r2(db, tag, cand):
    name = f'{tag}_p'; mkdb(db, name, 'tpl_chain')
    if cand: apply_text(db, name, cand)
    rc, out, err = raw(db, (TESTS / 'mitigasi_petshop.sql').read_text(), name)
    ok, passes, why = suite_result('r2', rc, err, 28)
    check(f'R2 SQL suite mitigasi_petshop.sql: {len(passes)} asersi lulus semua', ok, why or f'{len(passes)} asersi')
    for pn in passes[-3:]: pass


def section_r1(db, tag, cand):
    name = f'{tag}_b'; mkdb(db, name, 'tpl_pemb')
    if cand: apply_text(db, name, cand)
    helpers = (TESTS / 'batal_pembelian/_helpers.sql').read_text()
    rc, out, err = raw(db, 'begin;\n' + helpers + (TESTS / 'mitigasi_pembelian.sql').read_text(), name)
    ok = rc == 0
    why = ''
    if rc:
        errs = [l for l in err.splitlines() if l.startswith('ERROR')]
        why = (errs[0] if errs else err.strip().splitlines()[-1] if err.strip() else 'error')[:400]
    check('R1 SQL suite mitigasi_pembelian.sql lulus semua asersi (izin dan pratinjau)', ok, why)


def section_race(db, tag, cand):
    """R1/petshop: pelaku yang TIDAK berhak ditolak SEBELUM menunggu kunci baris penjualan."""
    name = f'{tag}_race'; mkdb(db, name, 'tpl_chain')
    if cand: apply_text(db, name, cand)
    os.environ['PGDATABASE'] = name
    try:
        db.sql(bp.RACE_FIX); db.sql(bp.race_sale('MT-RACE1'))
        sale = db.sql("select id from sales where no_struk='MT-RACE1';").splitlines()[-1]
        staff = bp.OWNER_SESSION.replace('0000000000a1', '0000000000a2')
        assert staff != bp.OWNER_SESSION
        calls = {'cancel_pos_sale_receipt': f"select public.cancel_pos_sale_receipt('{sale}',0,'mt-k1','alasan uji')",
                 'receive_pos_sale_payment': f"select public.receive_pos_sale_payment('{sale}',0,'mt-k2','[{{\"method\":\"Tunai\",\"amount\":100000}}]'::jsonb)",
                 'cancel_online_disbursement': f"select public.cancel_online_disbursement('{sale}',0,'mt-k3','alasan uji')"}
        for fn, call in calls.items():
            with c.Session(db, 'obsr') as obs, c.Session(db, 'holder') as a, c.Session(db, 'staffr') as b:
                a.sql(f"begin; select 1 from public.sales where id='{sale}' for update;")
                b.sql(staff); t0 = time.time(); b.send(call + ';')
                wait = blocked(obs, b)
                a.sql('commit;'); res = c.attempt(b, commit=False)
            check(f'R1-race {fn}: pelaku tanpa hak ditolak SEBELUM menunggu kunci baris penjualan (tidak ikut antre)', wait == 'NOT BLOCKED' and not res.get('ok', True) and 'tidak diizinkan' in str(res.get('error', '')), dict(wait=wait, res=str(res)[:160]))
    finally: os.environ.pop('PGDATABASE', None)


def klinik_db(db, tag, sec, cand):
    name = f'{tag}_k_{sec}'; mkdb(db, name, 'tpl_full')
    if cand: apply_text(db, name, cand)
    os.environ['PGDATABASE'] = name
    return name


def run_sections(db, tag, cand, secs):
    for s in secs:
        print('=== section', s, flush=True)
        try:
            if s in ('f1', 'f2', 'r3'):
                klinik_db(db, tag, s, cand); h = x.Harness(db)
                {'f1': section_f1, 'r3': section_r3}.get(s, lambda hh: section_f2(hh, db))(h)
            elif s == 'r2': section_r2(db, tag, cand)
            elif s == 'r1': section_r1(db, tag, cand)
            elif s == 'race': section_race(db, tag, cand)
            elif s == 'static': section_static(db, tag, cand)
        except Exception as e:
            check(f'SECTION {s} aborted', False, str(e).strip()[:500])
        finally: os.environ.pop('PGDATABASE', None)
    drop_created(db)


def section_static(db, tag, cand):
    text = (MIG / CAND).read_text()
    low = text.lower()
    check('statik: migrasi tanpa begin/commit sendiri', not any(l.strip().lower() in ('begin;', 'commit;') for l in text.splitlines()), '')
    outside = re.sub(r'\$(\w*)\$.*?\$\1\$', '', text, flags=re.S)   # di luar teks tambalan fungsi ($old$/$new$/$$ ...)
    check('statik: di luar teks tambalan, tidak ada insert/update/delete ke tabel data (hanya DDL, fungsi, kolom penanda)', not re.search(r'^\s*(insert into|update|delete from)\s+public\.', outside, re.M | re.I), '')
    name = f'{tag}_st'; mkdb(db, name, 'tpl_chain')
    if cand: apply_text(db, name, cand)
    os.environ['PGDATABASE'] = name
    try:
        meta = json.loads(db.sql("select coalesce(jsonb_agg(jsonb_build_object('f',p.oid::regprocedure::text,'sec',p.prosecdef,'cfg',p.proconfig::text,'anon',has_function_privilege('anon',p.oid,'execute'),'auth',has_function_privilege('authenticated',p.oid,'execute'))),'[]') from pg_proc p where p.proname='klinik_shift_expected_cash'").splitlines()[-1])
        check('ACL: klinik_shift_expected_cash definer, search_path kosong, tanpa hak anon/authenticated', len(meta) == 1 and meta[0]['sec'] and not meta[0]['anon'] and not meta[0]['auth'] and 'search_path=' in (meta[0]['cfg'] or ''), meta)
        marks = json.loads(db.sql("select coalesce(jsonb_object_agg(p.oid::regprocedure::text, position('MITIGASI_1111' in pg_get_functiondef(p.oid))>0),'{}') from pg_proc p where p.oid in ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)'::regprocedure,'public.pos_shift_pending_checkout_guard()'::regprocedure,'public.purchase_cancel_allowed(text)'::regprocedure,'public.preview_goods_receipt_cancellation(uuid,date)'::regprocedure,'public.cancel_purchase_payment(uuid,integer,text,text)'::regprocedure,'public.cancel_pos_sale_receipt(uuid,integer,text,text)'::regprocedure,'public.receive_pos_sale_payment(uuid,integer,text,jsonb)'::regprocedure,'public.cancel_online_disbursement(uuid,integer,text,text)'::regprocedure,'public.clinic_cancel_invoice_receipt(uuid,text,text)'::regprocedure,'public.clinic_cancel_invoice_receipt_preview(uuid)'::regprocedure)").splitlines()[-1])
        # Tiga RPC petshop kini pembungkus (migrasi tanggal efektif, LATER): tanda MITIGASI_1111 pindah ke saudara bertanggalnya (5/6/5 argumen), jadi diperiksa di sana.
        if LATER:
            moved = json.loads(db.sql("select coalesce(jsonb_object_agg(p.oid::regprocedure::text, position('MITIGASI_1111' in pg_get_functiondef(p.oid))>0),'{}') from pg_proc p where p.oid in ('public.cancel_pos_sale_receipt(uuid,integer,text,text,date)'::regprocedure,'public.receive_pos_sale_payment(uuid,integer,text,jsonb,date,text)'::regprocedure,'public.cancel_online_disbursement(uuid,integer,text,text,date)'::regprocedure)"))
            sib = lambda k: 'receive_pos_sale_payment(uuid,integer,text,jsonb,date,text)' if k.startswith('receive_pos_sale_payment') else k.replace(')', ',date)')
            marks = {k: (v or moved.get(sib(k), False)) for k, v in marks.items()}
        check('statik: sepuluh fungsi tertambal bertanda MITIGASI_1111', len(marks) == 10 and all(marks.values()), marks)
        order = db.sql("select (position('purchase_cancel_allowed(''pembelian.batalkan_pembayaran'')' in d) between 1 and position('pg_advisory_xact_lock' in d) - 1)::text||'|'||(position('purchase_cancel_allowed(''pembelian.batalkan_pembayaran'')' in d) < position('for update' in d))::text from (select pg_get_functiondef('public.cancel_purchase_payment(uuid,integer,text,text)'::regprocedure) d) z").splitlines()[-1]
        check('statik: cancel_purchase_payment memeriksa izin SEBELUM kunci advisory dan kunci baris', order == 'true|true', order)
        again = None
        try: apply_text(db, name, text); again = 'applied'
        except RuntimeError as e: again = str(e)
        check('statik: pemasangan kedua gagal tertutup (sudah dipasang)', again != 'applied' and 'already' in again.lower(), (again or '')[:200])
    finally: os.environ.pop('PGDATABASE', None)


ALL_SECS = ['f1', 'f2', 'r3', 'r2', 'r1', 'race', 'static']


def build_templates(db, exclude):
    okr.build(db, exclude)
    db.sql('create database tpl_chain template postgres;')
    x.setup(x.Harness(db))
    db.sql('create database tpl_full template postgres;')
    prep_pemb(db)


def prep_pemb(db):
    os.environ.pop('PGDATABASE', None)
    db.sql('drop database if exists tpl_pemb'); db.sql('create database tpl_pemb template tpl_chain')
    rc, out, err = raw(db, (TESTS / 'batal_pembelian/00_fixture.sql').read_text(), 'tpl_pemb')
    if rc: raise RuntimeError('fixture pembelian gagal: ' + err[-400:])


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin'); ap.add_argument('--attach')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--sections'); ap.add_argument('--only'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    secs = a.sections.split(',') if a.sections else ALL_SECS
    cand_text = (MIG / CAND).read_text()
    extra = {}
    try:
        if a.attach:
            with okr.Attached(r.BIN, a.attach) as db:
                if a.mutations: extra['mutants'] = run_mutants(db, cand_text, a.only)
                else:
                    if 'r1' in secs or a.sections is None:
                        try: db.sql('select 1 from pg_database where datname=%s' % q('tpl_pemb'))
                        except Exception: pass
                        prep_pemb(db)
                    run_sections(db, 'dev%d' % int(time.time()), None if a.baseline else cand_text, secs)
        else:
            with r.NativePostgres(r.BIN) as db:
                build_templates(db, {CAND, *LATER})
                if a.mutations: extra['mutants'] = run_mutants(db, cand_text, a.only)
                else: run_sections(db, 'v', None if a.baseline else cand_text, secs)
    except Exception as e:
        check('HARNESS', False, str(e)[:800])
    totals = {s: sum(cc['status'] == s for cc in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='mutations' if a.mutations else 'RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals)
    if a.mutations: return int(not all(m['killed'] for m in extra['mutants'].values()) or totals['FAIL'] > 0)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


def run_mutants(db, cand, only):
    from importlib.machinery import SourceFileLoader
    mut = SourceFileLoader('mut', str(ROOT / 'scripts/test-mitigasi-audit-mutants.py')).load_module()
    out = {}; plan = [('M00 control (unmodified candidate)', cand, ALL_SECS)]
    for name, secs, pairs in mut.MUTANTS:
        text, ok = cand, True
        for old, new, expected in pairs:
            n = text.count(old)
            if n != expected: check(name + ' anchor occurs %d time(s) (expected %d)' % (n, expected), False, old[:60]); ok = False; break
            text = text.replace(old, new)
        if ok and (not only or any(o in name for o in only.split(','))): plan.append((name, text, secs))
    for i, (name, text, secs) in enumerate(plan):
        before = len(RESULTS); crash = None
        try: run_sections(db, f'm{i}', text, secs)
        except Exception as e: crash = str(e)[:200]
        fails = [cc['case'] for cc in RESULTS[before:] if cc['status'] == 'FAIL']
        del RESULTS[before:]
        if i == 0: check(name + ' has 0 FAIL', not fails and not crash, (fails + [crash or ''])[:3])
        else:
            out[name] = dict(killed=bool(fails), failing=fails[:4], crash=crash)
            check(name + ' KILLED', bool(fails), fails[:3] or [crash]); print('   failing:', fails[:4], flush=True)
        os.environ.pop('PGDATABASE', None)
    return out


if __name__ == '__main__': sys.exit(main())
