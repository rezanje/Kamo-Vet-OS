#!/usr/bin/env python3
"""Item susulan rawat jalan: dokter menambah item SETELAH kasir membuka keranjang.

LOCAL ONLY. Throwaway native PostgreSQL (Unix socket), ALL repository migrations, the
susulan migration LAST (it is also last by filename). Fictional fixtures; public RPCs
run as role `authenticated` with fictional JWT actors. No business stubs, no remote URL,
no credentials. This is database integration, NOT authenticated Next.js/browser UAT.

--candidate-ref REV replays the candidate SQL exactly as committed at REV (the PR341
file 20261101000000_*) in place of the current file, to record the RED baseline.
"""
import argparse
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
CURRENT = '20261104340000_item_susulan_rekam_medis.sql'
LEGACY = '20261101000000_item_susulan_rekam_medis.sql'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


x = load('racikan', 'test-ranap-racikan-postgres.py')
r, dp, c = x.r, x.dp, x.c
q, j = r.q, r.j
RESULTS = []


def check(case, ok, detail):
    RESULTS.append(dict(case=case, status='PASS' if ok else 'FAIL', detail=detail))
    print(RESULTS[-1]['status'], case, json.dumps(detail, ensure_ascii=False, default=str)[:1500], flush=True)


def outpatient(h, n):
    """Rawat jalan: pemeriksaan tersimpan, layanan selesai, menunggu Pembayaran, belum ada invoice."""
    v = r.buat_kunjungan(h, n, r.buat_pelanggan(h, n), admitted=False)
    m = r.uid(7, n)
    h.sql(f"update public.medical_records set submission_key='initial-{n}',submitted_by={q(r.DOCTOR)} where id={q(m)};"
          f"update public.visits set status='Pembayaran',service_started_at=now()-interval '10 minutes',service_finished_at=now() where id={q(v)};")
    dp.consent(h, n, v)  # kategori Rawat Inap pada fixture wajib persetujuan bertanda tangan
    return v, m


def supports_version(h):
    return h.angka("select count(*) from pg_proc where proname='clinic_post_invoice_with_record' "
                   "and 'p_cart_version'=any(proargnames)") == 1


def version(h, v, user=None):
    return h.nilai(f'select public.clinic_outpatient_cart_version({q(v)});', user or r.OWNER)


def invoice(lines, user=r.OWNER):
    total = r.nilai_baris(lines)
    return dict(tanggal=r.TGL, subtotal=total, discount=0, tax=0, total=total, dp_amount=0, dp_date=None,
                paid_status='Belum Lunas', metode_bayar='Tunai', shift_id=r.SHIFT[user], voucher_code=None,
                salesperson_id=None, dp_override_reason='Uji fiktif item susulan tanpa uang')


def post_sql(v, key, lines, cart=None, user=r.OWNER, payments=None, inv=None):
    body = inv or invoice(lines, user)
    if cart is None:
        return f"select public.clinic_post_invoice_with_record({q(v)},{q(key)},{j(body)},{j(lines)},{j(payments) if payments else 'null'});"
    return (f"select public.clinic_post_invoice_with_record(p_visit_id=>{q(v)},p_request_key=>{q(key)},p_invoice=>{j(body)},"
            f"p_lines=>{j(lines)},p_payments=>{j(payments) if payments else 'null'},p_cart_version=>{q(cart)});")


def doctor_item(price=25000, qty=1, item=None):
    return dict(nama_obat='Obat susulan Fiktif', item_id=item or r.ITEM, qty=qty, satuan='pcs', faktor=1, harga=price,
                aturan_pakai='Instruksi Fiktif', jenis='obat', kategori=None)


def add_sql(v, key, items, compounds=()):
    return f"select public.clinic_add_record_items({q(v)},{q(key)},{j(items)},{j(list(compounds))});"


def pending(h, m):
    return h.angka(f"select count(*) from public.prescription_items p where p.medical_record_id={q(m)} and not exists("
                   "select 1 from public.invoice_items l join public.invoices i on i.id=l.invoice_id "
                   "where l.prescription_item_id=p.id and i.voided_at is null)")


def money(h, v):
    return dict(invoices=h.angka(f'select count(*) from public.invoices where visit_id={q(v)}'),
                journals=h.angka('select count(*) from public.journal_entries'),
                stock=h.angka(f'select qty from public.stock where warehouse_id={q(r.WH)} and item_id={q(r.ITEM)}'),
                material=h.angka(f'select qty from public.stock where warehouse_id={q(r.WH)} and item_id={q(x.MATERIAL)}'))


def cart_lines(h, m):
    """Keranjang persis seperti layar Pembayaran membentuknya dari baris resep tertunda."""
    rows = json.loads(h.nilai(
        "select coalesce(json_agg(json_build_object('description',nama_obat,'qty',qty,'price',harga,'kind',jenis,"
        "'item_id',item_id,'unit',satuan,'prescription_item_id',id,'recipe_id',compound_recipe_id,'discount_percent',0)"
        f" order by created_at,id),'[]') from public.prescription_items where medical_record_id={q(m)}"))
    return rows


def wait_lock(observer, waiter, evidence, blockers=None):
    deadline = time.monotonic() + 5
    rows = []
    while time.monotonic() < deadline:
        rows = observer.sql("select json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait_event_type',"
                            f"wait_event_type,'wait_event',wait_event)::text from pg_stat_activity where pid={waiter.pid};")
        if rows:
            state = json.loads(rows[-1])
            if state['wait_event_type'] == 'Lock' and state['wait_event'] and state['blockers'] and (
                    blockers is None or any(b.pid in state['blockers'] for b in blockers)):
                evidence.append(dict(state, waiter=waiter.name))
                return
        if waiter.p.poll() is not None:
            raise AssertionError(f'{waiter.name} exited before the lock barrier')
    raise TimeoutError(f'no lock barrier for {waiter.name}: {rows}')


def scenarios(h, db, sku_version):
    has_version = supports_version(h)
    # --- K0 pembaca versi keranjang ------------------------------------------------------------
    v, m = outpatient(h, 3401)
    try:
        v1 = version(h, v)
        stable = version(h, v) == v1
        denied = h.gagal(f'select public.clinic_outpatient_cart_version({q(v)});', r.FIN_LUAR)
        check('K0 cashier reads a stable outpatient cart version; other-branch actor refused',
              bool(v1) and stable and bool(denied and 'ACCESS_DENIED' in denied), dict(version=v1, foreign=denied))
    except RuntimeError as e:
        check('K0 cashier reads a stable outpatient cart version; other-branch actor refused', False, str(e)[:300])
        v1 = 'v1:00000000000000000000000000000000'
    stale_lines = cart_lines(h, m)  # kasir membuka keranjang SEBELUM dokter menambah item
    # --- K1 dokter menambah item sesudah keranjang dibuka --------------------------------------
    before = money(h, v)
    err = h.gagal(add_sql(v, 'k1-add', [doctor_item()]), r.DOCTOR)
    marker = h.nilai(f"select coalesce(susulan_source,'-')||'|'||coalesce(susulan_by_name,'-') from public.prescription_items "
                     f"where medical_record_id={q(m)} and nama_obat='Obat susulan Fiktif'")
    check('K1 doctor adds an item after the cart was opened: record-only, marked doctor + name, no money/stock',
          not err and marker == 'dokter|Pengguna Fiktif 5' and money(h, v) == before and pending(h, m) == 5,
          dict(error=err, marker=marker, before=before, after=money(h, v)))
    # --- K2 keranjang lama ditolak, tidak ada invoice tanpa item dokter -------------------------
    err = h.gagal(post_sql(v, 'k2-stale', stale_lines, v1), r.OWNER)
    check('K2 old cart (stale version) is refused CART_STALE; no invoice/journal/stock; doctor item still pending',
          bool(err and 'CART_STALE' in err) and money(h, v) == before and pending(h, m) == 5,
          dict(error=(err or '')[:300], after=money(h, v), pending=pending(h, m)))
    # --- K3 muat ulang lalu simpan: item dokter ikut tertagih & tertaut ---------------------------
    fresh = cart_lines(h, m)
    try:
        v2 = version(h, v)
        changed = v2 != v1
        inv_id = h.nilai(post_sql(v, 'k3-fresh', fresh, v2), r.OWNER)
        linked = h.angka(f"select count(*) from public.invoice_items l join public.prescription_items p on p.id=l.prescription_item_id "
                         f"where l.invoice_id={q(inv_id)} and p.susulan_source='dokter'")
        check('K3 reloaded cart (new version) posts; doctor susulan line linked to the same invoice + record',
              changed and linked == 1 and pending(h, m) == 0 and h.status_bayar(inv_id) == 'Belum Lunas',
              dict(version_changed=changed, linked_doctor_lines=linked, pending=pending(h, m)))
        # --- K4 replay pengiriman yang sama tidak terhalang versi lama dan tidak menggandakan -----
        snap = money(h, v)
        replay = h.nilai(post_sql(v, 'k3-fresh', fresh, v2), r.OWNER)
        check('K4 exact creation replay returns the same invoice despite the now-older version; no duplicates',
              replay == inv_id and money(h, v) == snap, dict(replay=replay, invoice=inv_id))
        # --- K5 dokter setelah tagihan terbit tetap ditutup ----------------------------------------
        err = h.gagal(add_sql(v, 'k5-after', [doctor_item()]), r.DOCTOR)
        check('K5 doctor addition after posting stays RECORD_LOCKED', bool(err and 'RECORD_LOCKED' in err), (err or '')[:200])
    except RuntimeError as e:
        for case in ('K3 reloaded cart (new version) posts; doctor susulan line linked to the same invoice + record',
                     'K4 exact creation replay returns the same invoice despite the now-older version; no duplicates',
                     'K5 doctor addition after posting stays RECORD_LOCKED'):
            check(case, False, str(e)[:300])
    # --- K6 tanpa versi: wrapper menolak (gagal tertutup) ---------------------------------------
    v, m = outpatient(h, 3402)
    err = h.gagal(post_sql(v, 'k6-noversion', cart_lines(h, m)), r.OWNER)
    check('K6 wrapper without cart version fails closed (no silent legacy-style posting)',
          bool(err and 'CART_STALE' in err) and money(h, v)['invoices'] == 0, (err or 'posted without version')[:300])
    # --- K7 koreksi penuh dokter: baris baru ditandai & mengubah versi --------------------------
    v, m = outpatient(h, 3405)
    try:
        k7v = version(h, v)
    except RuntimeError:
        k7v = None
    rows = json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(p) order by created_at,id),'[]') from public.prescription_items p where medical_record_id={q(m)}"))
    rows.append(dict(prescription_item_id=None, item_id=r.ITEM, nama_obat='x', qty=1, harga=25000, satuan='pcs', jenis='obat', kategori=None))
    full = (f"select public.clinic_edit_queued_record({q(v)},{q(m)},0,{j(dict(anamnesis='Koreksi Fiktif',diagnosis=None,therapy=None,suhu=None,gejala_klinis=None,hasil_penunjang=None))},"
            f"{j(rows)},'Tambah obat lewat koreksi penuh fiktif','k7-full');")
    err = h.gagal(full, r.DOCTOR)
    marker = h.nilai(f"select coalesce(susulan_source,'-')||'|'||coalesce(susulan_by_name,'-') from public.prescription_items "
                     f"where medical_record_id={q(m)} order by created_at desc, id desc limit 1")
    untouched = h.angka(f"select count(*) from public.prescription_items where medical_record_id={q(m)} and susulan_at is not null")
    try:
        k7v2 = version(h, v)
    except RuntimeError:
        k7v2 = None
    check('K7 doctor full-record edit: only the NEW row is marked doctor + name, and the cart version changes',
          not err and marker == 'dokter|Pengguna Fiktif 5' and untouched == 1 and k7v is not None and k7v2 != k7v,
          dict(error=(err or '')[:300], marker=marker, marked=untouched, before=k7v, after=k7v2))
    # --- K8 batas peran dokter & master barang (penjaga baru main) ------------------------------
    for user, label in ((r.STAFF, 'STAFF'), (r.FINANCE, 'FINANCE'), (r.ADMIN, 'ADMIN')):
        err = h.gagal(add_sql(v, f'k8-{label}', [doctor_item()]), user)
        check(f'K8 {label} cannot add doctor susulan items (ACCESS_DENIED, main doctor/owner gate)',
              bool(err and 'ACCESS_DENIED' in err), (err or 'accepted')[:200])
    free = dict(doctor_item(), item_id=None, nama_obat='Obat ketik bebas')
    err = h.gagal(add_sql(v, 'k8-free', [free]), r.DOCTOR)
    check('K8b doctor susulan free-text item refused (master item required, main 0408 rule)',
          bool(err and 'RECORD_INVALID' in err), (err or 'accepted')[:200])
    # --- K9 pembayaran campuran lewat pembungkus tetap sah --------------------------------------
    v, m = outpatient(h, 3403)
    lines = cart_lines(h, m) + [dict(description='Jasa kasir Fiktif', qty=1, price=10000, kind='jasa', unit='jasa', discount_percent=0)]
    total = r.nilai_baris(lines)
    body = {k: val for k, val in dict(invoice(lines), paid_status='Lunas').items() if k != 'dp_override_reason'}
    payments = [dict(method='Tunai', amount=total - 100000, kas_code='110003'), dict(method='Transfer', amount=100000, kas_code='120002')]
    try:
        cart = version(h, v) if has_version else None
        inv_id = h.nilai(post_sql(v, 'k9-split', lines, cart, payments=payments, inv=body), r.OWNER)
        cashier = h.nilai(f"select coalesce(susulan_source,'-') from public.prescription_items where medical_record_id={q(m)} and nama_obat='Jasa kasir Fiktif'")
        check('K9 mixed Tunai+Transfer through wrapper: Lunas, cashier line recorded (kasir) and linked',
              h.status_bayar(inv_id) == 'Lunas' and h.diterima(inv_id) == total and cashier == 'kasir' and pending(h, m) == 0,
              dict(status=h.status_bayar(inv_id), received=h.diterima(inv_id), total=total, cashier=cashier))
    except RuntimeError as e:
        check('K9 mixed Tunai+Transfer through wrapper: Lunas, cashier line recorded (kasir) and linked', False, str(e)[:300])
    # --- K10 DP & rawat inap lewat pembungkus: baris kasir ikut rekam medis --------------------
    v = dp.visit(h, 3404)
    m = r.uid(7, 3404)
    lines = dp.lines(3404) + [dict(description='Jasa kasir DP Fiktif', qty=1, price=10000, kind='jasa', unit='jasa', discount_percent=0)]
    body = {k: val for k, val in dict(invoice(lines), paid_status='DP', dp_amount=200000, dp_date=r.TGL).items() if k != 'dp_override_reason'}
    try:
        cart = version(h, v)
        out = json.loads(h.nilai(f"select public.clinic_post_dp_and_admit_with_record({q(v)},'k10-dp',{j(body)},{j(lines)},'Monitoring fiktif','sakit',{q(cart)});", r.OWNER))
        cashier = h.nilai(f"select coalesce(susulan_source,'-') from public.prescription_items where medical_record_id={q(m)} and nama_obat='Jasa kasir DP Fiktif'")
        linked = h.angka(f"select count(*) from public.invoice_items where invoice_id={q(out['invoice_id'])} and prescription_item_id is not null")
        check('K10 DP & admit wrapper: DP saved, stay opened, cashier line recorded (kasir) and every line linked',
              h.status_bayar(out['invoice_id']) == 'DP' and bool(out.get('inpatient_id')) and cashier == 'kasir' and linked == len(lines),
              dict(result=out, cashier=cashier, linked=linked, lines=len(lines)))
    except (RuntimeError, ValueError) as e:
        check('K10 DP & admit wrapper: DP saved, stay opened, cashier line recorded (kasir) and every line linked', False, str(e)[:300])
    demo(h, has_version)
    race_doctor_first(h, db, sku_version, has_version)
    race_cashier_first(h, db, sku_version, has_version)


def demo(h, has_version):
    """DEMO checkout lewat pembungkus: aturan DEMO asli (save_clinic_demo_policy), petugas
    penangan kunjungan, dua bagian pembayaran. Baris kasir tetap tercatat di rekam medis."""
    case = 'K11 DEMO checkout through wrapper: Lunas + DEMO snapshot, cashier line recorded (kasir), all lines linked'
    v, m = outpatient(h, 3406)
    h.sql("insert into public.coa_accounts(code,name,type,normal_balance,is_active,is_header) values "
          "('810004','Pendapatan admin DEMO Fiktif','PENDAPATAN','K',true,false),('740010','Beban admin DEMO Fiktif','BEBAN','D',true,false) "
          "on conflict(code) do update set is_active=true,is_header=false;"
          f"update public.customers set name='DEMO Pemilik Fiktif' where id=(select customer_id from public.visits where id={q(v)});")
    try:
        policy = h.nilai("select public.save_clinic_demo_policy('DEMO Fiktif',5,'customer','{\"Tunai\":0,\"Transfer\":100}','810004','740010');", r.OWNER)
        lines = cart_lines(h, m) + [dict(description='Jasa kasir DEMO Fiktif', qty=1, price=10000, kind='jasa', unit='jasa', discount_percent=0)]
        total = r.nilai_baris(lines)
        body = {k: val for k, val in dict(invoice(lines), paid_status='Lunas').items() if k != 'dp_override_reason'}
        parts = [dict(method='Tunai', amount=total - 100000, kas_code='110003'), dict(method='Transfer', amount=100000, kas_code='120002')]
        cart = f",p_cart_version=>{q(version(h, v))}" if has_version else ''
        inv_id = h.nilai(f"select public.clinic_post_invoice_with_record(p_visit_id=>{q(v)},p_request_key=>'k11-demo',p_invoice=>{j(body)},"
                         f"p_lines=>{j(lines)},p_payments=>{j(parts)},p_policy_id=>{q(policy)},p_employee_ids=>array[{q(r.DOKTER_PEGAWAI)}]::uuid[]{cart});", r.OWNER)
        cashier = h.nilai(f"select coalesce(susulan_source,'-') from public.prescription_items where medical_record_id={q(m)} and nama_obat='Jasa kasir DEMO Fiktif'")
        snapshot = h.angka(f'select count(*) from public.clinic_demo_invoice_snapshots where invoice_id={q(inv_id)}')
        check(case, h.status_bayar(inv_id) == 'Lunas' and snapshot == 1 and cashier == 'kasir' and pending(h, m) == 0,
              dict(status=h.status_bayar(inv_id), snapshot=snapshot, cashier=cashier, pending=pending(h, m),
                   total=h.angka(f'select total from public.invoices where id={q(inv_id)}')))
    except RuntimeError as e:
        check(case, False, str(e)[:500])


def compound(sku_version, key):
    return dict(x.payload(sku_version, key), service_performers=None)


def race_doctor_first(h, db, sku_version, has_version):
    """Gate pins the visit row. Doctor (racikan susulan) waits first, cashier posting second.
    Old lock order (visit row -> billing coordinator inside compound issue) deadlocks with the
    posting wrapper (billing coordinator -> visit row). Fixed: no deadlock; cashier's stale
    cart is refused CART_STALE, doctor's racikan stays pending for the next reload."""
    v, m = outpatient(h, 3410)
    lines = cart_lines(h, m)
    cart = version(h, v) if has_version else None
    before = money(h, v)
    evidence = []
    case = 'R1 doctor racikan susulan racing cashier posting: no deadlock; stale cart refused; racikan pending'
    try:
        with contextlib.ExitStack() as stack:
            gate = stack.enter_context(c.Session(db, 'k-gate'))
            observer = stack.enter_context(c.Session(db, 'k-observer'))
            doctor = stack.enter_context(c.Session(db, 'k-doctor', r.DOCTOR))
            cashier = stack.enter_context(c.Session(db, 'k-cashier', r.OWNER))
            gate.sql(f'begin; select id from public.visits where id={q(v)} for update;')
            doctor.send('begin; ' + add_sql(v, 'r1-racik', [], [compound(sku_version, 'r1-racik-key')]))
            wait_lock(observer, doctor, evidence, [gate])
            cashier.send('begin; ' + post_sql(v, 'r1-post', lines, cart))
            wait_lock(observer, cashier, evidence)
            gate.sql('commit;')
            first = c.attempt(doctor)
            second = c.attempt(cashier)
        text = json.dumps([first, second]).lower()
        after = money(h, v)
        racik = h.angka(f"select count(*) from public.prescription_items where medical_record_id={q(m)} and compound_recipe_id is not null and susulan_source='dokter'")
        check(case, first['ok'] and not second['ok'] and 'cart_stale' in text
              and not any(s in text for s in ('deadlock', '40p01', 'timeout', '55p03', '57014'))
              and after['invoices'] == 0 and racik == 1 and pending(h, m) == 5,
              dict(doctor=first, cashier=second, barrier=evidence, before=before, after=after, racikan=racik))
    except (TimeoutError, AssertionError, RuntimeError) as e:
        check(case, False, dict(error=str(e)[:500], barrier=evidence))


def race_cashier_first(h, db, sku_version, has_version):
    v, m = outpatient(h, 3411)
    lines = cart_lines(h, m)
    cart = version(h, v) if has_version else None
    evidence = []
    case = 'R2 cashier posting first, doctor racikan second: invoice posts once; doctor refused RECORD_LOCKED; no deadlock'
    try:
        with contextlib.ExitStack() as stack:
            gate = stack.enter_context(c.Session(db, 'k2-gate'))
            observer = stack.enter_context(c.Session(db, 'k2-observer'))
            doctor = stack.enter_context(c.Session(db, 'k2-doctor', r.DOCTOR))
            cashier = stack.enter_context(c.Session(db, 'k2-cashier', r.OWNER))
            gate.sql(f'begin; select id from public.visits where id={q(v)} for update;')
            cashier.send('begin; ' + post_sql(v, 'r2-post', lines, cart))
            wait_lock(observer, cashier, evidence, [gate])
            doctor.send('begin; ' + add_sql(v, 'r2-racik', [], [compound(sku_version, 'r2-racik-key')]))
            wait_lock(observer, doctor, evidence)
            gate.sql('commit;')
            first = c.attempt(cashier)
            second = c.attempt(doctor)
        text = json.dumps([first, second]).lower()
        after = money(h, v)
        check(case, first['ok'] and not second['ok'] and 'record_locked' in text
              and not any(s in text for s in ('deadlock', '40p01', 'timeout', '55p03', '57014'))
              and after['invoices'] == 1 and pending(h, m) == 0,
              dict(cashier=first, doctor=second, barrier=evidence, after=after))
    except (TimeoutError, AssertionError, RuntimeError) as e:
        check(case, False, dict(error=str(e)[:500], barrier=evidence))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', default=os.environ.get('KAMO_PG_BIN', '/opt/data/kamo-pg-harness/bin'))
    parser.add_argument('--candidate-ref', help='git revision whose PR341 file (20261101000000_*) replaces the current migration')
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    if args.candidate_ref:
        candidate = subprocess.check_output(['git', 'show', f'{args.candidate_ref}:supabase/migrations/{LEGACY}'], cwd=ROOT, text=True)
    else:
        candidate = (ROOT / 'supabase/migrations' / CURRENT).read_text()
    meta = dict(candidate=args.candidate_ref or CURRENT)
    try:
        with tempfile.TemporaryDirectory(prefix='kamo-d-susulan-', dir='/opt/data') as root:
            migrations = Path(root) / 'supabase/migrations'
            migrations.mkdir(parents=True)
            for p in (ROOT / 'supabase/migrations').glob('*.sql'):
                if p.name not in (CURRENT, LEGACY):
                    (migrations / p.name).symlink_to(p)
            r.fixture.ROOT = Path(root)
            with x.LocalPostgres(args.pg_bin) as db:
                r.fixture.DisposablePostgres.bootstrap(db)
                meta['main_migrations'] = len(list(migrations.glob('*.sql')))
                meta['server'] = db.sql('show server_version')
                db.sql('begin;\n' + candidate + '\ncommit;')
                h = x.Harness(db)
                sku_version = x.setup(h)
                scenarios(h, db, sku_version)
    except Exception as e:  # noqa: BLE001 - recorded as BLOCKED, never as PASS
        RESULTS.append(dict(case='SETUP/EXECUTION', status='BLOCKED', detail=str(e)[:2000]))
        print('BLOCKED', e, flush=True)
    totals = {s: sum(x_['status'] == s for x_ in RESULTS) for s in ('PASS', 'FAIL', 'BLOCKED')}
    print('TOTAL', json.dumps(totals), json.dumps(meta), flush=True)
    if args.json:
        args.json.write_text(json.dumps(dict(meta=meta, totals=totals, results=RESULTS), indent=2, ensure_ascii=False, default=str))
    return int(totals['FAIL'] > 0 or totals['BLOCKED'] > 0)


if __name__ == '__main__':
    raise SystemExit(main())
