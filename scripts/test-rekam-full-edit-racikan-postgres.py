#!/usr/bin/env python3
"""LOCAL ONLY: racikan baru dari layar "Ubah" (edit lengkap rekam medis) — dua langkah.

koreksiRekamMedisLengkap (src/app/(app)/klinik/rekam-medis/[visitId]/actions.ts):
  1. clinic_edit_queued_record(visit, record, revision, changes, rows_tanpa_racikan_baru, reason, key)
  2. clinic_add_record_items(visit, key || ':racikan', '[]', racikanCompounds(racikan_baru))

Harness ini memasang SELURUH migrasi repositori ke klaster PostgreSQL lokal sekali pakai
(pola scripts/test-rekam-full-edit-postgres.py dan scripts/test-item-susulan-full-schema-postgres.py,
fixture dari scripts/test-ranap-racikan-postgres.py), lalu memanggil RPC PUBLIK sebagai
`authenticated` dengan klaim JWT pengguna fiktif. Tidak ada stub bisnis; hanya platform
Supabase (auth/storage) yang ditiru. Muatan p_rows/p_compounds dibentuk ulang di Python
persis seperti RekamForm (cart dari prescription_items) + aksi server + racikanCompounds()
+ toClinicCompoundRecipeInput() (src/lib/klinik-posting.ts) + masterCompoundCartRow().

Ini uji integrasi basis data, BUKAN UAT browser/Next.js. Semua data fiktif.
Keluar 0 hanya bila semua kasus PASS.
"""
import argparse
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


x = load('ranap_racikan', 'test-ranap-racikan-postgres.py')
r, c = x.r, x.c
q, j = r.q, r.j
MATERIAL, SKU = x.MATERIAL, x.SKU
SHORT = r.uid('e', 2190)  # bahan racik dengan stok sengaja kurang (kasus 4)
RESULTS = []
CHANGES = dict(anamnesis='Anamnesis Ubah Fiktif', diagnosis='Diagnosis Ubah Fiktif', therapy='Terapi Ubah Fiktif',
               suhu=38.5, gejala_klinis=None, hasil_penunjang=None)
REASON = 'Tambah racikan lewat Ubah (fiktif)'


def check(case, ok, detail):
    RESULTS.append(dict(case=case, status='PASS' if ok else 'FAIL', detail=detail))
    print(RESULTS[-1]['status'], case, json.dumps(detail, ensure_ascii=False, default=str), flush=True)
    return ok


def num(value):
    """JSON number the way JS Number() + JSON.stringify would emit it."""
    n = float(value)
    return int(n) if n.is_integer() else n


# ---------------------------------------------------------------------------
# App payload builders (mirrors of the TypeScript, kept literal on purpose)
# ---------------------------------------------------------------------------
def service_performer_input(value):  # src/lib/service-performers.ts servicePerformerInput
    if value is None:
        return dict(doctor_id=None, staff_id=None)
    return dict(doctor_id=(value.get('doctor_id') or None), staff_id=(value.get('staff_id') or None))


def to_clinic_compound_recipe_input(recipe_name, dosage_instruction, dosage_form, ingredients):
    # src/lib/klinik-posting.ts toClinicCompoundRecipeInput
    return dict(
        recipe_name=recipe_name.strip(),
        dosage_instruction=(dosage_instruction or '').strip() or None,
        dosage_form=(dosage_form or '').strip() or 'lainnya',
        ingredients=[dict(item_id=b['item_id'], quantity=num(b['qty']),
                          unit=(b.get('satuan') or '').strip() or 'pcs',
                          unit_price=num(b.get('harga') or 0)) for b in ingredients])


def racikan_compounds(resep):
    # actions.ts racikanCompounds()
    out = []
    for row in resep:
        if row.get('jenis') != 'racikan' or not (row.get('official_version_id') or len(row.get('ingredients') or []) > 0):
            continue
        if row.get('official_version_id'):
            item = dict(official_version_id=row['official_version_id'])
            if row.get('sale_item_id'):
                item['sale_item_id'] = row['sale_item_id']
            item['request_key'] = row.get('key') or ''
            item['dosage_instruction'] = row.get('aturan_pakai')
            if row.get('service_performers') is not None:
                item['service_performers'] = service_performer_input(row['service_performers'])
        else:
            item = dict(request_key=row.get('key') or '')
            if row.get('service_performers') is not None:
                item['service_performers'] = service_performer_input(row['service_performers'])
            if row.get('sale_item_id'):
                item['sale_item_id'] = row['sale_item_id']
            item['recipe'] = to_clinic_compound_recipe_input(
                row['nama_obat'], row.get('aturan_pakai'), row.get('dosage_form'),
                [b for b in (row.get('ingredients') or []) if b.get('item_id') and float(b.get('qty') or 0) > 0])
        out.append(item)
    return out


def official_cart_row(version, performer):
    # src/lib/master-compound-cart.ts masterCompoundCartRow (formula branch) + barisDefault()
    return dict(key=str(uuid.uuid4()), item_id=None, sale_item_id=SKU, nama_obat='Obat Racik Fiktif', qty=1,
                satuan='racikan', faktor=1, harga=20000, jenis='racikan', official_version_id=version,
                ingredients=[dict(item_id=MATERIAL, nama='Bahan racik Fiktif', qty=2, satuan='gram', harga=5000)],
                dosage_form='kapsul', aturan_pakai='Instruksi Fiktif',
                service_performers=dict(doctor_id=performer, staff_id=None))


def custom_cart_row(material, qty, performer, instruction='Puyer Fiktif 2x1 bungkus'):
    # masterCompoundCartRow (custom branch, allowCustom): official_version_id undefined
    return dict(key=str(uuid.uuid4()), item_id=None, sale_item_id=SKU, nama_obat='Obat Racik Fiktif', qty=1,
                satuan='racikan', faktor=1, harga=20000, jenis='racikan',
                ingredients=[dict(item_id=material, nama='Bahan Fiktif', qty=qty, satuan='gram', harga=5000)],
                dosage_form='kapsul', aturan_pakai=instruction,
                service_performers=dict(doctor_id=performer, staff_id=None))


PAGE_COLUMNS = ['id', 'item_id', 'nama_obat', 'qty', 'harga', 'satuan', 'faktor', 'aturan_pakai', 'jenis', 'kategori',
                'service_performers', 'compound_recipe_id', 'bmhp_components', 'susulan_at', 'susulan_by_name', 'susulan_source']


def page_rows(h, m, user):
    """page.tsx: prescription_items select ... order by created_at, read as the signed-in user."""
    cols = ','.join(f"'{col}',p.{col}" for col in PAGE_COLUMNS)
    return json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object({cols}) order by p.created_at,p.id),'[]') "
                              f"from public.prescription_items p where p.medical_record_id={q(m)};", user))


def page_cart(rows):
    """RekamForm useState(cart) for correction.fullEdit."""
    cart = []
    for index, row in enumerate(rows):
        cart.append(dict(
            key=row.get('id') or f'saved-{index}', prescription_item_id=row.get('id'), item_id=row.get('item_id'),
            nama_obat=row['nama_obat'], qty=num(row['qty']), satuan=row.get('satuan') or 'pcs',
            harga=num(row.get('harga') or 0), faktor=num(row.get('faktor') or 1),
            jenis='racikan' if row.get('compound_recipe_id') else ('jasa' if row.get('jenis') == 'jasa' else 'obat'),
            kategori=row.get('kategori'), aturan_pakai=row.get('aturan_pakai'),
            compound_recipe_id=row.get('compound_recipe_id'), service_performers=row.get('service_performers'),
            bmhp=None if row.get('bmhp_components') is None else
            [dict(material, nama=material.get('name') or material.get('item_id')) for material in row['bmhp_components']]))
    return cart


def bmhp_input(value):  # src/lib/procedure-bmhp.ts bmhpInput
    if value is None:
        return []
    return [dict(item_id=row['item_id'].strip(), qty=num(row['qty']), unit=row['unit'].strip()) for row in value]


def action_split(cart, request_key):
    """koreksiRekamMedisLengkap: p_rows for step 1, racikanCompounds for step 2, and step-2 key."""
    def baru(row):
        return row.get('jenis') == 'racikan' and not row.get('compound_recipe_id') and not row.get('prescription_item_id')
    racikan_baru = [row for row in cart if baru(row)]
    assert len(racikan_baru) <= 50
    assert not any(not row.get('official_version_id') and not [b for b in (row.get('ingredients') or [])
                   if b.get('item_id') and float(b.get('qty') or 0) > 0] for row in racikan_baru)
    rows = [dict(prescription_item_id=row.get('prescription_item_id'), item_id=row.get('item_id'),
                 nama_obat=row['nama_obat'], qty=row['qty'], harga=row['harga'], satuan=row.get('satuan'), jenis=row.get('jenis'),
                 kategori=row.get('kategori'), aturan_pakai=row.get('aturan_pakai'),
                 compound_recipe_id=row.get('compound_recipe_id'),
                 bmhp_components=bmhp_input(row.get('bmhp')), service_performers=row.get('service_performers'))
            for row in cart if not baru(row)]
    return rows, racikan_compounds(racikan_baru), f'{request_key}:racikan'


def edit_sql(v, m, revision, rows, key, changes=CHANGES):
    return (f"select public.clinic_edit_queued_record({q(v)},{q(m)},{revision},{j(changes)},{j(rows)},"
            f"{q(REASON)},{q(key)});")


def add_sql(v, key, compounds):
    return f"select public.clinic_add_record_items({q(v)},{q(key)},'[]'::jsonb,{j(compounds)});"


# ---------------------------------------------------------------------------
# Fixtures and readback
# ---------------------------------------------------------------------------
def setup(h):
    version = x.setup(h)  # dasar_sql + MATERIAL(500 gram, layer 500@1000) + SKU + official formula (2 gram)
    h.sql(f"""
insert into public.items(id,code,name,unit,item_type,is_active,is_compound_material,sell_price,buy_price)
 values({q(SHORT)},'UJI-RACIK-LANGKA','Bahan langka Fiktif','gram','Persediaan',true,true,4000,1000);
insert into public.stock(warehouse_id,item_id,qty) values({q(r.WH)},{q(SHORT)},1);
insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
 values({q(r.WH)},{q(SHORT)},current_date,1,1,1000,'purchase');
""")
    return version


def saved_visit(h, n):
    """Outpatient visit saved through the ORIGINAL initial-record RPC (DOCTOR), queued at Pembayaran, unbilled."""
    v = r.buat_kunjungan(h, n, r.buat_pelanggan(h, n), admitted=False)
    seed = r.uid(7, n)
    h.sql(f"delete from public.prescription_items where medical_record_id={q(seed)};"
          f"delete from public.medical_records where id={q(seed)};"
          f"update public.visits set status='Diperiksa',service_started_at=now(),poli='Umum' where id={q(v)};")
    fields = dict(anamnesis='Awal Fiktif', diagnosis='Diagnosis awal', therapy='Terapi awal', suhu=38.25, berat=3, penunjang_urls=[])
    ordinary = [dict(item_id=r.ITEM, nama_obat='Obat Fiktif', qty=1, harga=25000, satuan='pcs', faktor=1, jenis='obat')]
    h.sql(f"select public.clinic_save_initial_record({q(v)},{q(r.uid(5, n))},{j(fields)},'[]',{j(ordinary)},'[]',null,"
          f"{q(r.DOKTER_PEGAWAI)},'Dokter Fiktif','Keluhan awal Fiktif',{q('initial-racikan-' + str(n))});", r.DOCTOR)
    m = h.nilai(f'select id from public.medical_records where visit_id={q(v)};')
    return v, m


def snap(h, v, m):
    return json.loads(h.nilai(f"""select json_build_object(
 'revision',(select clinical_revision from public.medical_records where id={q(m)}),
 'records',(select count(*) from public.medical_records where visit_id={q(v)}),
 'rx',(select count(*) from public.prescription_items where medical_record_id={q(m)}),
 'compound_rx',(select count(*) from public.prescription_items where medical_record_id={q(m)} and compound_recipe_id is not null),
 'recipes',(select count(*) from public.compounding_recipes where medical_record_id={q(m)}),
 'issues',(select count(*) from public.compound_issues ci join public.compounding_recipes cr on cr.id=ci.recipe_id where cr.medical_record_id={q(m)}),
 'material',(select qty from public.stock where warehouse_id={q(r.WH)} and item_id={q(MATERIAL)}),
 'material_layers',(select sum(qty_left) from public.stock_layers where item_id={q(MATERIAL)}),
 'material_moves',(select count(*) from public.stock_moves where item_id={q(MATERIAL)}),
 'short',(select qty from public.stock where warehouse_id={q(r.WH)} and item_id={q(SHORT)}),
 'short_layers',(select sum(qty_left) from public.stock_layers where item_id={q(SHORT)}),
 'invoices',(select count(*) from public.invoices where visit_id={q(v)}),
 'full_edits',(select count(*) from public.clinic_full_record_edits where medical_record_id={q(m)}),
 'corrections',(select count(*) from public.clinic_record_corrections where medical_record_id={q(m)}),
 'additions',(select count(*) from public.clinic_record_item_additions where visit_id={q(v)}),
 'anamnesis',(select anamnesis from public.medical_records where id={q(m)}));"""))


def compound_rows(h, m):
    return json.loads(h.nilai(f"""select coalesce(jsonb_agg(jsonb_build_object(
 'id',p.id,'record',p.medical_record_id,'jenis',p.jenis,'qty',p.qty,'harga',p.harga,'recipe',p.compound_recipe_id,
 'recipe_key',cr.request_key,'recipe_record',cr.medical_record_id,'susulan_source',p.susulan_source,
 'susulan_by',p.susulan_by,'susulan_at_set',p.susulan_at is not null,'aturan_pakai',p.aturan_pakai,
 'ingredients',(select jsonb_agg(jsonb_build_object('item',i.item_id,'quantity',i.quantity) order by i.item_id) from public.compounding_ingredients i where i.recipe_id=cr.id),
 'issued',(select coalesce(sum(ci.qty),0) from public.compound_issues ci where ci.recipe_id=cr.id)) order by cr.request_key),'[]')
 from public.prescription_items p join public.compounding_recipes cr on cr.id=p.compound_recipe_id
 where p.medical_record_id={q(m)};"""))


def full_row_dump(h, m):
    return h.nilai(f"select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.prescription_items p where p.medical_record_id={q(m)};")


def invoice_sql(h, v, m, key):
    rows = page_rows(h, m, None)
    lines = [dict(description=row['nama_obat'], qty=num(row['qty']), price=num(row['harga']), kind='jasa' if row['jenis'] == 'jasa' else 'obat',
                  item_id=row['item_id'], unit=row['satuan'], prescription_item_id=row['id'], discount_percent=0) for row in rows]
    total = sum(line['qty'] * line['price'] for line in lines)
    invoice = dict(tanggal='2026-10-30', subtotal=total, discount=0, tax=0, total=total, dp_amount=0, paid_status='Belum Lunas',
                   metode_bayar='Tunai', shift_id=r.SHIFT[r.OWNER], dp_override_reason='Uji fiktif racikan Ubah')
    return (f"select public.clinic_post_invoice_with_record({q(v)},{q(key)},{j(invoice)},{j(lines)},"
            f"p_cart_version=>public.clinic_outpatient_cart_version({q(v)}));")


def delta(before, after, key):
    return float(after[key] or 0) - float(before[key] or 0)


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------
def case_two_step(h, version, n, actor, label):
    """Cases 1-3 for one actor. Returns nothing; every outcome is recorded."""
    v, m = saved_visit(h, n)
    eligible = h.nilai(f'select public.clinic_can_correct_record({q(m)});', actor)
    s0 = snap(h, v, m)
    if not check(f'[{label}] fixture: saved queued unbilled record via original initial RPC, editable',
                 eligible == 't' and s0['revision'] == 0 and s0['rx'] == 1 and s0['invoices'] == 0 and s0['records'] == 1,
                 dict(can_correct=eligible, state=s0)):
        return
    performer = r.DOKTER_PEGAWAI
    cart = page_cart(page_rows(h, m, actor))
    official = official_cart_row(version, performer)
    custom = custom_cart_row(MATERIAL, 3, performer)
    cart += [official, custom]
    request_key = str(uuid.uuid4())
    rows, compounds, racikan_key = action_split(cart, request_key)
    step1 = edit_sql(v, m, s0['revision'], rows, request_key)
    step2 = add_sql(v, racikan_key, compounds)
    shape_ok = (len(rows) == 1 and rows[0]['jenis'] == 'obat' and len(compounds) == 2
                and compounds[0].get('official_version_id') == version and compounds[0].get('sale_item_id') == SKU
                and 'recipe' not in compounds[0] and compounds[1].get('sale_item_id') == SKU
                and compounds[1]['recipe']['ingredients'] == [dict(item_id=MATERIAL, quantity=3, unit='gram', unit_price=5000)])
    check(f'[{label}] payload shape mirrors racikanCompounds (official+SKU, custom recipe+SKU) and p_rows excludes new racikan',
          shape_ok, dict(p_rows=rows, p_compounds=compounds, racikan_key=racikan_key))

    # ---- 1) step 1 then step 2 ------------------------------------------------
    err1 = None
    try:
        out1 = h.nilai(step1, actor)
    except RuntimeError as e:
        out1, err1 = None, str(e)
    s1 = snap(h, v, m)
    err2 = None
    try:
        out2 = h.nilai(step2, actor)
    except RuntimeError as e:
        out2, err2 = None, str(e)
    s2 = snap(h, v, m)
    comp = compound_rows(h, m)
    keys = sorted([official['key'], custom['key']])
    actor_ok = all(row['susulan_by'] == actor for row in comp)
    ok = (out1 == m and out2 == m and not err1 and not err2
          and s1['revision'] == 1 and s2['revision'] == 1 and s2['full_edits'] == 1 and s2['corrections'] == 1
          and s1['anamnesis'] == CHANGES['anamnesis']
          and s2['records'] == 1 and s2['rx'] == s0['rx'] + 2 and s2['compound_rx'] == 2 and s2['recipes'] == 2
          and sorted(row['recipe_key'] for row in comp) == keys
          and all(row['record'] == m and row['recipe_record'] == m and row['susulan_source'] == 'dokter' and row['susulan_at_set'] for row in comp)
          and actor_ok
          and delta(s0, s1, 'material') == 0 and delta(s1, s2, 'material') == -5 and delta(s1, s2, 'material_layers') == -5
          and sorted(float(row['issued']) for row in comp) == [2.0, 3.0]
          and s2['invoices'] == 0 and s2['additions'] == 1)
    check(f'[{label}] 1) step1 edit rev0 + step2 clinic_add_record_items: revision +1 once, 2 compound Rx on same record with susulan marker, '
          'ingredient stock -5 once, no invoice', ok,
          dict(step1=dict(result=out1, error=err1), step2=dict(result=out2, error=err2),
               before=s0, after_step1=s1, after_step2=s2, compound_rows=comp))
    if err1 or err2:
        return

    # ---- 2) exact replay of both calls ---------------------------------------
    rows_before = full_row_dump(h, m)
    errs = {}
    for name, sql in (('step1', step1), ('step2', step2)):
        try:
            errs[name] = dict(result=h.nilai(sql, actor))
        except RuntimeError as e:
            errs[name] = dict(error=str(e))
    s3 = snap(h, v, m)
    check(f'[{label}] 2) exact replay of step1 and step2 (same keys): same record, no new rows, no second stock issue, revision unchanged',
          errs['step1'].get('result') == m and errs['step2'].get('result') == m and s3 == s2 and full_row_dump(h, m) == rows_before,
          dict(replay=errs, before=s2, after=s3))
    # changed-content reuse of the step-2 key must not issue anything either
    changed = [dict(compounds[0], dosage_instruction='Instruksi lain Fiktif'), compounds[1]]
    err = h.gagal(add_sql(v, racikan_key, changed), actor)
    check(f'[{label}] 2b) same racikan key with different content -> IDEMPOTENCY_CONFLICT, nothing issued',
          bool(err and 'IDEMPOTENCY_CONFLICT' in err) and snap(h, v, m) == s2, dict(error=err))

    # ---- 3) next full edit (revision 1) with ALL current rows -----------------
    loaded = page_rows(h, m, actor)
    cart2 = page_cart(loaded)
    for row in cart2:
        if row['jenis'] == 'obat':
            row['qty'] = 2
    key2 = str(uuid.uuid4())
    rows2, compounds2, _ = action_split(cart2, key2)
    compound_before = h.nilai(f"select jsonb_agg(to_jsonb(p) order by p.id) from public.prescription_items p where p.medical_record_id={q(m)} and p.compound_recipe_id is not null;")
    err = h.gagal(edit_sql(v, m, 1, rows2, key2, dict(CHANGES, diagnosis='Diagnosis revisi 2 Fiktif')), actor)
    s4 = snap(h, v, m)
    ordinary_qty = h.angka(f"select qty from public.prescription_items where medical_record_id={q(m)} and compound_recipe_id is null;")
    check(f'[{label}] 3) next Ubah (revision 1) resending loaded compound rows succeeds, no re-issue, compound rows untouched',
          not err and len(compounds2) == 0 and sum(1 for row in rows2 if row['compound_recipe_id']) == 2
          and s4['revision'] == 2 and s4['rx'] == s2['rx'] and s4['recipes'] == 2 and s4['issues'] == s2['issues']
          and s4['material'] == s2['material'] and s4['material_layers'] == s2['material_layers']
          and s4['material_moves'] == s2['material_moves'] and s4['invoices'] == 0 and ordinary_qty == 2
          and h.nilai(f"select jsonb_agg(to_jsonb(p) order by p.id) from public.prescription_items p where p.medical_record_id={q(m)} and p.compound_recipe_id is not null;") == compound_before,
          dict(error=err, p_rows=rows2, before=s2, after=s4, ordinary_qty=ordinary_qty))
    if err:
        return
    # ---- 3b) a later Ubah may add another racikan with a new key ---------------
    cart3 = page_cart(page_rows(h, m, actor)) + [official_cart_row(version, performer)]
    key3 = str(uuid.uuid4())
    rows3, compounds3, racikan_key3 = action_split(cart3, key3)
    e1 = h.gagal(edit_sql(v, m, 2, rows3, key3), actor)
    e2 = h.gagal(add_sql(v, racikan_key3, compounds3), actor) if not e1 else 'skipped'
    s5 = snap(h, v, m)
    check(f'[{label}] 3b) later Ubah (revision 2) adds one more official racikan: revision 3, +1 compound Rx, stock -2',
          not e1 and not e2 and s5['revision'] == 3 and s5['compound_rx'] == 3 and delta(s4, s5, 'material') == -2 and s5['invoices'] == 0,
          dict(step1_error=e1, step2_error=e2, before=s4, after=s5))


def case_stock_short(h, version, n):
    v, m = saved_visit(h, n)
    s0 = snap(h, v, m)
    performer = r.DOKTER_PEGAWAI
    cart = page_cart(page_rows(h, m, r.DOCTOR))
    cart[0]['qty'] = 2
    # The official compound (plenty of MATERIAL) is issued FIRST inside step 2; the custom one then lacks stock.
    cart += [official_cart_row(version, performer), custom_cart_row(SHORT, 5, performer)]
    key = str(uuid.uuid4())
    rows, compounds, racikan_key = action_split(cart, key)
    err1 = h.gagal(edit_sql(v, m, 0, rows, key), r.DOCTOR)
    s1 = snap(h, v, m)
    err2 = h.gagal(add_sql(v, racikan_key, compounds), r.DOCTOR)
    s2 = snap(h, v, m)
    qty = h.angka(f"select qty from public.prescription_items where medical_record_id={q(m)} and compound_recipe_id is null;")
    check('4) step-2 ingredient short: clinic_add_record_items raises STOCK_SHORT/LAYER_SHORT; step-1 edit stays committed; no partial compound rows or stock',
          not err1 and bool(err2 and ('STOCK_SHORT' in err2 or 'LAYER_SHORT' in err2))
          and s1['revision'] == 1 and s2['revision'] == 1 and s2['full_edits'] == 1 and qty == 2 and s2['anamnesis'] == CHANGES['anamnesis']
          and s2['rx'] == s0['rx'] and s2['compound_rx'] == 0 and s2['recipes'] == 0 and s2['issues'] == 0
          and s2['material'] == s1['material'] and s2['material_layers'] == s1['material_layers'] and s2['material_moves'] == s1['material_moves']
          and s2['short'] == s1['short'] == 1 and s2['additions'] == 0 and s2['invoices'] == 0,
          dict(step1_error=err1, step2_error=err2, before=s0, after_step1=s1, after_step2=s2, ordinary_qty=qty))
    # Failed attempt did not burn the key: once stock arrives, the same step-2 call succeeds exactly once.
    h.sql(f"update public.stock set qty=qty+10 where warehouse_id={q(r.WH)} and item_id={q(SHORT)};"
          f"insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values({q(r.WH)},{q(SHORT)},current_date,10,10,1000,'purchase');")
    s3 = snap(h, v, m)
    err3 = h.gagal(add_sql(v, racikan_key, compounds), r.DOCTOR)
    s4 = snap(h, v, m)
    err4 = h.gagal(add_sql(v, racikan_key, compounds), r.DOCTOR)
    s5 = snap(h, v, m)
    check('4b) after restock the same step-2 key succeeds once (failed attempt left no idempotency record), replay is effect-free',
          not err3 and not err4 and s4['compound_rx'] == 2 and delta(s3, s4, 'short') == -5 and delta(s3, s4, 'material') == -2
          and s4['revision'] == 1 and s5 == s4,
          dict(retry_error=err3, replay_error=err4, before=s3, after=s4, after_replay=s5))


def case_invoice_between(h, version, n):
    v, m = saved_visit(h, n)
    performer = r.DOKTER_PEGAWAI
    cart = page_cart(page_rows(h, m, r.DOCTOR)) + [official_cart_row(version, performer), custom_cart_row(MATERIAL, 3, performer)]
    key = str(uuid.uuid4())
    rows, compounds, racikan_key = action_split(cart, key)
    err1 = h.gagal(edit_sql(v, m, 0, rows, key), r.DOCTOR)
    s1 = snap(h, v, m)
    err_post = h.gagal(invoice_sql(h, v, m, 'racikan-between-' + str(n)), r.OWNER)
    s_post = snap(h, v, m)
    err2 = h.gagal(add_sql(v, racikan_key, compounds), r.DOCTOR)
    s2 = snap(h, v, m)
    check('5) invoice posted between step 1 and step 2: step 2 raises RECORD_LOCKED and issues nothing',
          not err1 and not err_post and s_post['invoices'] == 1 and bool(err2 and 'RECORD_LOCKED' in err2)
          and s2['revision'] == 1 and s2['rx'] == s1['rx'] and s2['compound_rx'] == 0 and s2['recipes'] == 0
          and s2['material'] == s1['material'] and s2['material_layers'] == s1['material_layers']
          and s2['material_moves'] == s1['material_moves'] and s2['additions'] == s_post['additions'],
          dict(step1_error=err1, post_error=err_post, step2_error=err2, after_step1=s1, after_post=s_post, after_step2=s2))


def case_invoice_race(h, db, version, n):
    """5b: cashier posting holds the billing coordinator while step 2 is already in flight."""
    v, m = saved_visit(h, n)
    performer = r.DOKTER_PEGAWAI
    cart = page_cart(page_rows(h, m, r.DOCTOR)) + [official_cart_row(version, performer), custom_cart_row(MATERIAL, 3, performer)]
    key = str(uuid.uuid4())
    rows, compounds, racikan_key = action_split(cart, key)
    err1 = h.gagal(edit_sql(v, m, 0, rows, key), r.DOCTOR)
    s1 = snap(h, v, m)
    post = invoice_sql(h, v, m, 'racikan-race-' + str(n))
    barriers = []
    with contextlib.ExitStack() as stack:
        observer = stack.enter_context(c.Session(db, 'racikan-observer'))
        cashier = stack.enter_context(c.Session(db, 'racikan-cashier', r.OWNER))
        doctor = stack.enter_context(c.Session(db, 'racikan-doctor', r.DOCTOR))
        cashier.sql('begin;' + post)
        doctor.send('begin;' + add_sql(v, racikan_key, compounds))
        c.wait_block(observer, doctor, cashier, barriers)
        cashier.sql('commit;')
        out = c.attempt(doctor)
    s2 = snap(h, v, m)
    check('5b) concurrent: step 2 waits on billing coordinator behind cashier posting, then RECORD_LOCKED, nothing issued',
          not err1 and len(barriers) == 1 and barriers[0]['wait_event'] == 'advisory' and not out['ok']
          and 'RECORD_LOCKED' in out.get('error', '') and s2['invoices'] == 1 and s2['revision'] == 1
          and s2['compound_rx'] == 0 and s2['recipes'] == 0 and s2['material'] == s1['material']
          and s2['material_moves'] == s1['material_moves'],
          dict(step1_error=err1, outcome=out, barriers=barriers, after_step1=s1, after=s2))


def run(h, db):
    version = setup(h)
    case_two_step(h, version, 2101, r.DOCTOR, 'DOCTOR')
    case_two_step(h, version, 2111, r.OWNER, 'OWNER')
    case_stock_short(h, version, 2121)
    case_invoice_between(h, version, 2131)
    case_invoice_race(h, db, version, 2141)
    check('journals balanced per entry after all cases',
          h.angka('select count(*) from (select entry_id from public.journal_lines group by entry_id having sum(debit)<>sum(credit)) t') == 0, {})


def main():
    default_bin = os.environ.get('KAMO_PG_BIN') or ('/usr/lib/postgresql/16/bin' if Path('/usr/lib/postgresql/16/bin/initdb').exists()
                                                    else '/opt/data/kamo-pg-harness/bin')
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--pg-bin', default=default_bin, help='directory holding initdb/pg_ctl/postgres (default %(default)s)')
    p.add_argument('--json', type=Path, help='write results JSON here')
    a = p.parse_args()
    # NativePostgres and the shared harness create their throwaway dirs under /opt/data.
    Path('/opt/data').mkdir(parents=True, exist_ok=True)
    migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    try:
        with tempfile.TemporaryDirectory(prefix='kamo-ubah-racikan-', dir='/opt/data') as folder:
            target = Path(folder) / 'supabase/migrations'
            target.mkdir(parents=True)
            for source in migrations:
                (target / source.name).symlink_to(source)
            r.fixture.ROOT = Path(folder)
            with r.NativePostgres(a.pg_bin) as db:
                r.fixture.DisposablePostgres.bootstrap(db)
                run(x.Harness(db), db)
    except Exception as error:  # noqa: BLE001 - reported as a failing case, never swallowed
        check('HARNESS', False, repr(error))
    totals = {s: sum(row['status'] == s for row in RESULTS) for s in ('PASS', 'FAIL')}
    if a.json:
        a.json.write_text(json.dumps(dict(migration_count=len(migrations), last_migration=migrations[-1].name,
                                          totals=totals, cases=RESULTS), indent=2, ensure_ascii=False, default=str))
    print('TOTAL', totals, flush=True)
    return int(totals['FAIL'] > 0 or totals['PASS'] == 0)


if __name__ == '__main__':
    sys.exit(main())
