#!/usr/bin/env python3
"""LOCAL ONLY: original full-schema public RPCs, fictional data; no business stubs.
--baseline stops before applying this candidate, retaining exact RED evidence.
"""
import contextlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('dp', ROOT / 'scripts/test-dp-lanjut-ranap-postgres.py')
assert spec is not None and spec.loader is not None
dp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dp)
r = dp.r
MIGRATION = '20261104020000_ranap_rekap_dp_opsional.sql'


def extra(h, v, n, amount):
    prescription = r.uid(9, n * 10 + 9)
    h.sql(f"""insert into public.prescription_items(id,medical_record_id,nama_obat,qty,harga,satuan,jenis)
    select {r.q(prescription)},id,'Jasa susulan fiktif',1,{amount},'kali','jasa'
    from public.medical_records where visit_id={r.q(v)} order by created_at limit 1;""")
    return [{'description': 'Jasa susulan fiktif', 'qty': 1, 'price': amount, 'kind': 'jasa',
             'unit': 'kali', 'prescription_item_id': prescription, 'discount_percent': 0}]


def initial(h, n, amount=1000000, paid=500000):
    v = dp.visit(h, n)
    rows = r.baris(n, 1)
    rows[0]['price'] = amount
    sql = r.tagih_biasa_sql(v, f'initial-{n}', rows, r.STAFF, dp=paid)
    h.sql(sql, r.STAFF)
    h.sql(f"select public.clinic_admit_inpatient_typed({r.q(v)},'Fiktif','admit-{n}','sakit');", r.STAFF)
    return v, h.aktif(v)


def edges(h, db):
    # Actual stock/FIFO/HPP posting on a zero-DP subsequent stage, then replay.
    v, first = initial(h, 320)
    before_stock = h.angka(f"select qty from public.stock where item_id={r.q(r.ITEM)} and warehouse_id={r.q(r.WH)}")
    sql = r.tagih_sql(v, 'repeat-stock', r.baris(320, 3), r.STAFF)
    h.sql(sql, r.STAFF)
    stock_inv = h.nilai(f"select id from public.invoices where request_key='repeat-stock'")
    no = h.no_tagihan(stock_inv)
    before = dp.snapshot(h, v)
    h.sql(sql, r.STAFF)
    r.catat('repeat-zero-DP-stock-FIFO-HPP-once', dp.snapshot(h, v) == before
            and h.angka(f"select qty from public.stock where item_id={r.q(r.ITEM)} and warehouse_id={r.q(r.WH)}") == before_stock - 2
            and h.angka(f"select count(*) from public.stock_moves where source_ref={r.q(no)}") == 1
            and h.saldo_ref('510002', no) == -50000 and h.saldo_ref('150001', no) == 50000
            and h.saldo_ref('600001', no) == 4000 and h.saldo_ref('170001', no) == -4000
            and h.angka(f"select sum(qty_left) from public.stock_layers where item_id={r.q(r.ITEM)} and warehouse_id={r.q(r.WH)}") == before_stock - 2,
            {'stock_before': before_stock, 'stock_after': before['stock'], 'revenue': h.saldo_ref('510002', no), 'HPP': h.saldo_ref('600001', no), 'state': before})
    rows = extra(h, v, 320, 200000)
    for user, label in [(r.FIN_LUAR, 'cross-branch'), (r.FIN_NONAKTIF, 'inactive')]:
        before = dp.snapshot(h, v)
        err = h.gagal(r.tagih_sql(v, 'deny-' + label, rows, user), user)
        r.catat(label + '-repeat-denied-no-effects', bool(err and 'ACCESS_DENIED' in err) and dp.snapshot(h, v) == before, err)
    before = dp.snapshot(h, v)
    err = h.gagal(r.tagih_sql(v, 'forged-defer', rows, r.STAFF, ganti={'min_dp_deferred': True}), r.STAFF)
    r.catat('client-defer-still-rejected', bool(err and 'STAGE_INVALID' in err) and dp.snapshot(h, v) == before, err)

    # Real advance application, release and cancelled receipt. A surviving active
    # invoice still establishes a subsequent stage; cancellation never resets it.
    v = r.buat_kunjungan(h, 321, r.buat_pelanggan(h, 321))
    h.sql(r.bayar_sql(v, 'first-advance', [{'method': 'Transfer', 'amount': 50000}]), r.STAFF)
    h.sql(r.tagih_sql(v, 'first-covered', r.baris(321, 1), r.STAFF), r.STAFF)
    first = h.aktif(v)
    r.catat('initial-stage-advance-minimum-preserved', h.diterima(first) == 50000 and h.status_bayar(first) == 'DP', h.potret_tagihan(first))
    receipt = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={r.q(v)}")
    advance = h.nilai(f"select id from public.clinic_customer_advances where receipt_id={r.q(receipt)}")
    h.sql(r.lepas_sql(advance, 'release-initial-advance'), r.FINANCE)
    h.sql(r.batal_kwitansi_sql(receipt, 'cancel-initial-advance'), r.FINANCE)
    h.sql(r.tagih_sql(v, 'after-cancelled-initial', r.baris(321, 2), r.STAFF), r.STAFF)
    r.catat('cancelled-initial-receipt-active-invoice-still-qualifies', h.diterima(first) == 0
            and h.status_bayar(first) == 'Belum Lunas'
            and h.angka(f"select count(*) from public.invoices where visit_id={r.q(v)} and voided_at is null") == 2,
            'Initial minimum was met at issue; later release/cancellation preserves audit and active invoice, no mandatory recollection')

    # Actual public reissue of a legacy header-DP invoice, retaining lineage.
    v, old = initial(h, 322)
    stay = h.nilai(f"select id from public.inpatient_records where visit_id={r.q(v)}")
    h.sql(f"select public.clinic_change_inpatient_condition({r.q(stay)},'sembuh','Fiktif');", r.STAFF)
    h.sql(r.terbit_ulang_sql(old, 'reissue-header'), r.FINANCE)
    replacement = h.aktif(v)
    rows = extra(h, v, 322, 200000)
    before = dp.snapshot(h, v)
    err = h.gagal(r.tagih_sql(v, 'while-pending', rows, r.STAFF), r.STAFF)
    r.catat('void-original-plus-pending-replacement-not-qualifying', bool(err and 'DP_MINIMAL' in err)
            and dp.snapshot(h, v) == before, err)
    correction = r.baris(322, 1)
    correction[0]['price'] = 1000000
    h.sql(r.koreksi_sql(h, replacement, 'finish-reissue', correction), r.FINANCE)
    h.sql(r.tagih_sql(v, 'after-reissue', rows, r.STAFF), r.STAFF)
    r.catat('completed-reissue-qualifies-header-money-counted-once', h.diterima(replacement) == 500000
            and h.angka(f"select dp_amount from public.invoices where id={r.q(replacement)}") == 0
            and h.angka(f"select sum(total) from public.invoices where visit_id={r.q(v)} and voided_at is null") == 1200000
            and h.angka(f"select count(*) from public.invoices where id={r.q(old)} and voided_at is not null") == 1,
            {'active_total': 1200000, 'active_received': h.diterima(replacement), 'remaining': 700000, 'optional_DP': 350000})

    # Genuine independent sessions: stage caller waits at the existing shared
    # coordinator; duplicate succeeds without a second invoice or stock movement.
    spec = importlib.util.spec_from_file_location('parallel', ROOT / 'scripts/test-ranap-mitigasi-concurrency-postgres.py')
    assert spec is not None and spec.loader is not None
    c = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(c)
    v, first = initial(h, 323)
    rows = r.baris(323, 3)
    barriers = []
    with contextlib.ExitStack() as stack:
        observer = stack.enter_context(c.Session(db, 'repeat-observer'))
        one = stack.enter_context(c.Session(db, 'repeat-first', r.STAFF))
        two = stack.enter_context(c.Session(db, 'repeat-duplicate', r.STAFF))
        one.sql('begin; ' + r.tagih_sql(v, 'parallel-repeat', rows, r.STAFF))
        two.send('begin; ' + r.tagih_sql(v, 'parallel-repeat', rows, r.STAFF))
        c.wait_block(observer, two, one, barriers)
        one.sql('commit;')
        outcome = c.attempt(two)
    stock_inv = h.nilai("select id from public.invoices where request_key='parallel-repeat'")
    r.catat('concurrent-zero-DP-double-submit-once', outcome['ok'] and len(barriers) == 1
            and h.angka(f"select count(*) from public.invoices where visit_id={r.q(v)}") == 2
            and h.angka(f"select count(*) from public.stock_moves where source_ref={r.q(h.no_tagihan(stock_inv))}") == 1,
            {'lock_barriers': barriers, 'outcome': outcome})
    v, first = initial(h, 324)
    rows = r.baris(324, 3)
    before = dp.snapshot(h, v)
    barriers = []
    with contextlib.ExitStack() as stack:
        observer = stack.enter_context(c.Session(db, 'repeat-role-observer'))
        gate = stack.enter_context(c.Session(db, 'repeat-role-gate'))
        waiter = stack.enter_context(c.Session(db, 'repeat-role-waiter', r.STAFF))
        gate.sql(f"begin; select clinic_private.billing_lock(clinic_private.billing_keys_visit({r.q(v)}));")
        waiter.send('begin; ' + r.tagih_sql(v, 'parallel-role-revoked', rows, r.STAFF))
        c.wait_block(observer, waiter, gate, barriers)
        gate.sql(f"update public.profiles set is_active=false where id={r.q(r.STAFF)}; commit;")
        outcome = c.attempt(waiter)
    h.sql(f"update public.profiles set is_active=true where id={r.q(r.STAFF)}")
    r.catat('repeat-role-rechecked-after-coordinator-wait', not outcome['ok'] and 'ACCESS_DENIED' in outcome.get('error', '')
            and len(barriers) == 1 and dp.snapshot(h, v) == before, {'lock_barriers': barriers, 'outcome': outcome})
    # A zero-value document did not satisfy a genuine positive initial minimum.
    v = r.buat_kunjungan(h, 327, r.buat_pelanggan(h, 327))
    free = r.baris(327, 1)
    free[0]['price'] = 0
    h.sql(r.tagih_sql(v, 'zero-value-first', free, r.STAFF), r.STAFF)
    before = dp.snapshot(h, v)
    err = h.gagal(r.tagih_sql(v, 'positive-after-zero', r.baris(327, 2), r.STAFF), r.STAFF)
    r.catat('zero-value-document-not-an-initial-DP-bypass', bool(err and 'DP_MINIMAL' in err)
            and dp.snapshot(h, v) == before, err or 'Zero-value prior document incorrectly waived initial DP')
    # Stored invoice prices, line/nota discounts and tax stay authoritative even
    # after the prescription is changed; this statement must not reprice history.
    v = dp.visit(h, 326)
    rows = r.baris(326, 1)
    rows[0].update(price=1000000, discount_percent=10)
    h.sql(r.tagih_biasa_sql(v, 'stored-discount-tax', rows, r.FINANCE, dp=500000,
          ganti={'discount': 100000, 'tax': 88000, 'total': 888000}), r.FINANCE)
    inv = h.aktif(v)
    h.sql(f"update public.prescription_items set harga=42 where id={r.q(r.uid(9,3261))}")
    stored = json.loads(h.nilai(f"select json_build_object('subtotal',subtotal,'discount',discount,'tax',tax,'total',total,'paid',dp_amount) from public.invoices where id={r.q(inv)}"))
    line = json.loads(h.nilai(f"select json_build_object('harga',harga,'diskon_persen',diskon_persen,'qty',qty) from public.invoice_items where invoice_id={r.q(inv)}"))
    r.catat('stored-price-tax-discount-not-repriced-from-clinical', stored == {'subtotal':900000,'discount':100000,'tax':88000,'total':888000,'paid':500000}
            and line == {'harga':1000000,'diskon_persen':10,'qty':1}
            and h.saldo_ref('150001',h.no_tagihan(inv)) == 388000
            and h.saldo_ref('312005',h.no_tagihan(inv)) == -88000, {'stored_invoice':stored,'stored_line':line,'clinical_price_now':42,'remaining':388000,'optional_50_percent':194000})
    v, first = initial(h, 325)
    rows = extra(h, v, 325, 100000)
    before = dp.snapshot(h, v)
    h.sql("update public.accounting_locks set closed_until='2026-11-03' where id;")
    err = h.gagal(r.tagih_sql(v, 'closed-repeat', rows, r.STAFF), r.STAFF)
    r.catat('closed-period-repeat-atomic', bool(err and ('PERIOD' in err or 'tutup' in err.lower())) and dp.snapshot(h, v) == before, err)


def run(h, db):
    h.sql(r.dasar_sql())
    h.sql("insert into public.role_modules(role,module_id) values ('FINANCE','klinik') on conflict do nothing;")
    v, inv = initial(h, 300)
    no = h.no_tagihan(inv)
    r.catat('initial-STAFF-header-DP-preserved', h.diterima(inv) == 500000
            and h.angka(f"select count(*) from public.invoice_payments where invoice_id={r.q(inv)}") == 0
            and h.saldo_ref('510002', no) == -1000000 and h.saldo_ref('150001', no) == 500000,
            {'total': 1000000, 'header_DP': h.diterima(inv), 'wallet': 0})
    rows = extra(h, v, 300, 300000)
    before = dp.snapshot(h, v)
    err = h.gagal(r.tagih_sql(v, 'repeat-300', rows, r.STAFF), r.STAFF)
    r.catat('STAFF-repeat-zero-DP-no-override', not err, err or '300000 new AR, no money required')
    if err:
        r.catat('failed-stage-atomic-no-effects', dp.snapshot(h, v) == before, dp.snapshot(h, v))
        return
    stage = h.nilai(f"select id from public.invoices where visit_id={r.q(v)} and id<>{r.q(inv)} and voided_at is null")
    r.catat('repeat-posts-real-revenue-AR-not-money', h.saldo_ref('510002', h.no_tagihan(stage)) == -300000
            and h.saldo_ref('150001', h.no_tagihan(stage)) == 300000 and h.diterima(stage) == 0
            and h.status_bayar(stage) == 'Belum Lunas' and h.diterima(inv) == 500000,
            {'total': 1300000, 'received': 500000, 'remaining': 800000, 'optional_50_percent': 400000})
    before = dp.snapshot(h, v)
    h.sql(r.tagih_sql(v, 'repeat-300', rows, r.STAFF), r.STAFF)
    r.catat('repeat-stage-idempotent-no-duplicates', dp.snapshot(h, v) == before, dp.snapshot(h, v))
    rows2 = extra(h, v, 301, 200000)
    h.sql(r.tagih_sql(v, 'repeat-200', rows2, r.STAFF), r.STAFF)
    r.catat('combined-remaining-not-added-items-or-cumulative-target',
            h.angka(f"select sum(total) from public.invoices where visit_id={r.q(v)} and voided_at is null") == 1500000,
            {'formula': '(1000000 + 300000 + 200000 - 500000) * 0.5', 'remaining': 1000000, 'optional_DP': 500000})
    h.sql(r.bayar_sql(v, 'optional-500', [{'method': 'Tunai', 'amount': 200000}, {'method': 'Transfer', 'amount': 300000}]), r.STAFF)
    receipt = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={r.q(v)}")
    r.catat('later-mixed-receipt-oldest-initial-first', h.diterima(inv) == 1000000
            and h.diterima(stage) == 0 and h.status_bayar(inv) == 'Lunas'
            and h.angka(f"select count(*) from public.clinic_payment_receipt_parts where receipt_id={r.q(receipt)}") == 2,
            {'initial_received': h.diterima(inv), 'next_stage_received': h.diterima(stage)})
    h.sql(r.batal_kwitansi_sql(receipt, 'cancel-optional'), r.FINANCE)
    r.catat('cancellation-restores-header-net-and-method-accounts', h.diterima(inv) == 500000
            and h.status_bayar(inv) == 'DP' and h.saldo_ref('110003', no) == 500000
            and h.saldo_ref('120002', no) == 0, {'received': h.diterima(inv), 'cash': h.saldo_ref('110003', no), 'bank': h.saldo_ref('120002', no)})
    for n, admitted in [(310, False), (311, True)]:
        vv = dp.visit(h, n)
        if admitted:
            h.sql(f"select public.clinic_admit_inpatient_typed({r.q(vv)},'Fiktif','first-stage','sakit');", r.STAFF)
        before = dp.snapshot(h, vv)
        sql = r.tagih_sql(vv, f'first-stage-{n}', r.baris(n, 1), r.STAFF) if admitted else r.tagih_biasa_sql(vv, 'outpatient-short', r.baris(n, 1), r.STAFF, dp=10000)
        err = h.gagal(sql, r.STAFF)
        r.catat('first-stage-minimum' if admitted else 'outpatient-minimum', bool(err and 'DP_MINIMAL' in err)
                and dp.snapshot(h, vv) == before, err)
    r.catat('all-journals-balanced', h.angka('select count(*) from (select entry_id from public.journal_lines group by entry_id having sum(debit)<>sum(credit)) x') == 0,
            'Real revenue/AR/cash/bank values checked, not only aggregate balance')
    edges(h, db)
    r.catat('all-extended-journals-balanced', h.angka('select count(*) from (select entry_id from public.journal_lines group by entry_id having sum(debit)<>sum(credit)) x') == 0, 'Per-entry journal balances after all extended scenarios')


def main():
    baseline = '--baseline' in sys.argv
    # Baseline bootstrap reads original files, excluding ONLY this candidate.
    original_glob = Path.glob
    if baseline:
        def baseline_glob(path, pattern, **kwargs):
            return (p for p in original_glob(path, pattern, **kwargs) if p.name != MIGRATION)
        Path.glob = baseline_glob
    with contextlib.ExitStack() as stack:
        r.fixture.ROOT = ROOT
        db = stack.enter_context(r.NativePostgres(r.BIN))
        r.fixture.DisposablePostgres.bootstrap(db)
        try:
            run(r.Harness(db), db)
        except Exception as error:
            r.catat('HARNESS', False, str(error))
    totals = {s: sum(x['status'] == s for x in r.HASIL) for s in ('PASS', 'FAIL')}
    result = {'mode': 'baseline' if baseline else 'candidate', 'migrations': len(list(original_glob(ROOT / 'supabase/migrations', '*.sql'))) - int(baseline and (ROOT / 'supabase/migrations' / MIGRATION).exists()), 'total': totals, 'cases': r.HASIL}
    print('TOTAL', json.dumps(totals))
    outputs = [a for a in sys.argv[1:] if a != '--baseline']
    if outputs:
        Path(outputs[0]).write_text(json.dumps(result, indent=2))
    return int(bool(totals['FAIL']))


if __name__ == '__main__':
    sys.exit(main())
