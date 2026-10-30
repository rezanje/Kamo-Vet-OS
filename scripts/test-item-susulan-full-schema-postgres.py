#!/usr/bin/env python3
"""PR341 readiness on the complete main migration chain, then PR341 LAST.

Fictional fixtures only; Unix-socket disposable PostgreSQL. No remote URL, no
credentials, no business stubs. Supabase auth/storage are platform shims shared
with existing repository tests. Uses real public RPCs as authenticated JWT actors.
This is database integration, NOT authenticated Next.js/browser UAT.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = '20261101000000_item_susulan_rekam_medis.sql'
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fixture = load('schema_fixture', 'test-accurate-inventory-accounting-postgres.py')
real = load('real_fixture', 'test-ranap-mitigasi-penuh-postgres.py')
q, j = real.q, real.j
RESULTS = []


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=str(detail)))
    print(f'{RESULTS[-1]["status"]} {name}: {detail}', flush=True)


def run(db):
    h = real.Harness(db)
    h.sql(real.dasar_sql())
    customer = real.buat_pelanggan(h, 91)
    visit, mr, pet = (real.uid(g, 91) for g in (6, 7, 5))
    h.sql(f"""
insert into public.pets(id,customer_id,name) values({q(pet)},{q(customer['id'])},'Pasien UJI PR341');
insert into public.visits(id,branch_id,customer_id,pet_id,status,doctor_id,service_started_at,service_finished_at)
 values({q(visit)},{q(real.BRANCH)},{q(customer['id'])},{q(pet)},'Pembayaran',{q(real.DOKTER_PEGAWAI)},now(),now());
insert into public.medical_records(id,visit_id,submission_key,diagnosis)
 values({q(mr)},{q(visit)},'pr341-fixture','Diagnosis UJI tetap');
""")
    def count():
        return h.angka(f'select count(*) from public.prescription_items where medical_record_id={q(mr)}')
    def money_stock():
        return [h.angka('select count(*) from public.invoices'), h.angka('select count(*) from public.journal_entries'),
                h.angka(f'select qty from public.stock where warehouse_id={q(real.WH)} and item_id={q(real.ITEM)}')]
    rx = dict(nama_obat='Obat UJI dokter', item_id=real.ITEM, qty=2, satuan='pcs', faktor=1,
              harga=25000, aturan_pakai='Instruksi UJI', jenis='obat', kategori='Obat')
    add = f'select public.clinic_add_record_items({q(visit)},\'pr341-add\',{j([rx])},\'[]\'::jsonb);'
    before = money_stock()
    try:
        result = h.nilai(add, real.DOCTOR)
        check('D1 real doctor RPC stores marked prescription without money/stock writes',
              result == mr and count() == 1 and before == money_stock()
              and h.nilai(f'select susulan_source from public.prescription_items where medical_record_id={q(mr)}') == 'dokter',
              dict(record=result, rows=count(), before=before, after=money_stock()))
    except RuntimeError as e:
        check('D1 real doctor RPC stores marked prescription without money/stock writes', False, e)
    try:
        h.sql(add, real.DOCTOR)
        check('D2 exact replay does not add another prescription', count() == 1, count())
    except RuntimeError as e:
        check('D2 exact replay does not add another prescription', False, e)
    changed = dict(rx, qty=3)
    error = h.gagal(f'select public.clinic_add_record_items({q(visit)},\'pr341-add\',{j([changed])},\'[]\'::jsonb);', real.DOCTOR)
    check('D3 changed-content replay is rejected without data change',
          bool(error and 'IDEMPOTENCY_CONFLICT' in error) and count() == 1, error)
    error = h.gagal(add, real.FIN_LUAR)
    check('D4 out-of-branch actor cannot replay cached result', bool(error and 'ACCESS_DENIED' in error), error)
    if count() != 1:
        check('P0 downstream posting has its doctor fixture', False, 'doctor fixture absent; downstream checks blocked')
        return
    rx_id = h.nilai(f'select id from public.prescription_items where medical_record_id={q(mr)}')
    lines = [dict(description=rx['nama_obat'], qty=2, price=25000, kind='obat', item_id=real.ITEM,
                  unit='pcs', prescription_item_id=rx_id, discount_percent=0),
             dict(description='Tindakan UJI kasir', qty=1, price=10000, kind='jasa', unit='jasa', discount_percent=0)]
    invoice = dict(tanggal='2026-10-30', subtotal=60000, discount=0, tax=0, total=60000,
                   dp_amount=0, paid_status='Belum Lunas', metode_bayar='Tunai', shift_id=real.SHIFT[real.OWNER],
                   dp_override_reason='Uji dummy PR341 tanpa pembayaran')
    post = f'select public.clinic_post_invoice_with_record({q(visit)},\'pr341-post\',{j(invoice)},{j(lines)});'
    before = money_stock()
    try:
        inv = h.nilai(post, real.OWNER)
        linked = h.angka(f'select count(*) from public.invoice_items where invoice_id={q(inv)} and prescription_item_id is not null')
        source = h.nilai(f'select susulan_source from public.prescription_items where medical_record_id={q(mr)} and nama_obat=\'Tindakan UJI kasir\'')
        category = h.nilai(f'select coalesce(kategori,\'NULL\') from public.prescription_items where medical_record_id={q(mr)} and nama_obat=\'Tindakan UJI kasir\'')
        check('P1 real posting links doctor and cashier items, preserves decision A',
              count() == 2 and linked == 2 and source == 'kasir' and category == 'NULL',
              dict(rows=count(), linked=linked, source=source, category=category))
        after = money_stock()
        balance = h.angka(f'select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where e.source_ref=(select invoice_no from public.invoices where id={q(inv)})')
        per_entry_bad = h.angka('select count(*) from (select entry_id from public.journal_lines group by entry_id having sum(debit-credit) <> 0) j')
        accounts = {code: h.saldo(code) for code in ('4201', '5101', '1301')}
        check('P2 original posting deducts two units with real revenue/HPP entries and unpaid status',
              after[2] == before[2] - 2 and after[0] == before[0] + 1 and after[1] > before[1]
              and balance == 0 and per_entry_bad == 0
              and accounts == {'4201': -60000, '5101': 4000, '1301': -4000}
              and h.status_bayar(inv) == 'Belum Lunas' and h.diterima(inv) == 0,
              dict(before=before, after=after, journal_balance=balance, unbalanced_entries=per_entry_bad,
                   accounts=accounts, status=h.status_bayar(inv)))
        replay_before = (money_stock(), count())
        replay = h.nilai(post, real.OWNER)
        check('P3 invoice replay returns same invoice with no repeated prescription/stock/journal',
              replay == inv and replay_before == (money_stock(), count()), dict(invoice=replay, rows=count()))
        error = h.gagal(f'select public.clinic_add_record_items({q(visit)},\'pr341-after-post\',{j([rx])},\'[]\'::jsonb);', real.DOCTOR)
        check('P4 doctor addition after posting stays locked', bool(error and 'RECORD_LOCKED' in error) and count() == 2, error)
        # Preserve original invoice lines explicitly on correction; add one new cashier line.
        ids = json.loads(h.nilai(f"select json_agg(json_build_object('id',id,'description',deskripsi,'qty',qty,'price',harga,'kind',jenis,'item_id',item_id,'unit',satuan)) from public.invoice_items where invoice_id={q(inv)}"))
        correction_lines = [dict(description=x['description'], qty=x['qty'], price=x['price'], kind=x['kind'],
                                 item_id=x['item_id'], unit=x['unit'], source_invoice_item_id=x['id'], discount_percent=0) for x in ids]
        correction_lines.append(dict(description='Jasa susulan koreksi UJI', qty=1, price=5000, kind='jasa', unit='jasa', discount_percent=0))
        payload = dict(subtotal=65000, discount=0, tax=0, total=65000, dp_amount=0, paid_status='Belum Lunas',
                       metode_bayar='Tunai', reason='Koreksi fixture dummy', dp_override_reason='Uji dummy PR341')
        correction = f'select public.clinic_edit_invoice_with_record({q(inv)},\'pr341-edit\',{j(payload)},{j(correction_lines)});'
        try:
            h.sql(correction, real.FINANCE)
            check('P5 real correction records only new cashier item', count() == 3, count())
        except RuntimeError as e:
            check('P5 real correction records only new cashier item', False, e)
    except RuntimeError as e:
        check('P1 real posting links doctor and cashier items, preserves decision A', False, e)
    check('C1 original diagnosis remains intact',
          h.nilai(f'select diagnosis from public.medical_records where id={q(mr)}') == 'Diagnosis UJI tetap', 'readback')
    # Imported NULL-branch histories retain the PR342 direct-child write restriction.
    imported = [dict(source_key='wowo-test::pr341-shared', record_date='2026-01-15T00:00:00Z',
                     owner_name='Pemilik UJI import', phone='08000000992', patient_name='Anabul UJI import', diagnosis='UJI bersama')]
    try:
        result = json.loads(h.nilai(f'select public.import_legacy_medical_records_bulk({j(imported)});', real.OWNER))
        shared_visit = result[0].get('visit_id')
        shared_mr = h.nilai(f'select id from public.medical_records where visit_id={q(shared_visit)}')
        denied = h.gagal(f"insert into public.prescription_items(medical_record_id,nama_obat,qty,satuan,jenis) values({q(shared_mr)},'Dilarang',1,'pcs','obat');", real.OWNER)
        check('G1 direct prescription writes on shared imported record remain refused',
              bool(denied and ('row-level security' in denied or 'permission denied' in denied or 'CARE_INVALID: rekam medis tidak memiliki cabang' in denied))
              and h.angka(f'select count(*) from public.prescription_items where medical_record_id={q(shared_mr)}') == 0, denied)
    except RuntimeError as e:
        check('G1 PR342 guard still refuses direct prescription writes on shared imported record', False, e)
    concurrency(db, h)
    missing_dependency_probe(h)


def missing_dependency_probe(h):
    """Actual 42883 from the NEW private helper, not the shared billing coordinator.

    This documents why app fallback is unsafe: the old public RPC remains callable
    while the record-linking wrapper fails. It is not a claim of browser/PostgREST
    testing; server-action regression tests enforce that this error never falls back.
    """
    customer = real.buat_pelanggan(h, 94)
    visit, mr, pet = (real.uid(g, 94) for g in (6, 7, 5))
    h.sql(f"""
insert into public.pets(id,customer_id,name) values({q(pet)},{q(customer['id'])},'Anabul UJI missing dependency');
insert into public.visits(id,branch_id,customer_id,pet_id,status,doctor_id,service_started_at,service_finished_at)
 values({q(visit)},{q(real.BRANCH)},{q(customer['id'])},{q(pet)},'Pembayaran',{q(real.DOKTER_PEGAWAI)},now(),now());
insert into public.medical_records(id,visit_id,submission_key) values({q(mr)},{q(visit)},'pr341-missing-private-helper');
""")
    invoice = dict(tanggal='2026-10-30', subtotal=10000, discount=0, tax=0, total=10000,
                   dp_amount=0, paid_status='Belum Lunas', metode_bayar='Tunai', shift_id=real.SHIFT[real.OWNER],
                   dp_override_reason='Uji dummy private helper PR341')
    lines = [dict(description='Jasa UJI private helper', qty=1, price=10000, kind='jasa', unit='jasa', discount_percent=0)]
    h.sql('alter function clinic_private.link_unrecorded_lines(uuid,text,jsonb,text) rename to pr341_hidden_link_unrecorded_lines;')
    try:
        broken = h.gagal('\\set VERBOSITY verbose\n' + f"select public.clinic_post_invoice_with_record({q(visit)},'pr341-fault-post',{j(invoice)},{j(lines)});", real.OWNER)
        no_write = h.angka(f'select count(*) from public.invoices where visit_id={q(visit)}') == 0
        legacy = h.nilai(f"select public.clinic_post_invoice({q(visit)},'pr341-fault-legacy-post',{j(invoice)},{j(lines)});", real.OWNER)
        rows = h.angka(f'select count(*) from public.prescription_items where medical_record_id={q(mr)}')
        check('F1 actual missing new helper yields 42883; legacy posting alone is not a safe fallback',
              bool(broken and '42883' in broken and 'link_unrecorded_lines' in broken) and no_write and bool(legacy) and rows == 0,
              dict(wrapper_error=broken, wrapper_rolled_back=no_write, legacy_invoice=legacy, prescriptions=rows))
        source_id = h.nilai(f'select id from public.invoice_items where invoice_id={q(legacy)} limit 1')
        edit_lines = [dict(lines[0], source_invoice_item_id=source_id),
                      dict(description='Tambahan UJI dependency', qty=1, price=1000, kind='jasa', unit='jasa', discount_percent=0)]
        payload = dict(subtotal=11000, discount=0, tax=0, total=11000, dp_amount=0, paid_status='Belum Lunas',
                       metode_bayar='Tunai', reason='Uji dummy internal dependency', dp_override_reason='Uji dummy PR341')
        broken_edit = h.gagal('\\set VERBOSITY verbose\n' + f"select public.clinic_edit_invoice_with_record({q(legacy)},'pr341-fault-edit',{j(payload)},{j(edit_lines)});", real.FINANCE)
        unchanged = h.angka(f'select total from public.invoices where id={q(legacy)}') == 10000
        old_result = h.nilai(f"select public.clinic_edit_invoice({q(legacy)},'pr341-fault-legacy-edit',{j(payload)},{j(edit_lines)});", real.FINANCE)
        rows = h.angka(f'select count(*) from public.prescription_items where medical_record_id={q(mr)}')
        check('F2 actual missing new helper yields 42883; legacy correction could omit the record too',
              bool(broken_edit and '42883' in broken_edit and 'link_unrecorded_lines' in broken_edit) and unchanged
              and old_result == legacy and rows == 0 and h.angka(f'select total from public.invoices where id={q(legacy)}') == 11000,
              dict(wrapper_error=broken_edit, wrapper_rolled_back=unchanged, legacy_invoice=old_result, prescriptions=rows))
    finally:
        h.sql('alter function clinic_private.pr341_hidden_link_unrecorded_lines(uuid,text,jsonb,text) rename to link_unrecorded_lines;')


def concurrency(db, h):
    """PR343's public posting coordinator must precede the new wrapper's visit lock.

    A gate pins the visit. Start wrapper first and observe its real lock wait;
    start original public posting second, observe its wait, then release gate.
    The wrapper must succeed; the loser may only be rejected as INVOICE_EXISTS,
    never deadlock/timeout. No sleep-based overlap, no private business replacement.
    """
    concurrent = load('real_sessions', 'test-ranap-mitigasi-concurrency-postgres.py')
    customer = real.buat_pelanggan(h, 92)
    visit, mr, pet = (real.uid(g, 92) for g in (6, 7, 5))
    h.sql(f"""
insert into public.pets(id,customer_id,name) values({q(pet)},{q(customer['id'])},'Anabul UJI concurrency');
insert into public.visits(id,branch_id,customer_id,pet_id,status,doctor_id,service_started_at,service_finished_at)
 values({q(visit)},{q(real.BRANCH)},{q(customer['id'])},{q(pet)},'Pembayaran',{q(real.DOKTER_PEGAWAI)},now(),now());
insert into public.medical_records(id,visit_id,submission_key) values({q(mr)},{q(visit)},'pr341-concurrency');
""")
    lines = [dict(description='Jasa UJI concurrency', qty=1, price=10000, kind='jasa', unit='jasa', discount_percent=0)]
    invoice = dict(tanggal='2026-10-30', subtotal=10000, discount=0, tax=0, total=10000, dp_amount=0,
                   paid_status='Belum Lunas', metode_bayar='Tunai', shift_id=real.SHIFT[real.OWNER],
                   dp_override_reason='Uji dummy concurrency PR341')
    evidence = []
    try:
        with concurrent.Session(db, 'pr341-gate') as gate, concurrent.Session(db, 'pr341-observer') as observer, \
             concurrent.Session(db, 'pr341-wrapper', real.OWNER) as wrapper, concurrent.Session(db, 'pr341-original', real.OWNER) as original:
            gate.sql(f'begin; select id from public.visits where id={q(visit)} for update;')
            wrapper.send(f"begin; select public.clinic_post_invoice_with_record({q(visit)},'pr341-race-wrapper',{j(invoice)},{j(lines)});")
            concurrent.wait_block(observer, wrapper, gate, evidence)
            original.send(f"begin; select public.clinic_post_invoice({q(visit)},'pr341-race-original',{j(invoice)},{j(lines)});")
            # On old SQL the original waits behind the wrapper's visit-lock queue;
            # with the fix it waits on the wrapper's billing advisory lock instead.
            concurrent.wait_block(observer, original, wrapper, evidence)
            gate.sql('commit;')
            first = concurrent.attempt(wrapper)
            second = concurrent.attempt(original)
            check('L1 wrapper and original public posting serialize without deadlock',
                  first['ok'] and not second['ok'] and 'INVOICE_EXISTS' in second.get('error','')
                  and not any(s in str([first,second]).lower() for s in ('deadlock','timeout','57014','55p03','40p01')),
                  dict(wrapper=first, original=second, barrier=evidence))
            race_invoice = h.nilai(f'select id from public.invoices where visit_id={q(visit)} and voided_at is null')
            race_record = h.nilai(f'select id from public.medical_records where visit_id={q(visit)}')
            readback = dict(
                prescriptions=h.angka(f'select count(*) from public.prescription_items where medical_record_id={q(race_record)}'),
                invoices=h.angka(f'select count(*) from public.invoices where visit_id={q(visit)} and voided_at is null'),
                linked_lines=h.angka(f'select count(*) from public.invoice_items where invoice_id={q(race_invoice)} and prescription_item_id is not null'),
                stock=h.angka(f'select qty from public.stock where warehouse_id={q(real.WH)} and item_id={q(real.ITEM)}'),
                invoice_total=h.angka(f'select total from public.invoices where id={q(race_invoice)}'),
                money_received=h.diterima(race_invoice),
            )
            check('L1b concurrent posting final readback has one linked prescription/invoice and no extra stock/money',
                  readback == dict(prescriptions=1, invoices=1, linked_lines=1, stock=198, invoice_total=10000, money_received=0), readback)
            edit_race(db, h, visit, concurrent)
    except (TimeoutError, AssertionError) as e:
        RESULTS.append(dict(case='L1 concurrency synchronization', status='BLOCKED', detail=str(e)))
        print('BLOCKED L1', e, flush=True)


def edit_race(db, h, visit, concurrent):
    invoice_id = h.nilai(f'select id from public.invoices where visit_id={q(visit)} and voided_at is null')
    prescription_id = h.nilai(f'select prescription_item_id from public.invoice_items where invoice_id={q(invoice_id)} limit 1')
    # Use the stable prescription identity: source_invoice_item_id is deliberately
    # rejected after another correction replaces that invoice-item row.
    lines = [dict(description='Jasa UJI concurrency', qty=1, price=10000, kind='jasa', unit='jasa',
                  prescription_item_id=prescription_id, discount_percent=0)]
    payload = dict(subtotal=10000, discount=0, tax=0, total=10000, dp_amount=0, paid_status='Belum Lunas',
                   metode_bayar='Tunai', reason='Koreksi UJI concurrency', dp_override_reason='Uji dummy PR341')
    balances_before = {c: h.saldo(c) for c in ('1101', '1201', '4201', '5101', '1301')}
    evidence = []
    with concurrent.Session(db, 'pr341-edit-gate') as gate, concurrent.Session(db, 'pr341-edit-observer') as observer, \
         concurrent.Session(db, 'pr341-edit-wrapper', real.FINANCE) as wrapper, concurrent.Session(db, 'pr341-edit-original', real.FINANCE) as original:
        gate.sql(f'begin; select id from public.visits where id={q(visit)} for update;')
        wrapper.send(f"begin; select public.clinic_edit_invoice_with_record({q(invoice_id)},'pr341-race-edit-wrapper',{j(payload)},{j(lines)});")
        concurrent.wait_block(observer, wrapper, gate, evidence)
        original.send(f"begin; select public.clinic_edit_invoice({q(invoice_id)},'pr341-race-edit-original',{j(payload)},{j(lines)});")
        concurrent.wait_block(observer, original, wrapper, evidence)
        gate.sql('commit;')
        first = concurrent.attempt(wrapper)
        second = concurrent.attempt(original)
        check('L2 wrapper and original public correction serialize without deadlock',
              first['ok'] and second['ok'], dict(wrapper=first, original=second, barrier=evidence))
        current = {c: h.saldo(c) for c in balances_before}
        final = dict(
            invoice_total=h.angka(f'select total from public.invoices where id={q(invoice_id)}'),
            linked_lines=h.angka(f'select count(*) from public.invoice_items where invoice_id={q(invoice_id)} and prescription_item_id={q(prescription_id)}'),
            prescriptions=h.angka(f'select count(*) from public.prescription_items where id={q(prescription_id)}'),
            stock=h.angka(f'select qty from public.stock where warehouse_id={q(real.WH)} and item_id={q(real.ITEM)}'),
            unbalanced_entries=h.angka('select count(*) from (select entry_id from public.journal_lines group by entry_id having sum(debit-credit) <> 0) j'),
        )
        check('L2b concurrent correction keeps prescription/invoice links, ledger balances and stock intact',
              current == balances_before and final == dict(invoice_total=10000, linked_lines=1, prescriptions=1, stock=198, unbalanced_entries=0),
              dict(before=balances_before, after=current, readback=final))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', default=os.environ.get('KAMO_PG_BIN', '/opt/data/kamo-pg-harness/bin'))
    parser.add_argument('--json', type=Path)
    parser.add_argument('--pre-coordinator', action='store_true', help='Replay the unchanged candidate from 9ca46b8c (expected deadlock RED)')
    args = parser.parse_args()
    candidate_sql = (ROOT / 'supabase/migrations' / CANDIDATE).read_text()
    if args.pre_coordinator:
        import subprocess
        candidate_sql = subprocess.check_output(['git', 'show', f'9ca46b8c1fdc20890c6568efe64f0f6d406f4963:supabase/migrations/{CANDIDATE}'], cwd=ROOT, text=True)
    try:
        # Do not apply PR341 in filename order: hosted main already has later migrations.
        with tempfile.TemporaryDirectory(prefix='kamo-pr341-main-', dir='/opt/data') as root:
            migrations = Path(root) / 'supabase/migrations'
            migrations.mkdir(parents=True)
            for p in (ROOT / 'supabase/migrations').glob('*.sql'):
                if p.name != CANDIDATE:
                    (migrations / p.name).symlink_to(p)
            fixture.ROOT = Path(root)
            with NativePostgres(args.pg_bin) as db:
                fixture.DisposablePostgres.bootstrap(db)
                signatures = "('clinic_post_invoice','clinic_edit_invoice','clinic_post_split_invoice','clinic_post_demo_invoice')"
                def originals():
                    return db.sql("select string_agg(p.oid::regprocedure::text||':'||md5(pg_get_functiondef(p.oid)),',' order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in " + signatures)
                before = originals()
                db.sql('begin;\n' + candidate_sql + '\ncommit;')
                check('S1 PR341 applies AFTER main and leaves original business RPC definitions intact', before == originals(), 'full main schema + PR341 last')
                run(db)
    except Exception as e:
        RESULTS.append(dict(case='SETUP/EXECUTION', status='BLOCKED', detail=str(e)))
        print('BLOCKED', e, flush=True)
    totals = {s: sum(x['status'] == s for x in RESULTS) for s in ('PASS', 'FAIL', 'BLOCKED')}
    print('TOTAL', json.dumps(totals), flush=True)
    if args.json:
        args.json.write_text(json.dumps(dict(totals=totals, results=RESULTS), indent=2))
    return int(totals['FAIL'] > 0 or totals['BLOCKED'] > 0)


if __name__ == '__main__':
    raise SystemExit(main())
