#!/usr/bin/env python3
"""Racikan baru dari layar Edit rekam medis (laporan Anisa 1 Nov 2026), seluruh rantai migrasi main.

LOCAL ONLY: PostgreSQL sekali-pakai lewat Unix socket, tanpa URL/kredensial jarak jauh, data fiktif.
Memanggil RPC publik yang sebenarnya sebagai aktor JWT `authenticated` (bukan stub bisnis).
Ini uji integrasi database, BUKAN UAT browser/Next.js.

--baseline menjalankan rantai TANPA kandidat: pembungkus belum ada (RED yang diharapkan).
"""
import argparse
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = '20261106020000_racikan_baru_di_edit_rekam_medis.sql'
spec = importlib.util.spec_from_file_location('ranap_racikan', ROOT / 'scripts/test-ranap-racikan-postgres.py')
assert spec and spec.loader
x = importlib.util.module_from_spec(spec)
spec.loader.exec_module(x)
r, q, j = x.r, x.q, x.j
RESULTS = []
FIELDS = dict(anamnesis='Koreksi Fiktif', diagnosis='Diagnosis Fiktif', therapy=None, suhu=38.25, gejala_klinis=None, hasil_penunjang=None)


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail))
    print(RESULTS[-1]['status'], name, json.dumps(detail, ensure_ascii=False, default=str), flush=True)


def visit(h, n):
    """Rawat jalan fiktif yang sudah disimpan dokter, tahap Pembayaran, belum ada tagihan."""
    v = r.buat_kunjungan(h, n, r.buat_pelanggan(h, n), admitted=False)
    m = r.uid(7, n)
    h.sql(f"update medical_records set submission_key='initial-{n}',submitted_by={q(r.DOCTOR)} where id={q(m)};"
          f" update visits set status='Pembayaran',service_started_at=now()-interval '10 minutes',service_finished_at=now() where id={q(v)};")
    return v, m


def rows(h, m):
    return json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(p) order by created_at,id),'[]') from prescription_items p where medical_record_id={q(m)}"))


def wrapper(v, m, revision, cart, compounds, key):
    return (f"select public.clinic_edit_queued_record_with_compounds({q(v)},{q(m)},{revision},{j(FIELDS)},"
            f"{j(cart)},{j(compounds)},'Tambah racikan fiktif',{q(key)});")


def plain_edit(v, m, revision, cart, key):
    return f"select public.clinic_edit_queued_record({q(v)},{q(m)},{revision},{j(FIELDS)},{j(cart)},'Koreksi fiktif',{q(key)});"


def snapshot(h, v, m):
    return json.loads(h.nilai(f"""select json_build_object(
 'stock',(select qty from public.stock where warehouse_id={q(r.WH)} and item_id={q(x.MATERIAL)}),
 'layers',(select sum(qty_left) from public.stock_layers where item_id={q(x.MATERIAL)}),
 'rx',(select count(*) from public.prescription_items where medical_record_id={q(m)}),
 'recipes',(select count(*) from public.compounding_recipes where medical_record_id={q(m)}),
 'revision',(select clinical_revision from public.medical_records where id={q(m)}),
 'audits',(select count(*) from public.clinic_full_record_edits where medical_record_id={q(m)}),
 'additions',(select count(*) from public.clinic_record_item_additions where medical_record_id={q(m)}),
 'invoices',(select count(*) from public.invoices where visit_id={q(v)}),
 'journals',(select count(*) from public.journal_entries))"""))


def run(h):
    version = x.setup(h)
    official = lambda key: dict(official_version_id=version, sale_item_id=x.SKU, request_key=key, dosage_instruction='Instruksi Fiktif')
    custom = lambda key, qty=3: dict(request_key=key, sale_item_id=x.SKU, recipe=dict(
        recipe_name='Obat Racik Fiktif', dosage_instruction='2x sehari fiktif', dosage_form='kapsul',
        ingredients=[dict(item_id=x.MATERIAL, quantity=qty, unit='gram', unit_price=5000)]))

    # --- A. OWNER (peran Anisa): edit + racikan resmi baru, satu transaksi --------------------
    v, m = visit(h, 2100)
    cart = rows(h, m)
    obat = next(i for i, row in enumerate(cart) if row['item_id'] == r.ITEM)
    cart[obat]['qty'] = 3  # sekaligus mengubah baris obat biasa yang tersimpan
    before = snapshot(h, v, m)
    sql = wrapper(v, m, 0, cart, [official('anisa-resmi')], 'anisa-edit')
    err = h.gagal(sql, r.OWNER)
    after = snapshot(h, v, m)
    new = [row for row in rows(h, m) if row['compound_recipe_id']]
    check('A1 OWNER: edit dan racikan resmi baru tersimpan bersama di rekam medis yang sama',
          not err and after['rx'] == before['rx'] + 1 and after['recipes'] == 1 and len(new) == 1
          and new[0]['susulan_source'] == 'dokter' and after['revision'] == 1 and after['audits'] == 1 and after['additions'] == 1
          and next(row for row in rows(h, m) if row['id'] == cart[obat]['id'])['qty'] == 3,
          dict(error=err, before=before, after=after))
    if err:
        return
    check('A2 bahan racikan keluar dari stok gudang klinik sekali (resep resmi 2 gram), tanpa tagihan/jurnal',
          after['stock'] == before['stock'] - 2 and after['layers'] == before['layers'] - 2
          and after['invoices'] == 0,
          dict(before=before, after=after))
    err = h.gagal(sql, r.OWNER)
    check('A3 kiriman ulang persis tidak mengedit/meracik dua kali', not err and snapshot(h, v, m) == after, dict(error=err, now=snapshot(h, v, m)))
    err = h.gagal(wrapper(v, m, 0, cart, [official('anisa-resmi-beda')], 'anisa-edit'), r.OWNER)
    check('A4 kunci sama dengan racikan berbeda ditolak tanpa perubahan',
          bool(err and 'IDEMPOTENCY_CONFLICT' in err) and snapshot(h, v, m) == after, dict(error=err))
    # Edit berikutnya lewat jalur lama: racikan yang baru dibuat tetap baris terkunci, stok tidak keluar lagi.
    err = h.gagal(plain_edit(v, m, 1, rows(h, m), 'anisa-edit-lanjut'), r.OWNER)
    later = snapshot(h, v, m)
    check('A5 edit berikutnya mempertahankan racikan baru tanpa meracik ulang',
          not err and later['stock'] == after['stock'] and later['rx'] == after['rx'] and later['revision'] == 2, dict(error=err, later=later))
    locked = rows(h, m)
    for row in locked:
        if row['compound_recipe_id']:
            row['qty'] = 2
    err = h.gagal(plain_edit(v, m, 2, locked, 'anisa-ubah-racikan'), r.OWNER)
    check('A6 racikan yang sudah dibuat tetap tidak bisa diubah lewat Edit', bool(err and 'COMPOUND_LOCKED' in err) and snapshot(h, v, m) == later, dict(error=err))

    # --- B. Atomik: stok bahan kurang membatalkan edit, audit, dan racikan sekaligus --------
    v, m = visit(h, 2101)
    cart = rows(h, m)
    cart[next(i for i, row in enumerate(cart) if row['item_id'] == r.ITEM)]['qty'] = 9
    before = snapshot(h, v, m)
    old = rows(h, m)
    err = h.gagal(wrapper(v, m, 0, cart, [custom('kurang', qty=100000)], 'stok-kurang'), r.OWNER)
    check('B1 stok bahan kurang: seluruh simpanan batal (baris resep, revisi, audit, stok utuh)',
          bool(err and ('STOCK_SHORT' in err or 'LAYER_SHORT' in err)) and snapshot(h, v, m) == before and rows(h, m) == old,
          dict(error=err, before=before, after=snapshot(h, v, m)))
    # Racikan khusus pasien (komposisi bebas) sebagai DOKTER pada kunjungan yang sama, sesudah gagal.
    err = h.gagal(wrapper(v, m, 0, cart, [custom('dokter-khusus')], 'dokter-khusus'), r.DOCTOR)
    after = snapshot(h, v, m)
    check('B2 DOKTER: racikan khusus pasien tersimpan, bahan keluar 3 gram',
          not err and after['recipes'] == 1 and after['stock'] == before['stock'] - 3 and after['revision'] == 1, dict(error=err, after=after))

    # --- C. Gerbang yang sama dengan Edit lama --------------------------------------------
    v, m = visit(h, 2102)
    cart = rows(h, m)
    before = snapshot(h, v, m)
    for user in [r.ADMIN, r.STAFF, r.FINANCE, r.FIN_LUAR]:
        err = h.gagal(wrapper(v, m, 0, cart, [official('tolak-' + user)], 'tolak-' + user), user)
        check('C1 peran ditolak ' + r.PERAN[user] + ' ' + user[-2:], bool(err and 'ACCESS_DENIED' in err) and snapshot(h, v, m) == before, dict(error=err))
    err = h.gagal(f"set role anon; {wrapper(v, m, 0, cart, [official('anon')], 'anon')}")
    check('C2 anon tidak bisa memanggil pembungkus', bool(err and 'permission denied' in err) and snapshot(h, v, m) == before, dict(error=err))
    err = h.gagal(wrapper(v, m, 0, cart, [], 'kosong'), r.OWNER)
    check('C3 tanpa racikan baru ditolak (aplikasi memakai Edit lama)', bool(err and 'RECORD_INVALID' in err) and snapshot(h, v, m) == before, dict(error=err))
    err = h.gagal(wrapper(v, m, 0, cart[:-1], [official('hapus-baris')], 'hapus-baris'), r.OWNER)
    check('C4 baris tersimpan tetap tidak boleh hilang', bool(err and 'tidak boleh dihapus' in err) and snapshot(h, v, m) == before, dict(error=err))
    h.sql(f"update visits set checked_out_at=now() where id={q(v)};")
    err = h.gagal(wrapper(v, m, 0, cart, [official('sudah-pulang')], 'sudah-pulang'), r.OWNER)
    check('C5 kunjungan sudah ditutup: Edit + racikan ditolak tanpa stok keluar',
          bool(err and 'RECORD_POSTED' in err) and snapshot(h, v, m) == before, dict(error=err))
    h.sql(f"update visits set checked_out_at=null where id={q(v)};")

    # --- D. Kunci racikan sama di kiriman edit berbeda: stok tidak keluar dua kali --------
    v, m = visit(h, 2103)
    err = h.gagal(wrapper(v, m, 0, rows(h, m), [official('racik-sekali')], 'edit-pertama'), r.OWNER)
    first = snapshot(h, v, m)
    err2 = h.gagal(wrapper(v, m, 1, rows(h, m), [official('racik-sekali')], 'edit-kedua'), r.OWNER)
    second = snapshot(h, v, m)
    check('D1 racikan dengan kunci yang sama tidak diracik ulang oleh edit lain',
          not err and second['stock'] == first['stock'] and second['recipes'] == first['recipes'] == 1 and second['rx'] == first['rx'],
          dict(first_error=err, second_error=err2, first=first, second=second))

    # --- E. Urutan kunci vs kasir: tidak deadlock, kasir melihat keranjang basi --------------
    v, m = visit(h, 2104)
    cart = rows(h, m)
    lines = [dict(description=row['nama_obat'], qty=row['qty'], price=row['harga'], kind=row['jenis'], item_id=row['item_id'],
                  unit=row['satuan'], prescription_item_id=row['id'], discount_percent=0) for row in cart]
    total = sum(row['qty'] * row['harga'] for row in cart)
    invoice = dict(tanggal='2026-11-01', subtotal=total, discount=0, tax=0, total=total, dp_amount=0, paid_status='Belum Lunas',
                   metode_bayar='Tunai', shift_id=r.SHIFT[r.OWNER], dp_override_reason='Uji fiktif racikan edit')
    version_now = h.nilai(f'select public.clinic_outpatient_cart_version({q(v)})', r.OWNER)
    evidence = []
    with contextlib.ExitStack() as stack:
        observer = stack.enter_context(x.c.Session(h.db, 'edit-observer'))
        gate = stack.enter_context(x.c.Session(h.db, 'edit-gate'))
        editor = stack.enter_context(x.c.Session(h.db, 'edit-owner')); editor.sql(x.claims(r.OWNER))
        cashier = stack.enter_context(x.c.Session(h.db, 'edit-cashier')); cashier.sql(x.claims(r.OWNER))
        gate.sql(f'begin; select id from public.visits where id={q(v)} for update;')
        editor.send('begin;' + wrapper(v, m, 0, cart, [official('race-racik')], 'race-edit'))
        x.c.wait_block(observer, editor, gate, evidence)
        cashier.send(f"begin; select public.clinic_post_invoice_with_record({q(v)},'race-post',{j(invoice)},{j(lines)},p_cart_version=>{q(version_now)});")
        x.c.wait_block(observer, cashier, editor, evidence)
        gate.sql('commit;')
        first = x.c.attempt(editor)
        second = x.c.attempt(cashier)
    text = str([first, second]).lower()
    check('E1 Edit+racikan dan posting kasir berurutan tanpa deadlock; kasir diminta muat ulang (CART_STALE)',
          first['ok'] and not second['ok'] and 'CART_STALE' in second.get('error', '')
          and not any(s in text for s in ('deadlock', '40p01', '55p03', '57014', 'lock timeout'))
          and h.angka(f'select count(*) from invoices where visit_id={q(v)}') == 0,
          dict(editor=first, cashier=second, barrier=evidence))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--baseline', action='store_true')
    p.add_argument('--pg-bin', default=os.environ.get('KAMO_PG_BIN', r.BIN))
    p.add_argument('--json', type=Path)
    a = p.parse_args()
    selected = [s for s in sorted((ROOT / 'supabase/migrations').glob('*.sql')) if not (a.baseline and s.name == CANDIDATE)]
    try:
        with tempfile.TemporaryDirectory(prefix='racikan-edit.', dir='/opt/data') as d:
            target = Path(d) / 'supabase/migrations'; target.mkdir(parents=True)
            for s in selected:
                (target / s.name).symlink_to(s)
            r.fixture.ROOT = Path(d)
            with r.NativePostgres(a.pg_bin) as db:
                r.fixture.DisposablePostgres.bootstrap(db)
                run(x.Harness(db))
    except Exception as e:
        check('HARNESS', False, str(e))
    totals = {s: sum(c['status'] == s for c in RESULTS) for s in ('PASS', 'FAIL')}
    print('TOTAL', json.dumps(totals), flush=True)
    if a.json:
        a.json.write_text(json.dumps(dict(mode='RED baseline' if a.baseline else 'candidate', last_migration=selected[-1].name,
                                          totals=totals, cases=RESULTS), indent=2, ensure_ascii=False, default=str))
    return int(totals['FAIL'] > 0)


if __name__ == '__main__':
    sys.exit(main())
