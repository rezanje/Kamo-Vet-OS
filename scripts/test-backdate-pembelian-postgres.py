#!/usr/bin/env python3
"""Bukti native PG17: tanggal efektif (mundur) untuk pembatalan pembelian. Hanya soket lokal, tanpa DB hosted.

  Mengambil /opt/data/kamo-heavy-test.lock sendiri (jangan dibungkus flock).
  python3 -I scripts/test-backdate-pembelian-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin [--baseline] [--mutations] [--suites] [--concurrency] --json out.json

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

CANDIDATE = '20261114500000_backdate_pembelian.sql'
TESTS = ROOT / 'supabase/tests/backdate_pembelian'
AVG_MARKER = '-- @AVERAGE_ACTIVATION@'
AVG_ONLY = '-- @AVERAGE_ONLY@'
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
    out = [] if AVG_ONLY in text else [('fifo', 'begin;\n' + helpers + text.replace(AVG_MARKER, '') + '\nrollback;\n')]
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


CHK = "perform public.purchase_effective_date_check("
MUTANTS = [
    ('aturan tanggal: masa depan diizinkan', [("if p_date > today then raise exception 'Tanggal tidak boleh di masa depan (hari ini %). Pilih hari ini atau sebelumnya.',today using errcode='22023'; end if;", "if false then raise exception 'x'; end if;", 1)]),
    ('aturan tanggal: sebelum dokumen asal diizinkan', [("if p_doc_date is not null and p_date < p_doc_date then", "if false then", 1)]),
    ('aturan tanggal: izin tanggal mundur tidak diperiksa', [("if not public.purchase_cancel_allowed('pembelian.tanggal_mundur') then\n   raise exception 'Tanggal mundur", "if false then\n   raise exception 'Tanggal mundur", 1)]),
    ('aturan tanggal: memakai izin faktur, bukan tanggal mundur', [("if not public.purchase_cancel_allowed('pembelian.tanggal_mundur') then\n   raise exception 'Tanggal mundur", "if not public.purchase_cancel_allowed('pembelian.batalkan_faktur') then\n   raise exception 'Tanggal mundur", 1)]),
    ('aturan tanggal: alasan tidak diwajibkan', [("if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'Alasan wajib diisi (minimal 3 karakter) bila memakai tanggal mundur'", "if false then raise exception 'Alasan wajib diisi (minimal 3 karakter) bila memakai tanggal mundur'", 1)]),
    ('aturan tanggal: periode akuntansi diabaikan', [("if v_acc is not null and (p_date <= v_acc or (p_doc_date is not null and p_doc_date <= v_acc)) then", "if false then", 1)]),
    ('aturan tanggal: periode akuntansi hanya tanggal pilihan (tanggal dokumen asal diabaikan)', [("if v_acc is not null and (p_date <= v_acc or (p_doc_date is not null and p_doc_date <= v_acc)) then", "if v_acc is not null and p_date <= v_acc then", 1)]),
    ('aturan tanggal: Closing HPP diabaikan', [("if v_hpp is not null and (p_date <= v_hpp or (p_doc_date is not null and p_doc_date <= v_hpp)) then", "if false then", 1)]),
    ('aturan tanggal: Closing HPP juga untuk aksi tanpa stok', [("\n if p_stock then\n  select closed_through", "\n if true then\n  select closed_through", 1)]),
    ('bukti: pembatalan penerimaan tidak dicatat', [("perform public.purchase_backdate_record('receipt-cancel', gr.id, gr.no_terima, po.branch_id, p_tanggal, gr.tanggal, v_reason, v_reversal, p_request_key);", "null;", 1)]),
    ('bukti: days_back selalu 0', [("p_effective,p_doc_date,today,greatest(today-p_effective,0)", "p_effective,p_doc_date,today,0", 1)]),
    ('bukti: tanggal nyata = tanggal efektif', [("p_effective,p_doc_date,today,greatest(today-p_effective,0)", "p_effective,p_doc_date,p_effective,greatest(today-p_effective,0)", 1)]),
    ('bukti: jumlah uang fisik terbalik tanda', [("select sum(l.debit-l.credit), min(a.code) into v_cash, v_code", "select sum(l.credit-l.debit), min(a.code) into v_cash, v_code", 1)]),
    ('bukti: tabel bukti bisa diubah', [("begin raise exception 'Bukti tanggal mundur pembelian tidak bisa diubah atau dihapus' using errcode='42501'; end $$;", "begin return coalesce(new,old); end $$;", 1)]),
    ('pembayaran: jurnal pembalik bertanggal hari ini', [("public.sales_next_number('JRN',p_tanggal),p_tanggal,'Pembatalan pembayaran hutang'", "public.sales_next_number('JRN',today),today,'Pembatalan pembayaran hutang'", 1)]),
    ('pembayaran: baris pembalik bertanggal hari ini', [("select invoice_id,p_tanggal,-amount,", "select invoice_id,today,-amount,", 1)]),
    ('pembayaran: tanggal tidak masuk kunci permintaan', [("'reason',btrim(p_reason),'tanggal',p_tanggal);", "'reason',btrim(p_reason));", 1)]),
    ('pembayaran: aturan tanggal dilewati', [("perform public.purchase_effective_date_check('payment-cancel',p_tanggal,pay.tanggal,p_reason,'pembayaran',false);", "perform 1;", 1)]),
    ('pembayaran: pembaca pemulihan memakai hari ini', [("coalesce((prior.payload->>'tanggal')::date,(now() at time zone 'Asia/Jakarta')::date)", "(now() at time zone 'Asia/Jakarta')::date", 1)]),
    ('pembayaran: pembungkus lama memakai tanggal kemarin', [("return public.cancel_purchase_payment(p_payment_id,p_expected_revision,p_request_key,p_reason,(now() at time zone 'Asia/Jakarta')::date);", "return public.cancel_purchase_payment(p_payment_id,p_expected_revision,p_request_key,p_reason,current_date-1);", 1)]),
    ('faktur: aturan tanggal dilewati', [("perform public.purchase_effective_date_check('invoice-cancel',p_tanggal,inv.tanggal,p_reason,'faktur',true);", "perform 1;", 1)]),
    ('faktur: bukti tidak dicatat', [("perform public.purchase_backdate_record('invoice-cancel',inv.id,inv.no_faktur,proof.branch_id,p_tanggal,inv.tanggal,btrim(p_reason),reversal,p_request_key);", "null;", 1)]),
    ('faktur: penjelasan pemakai stok dihilangkan', [("||public.purchase_layer_consumers_text(array[r.layer_id]);end if;", ";end if;", 1)]),
    ('penerimaan: aturan tanggal dilewati', [("perform public.purchase_effective_date_check('receipt-cancel', p_tanggal, gr.tanggal, v_reason, 'penerimaan', true);", "perform 1;", 1)]),
    ('penerimaan: penjelasan pemakai stok dihilangkan', [("consumed || public.purchase_layer_consumers_text((select array_agg((x->>'id')::uuid) from jsonb_array_elements(layers) x where (x->>'item_id')::uuid = r.item_id))", "consumed", 1)]),
    ('pratinjau: penghalang tanggal mundur hilang', [("p_tanggal<(now() at time zone 'Asia/Jakarta')::date and not public.purchase_cancel_allowed('pembelian.tanggal_mundur') then", "p_tanggal<(now() at time zone 'Asia/Jakarta')::date and false then", 1)]),
    ('pratinjau: penghalang masa depan hilang', [("if p_tanggal is not null and p_tanggal>(now() at time zone 'Asia/Jakarta')::date then", "if false then", 1)]),
    ('FIFO: pemeriksa urutan dimatikan', [("if found then\n  raise exception 'Tanggal % tidak bisa dipakai untuk %: stok yang lebih baru", "if false then\n  raise exception 'Tanggal % tidak bisa dipakai untuk %: stok yang lebih baru", 1)]),
    ('FIFO: exp_date (FEFO) diabaikan', [("and (coalesce(l.exp_date,'infinity'::date),l.tanggal) > (coalesce(p_exp,'infinity'::date),p_date)", "and l.tanggal > p_date", 1)]),
    ('FIFO: tanggal sama dianggap menyalip', [("and (coalesce(l.exp_date,'infinity'::date),l.tanggal) > (coalesce(p_exp,'infinity'::date),p_date)", "and (coalesce(l.exp_date,'infinity'::date),l.tanggal) >= (coalesce(p_exp,'infinity'::date),p_date)", 1)]),
    ('FIFO: lapisan yang sudah dibalik dihitung terpakai', [(" and not public.stock_layer_cost_was_reversed(l.id)\n    and (coalesce", "\n    and (coalesce", 1)]),
    ('FIFO: terima ulang tidak memanggil pemeriksa', [("if v_rr is not null and p_tanggal<v_today then perform public.purchase_assert_fifo_order(", "if false then perform public.purchase_assert_fifo_order(", 1)]),
    ('terima ulang: aturan tanggal dilewati', [("if v_rr is not null then perform public.purchase_effective_date_check('receipt-replace',", "if false then perform public.purchase_effective_date_check('receipt-replace',", 1)]),
    ('terima ulang: bukti tidak dicatat', [("if v_rr is not null then perform public.purchase_backdate_record('receipt-replace',", "if false then perform public.purchase_backdate_record('receipt-replace',", 1)]),
    ('terima ulang: PO yang pernah batal tidak dikenali', [("select min(g.tanggal) from public.goods_receipts g where g.po_id=p_po and g.voided_at is not null", "select min(g.tanggal) from public.goods_receipts g where g.po_id=p_po and g.voided_at is not null and false", 1)]),
    ('faktur ulang (PO): aturan tanggal dilewati', [("if p_replaces_invoice_id is not null then perform public.purchase_effective_date_check('invoice-replace',p_tanggal,", "if false then perform public.purchase_effective_date_check('invoice-replace',p_tanggal,", 1)]),
    ('faktur ulang langsung: aturan tanggal dilewati', [("if replacement is not null then perform public.purchase_effective_date_check('invoice-replace',d,", "if false then perform public.purchase_effective_date_check('invoice-replace',d,", 1)]),
    ('bayar ulang faktur: aturan tanggal dilewati', [("perform public.purchase_effective_date_check('payment-replace',p_tanggal,(select p.tanggal", "perform public.purchase_effective_date_check('payment-replace',(now() at time zone 'Asia/Jakarta')::date,(select p.tanggal", 1)]),
    ('bayar ulang perintah bayar: aturan tanggal dilewati', [("perform public.purchase_effective_date_check('payment-replace',p_tanggal,v_rp,", "perform public.purchase_effective_date_check('payment-replace',(now() at time zone 'Asia/Jakarta')::date,v_rp,", 1)]),
    ('uang muka: aturan tanggal dilewati', [("perform public.purchase_effective_date_check('advance-cancel',p_tanggal,adv.tanggal,p_reason,'uang muka',false);", "perform 1;", 1)]),
    ('uang muka: jurnal pembalik bertanggal hari ini', [("reversal:=public.clinic_write_journal(p_tanggal,'Pembatalan uang muka '", "reversal:=public.clinic_write_journal(today,'Pembatalan uang muka '", 1)]),
    ('cascade: pembayaran dibalik hari ini', [("'umc:' || md5(p_request_key) || ':' || pay.id::text, v_reason, p_tanggal));", "'umc:' || md5(p_request_key) || ':' || pay.id::text, v_reason));", 1)]),
    ('cascade: uang muka dibalik hari ini', [("public.cancel_purchase_advance_atomic(adv.id, p_tanggal, v_reason)", "public.cancel_purchase_advance_atomic(adv.id)", 1)]),
    ('cascade: tanggal minimum pratinjau salah', [("'min_tanggal', greatest(adv.tanggal, coalesce((select max((x->>'tanggal')::date) from jsonb_array_elements(plan) x), adv.tanggal)),", "'min_tanggal', adv.tanggal,", 1)]),
    ('izin: tanggal mundur tidak dikenal sebagai tindakan', [("'pembelian.batalkan_uang_muka','pembelian.tanggal_mundur') then return false; end if;", "'pembelian.batalkan_uang_muka') then return false; end if;", 1)]),
    ('katalog: tindakan tidak ditegakkan', [("— Pembelian','Pembelian',true);", "— Pembelian','Pembelian',false);", 1)]),
    ('katalog: modul salah', [("values ('pembelian.tanggal_mundur','pembelian');", "values ('pembelian.tanggal_mundur','kas-bank');", 1)]),
    ('ACL: pintu aturan tanggal bisa dipanggil klien', [("revoke all on function public.purchase_effective_date_check(text,date,date,text,text,boolean) from public,anon,authenticated,service_role;", "revoke all on function public.purchase_effective_date_check(text,date,date,text,text,boolean) from public,anon,service_role;\ngrant execute on function public.purchase_effective_date_check(text,date,date,text,text,boolean) to authenticated;", 1)]),
    ('ACL: pencatat bukti bisa dipanggil klien', [("revoke all on function public.purchase_backdate_record(text,uuid,text,uuid,date,date,text,uuid,text) from public,anon,authenticated,service_role;", "revoke all on function public.purchase_backdate_record(text,uuid,text,uuid,date,date,text,uuid,text) from public,anon,service_role;\ngrant execute on function public.purchase_backdate_record(text,uuid,text,uuid,date,date,text,uuid,text) to authenticated;", 1)]),
    ('ACL: pemeriksa urutan FIFO bisa dipanggil klien', [("revoke all on function public.purchase_assert_fifo_order(uuid,uuid,date,date) from public,anon,authenticated,service_role;", "revoke all on function public.purchase_assert_fifo_order(uuid,uuid,date,date) from public,anon,service_role;\ngrant execute on function public.purchase_assert_fifo_order(uuid,uuid,date,date) to authenticated;", 1)]),
    ('ACL: tabel bukti terbuka untuk klien', [("revoke all on public.purchase_backdate_audit from public,anon,authenticated,service_role;", "revoke all on public.purchase_backdate_audit from public,anon,service_role;\ngrant select,insert on public.purchase_backdate_audit to authenticated;", 1)]),
    ('ACL: daftar bukti dapat dipanggil anon', [("revoke all on function public.list_purchase_backdate_audit(integer,boolean) from public,anon,service_role;", "revoke all on function public.list_purchase_backdate_audit(integer,boolean) from public,service_role;\ngrant execute on function public.list_purchase_backdate_audit(integer,boolean) to anon;", 1)]),
    ('ACL: daftar bukti terbuka untuk STAFF', [("p.role in ('OWNER','ADMIN','FINANCE')) then\n  raise exception 'Daftar tanggal mundur", "p.role in ('OWNER','ADMIN','FINANCE','STAFF')) then\n  raise exception 'Daftar tanggal mundur", 1)]),
    ('rata-rata: pemeriksa urutan tanggal dimatikan', [("if not public.inventory_is_average() then return; end if;\n select m.source", "return;\n select m.source", 1)]),
    ('rata-rata: batal penerimaan tidak memeriksa urutan', [("perform public.purchase_assert_average_dates(v_wh, r.item_id, p_tanggal);", "null;", 1)]),
    ('rata-rata: batal faktur tidak memeriksa urutan', [("perform public.purchase_assert_average_dates(proof.warehouse_id,x.item_id,p_tanggal) from", "perform 1 from", 1)]),
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
        with tempfile.TemporaryDirectory(prefix='backdate-chain-', dir='/opt/data') as tmp:
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
                db.sql('create database tpl_bd_chain template postgres;')
                db.sql((TESTS / '00_fixture.sql').read_text())
                db.sql('create database tpl_bd_fix template postgres;')
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
                        db.sql(f'create database {variant} template tpl_bd_fix;')
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
                    db.sql('create database tpl_bd_nb_without template tpl_bd_chain; create database tpl_bd_nb_with template tpl_bd_chain;')
                    apply_with_later(db, candidate, 'tpl_bd_nb_with')
                    gr_avg = None
                    for suite in ([args.suite_only] if args.suite_only else NEIGHBOURS):
                        path = ROOT / 'supabase/tests' / suite
                        if not path.exists():
                            report['suites'].append({'suite': suite, 'missing': True})
                            continue
                        row = {'suite': suite}
                        for mode, template in (('without', 'tpl_bd_nb_without'), ('with', 'tpl_bd_nb_with')):
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
                    for mode, template in (('without', 'tpl_bd_nb_without'), ('with', 'tpl_bd_nb_with')):
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
    """Sesi psql sungguhan paralel pada tanggal efektif mundur: pembatalan pembayaran yang sama (dua kunci), pembatalan penerimaan yang sama
    (dua kunci), dan pembatalan penerimaan vs penjualan yang memakai lapisannya. Efek tepat sekali; neraca saldo nol; stok = lapisan."""
    db.sql('drop database if exists cc_bd; create database cc_bd template tpl_bd_fix;')
    apply_text(db, candidate, 'cc_bd')
    os.environ['PGDATABASE'] = 'cc_bd'
    owner = "set_config('request.jwt.claim.sub','bd000000-0000-4000-8000-000000000001',true), set_config('request.jwt.claim.role','authenticated',true)"
    try:
        db.sql("""
insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status,total) values
 ('bd500000-0000-4000-8000-000000000091','PO.CC.1','bd300000-0000-4000-8000-000000000001','bd100000-0000-4000-8000-000000000001','bd200000-0000-4000-8000-000000000001','Dipesan',1000),
 ('bd500000-0000-4000-8000-000000000092','PO.CC.2','bd300000-0000-4000-8000-000000000001','bd100000-0000-4000-8000-000000000001','bd200000-0000-4000-8000-000000000001','Dipesan',500);
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor) values
 ('bd600000-0000-4000-8000-000000009101','bd500000-0000-4000-8000-000000000091','bd400000-0000-4000-8000-00000000000a','A',10,100,'pcs',1),
 ('bd600000-0000-4000-8000-000000009201','bd500000-0000-4000-8000-000000000092','bd400000-0000-4000-8000-00000000000b','B',5,100,'pcs',1);""")
        rid = db.last(f"""begin; set local role authenticated; select {owner};
select receive_purchase_order('bd500000-0000-4000-8000-000000000091','cc-recv','TB.CC.',5,current_date-6,null,null,'[{{"id":"bd600000-0000-4000-8000-000000009101","qty_terima":10}}]'::jsonb)->>'receipt_id'; commit;""")
        iid = db.last(f"""begin; set local role authenticated; select {owner};
select (to_jsonb(x))->>'invoice_id' from create_purchase_invoice_from_po_receipts('bd500000-0000-4000-8000-000000000091','FB.CC.',5,null,current_date-5,current_date-5,null,
 '[{{"po_item_id":"bd600000-0000-4000-8000-000000009101","qty":10,"harga":100}}]'::jsonb,'[]','[]',0,'cc-inv',null,array['{rid}'::uuid]) x; commit;""")
        pid = db.last(f"""begin; set local role authenticated; select {owner};
select pay_purchase_invoice_atomic('cc-pay','{iid}'::uuid,current_date-4,1000,'Transfer',null,'bd700000-0000-4000-8000-000000000001',null)->>'payment_id'; commit;""")
        rid2 = db.last(f"""begin; set local role authenticated; select {owner};
select receive_purchase_order('bd500000-0000-4000-8000-000000000092','cc-recv2','TB.CC.',5,current_date-3,null,null,'[{{"id":"bd600000-0000-4000-8000-000000009201","qty_terima":5}}]'::jsonb)->>'receipt_id'; commit;""")

        def call(sql):
            try:
                out = db.sql(f"begin; set local role authenticated; select {owner}; {sql}; commit;")
                return ('ok', out.strip().splitlines()[-1] if out.strip() else '')
            except RuntimeError as e:
                return ('err', re.sub(r'\s+', ' ', str(e))[-220:])

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            pay_res = [f.result() for f in [ex.submit(call, f"select cancel_purchase_payment('{pid}'::uuid,0,'cc-pk{n}','Uji bersamaan',current_date-4)->>'reversal_journal_id'") for n in (1, 2)]]
        pay_after = db.last("select (select count(*) from purchase_invoice_payments where reversal_of is not null and tanggal=current_date-4)::text||'|'||(select count(*) from journal_entries where source='purchase-pay-void' and tanggal=current_date-4)::text||'|'||(select count(*) from purchase_backdate_audit where kind='payment-cancel')::text")
        call(f"select cancel_purchase_invoice('{iid}'::uuid,0,'cc-ik','Uji bersamaan',current_date-4)")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            rec_res = [f.result() for f in [ex.submit(call, f"select cancel_goods_receipt('{rid}'::uuid,'cc-rk{n}','Uji bersamaan',current_date-6)->>'already_cancelled'") for n in (1, 2)]]
        rec_after = db.last("select (select qty from stock where item_id='bd400000-0000-4000-8000-00000000000a')::text||'|'||(select count(*) from journal_entries where source='purchase-receipt-void')::text||'|'||(select count(*) from purchase_receipt_cancellations)::text||'|'||(select count(*) from stock_moves where source='purchase-receipt-void' and tanggal=current_date-6)::text||'|'||(select count(*) from purchase_backdate_audit where kind='receipt-cancel')::text")

        # Pembatalan penerimaan (mundur) vs penjualan yang memakai seluruh lapisannya: salah satu menang, tidak pernah keduanya.
        def sale():
            try:
                db.sql("select * from stock_out_fifo('bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000b',5,'sale','SALE.CC.1',current_date-1);")
                return ('ok', '')
            except RuntimeError as e:
                return ('err', re.sub(r'\s+', ' ', str(e))[-200:])
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            f1 = ex.submit(call, f"select cancel_goods_receipt('{rid2}'::uuid,'cc-race','Uji balapan',current_date-3)->>'already_cancelled'")
            f2 = ex.submit(sale)
            race = [f1.result(), f2.result()]
        race_state = db.last("select (select qty from stock where item_id='bd400000-0000-4000-8000-00000000000b')::text||'|'||(select coalesce(sum(qty_left),0) from stock_layers where item_id='bd400000-0000-4000-8000-00000000000b')::text||'|'||(select count(*) from goods_receipts where id='%s' and voided_at is not null)::text" % rid2)
        ledger = db.last("select (select count(*) from journal_lines)::text||'|'||(select sum(debit)-sum(credit) from journal_lines)::text||'|'||(select count(*) from (select e.branch_id,e.tanggal from journal_lines l join journal_entries e on e.id=l.entry_id group by e.branch_id,e.tanggal having sum(l.debit)<>sum(l.credit)) z)::text")
        qty, left, voided = race_state.split('|')
        race_ok = (float(qty) == float(left)) and ((voided == '1' and race[0][0] == 'ok') or (voided == '0' and race[0][0] == 'err'))
        ok = bool(pay_after == '1|1|1' and sum(1 for r in pay_res if r[0] == 'ok') >= 1
                  and float(rec_after.split('|')[0]) == 0 and rec_after.split('|')[1:] == ['1', '1', '1', '1']
                  and float(ledger.split('|')[1]) == 0 and ledger.split('|')[2] == '0' and race_ok)
        return {'payment_cancel_results': pay_res, 'payment_after(reversal_rows|reversal_journals|audit)': pay_after,
                'receipt_cancel_results': rec_res, 'receipt_after(stock|void_journals|proofs|void_moves|audit)': rec_after,
                'race_cancel_vs_sale': race, 'race_state(stock|layers|cancelled)': race_state,
                'ledger(lines|net|unbalanced_branch_dates)': ledger, 'ok': ok}
    finally:
        os.environ.pop('PGDATABASE', None)


if __name__ == '__main__':
    main()
