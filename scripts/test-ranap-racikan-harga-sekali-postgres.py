#!/usr/bin/env python3
"""F8: one-time owner SQL that unlocks a ranap racikan whose saved price fell below its FIFO cost (P03 deadlock).

Native full schema, fictional fixtures, throwaway local cluster, no network. The SQL under test is the file the Owner pastes
into the Supabase SQL editor (docs/evidence/ranap-racikan-harga-sekali.sql, identical to /opt/data/kamo-cost-missing-evidence/ranap-racikan-harga-sekali.sql); only the visit id / branch / row id literals differ.

  python3 -I scripts/test-ranap-racikan-harga-sekali-postgres.py --json out.json   (wrap in flock /opt/data/kamo-heavy-test.lock)
  --prod-chain   chain WITHOUT 20261106860000/870000 = the production state F8 is pasted into (RED-b then expects COMPOUND_LOCKED)
  --sql FILE     test another copy of the SQL (RED baseline: the pre-review file)
  --mutations    mutants of the SQL text (function, preview, post-check); every one must be killed
RED = the deadlock itself (cart refuses P03 and COMPOUND_LOCKED); GREEN = after the one-off SQL the cashier saves and posts.
The test runs the file's REAL text: Part 2 and Part 3 with only the typed values replaced (one line per argument), so the
call block, the guard parameters and the post-check query that the Owner pastes are what is exercised.
"""
import argparse, importlib.util, json, math, os, re, sys, tempfile
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('medical', ROOT / 'scripts/test-rekam-full-edit-postgres.py'); assert spec and spec.loader
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
x, r, q, j = m.x, m.r, m.q, m.j
SQL_FILE = ROOT / 'docs/evidence/ranap-racikan-harga-sekali.sql'   # committed copy; /opt/data/kamo-cost-missing-evidence/ holds the identical file the Owner receives
RESULTS = []
OFF = 0
MUTANT = None   # (old, new) text replacement applied to the SQL file text
PROD_CHAIN = False
VISIT_LITERAL = 'b1770b4b-f21a-4313-ad75-488288de2f76'
CALL_RE = re.compile(r"select jsonb_pretty\(pg_temp\.f8_apply\(\n(.*?)\n\)\) as hasil;", re.S)


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:500], flush=True)


def file_text():
    text = SQL_FILE.read_text()
    if MUTANT:
        assert text.count(MUTANT[0]) == 1, MUTANT[0]
        text = text.replace(MUTANT[0], MUTANT[1])
    return text


def section(text, n):
    pieces = re.split(r'(?m)^-- BAGIAN (\d) --.*$', text)
    found = {int(pieces[i]): pieces[i + 1] for i in range(1, len(pieces) - 1, 2)}
    return found[n]


def code_only(text):
    return '\n'.join(l for l in text.splitlines() if l.strip() and not l.strip().startswith('--'))


def lit(value, kind=None):
    if value is None: return 'null'
    return q(value) + '::uuid' if kind == 'uuid' else q(value) if kind == 'text' else str(value)


def call(h, visit, branch, row, new, actor='owner', reason='Racikan: HPP naik di atas harga tersimpan; harga dinaikkan', name='auto', old='auto'):
    """The Owner's PART 2 = the file's real text with only the typed values replaced (one argument per line)."""
    text = section(file_text(), 2)
    mt = CALL_RE.search(text); assert mt, 'call block not found'
    lines = mt.group(1).split('\n')
    if name == 'auto': name = h.nilai(f'select nama_obat from prescription_items where id={q(row)}') if row and len(row) == 36 else None
    if old == 'auto': old = h.nilai(f'select harga from prescription_items where id={q(row)}') if row and len(row) == 36 else None
    if actor == 'owner': actor = r.OWNER
    vals = dict(visit=lit(visit, 'uuid'), branch=lit(branch, 'text'), name=lit(name or None, 'text') if name != '' else "''", old=lit(old or None),
                row=lit(row, 'uuid'), new=lit(new), actor=lit(actor, 'uuid'), reason=lit(reason, 'text'))
    names = ['visit', 'branch', 'row', 'new', 'actor', 'reason'] if len(lines) == 6 else ['visit', 'branch', 'name', 'old', 'row', 'new', 'actor', 'reason']
    assert len(lines) == len(names), ('call block has', len(lines), 'argument lines')
    return text[:mt.start(1)] + ',\n'.join(vals[n] for n in names) + text[mt.end(1):]


def preview(h, visit):
    out = h.sql(section(file_text(), 1).replace(VISIT_LITERAL, visit))
    return json.loads(out[out.index('{'):])


def postcheck(h, row, new_price):
    text = section(file_text(), 3)
    assert text.count('as row_id') == 1 and text.count('as harga_baru') == 1, 'post-check placeholders'
    text = re.sub(r"'[0-9a-f-]{36}'::uuid as row_id", f"{q(row)}::uuid as row_id", text)
    text = re.sub(r"(?:null|[0-9.]+)::numeric as harga_baru", f"{lit(new_price)}::numeric as harga_baru", text)
    out = h.sql(text)
    return json.loads(out[out.index('{'):])


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


def name_of(h, rid): return h.nilai(f'select nama_obat from prescription_items where id={q(rid)}')
def rename(h, rid, name):
    h.sql("begin;alter table public.prescription_items disable trigger official_prescription_snapshot;"
          f"update public.prescription_items set nama_obat={q(name)} where id={q(rid)};"
          "set constraints all immediate;alter table public.prescription_items enable trigger official_prescription_snapshot;commit;")
def qty_of(h, rid): return float(h.nilai(f'select qty from prescription_items where id={q(rid)}'))
def limits(h, rid, hpp):
    """The Owner-visible rule: min = ceil(HPP per qty), max = max(2 x old price, 1.5 x min)."""
    mn = math.ceil(hpp / max(qty_of(h, rid), 1)); return mn, max(2 * harga_of(h, rid), mn * 1.5)
def ok_json(out): return json.loads(out[out.index('{'):])


def run(h, setup=True):
    if setup: x.setup(h)
    BR = h.nilai(f'select code from branches where id={q(r.BRANCH)}')
    T = file_text()
    # ---------------------------------------------------------------- the file the Owner reads: CARA PAKAI, parts, read-only parts
    head = T[:T.index('-- BAGIAN 1 --')] if '-- BAGIAN 1 --' in T else T
    check('file: plain CARA PAKAI with steps K1-K7 at the top (preview first, three values, once, lone rollback, quiet visit, post-checks)',
          'CARA PAKAI' in head and all(f'K{i}.' in head for i in range(1, 8)) and 'rollback;' in head and 'tgenabled' in head
          and 'official_prescription_snapshot' in head, dict(has=[f'K{i}' for i in range(1, 8) if f'K{i}.' in head]))
    check('file: header states the rule (>= ceil(HPP), <= max(2x harga lama, 1,5x minimum)) and that the Owner profile id is TYPED, not authenticated',
          '2x harga lama' in head and '1,5x' in head and 'DIKETIK' in head and 'bukan autentikasi' in head, dict())
    def has(n):
        try: return bool(section(T, n).strip())
        except KeyError: return False
    parts_ok, has3 = has(1) and has(2), has(3)
    check('file: BAGIAN 1 (preview), BAGIAN 2 (change) and BAGIAN 3 (post-check) exist', parts_ok and has3, dict(p1=has(1), p2=has(2), p3=has3))
    if parts_ok:
        ro = lambda n: not re.search(r'(?i)\b(insert|update|delete|alter|create|drop|truncate)\b', code_only(section(T, n)))
        check('file: BAGIAN 1 and BAGIAN 3 are read-only (no insert/update/delete/alter/create)', ro(1) and has3 and ro(3), dict(p1=ro(1), p3=ro(3) if has3 else None))
        check('file: BAGIAN 2 has no begin/commit of its own (a failed paste cannot leave the editor session aborted)',
              not re.search(r'(?im)^\s*(begin|commit)\s*;', code_only(section(T, 2))), dict())
    # ---------------------------------------------------------------- RED: the deadlock
    v, mr, stay, cart, comp, hpp = racikan_visit(h, 2401)
    official = h.nilai(f"select exists(select 1 from compound_official_usage where recipe_id={q(comp['compound_recipe_id'])})") == 't'
    check('fixture: official racikan priced below its FIFO cost', official and comp['harga'] < hpp, dict(harga=comp['harga'], hpp=hpp, official=official))
    err = h.gagal(save(v, stay, cart['snapshot'], cart['rows'], [dict(method='Tunai', amount=total(cart))], f'f8-red-a-{OFF}'), r.STAFF)
    check('RED-a: the cashier cannot post (P03 floor names the racikan row)', bool(err and 'PRICE_BELOW_HPP' in err) and invoices(h, v) == 0, dict(error=(err or '')[:300]))
    rows = json.loads(json.dumps(cart['rows'])); next(rw for rw in rows if rw['id'] == comp['id'])['harga'] = round(hpp) + 500
    err = h.gagal(save(v, stay, cart['snapshot'], rows, [dict(method='Tunai', amount=total(cart))], f'f8-red-b-{OFF}'), r.STAFF)
    if PROD_CHAIN:   # production state: F7 (870000) is not applied, the price is locked
        check('RED-b: the cashier cannot raise the racikan price (COMPOUND_LOCKED, production chain) -> deadlock', bool(err and 'COMPOUND_LOCKED' in err) and harga_of(h, comp['id']) == comp['harga'], dict(error=(err or '')[:200]))
    else:            # branch chain: migration 870000 makes the price Owner-only, STAFF is refused at the role check
        check('RED-b: STAFF cannot raise the racikan price (ACCESS_DENIED: hanya Owner yang boleh mengubah harga racikan, F7 chain)',
              bool(err and 'ACCESS_DENIED: hanya Owner yang boleh mengubah harga racikan' in err) and 'COMPOUND_LOCKED' not in err and harga_of(h, comp['id']) == comp['harga'], dict(error=(err or '')[:200]))
    err = h.gagal(f"begin;{x.claims(r.OWNER)}update prescription_items set harga={round(hpp)+500} where id={q(comp['id'])};commit;")
    check('RED-c: a plain UPDATE of the official racikan row is refused even for the owner session (guard_full_record_prescription / official snapshot)', bool(err and ('RECIPE_LINKED' in err or 'ACCESS_DENIED' in err)) and harga_of(h, comp['id']) == comp['harga'], dict(error=(err or '')[:200]))
    if not parts_ok:
        check('RED: the pre-review SQL has no parts/guards to exercise; remaining cases are not run', False, dict()); return

    # ---------------------------------------------------------------- BAGIAN 1 preview
    v7, mr7, stay7, cart7, comp7, hpp7 = racikan_visit(h, 2407)
    pv = preview(h, v7)
    pv.setdefault('baris_keranjang', [])
    rows7 = {rw['id']: rw for rw in pv['baris_keranjang']}
    rk = rows7[comp7['id']]; other = [rw for rw in pv['baris_keranjang'] if not rw['compound_recipe_id']]
    mn7, mx7 = limits(h, comp7['id'], hpp7)
    check('preview: saran_harga_baru of a racikan row = ceil(HPP) rounded up to the next 500 (no 10x, no cap mixing)',
          float(rk['saran_harga_baru']) == math.ceil(mn7 / 500) * 500 and float(rk['saran_harga_baru']) >= hpp7, dict(saran=rk['saran_harga_baru'], hpp=hpp7))
    check('preview: saran_harga_baru of a NON-racikan row is NULL (never harga x 10)', bool(other) and all(rw['saran_harga_baru'] is None for rw in other), dict(rows=[(rw['nama'], rw['saran_harga_baru']) for rw in other]))
    check('preview: shows what to paste as the guard values (nama + harga lama) and the allowed price window',
          rk.get('nama_yang_diharapkan') == name_of(h, comp7['id']) and float(rk.get('harga_lama_yang_diharapkan')) == comp7['harga']
          and float(rk.get('harga_baru_minimum')) == mn7 and float(rk.get('harga_baru_maksimum')) == mx7, dict(rk={k: rk.get(k) for k in ('nama_yang_diharapkan', 'harga_lama_yang_diharapkan', 'harga_baru_minimum', 'harga_baru_maksimum')}, want=(mn7, mx7)))
    cs = pv.get('cek_sistem') or {}
    check('preview: shows current_user, owner of prescription_items and the state of trigger official_prescription_snapshot',
          cs.get('trigger_official_prescription_snapshot') == 'O' and bool(cs.get('current_user')) and bool(cs.get('pemilik_tabel_prescription_items')), dict(cs=cs))

    # ---------------------------------------------------------------- negatives (every one leaves harga/audit untouched)
    base = harga_of(h, comp['id']); a0 = audits(h, v)
    def refused(name, sql, needle, rid=comp['id']):
        err = h.gagal(sql)
        check('NEG ' + name, bool(err and needle in err) and harga_of(h, rid) == (base if rid == comp['id'] else harga_of(h, rid)) and audits(h, v) == a0 and trig_on(h), dict(error=(err or '')[:260]))
    v2, mr2, stay2, cart2, comp2, hpp2 = racikan_visit(h, 2402)
    refused('wrong visit (row belongs to another visit)', call(h, v, BR, comp2['id'], round(hpp) + 500), 'tidak ada di kunjungan ini')
    refused('wrong branch code', call(h, v, 'BUKAN_CABANG', comp['id'], round(hpp) + 500), 'cabang kunjungan')
    refused('price below HPP (floor intact)', call(h, v, BR, comp['id'], round(hpp) - 1), 'di bawah HPP')
    refused('price equal to HPP minus a rupiah fraction still below', call(h, v, BR, comp['id'], hpp - 0.01), 'di bawah HPP')
    mn, mx = limits(h, comp['id'], hpp)
    refused('typo: nine times the right price (e.g. 450500 instead of 50500) is above the cap', call(h, v, BR, comp['id'], (math.ceil(mn / 500) * 500) * 9), 'melebihi batas')
    refused('price one cent above the cap max(2 x old price, 1.5 x ceil(HPP))', call(h, v, BR, comp['id'], mx + 0.01), 'melebihi batas')
    refused('price with more than two decimals', call(h, v, BR, comp['id'], math.ceil(mn / 500) * 500 + 0.005), 'dua desimal')
    refused('unchanged price', call(h, v, BR, comp['id'], comp['harga']), 'tidak ada perubahan')
    refused('reason too short', call(h, v, BR, comp['id'], round(hpp) + 500, reason='  ab  '), 'alasan wajib')
    refused('actor is not an Owner (STAFF profile)', call(h, v, BR, comp['id'], round(hpp) + 500, actor=r.STAFF), 'bukan Owner')
    refused('Owner profile id missing (typed id and reason are required, no "the only Owner" shortcut)', call(h, v, BR, comp['id'], round(hpp) + 500, actor=None), 'id profil Owner (wajib)')
    refused('Owner profile id of an unknown profile', call(h, v, BR, comp['id'], round(hpp) + 500, actor=r.uid('e', 4242)), 'bukan Owner')
    refused('plain non-racikan row', call(h, v, BR, next(rw['id'] for rw in cart['rows'] if not rw.get('compound_recipe_id')), 100), 'bukan racikan')
    refused('unknown row', call(h, v, BR, r.uid('e', 999), round(hpp) + 500, name='X', old=1), 'tidak ada di kunjungan ini')
    refused('guard values missing: expected name NULL', call(h, v, BR, comp['id'], round(hpp) + 500, name=None), 'nama racikan dan harga lama yang diharapkan')
    refused('guard values missing: expected name empty', call(h, v, BR, comp['id'], round(hpp) + 500, name=''), 'nama racikan dan harga lama yang diharapkan')
    refused('guard values missing: expected old price NULL', call(h, v, BR, comp['id'], round(hpp) + 500, old=None), 'nama racikan dan harga lama yang diharapkan')
    refused('price left empty (NULL): must be typed', call(h, v, BR, comp['id'], None), 'harga baru')
    refused('wrong expected OLD price (right row, right name) is refused: compare-and-swap',
            call(h, v, BR, comp['id'], round(hpp) + 500, old=comp['harga'] + 1), 'tidak sama dengan harga lama yang diharapkan')
    refused('wrong expected NAME (right row, right old price) is refused: compare-and-swap',
            call(h, v, BR, comp['id'], round(hpp) + 500, name='Obat Racik Lain'), 'tidak sama dengan nama yang diharapkan')
    # two racikan with the same name in one visit -> ambiguous, refused
    ver = h.nilai('select id from compound_formula_versions limit 1')
    h.sql(x.issue(v2, mr2, x.payload(ver, f'f8-compound-2402-b-{OFF}')), r.DOCTOR)
    err = h.gagal(call(h, v2, BR, comp2['id'], round(hpp2) + 500))
    check('NEG two racikan rows with the same name in the visit -> refused (exactly one row required)', bool(err and 'harus tepat satu' in err) and harga_of(h, comp2['id']) == comp2['harga'] and trig_on(h), dict(error=(err or '')[:220]))

    # WRONG-ROW PASTE: two racikan in one visit with different names and the SAME old price; the Owner pastes the id of the OTHER one
    v8, mr8, stay8, cart8, comp8, hpp8 = racikan_visit(h, 2408)
    h.sql(x.issue(v8, mr8, x.payload(ver, f'f8-compound-2408-b-{OFF}')), r.DOCTOR)
    cart8 = read(h, v8, stay8); wrong = next(rw for rw in cart8['rows'] if rw.get('compound_recipe_id') and rw['id'] != comp8['id'])
    plant(h, wrong['id'], comp8['harga']); rename(h, wrong['id'], 'Obat Racik Lain Fiktif')
    mn8, mx8 = limits(h, comp8['id'], hpp8)
    good_name, good_old = name_of(h, comp8['id']), comp8['harga']
    w_before = harga_of(h, wrong['id']); i_before = harga_of(h, comp8['id'])
    err = h.gagal(call(h, v8, BR, wrong['id'], math.ceil(mn8 / 500) * 500, name=good_name, old=good_old))
    check('NEG wrong-row paste: id of the OTHER racikan in the same visit (same old price, within the cap) is refused by the name guard; neither row changes',
          bool(err and 'tidak sama dengan nama yang diharapkan' in err) and harga_of(h, wrong['id']) == w_before and harga_of(h, comp8['id']) == i_before and audits(h, v8) == 0 and trig_on(h), dict(error=(err or '')[:260], wrong_before=w_before, intended=i_before))

    # FRACTIONAL HPP: a price above HPP but below ceil(HPP per qty) is refused (the stated rule is ceil), ceil itself is accepted
    vf, mrf, stayf, cartf, compf, hppf = racikan_visit(h, 2410)
    h.sql(f"set session_replication_role = replica; update compound_issues set unit_cost = unit_cost + 0.40 where recipe_id={q(compf['compound_recipe_id'])};")
    hppf = hpp_of(h, compf['id']); mnf = math.ceil(hppf / max(qty_of(h, compf['id']), 1)); frac_price = round(hppf + 0.05, 2)
    err = h.gagal(call(h, vf, BR, compf['id'], frac_price))
    refused_frac = bool(err and 'di bawah harga minimum' in err) and harga_of(h, compf['id']) == compf['harga'] and mnf > frac_price
    h.sql(call(h, vf, BR, compf['id'], mnf))
    check('NEG fractional HPP: price above HPP but below ceil(HPP) is refused as below the minimum; ceil(HPP) itself is accepted',
          refused_frac and harga_of(h, compf['id']) == mnf, dict(hpp=hppf, frac_price=frac_price, minimum=mnf, error=(err or '')[:200]))

    # a row the cashier already withdrew from the bill is refused (planted by hand: the cashier RPC is what normally sets it)
    v6, mr6, stay6, cart6, comp6, hpp6 = racikan_visit(h, 2406)
    h.sql("begin;alter table public.prescription_items disable trigger official_prescription_snapshot;"
          f"update prescription_items set billing_withdrawn_at=now(),billing_withdrawn_by={q(r.STAFF)},billing_withdrawal_reason='ditarik uji' where id={q(comp6['id'])};"
          "set constraints all immediate;alter table public.prescription_items enable trigger official_prescription_snapshot;commit;")
    err = h.gagal(call(h, v6, BR, comp6['id'], round(hpp6) + 500, actor=r.OWNER))
    check('NEG withdrawn (billing_withdrawn_at) racikan row is refused', bool(err and 'sudah ditarik' in err), dict(error=(err or '')[:200]))
    # trigger not in its normal state ('A' = always): refused, nothing changed, the state is left as found
    v9, mr9, stay9, cart9, comp9, hpp9 = racikan_visit(h, 2409)
    h.sql('alter table public.prescription_items enable always trigger official_prescription_snapshot;')
    err = h.gagal(call(h, v9, BR, comp9['id'], round(hpp9) + 500))
    st = h.nilai("select tgenabled from pg_trigger where tgrelid='public.prescription_items'::regclass and tgname='official_prescription_snapshot'")
    h.sql('alter table public.prescription_items enable trigger official_prescription_snapshot;')
    check('NEG trigger official_prescription_snapshot not in its normal state (always): refused, nothing changed, state left as found',
          bool(err and 'tidak dalam keadaan normal' in err) and st == 'A' and harga_of(h, comp9['id']) == comp9['harga'], dict(error=(err or '')[:200], state=st))

    # ---------------------------------------------------------------- GREEN
    new_price = int(-(-hpp // 500) * 500) if hpp % 500 else int(hpp) + 500
    out = ok_json(h.sql(call(h, v, BR, comp['id'], new_price, actor=r.OWNER)))
    st = h.nilai(f"select harga from prescription_items where id={q(comp['id'])}")
    check('GREEN: valid one-off changes ONLY the price, official trigger is enabled again, audit row written',
          float(st) == new_price and trig_on(h) and audits(h, v) == a0 + 1 and 'racikan_resmi_trigger_ditangani' in out, dict(harga=st, out=str(out)[:200]))
    aud = json.loads(h.nilai(f"select to_jsonb(e) from clinic_pending_cart_edits e where e.visit_id={q(v)} and e.request_key like 'f8-racikan-harga-sekali:%' limit 1"))
    check('GREEN: audit row records who (typed Owner profile), why, executing DB session and before/after price',
          aud['created_by'] == r.OWNER and 'Ubah harga racikan sekali jalan' in aud['reason'] and 'HPP naik' in aud['reason'] and 'sesi DB' in aud['reason']
          and float(aud['before_rows'][0]['harga']) == comp['harga'] and float(aud['after_rows'][0]['harga']) == new_price, dict(created_by=aud['created_by'], reason=aud['reason'][:260]))
    # SECOND RUN: the same pasted values (old price no longer matches) and even a different price are refused; no second audit row
    refused_after = []
    for again in (new_price, new_price + 500):
        e2 = h.gagal(call(h, v, BR, comp['id'], again, name=name_of(h, comp['id']), old=comp['harga']))
        refused_after.append(bool(e2 and 'tidak sama dengan harga lama yang diharapkan' in e2))
    check('second run with the same pasted values is impossible (old price no longer matches), also with another price; no second audit row',
          all(refused_after) and audits(h, v) == a0 + 1 and float(h.nilai(f"select harga from prescription_items where id={q(comp['id'])}")) == new_price, dict(refused=refused_after))
    # BAGIAN 3 post-check
    if not has3:
        check('post-check (BAGIAN 3) is missing: none of the post-check cases can run', False, dict())
        pc = pc_wrong = pc_before = pc_trig = pc_dup = {}
    else:
      pc = postcheck(h, comp['id'], new_price)
      check('post-check (BAGIAN 3) passes after the change: price, exactly one audit row, trigger O, master price', pc.get('SEMUA_LULUS') is True, pc)
      pc_wrong = postcheck(h, comp['id'], new_price + 500)
      pc_before = postcheck(h, comp7['id'], math.ceil(mn7 / 500) * 500)
      check('post-check fails when the typed price differs from the stored price, and before the change (no audit row)', pc_wrong.get('SEMUA_LULUS') is False and pc_before.get('SEMUA_LULUS') is False, dict(wrong=pc_wrong.get('SEMUA_LULUS'), before=pc_before.get('SEMUA_LULUS')))
      h.sql('alter table public.prescription_items disable trigger official_prescription_snapshot;')
      pc_trig = postcheck(h, comp['id'], new_price)
      h.sql('alter table public.prescription_items enable trigger official_prescription_snapshot;')
      check('post-check fails when the official trigger is not enabled (tgenabled <> O)', pc_trig.get('SEMUA_LULUS') is False, pc_trig)
      h.sql(f"insert into clinic_pending_cart_edits(visit_id, created_by, reason, before_rows, after_rows, request_key) values({q(v)},{q(r.OWNER)},'duplikat uji','[]','[]','f8-racikan-harga-sekali:{comp['id']}:dup');")
      pc_dup = postcheck(h, comp['id'], new_price)
      check('post-check fails when there is more than one audit row for the row', pc_dup.get('SEMUA_LULUS') is False, pc_dup)
    cart = read(h, v, stay); comp = next(row for row in cart['rows'] if row.get('compound_recipe_id'))
    check('cart re-read shows the new racikan price and a fresh snapshot', comp['harga'] == new_price, dict(harga=comp['harga']))
    snap = h.nilai(f"select sale_price from clinic_compound_sales where recipe_id={q(comp['compound_recipe_id'])}")
    check('GREEN: master-compound sale snapshot moved with the row (MASTER_COMPOUND_SNAPSHOT would refuse otherwise)', float(snap) == new_price, dict(sale_price=snap))
    err = h.gagal(save(v, stay, cart['snapshot'], cart['rows'], [dict(method='Tunai', amount=total(cart))], f'f8-green-pay-{OFF}'), r.STAFF)
    line = h.nilai(f"select harga||'|'||hpp from invoice_items where compound_recipe_id={q(comp['compound_recipe_id'])}") if not err else None
    check('GREEN: cashier saves and posts; racikan line at the new price with unchanged FIFO cost (floor intact)',
          not err and line is not None and float(line.split('|')[0]) == new_price and float(line.split('|')[1]) == hpp, dict(error=(err or '')[:300], line=line))
    err = h.gagal(call(h, v, BR, comp['id'], new_price + 500, actor=r.OWNER))
    check('NEG already invoiced -> refused', bool(err and 'sudah masuk invoice' in err), dict(error=(err or '')[:200]))
    # the price exactly AT the cap is accepted (the cap is not stricter than stated)
    p_cap = mx8
    h.sql(call(h, v8, BR, comp8['id'], p_cap, actor=r.OWNER))
    check('GREEN: a price exactly at max(2 x old price, 1.5 x ceil(HPP)) is accepted (and only the intended row moved)',
          harga_of(h, comp8['id']) == p_cap and harga_of(h, wrong['id']) == w_before and audits(h, v8) == 1, dict(price=p_cap, intended=harga_of(h, comp8['id']), wrong=harga_of(h, wrong['id'])))
    # a second run on a fresh visit with the same numbers: replay is impossible once the old price changed
    v3, mr3, stay3, cart3, comp3, hpp3 = racikan_visit(h, 2403)
    first = call(h, v3, BR, comp3['id'], int(hpp3) + 500, actor=r.OWNER)
    h.sql(first)
    err = h.gagal(first)   # the identical paste, old price/name pinned to the values BEFORE the change
    check('replay of the identical paste is refused (pinned old price no longer matches) and writes no second audit row', bool(err and 'tidak sama dengan harga lama yang diharapkan' in err) and audits(h, v3) == 1, dict(error=(err or '')[:200]))
    # the price must still clear the floor at posting
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
            out = h.sql(call(h, v5, BR, comp5['id'], int(hpp5) + 500, actor=r.OWNER))
            check('non-official racikan: updated without touching any trigger', '"racikan_resmi_trigger_ditangani": false' in out and trig_on(h), dict(out=out[:160]))
        else:
            check('non-official racikan fixture is official (skipped)', True, dict(skipped=True))
    except RuntimeError as e:
        check('non-official racikan fixture', False, str(e)[:300])


MUTANTS = [
    ('F8-M1 sale snapshot not moved', "    update public.clinic_compound_sales set sale_price = p_new where recipe_id = v_row.compound_recipe_id;", "    null;"),
    ('F8-M2 floor guard removed', "if round(v_row.qty * p_new, 2) < v_hpp then", "if false then"),
    ('F8-M3 price cap removed', "if p_new > v_max then", "if false then"),
    ('F8-M4 already-invoiced guard removed', "    raise exception 'F8: racikan ini sudah masuk invoice; ubah lewat koreksi invoice, bukan skrip ini';", "    null;"),
    ('F8-M5 row/visit binding removed', "where pi.id = p_row_id and m.visit_id = p_visit for update of pi;", "where pi.id = p_row_id for update of pi;"),
    ('F8-M6 branch guard removed', "if v_branch is distinct from p_branch_code then", "if false then"),
    ('F8-M7 exactly-one-row guard removed', "if v_n <> 1 then", "if false then"),
    ('F8-M8 owner-actor guard removed', "if v_actor is null then raise exception 'F8: profil % bukan Owner aktif', p_actor; end if;", "null;"),
    ('F8-M9 withdrawn guard removed', "if v_row.billing_withdrawn_at is not null then raise exception 'F8: baris sudah ditarik dari tagihan'; end if;", "null;"),
    ('F8-M10 reason guard removed', "if length(regexp_replace(coalesce(p_reason, ''), '\\s', '', 'g')) < 5 then", "if false then"),
    ('F8-M11 trigger left disabled (enable removed)', "    alter table public.prescription_items enable trigger official_prescription_snapshot;", "    null;"),
    ('F8-M12 audit row written under the wrong actor', "  values (p_visit, v_actor,", "  values (p_visit, (select p.id from public.profiles p where p.role <> 'OWNER' limit 1),"),
    ('F8-M13 expected-name guard removed (wrong-row paste)', "if v_row.nama_obat is distinct from p_expected_name then", "if false then"),
    ('F8-M14 expected-old-price guard removed (second run / stale value)', "if v_row.harga is distinct from p_expected_old_price then", "if false then"),
    ('F8-M15 guard values no longer required', "if p_expected_name is null or btrim(p_expected_name) = '' or p_expected_old_price is null then", "if false then"),
    ('F8-M16 Owner profile id no longer required', "if p_actor is null then raise exception 'F8: isi id profil Owner (wajib)'; end if;", "null;"),
    ('F8-M17 cap back to 10x old price', "v_max := greatest(v_row.harga * 2, v_min * 1.5);", "v_max := v_row.harga * 10;"),
    ('F8-M18 cap too tight (1x old price)', "v_max := greatest(v_row.harga * 2, v_min * 1.5);", "v_max := greatest(v_row.harga, v_min);"),
    ('F8-M27 minimum (ceil HPP) check removed', "if p_new < v_min then", "if false then"),
    ('F8-M19 trigger normal-state check removed', "if v_orig is distinct from 'O' then", "if false then"),
    ('F8-M20 two-decimal check removed', "if p_new <> round(p_new, 2) then", "if false then"),
    ('F8-M21 preview: the old saran formula is back (non-racikan rows get harga x 10)', "'saran_harga_baru', case when pi.compound_recipe_id is not null then ceil(hh.minimum / 500.0) * 500 end,", "'saran_harga_baru', least(ceil(hh.minimum / 500.0) * 500, pi.harga * 10),"),
    ('F8-M22 preview: guard values / window not shown', "'nama_yang_diharapkan', case when pi.compound_recipe_id is not null then pi.nama_obat end,", "'nama_yang_diharapkan', null,"),
    ('F8-M23 post-check ignores the trigger state', "c.trigger_state = 'O' as cek_trigger,", "true as cek_trigger,"),
    ('F8-M24 post-check accepts several audit rows', "c.jumlah_audit = 1 as cek_audit,", "c.jumlah_audit >= 1 as cek_audit,"),
    ('F8-M25 post-check ignores the typed price', "(c.harga_baru is not null and c.harga = c.harga_baru) as cek_harga,", "true as cek_harga,"),
    ('F8-M26 audit omits the executing DB session', " || ' [sesi DB: ' || session_user", " || ' [x: ' || session_user"),
]


def main_mutations(a):
    """Chain + fixtures once, then every variant (control first) in its own clone of that database: a mutant is never
    'killed' by a leftover of an earlier battery (e.g. exhausted stock), only by its own cases."""
    global OFF, MUTANT
    with r.NativePostgres(r.BIN) as db:
        build(db, {B860, B870} if PROD_CHAIN else set()); h = x.Harness(db)
        x.setup(h)
        plan = [('F8-M0 control (unmodified SQL) has 0 FAIL', None)] + [(n, (o, w)) for n, o, w in MUTANTS]
        for i, (name, mut) in enumerate(plan):
            os.environ.pop('PGDATABASE', None)
            db.sql(f'create database v{i} template postgres'); os.environ['PGDATABASE'] = f'v{i}'
            MUTANT = mut; OFF = 0; before = len(RESULTS); crash = None
            try:
                run(h, setup=False)
            except AssertionError as e:
                crash = 'ANCHOR/ASSERT: ' + str(e)[:160]
            except Exception as e:
                crash = 'battery aborted: ' + str(e).strip().splitlines()[0][:200]
            fails = [c['case'] for c in RESULTS[before:] if c['status'] == 'FAIL'] + ([crash] if crash else [])
            del RESULTS[before:]; os.environ.pop('PGDATABASE', None)
            if mut is None:
                check(name, not fails, fails[:3])
            elif crash and crash.startswith('ANCHOR'):
                check(name + ' anchor occurs exactly once', False, crash)
            elif fails and all(f.startswith('battery aborted') and 'STOCK_SHORT' in f for f in fails):
                check(name + ' KILLED (genuinely, not by a harness stock shortage)', False, fails[:3])
            else:
                check(name + ' KILLED', bool(fails), fails[:3])
    MUTANT = None


B860, B870 = '20261106860000_price_floor_pesan_jelas.sql', '20261106870000_ranap_racikan_ubah_harga.sql'


def build(db, exclude):
    tmp = Path(tempfile.mkdtemp(prefix='chain.', dir=ROOT))
    try:
        (tmp / 'supabase/migrations').mkdir(parents=True)
        for f in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
            if f.name not in exclude: (tmp / 'supabase/migrations' / f.name).symlink_to(f)
        r.fixture.ROOT = tmp
        r.fixture.DisposablePostgres.bootstrap(db)
    finally:
        for f in (tmp / 'supabase/migrations').glob('*'): f.unlink()
        (tmp / 'supabase/migrations').rmdir(); (tmp / 'supabase').rmdir(); tmp.rmdir()


def main():
    global SQL_FILE, PROD_CHAIN
    p = argparse.ArgumentParser(); p.add_argument('--json', type=Path, required=True); p.add_argument('--pg-bin'); p.add_argument('--mutations', action='store_true')
    p.add_argument('--prod-chain', action='store_true'); p.add_argument('--sql', type=Path); a = p.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    if a.sql: SQL_FILE = a.sql
    PROD_CHAIN = a.prod_chain
    try:
        if a.mutations: main_mutations(a)
        else:
            with r.NativePostgres(r.BIN) as db:
                build(db, {B860, B870} if PROD_CHAIN else set()); run(x.Harness(db))
    except AssertionError as e: check('HARNESS', False, 'assert: ' + str(e)[:800])
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(c['status'] == s for c in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(cases=RESULTS, totals=totals, sql=str(SQL_FILE), prod_chain=PROD_CHAIN), indent=2, default=str)); print(totals)
    return int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
