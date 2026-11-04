#!/usr/bin/env python3
"""Native full-schema repro: clinic payment 'Kartu' vs the metode list of clinic_post_invoice.

Andri 4 Nov 2026 (visit 20a1cfaa, Rp158.000, 'nilai invoice tidak konsisten padahal tidak ada yang salah').
Same cart/totals/status; ONLY metode_bayar differs. Fictional fixtures, throwaway local cluster, no network.
Complete main migration chain (no candidate migration: the fix is app-side).
"""
import argparse, importlib.util, json, os, sys, tempfile
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


fixture = load('schema_fixture', 'test-accurate-inventory-accounting-postgres.py')
real = load('real_fixture', 'test-ranap-mitigasi-penuh-postgres.py')
q, j = real.q, real.j
RESULTS = []
MSG = 'INVOICE_INVALID: nilai invoice tidak konsisten'


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=str(detail)))
    print(f'{RESULTS[-1]["status"]} {name}: {detail}', flush=True)


def run(db):
    h = real.Harness(db)
    h.sql(real.dasar_sql())
    customer = real.buat_pelanggan(h, 92)
    visit, mr, pet = (real.uid(g, 92) for g in (6, 7, 5))
    h.sql(f"""
insert into public.pets(id,customer_id,name) values({q(pet)},{q(customer['id'])},'Pasien UJI Metode');
insert into public.visits(id,branch_id,customer_id,pet_id,status,doctor_id,service_started_at,service_finished_at)
 values({q(visit)},{q(real.BRANCH)},{q(customer['id'])},{q(pet)},'Pembayaran',{q(real.DOKTER_PEGAWAI)},now(),now());
insert into public.medical_records(id,visit_id,submission_key,diagnosis) values({q(mr)},{q(visit)},'metode-fixture','Diagnosis UJI');
""")
    rx = [dict(nama_obat='Obat UJI A', item_id=real.ITEM, qty=1, satuan='pcs', faktor=1, harga=18000, aturan_pakai='UJI', jenis='obat', kategori='Obat'),
          dict(nama_obat='Obat UJI B', item_id=real.ITEM, qty=1, satuan='pcs', faktor=1, harga=50000, aturan_pakai='UJI', jenis='obat', kategori='Obat')]
    h.nilai(f"select public.clinic_add_record_items({q(visit)},'metode-add',{j(rx)},'[]'::jsonb);", real.DOCTOR)
    ids = json.loads(h.nilai(f"select json_agg(json_build_object('id',id,'n',nama_obat,'h',harga) order by harga) from public.prescription_items where medical_record_id={q(mr)}"))
    lines = [dict(description=i['n'], qty=1, price=float(i['h']), kind='obat', item_id=real.ITEM, unit='pcs', prescription_item_id=i['id'], discount_percent=0) for i in ids]
    lines.append(dict(description='Jasa UJI kasir', qty=1, price=90000, kind='jasa', unit='jasa', discount_percent=0))

    def post(metode, key):
        invoice = dict(tanggal='2026-10-30', subtotal=158000, discount=0, tax=0, total=158000, dp_amount=0,
                       paid_status='Lunas', metode_bayar=metode, shift_id=real.SHIFT[real.OWNER])
        return f"select public.clinic_post_invoice_with_record({q(visit)},{q(key)},{j(invoice)},{j(lines)},p_cart_version=>public.clinic_outpatient_cart_version({q(visit)}));"
    def state():
        return [h.angka('select count(*) from public.invoices'), h.angka('select count(*) from public.journal_entries'),
                h.angka(f'select qty from public.stock where warehouse_id={q(real.WH)} and item_id={q(real.ITEM)}')]
    before = state()
    for metode in ('Kartu', 'kartu', 'Cash'):
        err = h.gagal(post(metode, 'metode-' + metode), real.OWNER)
        check(f'R1 metode {metode!r}: same Rp158.000 Lunas cart is refused with the generic message',
              bool(err and MSG in err) and state() == before, dict(error=(err or '')[:160], state=state()))
    for n, metode in enumerate(('Debit', 'Kredit', 'QRIS', 'Tunai', 'Transfer', 'E-Wallet')):
        # one invoice per visit: each valid metode is posted in its own rolled-back transaction.
        err = h.gagal('begin;\n' + post(metode, 'metode-ok-' + metode) + '\nrollback;', real.OWNER)
        check(f'R2 metode {metode!r}: identical payload is accepted by the database', err is None, dict(error=(err or '')[:200]))
    check('R3 nothing was written by any refused attempt', state() == before, dict(before=before, after=state()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', default=os.environ.get('KAMO_PG_BIN', '/opt/data/kamo-pg-harness/bin'))
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    try:
        with tempfile.TemporaryDirectory(prefix='kamo-metode-main-', dir='/opt/data') as root:
            migrations = Path(root) / 'supabase/migrations'; migrations.mkdir(parents=True)
            for p in (ROOT / 'supabase/migrations').glob('*.sql'):
                (migrations / p.name).symlink_to(p)
            fixture.ROOT = Path(root)
            with NativePostgres(args.pg_bin) as db:
                fixture.DisposablePostgres.bootstrap(db)
                run(db)
    except Exception as e:
        RESULTS.append(dict(case='SETUP/EXECUTION', status='BLOCKED', detail=str(e))); print('BLOCKED', e, flush=True)
    totals = {s: sum(x['status'] == s for x in RESULTS) for s in ('PASS', 'FAIL', 'BLOCKED')}
    print('TOTAL', json.dumps(totals), flush=True)
    if args.json: args.json.write_text(json.dumps(dict(totals=totals, results=RESULTS), indent=2))
    return int(totals['FAIL'] > 0 or totals['BLOCKED'] > 0)


if __name__ == '__main__':
    raise SystemExit(main())
