#!/usr/bin/env python3
"""F7: OWNER changes ONLY the price of a saved, still-pending racikan row in the ranap cashier (migration 20261106870000).

Native full schema, fictional fixtures, throwaway local cluster, no network.
  python3 -I scripts/test-ranap-racikan-harga-owner-postgres.py --pg-bin DIR --json out.json     [wrap in flock /opt/data/kamo-heavy-test.lock]
  --baseline    chain WITHOUT the candidate migration: the unlock cases must FAIL (RED = the deadlock)
  --mutations   chain without the candidate once, then each mutant of the candidate in a cloned database; all must be killed
"""
import argparse, importlib.util, json, os, sys, tempfile
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('medical', ROOT / 'scripts/test-rekam-full-edit-postgres.py'); assert spec and spec.loader
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
x, r, q, j = m.x, m.r, m.q, m.j
CANDIDATE = '20261106870000_ranap_racikan_ubah_harga.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = []
OFF = 0


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:420], flush=True)


def read(h, v, stay, user=r.STAFF): return json.loads(h.nilai(f'select clinic_read_inpatient_cashier({q(stay)},{q(v)});', user))
def save(v, stay, snapshot, rows, parts, key, reason='Kasir Fiktif'):
    return f"select clinic_save_inpatient_cashier({q(stay)},{q(v)},{q(key)},'2026-11-03',{q(snapshot)},{j(rows)},{j(parts)},null,false,null,{q(reason)});"
def total(cart): return sum(row['qty'] * row['harga'] for row in cart['rows'])
def stay_of(h, v): return h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
def hpp_of(h, rid): return float(h.nilai(f"select round(sum(ci.qty*ci.unit_cost),2) from compound_issues ci join prescription_items p on p.compound_recipe_id=ci.recipe_id where p.id={q(rid)}"))
def harga_of(h, rid): return float(h.nilai(f'select harga from prescription_items where id={q(rid)}'))
def sale_of(h, rid): return h.nilai(f"select s.sale_price from clinic_compound_sales s join prescription_items p on p.compound_recipe_id=s.recipe_id where p.id={q(rid)}")
def changes(h, v): return h.angka(f"select case when to_regclass('clinic_private.racikan_price_changes') is null then 0 else (select count(*) from clinic_private.racikan_price_changes where visit_id={q(v)}) end") if False else (0 if h.nilai("select to_regclass('clinic_private.racikan_price_changes') is null") == 't' else h.angka(f'select count(*) from clinic_private.racikan_price_changes where visit_id={q(v)}'))
def edits(h, v): return h.angka(f'select count(*) from clinic_pending_cart_edits where visit_id={q(v)}')
def permits(h): return 0 if h.nilai("select to_regclass('clinic_private.racikan_price_permits') is null") == 't' else h.angka('select count(*) from clinic_private.racikan_price_permits')
def invoices(h, v): return h.angka(f'select count(*) from invoices where visit_id={q(v)}')
def trig_on(h): return h.nilai("select tgenabled from pg_trigger where tgrelid='public.prescription_items'::regclass and tgname='official_prescription_snapshot'") == 'O'
def plant(h, rid, harga):
    h.sql("begin;alter table public.prescription_items disable trigger official_prescription_snapshot;"
          f"update public.prescription_items set harga={harga} where id={q(rid)};"
          f"update public.clinic_compound_sales set sale_price={harga} where recipe_id=(select compound_recipe_id from public.prescription_items where id={q(rid)});"
          "set constraints all immediate;alter table public.prescription_items enable trigger official_prescription_snapshot;commit;")


def racikan_visit(h, n, official=True, below=True):
    n += OFF
    v, mr = m.visit(h, n); stay = stay_of(h, v); ver = h.nilai('select id from compound_formula_versions limit 1'); key = f'f7-compound-{n}'
    h.sql(x.issue(v, mr, x.payload(ver, key) if official else x.payload(ver, key, custom=True, sku=False)), r.DOCTOR if official else r.OWNER)
    cart = read(h, v, stay); comp = next(row for row in cart['rows'] if row.get('compound_recipe_id')); hpp = hpp_of(h, comp['id'])
    if below and official:
        plant(h, comp['id'], round(hpp) - 151); cart = read(h, v, stay); comp = next(row for row in cart['rows'] if row.get('compound_recipe_id'))
    return v, mr, stay, cart, comp, hpp


def with_price(cart, rid, harga, reason=None, **extra):
    rows = json.loads(json.dumps(cart['rows']))
    row = next(rw for rw in rows if rw['id'] == rid); row['harga'] = harga
    if reason is not None: row['harga_reason'] = reason
    row.update(extra)
    return rows


def pay(h, v, stay, cart, rows, key, user, reason='Kasir Fiktif'):
    amount = -(-sum(rw['qty'] * rw['harga'] for rw in rows) // 1)   # whole rupiah, rounded up
    return h.gagal(save(v, stay, cart['snapshot'], rows, [dict(method='Tunai', amount=amount)], f'{key}-{OFF}', reason), user)


def untouched(h, v, comp, a_changes, a_edits):
    return harga_of(h, comp['id']) == comp['harga'] and changes(h, v) == a_changes and edits(h, v) == a_edits and permits(h) == 0 and invoices(h, v) == 0 and trig_on(h)


def run(h, setup=True, baseline=False):
    if setup: x.setup(h)
    # ---------------------------------------------------------------- the deadlock + the owner unlock (official master racikan)
    v, mr, stay, cart, comp, hpp = racikan_visit(h, 3401)
    check('fixture: racikan priced Rp151 below its FIFO cost', comp['harga'] < hpp, dict(harga=comp['harga'], hpp=hpp))
    new_price = int(hpp) + 500
    a0 = (changes(h, v), edits(h, v))
    err = pay(h, v, stay, cart, with_price(cart, comp['id'], new_price, 'Harga racikan dinaikkan karena HPP naik'), 'f7-owner', r.OWNER)
    ok = err is None
    line = h.nilai(f"select harga||'|'||hpp from invoice_items where compound_recipe_id={q(comp['compound_recipe_id'])}") if ok else None
    check('GREEN owner raises the racikan price with a reason: saved, posted at the new price with unchanged FIFO cost',
          ok and harga_of(h, comp['id']) == new_price and line is not None and float(line.split('|')[0]) == new_price and float(line.split('|')[1]) == hpp,
          dict(error=(err or '')[:260], line=line))
    if ok:
        ch = json.loads(h.nilai(f"select to_jsonb(c) from clinic_private.racikan_price_changes c where visit_id={q(v)}"))
        check('audit: who / when / old and new price / reason (racikan_price_changes) + cart before/after (clinic_pending_cart_edits)',
              ch['changed_by'] == r.OWNER and float(ch['old_price']) == comp['harga'] and float(ch['new_price']) == new_price and 'HPP naik' in ch['reason']
              and edits(h, v) == a0[1] + 1 and permits(h) == 0 and float(sale_of(h, comp['id'])) == new_price and trig_on(h), dict(ch=ch))
        again = pay(h, v, stay, cart, with_price(cart, comp['id'], new_price, 'Harga racikan dinaikkan karena HPP naik'), 'f7-owner', r.OWNER)
        check('replay of the same request is idempotent (no second change row, no error)', again is None and changes(h, v) == 1, dict(error=(again or '')[:200]))
    if baseline: return

    # ---------------------------------------------------------------- roles: only OWNER
    v2, mr2, stay2, cart2, comp2, hpp2 = racikan_visit(h, 3402); b = (changes(h, v2), edits(h, v2))
    for name, user in (('ADMIN', r.ADMIN), ('FINANCE', r.FINANCE), ('STAFF', r.STAFF)):
        err = pay(h, v2, stay2, cart2, with_price(cart2, comp2['id'], int(hpp2) + 500, 'Alasan cukup panjang'), 'f7-role-' + name, user)
        check(f'NEG {name} cannot change the racikan price (ACCESS_DENIED)', bool(err and 'ACCESS_DENIED' in err) and untouched(h, v2, comp2, *b), dict(error=(err or '')[:200]))
    # ---------------------------------------------------------------- reason
    for label, reason in (('missing', None), ('empty', ''), ('whitespace', '      '), ('too short', 'ab c'), ('too long', 'x' * 501)):
        err = pay(h, v2, stay2, cart2, with_price(cart2, comp2['id'], int(hpp2) + 500, reason), 'f7-reason-' + label, r.OWNER)
        check(f'NEG owner without a valid reason ({label}) -> CART_INVALID, nothing changed', bool(err and 'CART_INVALID' in err) and untouched(h, v2, comp2, *b), dict(error=(err or '')[:200]))
    # ---------------------------------------------------------------- everything else stays locked
    other_item = h.nilai(f"select id from items where id<>{q(comp2['item_id'])} and item_type='Persediaan' limit 1") if comp2.get('item_id') else None
    for label, extra in (('qty', dict(qty=2)), ('item', dict(item_id=other_item) if other_item else dict(item_id=r.uid('e', 777))),
                         ('qty together with a valid price change', dict(qty=3))):
        err = pay(h, v2, stay2, cart2, with_price(cart2, comp2['id'], int(hpp2) + 500, 'Alasan cukup panjang', **extra), 'f7-lock-' + label.split()[0], r.OWNER)
        check(f'NEG owner cannot change {label} of a racikan (COMPOUND_LOCKED)', bool(err and 'COMPOUND_LOCKED' in err) and untouched(h, v2, comp2, *b), dict(error=(err or '')[:200]))
    err = pay(h, v2, stay2, cart2, with_price(cart2, comp2['id'], int(hpp2) + 500, 'Alasan cukup panjang', service_performers=dict(doctor_id=r.DOKTER_PEGAWAI, staff_id=None)), 'f7-lock-perf', r.OWNER)
    check('NEG owner cannot change racikan performers (COMPOUND_LOCKED)', bool(err and 'COMPOUND_LOCKED' in err or err and 'CART_INVALID' in err) and untouched(h, v2, comp2, *b), dict(error=(err or '')[:200]))
    err = pay(h, v2, stay2, cart2, with_price(cart2, comp2['id'], int(hpp2) + 500, 'Alasan cukup panjang', diskon_persen=10), 'f7-lock-disc', r.OWNER)
    check('NEG stage discount stays unsupported (CART_INVALID)', bool(err and 'CART_INVALID' in err) and untouched(h, v2, comp2, *b), dict(error=(err or '')[:200]))
    # ---------------------------------------------------------------- P03 floor still judges the posting
    for label, price in (('HPP minus one rupiah', int(hpp2) - 1), ('zero', 0)):
        err = pay(h, v2, stay2, cart2, with_price(cart2, comp2['id'], price, 'Alasan cukup panjang'), 'f7-floor-' + label.split()[0], r.OWNER)
        check(f'NEG owner price {label} -> P03 floor refuses and the WHOLE save rolls back (price, snapshot, audit, permit)',
              bool(err and ('PRICE_BELOW_HPP' in err or 'PRICE_ZERO' in err)) and untouched(h, v2, comp2, *b) and float(sale_of(h, comp2['id'])) == comp2['harga'], dict(error=(err or '')[:240]))
    for label, price in (('negative', -1), ('above the 1e12 cap', 1e12 + 1)):
        err = pay(h, v2, stay2, cart2, with_price(cart2, comp2['id'], price, 'Alasan cukup panjang'), 'f7-cap-' + label.split()[0], r.OWNER)
        check(f'NEG owner price {label} -> CART_INVALID', bool(err and 'CART_INVALID' in err) and untouched(h, v2, comp2, *b), dict(error=(err or '')[:200]))
    # ---------------------------------------------------------------- relative ceiling: new price <= 10 x the stored price (typo guard)
    old2 = comp2['harga']
    for label, price in (('10x the old price plus one rupiah', old2 * 10 + 1), ('450500 typed instead of 45050 (ten times the right price)', (int(hpp2) + 500) * 100)):
        err = pay(h, v2, stay2, cart2, with_price(cart2, comp2['id'], price, 'Alasan cukup panjang'), 'f7-ceil-' + label.split()[0], r.OWNER)
        check(f'NEG owner price {label} -> CART_INVALID "melebihi batas 10x", whole save rolls back',
              bool(err and 'CART_INVALID' in err and 'melebihi batas 10x' in err and 'harga tersimpan' in err) and untouched(h, v2, comp2, *b), dict(error=(err or '')[:260]))
    v7, mr7, stay7, cart7, comp7, hpp7 = racikan_visit(h, 3407)
    cap7 = comp7['harga'] * 10
    err = pay(h, v7, stay7, cart7, with_price(cart7, comp7['id'], cap7, 'Alasan cukup panjang'), 'f7-ceil-exact', r.OWNER)
    check('owner price exactly 10x the stored price is accepted (the ceiling is not stricter than stated)', err is None and harga_of(h, comp7['id']) == cap7 and changes(h, v7) == 1, dict(error=(err or '')[:200], cap=cap7))
    # stored price Rp0 (below HPP, stuck): the ceiling then rests on 10 x HPP, never on a free-for-all
    v8, mr8, stay8, cart8, comp8, hpp8 = racikan_visit(h, 3408)
    plant(h, comp8['id'], 0); cart8 = read(h, v8, stay8); comp8 = next(row for row in cart8['rows'] if row.get('compound_recipe_id')); b8 = (changes(h, v8), edits(h, v8))
    err = pay(h, v8, stay8, cart8, with_price(cart8, comp8['id'], hpp8 * 10 + 1, 'Alasan cukup panjang'), 'f7-ceil-zero', r.OWNER)
    check('NEG stored price Rp0: new price above 10 x HPP is refused with the same message', bool(err and 'melebihi batas 10x' in err) and untouched(h, v8, comp8, *b8), dict(error=(err or '')[:220]))
    err = pay(h, v8, stay8, cart8, with_price(cart8, comp8['id'], hpp8 * 10, 'Alasan cukup panjang'), 'f7-ceil-zero-ok', r.OWNER)
    check('stored price Rp0: new price at 10 x HPP is accepted', err is None and harga_of(h, comp8['id']) == hpp8 * 10, dict(error=(err or '')[:220]))
    # the audit has a documented SQL read path (migration header); the documented query itself must run and show the change
    hdr = (MIG / CANDIDATE).read_text().split('BACA_JEJAK_MULAI')[1].split('BACA_JEJAK_SELESAI')[0] if 'BACA_JEJAK_MULAI' in (MIG / CANDIDATE).read_text() else ''
    qtext = '\n'.join(l[2:] if l.startswith('--') else l for l in hdr.splitlines() if l.startswith('--   ')).strip()
    try:
        out = h.sql(qtext) if qtext else ''
        check('audit read path: the query documented in the migration header runs and lists the Owner price change (who, old/new price, reason)',
              'Alasan' in out or 'Harga racikan dinaikkan' in out, dict(rows=out[:200], query=qtext[:120]))
    except RuntimeError as e:
        check('audit read path: the query documented in the migration header runs', False, dict(error=str(e)[:200], query=qtext[:200]))
    # ---------------------------------------------------------------- already on an invoice
    v3, mr3, stay3, cart3, comp3, hpp3 = racikan_visit(h, 3403); b3 = (changes(h, v3), edits(h, v3))
    # A pending racikan row that still points at a VOIDED invoice line (the sealed-row case): planted inside the stage posting context.
    inv3 = r.uid('b', 3403 + OFF)
    err_plant = h.gagal("begin;insert into clinic_private.posting_ctx(txid,kind,visit_id) values(txid_current(),'stage'," + q(v3) + ");"
        f"insert into invoices(id,visit_id,voided_at) values({q(inv3)},{q(v3)},now());"
        f"insert into invoice_items(invoice_id,deskripsi,qty,harga,jenis,prescription_item_id) values({q(inv3)},'Plant sudah ditagih',1,1,'obat',{q(comp3['id'])});"
        "delete from clinic_private.posting_ctx where txid=txid_current();commit;")
    if err_plant is None:
        cart3 = read(h, v3, stay3); comp3 = next((rw for rw in cart3['rows'] if rw['id'] == comp3['id']), None)
        err = pay(h, v3, stay3, cart3, with_price(cart3, comp3['id'], int(hpp3) + 500, 'Alasan cukup panjang'), 'f7-invoiced', r.OWNER) if comp3 else 'row not in cart'
        check('NEG racikan row that already has a (voided) invoice line is refused with COMPOUND_LOCKED (koreksi dokumen invoice)',
              bool(err and 'COMPOUND_LOCKED' in err and 'invoice' in err) and harga_of(h, comp3['id']) == comp3['harga'] and changes(h, v3) == b3[0], dict(error=(err or '')[:220]))
    else:
        check('NOT VERIFIED: could not plant a voided invoice line for the invoiced-row case', False, dict(error=err_plant[:300]))
    # ---------------------------------------------------------------- non-master (custom) racikan: no sale snapshot
    try:
        v4, mr4, stay4, cart4, comp4, hpp4 = racikan_visit(h, 3404, official=False, below=False)
        has_sale = h.nilai(f"select exists(select 1 from clinic_compound_sales where recipe_id={q(comp4['compound_recipe_id'])})") == 't'
        price4 = max(int(hpp4) + 500, int(comp4['harga']) + 1)
        err = pay(h, v4, stay4, cart4, with_price(cart4, comp4['id'], price4, 'Alasan cukup panjang'), 'f7-custom', r.OWNER)
        check('custom (non-master) racikan: owner price change saves and posts too', err is None and not has_sale and harga_of(h, comp4['id']) == price4 and changes(h, v4) == 1, dict(error=(err or '')[:200], has_sale=has_sale))
    except RuntimeError as e:
        check('custom racikan fixture', False, str(e)[:300])
    # ---------------------------------------------------------------- the trigger exception is narrow (direct, definer-like context)
    v5, mr5, stay5, cart5, comp5, hpp5 = racikan_visit(h, 3405)
    def direct(actor, permit_actor, body, permit_row=comp5['id']):
        plant_permit = f"insert into clinic_private.racikan_price_permits values(txid_current(),{q(permit_actor)},{q(permit_row)});" if permit_row else ''
        return h.gagal('begin;' + plant_permit + "select set_config('request.jwt.claims'," + q(json.dumps(dict(sub=actor, role='authenticated'))) + ',false);' + body + 'rollback;')
    upd = lambda cols: f"update public.prescription_items set {cols} where id={q(comp5['id'])};"
    err = direct(r.OWNER, r.OWNER, upd(f"harga={int(hpp5) + 500}"))
    check('trigger: with a valid permit a harga-only UPDATE of the official racikan row is allowed (rolled back here)', err is None, dict(error=(err or '')[:200]))
    err = direct(r.OWNER, r.OWNER, upd(f"harga={int(hpp5) + 500},nama_obat='Diganti'"))
    check('trigger: harga plus ANY other column is refused even with a permit (RECIPE_LINKED)', bool(err and 'RECIPE_LINKED' in err), dict(error=(err or '')[:200]))
    err = direct(r.OWNER, r.OWNER, upd(f"qty=5"))
    check('trigger: a permit does not unlock qty (RECIPE_LINKED)', bool(err and 'RECIPE_LINKED' in err), dict(error=(err or '')[:200]))
    err = direct(r.OWNER, r.STAFF, upd(f"harga={int(hpp5) + 500}"))
    check('trigger: a permit planted for ANOTHER actor does not help (RECIPE_LINKED)', bool(err and 'RECIPE_LINKED' in err), dict(error=(err or '')[:200]))
    err = direct(r.OWNER, r.OWNER, upd(f"harga={int(hpp5) + 500}"), permit_row=r.uid('e', 888))
    check('trigger: a permit for ANOTHER row does not help (RECIPE_LINKED)', bool(err and 'RECIPE_LINKED' in err), dict(error=(err or '')[:200]))
    err = direct(r.OWNER, r.OWNER, upd(f"harga={int(hpp5) + 500}"), permit_row=None)
    check('trigger: no permit -> refused (RECIPE_LINKED)', bool(err and 'RECIPE_LINKED' in err), dict(error=(err or '')[:200]))
    err = h.gagal(f"begin;{x.claims(r.OWNER)}insert into clinic_private.racikan_price_permits values(txid_current(),{q(r.OWNER)},{q(comp5['id'])});commit;")
    check('an app role (owner session) cannot forge a permit (no privilege on clinic_private)', bool(err and ('permission denied' in err or 'tidak' in err.lower())), dict(error=(err or '')[:200]))
    # the exception never covers a row that has an invoice line (comp3, planted above) or one that was withdrawn from the bill
    def direct_row(rid, harga):
        return h.gagal('begin;' + f"insert into clinic_private.racikan_price_permits values(txid_current(),{q(r.OWNER)},{q(rid)});"
                       + "select set_config('request.jwt.claims'," + q(json.dumps(dict(sub=r.OWNER, role='authenticated'))) + ',false);'
                       + f"update public.prescription_items set harga={harga} where id={q(rid)};rollback;")
    if err_plant is None:
        err = direct_row(comp3['id'], int(hpp3) + 700)
        check('trigger: a permit does not unlock a racikan row that already has an invoice line (RECIPE_LINKED)', bool(err and 'RECIPE_LINKED' in err), dict(error=(err or '')[:200]))
    v6, mr6, stay6, cart6, comp6, hpp6 = racikan_visit(h, 3406)
    h.sql("begin;alter table public.prescription_items disable trigger official_prescription_snapshot;"
          f"update prescription_items set billing_withdrawn_at=now(),billing_withdrawn_by={q(r.STAFF)},billing_withdrawal_reason='ditarik uji' where id={q(comp6['id'])};"
          "set constraints all immediate;alter table public.prescription_items enable trigger official_prescription_snapshot;commit;")
    err = direct_row(comp6['id'], int(hpp6) + 700)
    check('trigger: a permit does not unlock a withdrawn racikan row (RECIPE_LINKED)', bool(err and 'RECIPE_LINKED' in err), dict(error=(err or '')[:200]))
    err = h.gagal(f"update clinic_private.racikan_price_changes set reason='diubah semua';")
    err2 = h.gagal("delete from clinic_private.racikan_price_changes;")
    check('audit rows are append-only (UPDATE and DELETE refused)', changes(h, v) == 1 and bool(err) and bool(err2), dict(update=(err or '')[:120], delete=(err2 or '')[:120]))


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


MUTANTS = [
    ('F7-M1 role check removed (any cart role may change the price)', "if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER')then", "if false then"),
    ('F7-M2 reason requirement removed', "if length(regexp_replace(v_racik_reason,'\\s','','g'))<5 or length(v_racik_reason)>500 then", "if false then"),
    ('F7-M3 invoiced-row guard removed', "if exists(select 1 from public.invoice_items l where l.prescription_item_id=v_id or l.compound_recipe_id=rx.compound_recipe_id)then", "if false then"),
    ('F7-M4 master sale snapshot not moved', "if v_has_sale then update public.clinic_compound_sales set sale_price=v_price where recipe_id=rx.compound_recipe_id;end if;", ""),
    ('F7-M5 trigger exception no longer harga-only', "\\n       and (to_jsonb(new) - ''harga'') = (to_jsonb(old) - ''harga'')", ""),
    ('F7-M6 trigger exception ignores the permit actor', "         and p.actor = auth.uid() and p.prescription_item_id = old.id)", "         and p.prescription_item_id = old.id)"),
    ('F7-M7 trigger exception ignores the permit row', "and p.actor = auth.uid() and p.prescription_item_id = old.id)", "and p.actor = auth.uid())"),
    ('F7-M8 permit not removed after the UPDATE', "     delete from clinic_private.racikan_price_permits where transaction_id=txid_current() and prescription_item_id=v_id;\n", ""),
    ('F7-M9 audit row not written', "     insert into clinic_private.racikan_price_changes(visit_id,prescription_item_id,compound_recipe_id,old_price,new_price,reason,changed_by,request_key)\n     values(p_visit_id,v_id,rx.compound_recipe_id,rx.harga,v_price,v_racik_reason,auth.uid(),p_request_key);\n", ""),
    ('F7-M10 item lock dropped together with the price lock', "E' or nullif(row_value->>''item_id'','''')::uuid is distinct from rx.item_id'),", "E' '),"),
    ('F7-M11 trigger exception also allows billed rows', "\\n       and not exists(select 1 from public.invoice_items ii where ii.prescription_item_id = old.id) then", " then"),
    ('F7-M12 trigger exception allows withdrawn rows', "\\n       and old.billing_withdrawn_at is null", ""),
    ('F7-M13 ceiling removed', "if v_cap is not null and v_price > v_cap then", "if false then"),
    ('F7-M14 ceiling factor 100 instead of 10', "v_cap:=case when rx.harga>0 then rx.harga*10", "v_cap:=case when rx.harga>0 then rx.harga*100"),
    ('F7-M15 stored price 0: no HPP-based ceiling', "else 10*coalesce((select round(sum(ci.qty*ci.unit_cost),2) from public.compound_issues ci where ci.recipe_id=rx.compound_recipe_id),0) end;", "else null end;"),
]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    global OFF
    try:
        with r.NativePostgres(r.BIN) as db:
            if a.mutations:
                build(db, {CANDIDATE}); h = x.Harness(db); x.setup(h)
                cand = (MIG / CANDIDATE).read_text()
                plan = [('F7-M0 control (unmodified candidate)', cand)]
                for name, old, new in MUTANTS:
                    n = cand.count(old)
                    if n != 1: check(name + ' anchor occurs once', False, dict(count=n)); continue
                    plan.append((name, cand.replace(old, new)))
                for i, (name, text) in enumerate(plan):
                    os.environ.pop('PGDATABASE', None)
                    db.sql(f'create database v{i} template postgres'); os.environ['PGDATABASE'] = f'v{i}'; OFF = 100 * i
                    before = len(RESULTS); crash = None
                    try:
                        db.sql('begin;\n' + text + '\ncommit;'); run(h, setup=False)
                    except Exception as e:
                        crash = 'battery aborted: ' + str(e).strip().splitlines()[0][:200]
                    fails = [c['case'] for c in RESULTS[before:] if c['status'] == 'FAIL'] + ([crash] if crash else [])
                    del RESULTS[before:]; os.environ.pop('PGDATABASE', None)
                    if i == 0: check(name + ' has 0 FAIL', not fails, fails[:3])
                    else: check(name + ' KILLED', bool(fails), fails[:3])
            else:
                build(db, {CANDIDATE} if a.baseline else set()); run(x.Harness(db), baseline=a.baseline)
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(c['status'] == s for c in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='mutations' if a.mutations else 'RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals), indent=2, default=str)); print(totals)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
