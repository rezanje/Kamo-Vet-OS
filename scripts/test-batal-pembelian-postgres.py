#!/usr/bin/env python3
"""Bukti native PG17: Batalkan pembelian ala Accurate (Owner akses penuh). Hanya soket lokal, tanpa DB hosted.

  Mengambil /opt/data/kamo-heavy-test.lock sendiri (jangan dibungkus flock).
  python3 -I scripts/test-batal-pembelian-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin [--baseline] [--mutations] [--suites] [--concurrency] --json out.json

--baseline    : tanpa migrasi kandidat (RED: seksi yang menguji perilaku baru harus GAGAL)
default       : kandidat terpasang (GREEN: 0 gagal)
--mutations   : tiap mutan migrasi dipasang pada klon bersih; setiap mutan harus membuat >= 1 seksi gagal
--suites      : suite SQL tetangga (PO / penerimaan / faktur / pembayaran / uang muka) pada klon TANPA dan DENGAN kandidat; hasil harus identik
--concurrency : dua sesi psql paralel membatalkan penerimaan yang sama (efek tepat satu kali)
"""
import argparse
import concurrent.futures
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres  # noqa: E402

CANDIDATE = '20261112500000_batal_pembelian_owner_penuh.sql'
TESTS = ROOT / 'supabase/tests/batal_pembelian'
AVG_MARKER = '-- @AVERAGE_ACTIVATION@'
NEIGHBOURS = ['po_branch_numbering.sql', 'purchase_order_lifecycle.sql', 'goods_receipt_cancellation.sql', 'purchase_recovery.sql',
              'purchase_short_close.sql', 'purchase_short_close_guards.sql', 'n01_purchase_invoice_receipts.sql',
              'purchase_order_line_correction.sql', 'purchase_payment_corrections.sql', 'purchase_advance_atomic.sql',
              'purchase_advance_precision.sql', 'purchase_invoice_lifecycle.sql', 'purchase_invoice_line_correction.sql',
              'purchase_correction_requests.sql', 'average_purchase_corrections.sql', 'po_price_after_advance.sql',
              'p08_advance_cancel_cascade.sql', 'opening_ap_ar_invoices.sql']


# Fungsi database memakai tanggal Asia/Jakarta (today := (now() at time zone 'Asia/Jakarta')::date); sesi uji harus memakai zona yang
# sama supaya current_date di tes = tanggal yang dipakai fungsi (selisih 7 jam membuat tes gagal sesudah pukul 17.00 UTC).
os.environ['PGTZ'] = 'Asia/Jakarta'


def first_error(exc):
    """Galat PERTAMA suite (tanpa UUID/angka acak) supaya dua jalan bisa dibandingkan pada pernyataan yang sama."""
    text = re.sub(r'\s+', ' ', str(exc))
    m = re.search(r'(ERROR:.*?)(?: CONTEXT:| LINE \d+:| DETAIL:| HINT:|$)', text)
    msg = m.group(1) if m else text[-200:]
    msg = re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', msg)
    return msg[:240]


def load_fixture():
    spec = importlib.util.spec_from_file_location('fullschema', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def average_snippet():
    return ((ROOT / 'supabase/tests/fixtures/average_opening_gl.sql').read_text()
            + '\nselect pg_temp.seed_average_opening_gl();\nselect activate_moving_average();\n'
            + "select pg_temp.ok((select method from inventory_costing_settings where id)='moving_average','average aktif');\n")


def section_sources(path):
    text = path.read_text()
    helpers = (TESTS / '_helpers.sql').read_text()
    has_avg = AVG_MARKER in text
    out = [('fifo', 'begin;\n' + helpers + text.replace(AVG_MARKER, '') + '\nrollback;\n')]
    if has_avg:
        out.append(('average', 'begin;\n' + helpers + text.replace(AVG_MARKER, average_snippet(), 1) + '\nrollback;\n'))
    return out


def run_sections(db, database, stop_at_first=False):
    results = []
    os.environ['PGDATABASE'] = database
    try:
        for path in sorted(TESTS.glob('[0-9][0-9]_*.sql')):
            if path.name.startswith('00_'):
                continue
            for mode, src in section_sources(path):
                name = f'{path.stem}[{mode}]'
                try:
                    db.sql(src)
                    results.append((name, True, ''))
                    print('PASS', name, flush=True)
                except RuntimeError as e:
                    msg = re.sub(r'\s+', ' ', str(e))
                    first = (re.findall(r'ERROR:[^\n]*', str(e)) or [''])[0].strip()
                    results.append((name, False, (first or msg)[-300:]))
                    print('FAIL', name, '::', (first or msg)[:260], flush=True)
                    if stop_at_first:
                        return results
    finally:
        os.environ.pop('PGDATABASE', None)
    return results


def apply_text(db, text, database):
    os.environ['PGDATABASE'] = database
    try:
        db.sql('begin;\n' + text + '\ncommit;')
    finally:
        os.environ.pop('PGDATABASE', None)


def later_migrations():
    """Migrasi yang ditulis SESUDAH kandidat: rantai dasar hanya memuat yang lebih lama, kandidat dipasang di atasnya, lalu yang lebih baru (urutan nyata)."""
    return sorted(p for p in (ROOT / 'supabase/migrations').glob('*.sql') if p.name > CANDIDATE)


def apply_with_later(db, text, database):
    apply_text(db, text, database)
    for path in later_migrations():
        apply_text(db, path.read_text(), database)


def mutate(text, subs):
    for old, new, times in subs:
        n = text.count(old)
        assert n == times, f'jangkar mutan harus muncul {times}x, muncul {n}x: {old!r}'
        text = text.replace(old, new)
    return text


GATE_R1 = "if auth.uid() is null or not public.purchase_cancel_allowed('pembelian.batalkan_penerimaan') then"
GATE_R2 = "$b$if not public.purchase_cancel_allowed('pembelian.batalkan_penerimaan') then$b$,'receipt owner gate 2'"
MUTANTS = [
    ('gerbang penerimaan #1 selalu lolos', [("$b$"+GATE_R1+"$b$", "$b$if auth.uid() is null then$b$", 1)]),
    ('gerbang penerimaan #2 (sebelum tulis) dihapus', [(GATE_R2, "$b$if false then$b$,'receipt owner gate 2'", 1)]),
    ('gerbang penerimaan memakai izin faktur', [("$b$if not public.purchase_cancel_allowed('pembelian.batalkan_penerimaan') then$b$", "$b$if not public.purchase_cancel_allowed('pembelian.batalkan_faktur') then$b$", 1)]),
    ('retur batal tetap memblokir penerimaan', [("$b$if exists (select 1 from public.purchase_returns rt where rt.po_id = po.id and rt.voided_at is null) then$b$", "$b$if exists (select 1 from public.purchase_returns rt where rt.po_id = po.id) then$b$", 1)]),
    ('aturan barang-keluar penerimaan berlaku juga di FIFO', [("$b$if public.inventory_is_average() and exists (select 1 from public.stock_moves m where m.warehouse_id = v_wh and m.item_id = any (v_items)$b$", "$b$if exists (select 1 from public.stock_moves m where m.warehouse_id = v_wh and m.item_id = any (v_items)$b$", 1)]),
    ('aturan barang-keluar penerimaan dimatikan (juga di rata-rata)', [("if public.inventory_is_average() and exists (select 1 from public.stock_moves m where m.warehouse_id = v_wh and m.item_id = any (v_items)$b$", "if false and exists (select 1 from public.stock_moves m where m.warehouse_id = v_wh and m.item_id = any (v_items)$b$", 1)]),
    ('gerbang faktur selalu lolos', [("$b$if not public.purchase_cancel_allowed('pembelian.batalkan_faktur') then raise exception 'Pembatalan faktur hanya oleh OWNER atau peran yang diberi izin Batalkan faktur di Akses Grup' using errcode='42501';end if;$b$,'invoice owner gate',3)", "$b$if false then raise exception 'x' using errcode='42501';end if;$b$,'invoice owner gate',3)", 1)]),
    ('aturan barang-dipakai faktur berlaku juga di FIFO', [("$b$if public.inventory_is_average() and exists(select 1 from public.stock_moves m where m.warehouse_id=proof.warehouse_id", "$b$if exists(select 1 from public.stock_moves m where m.warehouse_id=proof.warehouse_id", 1)]),
    ('aturan barang-dipakai faktur dimatikan', [("$b$if public.inventory_is_average() and exists(select 1 from public.stock_moves m where m.warehouse_id=proof.warehouse_id", "$b$if false and exists(select 1 from public.stock_moves m where m.warehouse_id=proof.warehouse_id", 1)]),
    ('gerbang pembayaran selalu lolos', [("if not found or not public.purchase_cancel_allowed('pembelian.batalkan_pembayaran') then raise exception 'Hanya Owner aktif (atau peran yang diberi izin Batalkan pembayaran di Akses Grup) dapat membatalkan pembayaran'", "if not found then raise exception 'Hanya Owner aktif (atau peran yang diberi izin Batalkan pembayaran di Akses Grup) dapat membatalkan pembayaran'", 1)]),
    ('gerbang uang muka selalu lolos', [("$b$if not public.purchase_cancel_allowed('pembelian.batalkan_uang_muka') then$b$,'advance owner gate',2)", "$b$if false then$b$,'advance owner gate',2)", 1)]),
    ('Owner tidak lagi otomatis boleh', [("if v_role='OWNER' then return true; end if;", "if v_role='OWNER' then return false; end if;", 1)]),
    ('peran lain boleh bila tidak ada kebijakan (bawaan hidup)', [("return found and p_action=any(v_allowed);", "return not found or p_action=any(v_allowed);", 1)]),
    ('galat kebijakan membuka gerbang', [("return coalesce(v_role='OWNER',false);\nend $$;", "return true;\nend $$;", 1)]),
    ('Owner hanya dijawab lewat kebijakan (tanpa jawaban awal) dan galat mengunci', [("if v_role='OWNER' then return true; end if;", "", 1), ("return coalesce(v_role='OWNER',false);\nend $$;", "return false;\nend $$;", 1)]),
    ('tindakan tak dikenal diizinkan', [("if p_action is null or p_action not in ('pembelian.batalkan_penerimaan','pembelian.batalkan_faktur','pembelian.batalkan_pembayaran','pembelian.batalkan_uang_muka') then return false; end if;", "", 1)]),
    ('void PO tetap terhalang faktur batal', [("$b$or exists(select 1 from public.purchase_invoices where po_id=v_po.id and (p_action<>'void' or voided_at is null))$b$", "$b$or exists(select 1 from public.purchase_invoices where po_id=v_po.id)$b$", 1)]),
    ('void PO tetap terhalang uang muka batal', [("(p_action<>'void' or status='aktif')", "(true)", 1)]),
    ('edit PO lolos meski ada riwayat batal', [("$b$or exists(select 1 from public.purchase_invoices where po_id=v_po.id and (p_action<>'void' or voided_at is null))$b$", "$b$or exists(select 1 from public.purchase_invoices where po_id=v_po.id and voided_at is null)$b$", 1)]),
    ('pratinjau: penghalang faktur aktif hilang', [("for r in select i.id,i.no_faktur,coalesce((select sum(p.amount) from public.purchase_invoice_payments p where p.invoice_id=i.id),0) paid\n          from public.purchase_invoice_receipts l", "for r in select i.id,i.no_faktur,0 paid from public.purchase_invoice_receipts l", 1)]),
    ('pratinjau: penghalang barang terpakai hilang', [("if was_consumed then\n  select coalesce(jsonb_agg(jsonb_build_object('source'", "if false then\n  select coalesce(jsonb_agg(jsonb_build_object('source'", 1)]),
    ('pratinjau: penghalang sisa ditutup hilang', [("if exists(select 1 from public.purchase_order_receipt_closures c where c.po_id=po.id) then\n  b:=b||", "if false then\n  b:=b||", 1)]),
    ('pratinjau: aturan rata-rata dihilangkan', [("if v_avg and exists(select 1 from public.stock_moves m where m.warehouse_id=v_wh", "if false and exists(select 1 from public.stock_moves m where m.warehouse_id=v_wh", 1)]),
    ('pratinjau: periode tertutup tidak diperiksa', [("if v_closed is not null and (gr.tanggal<=v_closed or p_tanggal<=v_closed) then", "if false then", 1)]),
    ('buka sisa: arsip tidak ditulis', [("insert into public.purchase_order_receipt_closure_reopenings(po_id,branch_id,actor_id,request_key,payload,reason,closure,result)\n  values(po.id,po.branch_id,auth.uid(),p_request_key,payload,v_reason,to_jsonb(cl)-'request_key'-'payload',result);", "null;", 1)]),
    ('buka sisa: penjaga hapus selalu mengizinkan', [("if tg_op='DELETE' and current_user not in ('authenticated','anon','service_role') and current_setting('vetos.reopen_closure',true)='on' then return old; end if;", "if tg_op='DELETE' and current_user not in ('authenticated','anon','service_role') then return old; end if;", 1)]),
    ('buka sisa: izin tidak diperiksa', [("if not public.purchase_cancel_allowed('pembelian.batalkan_penerimaan') then\n  raise exception 'Membuka kembali sisa PO", "if false then\n  raise exception 'Membuka kembali sisa PO", 1)]),
    ('buka sisa: status PO tidak dipulihkan', [("if v_status<>po.status::text then update public.purchase_orders set status=v_status::public.po_status where id=po.id; end if;", "null;", 1)]),
    ('buka sisa: kunci idempoten diabaikan', [("if found then\n  if prior.payload is distinct from payload then raise exception 'Kunci pembukaan sudah dipakai dengan rincian berbeda. Muat ulang halaman' using errcode='22023'; end if;\n  return prior.result;\n end if;", "null;", 1)]),
    ('katalog: tindakan tidak ditegakkan', [("('pembelian.batalkan_faktur','Batalkan faktur pembelian — Pembelian','Pembelian',true)", "('pembelian.batalkan_faktur','Batalkan faktur pembelian — Pembelian','Pembelian',false)", 1)]),
    ('katalog: modul salah', [("('pembelian.batalkan_uang_muka','pembelian');", "('pembelian.batalkan_uang_muka','kas-bank');", 1)]),
    ('izin dapat dipanggil anon', [("grant execute on function public.purchase_cancel_allowed(text) to authenticated;", "grant execute on function public.purchase_cancel_allowed(text) to authenticated, anon;", 1)]),
    ('pembaca pemulihan pembayaran tetap hanya Owner', [("if not public.purchase_cancel_allowed('pembelian.batalkan_pembayaran') then raise exception 'Hanya Owner aktif (atau peran yang diberi izin Batalkan pembayaran di Akses Grup) dapat memeriksa koreksi'", "if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') then raise exception 'Hanya Owner aktif (atau peran yang diberi izin Batalkan pembayaran di Akses Grup) dapat memeriksa koreksi'", 1)]),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', default='/opt/data/kamo-pg-harness/bin')
    ap.add_argument('--baseline', action='store_true')
    ap.add_argument('--mutations', action='store_true')
    ap.add_argument('--suites', action='store_true')
    ap.add_argument('--concurrency', action='store_true')
    ap.add_argument('--suite-only', help='hanya suite tetangga ini (pelacakan); cetak galat lengkap')
    ap.add_argument('--only', help='substring: hanya seksi yang namanya memuat ini')
    ap.add_argument('--json')
    args = ap.parse_args()
    cand_path = ROOT / 'supabase/migrations' / CANDIDATE
    candidate = cand_path.read_text() if cand_path.exists() else None
    report = {'candidate': CANDIDATE, 'candidate_sha256': hashlib.sha256(candidate.encode()).hexdigest() if candidate else None,
              'baseline': args.baseline, 'control': [], 'mutants': [], 'suites': [], 'concurrency': None}
    with open('/opt/data/kamo-heavy-test.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        fixture = load_fixture()
        with tempfile.TemporaryDirectory(prefix='batalbeli-chain-', dir='/opt/data') as tmp:
            migrations = Path(tmp) / 'supabase/migrations'
            migrations.mkdir(parents=True)
            names = sorted(p.name for p in (ROOT / 'supabase/migrations').glob('*.sql') if p.name < CANDIDATE)
            for n in names:
                (migrations / n).symlink_to(ROOT / 'supabase/migrations' / n)
            fixture.ROOT = Path(tmp)
            report['chain_migrations'] = len(names)
            with NativePostgres(args.pg_bin) as db:
                fixture.DisposablePostgres.bootstrap(db)
                assert 170000 <= int(db.last('show server_version_num')) < 180000
                report['server_version'] = db.last('show server_version')
                db.sql('create database tpl_bp_chain template postgres;')
                db.sql((TESTS / '00_fixture.sql').read_text())
                db.sql('create database tpl_bp_fix template postgres;')
                if candidate and not args.baseline:
                    apply_with_later(db, candidate, 'postgres')
                report['control'] = [] if args.suite_only else run_sections(db, 'postgres')
                if args.only:
                    report['control'] = [c for c in report['control'] if args.only in c[0]]
                report['control_fail'] = sum(1 for c in report['control'] if not c[1])
                if args.mutations and candidate:
                    for name, subs in MUTANTS:
                        text = mutate(candidate, subs)
                        variant = 'v_' + re.sub(r'[^a-z0-9]', '_', name.lower())[:44]
                        db.sql(f'create database {variant} template tpl_bp_fix;')
                        crash = None
                        try:
                            apply_with_later(db, text, variant)
                        except RuntimeError as e:
                            crash = str(e)[-240:]
                        failed = []
                        if crash is None:
                            res = run_sections(db, variant, stop_at_first=True)
                            failed = [c[0] for c in res if not c[1]]
                        report['mutants'].append({'name': name, 'killed': bool(failed), 'failed_cases': failed, 'apply_crash': crash})
                        print('MUTANT', 'KILLED' if failed else ('CRASH-AT-APPLY' if crash else 'SURVIVED'), name, flush=True)
                        db.sql(f'drop database {variant};')
                if args.suites and candidate:
                    db.sql('create database tpl_bp_nb_without template tpl_bp_chain; create database tpl_bp_nb_with template tpl_bp_chain;')
                    apply_with_later(db, candidate, 'tpl_bp_nb_with')
                    gr_avg = None
                    for suite in ([args.suite_only] if args.suite_only else NEIGHBOURS):
                        path = ROOT / 'supabase/tests' / suite
                        if not path.exists():
                            report['suites'].append({'suite': suite, 'missing': True})
                            continue
                        row = {'suite': suite}
                        for mode, template in (('without', 'tpl_bp_nb_without'), ('with', 'tpl_bp_nb_with')):
                            cl = f'cl_{mode}'
                            db.sql(f'drop database if exists {cl}; create database {cl} template {template};')
                            os.environ['PGDATABASE'] = cl
                            try:
                                db.sql(path.read_text())
                                row[mode] = 'PASS'
                            except RuntimeError as e:
                                row[mode] = 'FAIL ' + first_error(e)
                                if args.suite_only: print('FULL', mode, str(e)[-9000:], flush=True)
                            finally:
                                os.environ.pop('PGDATABASE', None)
                            db.sql(f'drop database {cl};')
                        row['identical'] = row['with'] == row['without']
                        report['suites'].append(row)
                        print('SUITE', suite, row['without'][:50], '|', row['with'][:50], flush=True)
                    # suite penerimaan: varian rata-rata bergerak (sama dengan runner P08)
                    spec = importlib.util.spec_from_file_location('p08', ROOT / 'scripts/test-goods-receipt-cancellation-postgres.py')
                    p08 = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(p08)
                    row = {'suite': 'goods_receipt_cancellation.sql (moving average)'}
                    for mode, template in (('without', 'tpl_bp_nb_without'), ('with', 'tpl_bp_nb_with')):
                        cl = f'cl_{mode}'
                        db.sql(f'drop database if exists {cl}; create database {cl} template {template};')
                        os.environ['PGDATABASE'] = cl
                        try:
                            db.sql(p08.average_suite())
                            row[mode] = 'PASS'
                        except RuntimeError as e:
                            row[mode] = 'FAIL ' + first_error(e)
                        finally:
                            os.environ.pop('PGDATABASE', None)
                        db.sql(f'drop database {cl};')
                    row['identical'] = row['with'] == row['without']
                    report['suites'].append(row)
                    print('SUITE', row['suite'], row['without'][:50], '|', row['with'][:50], flush=True)
                if args.concurrency and candidate and not args.baseline:
                    report['concurrency'] = run_concurrency(db, candidate)
    report['summary'] = {
        'control_pass': sum(1 for c in report['control'] if c[1]), 'control_fail': sum(1 for c in report['control'] if not c[1]),
        'mutants_killed': sum(1 for m in report['mutants'] if m['killed']), 'mutants_total': len(report['mutants']),
        'suites_identical': sum(1 for s in report['suites'] if s.get('identical')), 'suites_total': len([s for s in report['suites'] if not s.get('missing')]),
        'concurrency_ok': (report['concurrency'] or {}).get('ok')}
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=1))
    print(json.dumps(report['summary']))
    if args.baseline:
        sys.exit(0 if report['summary']['control_fail'] > 0 else 1)
    ok = (report['summary']['control_fail'] == 0 and all(m['killed'] for m in report['mutants'])
          and all(s.get('identical') for s in report['suites'] if not s.get('missing'))
          and (not args.concurrency or report['summary']['concurrency_ok']))
    sys.exit(0 if ok else 1)


def run_concurrency(db, candidate):
    """Sesi psql sungguhan paralel: pembatalan penerimaan yang sama (dua kunci) dan pembayaran yang sama (dua kunci).
    Efek harus terjadi tepat sekali; yang kalah menerima hasil tercatat atau penolakan jelas, bukan efek ganda."""
    db.sql('drop database if exists cc_bp; create database cc_bp template tpl_bp_fix;')
    apply_text(db, candidate, 'cc_bp')
    os.environ['PGDATABASE'] = 'cc_bp'
    owner = "set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000001',true), set_config('request.jwt.claim.role','authenticated',true)"
    try:
        db.sql("""
insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status,total) values
 ('bd500000-0000-4000-8000-000000000091','PO.CC.1','bd300000-0000-4000-8000-000000000001','bd100000-0000-4000-8000-000000000001','bd200000-0000-4000-8000-000000000001','Dipesan',1000);
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor) values
 ('bd600000-0000-4000-8000-000000009101','bd500000-0000-4000-8000-000000000091','bd400000-0000-4000-8000-00000000000a','A',10,100,'pcs',1);""")
        rid = db.last(f"""begin; set local role authenticated; select {owner};
select receive_purchase_order('bd500000-0000-4000-8000-000000000091','cc-recv','TB.CC.',5,current_date,null,null,'[{{"id":"bd600000-0000-4000-8000-000000009101","qty_terima":10}}]'::jsonb)->>'receipt_id'; commit;""")
        iid = db.last(f"""begin; set local role authenticated; select {owner};
select (to_jsonb(x))->>'invoice_id' from create_purchase_invoice_from_po_receipts('bd500000-0000-4000-8000-000000000091','FB.CC.',5,null,current_date,current_date,null,
 '[{{"po_item_id":"bd600000-0000-4000-8000-000000009101","qty":10,"harga":100}}]'::jsonb,'[]','[]',0,'cc-inv',null,array['{rid}'::uuid]) x; commit;""")
        pid = db.last(f"""begin; set local role authenticated; select {owner};
select pay_purchase_invoice_atomic('cc-pay','{iid}'::uuid,current_date,1000,'Transfer',null,'bd700000-0000-4000-8000-000000000001',null)->>'payment_id'; commit;""")

        def call(sql):
            try:
                out = db.sql(f"begin; set local role authenticated; select {owner}; {sql}; commit;")
                return ('ok', out.strip().splitlines()[-1] if out.strip() else '')
            except RuntimeError as e:
                return ('err', re.sub(r'\s+', ' ', str(e))[-220:])

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            pay_res = [f.result() for f in [ex.submit(call, f"select cancel_purchase_payment('{pid}'::uuid,0,'cc-pk{n}','Uji bersamaan')->>'reversal_journal_id'") for n in (1, 2)]]
        pay_after = db.last("select (select count(*) from purchase_invoice_payments where reversal_of is not null)::text||'|'||(select count(*) from journal_entries where source='purchase-pay-void')::text")
        call(f"select cancel_purchase_invoice('{iid}'::uuid,0,'cc-ik','Uji bersamaan',current_date)")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            rec_res = [f.result() for f in [ex.submit(call, f"select cancel_goods_receipt('{rid}'::uuid,'cc-rk{n}','Uji bersamaan',current_date)->>'already_cancelled'") for n in (1, 2)]]
        rec_after = db.last("select (select qty from stock where item_id='bd400000-0000-4000-8000-00000000000a')::text||'|'||(select count(*) from journal_entries where source='purchase-receipt-void')::text||'|'||(select count(*) from purchase_receipt_cancellations)::text||'|'||(select count(*) from stock_moves where source='purchase-receipt-void')::text")
        final_ok = db.last("select (select count(*) from journal_lines)::text||'|'||(select sum(debit)-sum(credit) from journal_lines)::text")
        ok = bool(pay_after == '1|1' and sum(1 for r in pay_res if r[0] == 'ok') >= 1 and pay_after == '1|1'
                  and rec_after.startswith('0') and rec_after.endswith('|1|1|1') and final_ok.endswith('|0'))
        return {'payment_cancel_results': pay_res, 'payment_after(reversal_rows|reversal_journals)': pay_after,
                'receipt_cancel_results': rec_res, 'receipt_after(stock|void_journals|proofs|void_moves)': rec_after, 'ledger(lines|net)': final_ok, 'ok': ok}
    finally:
        os.environ.pop('PGDATABASE', None)


if __name__ == '__main__':
    main()
