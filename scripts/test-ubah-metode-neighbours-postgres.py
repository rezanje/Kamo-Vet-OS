#!/usr/bin/env python3
"""Suite SQL tetangga untuk migrasi 20261115900000_ubah_metode_bayar.sql: hasil HARUS sama pada rantai TANPA dan DENGAN migrasi (suite yang butuh harness khusus gagal sama di kedua sisi: itu bukan regresi)
(satu-satunya perbedaan yang disengaja ada di batalkan_penerimaan_petshop.sql: pelaku tanpa shift terbuka kini 'tanpa_shift', bukan ditolak, dan
efek jatuh di shift pelaku, bukan shift kasir lain; versi lama suite itu dijalankan di sisi TANPA, versi baru di sisi DENGAN).
  flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-ubah-metode-neighbours-postgres.py --pg-bin DIR --json out.json [--attach ROOT]
"""
import argparse, importlib.util, json, os, re, subprocess, sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('mt', ROOT / 'scripts/test-mitigasi-audit-postgres.py'); mt = importlib.util.module_from_spec(spec); spec.loader.exec_module(mt)
TESTS = ROOT / 'supabase/tests'
CAND = '20261115900000_ubah_metode_bayar.sql'
SUITES = ['clinic_billing_lifecycle.sql', 'clinic_billing_consistency.sql', 'clinic_invoice_post.sql', 'clinic_payment_method_corrections.sql', 'clinic_refund_post.sql', 'clinic_refund_source.sql',
          'unpaid_clinical_correction.sql', 'clinic_inpatient_discharge.sql', 'clinic_procedure_bmhp.sql', 'clinic_compound_issue.sql', 'moving_average_clinic.sql', 'clinic_demo_financial_policy.sql',
          'expense_correction_after_shift.sql', 'refund_payout.sql', 'mitigasi_petshop.sql', 'batalkan_penerimaan_petshop.sql', 'pos_split_payments.sql', 'pos_payment_method_corrections.sql',
          'sales_safe_posting.sql', 'owner_create_branch.sql']
RESULTS = []


def first_err(err):
    errs = [l for l in err.splitlines() if l.startswith('ERROR')]
    return re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', errs[0][:200]) if errs else ''


def run(db, name, text):
    rc, out, err = mt.raw(db, text, name)
    return dict(rc=rc, err=first_err(err), passes=len(re.findall(r'(?:BP|PF|MT|NB|BD)_PASS|PASS', err)))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin'); ap.add_argument('--attach'); a = ap.parse_args()
    if a.pg_bin: mt.r.BIN = a.pg_bin
    cand = (ROOT / 'supabase/migrations' / CAND).read_text()
    ctx = mt.okr.Attached(mt.r.BIN, a.attach) if a.attach else mt.r.NativePostgres(mt.r.BIN)
    rows = []
    with ctx as db:
        if not a.attach:
            mt.okr.build(db, {CAND}); db.sql('create database tpl_chain template postgres;')
        # petshop: sisi TANPA = suite lama; sisi DENGAN = suite baru
        for label, suite_without, suite_with in [(s, (TESTS / s).read_text(), (TESTS / s).read_text()) for s in SUITES if (TESTS / s).exists()]:
            res = {}
            for tag, text, with_cand in (('without', suite_without, False), ('with', suite_with, True)):
                nm = 'nbr_%s' % tag; mt.mkdb(db, nm, 'tpl_chain')
                if with_cand:
                    # rantai sudah memuat migrasi tanggal efektif petshop/pembelian (lebih lama); kandidat dipasang SESUDAHNYA, urutan nyata (tanpa memasang ulang migrasi 'later').
                    rc0, out0, err0 = mt.raw(db, 'begin;\n' + cand + '\ncommit;', nm)
                    if rc0: raise RuntimeError('kandidat gagal: ' + (err0 + out0)[-1500:])
                res[tag] = run(db, nm, text)
                mt.drop_created(db)
            same = res['without']['rc'] == res['with']['rc'] and res['without']['err'] == res['with']['err']
            rows.append(dict(suite=label, without=res['without'], with_=res['with'], identical=same))
            ok = same and (res['with']['rc'] == 0 or 'petshop' not in label)
            mt.check('NEIGHBOUR %s: TANPA rc=%s | DENGAN rc=%s %s' % (label, res['without']['rc'], res['with']['rc'], 'identik' if same else 'BEDA'), same and (res['with']['rc'] == 0 or res['without']['rc'] != 0), dict(without=res['without'], with_=res['with']))
    totals = {s: sum(cc['status'] == s for cc in mt.RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(cases=mt.RESULTS, rows=rows, totals=totals), indent=1, default=str)); print(totals)
    return int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
