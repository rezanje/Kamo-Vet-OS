#!/usr/bin/env python3
"""Native full schema: "Tarik item" = audited soft-withdraw of SAVED, NOT-YET-BILLED rows of an outpatient medical record.

Andri 4 Nov 2026: two "Obat Tetes Kutu" rows saved, only one used; Edit has no delete (RECORD_INVALID), so the unused
row would be billed / counted. Fictional fixtures, throwaway local cluster, no network. Every guard is enforced in the DB.

  flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-tarik-item-rekam-medis-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin --json out.json
  --baseline   omit only the candidate migration (RED)
  --mutations  one chain, then each guard removed from the candidate in a cloned database; every mutant must be KILLED
"""
import argparse, contextlib, importlib.util, json, os, re, subprocess, sys, tempfile, time
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('medical', ROOT / 'scripts/test-rekam-full-edit-postgres.py'); assert spec and spec.loader
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
x, r, q, j = m.x, m.r, m.q, m.j
CANDIDATE = '20261106800000_clinic_tarik_item_rekam_medis.sql'
RESULTS = []
DOC2, DOC_LUAR = r.uid('a', 61), r.uid('a', 62)          # second doctor same branch / doctor of ANOTHER branch
ITEM_A, ITEM_B, JASA, TINDAKAN = (r.uid('e', n) for n in (3101, 3102, 3103, 3104))
GROUP, G_JASA, G_MATS = r.uid('e', 3110), r.uid('e', 3111), [r.uid('e', 3112 + i) for i in range(4)]
REASON = 'Salah input, obat tidak dipakai'


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:500], flush=True)


def has(err, *words): return bool(err) and all(w in err for w in words)
def tarik(v, mr, ids, key, reason=REASON): return f"select public.clinic_withdraw_record_items({q(v)},{q(mr)},{'array[' + ','.join(q(i) + '::uuid' for i in ids) + ']::uuid[]' if ids else 'array[]::uuid[]'},{q(reason) if reason is not None else 'null'},{q(key)});"
def edit(v, mr, rev, rows, key): return f"select public.clinic_edit_queued_record({q(v)},{q(mr)},{rev},{j(dict(anamnesis='Koreksi Fiktif',diagnosis='Diagnosis Fiktif',therapy='Terapi Fiktif',suhu=38.25,gejala_klinis=None,hasil_penunjang=None))},{j(rows)},'Alasan Fiktif',{q(key)});"
def prow(h, rid): return json.loads(h.nilai(f"select to_jsonb(p) from prescription_items p where id={q(rid)}") or 'null')
def rows_of(h, mr): return json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from prescription_items p where medical_record_id={q(mr)}"))
def active(h, mr): return [row for row in rows_of(h, mr) if not row['billing_withdrawn_at']]
def audits(h, mr=None): return h.angka(f"select count(*) from clinic_full_record_edits{'' if mr is None else f' where medical_record_id={q(mr)}'}")
def invoices(h, v): return h.angka(f'select count(*) from invoices where visit_id={q(v)}')
def stock(h, item): return h.angka(f'select coalesce(sum(qty),0) from stock where item_id={q(item)}')
def moves(h): return h.angka('select count(*) from stock_moves')
def journals(h): return h.angka('select count(*) from journal_entries')
def is_withdrawn(h, rid): return prow(h, rid)['billing_withdrawn_at'] is not None
def marker(h, rid): return h.nilai(f"select to_jsonb(p)->>'record_withdrawn_at' from prescription_items p where id={q(rid)}") or None   # None when column absent or not set
def is_rec_withdrawn(h, rid): return marker(h, rid) is not None
def history_names(h, pet, v, user=r.DOCTOR):
    hist = json.loads(h.nilai(f"select public.clinic_patient_clinical_history({q(pet)},{q(v)});", user))
    return sorted(p['nama_obat'] for vis in hist['visits'] for rec in vis['records'] for p in rec['prescriptions'])
def cashier_read(h, v, stay, user=r.STAFF): return json.loads(h.nilai(f'select clinic_read_inpatient_cashier({q(stay)},{q(v)});', user))
def cashier_save(v, stay, snapshot, rows_, parts, key, reason='Hapus item kasir ranap fiktif'):
    return f"select clinic_save_inpatient_cashier({q(stay)},{q(v)},{q(key)},'2026-11-03',{q(snapshot)},{j(rows_)},{j(parts)},null,false,null,{q(reason)});"
def ranap_withdraw(h, v, drop_id, key):
    """The REAL rawat-inap cashier 'Hapus item': omit one pending row and pay the rest (stamps billing_withdrawn_*)."""
    stay = h.nilai(f'select id from inpatient_records where visit_id={q(v)}'); cart = cashier_read(h, v, stay)
    keep = [row for row in cart['rows'] if row['id'] != drop_id]
    return h.gagal(cashier_save(v, stay, cart['snapshot'], keep, [dict(method='Tunai', amount=sum(row['qty'] * row['harga'] for row in keep))], key), r.STAFF), stay
ZW = '\u200b'
def snapshot(h): return [moves(h), journals(h), stock(h, ITEM_A), stock(h, ITEM_B), stock(h, x.MATERIAL), h.angka('select count(*) from invoices')]
def cart_version(h, v, user=r.OWNER): return h.nilai(f'select public.clinic_outpatient_cart_version({q(v)});', user)


def lines_of(h, v):
    return json.loads(h.nilai(f"""select coalesce(jsonb_agg(jsonb_build_object('description',p.nama_obat,'qty',p.qty,'price',p.harga,'kind',p.jenis,'item_id',p.item_id,'unit',p.satuan,
 'prescription_item_id',p.id,'discount_percent',0) order by p.created_at,p.id),'[]') from prescription_items p join medical_records m on m.id=p.medical_record_id
 where m.visit_id={q(v)} and p.billing_withdrawn_at is null"""))


def post(v, key, lines, version=None, user=r.OWNER):
    total = sum(l['qty'] * l['price'] for l in lines)
    header = dict(tanggal='2026-11-03', subtotal=total, discount=0, tax=0, total=total, dp_amount=0, paid_status='Belum Lunas', metode_bayar='Tunai', shift_id=r.SHIFT[user], dp_override_reason='Uji fiktif')
    ver = q(version) if version else f'public.clinic_outpatient_cart_version({q(v)})'
    return f"select public.clinic_post_invoice_with_record({q(v)},{q(key)},{j(header)},{j(lines)},null,null,null,{ver});"


def setup_extra(h):
    h.sql(f"""insert into auth.users(id,raw_user_meta_data) values({q(DOC2)},'{{"full_name":"Dokter Dua Fiktif"}}'),({q(DOC_LUAR)},'{{"full_name":"Dokter Luar Fiktif"}}');
update public.profiles set role='DOCTOR' where id in({q(DOC2)},{q(DOC_LUAR)});
insert into public.user_branches(user_id,branch_id) values({q(DOC2)},{q(r.BRANCH)}),({q(DOC_LUAR)},{q(r.BRANCH2)});
insert into item_categories(id,name) values({q(r.uid('e', 3190))},'TINDAKAN');
insert into items(id,code,name,unit,item_type,is_active,sell_price,buy_price) values
 ({q(ITEM_A)},'UJI-KUTU-A','Obat Tetes Kutu Teal 0.3','pcs','Persediaan',true,30000,2000),({q(ITEM_B)},'UJI-KUTU-B','Obat Tetes Kutu Teal 0.6','pcs','Persediaan',true,35000,2500),
 ({q(JASA)},'UJI-JASA','Grooming VET Lengkap','kali','Jasa',true,150000,0),
 ({q(GROUP)},'UJI-GRUP','Paket Pemeriksaan Fiktif','paket','Grup',true,100000,0),({q(G_JASA)},'UJI-GRUP-JASA','Jasa Pemeriksaan Fiktif','kali','Jasa',true,96000,0);
insert into items(id,code,name,unit,item_type,is_active,sell_price,category_id) values({q(TINDAKAN)},'UJI-TINDAKAN','Tindakan Fiktif','kali','Persediaan',true,80000,{q(r.uid('e', 3190))});""")
    for i, item in enumerate(G_MATS):
        h.sql(f"insert into items(id,code,name,unit,item_type,is_active,sell_price,buy_price) values({q(item)},'UJI-GM-{i}','Bahan Paket Fiktif {i}','pcs','Persediaan',true,1000,500);")
    for item in [ITEM_A, ITEM_B, *G_MATS]:
        h.sql(f"insert into stock(warehouse_id,item_id,qty) values({q(r.WH)},{q(item)},100);insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values({q(r.WH)},{q(item)},current_date,100,100,2000,'purchase');")
    for item in [G_JASA, *G_MATS]:
        h.sql(f"insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values({q(GROUP)},{q(item)},1,{q('kali' if item == G_JASA else 'pcs')},1);")


def rj(h, n, parts=('a', 'b', 'jasa', 'tindakan')):
    """Outpatient (NO inpatient record) visit in Pembayaran with a doctor-submitted record and saved cart rows."""
    v = r.buat_kunjungan(h, n, r.buat_pelanggan(h, n), admitted=False); mr = r.uid(7, n); ids = {}
    h.sql(f"delete from prescription_items where medical_record_id={q(mr)};update medical_records set submission_key='initial-{n}',submitted_by={q(r.DOCTOR)} where id={q(mr)};"
          f"update visits set status='Pembayaran',service_started_at=now()-interval '10 minutes',service_finished_at=now() where id={q(v)};")
    pf = json.dumps(dict(doctor_id=r.DOKTER_PEGAWAI, staff_id=None))
    spec_ = dict(a=(ITEM_A, 'Obat Tetes Kutu Teal 0.3', 1, 30000, 'pcs', 'obat', 'Obat'), b=(ITEM_B, 'Obat Tetes Kutu Teal 0.6', 1, 35000, 'pcs', 'obat', 'Obat'),
                 jasa=(JASA, 'Grooming VET Lengkap', 1, 150000, 'kali', 'jasa', 'Tindakan'))
    for k in parts:
        if k in spec_:
            item, name, qty, harga, unit, jenis, kat = spec_[k]; ids[k] = r.uid('f', n * 10 + len(ids) + 1)
            perf = f"{q(pf)}::jsonb" if jenis == 'jasa' else 'null'
            h.sql(f"insert into prescription_items(id,medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,jenis,kategori,service_performers) values({q(ids[k])},{q(mr)},{q(name)},{q(item)},{qty},{q(unit)},1,{harga},{q(jenis)},{q(kat)},{perf});")
        elif k == 'tindakan':
            ids[k] = r.uid('f', n * 10 + len(ids) + 1)
            h.sql(f"insert into prescription_items(id,medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,jenis,kategori,bmhp_components) values({q(ids[k])},{q(mr)},'Tindakan Fiktif',{q(TINDAKAN)},1,'kali',1,80000,'obat','Tindakan',{j([dict(item_id=x.MATERIAL, qty=3, unit='gram')])});")
        elif k == 'paket':
            ids['paket'] = [r.uid('f', n * 10 + 5 + i) for i in range(5)]
            vals = ','.join(f"({q(rid)},{q(mr)},{q(nm)},{q(item)},1,{q(un)},1,{hg},{q(jn)},'Tindakan',{q(GROUP)},1)" for rid, (item, nm, un, hg, jn) in zip(ids['paket'], [(G_JASA, 'Jasa Pemeriksaan Fiktif', 'kali', 96000, 'jasa')] + [(it, f'Bahan Paket Fiktif {i}', 'pcs', 1000, 'obat') for i, it in enumerate(G_MATS)]))
            h.sql(f"insert into prescription_items(id,medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,jenis,kategori,package_item_id,package_qty) values {vals};")
    return v, mr, ids


def run(h, setup=True, text=None):
    text = text or (ROOT / 'supabase/migrations' / CANDIDATE).read_text()
    if setup:
        x.setup(h); setup_extra(h)
    pre = h.nilai("select (to_regprocedure('public.clinic_withdraw_record_items(uuid,uuid,uuid[],text,text)') is not null)::text||'|'||(to_regprocedure('public.clinic_record_withdrawn_items(uuid)') is not null)::text")
    check('preflight: Tarik RPC and withdrawn-history reader exist', pre == 'true|true', dict(found=pre))
    if pre != 'true|true': return
    col = h.angka("select count(*) from information_schema.columns where table_schema='public' and table_name='prescription_items' and column_name='record_withdrawn_at'")
    check('dedicated marker prescription_items.record_withdrawn_at exists (billing_withdrawn_* keeps its rawat-inap meaning)', col == 1, dict(columns=col))
    # ---- 1. role matrix (refusals change nothing) -------------------------------------------------------------
    v, mr, ids = rj(h, 3200); base = [rows_of(h, mr), audits(h)]
    for user, label in [(r.ADMIN, 'ADMIN'), (r.STAFF, 'STAFF'), (r.FINANCE, 'FINANCE'), (r.FIN_NONAKTIF, 'FINANCE inactive'), (r.FIN_LUAR, 'FINANCE other branch'), (DOC_LUAR, 'DOCTOR of another branch')]:
        err = h.gagal(tarik(v, mr, [ids['b']], 'role-' + label), user)
        check(f'role denied: {label}', has(err, 'ACCESS_DENIED') and [rows_of(h, mr), audits(h)] == base, dict(error=(err or '')[:200]))
    err = h.gagal("set role anon;" + tarik(v, mr, [ids['b']], 'role-anon'))
    check('anon refused (no EXECUTE)', bool(err) and ('permission denied' in err or '42501' in err or 'ACCESS_DENIED' in err) and [rows_of(h, mr), audits(h)] == base, dict(error=(err or '')[:200]))
    snap0 = snapshot(h)
    err = h.gagal(tarik(v, mr, [ids['b']], 'doctor-ok'), r.DOCTOR); row = prow(h, ids['b'])
    check('DOCTOR withdraws a saved obat row: stamped at/by/reason (billing eligibility) AND record_withdrawn_at (clinical visibility), row kept (soft), no stock/money/journal/invoice movement',
          not err and row['billing_withdrawn_at'] and row['billing_withdrawn_by'] == r.DOCTOR and row['billing_withdrawal_reason'] == REASON and marker(h, ids['b']) and len(rows_of(h, mr)) == 4 and snapshot(h) == snap0, dict(error=err, row={k: row[k] for k in ('billing_withdrawn_at', 'billing_withdrawn_by', 'billing_withdrawal_reason')}))
    au = json.loads(h.nilai(f"select to_jsonb(e) from clinic_full_record_edits e where medical_record_id={q(mr)} order by created_at desc limit 1") or 'null')
    other_same = all(a == b for a, b in zip([row_ for row_ in au['before_rows'] if row_['id'] != ids['b']], [row_ for row_ in au['after_rows'] if row_['id'] != ids['b']])) if au else False
    check('audit row: actor, reason, request key, BEFORE (not withdrawn) and AFTER (withdrawn) snapshots of the whole record',
          bool(au) and au['created_by'] == r.DOCTOR and au['reason'] == 'Tarik item: ' + REASON and au['request_key'] == 'doctor-ok'
          and next(i for i in au['before_rows'] if i['id'] == ids['b'])['billing_withdrawn_at'] is None and next(i for i in au['after_rows'] if i['id'] == ids['b'])['billing_withdrawn_at'] and other_same and len(au['before_rows']) == 4, dict(audit=au and au['reason']))
    # idempotent replay: same payload same result, no second audit/withdrawal stamp; changed payload conflicts
    a0 = audits(h, mr); stamp = prow(h, ids['b'])['billing_withdrawn_at']
    res1 = h.nilai(tarik(v, mr, [ids['a']], 'replay-a'), r.OWNER); a1 = audits(h, mr)
    res2 = h.nilai(tarik(v, mr, [ids['a']], 'replay-a'), r.OWNER)
    check('OWNER withdraw; exact replay returns the SAME result, no second audit row, no re-stamp', bool(res1) and res1 == res2 and a1 == a0 + 1 and audits(h, mr) == a1 and json.loads(res1)['withdrawn'] == [ids['a']], dict(first=res1, replay=res2))
    err = h.gagal(tarik(v, mr, [ids['jasa']], 'replay-a'), r.OWNER)
    check('same key with a different payload -> IDEMPOTENCY_CONFLICT, nothing written', has(err, 'IDEMPOTENCY_CONFLICT') and not is_withdrawn(h, ids['jasa']), dict(error=(err or '')[:160]))
    err = h.gagal(tarik(v, mr, [ids['b']], 'second-key'), r.DOCTOR)
    check('row already withdrawn by an EARLIER request (different key) is refused, original stamp kept', has(err, 'WITHDRAW_ALREADY') and prow(h, ids['b'])['billing_withdrawn_at'] == stamp, dict(error=(err or '')[:200]))
    err = h.gagal(tarik(v, mr, [ids['jasa']], 'doc2-ok'), DOC2)
    check('another DOCTOR of the same branch may withdraw (identical to the Edit gate; documented default)', not err and is_withdrawn(h, ids['jasa']), dict(error=err))
    # ---- 2. input validation --------------------------------------------------------------------------------
    v, mr, ids = rj(h, 3201); base = [rows_of(h, mr), audits(h)]
    other_v, other_mr, other_ids = rj(h, 3202)
    for label, sql, words in [
        ('empty id list', tarik(v, mr, [], 'in-1'), ('WITHDRAW_INVALID',)),
        ('duplicate id in list', tarik(v, mr, [ids['a'], ids['a']], 'in-2'), ('WITHDRAW_INVALID',)),
        ('reason shorter than 5 chars', tarik(v, mr, [ids['a']], 'in-3', 'abcd'), ('WITHDRAW_INVALID', 'alasan')),
        ('reason empty/whitespace', tarik(v, mr, [ids['a']], 'in-4', '     '), ('WITHDRAW_INVALID', 'alasan')),
        ('reason NULL', tarik(v, mr, [ids['a']], 'in-5', None), ('WITHDRAW_INVALID', 'alasan')),
        ('reason longer than 200 chars', tarik(v, mr, [ids['a']], 'in-6', 'x' * 201), ('WITHDRAW_INVALID', 'alasan')),
        ('blank request key', tarik(v, mr, [ids['a']], '   '), ('WITHDRAW_INVALID',)),
        ('row of ANOTHER visit', tarik(v, mr, [other_ids['a']], 'in-8'), ('WITHDRAW_INVALID',)),
        ('unknown row id', tarik(v, mr, [r.uid('f', 999999)], 'in-9'), ('WITHDRAW_INVALID',)),
        ('record of another visit', tarik(v, other_mr, [ids['a']], 'in-10'), ('ACCESS_DENIED',)),
        ('reason of only punctuation (5 dots)', tarik(v, mr, [ids['a']], 'in-12', '.....'), ('WITHDRAW_INVALID', 'alasan')),
        ('reason of only zero-width characters (U+200B x5)', tarik(v, mr, [ids['a']], 'in-13', ZW * 5), ('WITHDRAW_INVALID', 'alasan')),
        ('reason of mixed punctuation/space/symbols', tarik(v, mr, [ids['a']], 'in-14', '?! - ?! - ?!'), ('WITHDRAW_INVALID', 'alasan')),
        ('reason with only 4 significant chars padded by zero-width/dots', tarik(v, mr, [ids['a']], 'in-15', 'ab' + ZW + 'cd' + ZW * 3 + '...'), ('WITHDRAW_INVALID', 'alasan')),
        ('reason of tabs/newlines/BOM/word-joiner only', tarik(v, mr, [ids['a']], 'in-16', '\t\n\ufeff\u2060\t\n\ufeff\u2060'), ('WITHDRAW_INVALID', 'alasan')),
        ('reason of Hangul filler (invisible) x6', tarik(v, mr, [ids['a']], 'in-17', '\u3164' * 6), ('WITHDRAW_INVALID', 'alasan')),
        ('more than 50 ids', f"select public.clinic_withdraw_record_items({q(v)},{q(mr)},(select array_agg(gen_random_uuid()) from generate_series(1,51)),{q(REASON)},'in-11');", ('WITHDRAW_INVALID',)),
    ]:
        err = h.gagal(sql, r.DOCTOR)
        check('refused: ' + label, has(err, *words) and [rows_of(h, mr), audits(h)] == base and not is_withdrawn(h, other_ids['a']), dict(error=(err or '')[:220]))
    err = h.gagal(tarik(v, mr, [ids['a']], 'in-reason-200', 'y' * 200), r.DOCTOR)
    check('reason of exactly 200 chars and (padded) 5 chars are accepted and trimmed', not err and prow(h, ids['a'])['billing_withdrawal_reason'] == 'y' * 200
          and not h.gagal(tarik(v, mr, [ids['b']], 'in-reason-5', '  abcde  '), r.DOCTOR) and prow(h, ids['b'])['billing_withdrawal_reason'] == 'abcde', dict(error=err))
    v, mr, ids = rj(h, 3240); ok_reasons = [('a', 'a b c d e'), ('b', 'abc' + ZW + 'de'), ('jasa', '\u3042\u3044\u3046\u3048\u304a'), ('tindakan', ' 12345!! ')]
    outs = {k: h.gagal(tarik(v, mr, [ids[k]], 'ok-' + k, text_), r.DOCTOR) for k, text_ in ok_reasons}
    check('reasons with >= 5 significant chars are accepted (spaced letters, zero-width inside, Japanese letters, digits + punctuation)', not any(outs.values()) and all(is_withdrawn(h, ids[k]) for k, _ in ok_reasons), dict(errors={k: (e or '')[:120] for k, e in outs.items()}))
    # ---- 3. row types: jasa (with performers), tindakan with BMHP, obat ---------------------------------------------
    v, mr, ids = rj(h, 3203); s0 = snapshot(h); perf = prow(h, ids['jasa'])['service_performers']
    err = h.gagal(tarik(v, mr, [ids['jasa'], ids['tindakan']], 'types-1'), r.DOCTOR)
    check('jasa (with performers) + tindakan with BMHP withdrawn together: rows kept, performers/BMHP data untouched, no stock moved', not err and prow(h, ids['jasa'])['service_performers'] == perf and prow(h, ids['tindakan'])['bmhp_components'] and snapshot(h) == s0, dict(error=err))
    # ---- 4. racikan stays locked ------------------------------------------------------------------------------
    v, mr, ids = rj(h, 3204, ('a',)); version = h.nilai('select id from compound_formula_versions limit 1')
    err = h.gagal(x.issue(v, mr, x.payload(version, 'tarik-racik')), r.DOCTOR)
    rid = h.nilai(f"select id from prescription_items where medical_record_id={q(mr)} and compound_recipe_id is not null limit 1")
    check('fixture: real issued racikan row on the outpatient record', not err and bool(rid), dict(error=(err or '')[:200]))
    if rid:
        s0 = snapshot(h); err = h.gagal(tarik(v, mr, [rid], 'racik-1'), r.DOCTOR); err2 = h.gagal(tarik(v, mr, [ids['a'], rid], 'racik-2'), r.OWNER)
        check('racikan row refused with a message pointing to Aksi -> Ubah komposisi / koreksi racikan; mixed request is all-or-nothing', has(err, 'COMPOUND_LOCKED', 'Ubah komposisi') and has(err2, 'COMPOUND_LOCKED') and not is_withdrawn(h, rid) and not is_withdrawn(h, ids['a']) and snapshot(h) == s0, dict(error=(err or '')[:240]))
    # ---- 5. package atomicity -----------------------------------------------------------------------------------
    v, mr, ids = rj(h, 3205, ('a', 'paket')); pk = ids['paket']; base = [rows_of(h, mr), audits(h)]
    err = h.gagal(tarik(v, mr, pk[:4], 'pkg-partial'), r.DOCTOR)
    check('package rows only as a whole: 4 of 5 refused (PACKAGE_PARTIAL), nothing written', has(err, 'PACKAGE_PARTIAL', 'Paket Pemeriksaan Fiktif') and [rows_of(h, mr), audits(h)] == base, dict(error=(err or '')[:240]))
    err = h.gagal(tarik(v, mr, pk[:1], 'pkg-one'), r.DOCTOR)
    check('a single component of a package is refused as well', has(err, 'PACKAGE_PARTIAL') and [rows_of(h, mr), audits(h)] == base, dict(error=(err or '')[:160]))
    err = h.gagal(tarik(v, mr, pk + [ids['a']], 'pkg-all'), r.DOCTOR)
    check('complete package (+ another row) withdrawn atomically in ONE audit row; deferred package constraint passes', not err and all(is_withdrawn(h, i) for i in pk + [ids['a']]) and audits(h) == base[1] + 1, dict(error=err))
    # ---- 6. readers ignore withdrawn rows through the REAL billing RPCs ---------------------------------------------
    v, mr, ids = rj(h, 3206, ('a', 'b', 'jasa', 'tindakan')); ver0 = cart_version(h, v)
    h.sql(tarik(v, mr, [ids['b'], ids['jasa']], 'rd-1'), r.DOCTOR); ver1 = cart_version(h, v)
    pend = json.loads(h.nilai(f"select clinic_private.pending_cashier_rows({q(v)})")); cart = lines_of(h, v)
    check('cart version changes on withdraw; pending cart rows + builder lines drop the withdrawn rows', ver0 != ver1 and {p['id'] for p in pend} == {ids['a'], ids['tindakan']} and {l['prescription_item_id'] for l in cart} == {ids['a'], ids['tindakan']}, dict(v0=ver0, v1=ver1))
    sb, mat0, a0_, b0 = h.angka(f'select count(*) from stock_moves'), stock(h, x.MATERIAL), stock(h, ITEM_A), stock(h, ITEM_B)
    err = h.gagal(post(v, 'rd-post', cart), r.OWNER); inv = h.aktif(v)
    items = json.loads(h.nilai(f"select coalesce(jsonb_agg(prescription_item_id order by prescription_item_id),'[]') from invoice_items where invoice_id={q(inv)}")) if inv else []
    check('real clinic_post_invoice_with_record: invoice has ONLY the kept rows; withdrawn obat/jasa never billed (no komisi snapshot), withdrawn item B stock untouched',
          not err and sorted(items) == sorted([ids['a'], ids['tindakan']]) and stock(h, ITEM_B) == b0 and stock(h, ITEM_A) == a0_ - 1 and h.angka(f"select count(*) from invoice_items where prescription_item_id in ({q(ids['b'])},{q(ids['jasa'])})") == 0
          and h.angka(f'select total from invoices where id={q(inv)}') == 110000, dict(error=(err or '')[:300], items=items))
    err = h.gagal(tarik(v, mr, [ids['a']], 'rd-after-invoice'), r.DOCTOR)
    check('after the invoice exists, Tarik is refused (RECORD_POSTED); row stays billed', has(err, 'RECORD_POSTED') and not is_withdrawn(h, ids['a']), dict(error=(err or '')[:200]))
    h.sql(f"update invoices set voided_at=now() where visit_id={q(v)};")
    err = h.gagal(tarik(v, mr, [ids['tindakan']], 'rd-after-void'), r.OWNER)
    check('a VOIDED invoice still blocks Tarik (use koreksi tagihan)', has(err, 'RECORD_POSTED') and not is_withdrawn(h, ids['tindakan']), dict(error=(err or '')[:200]))
    # BMHP: withdrawn procedure row -> BMHP material stock is NOT issued when the rest is billed
    v, mr, ids = rj(h, 3207, ('a', 'tindakan')); h.sql(tarik(v, mr, [ids['tindakan']], 'bmhp-1'), r.DOCTOR); mat0 = stock(h, x.MATERIAL)
    err = h.gagal(post(v, 'bmhp-post', lines_of(h, v)), r.OWNER)
    check('withdrawn procedure with BMHP: later invoice issues NO BMHP material stock', not err and stock(h, x.MATERIAL) == mat0, dict(error=(err or '')[:200], before=mat0, after=stock(h, x.MATERIAL)))
    # stale cart + stale direct line
    v, mr, ids = rj(h, 3208, ('a', 'b')); stale_ver = cart_version(h, v); stale_lines = lines_of(h, v); h.sql(tarik(v, mr, [ids['b']], 'stale-1'), r.DOCTOR); s0 = snapshot(h)
    err = h.gagal(post(v, 'stale-post', stale_lines, stale_ver), r.OWNER)
    check('kasir cart opened BEFORE the withdrawal -> CART_STALE, nothing posted', has(err, 'CART_STALE') and snapshot(h) == s0, dict(error=(err or '')[:200]))
    err = h.gagal(post(v, 'stale-fresh-version', stale_lines), r.OWNER)
    check('even with a fresh cart version, an invoice line pointing at a withdrawn row is refused (CART_INVALID) and rolled back incl. stock', has(err, 'CART_INVALID') and snapshot(h) == s0, dict(error=(err or '')[:240]))
    # direct client writes still refused
    err = h.gagal(f"update prescription_items set billing_withdrawn_at=null where id={q(ids['b'])};", r.DOCTOR)
    err2 = h.gagal(f"update prescription_items set billing_withdrawn_at=now(),billing_withdrawal_reason='sendiri' where id={q(ids['a'])};", r.DOCTOR)
    check('direct client UPDATE can neither un-withdraw nor withdraw (RPC is the only path)', bool(err) and bool(err2) and is_withdrawn(h, ids['b']) and not is_withdrawn(h, ids['a']), dict(e1=(err or '')[:120], e2=(err2 or '')[:120]))
    # ---- 7. Edit save after a withdrawal (patched clinic_edit_queued_record) ---------------------------------------
    v, mr, ids = rj(h, 3209, ('a', 'b', 'jasa')); h.sql(tarik(v, mr, [ids['b']], 'ed-1'), r.DOCTOR)
    keep = active(h, mr); keep[0]['qty'] = 2
    err = h.gagal(edit(v, mr, 0, keep, 'ed-save'), r.DOCTOR)
    check('Edit save with the remaining rows still works after a withdrawal (removal guard ignores withdrawn rows)', not err and prow(h, ids['a'])['qty'] == 2 and is_withdrawn(h, ids['b']) and prow(h, ids['b'])['qty'] == 1, dict(error=(err or '')[:240]))
    err = h.gagal(edit(v, mr, 1, rows_of(h, mr), 'ed-stale'), r.DOCTOR)
    check('a stale tab that still sends the withdrawn row is refused (muat ulang), nothing written', has(err, 'RECORD_INVALID', 'ditarik') and is_withdrawn(h, ids['b']), dict(error=(err or '')[:200]))
    err = h.gagal(edit(v, mr, 1, [row for row in active(h, mr) if row['id'] != ids['a']], 'ed-remove'), r.DOCTOR)
    check('removing a NOT-withdrawn saved row through Edit is still refused (additive-only rule intact)', has(err, 'RECORD_INVALID', 'tidak boleh dihapus'), dict(error=(err or '')[:200]))
    # ---- 7c. a row stamped ONLY by the rawat-inap cashier (billing_withdrawn_*) is NOT record-withdrawn: Edit behaves exactly as before
    v, mr, ids = rj(h, 3241, ('a', 'b', 'jasa')); h.sistem(f"update prescription_items set billing_withdrawn_at=now(),billing_withdrawal_reason='kasir ranap fiktif' where id={q(ids['b'])};")
    err = h.gagal(edit(v, mr, 0, [row for row in rows_of(h, mr) if row['id'] != ids['b']], 'bw-remove'), r.DOCTOR)
    check('Edit: omitting a billing_withdrawn-only row is still refused as a removal (guard keys on the record marker, not billing_withdrawn)', has(err, 'RECORD_INVALID', 'tidak boleh dihapus'), dict(error=(err or '')[:200]))
    err = h.gagal(edit(v, mr, 0, rows_of(h, mr), 'bw-keep'), r.DOCTOR)
    check('Edit: sending a billing_withdrawn-only row back is accepted as before (not mistaken for a Tarik)', not err and marker(h, ids['b']) is None and is_withdrawn(h, ids['b']), dict(error=(err or '')[:200]))
    # ---- 7b. package origin round-trip through Edit save (the Edit form now carries package_item_id/qty of saved rows) ----
    v, mr, ids = rj(h, 3214, ('a', 'paket')); origin = lambda: [(row['package_item_id'], row['package_qty']) for row in rows_of(h, mr) if row['id'] in ids['paket']]
    carried = rows_of(h, mr); err = h.gagal(edit(v, mr, 0, carried, 'pkg-roundtrip'), r.DOCTOR)
    check('Edit save that carries the saved package origin keeps package_item_id/package_qty on every component', not err and origin() == [(GROUP, 1)] * 5, dict(error=(err or '')[:200], origin=origin()))
    stripped = [{k: val for k, val in row.items() if k not in ('package_item_id', 'package_qty')} for row in rows_of(h, mr)]
    err = h.gagal(edit(v, mr, 1, stripped, 'pkg-stripped'), r.DOCTOR)
    check('INFO pre-existing behaviour: an Edit save that omits the origin clears it (why the form must carry it)', not err and origin() == [(None, None)] * 5, dict(error=(err or '')[:200], origin=origin()))
    # ---- 8. refusal states: archived, inpatient, not in Pembayaran ----------------------------------------------------
    v, mr, ids = rj(h, 3210); base = rows_of(h, mr)
    h.sql(f"begin;alter table public.visits disable trigger user;update public.visits set archived_at=now(),archived_by={q(r.OWNER)},archive_reason='Uji arsip' where id={q(v)};alter table public.visits enable trigger user;commit;")
    err = h.gagal(tarik(v, mr, [ids['a']], 'arc-1'), r.OWNER)
    check('archived visit refused', has(err, 'diarsipkan') and rows_of(h, mr) == base, dict(error=(err or '')[:200]))
    v, mr = m.visit(h, 3211); rid = h.nilai(f"select id from prescription_items where medical_record_id={q(mr)} limit 1"); base = rows_of(h, mr)
    err = h.gagal(tarik(v, mr, [rid], 'ranap-open'), r.DOCTOR)
    check('visit with an OPEN rawat inap refused (ranap uses its own cashier withdrawal)', has(err, 'rawat inap') and rows_of(h, mr) == base, dict(error=(err or '')[:200]))
    h.sistem(f"update inpatient_records set discharged_at=now() where visit_id={q(v)};")
    err = h.gagal(tarik(v, mr, [rid], 'ranap-closed'), r.DOCTOR)
    check('visit with a CLOSED rawat inap is refused too (stricter than "open", documented)', has(err, 'rawat inap') and rows_of(h, mr) == base, dict(error=(err or '')[:200]))
    v, mr, ids = rj(h, 3212); h.sql(f"update visits set status='Diperiksa',service_finished_at=null where id={q(v)};")
    err = h.gagal(tarik(v, mr, [ids['a']], 'not-queue'), r.DOCTOR)
    check('visit not waiting for payment (Diperiksa) refused', has(err, 'RECORD_POSTED') and not is_withdrawn(h, ids['a']), dict(error=(err or '')[:200]))
    # ---- 9. history readers --------------------------------------------------------------------------------------------
    v, mr, ids = rj(h, 3213, ('a', 'b')); h.sql(tarik(v, mr, [ids['b']], 'hist-1', 'Dobel input obat kutu'), r.DOCTOR)
    pet = r.uid(5, 3213)
    hist = json.loads(h.nilai(f"select public.clinic_patient_clinical_history({q(pet)},{q(v)});", r.DOCTOR))
    names = [p['nama_obat'] for vis in hist['visits'] for rec in vis['records'] for p in rec['prescriptions']]
    check('patient clinical history lists only non-withdrawn prescriptions', names == ['Obat Tetes Kutu Teal 0.3'], dict(names=names))
    wd = json.loads(h.nilai(f"select public.clinic_record_withdrawn_items({q(mr)});", r.STAFF))
    check('withdrawn-items reader shows row, who (name) and why, struck-through source for the record page', len(wd) == 1 and wd[0]['id'] == ids['b'] and wd[0]['reason'] == 'Dobel input obat kutu' and wd[0]['withdrawn_by_name'] == 'Pengguna Fiktif 5' and wd[0]['withdrawn_at'], dict(wd=wd))
    err = h.gagal(f"select public.clinic_record_withdrawn_items({q(mr)});", r.FIN_LUAR)
    check('withdrawn-items reader refuses another branch', has(err, 'ACCESS_DENIED'), dict(error=(err or '')[:160]))
    # ---- 9b. REVIEW BLOCKER: the rawat-inap cashier's own 'Hapus item' must not change clinical history retroactively --------
    v, mr = m.visit(h, 3230); pet = r.uid(5, 3230); drop = r.uid(9, 3230 * 10 + 4); before = history_names(h, pet, v)
    err, stay = ranap_withdraw(h, v, drop, 'ranap-w-1'); row = prow(h, drop); after = history_names(h, pet, v)
    check('real rawat-inap cashier Hapus item stamps billing_withdrawn_* only (record_withdrawn_at stays NULL)', not err and row['billing_withdrawn_at'] and row['billing_withdrawal_reason'] and marker(h, drop) is None, dict(error=(err or '')[:240]))
    check('ranap-cashier withdrawal leaves patient clinical history UNCHANGED: 4 rows before and after (review probe P3 was 4 -> 3)', len(before) == 4 and after == before and 'Jasa Tambahan Fiktif' in after, dict(before=before, after=after))
    wd = json.loads(h.nilai(f"select public.clinic_record_withdrawn_items({q(mr)});", r.DOCTOR))
    check('Tarik withdrawn-items reader does not list rows withdrawn by the rawat-inap cashier', wd == [], dict(wd=wd))
    # outpatient visit withdrawn by Tarik and ADMITTED as rawat inap afterwards
    v, mr, ids = rj(h, 3231, ('a', 'b')); pet = r.uid(5, 3231); h.sql(tarik(v, mr, [ids['b']], 'adm-1'), r.DOCTOR)
    h.sql(f"""insert into public.consents (id,visit_id,template_id,tindakan,isi_snapshot) values ({q(r.uid('d', 3231))},{q(v)},{q(r.TEMPLATE_CONSENT)},'Rawat Inap Fiktif','Isi persetujuan fiktif');
update public.consents set status='sudah_ttd', signer_name='Pemilik Fiktif', signature_data='data:image/png;base64,ZmlrdGlm', signed_at=now() where id={q(r.uid('d', 3231))};""", r.OWNER)
    err = h.gagal(f"select public.clinic_admit_inpatient({q(v)},'Rencana rawat inap fiktif','masuk-3231');", r.OWNER)
    stay = h.nilai(f'select id from inpatient_records where visit_id={q(v)}') if not err else None
    check('fixture: visit with a Tarik is admitted as rawat inap afterwards (real RPC)', not err and bool(stay), dict(error=(err or '')[:240]))
    if stay:
        cart_ids = {row['id'] for row in cashier_read(h, v, stay)['rows']}
        check('after admission the Tarik-withdrawn drug is NOT in the rawat-inap cashier cart (ranap billing readers ignore it via billing_withdrawn_at)', cart_ids == {ids['a']}, dict(cart=sorted(cart_ids)))
        check('after admission clinical history still hides the withdrawn drug; marker and audit reader intact', history_names(h, pet, v) == ['Obat Tetes Kutu Teal 0.3'] and is_rec_withdrawn(h, ids['b'])
              and [w['id'] for w in json.loads(h.nilai(f"select public.clinic_record_withdrawn_items({q(mr)});", r.DOCTOR))] == [ids['b']], dict(names=history_names(h, pet, v)))
    # ---- 9c. marker invariants (the new column is as tamper-proof as billing_withdrawn_*) ------------------------------------
    v, mr, ids = rj(h, 3232, ('a', 'b', 'jasa'))
    e1 = h.gagal(f"update prescription_items set record_withdrawn_at=now() where id={q(ids['a'])};", r.DOCTOR)   # (stopped earlier by guard_full_record_prescription on a finished visit)
    # Isolate THIS guard: a row already stamped billing_withdrawn (rawat-inap style) + a client role with the older finished-visit trigger lifted for the transaction.
    h.sistem(f"update prescription_items set billing_withdrawn_at=now(),billing_withdrawal_reason='kasir ranap fiktif' where id={q(ids['jasa'])};")
    trg = h.nilai("select tgname from pg_trigger where tgrelid='public.prescription_items'::regclass and tgfoid='public.guard_full_record_prescription'::regproc and not tgisinternal limit 1")
    e1b = h.gagal(f"begin;alter table public.prescription_items disable trigger {trg};set role authenticated;select set_config('request.jwt.claims',{q(json.dumps(dict(sub=r.DOCTOR, role='authenticated')))},false);update prescription_items set record_withdrawn_at=now() where id={q(ids['jasa'])};rollback;")
    e2 = h.gagal(f"insert into prescription_items(medical_record_id,nama_obat,qty,satuan,faktor,harga,jenis,billing_withdrawn_at,record_withdrawn_at) values ({q(mr)},'Sisipan Fiktif',1,'pcs',1,1000,'obat',now(),now());", r.DOCTOR)
    check('client roles can neither set nor insert record_withdrawn_at directly (RPC only); the marker guard itself refuses even a row that already carries billing_withdrawn_*', has(e1, 'ACCESS_DENIED') and has(e1b, 'ACCESS_DENIED', 'Tarik item') and not is_rec_withdrawn(h, ids['jasa']) and bool(e2) and not is_rec_withdrawn(h, ids['a']) and h.angka(f"select count(*) from prescription_items where medical_record_id={q(mr)} and nama_obat='Sisipan Fiktif'") == 0, dict(e1=(e1 or '')[:160], e1b=(e1b or '')[:200], e2=(e2 or '')[:160]))
    e3 = h.gagal(f"update prescription_items set record_withdrawn_at=now() where id={q(ids['a'])};")
    check('even the table owner cannot set the record marker without billing_withdrawn_at (invariant: record-withdrawn implies not billable)', bool(e3) and not is_rec_withdrawn(h, ids['a']), dict(error=(e3 or '')[:200]))
    h.sql(tarik(v, mr, [ids['b']], 'inv-1'), r.DOCTOR)
    e4 = h.gagal(f"update prescription_items set record_withdrawn_at=null where id={q(ids['b'])};"); e5 = h.gagal(f"update prescription_items set billing_withdrawn_at=null where id={q(ids['b'])};")
    check('a Tarik cannot be undone by clearing either marker, even by the table owner (no undo in v1; money stays blocked)', bool(e4) and bool(e5) and is_rec_withdrawn(h, ids['b']) and is_withdrawn(h, ids['b']), dict(e4=(e4 or '')[:120], e5=(e5 or '')[:120]))
    e6 = h.gagal(f"update prescription_items set billing_withdrawn_at=now(),billing_withdrawal_reason='kasir ranap fiktif' where id={q(ids['a'])};")
    check('rawat-inap style stamp (billing_withdrawn_* alone) is still allowed for the owner role and leaves the record marker NULL', not e6 and is_withdrawn(h, ids['a']) and not is_rec_withdrawn(h, ids['a']), dict(error=(e6 or '')[:160]))
    # ---- 10. races (real lock barriers) ---------------------------------------------------------------------------------
    race_checks(h)
    rerun_checks(h, text)


def rerun_checks(h, text):
    # ---- 11. re-runnable + fails closed on drift ----------------------------------------------------------------------------------
    err = h.gagal(text)
    acl = h.nilai("select string_agg(r||'='||has_function_privilege(r,'public.clinic_withdraw_record_items(uuid,uuid,uuid[],text,text)','execute')::text,',' order by r) from unnest(array['anon','authenticated','service_role']) r")
    check('migration is re-runnable on an already migrated database (no error, ACL unchanged: authenticated only)', not err and acl == 'anon=false,authenticated=true,service_role=false', dict(error=(err or '')[:300], acl=acl))
    drift = f"begin;do $drift$ declare d text; begin d:=pg_get_functiondef('public.clinic_patient_clinical_history(uuid,uuid)'::regprocedure); execute replace(d,'pi.record_withdrawn_at is null','pi.id is not null'); end $drift$;\n{text}\nrollback;"
    err = h.gagal(drift)
    check('anchors still fail closed on drift (function body changed by someone else -> migration aborts)', has(err, 'anchor drift'), dict(error=(err or '')[:300]))


def race_checks(h):
    # (a) invoice post holds the coordinator; a withdraw arriving meanwhile waits, then sees the invoice -> refused.
    v, mr, ids = rj(h, 3220, ('a', 'b')); lines = lines_of(h, v); barriers = []
    with contextlib.ExitStack() as stack:
        obs = stack.enter_context(x.c.Session(h.db, 'tarik-observer'))
        poster = stack.enter_context(x.c.Session(h.db, 'tarik-poster', r.OWNER)); doc = stack.enter_context(x.c.Session(h.db, 'tarik-doctor', r.DOCTOR))
        poster.sql('begin;' + post(v, 'race-a', lines))
        doc.send('begin;' + tarik(v, mr, [ids['b']], 'race-a-w'))
        try: x.c.wait_block(obs, doc, poster, barriers)
        except Exception as e: barriers.append(str(e)[:200])
        poster.sql('commit;'); out = x.c.attempt(doc, commit=False)
        if out['ok']: doc.sql('commit;')
    check('RACE invoice first: withdraw waits on the lock, then is refused (invoice wins); both invoice lines intact', len(barriers) == 1 and isinstance(barriers[0], dict) and not out['ok'] and 'RECORD_POSTED' in out.get('error', '') and not is_withdrawn(h, ids['b']) and h.angka(f'select count(*) from invoice_items where invoice_id={q(h.aktif(v))}') == 2, dict(outcome=out, barriers=barriers))
    # (b) withdraw holds the lock; invoice post (cart read before) waits, then sees the row gone -> CART_STALE, nothing posted.
    v, mr, ids = rj(h, 3221, ('a', 'b')); lines = lines_of(h, v); ver = cart_version(h, v); barriers = []; s0 = snapshot(h)
    with contextlib.ExitStack() as stack:
        obs = stack.enter_context(x.c.Session(h.db, 'tarik-observer2'))
        doc = stack.enter_context(x.c.Session(h.db, 'tarik-doctor2', r.DOCTOR)); poster = stack.enter_context(x.c.Session(h.db, 'tarik-poster2', r.OWNER))
        doc.sql('begin;' + tarik(v, mr, [ids['b']], 'race-b-w'))
        poster.send('begin;' + post(v, 'race-b', lines, ver))
        try: x.c.wait_block(obs, poster, doc, barriers)
        except Exception as e: barriers.append(str(e)[:200])
        doc.sql('commit;'); out = x.c.attempt(poster, commit=False)
        if out['ok']: poster.sql('commit;')
    check('RACE withdraw first: invoice post waits, then CART_STALE (sees the row gone); nothing billed, stock unchanged', len(barriers) == 1 and isinstance(barriers[0], dict) and not out['ok'] and 'CART_STALE' in out.get('error', '') and is_withdrawn(h, ids['b']) and invoices(h, v) == 0 and snapshot(h) == s0, dict(outcome=out, barriers=barriers))
    # (c) withdraw vs Edit save: serialised by the same coordinator, no deadlock, both land.
    v, mr, ids = rj(h, 3222, ('a', 'b', 'jasa')); keep = [row for row in rows_of(h, mr) if row['id'] != ids['b']]; barriers = []
    with contextlib.ExitStack() as stack:
        obs = stack.enter_context(x.c.Session(h.db, 'tarik-observer3'))
        doc = stack.enter_context(x.c.Session(h.db, 'tarik-doctor3', r.DOCTOR)); ed = stack.enter_context(x.c.Session(h.db, 'tarik-editor3', r.OWNER))
        doc.sql('begin;' + tarik(v, mr, [ids['b']], 'race-c-w'))
        ed.send('begin;' + edit(v, mr, 0, keep, 'race-c-e'))
        try: x.c.wait_block(obs, ed, doc, barriers)
        except Exception as e: barriers.append(str(e)[:200])
        doc.sql('commit;'); out = x.c.attempt(ed)
    check('RACE withdraw vs Edit save: Edit waits, then saves the remaining rows (no deadlock, withdrawn row untouched)', len(barriers) == 1 and isinstance(barriers[0], dict) and out['ok'] and is_withdrawn(h, ids['b']), dict(outcome=out, barriers=barriers))
    check('no permit/lock residue after all runs', h.angka('select count(*) from clinic_private.record_edit_permits') == 0, {})


MUTANTS = {
    'role gate lets STAFF through': ("role in ('OWNER','DOCTOR'))\n  or not public.clinic_record_correction_actor(p_visit_id) then", "role in ('OWNER','DOCTOR','STAFF'))\n  or not public.clinic_record_correction_actor(p_visit_id) then"),
    'no coordinator and no visit lock (race)': [("perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));\n if auth.role() is distinct from 'authenticated' or auth.uid() is null", "if auth.role() is distinct from 'authenticated' or auth.uid() is null"), ("select * into v_visit from public.visits where id=p_visit_id for update;", "select * into v_visit from public.visits where id=p_visit_id;"), ("perform 1 from public.medical_records where id=p_record_id and visit_id=p_visit_id for update;", "perform 1 from public.medical_records where id=p_record_id and visit_id=p_visit_id;")],
    'racikan no longer refused': ("if rx.compound_recipe_id is not null or rx.jenis='racikan' or rx.satuan='racikan' then", "if false then"),
    'package partial no longer refused': ("if rx.package_item_id is not null and exists(", "if false and exists("),
    'reason minimum removed (length bound AND significance check; each alone is redundant with the other)': [("not between 5 and 200", "not between 0 and 200"), ("'g'))<5 then", "'g'))<0 then")],
    'reason maximum removed': ("not between 5 and 200", "not between 5 and 100000"),
    'replay returns nothing special (idempotency removed)': ("select * into prev from public.clinic_full_record_edits where created_by=auth.uid() and request_key=v_key;", "select * into prev from public.clinic_full_record_edits where false;"),
    'replay hash ignores payload': ("v_hash:=md5(jsonb_build_array('tarik-item',p_visit_id,p_record_id,v_ids,v_reason)::text);", "v_hash:=md5('tarik-item');"),
    'audit row not written': ("insert into public.clinic_full_record_edits(medical_record_id,created_by,request_key,request_hash,reason,before_rows,after_rows)\n values(p_record_id,auth.uid(),v_key,v_hash,'Tarik item: '||v_reason,v_before,v_after) returning id into v_audit;", "v_audit:=gen_random_uuid();"),
    'actor not recorded': ("billing_withdrawn_by=auth.uid(),", "billing_withdrawn_by=null,"),
    'inpatient stay no longer refused': ("if exists(select 1 from public.inpatient_records s where s.visit_id=p_visit_id) then", "if false then"),
    'archived visit no longer refused': ("if v_visit.archived_at is not null then", "if false then"),
    'invoice gates removed (explicit check AND clinic_can_correct_record)': [("if exists(select 1 from public.invoices i where i.visit_id=p_visit_id) then", "if false then\n  null;\n elsif false then"), ("if not public.clinic_can_correct_record(p_record_id) then", "if false then")],
    'already-withdrawn row accepted again': ("if rx.billing_withdrawn_at is not null then raise exception 'WITHDRAW_ALREADY", "if false then raise exception 'WITHDRAW_ALREADY"),
    'only the first id is withdrawn': ("where id=any(v_ids);\n select coalesce", "where id=v_ids[1];\n select coalesce"),
    'edit: withdrawn row accepted in save': ("if rx.record_withdrawn_at is not null then raise exception ''RECORD_INVALID: baris sudah ditarik", "if false then raise exception ''RECORD_INVALID: baris sudah ditarik"),
    'edit: removal guard counts withdrawn rows': ("'where medical_record_id=p_record_id and record_withdrawn_at is null and not(id=any(v_seen))'", "'where medical_record_id=p_record_id and not(id=any(v_seen))'"),
    'edit: removal guard keyed on billing_withdrawn_at (ranap meaning leaks into Edit)': ("'where medical_record_id=p_record_id and record_withdrawn_at is null and not(id=any(v_seen))'", "'where medical_record_id=p_record_id and billing_withdrawn_at is null and not(id=any(v_seen))'"),
    'history reader shows withdrawn rows': ("'from public.prescription_items pi where pi.medical_record_id = m.id and pi.record_withdrawn_at is null)'", "'from public.prescription_items pi where pi.medical_record_id = m.id)'"),
    'history reader keyed on billing_withdrawn_at (review blocker: ranap rows vanish retroactively)': ("'from public.prescription_items pi where pi.medical_record_id = m.id and pi.record_withdrawn_at is null)'", "'from public.prescription_items pi where pi.medical_record_id = m.id and pi.billing_withdrawn_at is null)'"),
    'withdrawn reader open to other branches': ("or not public.clinic_record_correction_actor(v_visit) then", "then"),
    'withdrawn reader lists rawat-inap cashier rows (keyed on billing_withdrawn_at)': ("where p.medical_record_id=p_record_id and p.record_withdrawn_at is not null and p.compound_recipe_id is null)", "where p.medical_record_id=p_record_id and p.billing_withdrawn_at is not null and p.compound_recipe_id is null)"),
    'RPC does not stamp the record marker': (",record_withdrawn_at=v_now\n where id=any(v_ids);", "\n where id=any(v_ids);"),
    'reason significance check removed (dots/zero-width accepted)': ("'g'))<5 then", "'g'))<0 then"),
    'zero-width characters count as significant (explicit list is what makes the rule locale-independent)': [("[[:space:][:punct:][:cntrl:]", "[\\x01-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\x7f"), ("\\u2000-\\u200f", "\\u2000-\\u200a")],
    'marker trigger not installed': ("create trigger aa_record_withdrawn_marker before insert or update of record_withdrawn_at,billing_withdrawn_at on public.prescription_items\n for each row execute function public.guard_record_withdrawn_marker();", "select 1;"),
    'client roles may write the marker directly': ("if current_user in ('authenticated','anon','service_role') and\n  ((tg_op='INSERT' and new.record_withdrawn_at", "if false and\n  ((tg_op='INSERT' and new.record_withdrawn_at"),
    'marker without billing_withdrawn_at allowed': ("if new.record_withdrawn_at is not null and new.billing_withdrawn_at is null then", "if false then"),
    'Tarik can be undone (no-undo guard removed)': ("if tg_op='UPDATE' and old.record_withdrawn_at is not null and (", "if false and ("),
    'patch not re-runnable (already-applied skip removed)': ("if n_new=1 then continue;\n  elsif n_new=0 and n_old=1 then", "if false then continue;\n  elsif n_new=0 and n_old=1 then"),
    'patch drift silently ignored (fail-closed removed)': ("else raise exception 'Tarik item anchor drift: % / %',p.signature,p.old_text;", "else null;"),
    'RPC is create (not or replace): re-run fails': ("create or replace function public.clinic_withdraw_record_items(", "create function public.clinic_withdraw_record_items("),
}


def build_chain(stack, selected):
    d = stack.enter_context(tempfile.TemporaryDirectory(prefix='chain.', dir=ROOT)); target = Path(d) / 'supabase/migrations'; target.mkdir(parents=True)
    for s in selected: (target / s.name).symlink_to(s)
    r.fixture.ROOT = Path(d)
    return stack.enter_context(r.NativePostgres(r.BIN))


def run_clone(db, name, text):
    db.sql(f'create database {name} template postgres;'); os.environ['PGDATABASE'] = name
    db.sql('begin;\n' + text + '\ncommit;'); start = len(RESULTS)
    try: run(x.Harness(db), setup=False, text=text)
    except Exception as e: check('HARNESS', False, str(e)[:400])
    os.environ.pop('PGDATABASE', None); return RESULTS[start:]


PATCHED = ['public.clinic_edit_queued_record(uuid,uuid,integer,jsonb,jsonb,text,text)', 'public.clinic_patient_clinical_history(uuid,uuid)']
NEW_FNS = ['public.clinic_withdraw_record_items(uuid,uuid,uuid[],text,text)', 'public.clinic_record_withdrawn_items(uuid)', 'public.guard_record_withdrawn_marker()']


def footprint(db):
    """Everything the migration may touch, as one comparable string (column, new functions, md5 of patched bodies, trigger, schema_migrations-free)."""
    col = db.sql("select count(*) from information_schema.columns where table_schema='public' and table_name='prescription_items' and column_name='record_withdrawn_at'")
    new = ','.join(db.sql(f"select (to_regprocedure('{f}') is not null)::text") for f in NEW_FNS)
    bodies = ','.join(db.sql(f"select md5(pg_get_functiondef('{f}'::regprocedure))") for f in PATCHED)
    trg = db.sql("select count(*) from pg_trigger where tgrelid='public.prescription_items'::regclass and tgname='aa_record_withdrawn_marker'")
    return f'col={col}|new={new}|patched={bodies}|trigger={trg}'


def psql_env(db, dbname): return {**os.environ, 'PSQLRC': '/dev/null', 'PGDATABASE': dbname}


def psql_timed(db, dbname, source, timeout=60):
    """Run SQL in an independent psql backend; returns (returncode, stderr, seconds). Never raises on SQL errors."""
    t = time.monotonic()
    try: res = subprocess.run(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=source, text=True, capture_output=True, env=psql_env(db, dbname), timeout=timeout)
    except subprocess.TimeoutExpired: return -1, f'BLOCKED: no result within {timeout}s (unbounded lock wait)', time.monotonic() - t
    return res.returncode, res.stderr, time.monotonic() - t


def atomic_checks(db, text):
    """Deploy-safety of the migration FILE on a database that does not have it yet: one transaction (no partial apply), bounded wait for the
    table lock (no unbounded lock queue on ALTER TABLE prescription_items), safe re-run. The apply tooling wraps the file in its own
    begin/commit (+ rollback probe), so the file itself must not contain begin/commit."""
    code = [l for l in text.splitlines() if l.strip() and not l.lstrip().startswith('--')]
    check('static: first statement of the file is `set local lock_timeout` <= 10s (before any DDL on prescription_items)', bool(re.match(r"set\s+local\s+lock_timeout\s*=\s*'([1-9]|10)s'\s*;\s*$", code[0], re.I)), dict(first=code[0][:120]))
    check('static: no top-level begin/commit/rollback in the file (a file-level commit would defeat a wrapping probe rollback / the wrapper transaction)', not any(re.match(r'(begin|start\s+transaction|commit|rollback|end)\s*;\s*$', l.strip(), re.I) for l in code), {})
    check('static: the file declares that it must be applied as one transaction', 'ONE TRANSACTION' in text, {})
    mk = lambda name: (db.sql(f'create database {name} template postgres;'), os.environ.__setitem__('PGDATABASE', name))
    wrap = lambda body: 'begin;\n' + body + '\ncommit;'
    try:
        mk('atom_base'); base = footprint(db)
        check('baseline cluster has no Tarik footprint (column absent, functions absent, trigger absent)', base.startswith('col=0|new=false,false,false|') and base.endswith('|trigger=0'), dict(base=base))
        # (1) forced failure mid-file: after column + RPC + reader + guard are created, BEFORE the patch block
        anchor = 'do $patch$'; assert text.count(anchor) == 1
        mid = text.replace(anchor, 'select 1/0;\n' + anchor)
        err = None
        try: db.sql(wrap(mid))
        except RuntimeError as e: err = str(e)
        after = footprint(db)
        check('forced failure mid-file (after column/RPC/reader created, before the patch block): NOTHING applied (no column, no new functions, patched functions byte-identical, no trigger)', has(err, 'division by zero') and after == base, dict(error=(err or '')[:160], after=after))
        # (2) real-world partial: anchor drift in a patched function -> whole file aborts, column/RPC not left behind
        mk('atom_drift')
        db.sql("do $d$ declare d text; begin d:=pg_get_functiondef('public.clinic_patient_clinical_history(uuid,uuid)'::regprocedure); execute replace(d,'from public.prescription_items pi where pi.medical_record_id = m.id)','from public.prescription_items pi where pi.medical_record_id = m.id and true)'); end $d$;")
        drift_base = footprint(db); err = None
        try: db.sql(wrap(text))
        except RuntimeError as e: err = str(e)
        check('anchor drift in a live function aborts the migration and leaves NOTHING applied (no column/RPC without the patches)', has(err, 'anchor drift') and footprint(db) == drift_base and drift_base.startswith('col=0|'), dict(error=(err or '')[:200], after=footprint(db)))
        # (3) bounded wait for the table lock: a long transaction holds the table, the migration must give up, not queue forever
        mk('atom_lock'); holder = subprocess.Popen(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=psql_env(db, 'atom_lock'))
        try:
            holder.stdin.write("begin;\nlock table public.prescription_items in access share mode;\nselect 'held';\nselect pg_sleep(60);\n"); holder.stdin.flush()
            assert holder.stdout.readline().strip() == 'held'
            rc, stderr, secs = psql_timed(db, 'atom_lock', wrap(text), timeout=40)
        finally:
            holder.kill(); holder.wait()
        lock_base = footprint(db)
        check('lock wait is bounded: with prescription_items held by another transaction the migration fails with lock timeout within ~5s (not blocked indefinitely), nothing applied',
              rc != 0 and 'lock timeout' in stderr and 3.5 <= secs <= 12 and lock_base == base, dict(rc=rc, seconds=round(secs, 1), stderr=stderr[:160], footprint=lock_base))
        # (4) clean apply in ONE transaction, then re-run is a no-op
        mk('atom_ok'); db.sql(wrap(text)); applied = footprint(db)
        check('applies in one transaction on a clean database: column, 3 functions, trigger present; both patched bodies changed', applied != base and applied.startswith('col=1|new=true,true,true|') and applied.endswith('|trigger=1') and applied.split('|')[2] != base.split('|')[2], dict(applied=applied))
        err = None
        try: db.sql(wrap(text))
        except RuntimeError as e: err = str(e)
        check('re-run on the migrated database changes nothing (footprint identical, no error)', err is None and footprint(db) == applied, dict(error=(err or '')[:200]))
        # (5) plain `psql -1` (single-transaction flag) behaves the same as the wrapper for the failing file
        mk('atom_1'); rc, stderr, _ = psql_timed(db, 'atom_1', mid)
        # without a wrapper psql runs statements autocommit => this documents WHY the file must be applied as one transaction
        partial = footprint(db)
        res = subprocess.run(db.as_user + [db.psql, '-X', '-qAt', '-1', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-d', 'atom_base'], input=mid, text=True, capture_output=True, env=psql_env(db, 'atom_base'))
        check('psql -1 (single transaction) on the failing file leaves nothing applied', res.returncode != 0 and footprint_for(db, 'atom_base') == base, dict(rc=res.returncode, stderr=res.stderr[:120]))
        check('control (documents the hazard): the same failing file WITHOUT a wrapping transaction leaves a partial apply (column + RPC created, patches missing)', rc != 0 and partial.startswith('col=1|') and partial != base, dict(partial=partial))
    finally: os.environ.pop('PGDATABASE', None)


def footprint_for(db, name):
    old = os.environ.get('PGDATABASE'); os.environ['PGDATABASE'] = name
    try: return footprint(db)
    finally:
        if old is None: os.environ.pop('PGDATABASE', None)
        else: os.environ['PGDATABASE'] = old


def main():
    p = argparse.ArgumentParser(); p.add_argument('--baseline', action='store_true'); p.add_argument('--mutations', action='store_true'); p.add_argument('--atomic-only', action='store_true'); p.add_argument('--migration', type=Path, help='override the candidate file text (RED evidence against an older revision)'); p.add_argument('--pg-bin'); p.add_argument('--json', type=Path, required=True); a = p.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    sources = sorted((ROOT / 'supabase/migrations').glob('*.sql')); text = (a.migration or ROOT / 'supabase/migrations' / CANDIDATE).read_text(); extra = {}
    selected = [s for s in sources if not ((a.baseline or a.mutations or a.atomic_only) and s.name == CANDIDATE)]
    try:
        with contextlib.ExitStack() as stack:
            db = build_chain(stack, selected); r.fixture.DisposablePostgres.bootstrap(db)
            if a.atomic_only: atomic_checks(db, text)
            elif a.mutations:
                x.setup(x.Harness(db)); setup_extra(x.Harness(db))
                control = run_clone(db, 'mut_control', text); extra['control_fail'] = sum(c['status'] == 'FAIL' for c in control); extra['mutants'] = {}
                for i, (name, pairs) in enumerate(MUTANTS.items()):
                    mutated = text
                    for anchor, repl in (pairs if isinstance(pairs, list) else [pairs]):
                        assert mutated.count(anchor) == 1, f'mutant anchor not unique/stale: {name} ({mutated.count(anchor)})'
                        mutated = mutated.replace(anchor, repl)
                    res = run_clone(db, f'mut_{i}', mutated); failed = [c['case'] for c in res if c['status'] == 'FAIL']
                    extra['mutants'][name] = dict(killed=bool(failed), failing_cases=failed); print('MUTANT', 'KILLED' if failed else 'SURVIVED', name, len(failed), flush=True)
            else: run(x.Harness(db))
    except Exception as e: check('HARNESS', False, str(e)[:600])
    if not a.mutations and not a.atomic_only:
        try:
            with contextlib.ExitStack() as stack2:
                base_sel = [s for s in sources if s.name != CANDIDATE]
                db2 = build_chain(stack2, base_sel); r.fixture.DisposablePostgres.bootstrap(db2)
                atomic_checks(db2, text)
        except Exception as e: check('HARNESS atomic', False, str(e)[:600])
    totals = {s: sum(c['status'] == s for c in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='MUTATIONS' if a.mutations else 'RED' if a.baseline else 'candidate', migration_count=len(selected), cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals, extra.get('mutants') and {k: v['killed'] for k, v in extra['mutants'].items()})
    if a.mutations: return int(extra.get('control_fail', 1) > 0 or not all(v['killed'] for v in extra.get('mutants', {}).values()))
    return int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
