#!/usr/bin/env python3
"""Finance-completed 'Kembalikan saldo uang muka' (clinic advance / UMK partial or full refund by bank Transfer)
(migration 20261107170000_refund_uang_muka.sql). Live need: advance UMK-202611-0045 (Keripik Tempe, Ciomas ranap) after OWNER 'tarik baris'
of Infus Refill leaves Rp30.000 of advance balance that Andri wants transferred back from Bank BCA 120002.

Native full schema, fictional fixtures, throwaway local cluster, no network.
  flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-refund-uang-muka-postgres.py --pg-bin DIR --json out.json
  --baseline    chain WITHOUT the candidate migration: every refund case must FAIL (RED); existing refusals PASS
  --mutations   chain without the candidate once, then each mutant of the candidate in a cloned database; all must be killed
  --attach DIR  dev only: clone of the `postgres` DB (chain WITHOUT candidate, x.setup done) in a running cluster, candidate applied on top
"""
import argparse, importlib.util, json, os, sys, time
from decimal import Decimal
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('tbl', ROOT / 'scripts/test-owner-tarik-baris-lunas-postgres.py'); assert spec and spec.loader
tbl = importlib.util.module_from_spec(spec); spec.loader.exec_module(tbl)
okr, m, x, r, q, j, c = tbl.okr, tbl.m, tbl.x, tbl.r, tbl.q, tbl.j, tbl.c
CANDIDATE = '20261107170000_refund_uang_muka.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = []
FN = dict(req='clinic_advance_refund_request', claim='clinic_advance_refund_claim', done='clinic_advance_refund_complete', cancel='clinic_advance_refund_cancel', lst='get_clinic_advance_refunds')
SIG = {'req': 'uuid,numeric,text,jsonb,text', 'claim': 'uuid', 'done': 'uuid,date,uuid,text', 'cancel': 'uuid,text,boolean', 'lst': 'uuid,boolean,text,integer'}
DEST = dict(bank='BCA', account='1234567890', name='Keripik Tempe')
REASON = 'Dikembalikan ke pelanggan sesuai keputusan Andri'
ACCTS = ('110003', '120002', '150001', '170001', '314001', '510002', '600001')
SRC = 'klinik-uang-muka-refund'


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:420], flush=True)


def err_has(err, *words): return bool(err) and all(w in err for w in words)
def D(v): return Decimal(str(v))
def today(h): return h.nilai("select (now() at time zone 'Asia/Jakarta')::date::text")


def rpc(h, fn, args, user=r.OWNER):
    try: return json.loads(h.nilai(f"select public.{FN.get(fn, fn)}({args});", user)), None
    except Exception as e: return None, str(e)


def req(h, F, amount, key, user=r.OWNER, reason=REASON, dest=DEST, adv=None):
    a = 'null' if amount is None else (amount if isinstance(amount, str) else str(amount))
    return rpc(h, 'req', f"{q(adv or F['adv'])},{a},{('null' if reason is None else q(reason))},{('null' if dest is None else j(dest))},{('null' if key is None else q(key))}", user)


def claim(h, rid, user=r.FINANCE): return rpc(h, 'claim', q(rid), user)


def done(h, rid, user=r.FINANCE, date=None, account='null', ref='TRF-BCA-0001'):
    d = q(date) + '::date' if date not in (None, 'null') else ('null::date' if date == 'null' else q(today(h)) + '::date')
    return rpc(h, 'done', f"{q(rid)},{d},{account if account == 'null' else q(account) + '::uuid'},{('null' if ref is None else q(ref))}", user)


def cancel(h, rid, user=r.FINANCE, reason='Belum jadi ditransfer, dibatalkan', conf='true'): return rpc(h, 'cancel', f"{q(rid)},{('null' if reason is None else q(reason))},{conf}", user)


def cnt(table):
    return f"(case when to_regclass('{table}') is null then 0 else (xpath('/row/c/text()',query_to_xml('select count(*) as c from {table}',false,true,'')))[1]::text::int end)"


def tbl_md5(table):
    return f"(case when to_regclass('{table}') is null then '-' else (xpath('/row/c/text()',query_to_xml('select coalesce(md5(string_agg(t::text,'''' order by t.id)),''-'') as c from {table} t',false,true,'')))[1]::text end)"


def snap(h, F):
    """Everything a refund may or may not touch, as one comparable value (no time-varying noise)."""
    return json.loads(h.nilai(f"""select jsonb_build_object(
 'adv',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from clinic_customer_advances a where visit_id={q(F['v'])}),
 'apps',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from clinic_advance_applications a where invoice_id={q(F['inv'])}),
 'pays',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from invoice_payments p where invoice_id={q(F['inv'])}),
 'inv',(select to_jsonb(i) from invoices i where id={q(F['inv'])}),
 'receipt',(select status from clinic_payment_receipts where id={q(F['receipt'])}),
 'journals',(select count(*) from journal_entries),'tb',(select coalesce(sum(debit)-sum(credit),0) from journal_lines),
 'refunds',{cnt('clinic_private.advance_refunds')},'refunds_md5',{tbl_md5('clinic_private.advance_refunds')},'events',{cnt('clinic_private.advance_refund_events')}
)"""))


def adv_row(h, F, adv=None): return json.loads(h.nilai(f"select to_jsonb(a) from clinic_customer_advances a where id={q(adv or F['adv'])}"))
def bal(a): return D(a['amount']) - D(a['applied'])


def live(h, n):
    """Mirror of the live case: advance Rp (total) applied in full by a ranap invoice, then OWNER tarik baris of the Infus Refill line (30.000) -> balance 30.000."""
    F = tbl.build(h, n)
    e = tbl.call(h, F, tbl.L(F['INF']), key=f'rum-tarik-{n}')
    if e: raise RuntimeError('tarik baris failed: ' + e[:300])
    a = adv_row(h, F)
    assert bal(a) == 30000, a
    return F


def refused(h, F, name, res, words, s0=None):
    """res = (result, err) of a call made AFTER s0 = snap; asserts the error words and that nothing changed."""
    result, err = res
    s1 = snap(h, F)
    check(name, result is None and err_has(err, *words) and (s0 is None or s1 == s0), dict(error=(err or 'NO ERROR')[:200], changed=(s0 is not None and s1 != s0)))


def lines_of(h, journal_id):
    rows = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object('code',a.code,'debit',l.debit,'credit',l.credit) order by a.code,l.debit,l.credit),'[]') from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id={q(journal_id)}"))
    return sorted((l_['code'], D(l_['debit']), D(l_['credit'])) for l_ in rows)


def refund_row(h, rid): return json.loads(h.nilai(f"select to_jsonb(t) from clinic_private.advance_refunds t where id={q(rid)}"))
def events(h, rid): return json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') from clinic_private.advance_refund_events e where refund_id={q(rid)}"))
def tb(h): return h.angka('select coalesce(sum(debit)-sum(credit),0) from journal_lines')


def run(h, db=None, setup=True, baseline=False, sections=None):
    if setup: x.setup(h)
    tbl.prep(h)
    S = lambda name: sections is None or name in sections
    have = h.nilai("select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname = any(array['clinic_advance_refund_request','clinic_advance_refund_claim','clinic_advance_refund_complete','clinic_advance_refund_cancel','get_clinic_advance_refunds']))::text"
                   "||'|'||(to_regclass('clinic_private.advance_refunds') is not null)::text||'|'||(to_regclass('clinic_private.advance_refund_events') is not null)::text"
                   "||'|'||(select count(*) from information_schema.columns where table_name='clinic_customer_advances' and column_name in ('refunded_amount','refund_reserved'))::text")
    check('preflight: 5 RPCs, refund table, audit event table and the 2 advance columns exist', have == '5|true|true|2', dict(have=have))
    for name, fn in (('main', sec_main), ('life', sec_life), ('neg', sec_neg), ('scope', sec_scope), ('static', sec_static)):
        if S(name):
            try: fn(h)
            except Exception as e: check(f'section {name} crashed (fixture or result missing)', False, str(e).strip().splitlines()[-1][:300] if str(e).strip() else repr(e))
    if db is not None and S('race'):
        try: races(h, db)
        except Exception as e: check('section race crashed', False, str(e).strip().splitlines()[-1][:300] if str(e).strip() else repr(e))


def sec_main(h):
    td = today(h)
    # ------------------------------------------------------------------ RED anchor: what the EXISTING flows do with the live leftover
    F = live(h, 7101)
    a0 = adv_row(h, F)
    e_void = h.gagal(r.batal_kwitansi_sql(F['receipt'], 'rum-void-0'), r.OWNER)
    check('existing flow today: leftover 30000 on the applied advance; void receipt is refused (ADVANCE_USED), so no existing flow can pay it back', bal(a0) == 30000 and err_has(e_void, 'ADVANCE_USED'), dict(balance=str(bal(a0)), void=(e_void or '')[:100]))
    s_start = snap(h, F)
    before = {a: h.saldo(a) for a in ACCTS}
    # ------------------------------------------------------------------ step 1: Owner asks for the refund (reserves the amount)
    res, err = req(h, F, 30000, 'rum-main-1')
    rid = (res or {}).get('refund_id')
    a1 = adv_row(h, F) if res else {}
    check('REQUEST by OWNER: pending refund of 30000 for UMK of the live shape; no_refund number; advance balance 30000 -> 0 (reserved: amount reduced to 845200, refund_reserved 30000, applied unchanged)',
          res is not None and res.get('status') == 'pending' and D(res['amount']) == 30000 and res.get('no_refund', '').startswith('RUM-') and D(res['balance_before']) == 30000 and D(res['balance_after']) == 0
          and D(a1['amount']) == F['total'] - 30000 and D(a1['applied']) == F['total'] - 30000 and D(a1['refund_reserved']) == 30000 and D(a1['refunded_amount']) == 0 and a1['status'] == 'aktif',
          dict(error=(err or '')[:300], res=str(res)[:200]))
    s_req = snap(h, F) if res else {}
    check('REQUEST posts NOTHING: no journal, trial balance 0, bank/cash/advance liability balances unchanged; invoice, payments and applications untouched',
          res is not None and s_req['journals'] == s_start['journals'] and s_req['tb'] == 0 and all(h.saldo(a) == before[a] for a in ACCTS) and s_req['inv'] == s_start['inv'] and s_req['pays'] == s_start['pays'] and s_req['apps'] == s_start['apps'],
          dict(journals=(s_start['journals'], s_req.get('journals'))))
    rr = refund_row(h, rid) if res else {}
    check('refund row: pending, amount 30000, advance, branch, reason, bank destination note, request_key, requested_by OWNER; no completion data yet',
          res is not None and rr['status'] == 'pending' and D(rr['amount']) == 30000 and rr['advance_id'] == F['adv'] and rr['reason'] == REASON and rr['destination'] == DEST and rr['request_key'] == 'rum-main-1' and rr['requested_by'] == r.OWNER
          and rr['completed_at'] is None and rr['journal_id'] is None and rr['bank_reference'] is None and rr['branch_id'] is not None, dict(row=str(rr)[:300]))
    # replay of the request (same key, same payload) is idempotent
    s0 = snap(h, F)
    res_b, err_b = req(h, F, 30000, 'rum-main-1')
    check('REQUEST replay: same key + same payload returns the stored result (replayed), nothing moves, one refund row', res_b is not None and res_b.get('replayed') is True and res_b.get('refund_id') == rid and snap(h, F) == s0, dict(error=(err_b or '')[:160]))
    refused(h, F, 'REQUEST same key with a DIFFERENT amount refused (IDEMPOTENCY_CONFLICT), nothing changes', req(h, F, 10000, 'rum-main-1'), ['IDEMPOTENCY_CONFLICT'], s0)
    refused(h, F, 'REQUEST same key by ANOTHER actor refused (IDEMPOTENCY_CONFLICT)', req(h, F, 30000, 'rum-main-1', user=r.FINANCE), ['IDEMPOTENCY_CONFLICT'], s0)
    # step 2: Finance claims ('Ambil proses') then completes after the bank transfer
    s0 = snap(h, F)
    refused(h, F, 'COMPLETE before claim refused (CLAIM_REQUIRED): the finance queue pattern needs "Ambil proses" first; nothing changes', done(h, rid), ['CLAIM_REQUIRED'], s0)
    c1, ce = claim(h, rid)
    check('CLAIM by FINANCE: status diproses, processed_by FINANCE; claim is idempotent for the same user', c1 is not None and c1.get('status') == 'diproses' and refund_row(h, rid)['processed_by'] == r.FINANCE and (claim(h, rid)[0] or {}).get('status') == 'diproses', dict(error=(ce or '')[:160]))
    refused(h, F, 'CLAIM by another user while diproses refused (CLAIM_TAKEN)', claim(h, rid, user=r.OWNER), ['CLAIM_TAKEN'])
    refused(h, F, 'COMPLETE by a user who did not claim refused (CLAIM_REQUIRED)', done(h, rid, user=r.OWNER), ['CLAIM_REQUIRED'])
    jb = h.angka('select count(*) from journal_entries')
    c2, ce2 = done(h, rid, ref='TRF-BCA-777')
    a2 = adv_row(h, F) if c2 else {}
    jid = (c2 or {}).get('journal_id')
    check('COMPLETE by FINANCE (default Transfer account): selesai; ONE new journal; advance refunded_amount 30000, reserved 0, amount stays 845200, applied 845200 -> unapplied 0',
          c2 is not None and c2.get('status') == 'selesai' and jid and h.angka('select count(*) from journal_entries') == jb + 1 and D(a2['refunded_amount']) == 30000 and D(a2['refund_reserved']) == 0 and D(a2['amount']) == F['total'] - 30000 and D(a2['applied']) == F['total'] - 30000 and bal(a2) == 0 and a2['status'] == 'aktif',
          dict(error=(ce2 or '')[:300], res=str(c2)[:200]))
    je = json.loads(h.nilai(f"select to_jsonb(e) from journal_entries e where id={q(jid)}")) if jid else {}
    jl = lines_of(h, jid) if jid else []
    check('JOURNAL exact: Dr 314001 30000 / Cr 120002 30000, balanced to the cent, dated today, source klinik-uang-muka-refund, source_ref = the refund number, branch of the advance',
          jl == sorted([('314001', D(30000), D(0)), ('120002', D(0), D(30000))]) and je.get('source') == SRC and je.get('source_ref') == (c2 or {}).get('no_refund') and je.get('tanggal') == td and je.get('branch_id') == rr.get('branch_id'),
          dict(lines=str(jl), je={k: je.get(k) for k in ('source', 'source_ref', 'tanggal')}))
    after = {a: h.saldo(a) for a in ACCTS}
    dlt = {a: round(after[a] - before[a], 2) for a in ACCTS}
    check('trial balance 0 before and after; bank 120002 credited exactly 30000; cash 110003 did NOT move; 314001 liability for this advance now 0 (the 30000 leftover is gone); invoice untouched',
          tb(h) == 0 and dlt['120002'] == -30000.0 and dlt['110003'] == 0 and dlt['314001'] == 30000.0 and dlt['150001'] == 0 and h.saldo('314001') - F['before']['314001'] == 0 and snap(h, F)['inv'] == s_start['inv'],
          dict(dlt=dlt, tb=tb(h), liab=h.saldo('314001') - F['before']['314001']))
    rr2 = refund_row(h, rid) if c2 else {}
    check('refund row after completion: selesai, completed_by FINANCE, bank reference, tanggal today, account 120002 snapshot, journal linked',
          c2 is not None and rr2['status'] == 'selesai' and rr2['completed_by'] == r.FINANCE and rr2['bank_reference'] == 'TRF-BCA-777' and rr2['tanggal'] == td and rr2['coa_code'] == '120002' and rr2['journal_id'] == jid and rr2['completed_at'] is not None, dict(row=str(rr2)[:300]))
    ev = events(h, rid) if c2 else []
    check('AUDIT events: request, claim, complete in order with actors, amounts and the advance balance before/after; complete links the journal',
          [e_['event'] for e_ in ev] == ['request', 'claim', 'complete'] and [e_['actor_id'] for e_ in ev] == [r.OWNER, r.FINANCE, r.FINANCE] and all(D(e_['amount']) == 30000 for e_ in ev)
          and D(ev[0]['balance_before']) == 30000 and D(ev[0]['balance_after']) == 0 and ev[2]['journal_id'] == jid and D(ev[2]['refunded_total_after']) == 30000, dict(events=str(ev)[:300]))
    # replay / double completion
    s0 = snap(h, F)
    c3, ce3 = done(h, rid, ref='TRF-BCA-777')
    check('double completion with the SAME data is a replay: returns the stored result, no second journal, nothing moves', c3 is not None and c3.get('replayed') is True and c3.get('journal_id') == jid and snap(h, F) == s0, dict(error=(ce3 or '')[:160]))
    refused(h, F, 'double completion with a DIFFERENT bank reference refused (ALREADY_DONE), nothing changes', done(h, rid, ref='TRF-LAIN-1'), ['ALREADY_DONE'], s0)
    refused(h, F, 'cancel of a completed refund refused (REFUND_DONE), nothing changes', cancel(h, rid), ['REFUND_DONE'], s0)
    refused(h, F, 'claim of a completed refund refused (CLAIM_STATE), nothing changes', claim(h, rid), ['CLAIM_STATE'], s0)
    # the queue list
    lst, le = rpc(h, 'lst', f"null,true,'selesai',0", r.FINANCE)
    row = next((x_ for x_ in (lst or []) if x_.get('id') == rid), {})
    check('LIST (finance queue): the completed refund with advance no, amount, status, destination, reference; branch scoped', bool(row) and row.get('no_uang_muka') == F['adv_no'] and D(row['amount']) == 30000 and row['status'] == 'selesai' and row.get('destination') == DEST and row.get('bank_reference') == 'TRF-BCA-777', dict(error=(le or '')[:160], row=str(row)[:200]))


def sec_life(h):
    # ------------------------------------------------------------------ void / release / ADVANCE_IMBALANCE after a part refund
    G = live(h, 7102); bg = {a: h.saldo(a) for a in ACCTS}
    res, _ = req(h, G, 30000, 'rum-life-1'); rid = (res or {}).get('refund_id')
    s0 = snap(h, G)
    e_pend = h.gagal(r.batal_kwitansi_sql(G['receipt'], 'rum-life-void-pending'), r.OWNER)
    check('void receipt while the refund is PENDING (advance still applied) keeps its own refusal ADVANCE_USED; nothing changes', res is not None and err_has(e_pend, 'ADVANCE_USED') and snap(h, G) == s0, dict(error=(e_pend or '')[:140]))
    claim(h, rid); c2, _ = done(h, rid)
    s_done = snap(h, G)
    e_used = h.gagal(r.batal_kwitansi_sql(G['receipt'], 'rum-life-void-1'), r.OWNER)
    check('void receipt AFTER the part refund while the advance is applied: still ADVANCE_USED; nothing changes', c2 is not None and err_has(e_used, 'ADVANCE_USED') and snap(h, G) == s_done, dict(error=(e_used or '')[:140]))
    e_rel = h.gagal(r.lepas_sql(G['adv'], 'rum-life-rel-1'), r.OWNER)
    ag = adv_row(h, G)
    check('release of the application after a part refund works: applied back to 0, advance now holds the whole 845200 unapplied, refunded 30000 kept, invoice no longer paid',
          e_rel is None and D(ag['applied']) == 0 and D(ag['amount']) == G['total'] - 30000 and D(ag['refunded_amount']) == 30000 and h.status_bayar(G['inv']) == 'Belum Lunas', dict(error=(e_rel or '')[:200], adv=str(ag)[:200]))
    s_rel = snap(h, G)
    e_void = h.gagal(r.batal_kwitansi_sql(G['receipt'], 'rum-life-void-2'), r.OWNER)
    check('void receipt of a PART-REFUNDED advance is refused with its own message (ADVANCE_REFUNDED: use refund for the rest), zero partial effects: receipt still aktif, no payment/journal written, advance unchanged',
          err_has(e_void, 'ADVANCE_REFUNDED') and snap(h, G) == s_rel and snap(h, G)['receipt'] == 'aktif', dict(error=(e_void or '')[:200]))
    # the rest of the (released, unapplied) advance can be refunded in full: amount 0 is allowed after refunds
    rest = D(ag['amount']) - D(ag['applied'])
    r2, e2 = req(h, G, str(rest), 'rum-life-2', adv=None); rid2 = (r2 or {}).get('refund_id')
    claim(h, rid2) if rid2 else None
    c3, e3 = done(h, rid2, ref='TRF-BCA-FULL') if rid2 else (None, 'no request')
    a3 = adv_row(h, G); after = {a: h.saldo(a) for a in ACCTS}
    check('FULL refund of the released remainder: amount 0 / refunded 875200 (= everything received), applied 0, status aktif; bank, cash, advance liability back to their pre-fixture balances; trial balance 0',
          c3 is not None and D(a3['amount']) == 0 and D(a3['refunded_amount']) == G['total'] and D(a3['refund_reserved']) == 0 and D(a3['applied']) == 0 and a3['status'] == 'aktif'
          and after['314001'] == G['before']['314001'] and after['120002'] == G['before']['120002'] and tb(h) == 0 and after['110003'] == G['before']['110003'], dict(error=(e2 or e3 or '')[:200], adv=str(a3)[:200], bank=after['120002'] - G['before']['120002']))
    e_void = h.gagal(r.batal_kwitansi_sql(G['receipt'], 'rum-life-void-3'), r.OWNER)
    check('void receipt after a FULL refund is refused (ADVANCE_REFUNDED): the money already went back; no double return, receipt stays aktif', err_has(e_void, 'ADVANCE_REFUNDED') and snap(h, G)['receipt'] == 'aktif', dict(error=(e_void or '')[:160]))
    # ADVANCE_IMBALANCE / void still right WITHOUT a refund and AFTER a cancelled request (reservation fully undone)
    H = live(h, 7103); bh = {a: h.saldo(a) for a in ACCTS}
    r4, _ = req(h, H, 30000, 'rum-life-3'); rid4 = (r4 or {}).get('refund_id')
    c4, _ = cancel(h, rid4) if rid4 else (None, 'no request')
    ah = adv_row(h, H)
    check('CANCEL of a pending request restores the reservation exactly: amount back to the original, refund_reserved 0, refunded 0, balance 30000 again; no journal',
          c4 is not None and c4.get('status') == 'batal' and D(ah['amount']) == H['total'] and D(ah['refund_reserved']) == 0 and D(ah['refunded_amount']) == 0 and bal(ah) == 30000 and all(h.saldo(a) == bh[a] for a in ACCTS), dict(adv=str(ah)[:200]))
    e_rel = h.gagal(r.lepas_sql(H['adv'], 'rum-life-rel-3'), r.OWNER); e_vd = h.gagal(r.batal_kwitansi_sql(H['receipt'], 'rum-life-void-4'), r.OWNER)
    ah2 = adv_row(h, H)
    check('after cancel + release + void receipt: NO ADVANCE_IMBALANCE, receipt cancelled, advance batal, liability and bank back to their pre-fixture balances (existing lifecycle intact)',
          c4 is not None and e_rel is None and e_vd is None and ah2['status'] == 'batal' and h.saldo('314001') - H['before']['314001'] == 0 and h.saldo('120002') - H['before']['120002'] == 0, dict(rel=(e_rel or '')[:120], void=(e_vd or '')[:160]))
    # a plain advance never touched by the feature: release then void behave exactly as before
    P = tbl.build(h, 7104)
    e1 = h.gagal(r.lepas_sql(P['adv'], 'rum-life-rel-4'), r.OWNER); e2 = h.gagal(r.batal_kwitansi_sql(P['receipt'], 'rum-life-void-5'), r.OWNER)
    check('an advance with NO refund: release + void receipt exactly as before (no new refusal)', e1 is None and e2 is None and h.nilai(f"select status from clinic_customer_advances where id={q(P['adv'])}") == 'batal', dict(rel=(e1 or '')[:100], void=(e2 or '')[:100]))
    # a PENDING request blocks the void with its own message (no silent double return), cancel unblocks it
    K = tbl.build(h, 7105); e_r = h.gagal(r.lepas_sql(K['adv'], 'rum-life-rel-5'), r.OWNER)
    r5, _ = req(h, K, 100000, 'rum-life-4'); rid5 = (r5 or {}).get('refund_id'); sK = snap(h, K)
    e_v = h.gagal(r.batal_kwitansi_sql(K['receipt'], 'rum-life-void-6'), r.OWNER)
    check('void receipt while a refund request is PENDING on a released advance is refused (ADVANCE_REFUNDED); zero effects', e_r is None and err_has(e_v, 'ADVANCE_REFUNDED') and snap(h, K) == sK, dict(error=(e_v or '')[:160]))
    # refunded advances are not offered to the next stage: after a completed refund the balance 0 means the next stage needs new money
    L = live(h, 7106); r6, _ = req(h, L, 30000, 'rum-life-5'); rid6 = (r6 or {}).get('refund_id')
    sL = snap(h, L)
    rows = tbl.read_cart(h, L)['rows'] + [dict(id=r.uid('e', 9500), item_id=tbl.SVC, nama_obat='Jasa Tahap Berikut Fiktif', qty=1, harga=50000, satuan='kali', jenis='jasa')]
    e5, _ = tbl.cashier_save(h, L, 'rum-next-1', [dict(method='Tunai', amount=50000)], rows=rows)
    inv_next = h.nilai(f"select id from invoices where visit_id={q(L['v'])} and voided_at is null and id<>{q(L['inv'])} order by created_at desc limit 1")
    aL = adv_row(h, L)
    check('RESERVATION holds: a pending refund of 30000 is NOT consumed by the next stage (needs the full 50000 in new cash; no application takes from the reserved amount); reserved amount intact',
          rid6 is not None and e5 is None and D(aL['refund_reserved']) == 30000 and h.angka(f"select coalesce(sum(amount),0) from clinic_advance_applications where invoice_id={q(inv_next)} and advance_id={q(L['adv'])}") == 0.0
          and h.diterima(inv_next) == 50000.0, dict(error=(e5 or '')[:200], reserved=aL.get('refund_reserved')))
    claim(h, rid6); c6, _ = done(h, rid6)
    check('...and the refund still completes afterwards (30000 to the bank reference), the next stage invoice is paid', c6 is not None and c6.get('status') == 'selesai' and tb(h) == 0, dict(res=str(c6)[:100]))


def sec_neg(h):
    N = live(h, 7110); A = {a: h.saldo(a) for a in ACCTS}
    s0 = snap(h, N)
    for label, user in (('ADMIN', r.ADMIN), ('DOCTOR', r.DOCTOR), ('STAFF', r.STAFF), ('inactive FINANCE', r.FIN_NONAKTIF), ('FINANCE of another branch', r.FIN_LUAR)):
        refused(h, N, f'NEG request by {label} refused (ACCESS_DENIED: ' + ('cabang' if 'another' in label else 'only Owner/Finance') + '), nothing changed', req(h, N, 30000, 'rum-neg-' + label[:4], user=user),
                ['ACCESS_DENIED', 'cabang' if 'another' in label else 'hanya untuk Owner atau Finance'], s0)
    err = h.gagal(f"reset role;select public.{FN['req']}({q(N['adv'])},30000,{q(REASON)},{j(DEST)},'rum-anon');")
    check('NEG request without an authenticated session refused', bool(err) and ('ACCESS_DENIED' in err or 'permission denied' in err) and snap(h, N) == s0, dict(error=(err or '')[:140]))
    err = h.gagal(f"set role authenticated;select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub',{q(r.OWNER)},false);select set_config('request.headers',{q(json.dumps({'x-kamo-operational-branch': r.BRANCH2}))},false);"
                  f"select public.{FN['req']}({q(N['adv'])},30000,{q(REASON)},{j(DEST)},'rum-branch');")
    check('NEG OWNER working in ANOTHER branch (operational-branch header) refused by the branch check (ACCESS_DENIED: cabang)', err_has(err, 'ACCESS_DENIED', 'cabang') and snap(h, N) == s0, dict(error=(err or '')[:160]))
    refused(h, N, 'NEG advance id that does not exist refused (ACCESS_DENIED: uang muka tidak ditemukan)', req(h, N, 100, 'rum-neg-nf', adv=r.uid('e', 9999)), ['ACCESS_DENIED', 'tidak ditemukan'], s0)
    for label, amt, words in (('amount above the balance (30001)', 30001, ['AMOUNT_EXCEEDS']), ('amount above the balance (whole advance)', N['total'], ['AMOUNT_EXCEEDS']), ('zero', 0, ['AMOUNT_INVALID']), ('negative', -5, ['AMOUNT_INVALID']),
                              ('missing', None, ['AMOUNT_INVALID']), ('NaN', "'NaN'::numeric", ['AMOUNT_INVALID']), ('three decimals', '100.001', ['AMOUNT_INVALID'])):
        refused(h, N, f'NEG {label} -> {words[0]}, nothing changed', req(h, N, amt, 'rum-neg-' + label[:6].replace(' ', '')), words, s0)
    for label, reason in (('missing', None), ('empty', ''), ('whitespace', '       '), ('4 significant chars', 'ab c  d'), ('too long', 'x' * 501)):
        refused(h, N, f'NEG reason {label} -> REASON_REQUIRED, nothing changed', req(h, N, 100, 'rum-neg-r' + label[:3], reason=reason), ['REASON_REQUIRED'], s0)
    for label, dest in (('missing', None), ('no bank name', dict(bank='', account='1234567890', name='X')), ('account with symbols', dict(bank='BCA', account='12;drop', name='X')), ('no holder name', dict(bank='BCA', account='123456', name=''))):
        refused(h, N, f'NEG bank destination {label} -> DESTINATION_INVALID, nothing changed', req(h, N, 100, 'rum-neg-d' + label[:3], dest=dest), ['DESTINATION_INVALID'], s0)
    refused(h, N, 'NEG request key missing -> KEY_REQUIRED, nothing changed', req(h, N, 100, None), ['KEY_REQUIRED'], s0)
    # refund while the advance is applied in full: balance 0 -> any amount refused
    W = tbl.build(h, 7111); sW = snap(h, W)
    refused(h, W, 'NEG refund while the advance is applied IN FULL (balance 0) refused (AMOUNT_EXCEEDS), nothing changed', req(h, W, 1, 'rum-neg-applied'), ['AMOUNT_EXCEEDS'], sW)
    # cumulative cap: pending requests reserve; the sum can never exceed the balance
    r1, _ = req(h, N, 20000, 'rum-cap-1'); s1 = snap(h, N)
    refused(h, N, 'NEG second request that would exceed the balance together with the first pending one (20000 + 20000 > 30000) refused (AMOUNT_EXCEEDS)', req(h, N, 20000, 'rum-cap-2'), ['AMOUNT_EXCEEDS'], s1)
    r2, e2 = req(h, N, 10000, 'rum-cap-3')
    check('...but the remaining 10000 can still be requested (balance exactly exhausted by 20000 + 10000)', r2 is not None and D(adv_row(h, N)['refund_reserved']) == 30000 and bal(adv_row(h, N)) == 0, dict(error=(e2 or '')[:160]))
    # cancel validations
    sC = snap(h, N); rid1 = (r1 or {}).get('refund_id'); rid2 = (r2 or {}).get('refund_id')
    refused(h, N, 'NEG cancel without the "belum dibayar" confirmation refused (CANCEL_CONFIRM_REQUIRED)', cancel(h, rid1, conf='false'), ['CANCEL_CONFIRM_REQUIRED'], sC)
    refused(h, N, 'NEG cancel without a reason (4 chars) refused (REASON_REQUIRED)', cancel(h, rid1, reason='a b c'), ['REASON_REQUIRED'], sC)
    refused(h, N, 'NEG cancel by ADMIN refused (ACCESS_DENIED: only Owner/Finance)', cancel(h, rid1, user=r.ADMIN), ['ACCESS_DENIED', 'hanya untuk Owner atau Finance'], sC)
    refused(h, N, 'NEG cancel by FINANCE of another branch refused (ACCESS_DENIED: cabang)', cancel(h, rid1, user=r.FIN_LUAR), ['ACCESS_DENIED', 'cabang'], sC)
    refused(h, N, 'NEG cancel of an unknown refund refused (REFUND_NOT_FOUND)', cancel(h, r.uid('e', 9998)), ['REFUND_NOT_FOUND'], sC)
    c1, _ = cancel(h, rid1)
    check('cancel of the 20000 pending request frees exactly 20000 (balance 20000, reserved 10000)', c1 is not None and c1['status'] == 'batal' and D(adv_row(h, N)['refund_reserved']) == 10000 and bal(adv_row(h, N)) == 20000, dict(res=str(c1)[:100]))
    sC = snap(h, N); c1b, _ = cancel(h, rid1)
    check('cancel replay (already cancelled) is idempotent: stored result, nothing moves', c1b is not None and c1b.get('status') == 'batal' and snap(h, N) == sC, dict(res=str(c1b)[:100]))
    r3, e3 = req(h, N, 20000, 'rum-cap-4')
    check('cancel then RE-REQUEST works (new key): 20000 reserved again, total reserved 30000', r3 is not None and D(adv_row(h, N)['refund_reserved']) == 30000, dict(error=(e3 or '')[:160]))
    # claim / complete validations on the 10000 request
    sC = snap(h, N)
    refused(h, N, 'NEG claim by a non-finance role (STAFF) refused (ACCESS_DENIED)', claim(h, rid2, user=r.STAFF), ['ACCESS_DENIED', 'hanya untuk Owner atau Finance'], sC)
    refused(h, N, 'NEG claim by FINANCE of another branch refused (ACCESS_DENIED)', claim(h, rid2, user=r.FIN_LUAR), ['ACCESS_DENIED', 'cabang'], sC)
    refused(h, N, 'NEG claim of an unknown refund refused (REFUND_NOT_FOUND)', claim(h, r.uid('e', 9998)), ['REFUND_NOT_FOUND'])
    claim(h, rid2); sD = snap(h, N)
    td = today(h); bank = h.nilai("select id from cash_accounts where coa_code='120002'"); kas = h.nilai("select id from cash_accounts where coa_code='110003'")
    refused(h, N, 'NEG complete without a bank reference refused (REFERENCE_REQUIRED)', done(h, rid2, ref=''), ['REFERENCE_REQUIRED'], sD)
    refused(h, N, 'NEG complete with a FUTURE date refused (DATE_INVALID)', done(h, rid2, date='2099-01-01'), ['DATE_INVALID'], sD)
    refused(h, N, 'NEG complete dated BEFORE the request refused (DATE_INVALID)', done(h, rid2, date='2026-01-01'), ['DATE_INVALID'], sD)
    refused(h, N, 'NEG complete from a CASH account (jenis Kas) refused (ACCOUNT_INVALID)', done(h, rid2, account=kas), ['ACCOUNT_INVALID'], sD)
    refused(h, N, 'NEG complete with an unknown account refused (ACCOUNT_INVALID)', done(h, rid2, account=r.uid('e', 9997)), ['ACCOUNT_INVALID'], sD)
    h.sql("insert into cash_accounts(id,nama,jenis,coa_code,is_active,branch_id) values ('e0000000-0000-4000-8000-0000000099a1','Bank Lain Cabang','Bank','120003',true,"
          f"{q(r.BRANCH2)}),('e0000000-0000-4000-8000-0000000099a2','Bank Nonaktif','Bank','120004',false,null);")
    refused(h, N, 'NEG complete from a bank account of ANOTHER branch refused (ACCOUNT_INVALID)', done(h, rid2, account='e0000000-0000-4000-8000-0000000099a1'), ['ACCOUNT_INVALID'], sD)
    refused(h, N, 'NEG complete from an INACTIVE bank account refused (ACCOUNT_INVALID)', done(h, rid2, account='e0000000-0000-4000-8000-0000000099a2'), ['ACCOUNT_INVALID'], sD)
    h.sql(f"update accounting_locks set closed_until='{td}' where id;")
    refused(h, N, 'NEG complete in a LOCKED accounting period refused (PERIOD_LOCKED), nothing changes (the request itself stays reserved)', done(h, rid2), ['PERIOD_LOCKED'], sD)
    h.sql("update accounting_locks set closed_until=null where id;")
    refused(h, N, 'NEG complete by FINANCE of another branch refused (ACCESS_DENIED: cabang)', done(h, rid2, user=r.FIN_LUAR), ['ACCESS_DENIED', 'cabang'], sD)
    refused(h, N, 'NEG complete by ADMIN (not finance/owner) refused (ACCESS_DENIED)', done(h, rid2, user=r.ADMIN), ['ACCESS_DENIED', 'hanya untuk Owner atau Finance'], sD)
    c_ok, e_ok = done(h, rid2, account=bank, ref='TRF-EXPLICIT')
    check('complete with an EXPLICIT bank account (cash_accounts id of Bank BCA) works: journal Cr 120002', c_ok is not None and lines_of(h, c_ok['journal_id']) == sorted([('314001', D(10000), D(0)), ('120002', D(0), D(10000))]), dict(error=(e_ok or '')[:200]))
    # cancel after completion; pending 20000 left
    sE = snap(h, N)
    refused(h, N, 'NEG a refund that is no longer pending/diproses cannot be claimed twice by someone else (CLAIM_STATE)', claim(h, rid2, user=r.OWNER), ['CLAIM_STATE'], sE)
    # owner can request AND cancel; finance can cancel the owner's request
    rid3 = (r3 or {}).get('refund_id'); c3, e3 = cancel(h, rid3, user=r.OWNER)
    check('OWNER cancels a pending request (the requester) and the balance is released again', c3 is not None and c3['status'] == 'batal' and D(adv_row(h, N)['refund_reserved']) == 0 and bal(adv_row(h, N)) == 20000, dict(error=(e3 or '')[:160]))
    # claimed by FINANCE: OWNER may cancel, ADMIN may not
    r4, _ = req(h, N, 5000, 'rum-cap-5', user=r.FINANCE); rid4 = (r4 or {}).get('refund_id'); claim(h, rid4, user=r.FINANCE)
    refused(h, N, 'NEG cancel of a diproses request by ADMIN refused (ACCESS_DENIED)', cancel(h, rid4, user=r.ADMIN), ['ACCESS_DENIED', 'hanya untuk Owner atau Finance'])
    c4, _ = cancel(h, rid4, user=r.OWNER)
    check('OWNER may cancel a request that FINANCE has claimed (not yet paid); reservation released', c4 is not None and c4['status'] == 'batal' and D(adv_row(h, N)['refund_reserved']) == 0, dict(res=str(c4)[:100]))


def sec_scope(h):
    # ------------------------------------------------------------------ advance states and list scoping
    S0 = live(h, 7120); r1, _ = req(h, S0, 30000, 'rum-sc-1'); rid = (r1 or {}).get('refund_id')
    lst_f, e1 = rpc(h, 'lst', "null,true,'',0", r.FINANCE); lst_o, _ = rpc(h, 'lst', f"{q(S0['adv'])},false,'',0", r.OWNER); lst_x, e_x = rpc(h, 'lst', "null,true,'',0", r.FIN_LUAR); lst_s, e_s = rpc(h, 'lst', "null,true,'',0", r.STAFF)
    check('LIST: FINANCE of the branch sees the pending request in the office queue; OWNER sees it for one advance; FINANCE of another branch sees nothing; STAFF refused (ACCESS_DENIED)',
          any(x_.get('id') == rid for x_ in (lst_f or [])) and any(x_.get('id') == rid for x_ in (lst_o or [])) and not any(x_.get('id') == rid for x_ in (lst_x or [])) and lst_s is None and err_has(e_s, 'ACCESS_DENIED'), dict(f=len(lst_f or []), x=str(lst_x)[:60], s=(e_s or '')[:80]))
    # an advance of a cancelled (voided-receipt) advance cannot be refunded
    V = tbl.build(h, 7121); h.gagal(r.lepas_sql(V['adv'], 'rum-sc-rel'), r.OWNER); h.gagal(r.batal_kwitansi_sql(V['receipt'], 'rum-sc-void'), r.OWNER)
    sV = snap(h, V)
    refused(h, V, 'NEG advance whose receipt was voided (status batal) refused (ADVANCE_INVALID), nothing changed', req(h, V, 100, 'rum-sc-2'), ['ADVANCE_INVALID'], sV)
    # destination note is stored trimmed; bank note has no free HTML
    D2 = live(h, 7123); r2, _ = req(h, D2, 30000, 'rum-sc-4', dest=dict(bank='  BCA  ', account=' 123 456 7890 ', name=' Tn. Keripik '))
    check('destination fields are trimmed when stored', r2 is not None and refund_row(h, r2['refund_id'])['destination'] == dict(bank='BCA', account='123 456 7890', name='Tn. Keripik'), dict(row=str((r2 or {}).get('refund_id'))))
    # loose-end: money-effect coverage for released advance that also had a pending refund (shift is NOT required for a bank refund)
    sh = h.nilai("select count(*) from cashier_shifts where status='open' and shift_type='klinik' and opened_by=" + q(r.FINANCE))
    h.sql(f"update cashier_shifts set status='closed',closed_at=now() where opened_by={q(r.FINANCE)} and status='open';")
    F3 = live(h, 7124); r3, _ = req(h, F3, 30000, 'rum-sc-5', user=r.FINANCE); rid3 = (r3 or {}).get('refund_id')
    claim(h, rid3); c3, e3 = done(h, rid3)
    check('NO open shift needed for a bank (Transfer) refund request / claim / completion by FINANCE (same rule as J03 Transfer; only cash would need a shift)', r3 is not None and c3 is not None and c3['status'] == 'selesai', dict(error=(e3 or '')[:160], open_shifts_before=sh))


def sec_static(h):
    # ------------------------------------------------------------------ audit table, ACL, definer settings, no existing function replaced
    rid = None
    Z = live(h, 7130); r1, _ = req(h, Z, 30000, 'rum-st-1'); rid = (r1 or {}).get('refund_id')
    ar = h.gagal("update clinic_private.advance_refund_events set payload='{}';"); ad = h.gagal('delete from clinic_private.advance_refund_events;'); at = h.gagal('truncate clinic_private.advance_refund_events;')
    check('audit events are append-only (UPDATE, DELETE, TRUNCATE refused even for the superuser)', bool(ar) and bool(ad) and bool(at) and all('tidak dapat' in e_.lower() or 'immutable' in e_.lower() or 'append' in e_.lower() for e_ in (ar, ad, at)), dict(u=(ar or '')[:80], d=(ad or '')[:80], t=(at or '')[:80]))
    rdel = h.gagal(f"delete from clinic_private.advance_refunds where id={q(rid)};")
    rupd = h.gagal(f"update clinic_private.advance_refunds set amount=1 where id={q(rid)};")
    rst = h.gagal(f"update clinic_private.advance_refunds set status='selesai' where id={q(rid)};")
    check('refund rows cannot be deleted, their amount cannot be edited, and the state machine cannot skip (pending -> selesai) even for the superuser (each with its own message)', rid is not None and err_has(rdel, 'tidak dapat dihapus') and err_has(rupd, 'tidak dapat diubah') and err_has(rst, 'perubahan status'), dict(d=(rdel or '')[:80], u=(rupd or '')[:80], s=(rst or '')[:80]))
    for t in ('advance_refunds', 'advance_refund_events'):
        e_ = h.gagal(f'select * from clinic_private.{t};', r.OWNER); w_ = h.gagal(f"insert into clinic_private.{t} select * from clinic_private.{t};", r.FINANCE)
        check(f'clinic_private.{t} has no app grant (owner cannot read, finance cannot write directly)', h.nilai(f"select (to_regclass('clinic_private.{t}') is not null)::text") == 'true' and bool(e_) and 'permission denied' in e_ and bool(w_) and 'permission denied' in w_, dict(r=(e_ or '')[:80], w=(w_ or '')[:80]))
    bad = []
    for key, fn in FN.items():
        sig = f"public.{fn}({SIG[key]})"
        acl = h.nilai(f"select case when to_regprocedure('{sig}') is null then 'missing' else has_function_privilege('authenticated','{sig}','execute')||'|'||has_function_privilege('anon','{sig}','execute')||'|'||has_function_privilege('public','{sig}','execute')||'|'||(select p.prosecdef::text||'|'||coalesce(p.proconfig::text,'') from pg_proc p where p.oid=to_regprocedure('{sig}')) end")
        if not (acl.startswith('true|false|false|true|') and 'search_path=""' in acl.replace(" ", "").replace("\\", "")): bad.append((fn, acl))
    check('ACL: every RPC is SECURITY DEFINER with an empty search_path; authenticated may execute, anon/public may not', not bad, dict(bad=str(bad)[:300]))
    ev = h.angka("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clinic_private' and p.proname like 'advance_refund%' and p.prosecdef")
    check('internal helper functions are not executable by app roles (clinic_private.advance_refund*)', h.nilai("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clinic_private' and p.proname like 'advance_refund%' and (has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute'))") == '0' and ev >= 0, dict(n=ev))
    cand = (MIG / CANDIDATE).read_text() if (MIG / CANDIDATE).exists() else ''
    check('static: no existing function is replaced or altered by the migration (no create or replace / alter function / drop function / drop trigger; void-receipt, release, receive-payment, cashier, journal writer, tarik baris untouched)',
          bool(cand) and all(t not in cand.lower() for t in ('create or replace', 'alter function', 'drop function', 'drop trigger', 'function public.clinic_void_payment_receipt', 'function public.clinic_release_advance_application', 'function public.clinic_receive_visit_payment',
                                                           'function public.clinic_save_inpatient_cashier', 'function public.clinic_write_journal', 'function clinic_private.owner_remove_invoice_lines', 'function clinic_private.apply_invoice_owner_credit', 'function clinic_private.inpatient_payment_quote')), dict(len=len(cand)))
    # the advance row can only move through the feature: direct edits of the new columns / amount are refused, original total is conserved
    Q = live(h, 7131)
    e1 = h.gagal(f"update clinic_customer_advances set refunded_amount=100 where id={q(Q['adv'])};"); e2 = h.gagal(f"update clinic_customer_advances set amount=amount-100 where id={q(Q['adv'])};"); e3 = h.gagal(f"update clinic_customer_advances set refund_reserved=5 where id={q(Q['adv'])};")
    check('direct writes to amount / refunded_amount / refund_reserved are refused outside the refund functions (even for the superuser); the row is unchanged', bool(e1) and bool(e2) and bool(e3) and D(adv_row(h, Q)['amount']) == Q['total'], dict(e1=(e1 or '')[:90], e2=(e2 or '')[:90]))
    e5 = h.gagal(f"update clinic_customer_advances set amount=amount-100, refund_reserved=refund_reserved+100 where id={q(Q['adv'])};")
    e6 = h.gagal(f"begin;insert into clinic_private.advance_refund_permits values (txid_current());update clinic_customer_advances set amount=amount-100 where id={q(Q['adv'])};commit;")
    check('the fence has TWO independent guards: a total-conserving direct write (amount-100, reserved+100) is refused for lack of the per-transaction permit; even WITH a permit, a write that changes the received total (amount-100 alone) is refused',
          err_has(e5, 'hanya boleh berubah lewat fungsi') and err_has(e6, 'tidak boleh berubah') and D(adv_row(h, Q)['amount']) == Q['total'], dict(e5=(e5 or '')[:120], e6=(e6 or '')[:120]))
    e4 = h.gagal(f"update clinic_customer_advances set applied=applied+30000 where id={q(Q['adv'])};")
    check('ordinary movements of the existing columns are NOT affected by the new guard (applied can still change through the existing code paths: here applied+30000 = amount is allowed)', e4 is None, dict(error=(e4 or '')[:120]))
    # cap: applied can never exceed what is left after refunds
    inv = h.nilai("select pg_get_constraintdef(oid) from pg_constraint where conrelid='clinic_customer_advances'::regclass and conname='clinic_customer_advances_applied_cap'")
    check('existing applied <= amount cap still in place (applied can never take reserved or refunded money)', inv is not None and 'applied <= amount' in inv.replace('(', '').replace(')', ''), dict(c=inv))
    dig = h.nilai(DIGEST_FN)
    RESULTS.append(dict(case='digest: every pre-existing function (definition + ACL) md5, for comparison RED vs GREEN', status='PASS', detail=dict(md5=dig)))
    print('PASS digest', dig, flush=True)


def races(h, db):
    def blocked(obs, sess):
        for _ in range(40):
            w = obs.sql(f"select coalesce(wait_event_type,'')||'/'||coalesce(wait_event,'') from pg_stat_activity where pid={sess.pid};")
            if w and w[-1].startswith('Lock/'): return w[-1]
            time.sleep(0.15)
        return 'NOT BLOCKED'

    def session(name, user):
        s = c.Session(db, name); s.sql(x.claims(user)); return s
    RQ = lambda F, key, amt=30000, user=None: f"select public.{FN['req']}({q(F['adv'])},{amt},{q(REASON)},{j(DEST)},{q(key)});"
    # (1) request first (holds the coordinator): the next-stage cashier save WAITS then is refused as stale (the advance changed under its quote)
    A = live(h, 7140); cartA = tbl.read_cart(h, A)
    rowsA = cartA['rows'] + [dict(id=r.uid('e', 9510), item_id=tbl.SVC, nama_obat='Jasa Tahap Berikut Fiktif', qty=1, harga=50000, satuan='kali', jenis='jasa')]
    sqlA = f"select clinic_save_inpatient_cashier({q(A['stay'])},{q(A['v'])},'rum-race-pay',{q(tbl.TGL)},{q(cartA['snapshot'])},{j(rowsA)},{j([dict(method='Tunai', amount=20000)])},null,false,null,'Bayar tahap Fiktif');"
    with c.Session(db, 'obs') as obs, session('req1', r.OWNER) as a, session('cash1', r.OWNER) as b:
        a.sql('begin;' + RQ(A, 'rum-race-1')); b.send(sqlA); w1 = blocked(obs, b); a.sql('commit;'); res1 = c.attempt(b, commit=False)
    check('race: next-stage cashier save started while a refund REQUEST holds the coordinator WAITS (advisory), then is refused as stale (CART_STALE); reserved 30000 intact, nothing half-saved',
          w1.endswith('advisory') and not res1['ok'] and 'CART_STALE' in res1.get('error', '') and D(adv_row(h, A)['refund_reserved']) == 30000, dict(wait=w1, res=str(res1)[:200]))
    # (2) cashier save first (consumes the 30000 leftover), request waits then is refused AMOUNT_EXCEEDS
    B = live(h, 7141); cartB = tbl.read_cart(h, B)
    rowsB = cartB['rows'] + [dict(id=r.uid('e', 9511), item_id=tbl.SVC, nama_obat='Jasa Tahap Berikut Fiktif', qty=1, harga=50000, satuan='kali', jenis='jasa')]
    sqlB = f"select clinic_save_inpatient_cashier({q(B['stay'])},{q(B['v'])},'rum-race2-pay',{q(tbl.TGL)},{q(cartB['snapshot'])},{j(rowsB)},{j([dict(method='Tunai', amount=20000)])},null,false,null,'Bayar tahap Fiktif');"
    with c.Session(db, 'obs2') as obs, session('cash2', r.OWNER) as a, session('req2', r.OWNER) as b:
        a.sql('begin;' + sqlB); b.send(RQ(B, 'rum-race-2')); w2 = blocked(obs, b); a.sql('commit;'); res2 = c.attempt(b, commit=False)
    aB = adv_row(h, B)
    check('race: refund request started while a cashier save (applying the leftover) holds the coordinator WAITS (advisory), then is refused (AMOUNT_EXCEEDS): the advance is consumed; no reservation',
          w2.endswith('advisory') and not res2['ok'] and 'AMOUNT_EXCEEDS' in res2.get('error', '') and D(aB['refund_reserved']) == 0 and bal(aB) == 0, dict(wait=w2, res=str(res2)[:200]))
    # (3) request vs tarik baris of another line: tarik holds, request waits then reserves the (larger) balance
    C = live(h, 7142)
    tk = f"select {tbl.RPC}({q(C['inv'])},{j(tbl.L(C['JBM']))},'Alasan cukup panjang','rum-race3-tk');"
    with c.Session(db, 'obs3') as obs, session('tk3', r.OWNER) as a, session('req3', r.OWNER) as b:
        a.sql('begin;' + tk); b.send(RQ(C, 'rum-race-3', amt=80000)); w3 = blocked(obs, b); a.sql('commit;'); res3 = c.attempt(b, commit=False)
    aC = adv_row(h, C)
    check('race: refund request for 80000 started while a tarik-baris (re-crediting 50000 more) holds the coordinator WAITS (advisory), then succeeds on the new balance 80000; reserved 80000, applied cap respected',
          w3.endswith('advisory') and res3['ok'] and D(aC['refund_reserved']) == 80000 and bal(aC) == 0, dict(wait=w3, res=str(res3)[:200]))
    # (4) two identical requests at once: one effect
    Dd = live(h, 7143); sD = snap(h, Dd)
    with c.Session(db, 'obs4') as obs, session('tw-a', r.OWNER) as a, session('tw-b', r.OWNER) as b:
        a.sql('begin;' + RQ(Dd, 'rum-race-twin')); b.send(RQ(Dd, 'rum-race-twin')); w4 = blocked(obs, b); a.sql('commit;'); res4 = c.attempt(b, commit=False)
    sD2 = snap(h, Dd)
    check('race: two identical requests at once apply ONCE (second waits, then returns the stored result): one refund row, reserved 30000 only', w4.endswith('advisory') and res4['ok'] and sD2['refunds'] == sD['refunds'] + 1 and D(adv_row(h, Dd)['refund_reserved']) == 30000, dict(wait=w4, res=str(res4)[:200]))
    # (5) two DIFFERENT requests that together exceed the balance: exactly one wins
    E = live(h, 7144)
    with c.Session(db, 'obs5') as obs, session('ex-a', r.OWNER) as a, session('ex-b', r.FINANCE) as b:
        a.sql('begin;' + RQ(E, 'rum-race-ex-a', 20000)); b.send(RQ(E, 'rum-race-ex-b', 20000)); w5 = blocked(obs, b); a.sql('commit;'); res5 = c.attempt(b, commit=False)
    aE = adv_row(h, E)
    check('race: two different requests (20000 + 20000 > balance 30000) at the same time: exactly one wins, the other is refused AMOUNT_EXCEEDS; reserved 20000', w5.endswith('advisory') and not res5['ok'] and 'AMOUNT_EXCEEDS' in res5.get('error', '') and D(aE['refund_reserved']) == 20000, dict(wait=w5, res=str(res5)[:200]))
    # (6) complete vs cancel on the same refund: cancel first -> complete waits, then refused; no journal
    Ff = live(h, 7145); r6, _ = req(h, Ff, 30000, 'rum-race-6'); rid6 = r6['refund_id']; claim(h, rid6, user=r.FINANCE); jb = h.angka('select count(*) from journal_entries')
    cn = f"select public.{FN['cancel']}({q(rid6)},'Belum jadi ditransfer',true);"
    dn = f"select public.{FN['done']}({q(rid6)},{q(today(h))}::date,null,'TRF-RACE');"
    with c.Session(db, 'obs6') as obs, session('cn6', r.FINANCE) as a, session('dn6', r.FINANCE) as b:
        a.sql('begin;' + cn); b.send(dn); w6 = blocked(obs, b); a.sql('commit;'); res6 = c.attempt(b, commit=False)
    check('race: complete started while the cancel of the same refund is in flight WAITS (advisory), then is refused (cancelled); no journal, reservation released',
          w6.endswith('advisory') and not res6['ok'] and h.angka('select count(*) from journal_entries') == jb and D(adv_row(h, Ff)['refund_reserved']) == 0 and refund_row(h, rid6)['status'] == 'batal', dict(wait=w6, res=str(res6)[:200]))
    # (7) double completion at once: ONE journal
    Gg = live(h, 7146); r7, _ = req(h, Gg, 30000, 'rum-race-7'); rid7 = r7['refund_id']; claim(h, rid7, user=r.FINANCE); jb = h.angka('select count(*) from journal_entries')
    d7 = f"select public.{FN['done']}({q(rid7)},{q(today(h))}::date,null,'TRF-TWICE');"
    with c.Session(db, 'obs7') as obs, session('d7a', r.FINANCE) as a, session('d7b', r.FINANCE) as b:
        a.sql('begin;' + d7); b.send(d7); w7 = blocked(obs, b); a.sql('commit;'); res7 = c.attempt(b, commit=False)
    check('race: two completions of the same refund at once book ONE journal (second waits, then returns the stored result)', w7.endswith('advisory') and res7['ok'] and h.angka('select count(*) from journal_entries') == jb + 1 and D(adv_row(h, Gg)['refunded_amount']) == 30000, dict(wait=w7, res=str(res7)[:200]))
    # (8) void receipt vs request on a released advance: request holds -> void waits then ADVANCE_REFUNDED; void holds -> request waits then ADVANCE_INVALID
    Hh = tbl.build(h, 7147); h.gagal(r.lepas_sql(Hh['adv'], 'rum-race-rel'), r.OWNER)
    with c.Session(db, 'obs8') as obs, session('rq8', r.OWNER) as a, session('vd8', r.OWNER) as b:
        a.sql('begin;' + RQ(Hh, 'rum-race-8', 100000)); b.send(r.batal_kwitansi_sql(Hh['receipt'], 'rum-race-8-void')); w8 = blocked(obs, b); a.sql('commit;'); res8 = c.attempt(b, commit=False)
    check('race: void receipt started while a refund request holds the coordinator WAITS (advisory), then is refused (ADVANCE_REFUNDED); receipt still aktif, reservation intact',
          w8.endswith('advisory') and not res8['ok'] and 'ADVANCE_REFUNDED' in res8.get('error', '') and h.nilai(f"select status from clinic_payment_receipts where id={q(Hh['receipt'])}") == 'aktif' and D(adv_row(h, Hh)['refund_reserved']) == 100000, dict(wait=w8, res=str(res8)[:200]))
    Ii = tbl.build(h, 7148); h.gagal(r.lepas_sql(Ii['adv'], 'rum-race-rel2'), r.OWNER)
    with c.Session(db, 'obs9') as obs, session('vd9', r.OWNER) as a, session('rq9', r.OWNER) as b:
        a.sql('begin;' + r.batal_kwitansi_sql(Ii['receipt'], 'rum-race-9-void')); b.send(RQ(Ii, 'rum-race-9', 100000)); w9 = blocked(obs, b); a.sql('commit;'); res9 = c.attempt(b, commit=False)
    check('race: refund request started while the void receipt of the advance is in flight WAITS (advisory), then is refused (ADVANCE_INVALID: voided); nothing reserved',
          w9.endswith('advisory') and not res9['ok'] and 'ADVANCE_INVALID' in res9.get('error', '') and D(adv_row(h, Ii)['refund_reserved']) == 0 and h.nilai(f"select status from clinic_customer_advances where id={q(Ii['adv'])}") == 'batal', dict(wait=w9, res=str(res9)[:200]))
    # (9) release of the application vs request: release holds -> request waits then reserves on the released balance
    Jj = live(h, 7149)
    with c.Session(db, 'obs10') as obs, session('rl10', r.OWNER) as a, session('rq10', r.OWNER) as b:
        a.sql('begin;' + r.lepas_sql(Jj['adv'], 'rum-race-10-rel')); b.send(RQ(Jj, 'rum-race-10', 100000)); w10 = blocked(obs, b); a.sql('commit;'); res10 = c.attempt(b, commit=False)
    aJ = adv_row(h, Jj)
    check('race: refund request started while the release of the advance application is in flight WAITS (advisory), then reserves 100000 of the released balance (845200); applied 0, cap respected',
          w10.endswith('advisory') and res10['ok'] and D(aJ['refund_reserved']) == 100000 and D(aJ['applied']) == 0 and D(aJ['amount']) == Jj['total'] - 100000, dict(wait=w10, res=str(res10)[:200]))


def apply_candidate(db, text): db.sql('begin;\n' + text + '\ncommit;')


NEW_FN = "('clinic_advance_refund_request','clinic_advance_refund_claim','clinic_advance_refund_complete','clinic_advance_refund_cancel','get_clinic_advance_refunds')"
DIGEST_FN = (f"select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
             f"where n.nspname in ('public','clinic_private') and p.prokind='f' and p.proname not in {NEW_FN} and p.proname not like 'advance_refund%'")
DIGEST_OBJ = """select md5(string_agg(x, '|' order by x)) from (
 select 'col:'||table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') x from information_schema.columns
   where table_schema in ('public','clinic_private') and table_name not like 'advance_refund%' and not (table_name='clinic_customer_advances' and column_name in ('refunded_amount','refund_reserved'))
 union all select 'con:'||conrelid::regclass||':'||conname||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace in ('public'::regnamespace,'clinic_private'::regnamespace)
   and conrelid::regclass::text not like '%advance_refund%' and not (conrelid='public.clinic_customer_advances'::regclass and conname in ('clinic_customer_advances_amount_check','clinic_customer_advances_refunded_amount_check','clinic_customer_advances_refund_reserved_check'))
 union all select 'trg:'||tgrelid::regclass||':'||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text not like '%advance_refund%' and tgname <> 'advance_refund_fence'
 union all select 'idx:'||indexdef from pg_indexes where schemaname in ('public','clinic_private') and tablename not like 'advance_refund%'
 union all select 'pol:'||schemaname||'.'||tablename||':'||policyname||':'||coalesce(qual,'')||coalesce(with_check,'') from pg_policies where schemaname in ('public','clinic_private') and tablename not like 'advance_refund%'
 union all select 'rel:'||c.oid::regclass||':'||coalesce(c.relacl::text,'')||c.relrowsecurity from pg_class c where c.relnamespace in ('public'::regnamespace,'clinic_private'::regnamespace) and c.relkind in ('r','v','m') and c.relname not like 'advance_refund%'
) t"""


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin'); ap.add_argument('--attach')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--sections', help='comma separated: main,life,neg,scope,static,race'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only', help='comma separated mutant name parts'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    SECTIONS = set(a.sections.split(',')) if a.sections else None
    extra = {}
    try:
        if a.attach:
            with okr.Attached(r.BIN, a.attach) as db:
                name = 'rum_dev_%d' % int(time.time()); db.sql(f'create database {name} template postgres;'); os.environ['PGDATABASE'] = name
                if not a.baseline: apply_candidate(db, (MIG / CANDIDATE).read_text())
                run(x.Harness(db), db, setup=False, baseline=a.baseline, sections=SECTIONS)
        elif a.mutations:
            from importlib.machinery import SourceFileLoader
            mut = SourceFileLoader('mut', str(ROOT / 'scripts/test-refund-uang-muka-mutants.py')).load_module()
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
                okr.build(db, {CANDIDATE}); h = x.Harness(db); x.setup(h)
                if not a.baseline:
                    extra['digest_before'] = dict(functions=h.nilai(DIGEST_FN), objects=h.nilai(DIGEST_OBJ))
                    apply_candidate(db, (MIG / CANDIDATE).read_text())
                    extra['digest_after'] = dict(functions=h.nilai(DIGEST_FN), objects=h.nilai(DIGEST_OBJ))
                    check('DIGEST-DIFF: every pre-existing function (definition + ACL), column, constraint, trigger, index, policy and table ACL is byte-identical before vs after the migration, except the declared changes on clinic_customer_advances (2 columns, their 2 column checks, the amount check, 1 trigger)',
                          extra['digest_before'] == extra['digest_after'], extra)
                run(h, db, setup=False, baseline=a.baseline)
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(cc['status'] == s for cc in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='mutations' if a.mutations else 'RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
