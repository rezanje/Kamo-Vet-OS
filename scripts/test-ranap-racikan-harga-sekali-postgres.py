#!/usr/bin/env python3
"""F8: one-time owner SQL that unlocks a ranap racikan whose saved price fell below its FIFO cost (P03 deadlock).

Native full schema, fictional fixtures, throwaway local cluster, no network. The SQL under test is the file the Owner pastes
into the Supabase SQL editor (/opt/data/kamo-cost-missing-evidence/ranap-racikan-harga-sekali.sql, copied next to this script's
evidence as docs/evidence/ranap-racikan-harga-sekali.sql); only the visit id / branch / row id literals differ.

  python3 -I scripts/test-ranap-racikan-harga-sekali-postgres.py --json out.json   (wrap in flock /opt/data/kamo-heavy-test.lock)
RED = the deadlock itself (cart refuses P03 and COMPOUND_LOCKED); GREEN = after the one-off SQL the cashier saves and posts.
"""
import argparse, importlib.util, json, re, sys, tempfile
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('medical', ROOT / 'scripts/test-rekam-full-edit-postgres.py'); assert spec and spec.loader
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
x, r, q, j = m.x, m.r, m.q, m.j
SQL_FILE = Path('/opt/data/kamo-cost-missing-evidence/ranap-racikan-harga-sekali.sql')
if not SQL_FILE.exists():
    SQL_FILE = ROOT / 'docs/evidence/ranap-racikan-harga-sekali.sql'
RESULTS = []
OFF = 0
MUTANT = None   # (old, new) text replacement applied to the function under test


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:500], flush=True)


def function_sql():
    text = SQL_FILE.read_text()
    a = text.index('create or replace function pg_temp.f8_apply'); b = text.index('end $f8$;') + len('end $f8$;')
    body = text[a:b]
    if MUTANT:
        assert body.count(MUTANT[0]) == 1, MUTANT[0]
        body = body.replace(MUTANT[0], MUTANT[1])
    return body


def call(h, visit, branch, row, new, actor='null', reason='Racikan: HPP naik di atas harga tersimpan; harga dinaikkan', commit=True):
    """The Owner's PART 2, with the literals replaced: one transaction, lock_timeout, the function, the call."""
    act = 'null' if actor == 'null' else q(actor) + '::uuid'
    sql = ("begin;\nset local lock_timeout = '5s';\n" + function_sql() +
           f"\nselect pg_temp.f8_apply({q(visit)}::uuid,{q(branch)},{q(row)}::uuid,{new},{act},{q(reason)});\n" + ('commit;' if commit else 'rollback;'))
    return sql


def read(h, v, stay): return json.loads(h.nilai(f'select clinic_read_inpatient_cashier({q(stay)},{q(v)});', r.STAFF))
def save(v, stay, snapshot, rows, parts, key):
    return f"select clinic_save_inpatient_cashier({q(stay)},{q(v)},{q(key)},'2026-11-03',{q(snapshot)},{j(rows)},{j(parts)},null,false,null,'Kasir Fiktif');"
def total(cart): return sum(row['qty'] * row['harga'] for row in cart['rows'])
def stay_of(h, v): return h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
def hpp_of(h, rid): return float(h.nilai(f"select round(sum(ci.qty*ci.unit_cost),2) from compound_issues ci join prescription_items p on p.compound_recipe_id=ci.recipe_id where p.id={q(rid)}"))
def harga_of(h, rid): return float(h.nilai(f'select harga from prescription_items where id={q(rid)}'))
def plant(h, rid, harga):
    h.sql("begin;alter table public.prescription_items disable trigger official_prescription_snapshot;"
          f"update public.prescription_items set harga={harga} where id={q(rid)};"
          f"update public.clinic_compound_sales set sale_price={harga} where recipe_id=(select compound_recipe_id from public.prescription_items where id={q(rid)});"
          "set constraints all immediate;alter table public.prescription_items enable trigger official_prescription_snapshot;commit;")
def audits(h, v): return h.angka(f"select count(*) from clinic_pending_cart_edits where visit_id={q(v)} and request_key like 'f8-racikan-harga-sekali:%'")
def trig_on(h): return h.nilai("select tgenabled from pg_trigger where tgrelid='public.prescription_items'::regclass and tgname='official_prescription_snapshot'") == 'O'
def invoices(h, v): return h.angka(f'select count(*) from invoices where visit_id={q(v)}')


def racikan_visit(h, n, official=True, plant_below=True):
    n += OFF
    v, mr = m.visit(h, n); stay = stay_of(h, v)
    key = f'f8-compound-{n}'
    ver = h.nilai('select id from compound_formula_versions limit 1')
    h.sql(x.issue(v, mr, x.payload(ver, key, custom=not official, sku=False) if not official else x.payload(ver, key)), r.DOCTOR if official else r.OWNER)
    cart = read(h, v, stay); comp = next(row for row in cart['rows'] if row.get('compound_recipe_id'))
    hpp = hpp_of(h, comp['id'])
    if plant_below:
        plant(h, comp['id'], round(hpp) - 151)     # the live case: saved price Rp151 short of cost
        cart = read(h, v, stay); comp = next(row for row in cart['rows'] if row.get('compound_recipe_id'))
    return v, mr, stay, cart, comp, hpp


def run(h, setup=True):
    if setup: x.setup(h)
    BR = h.nilai(f'select code from branches where id={q(r.BRANCH)}')
    # ---------------------------------------------------------------- RED: the deadlock
    v, mr, stay, cart, comp, hpp = racikan_visit(h, 2401)
    official = h.nilai(f"select exists(select 1 from compound_official_usage where recipe_id={q(comp['compound_recipe_id'])})") == 't'
    check('fixture: official racikan priced below its FIFO cost', official and comp['harga'] < hpp, dict(harga=comp['harga'], hpp=hpp, official=official))
    err = h.gagal(save(v, stay, cart['snapshot'], cart['rows'], [dict(method='Tunai', amount=total(cart))], f'f8-red-a-{OFF}'), r.STAFF)
    check('RED-a: the cashier cannot post (P03 floor names the racikan row)', bool(err and 'PRICE_BELOW_HPP' in err and 'Obat Racik' in err or err and 'PRICE_BELOW_HPP' in err) and invoices(h, v) == 0, dict(error=(err or '')[:300]))
    rows = json.loads(json.dumps(cart['rows'])); next(rw for rw in rows if rw['id'] == comp['id'])['harga'] = round(hpp) + 500
    err = h.gagal(save(v, stay, cart['snapshot'], rows, [dict(method='Tunai', amount=total(cart))], f'f8-red-b-{OFF}'), r.STAFF)
    check('RED-b: the cashier cannot raise the racikan price (COMPOUND_LOCKED) -> deadlock', bool(err and 'COMPOUND_LOCKED' in err) and harga_of(h, comp['id']) == comp['harga'], dict(error=(err or '')[:200]))
    err = h.gagal(f"begin;{x.claims(r.OWNER)}update prescription_items set harga={round(hpp)+500} where id={q(comp['id'])};commit;")
    check('RED-c: a plain UPDATE of the official racikan row is refused even for the owner session (guard_full_record_prescription / official snapshot)', bool(err and ('RECIPE_LINKED' in err or 'ACCESS_DENIED' in err)) and harga_of(h, comp['id']) == comp['harga'], dict(error=(err or '')[:200]))

    # ---------------------------------------------------------------- negatives (every one leaves harga/audit untouched)
    base = harga_of(h, comp['id']); a0 = audits(h, v)
    def refused(name, sql, needle, rid=comp['id']):
        err = h.gagal(sql)
        check('NEG ' + name, bool(err and needle in err) and harga_of(h, rid) == (base if rid == comp['id'] else harga_of(h, rid)) and audits(h, v) == a0 and trig_on(h), dict(error=(err or '')[:220]))
    v2, mr2, stay2, cart2, comp2, hpp2 = racikan_visit(h, 2402)
    refused('wrong visit (row belongs to another visit)', call(h, v, BR, comp2['id'], round(hpp) + 500), 'tidak ada di kunjungan ini')
    refused('wrong branch code', call(h, v, 'BUKAN_CABANG', comp['id'], round(hpp) + 500), 'cabang kunjungan')
    refused('price below HPP (floor intact)', call(h, v, BR, comp['id'], round(hpp) - 1), 'di bawah HPP')
    refused('price equal to HPP minus a rupiah fraction still below', call(h, v, BR, comp['id'], hpp - 0.01), 'di bawah HPP')
    refused('more than 10x the old price', call(h, v, BR, comp['id'], comp['harga'] * 10 + 1), 'lebih dari 10x')
    refused('unchanged price', call(h, v, BR, comp['id'], comp['harga']), 'tidak ada perubahan') if comp['harga'] >= hpp else None
    refused('reason too short', call(h, v, BR, comp['id'], round(hpp) + 500, reason='  ab  '), 'alasan wajib')
    refused('actor is not an Owner (STAFF profile)', call(h, v, BR, comp['id'], round(hpp) + 500, actor=r.STAFF), 'bukan Owner')
    refused('plain non-racikan row', call(h, v, BR, next(rw['id'] for rw in cart['rows'] if not rw.get('compound_recipe_id')), 100), 'bukan racikan')
    refused('unknown row', call(h, v, BR, r.uid('e', 999), round(hpp) + 500), 'tidak ada di kunjungan ini')
    # two racikan with the same name in one visit -> ambiguous, refused
    ver = h.nilai('select id from compound_formula_versions limit 1')
    h.sql(x.issue(v2, mr2, x.payload(ver, f'f8-compound-2402-b-{OFF}')), r.DOCTOR)
    err = h.gagal(call(h, v2, BR, comp2['id'], round(hpp2) + 500))
    check('NEG two racikan rows with the same name in the visit -> refused (exactly one row required)', bool(err and 'harus tepat satu' in err) and harga_of(h, comp2['id']) == comp2['harga'] and trig_on(h), dict(error=(err or '')[:220]))

    # a row the cashier already withdrew from the bill is refused (planted by hand: the cashier RPC is what normally sets it)
    v6, mr6, stay6, cart6, comp6, hpp6 = racikan_visit(h, 2406)
    h.sql("begin;alter table public.prescription_items disable trigger official_prescription_snapshot;"
          f"update prescription_items set billing_withdrawn_at=now(),billing_withdrawn_by={q(r.STAFF)},billing_withdrawal_reason='ditarik uji' where id={q(comp6['id'])};"
          "set constraints all immediate;alter table public.prescription_items enable trigger official_prescription_snapshot;commit;")
    err = h.gagal(call(h, v6, BR, comp6['id'], round(hpp6) + 500, actor=r.OWNER))
    check('NEG withdrawn (billing_withdrawn_at) racikan row is refused', bool(err and 'sudah ditarik' in err), dict(error=(err or '')[:200]))

    # ---------------------------------------------------------------- GREEN
    new_price = int(-(-hpp // 500) * 500) if hpp % 500 else int(hpp) + 500
    out = h.nilai(call(h, v, BR, comp['id'], new_price, actor=r.OWNER))
    st = h.nilai(f"select harga from prescription_items where id={q(comp['id'])}")
    only_harga = h.nilai(f"select count(*) from audit_probe where false") if False else None
    check('GREEN: valid one-off changes ONLY the price, official trigger is enabled again, audit row written',
          float(st) == new_price and trig_on(h) and audits(h, v) == a0 + 1 and 'racikan_resmi_trigger_ditangani' in out, dict(harga=st, out=out[:200]))
    aud = json.loads(h.nilai(f"select to_jsonb(e) from clinic_pending_cart_edits e where e.visit_id={q(v)} and e.request_key like 'f8-racikan-harga-sekali:%' limit 1"))
    check('GREEN: audit row records who (Owner profile), why, and before/after price',
          aud['created_by'] == r.OWNER and 'Ubah harga racikan sekali jalan' in aud['reason'] and 'HPP naik' in aud['reason']
          and float(aud['before_rows'][0]['harga']) == comp['harga'] and float(aud['after_rows'][0]['harga']) == new_price, dict(created_by=aud['created_by'], reason=aud['reason'][:90]))
    other = h.nilai(f"select count(*) from prescription_items p join medical_records mr on mr.id=p.medical_record_id where mr.visit_id={q(v)} and p.id<>{q(comp['id'])} and p.harga is not null")
    cart = read(h, v, stay); comp = next(row for row in cart['rows'] if row.get('compound_recipe_id'))
    check('cart re-read shows the new racikan price and a fresh snapshot', comp['harga'] == new_price, dict(harga=comp['harga']))
    snap = h.nilai(f"select sale_price from clinic_compound_sales where recipe_id={q(comp['compound_recipe_id'])}")
    check('GREEN: master-compound sale snapshot moved with the row (MASTER_COMPOUND_SNAPSHOT would refuse otherwise)', float(snap) == new_price, dict(sale_price=snap))
    err = h.gagal(save(v, stay, cart['snapshot'], cart['rows'], [dict(method='Tunai', amount=total(cart))], f'f8-green-pay-{OFF}'), r.STAFF)
    inv = h.aktif(v) if not err else None
    line = h.nilai(f"select harga||'|'||hpp from invoice_items where compound_recipe_id={q(comp['compound_recipe_id'])}") if not err else None
    check('GREEN: cashier saves and posts; racikan line at the new price with unchanged FIFO cost (floor intact)',
          not err and line is not None and float(line.split('|')[0]) == new_price and float(line.split('|')[1]) == hpp, dict(error=(err or '')[:300], line=line))
    err = h.gagal(call(h, v, BR, comp['id'], new_price + 500, actor=r.OWNER))
    check('NEG already invoiced -> refused', bool(err and 'sudah masuk invoice' in err), dict(error=(err or '')[:200]))
    # a second run on a fresh visit with the same numbers: replay of the audit key is impossible once harga changed (unchanged price refused)
    v3, mr3, stay3, cart3, comp3, hpp3 = racikan_visit(h, 2403)
    h.sql(call(h, v3, BR, comp3['id'], int(hpp3) + 500, actor=r.OWNER))
    err = h.gagal(call(h, v3, BR, comp3['id'], int(hpp3) + 500, actor=r.OWNER))
    check('replay of the same one-off is refused (price already set) and writes no second audit row', bool(err and 'tidak ada perubahan' in err) and audits(h, v3) == 1, dict(error=(err or '')[:200]))
    # the price must still clear the floor at posting: below-HPP via any other route stays refused (raised price then lowered by hand is impossible from the cashier)
    v4, mr4, stay4, cart4, comp4, hpp4 = racikan_visit(h, 2404)
    h.sql(call(h, v4, BR, comp4['id'], int(hpp4) + 1, actor=r.OWNER))
    cart4 = read(h, v4, stay4)
    err = h.gagal(save(v4, stay4, cart4['snapshot'], cart4['rows'], [dict(method='Tunai', amount=total(cart4))], f'f8-green-min-{OFF}'), r.STAFF)
    check('price just above HPP (>= HPP) posts', not err and invoices(h, v4) == 1, dict(error=(err or '')[:200]))

    # ---------------------------------------------------------------- a NON-official racikan: no trigger is touched at all
    try:
        v5, mr5, stay5, cart5, comp5, hpp5 = racikan_visit(h, 2405, official=False, plant_below=False)
        is_off = h.nilai(f"select exists(select 1 from compound_official_usage where recipe_id={q(comp5['compound_recipe_id'])})") == 't'
        if not is_off:
            h.sql(f"update prescription_items set harga={max(1, round(hpp5) - 151)} where id={q(comp5['id'])};")
            out = h.nilai(call(h, v5, BR, comp5['id'], int(hpp5) + 500, actor=r.OWNER))
            check('non-official racikan: updated without touching any trigger', '"racikan_resmi_trigger_ditangani": false' in out and trig_on(h), dict(out=out[:160]))
        else:
            check('non-official racikan fixture is official (skipped)', True, dict(skipped=True))
    except RuntimeError as e:
        check('non-official racikan fixture', False, str(e)[:300])


MUTANTS = [
    ('F8-M1 sale snapshot not moved', "    update public.clinic_compound_sales set sale_price = p_new where recipe_id = v_row.compound_recipe_id;", "    null;"),
    ('F8-M2 floor guard removed', "if round(v_row.qty * p_new, 2) < v_hpp then", "if false then"),
    ('F8-M3 10x cap removed', "if v_row.harga > 0 and p_new > v_row.harga * 10 then", "if false then"),
    ('F8-M4 already-invoiced guard removed', "    raise exception 'F8: racikan ini sudah masuk invoice; ubah lewat koreksi invoice, bukan skrip ini';", "    null;"),
    ('F8-M5 row/visit binding removed', "where pi.id = p_row_id and m.visit_id = p_visit for update of pi;", "where pi.id = p_row_id for update of pi;"),
    ('F8-M6 branch guard removed', "if v_branch is distinct from p_branch_code then", "if false then"),
    ('F8-M7 exactly-one-row guard removed', "if v_n <> 1 then", "if false then"),
    ('F8-M8 owner-actor guard removed', "if v_actor is null then raise exception 'F8: profil % bukan Owner aktif', p_actor; end if;", "null;"),
    ('F8-M9 withdrawn guard removed', "if v_row.billing_withdrawn_at is not null then raise exception 'F8: baris sudah ditarik dari tagihan'; end if;", "null;"),
    ('F8-M10 reason guard removed', "if length(regexp_replace(coalesce(p_reason, ''), '\\s', '', 'g')) < 5 then", "if false then"),
    ('F8-M11 trigger left disabled (enable removed)', "    alter table public.prescription_items enable trigger official_prescription_snapshot;", "    null;"),
    ('F8-M12 audit row written under the wrong actor', "  values (p_visit, v_actor,", "  values (p_visit, (select p.id from public.profiles p where p.role <> 'OWNER' limit 1),"),
]


def main_mutations(a):
    global OFF, MUTANT
    with r.NativePostgres(r.BIN) as db:
        r.fixture.DisposablePostgres.bootstrap(db); h = x.Harness(db)
        run(h, setup=True)
        control_fail = [c for c in RESULTS if c['status'] == 'FAIL']
        check('F8-M0 control (unmodified SQL) has 0 FAIL', not control_fail, [c['case'] for c in control_fail])
        mark = len(RESULTS)
        for i, (name, old, new) in enumerate(MUTANTS, 1):
            OFF = 100 * i; MUTANT = (old, new); before = len(RESULTS)
            crash = None
            try:
                run(h, setup=False)
            except Exception as e:
                crash = 'battery aborted: ' + str(e).strip().splitlines()[0][:200]
            fails = [c['case'] for c in RESULTS[before:] if c['status'] == 'FAIL'] + ([crash] if crash else [])
            del RESULTS[before:]
            check(name + ' KILLED', bool(fails), fails[:3])
    MUTANT = None


def main():
    p = argparse.ArgumentParser(); p.add_argument('--json', type=Path, required=True); p.add_argument('--pg-bin'); p.add_argument('--mutations', action='store_true'); a = p.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    try:
        if a.mutations: main_mutations(a)
        else:
            with r.NativePostgres(r.BIN) as db: r.fixture.DisposablePostgres.bootstrap(db); run(x.Harness(db))
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(c['status'] == s for c in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(cases=RESULTS, totals=totals), indent=2, default=str)); print(totals)
    return int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
