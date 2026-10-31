#!/usr/bin/env python3
"""Integrasi A+C+D klinik: skenario ujung-ke-ujung dokter -> kasir -> cetak (LOCAL ONLY).

Klaster PostgreSQL native sekali pakai, SELURUH migrasi repositori dipasang MENURUT URUTAN
nama (termasuk C 20261104310000 dan D 20261104340000). Data fiktif; writer publik dipanggil
sebagai role `authenticated` dengan klaim JWT fiktif; tanpa stub bisnis (hanya shim platform
auth/storage yang sama dengan harness lain). Bukan UAT browser/Auth/PostgREST.

Skenario:
  E1  dokter menyimpan, kasir membuka keranjang (membaca versi), dokter menambah item susulan +
      racikan, simpan kasir yang basi ditolak CART_STALE; kasir memuat ulang lalu menyimpan;
      baris invoice memuat item susulan tertaut ke rekam medis & resep yang sama, dengan asal
      dan pembuat; data yang dibaca halaman cetak resep/dokumen memuatnya; jurnal seimbang.
  E2  balapan nyata (penghalang kunci teramati) dokter-tambah vs kasir-posting, dua urutan:
      tanpa deadlock, tepat satu hasil, tidak pernah ada baris dokter yang tak tertagih.
  E3  kunjungan produk saja (tanpa rekam medis) lewat pembungkus D tetap ditolak aturan C bila
      tidak lunas, dan sah bila lunas.
  E4  pelunasan DP lama (C) pada skema gabungan: DP lewat pembungkus D, dokter terkunci,
      pelunasan pada invoice yang sama, DP terhitung sekali.
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


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


k = load('keranjang', 'test-item-susulan-keranjang-postgres.py')
x, r, c = k.x, k.r, k.c
q, j = r.q, r.j
RESULTS = []
PRINT_COLUMNS = 'nama_obat, qty, satuan, aturan_pakai, jenis, susulan_at, susulan_by_name, susulan_source'  # resep/dokumen page select


def check(case, ok, detail):
    RESULTS.append(dict(case=case, status='PASS' if ok else 'FAIL', detail=detail))
    print(RESULTS[-1]['status'], case, json.dumps(detail, ensure_ascii=False, default=str)[:1200], flush=True)


def unbalanced(h):
    return h.angka('select count(*) from (select entry_id from public.journal_lines group by entry_id having sum(debit-credit) <> 0) z')


def unbilled_doctor_rows(h, v):
    """Baris resep bertanda dokter yang tidak tertaut invoice aktif padahal kunjungan sudah punya invoice."""
    return h.angka(f"""select count(*) from public.prescription_items p join public.medical_records m on m.id=p.medical_record_id
 where m.visit_id={q(v)} and p.susulan_source='dokter'
   and exists(select 1 from public.invoices i where i.visit_id={q(v)} and i.voided_at is null)
   and not exists(select 1 from public.invoice_items l join public.invoices i on i.id=l.invoice_id
                  where l.prescription_item_id=p.id and i.voided_at is null)""")


def e1_doctor_cashier_print(h, sku_version):
    v, m = k.outpatient(h, 3501)
    opened = k.version(h, v)
    stale = k.cart_lines(h, m)
    err = h.gagal(k.add_sql(v, 'e1-susulan', [k.doctor_item()], [k.compound(sku_version, 'e1-racik')]), r.DOCTOR)
    check('E1a doctor adds susulan item + racikan after the cart was opened', not err and k.pending(h, m) == 6, (err or '')[:300])
    before = k.money(h, v)
    err = h.gagal(k.post_sql(v, 'e1-stale', stale, opened), r.OWNER)
    check('E1b cashier stale save refused CART_STALE, no money/stock/journal', bool(err and 'CART_STALE' in err) and k.money(h, v) == before,
          dict(error=(err or 'posted')[:200], before=before, after=k.money(h, v)))
    fresh, version = k.cart_lines(h, m), k.version(h, v)
    try:
        inv = h.nilai(k.post_sql(v, 'e1-fresh', fresh, version), r.OWNER)
    except RuntimeError as e:
        check('E1c reloaded cart posts and links the doctor lines to the same record/prescription/invoice', False, str(e)[:400])
        return
    lines = json.loads(h.nilai(f"""select coalesce(json_agg(json_build_object('desc',l.deskripsi,'rx',l.prescription_item_id,'recipe',l.compound_recipe_id,
 'record',p.medical_record_id,'source',p.susulan_source,'by',p.susulan_by_name) order by l.created_at,l.id),'[]')
 from public.invoice_items l left join public.prescription_items p on p.id=l.prescription_item_id where l.invoice_id={q(inv)}"""))
    doctor = [line for line in lines if line['source'] == 'dokter']
    check('E1c reloaded cart posts and links the doctor lines to the same record/prescription/invoice',
          len(doctor) == 2 and all(line['record'] == m and line['by'] == 'Pengguna Fiktif 5' and line['rx'] for line in doctor)
          and any(line['recipe'] for line in doctor) and k.pending(h, m) == 0 and unbilled_doctor_rows(h, v) == 0,
          dict(doctor_lines=doctor, total_lines=len(lines)))
    printed = json.loads(h.nilai(f"select coalesce(json_agg(to_jsonb(x)),'[]') from (select {PRINT_COLUMNS} from public.prescription_items "
                                 f"where medical_record_id={q(m)} order by created_at) x;", r.DOCTOR))
    marked = [row for row in printed if row['susulan_source'] == 'dokter']
    check('E1d prescription/document print query (as the clinic user, RLS) returns the susulan rows with origin + creator',
          len(marked) == 2 and all(row['susulan_by_name'] == 'Pengguna Fiktif 5' and row['susulan_at'] for row in marked),
          dict(printed=len(printed), marked=marked))
    no = h.no_tagihan(inv)
    check('E1e invoice journals balanced, invoice status unpaid, stock moved only by the original posting/compound engines',
          unbalanced(h) == 0 and h.saldo_ref('510002', no) < 0 and h.status_bayar(inv) == 'Belum Lunas',
          dict(unbalanced=unbalanced(h), revenue=h.saldo_ref('510002', no), status=h.status_bayar(inv)))


def race(h, db, sku_version, n, doctor_first):
    v, m = k.outpatient(h, n)
    lines, cart = k.cart_lines(h, m), k.version(h, v)
    label = 'doctor-first' if doctor_first else 'cashier-first'
    evidence = []
    case = f'E2 {label}: real lock barrier, no deadlock, exactly one outcome, no unbilled doctor line, journals balanced'
    material_before = k.money(h, v)['material']
    try:
        with contextlib.ExitStack() as stack:
            gate = stack.enter_context(c.Session(db, f'e2-gate-{n}'))
            observer = stack.enter_context(c.Session(db, f'e2-observer-{n}'))
            doctor = stack.enter_context(c.Session(db, f'e2-doctor-{n}', r.DOCTOR))
            cashier = stack.enter_context(c.Session(db, f'e2-cashier-{n}', r.OWNER))
            gate.sql(f'begin; select id from public.visits where id={q(v)} for update;')
            first, second = (doctor, cashier) if doctor_first else (cashier, doctor)
            sql = {doctor: k.add_sql(v, f'e2-racik-{n}', [k.doctor_item()], [k.compound(sku_version, f'e2-key-{n}')]),
                   cashier: k.post_sql(v, f'e2-post-{n}', lines, cart)}
            first.send('begin; ' + sql[first])
            k.wait_lock(observer, first, evidence, [gate])
            second.send('begin; ' + sql[second])
            k.wait_lock(observer, second, evidence)
            gate.sql('commit;')
            a = c.attempt(first)
            b = c.attempt(second)
        text = json.dumps([a, b]).lower()
        no_deadlock = not any(s in text for s in ('deadlock', '40p01', 'timeout', '55p03', '57014'))
        one_outcome = a['ok'] and not b['ok']
        invoices = h.angka(f'select count(*) from public.invoices where visit_id={q(v)} and voided_at is null')
        if doctor_first:
            expected = 'cart_stale' in text and invoices == 0 and k.pending(h, m) == 6
            # Kasir memuat ulang: item dokter ikut tertagih.
            inv = h.nilai(k.post_sql(v, f'e2-post-reload-{n}', k.cart_lines(h, m), k.version(h, v)), r.OWNER)
            expected = expected and bool(inv) and k.pending(h, m) == 0
        else:
            expected = ('record_locked' in text and invoices == 1 and k.pending(h, m) == 0
                        and k.money(h, v)['material'] == material_before
                        and h.angka(f"select count(*) from public.prescription_items where medical_record_id={q(m)} and susulan_source='dokter'") == 0)
        check(case, no_deadlock and one_outcome and expected and unbilled_doctor_rows(h, v) == 0 and unbalanced(h) == 0,
              dict(first=a, second=b, barrier=evidence, invoices=invoices, pending=k.pending(h, m), unbalanced=unbalanced(h)))
    except (TimeoutError, AssertionError, RuntimeError) as e:
        check(case, False, dict(error=str(e)[:500], barrier=evidence))


def product_only_visit(h, n):
    customer = r.buat_pelanggan(h, n)
    v, pet = r.uid(6, n), r.uid(5, n)
    h.sql(f"insert into public.pets(id,customer_id,name) values({q(pet)},{q(customer['id'])},'Pasien produk Fiktif {n}');"
          f"insert into public.visits(id,branch_id,customer_id,pet_id,status,doctor_id,poli) values({q(v)},{q(r.BRANCH)},{q(customer['id'])},{q(pet)},'Pembayaran',{q(r.DOKTER_PEGAWAI)},'Poli Umum');")
    return v


PRODUK = dict(description='Obat Fiktif', qty=2, price=25000, kind='obat', item_id=r.ITEM, unit='pcs', discount_percent=0)
KONSUL = dict(description='Jasa Konsultasi Poli Umum', qty=1, price=0, kind='jasa', item_id=None, unit=None, discount_percent=0)


def e3_product_only(h):
    v = product_only_visit(h, 3601)
    lines = [PRODUK, KONSUL]
    body = {kk: val for kk, val in dict(k.invoice(lines, r.STAFF), paid_status='DP', dp_amount=30000, dp_date=r.TGL).items() if kk != 'dp_override_reason'}
    before = k.money(h, v)
    err = h.gagal(k.post_sql(v, 'e3-dp', lines, k.version(h, v, r.STAFF), user=r.STAFF, inv=body), r.STAFF)
    check('E3a product-only partial payment through D wrapper still refused with C rule (PRODUCT_ONLY_FULL_PAYMENT)',
          bool(err and 'PRODUCT_ONLY_FULL_PAYMENT' in err) and k.money(h, v) == before, (err or 'accepted')[:300])
    body = {kk: val for kk, val in dict(k.invoice(lines, r.STAFF), paid_status='Lunas').items() if kk != 'dp_override_reason'}
    try:
        inv = h.nilai(k.post_sql(v, 'e3-lunas', lines, k.version(h, v, r.STAFF), user=r.STAFF, inv=body), r.STAFF)
        rows = h.angka(f'select count(*) from public.prescription_items p join public.medical_records m on m.id=p.medical_record_id where m.visit_id={q(v)}')
        check('E3b product-only paid in full posts; no medical record invented, classification unchanged',
              h.status_bayar(inv) == 'Lunas' and rows == 0, dict(status=h.status_bayar(inv), prescriptions=rows))
    except RuntimeError as e:
        check('E3b product-only paid in full posts; no medical record invented, classification unchanged', False, str(e)[:300])


def e4_old_dp_settlement(h):
    v, m = k.outpatient(h, 3602)
    lines = k.cart_lines(h, m)
    total = r.nilai_baris(lines)
    body = {kk: val for kk, val in dict(k.invoice(lines, r.STAFF), paid_status='DP', dp_amount=200000, dp_date=r.TGL).items() if kk != 'dp_override_reason'}
    try:
        inv = h.nilai(k.post_sql(v, 'e4-dp', lines, k.version(h, v, r.STAFF), user=r.STAFF, inv=body), r.STAFF)
    except RuntimeError as e:
        check('E4 old DP settlement on combined schema', False, str(e)[:300])
        return
    err = h.gagal(k.add_sql(v, 'e4-after-dp', [k.doctor_item()]), r.DOCTOR)
    check('E4a after the DP invoice exists the doctor path is locked (no pending rows can bypass settlement)',
          bool(err and 'RECORD_LOCKED' in err) and k.pending(h, m) == 0, (err or 'accepted')[:200])
    remaining = total - 200000
    parts = [dict(method='Tunai', amount=remaining - 30000), dict(method='Transfer', amount=30000)]
    try:
        receipt = h.nilai(f"select public.clinic_settle_outpatient_invoice({q(v)}::uuid,{q(inv)}::uuid,'e4-settle',{j(parts)},{remaining}::numeric);", r.STAFF)
        no = h.no_tagihan(inv)
        check('E4b C settlement on same invoice: Lunas, prior DP counted once, AR cleared, journals balanced',
              bool(receipt) and h.status_bayar(inv) == 'Lunas' and h.diterima(inv) == total
              and h.angka(f'select count(*) from public.invoices where visit_id={q(v)}') == 1
              and h.saldo_ref('150001', no) == 0 and unbalanced(h) == 0,
              dict(status=h.status_bayar(inv), received=h.diterima(inv), total=total, ar=h.saldo_ref('150001', no)))
    except RuntimeError as e:
        check('E4b C settlement on same invoice: Lunas, prior DP counted once, AR cleared, journals balanced', False, str(e)[:300])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--pg-bin', default=os.environ.get('KAMO_PG_BIN', '/opt/data/kamo-pg-harness/bin'))
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    meta = {}
    try:
        with tempfile.TemporaryDirectory(prefix='kamo-acd-', dir='/opt/data') as root:
            migrations = Path(root) / 'supabase/migrations'
            migrations.mkdir(parents=True)
            for p in (ROOT / 'supabase/migrations').glob('*.sql'):
                (migrations / p.name).symlink_to(p)
            names = sorted(p.name for p in migrations.glob('*.sql'))
            meta.update(migrations=len(names), last=names[-3:],
                        reserved_wowo=[n for n in names if '20261104250000' <= n[:14] <= '20261104290000'])
            r.fixture.ROOT = Path(root)
            with x.LocalPostgres(args.pg_bin) as db:
                r.fixture.DisposablePostgres.bootstrap(db)  # applies in filename order
                meta['server'] = db.sql('show server_version')
                h = x.Harness(db)
                sku_version = x.setup(h)
                e1_doctor_cashier_print(h, sku_version)
                race(h, db, sku_version, 3510, doctor_first=True)
                race(h, db, sku_version, 3511, doctor_first=False)
                e3_product_only(h)
                e4_old_dp_settlement(h)
    except Exception as e:  # noqa: BLE001 - recorded as BLOCKED, never PASS
        RESULTS.append(dict(case='SETUP/EXECUTION', status='BLOCKED', detail=str(e)[:2000]))
        print('BLOCKED', e, flush=True)
    totals = {s: sum(row['status'] == s for row in RESULTS) for s in ('PASS', 'FAIL', 'BLOCKED')}
    print('TOTAL', json.dumps(totals), json.dumps(meta), flush=True)
    if args.json:
        args.json.write_text(json.dumps(dict(meta=meta, totals=totals, results=RESULTS), indent=2, ensure_ascii=False, default=str))
    return int(totals['FAIL'] > 0 or totals['BLOCKED'] > 0)


if __name__ == '__main__':
    raise SystemExit(main())
