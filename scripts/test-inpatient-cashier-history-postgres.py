#!/usr/bin/env python3
"""Full original schema: closed-shift history must not authorize money writes."""
import argparse, importlib.util, json, sys
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cashier', ROOT / 'scripts/test-inpatient-cashier-cart-postgres.py')
assert spec and spec.loader
t = importlib.util.module_from_spec(spec); spec.loader.exec_module(t)
r, x, q = t.r, t.x, t.q
cases = []
def check(name, ok, detail):
    cases.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail))
    print(json.dumps(cases[-1]), flush=True)
def run(h):
    x.setup(h)
    v, mr = t.m.visit(h, 1981)
    stay = h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
    draft = t.read(h, v, stay)
    sql = t.save(v, stay, draft['snapshot'], draft['rows'], [dict(method='Tunai', amount=330000)], key='history-paid')
    h.sql(sql, r.STAFF)
    invoice = h.aktif(v)
    before = h.nilai(f"select jsonb_build_array((select count(*) from journal_entries),(select count(*) from clinic_payment_receipts),(select count(*) from clinic_pending_cart_edits),(select to_jsonb(i) from invoices i where i.id={q(invoice)}))")
    h.sql(f"update cashier_shifts set status='closed',closed_at=now() where opened_by={q(r.STAFF)}")
    for discharged in [False, True]:
        if discharged:
            h.sql(f"select set_config('request.jwt.claims',{q(json.dumps(dict(sub=r.OWNER,role='authenticated')))},false);update inpatient_records set discharged_at=now() where id={q(stay)}")
        try:
            read = t.read(h, v, stay)
            check('paid history accessible without own shift discharged=' + str(discharged), read.get('state') == 'SHIFT_REQUIRED' and read.get('quote') is None and read.get('snapshot') is None and any(i['id'] == invoice and i['received'] == 330000 for i in read['history']) and len(read['receipts']) == 1, read)
        except RuntimeError as error:
            check('paid history accessible without own shift discharged=' + str(discharged), False, str(error))
    err = h.gagal(sql, r.STAFF)
    check('closed own shift still rejects exact money replay', bool(err and 'SHIFT_INVALID' in err), err)
    # Another operator's open shift cannot authorize this operator's write.
    other = h.nilai(f"select count(*) from cashier_shifts where opened_by<>{q(r.STAFF)} and status='open'")
    check('fixture retains other open shifts', int(other) > 0, other)
    for user, label in [(r.FIN_NONAKTIF, 'inactive'), (r.FIN_LUAR, 'wrong branch')]:
        err = h.gagal(f'select clinic_read_inpatient_cashier({q(stay)},{q(v)})', user)
        check('closed-shift history denies ' + label, bool(err and 'ACCESS_DENIED' in err), err)
    h.sql("insert into role_modules(role,module_id) values('STAFF','laporan') on conflict do nothing")
    err = h.gagal(f'select clinic_read_inpatient_cashier({q(stay)},{q(v)})', r.STAFF)
    check('closed-shift history denies role without clinic module', bool(err and 'ACCESS_DENIED' in err), err)
    h.sql("delete from role_modules where role='STAFF'")
    err = h.gagal(f'select clinic_read_inpatient_cashier({q(r.uid(8,1999))},{q(v)})', r.STAFF)
    check('closed-shift history denies mismatched stay', bool(err and 'ACCESS_DENIED' in err), err)
    after = h.nilai(f"select jsonb_build_array((select count(*) from journal_entries),(select count(*) from clinic_payment_receipts),(select count(*) from clinic_pending_cart_edits),(select to_jsonb(i) from invoices i where i.id={q(invoice)}))")
    check('read-only history and rejected replay preserve issued document money audit', before == after, dict(before=before, after=after))
    h.sql(f"update cashier_shifts set status='open',closed_at=null where opened_by={q(r.STAFF)}")
    # Prove a discharged visit still uses this original atomic engine with a fresh cart.
    v2, mr2 = t.m.visit(h, 1982)
    stay2 = h.nilai(f'select id from inpatient_records where visit_id={q(v2)}')
    h.sql(f"select set_config('request.jwt.claims',{q(json.dumps(dict(sub=r.OWNER,role='authenticated')))},false);update inpatient_records set discharged_at=now() where id={q(stay2)}")
    cart = t.read(h, v2, stay2)
    err = h.gagal(t.save(v2, stay2, cart['snapshot'], cart['rows'], [dict(method='Tunai',amount=330000)], key='discharged-pending'), r.STAFF)
    check('discharged pending cart posts original stock revenue and money atomically', not err and h.angka(f'select total from invoices where visit_id={q(v2)}') == 330000 and h.saldo_ref('510002', h.no_tagihan(h.aktif(v2))) == -330000, err)
    # The OUTER wrapper has its own shift/settings waits before original352.
    # Re-check persisted access, account destination and tax AFTER those waits.
    import contextlib
    def money_state(visit):
        return h.nilai(f"select jsonb_build_array((select count(*) from journal_entries),(select count(*) from clinic_payment_receipts),(select count(*) from clinic_pending_cart_edits),(select jsonb_agg(to_jsonb(p) order by p.id) from prescription_items p join medical_records m on m.id=p.medical_record_id where m.visit_id={q(visit)}),(select sum(qty) from stock),(select count(*) from invoices where visit_id={q(visit)}))")
    for n, kind, lock, change, restore, expected in [
        (1983, 'role across shift', f'select id from cashier_shifts where id={q(r.SHIFT[r.STAFF])} for update', "insert into role_modules(role,module_id) values('STAFF','laporan') on conflict do nothing", "delete from role_modules where role='STAFF'", 'ACCESS_DENIED'),
        (1984, 'role across settings', 'select id from company_settings where id=true for update', "insert into role_modules(role,module_id) values('STAFF','laporan') on conflict do nothing", "delete from role_modules where role='STAFF'", 'ACCESS_DENIED'),
        (1985, 'tax across settings', 'select id from company_settings where id=true for update', 'update company_settings set mode_pkp=true,ppn_rate=12 where id=true', 'update company_settings set mode_pkp=false,ppn_rate=11 where id=true', 'CART_STALE'),
        (1986, 'account across settings', 'select id from company_settings where id=true for update', "update cash_accounts set no_rekening='FIKTIF-GANTI' where coa_code='120002'", "update cash_accounts set no_rekening=null where coa_code='120002'", 'ACCOUNT_INVALID'),
    ]:
        visit, _ = t.m.visit(h, n)
        record = h.nilai(f'select id from inpatient_records where visit_id={q(visit)}')
        draft = t.read(h, visit, record); before = money_state(visit); barriers = []
        with contextlib.ExitStack() as stack:
            observer = stack.enter_context(x.c.Session(h.db, f'cashier-{n}-observer'))
            gate = stack.enter_context(x.c.Session(h.db, f'cashier-{n}-gate'))
            waiter = stack.enter_context(x.c.Session(h.db, f'cashier-{n}-waiter'))
            waiter.sql(x.claims(r.STAFF))
            gate.sql('begin;' + lock + ';')
            waiter.send('begin;' + t.save(visit, record, draft['snapshot'], draft['rows'], [dict(method='Transfer', amount=330000)], key=f'outer-wait-{n}'))
            try:
                x.c.wait_block(observer, waiter, gate, barriers)
            except (RuntimeError, TimeoutError, AssertionError) as error:
                outcome = x.c.attempt(waiter)
                raise RuntimeError(f'{error}; waiter outcome={outcome}') from error
            gate.sql(change + ';commit;')
            outcome = x.c.attempt(waiter)
        check('outer cashier revalidates ' + kind + ' without writes or deadlock', not outcome['ok'] and expected in outcome.get('error', '') and money_state(visit) == before and len(barriers) == 1, dict(outcome=outcome, barriers=barriers, unchanged=money_state(visit) == before))
        h.sql(restore)

def main():
    p = argparse.ArgumentParser(); p.add_argument('--json', type=Path, required=True); a = p.parse_args()
    try:
        with r.NativePostgres(r.BIN) as db:
            r.fixture.DisposablePostgres.bootstrap(db); run(x.Harness(db))
    except Exception as error:
        check('HARNESS', False, str(error))
    totals = {s:sum(c['status'] == s for c in cases) for s in ['PASS','FAIL']}
    a.json.write_text(json.dumps(dict(migration_count=len(list((ROOT/'supabase/migrations').glob('*.sql'))), cases=cases, totals=totals), indent=2)); print(totals)
    return int(totals['FAIL'] > 0)
if __name__ == '__main__': sys.exit(main())
