#!/usr/bin/env python3
"""Rawat inap cashier: the visible cart survives a rejected money step ("Simpan" = draft first).

Andri 7 Nov 2026: "kalau gua udah hapus dan save, bukannya nyimpen transaksi sbg draft; yang udah dihapus sebelumnya muncul
lagi; dan jasa/obat yang ditambahkan oleh admin kasir malah jadi hilang."

Root cause (proved by the first block of cases, which pass on the unchanged chain): clinic_save_inpatient_cashier does the cart
edit AND the invoice/payment in ONE transaction, so every rejection of the money step (P03 price floor, DP minimum, stale
snapshot ...) rolls the cashier's removals and added lines back; a reload shows the old cart. Migration 20261107140000 adds
clinic_save_inpatient_cart_draft (same cart engine, no invoice, no payment) which the server action calls when the money step
is rejected and for the explicit "Simpan Draft" button.

Native full schema, fictional fixtures, throwaway local cluster, no network.
  python3 -I scripts/test-ranap-cart-draft-postgres.py --pg-bin DIR --json out.json     [wrap in flock /opt/data/kamo-heavy-test.lock]
  --baseline    chain WITHOUT the candidate migration: the draft cases must FAIL (RED)
  --mutations   chain without the candidate once, then each mutant of the candidate in a cloned database; all must be killed
"""
import argparse, importlib.util, json, os, re, subprocess, sys, tempfile
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('medical', ROOT / 'scripts/test-rekam-full-edit-postgres.py'); assert spec and spec.loader
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
x, r, q, j = m.x, m.r, m.q, m.j
CANDIDATE = '20261107140000_ranap_cart_draft.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = []
JASA_NEW, OBAT_NEW, JASA_OFF = r.uid('c', 1), r.uid('c', 2), r.uid('c', 3)


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:420], flush=True)


def read(h, v, stay, user=r.STAFF): return json.loads(h.nilai(f'select clinic_read_inpatient_cashier({q(stay)},{q(v)});', user))
def save(v, stay, snapshot, rows, parts, key, reason='Kasir Fiktif'):
    return f"select clinic_save_inpatient_cashier({q(stay)},{q(v)},{q(key)},'2026-11-03',{q(snapshot)},{j(rows)},{j(parts)},null,false,null,{q(reason)});"
def draft(v, stay, snapshot, rows, key, reason='Draft kasir Fiktif'):
    return f"select clinic_save_inpatient_cart_draft({q(stay)},{q(v)},{q(key)},{q(snapshot)},{j(rows)},{q(reason)});"
def dn(h, sql, user):
    try: return h.nilai(sql, user)
    except RuntimeError as e: return 'ERROR ' + str(e)[:200]
def stay_of(h, v): return h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
def total(rows): return sum(row['qty'] * row['harga'] for row in rows)
def invoices(h, v): return h.angka(f'select count(*) from invoices where visit_id={q(v)}')
def edits(h, v): return h.angka(f'select count(*) from clinic_pending_cart_edits where visit_id={q(v)}')
def receipts(h, v): return h.angka(f'select count(*) from clinic_payment_receipts where visit_id={q(v)}')
def permits(h): return 0 if h.nilai("select to_regclass('clinic_private.cart_draft_permits') is null") == 't' else h.angka('select count(*) from clinic_private.cart_draft_permits')
def stock_of(h): return h.angka(f"select qty from stock where item_id={q(r.ITEM)}")
def names(cart): return sorted(row['nama_obat'] for row in cart['rows'])
def by_name(cart, name): return next(row for row in cart['rows'] if row['nama_obat'] == name)
def invoice_lines(h, v): return sorted(json.loads(h.nilai(f"select coalesce(jsonb_agg(l.deskripsi||'|'||l.qty||'|'||l.harga),'[]') from invoice_items l join invoices i on i.id=l.invoice_id where i.visit_id={q(v)} and i.voided_at is null")))
def withdrawn(h, rid): return h.nilai(f'select billing_withdrawn_at is not null from prescription_items where id={q(rid)}') == 't'
def exists_rx(h, rid): return h.nilai(f'select exists(select 1 from prescription_items where id={q(rid)})') == 't'
def row(rid, nama, qty, harga, item=None, satuan='kali', jenis='jasa'):
    return dict(id=rid, item_id=item, nama_obat=nama, qty=qty, harga=harga, satuan=satuan, jenis=jenis, diskon_persen=0, service_performers=None)
def edit(cart, remove=(), add=(), prices=None):
    rows = [dict(rw) for rw in cart['rows'] if rw['nama_obat'] not in remove]
    for rw in rows:
        if prices and rw['nama_obat'] in prices: rw['harga'] = prices[rw['nama_obat']]
    return rows + list(add)


def fixture(h, n):
    v, mr = m.visit(h, n); stay = stay_of(h, v)
    return v, mr, stay, read(h, v, stay)


def run(h, setup=True):
    if setup: x.setup(h)
    h.sql(f"""insert into public.item_categories(id,name) values({q(r.uid('c', 90))},'TINDAKAN') on conflict do nothing;
insert into public.items(id,code,name,unit,item_type,is_active,sell_price,buy_price,category_id) values
 ({q(JASA_NEW)},'UJI-CART-JASA','Jasa Kasir Tambahan Fiktif','kali','Jasa',true,70000,0,{q(r.uid('c', 90))}),
 ({q(OBAT_NEW)},'UJI-CART-OBAT','Obat Kasir Tambahan Fiktif','pcs','Persediaan',true,9000,1000,null),
 ({q(JASA_OFF)},'UJI-CART-OFF','Jasa Nonaktif Fiktif','kali','Jasa',false,1000,0,{q(r.uid('c', 90))});
insert into public.stock(warehouse_id,item_id,qty) values({q(r.WH)},{q(OBAT_NEW)},50);
insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values({q(r.WH)},{q(OBAT_NEW)},current_date,50,50,1000,'purchase');""")
    h.sql("insert into public.role_modules(role,module_id) values('FINANCE','klinik') on conflict do nothing;")
    fn = h.nilai("select to_regprocedure('public.clinic_save_inpatient_cart_draft(uuid,uuid,text,text,jsonb,text)') is not null") == 't'
    check('preflight: clinic_save_inpatient_cart_draft exists (absent on the unchanged chain)', fn, {})

    # ================= ROOT CAUSE (characterization; green on the unchanged chain) =================
    # R1. The cashier removes a doctor line, adds a jasa and obat line, and the MONEY step is rejected (P03 floor on the obat row).
    v, mr, stay, cart = fixture(h, 3300)
    removed = by_name(cart, 'Jasa Tambahan Fiktif'); obat = by_name(cart, 'Obat Fiktif')
    add = [row(r.uid('c', 31), 'Jasa Kasir Tambahan Fiktif', 1, 70000, JASA_NEW), row(r.uid('c', 32), 'Obat Kasir Tambahan Fiktif', 2, 9000, OBAT_NEW, 'pcs', 'obat')]
    rows = edit(cart, remove=['Jasa Tambahan Fiktif'], add=add, prices={'Obat Fiktif': 1000})   # 1000 < HPP 2000
    err = h.gagal(save(v, stay, cart['snapshot'], rows, [dict(method='Tunai', amount=total(rows))], 'cd-root-1'), r.STAFF)
    after = read(h, v, stay)
    check('ROOT CAUSE: a rejected money step (PRICE_BELOW_HPP) rolls back the whole cart edit',
          bool(err and 'PRICE_BELOW_HPP' in err) and names(after) == names(cart) and not withdrawn(h, removed['id']) and not exists_rx(h, r.uid('c', 31)) and edits(h, v) == 0 and invoices(h, v) == 0,
          dict(error=(err or '')[:160], rows_after=names(after)))
    check('ROOT CAUSE symptom as Andri reported it: after reload the removed line is back and the cashier-added lines are gone',
          'Jasa Tambahan Fiktif' in names(after) and 'Jasa Kasir Tambahan Fiktif' not in names(after) and 'Obat Kasir Tambahan Fiktif' not in names(after), dict(rows_after=names(after)))

    # R2. Hypotheses 1/2 (merge instead of replace / dropped added line) are NOT the cause: a successful save keeps both.
    v2, mr2, stay2, cart2 = fixture(h, 3301)
    rows2 = edit(cart2, remove=['Jasa Tambahan Fiktif'], add=add[:1] + [row(r.uid('c', 33), 'Obat Kasir Tambahan Fiktif', 1, 9000, OBAT_NEW, 'pcs', 'obat')])
    err = h.gagal(save(v2, stay2, cart2['snapshot'], rows2, [dict(method='Tunai', amount=total(rows2))], 'cd-root-2'), r.STAFF)
    lines = invoice_lines(h, v2)
    check('hypotheses 1/2 refuted: a SUCCESSFUL save invoices exactly the visible cart (removed line absent, added lines present once)',
          err is None and not any('Jasa Tambahan Fiktif' in l for l in lines) and sum('Jasa Kasir Tambahan Fiktif' in l for l in lines) == 1 and sum('Obat Kasir Tambahan Fiktif' in l for l in lines) == 1 and len(lines) == len(rows2), dict(error=(err or '')[:160], lines=lines))
    check('after the successful save the removed line stays withdrawn (evidence kept) and the pending cart is empty, no resurrection on reload',
          withdrawn(h, by_name(cart2, 'Jasa Tambahan Fiktif')['id']) and read(h, v2, stay2)['rows'] == [], {})

    # ================= THE FIX: clinic_save_inpatient_cart_draft =================
    # D1. Same edit as R1 (removal + two added lines + a below-HPP price) saved as a DRAFT: it persists and a reload shows it.
    v, mr, stay, cart = fixture(h, 3310)
    removed = by_name(cart, 'Jasa Tambahan Fiktif')
    add = [row(r.uid('c', 41), 'Jasa Kasir Tambahan Fiktif', 1, 70000, JASA_NEW), row(r.uid('c', 42), 'Obat Kasir Tambahan Fiktif', 2, 9000, OBAT_NEW, 'pcs', 'obat')]
    rows = edit(cart, remove=['Jasa Tambahan Fiktif'], add=add, prices={'Obat Fiktif': 1000})
    stock0 = stock_of(h)
    out = dn(h, draft(v, stay, cart['snapshot'], rows, 'cd-d1'), r.STAFF); res = json.loads(out) if out.startswith('{') else {}
    after = read(h, v, stay)
    expected = sorted(rw['nama_obat'] for rw in rows)
    check('DRAFT: removal + added jasa/obat + edited price are saved with no invoice, no payment, no stock movement',
          res.get('status') == 'DRAFT_SAVED' and invoices(h, v) == 0 and receipts(h, v) == 0 and stock_of(h) == stock0, dict(result=res, out=out[:200]))
    check('DRAFT: the next load shows exactly the visible cart (removed line stays removed, added lines persist, edited price kept)',
          names(after) == expected and by_name(after, 'Obat Fiktif')['harga'] == 1000 and by_name(after, 'Jasa Kasir Tambahan Fiktif')['id'] == str(r.uid('c', 41)) and 'Jasa Tambahan Fiktif' not in names(after), dict(rows_after=names(after)))
    check('DRAFT: the removed line is withdrawn (kept as evidence), not deleted; the audit row records before/after with the actor and reason',
          withdrawn(h, removed['id']) and edits(h, v) == 1 and h.nilai(f"select created_by||'|'||reason from clinic_pending_cart_edits where visit_id={q(v)}") == f'{r.STAFF}|Draft kasir Fiktif', {})
    check('DRAFT: result carries the NEW snapshot (the one a reload would compute) and the permit table is empty',
          res.get('snapshot') == after.get('snapshot') and res.get('visit_id') == v and res.get('record_id') == stay and permits(h) == 0, dict(result=res, reload=after.get('snapshot')))
    # D2. exact replay is idempotent
    e0 = edits(h, v)
    out2 = dn(h, draft(v, stay, cart['snapshot'], rows, 'cd-d1'), r.STAFF)
    check('DRAFT: exact replay (same key) returns the same result and writes nothing', out2 == out and edits(h, v) == e0 and names(read(h, v, stay)) == expected, dict(out2=out2[:200]))
    # D3. saving again with the loaded cart and a fresh key: no resurrection, no duplicate, no new audit row
    again = read(h, v, stay)
    out3 = h.gagal(draft(v, stay, again['snapshot'], again['rows'], 'cd-d3'), r.STAFF)
    check('DRAFT: a second draft of the reloaded cart (new key) is a no-op: removed line does not come back, nothing duplicated, no extra audit row',
          out3 is None and names(read(h, v, stay)) == expected and edits(h, v) == e0 and h.angka(f"select count(*) from prescription_items p join medical_records mr on mr.id=p.medical_record_id where mr.visit_id={q(v)} and p.billing_withdrawn_at is null") == len(expected), dict(error=(out3 or '')[:200]))
    # D4. the floor is NOT loosened: the draft holds the below-HPP price, the money step still refuses it, the draft survives that refusal
    err = h.gagal(save(v, stay, again['snapshot'], again['rows'], [dict(method='Tunai', amount=total(again['rows']))], 'cd-d4'), r.STAFF)
    check('P03 NOT loosened: money step on the drafted cart is still refused PRICE_BELOW_HPP, and the draft is still there afterwards',
          bool(err and 'PRICE_BELOW_HPP' in err) and names(read(h, v, stay)) == expected and invoices(h, v) == 0, dict(error=(err or '')[:160]))
    # D5. fix the price on the drafted cart, pay: the invoice has exactly the drafted lines, once
    fixed = json.loads(json.dumps(read(h, v, stay)['rows'])); next(rw for rw in fixed if rw['nama_obat'] == 'Obat Fiktif')['harga'] = 3000
    cur = read(h, v, stay)
    err = h.gagal(save(v, stay, cur['snapshot'], fixed, [dict(method='Tunai', amount=total(fixed))], 'cd-d5'), r.STAFF)
    lines = invoice_lines(h, v)
    check('draft then pay: invoice carries exactly the drafted cart (removed absent, added once, corrected price) and the cart is then empty',
          err is None and len(lines) == len(fixed) and not any('Jasa Tambahan Fiktif' in l for l in lines) and sum('Kasir Tambahan' in l for l in lines) == 2 and read(h, v, stay)['rows'] == [], dict(error=(err or '')[:160], lines=lines))

    # D6. rescue shape used by the server action: money step rejected, SAME snapshot/rows then saved as draft (rollback left snapshot valid)
    v, mr, stay, cart = fixture(h, 3320)
    rows = edit(cart, remove=['Jasa Tambahan Fiktif'], add=[row(r.uid('c', 51), 'Jasa Kasir Tambahan Fiktif', 1, 70000, JASA_NEW)], prices={'Obat Fiktif': 1000})
    err = h.gagal(save(v, stay, cart['snapshot'], rows, [dict(method='Tunai', amount=total(rows))], 'cd-r6'), r.STAFF)
    rescue = h.gagal(draft(v, stay, cart['snapshot'], rows, 'draft:cd-r6'), r.STAFF)
    after = read(h, v, stay)
    check('rescue after a rejected money step: the same snapshot and rows persist as draft; reload shows removal + added line',
          bool(err and 'PRICE_BELOW_HPP' in err) and rescue is None and names(after) == sorted(rw['nama_obat'] for rw in rows), dict(error=(err or '')[:100], rescue=(rescue or '')[:160], rows_after=names(after)))

    # D7. guards of the cart engine still apply to drafts
    v, mr, stay, cart = fixture(h, 3330); b = (edits(h, v), invoices(h, v))
    err = h.gagal(draft(v, stay, 'snapshot-lama', cart['rows'], 'cd-stale'), r.STAFF)
    check('stale snapshot refused CART_STALE, nothing written', bool(err and 'CART_STALE' in err) and edits(h, v) == b[0] and names(read(h, v, stay)) == names(cart), dict(error=(err or '')[:160]))
    err = h.gagal(draft(v, stay, cart['snapshot'], cart['rows'][:-1] + [row(r.uid('c', 61), 'Jasa Nonaktif Fiktif', 1, 1000, JASA_OFF)], 'cd-inactive'), r.STAFF)
    check('inactive master item refused CART_INVALID (same rule as the money save)', bool(err and 'CART_INVALID' in err) and names(read(h, v, stay)) == names(cart), dict(error=(err or '')[:160]))
    err = h.gagal(draft(v, stay, cart['snapshot'], cart['rows'], 'cd-noreason', ''), r.STAFF)
    check('reason is mandatory (3..1000 characters)', bool(err and 'CART_INVALID' in err), dict(error=(err or '')[:160]))
    err = h.gagal(draft(v, stay, cart['snapshot'], cart['rows'], 'k' * 75), r.STAFF)
    check('request key longer than 70 characters refused by the draft wrapper itself (the draft: prefix must fit the 80 character cashier key)', bool(err and 'kunci transaksi draft tidak valid' in err), dict(error=(err or '')[:160]))
    zero = json.loads(json.dumps(cart['rows'])); zero[0]['qty'] = 0
    err = h.gagal(draft(v, stay, cart['snapshot'], zero, 'cd-qty0'), r.STAFF)
    check('qty 0 refused CART_INVALID', bool(err and 'CART_INVALID' in err), dict(error=(err or '')[:160]))
    disc = json.loads(json.dumps(cart['rows'])); disc[0]['diskon_persen'] = 10
    err = h.gagal(draft(v, stay, cart['snapshot'], disc, 'cd-disc'), r.STAFF)
    check('stage discount refused CART_INVALID', bool(err and 'CART_INVALID' in err), dict(error=(err or '')[:160]))
    foreign_v, _, foreign_stay, foreign_cart = fixture(h, 3331)
    err = h.gagal(draft(v, stay, cart['snapshot'], cart['rows'] + [foreign_cart['rows'][0]], 'cd-foreign'), r.STAFF)
    check("another visit's pending row cannot be smuggled into this cart (CART_INVALID) and the other visit is untouched",
          bool(err and 'CART_INVALID' in err) and names(read(h, foreign_v, foreign_stay)) == names(foreign_cart), dict(error=(err or '')[:160]))
    # roles / branch / shift: no more permissive than the money save
    for who, label in [(r.DOCTOR, 'DOCTOR'), (r.FIN_NONAKTIF, 'inactive FINANCE'), (r.FIN_LUAR, 'FINANCE of another branch')]:
        c0 = edits(h, v)
        err = h.gagal(draft(v, stay, cart['snapshot'], cart['rows'][:-1], 'cd-deny-' + label.split()[0]), who)
        check(f'{label} cannot save a cart draft (ACCESS_DENIED / refused), nothing written', bool(err) and edits(h, v) == c0 and names(read(h, v, stay)) == names(cart), dict(error=(err or '')[:160]))
    for who, label in [(r.OWNER, 'OWNER'), (r.ADMIN, 'ADMIN'), (r.FINANCE, 'FINANCE')]:
        vv, _, ss, cc = fixture(h, {'OWNER': 3340, 'ADMIN': 3341, 'FINANCE': 3342}[label])
        err = h.gagal(draft(vv, ss, cc['snapshot'], cc['rows'][:-1], 'cd-ok-' + label), who)
        check(f'{label} can save a cart draft', err is None and len(read(h, vv, ss, who)['rows']) == len(cc['rows']) - 1, dict(error=(err or '')[:160]))
    h.sql(f"update public.cashier_shifts set status='closed' where opened_by={q(r.STAFF)};")
    err = h.gagal(draft(v, stay, cart['snapshot'], cart['rows'][:-1], 'cd-noshift'), r.STAFF)
    check('no open own shift: refused (same as the money save), nothing written', bool(err) and edits(h, v) == b[0], dict(error=(err or '')[:160]))
    h.sql(f"update public.cashier_shifts set status='open' where opened_by={q(r.STAFF)};")

    # D8. racikan / BMHP locks and the one-time permit
    ver = h.nilai('select id from compound_formula_versions limit 1')
    v, mr = m.visit(h, 3350); stay = stay_of(h, v)
    h.sql(x.issue(v, mr, x.payload(ver, 'cd-compound-3350')), r.DOCTOR)
    cart = read(h, v, stay); comp = next(rw for rw in cart['rows'] if rw.get('compound_recipe_id'))
    err = h.gagal(draft(v, stay, cart['snapshot'], [rw for rw in cart['rows'] if rw['id'] != comp['id']], 'cd-comp-remove'), r.STAFF)
    check('COMPOUND_LOCKED still applies: a draft cannot remove an official racikan row', bool(err and 'COMPOUND_LOCKED' in err) and comp['id'] in [rw['id'] for rw in read(h, v, stay)['rows']], dict(error=(err or '')[:160]))
    bumped = json.loads(json.dumps(cart['rows'])); next(rw for rw in bumped if rw['id'] == comp['id'])['qty'] = comp['qty'] + 1
    err = h.gagal(draft(v, stay, cart['snapshot'], bumped, 'cd-comp-qty'), r.STAFF)
    check('COMPOUND_LOCKED still applies: a draft cannot change racikan qty', bool(err and 'COMPOUND_LOCKED' in err), dict(error=(err or '')[:160]))
    priced = json.loads(json.dumps(cart['rows'])); next(rw for rw in priced if rw['id'] == comp['id'])['harga'] = comp['harga'] + 1000
    err = h.gagal(draft(v, stay, cart['snapshot'], priced, 'cd-comp-price'), r.STAFF)
    check('Owner-only racikan price rule still applies to drafts: STAFF cannot change racikan price', bool(err and 'ACCESS_DENIED' in err) and by_name(read(h, v, stay), comp['nama_obat'])['harga'] == comp['harga'], dict(error=(err or '')[:160]))
    # permit hygiene: a stray permit never turns an ordinary money save into a draft; clients cannot forge one
    vv, _, ss, cc = fixture(h, 3360)
    h.sql(f"insert into clinic_private.cart_draft_permits values(1,{q(r.STAFF)},{q(vv)});") if permits(h) == 0 and h.nilai("select to_regclass('clinic_private.cart_draft_permits') is not null") == 't' else None
    err = h.gagal(save(vv, ss, cc['snapshot'], cc['rows'], [dict(method='Tunai', amount=total(cc['rows']))], 'cd-stray'), r.STAFF)
    check('a leftover permit row of ANOTHER transaction does not turn an ordinary money save into a draft (invoice is issued)', err is None and invoices(h, vv) == 1, dict(error=(err or '')[:160]))
    h.sql("delete from clinic_private.cart_draft_permits;") if h.nilai("select to_regclass('clinic_private.cart_draft_permits') is not null") == 't' else None
    err = h.gagal(f"insert into clinic_private.cart_draft_permits values(txid_current(),{q(r.STAFF)},{q(vv)});", r.STAFF)
    check('an app role cannot forge a draft permit (no privilege on clinic_private)', bool(err), dict(error=(err or '')[:160]))
    # a permit written in the SAME transaction but for another actor / another visit must not turn the money save into a draft
    for label, actor, visit_for_permit, n in [('another ACTOR', r.ADMIN, None, 3361), ('another VISIT', r.STAFF, 'other', 3362)]:
        vv, _, ss, cc = fixture(h, n)
        pv = vv if visit_for_permit is None else r.uid('6', 999)
        tbl = h.nilai("select to_regclass('clinic_private.cart_draft_permits') is not null") == 't'
        script = ('begin;' + (f"insert into clinic_private.cart_draft_permits values(txid_current(),{q(actor)},{q(pv)});" if tbl else '')
                  + x.claims(r.STAFF)
                  + save(vv, ss, cc['snapshot'], cc['rows'], [dict(method='Tunai', amount=total(cc['rows']))], 'cd-perm-' + str(n)) + 'commit;')
        err = h.gagal(script)
        check(f'permit of the same transaction but for {label} does not turn the money save into a draft (invoice issued)', tbl and err is None and invoices(h, vv) == 1, dict(error=(err or '')[:160]))
    # draft key namespace: the SAME request key used for a draft and then for the money save must not collide
    vv, _, ss, cc = fixture(h, 3363)
    out = dn(h, draft(vv, ss, cc['snapshot'], cc['rows'][:-1], 'cd-same-key'), r.STAFF)
    cur = read(h, vv, ss, r.STAFF)
    err = h.gagal(save(vv, ss, cur['snapshot'], cur['rows'], [dict(method='Tunai', amount=total(cur['rows']))], 'cd-same-key'), r.STAFF)
    check('the same request key for a draft and for the money save does not collide (draft keys live under "draft:")', out.startswith('{') and err is None and invoices(h, vv) == 1, dict(out=out[:120], error=(err or '')[:160]))
    check('draft function is not callable by anon/public (grant only to authenticated)',
          h.nilai("select coalesce(bool_or(has_function_privilege(rl,'public.clinic_save_inpatient_cart_draft(uuid,uuid,text,text,jsonb,text)','execute')),false) from unnest(array['anon','public','service_role']) rl") == 'f' if fn else False, {})
    check('draft function is callable by authenticated (the app role)', fn and h.nilai("select has_function_privilege('authenticated','public.clinic_save_inpatient_cart_draft(uuid,uuid,text,text,jsonb,text)','execute')") == 't', {})


def main():
    p = argparse.ArgumentParser(); p.add_argument('--baseline', action='store_true'); p.add_argument('--mutations', action='store_true'); p.add_argument('--only', default=''); p.add_argument('--json', type=Path, required=True)
    p.add_argument('--pg-bin', default=None); a = p.parse_args()
    if a.mutations: return mutations(a)
    sources = sorted(MIG.glob('*.sql')); selected = [s for s in sources if not (a.baseline and s.name == CANDIDATE)]
    try:
        with tempfile.TemporaryDirectory(prefix='chain.', dir=ROOT) as d:
            target = Path(d) / 'supabase/migrations'; target.mkdir(parents=True)
            for s in selected: (target / s.name).symlink_to(s)
            r.fixture.ROOT = Path(d)
            with r.NativePostgres(r.BIN) as db: r.fixture.DisposablePostgres.bootstrap(db); run(x.Harness(db))
    except Exception as e: check('HARNESS', False, str(e))
    totals = {s: sum(c['status'] == s for c in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='RED' if a.baseline else 'candidate', migration_count=len(selected), cases=RESULTS, totals=totals), indent=2, default=str)); print(totals)
    return int(totals['FAIL'] > 0)


MUTANTS = [
 ('M01 permit not bound to the current transaction (stray permit turns a money save into a draft)', 'where transaction_id=txid_current() and actor=auth.uid() and visit_id=p_visit_id)then', 'where actor=auth.uid() and visit_id=p_visit_id)then'),
 ('M02 permit not bound to the actor', 'where transaction_id=txid_current() and actor=auth.uid() and visit_id=p_visit_id)then', 'where transaction_id=txid_current() and visit_id=p_visit_id)then'),
 ('M03 permit not bound to the visit', 'where transaction_id=txid_current() and actor=auth.uid() and visit_id=p_visit_id)then', 'where transaction_id=txid_current() and actor=auth.uid())then'),
 ('M04 wrapper keeps the permit after returning', '  delete from clinic_private.cart_draft_permits where transaction_id = txid_current();\n', '  -- permit kept\n'),
 ('M05 wrapper never writes the permit (draft would bill and pay)', '  insert into clinic_private.cart_draft_permits values(txid_current(), auth.uid(), p_visit_id);\n', '  -- no permit\n'),
 ('M06 draft result returns the OLD snapshot (before rows)', 'clinic_private.inpatient_cashier_snapshot(after_rows,', 'clinic_private.inpatient_cashier_snapshot(before_rows,'),
 ('M07 draft shares the money save request key namespace', "'draft:'||p_request_key", 'p_request_key'),
 ('M08 key length limit raised so the prefixed key overflows (second guard hides it)', 'length(p_request_key) > 70', 'length(p_request_key) > 200'),
 ('M09 DOCTOR admitted to the draft', "role in ('OWNER','ADMIN','FINANCE','STAFF')) then", "role in ('OWNER','ADMIN','FINANCE','STAFF','DOCTOR')) then"),
 ('M10 role gate dropped from the wrapper (token kept)', "not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN','FINANCE','STAFF')) then", "not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN','FINANCE','STAFF')) and false then"),
 ('M11 draft grant also given to anon', 'grant execute on function public.clinic_save_inpatient_cart_draft(uuid,uuid,text,text,jsonb,text) to authenticated;', 'grant execute on function public.clinic_save_inpatient_cart_draft(uuid,uuid,text,text,jsonb,text) to authenticated, anon;'),
 ('M12 draft branch never taken (draft bills like before)', 'if exists(select 1 from clinic_private.cart_draft_permits', 'if false and exists(select 1 from clinic_private.cart_draft_permits'),
 ('M13 ordinary save never bills (else branch replaced by a fake draft result)', "  else\n   result:=public.clinic_bill_and_pay_inpatient(", "  else\n   result:=jsonb_build_object(''status'',''DRAFT_SAVED'',''visit_id'',p_visit_id,''record_id'',p_record_id); -- public.clinic_bill_and_pay_inpatient("),
 ('M14 wrapper ignores the posted rows (empty cart saved)', "p_snapshot, p_rows, '[]'::jsonb, null,", "p_snapshot, '[]'::jsonb, '[]'::jsonb, null,"),
 ('M15 wrapper replaces the cashier reason with a constant', "'[]'::jsonb, null, false, null, p_reason);", "'[]'::jsonb, null, false, null, 'draft');"),
]


def mutations(a):
    base = (MIG / CANDIDATE).read_text(); only = [t for t in a.only.split(',') if t]; out = []
    selected = [s for s in sorted(MIG.glob('*.sql')) if s.name != CANDIDATE]
    with tempfile.TemporaryDirectory(prefix='chain.', dir=ROOT) as d:
        target = Path(d) / 'supabase/migrations'; target.mkdir(parents=True)
        for s in selected: (target / s.name).symlink_to(s)
        r.fixture.ROOT = Path(d)
        with r.NativePostgres(r.BIN) as db:
            r.fixture.DisposablePostgres.bootstrap(db); h = x.Harness(db); x.setup(h)
            variants = [('CONTROL (unmodified candidate)', None, None)] + [mu for mu in MUTANTS if not only or any(mu[0].startswith(t) for t in only)]
            for i, (name, old, new) in enumerate(variants):
                text = base
                if old is not None:
                    assert base.count(old) == 1, f'stale mutation anchor ({name}): {base.count(old)} occurrences'
                    text = base.replace(old, new)
                dbn = f'v_{i}'; os.environ.pop('PGDATABASE', None); db.sql(f'create database {dbn} template postgres;')
                os.environ['PGDATABASE'] = dbn; RESULTS.clear(); crash = None; applied = True
                try:
                    db.sql('begin;' + text + '\ncommit;')
                except RuntimeError as e:
                    applied = False; crash = 'APPLY: ' + str(e)[:200]
                if applied:
                    try: run(x.Harness(db), setup=False)
                    except Exception as e: crash = 'CRASH: ' + str(e)[:200]
                fails = [c['case'] for c in RESULTS if c['status'] == 'FAIL']
                verdict = ('CONTROL-OK' if not fails and not crash else 'CONTROL-BAD') if old is None else ('KILLED' if fails else 'SURVIVED')
                out.append(dict(variant=name, verdict=verdict, fail_cases=fails[:6], n_fail=len(fails), pass_cases=sum(c['status'] == 'PASS' for c in RESULTS), crash=crash))
                print(verdict, name, 'fails=', len(fails), (crash or '')[:120], flush=True)
                os.environ.pop('PGDATABASE', None)
    killed = sum(o['verdict'] == 'KILLED' for o in out); mutants = len(out) - 1
    a.json.write_text(json.dumps(dict(mode='mutations', control=out[0], mutants=out, killed=killed, total_mutants=mutants), indent=2, default=str)); print(dict(killed=killed, mutants=mutants))
    return int(out[0]['verdict'] != 'CONTROL-OK' or killed != mutants)


if __name__ == '__main__': sys.exit(main())
