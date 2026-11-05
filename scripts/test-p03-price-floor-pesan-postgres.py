#!/usr/bin/env python3
"""P03 price-floor readability (F1+F2): the clinic rejection names EVERY offending row with net/HPP/minimum price,
while the RULE of what is refused stays byte-identical. Native throwaway PostgreSQL only; never accepts a database URL.

  python3 -I scripts/test-p03-price-floor-pesan-postgres.py --pg-bin DIR [--json out.json]
  --baseline      chain WITHOUT the candidate migration(s): the message suite must FAIL (RED), p03_price_floor.sql PASS
  --differential  chain without the candidate, run supabase/tests/p03_price_floor_rule_matrix.sql, apply the candidate,
                  run it again: the two outputs must be identical (rule unchanged), then message suite + p03 suite
  --mutations     one baseline chain, then each mutant of the candidate in a cloned database; every mutant must be
                  killed by the message suite OR by a matrix diff against the baseline output
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
from native_postgres import NativePostgres  # noqa: E402

CANDIDATE = '20261106860000_price_floor_pesan_jelas.sql'
LATER = ['20261106870000_ranap_racikan_ubah_harga.sql']   # independent migration of the same PR; excluded from baseline chains
MIGRATIONS = ROOT / 'supabase/migrations'
TESTS = ROOT / 'supabase/tests'
RESULTS = []


def check(name, ok, detail=''):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=str(detail)[:600]))
    print(RESULTS[-1]['status'], name, str(detail)[:300], flush=True)
    return ok


def build_chain(db, exclude):
    """Apply every repository migration except `exclude` (file names) with the shared auth/storage shims."""
    tmp = Path(tempfile.mkdtemp(prefix='p03chain.', dir='/opt/data'))
    try:
        (tmp / 'supabase/migrations').mkdir(parents=True)
        for f in MIGRATIONS.glob('*.sql'):
            if f.name not in exclude:
                (tmp / 'supabase/migrations' / f.name).symlink_to(f)
        old = fixture.ROOT
        fixture.ROOT = tmp
        try:
            fixture.DisposablePostgres.bootstrap(db)
        finally:
            fixture.ROOT = old
    finally:
        for f in (tmp / 'supabase/migrations').glob('*'):
            f.unlink()
        (tmp / 'supabase/migrations').rmdir(); (tmp / 'supabase').rmdir(); tmp.rmdir()


def apply(db, name_or_text):
    text = (MIGRATIONS / name_or_text).read_text() if name_or_text.endswith('.sql') and '\n' not in name_or_text else name_or_text
    db.sql('begin;\n' + text + '\ncommit;')


def suite(db, name):
    """Run one rolled-back SQL suite; PASS/FAIL recorded."""
    try:
        db.sql((TESTS / name).read_text())
        return check('suite ' + name, True)
    except RuntimeError as e:
        return check('suite ' + name, False, str(e).strip().splitlines()[0] if str(e).strip() else 'error')


def matrix(db):
    out = db.sql((TESTS / 'p03_price_floor_rule_matrix.sql').read_text())
    return sorted(l for l in out.splitlines() if l.startswith('MX|'))


def run_default(db):
    build_chain(db, set())
    suite(db, 'p03_price_floor_pesan.sql')
    suite(db, 'p03_price_floor.sql')


def run_baseline(db):
    build_chain(db, {CANDIDATE, *LATER})
    suite(db, 'p03_price_floor_pesan.sql')      # expected FAIL (RED)
    suite(db, 'p03_price_floor.sql')            # expected PASS (old rule + old messages)


def run_differential(db):
    build_chain(db, {CANDIDATE, *LATER})
    before = matrix(db)
    apply(db, CANDIDATE)
    after = matrix(db)
    kinds = {}
    for l in before:
        kinds[l.rsplit('|', 1)[1]] = kinds.get(l.rsplit('|', 1)[1], 0) + 1
    check('matrix is not trivial (ACCEPT and every refusal kind occur)',
          len(before) > 600 and all(k in kinds for k in ('ACCEPT', 'PRICE_ZERO', 'PRICE_BELOW_HPP', 'COST_MISSING', 'INVOICE_INVALID')), kinds)
    diff = [(a, b) for a, b in zip(before, after) if a != b]
    check('RULE UNCHANGED: %d carts refused/accepted identically before and after (outcome + prefix)' % len(before),
          before == after and len(before) == len(after), diff[:5])
    Path(os.environ.get('P03_MATRIX_DIR', '/opt/data/cache/scratch')).joinpath('p03-matrix-before.txt').write_text('\n'.join(before) + '\n')
    Path(os.environ.get('P03_MATRIX_DIR', '/opt/data/cache/scratch')).joinpath('p03-matrix-after.txt').write_text('\n'.join(after) + '\n')
    suite(db, 'p03_price_floor_pesan.sql')
    suite(db, 'p03_price_floor.sql')


def mutants(text):
    """(name, old, new, expected_killer). Every old text must occur exactly once in the candidate."""
    return [
        ('M01 only the first row is listed', 'if v_count <= 30 then\n      v_q', 'if v_count <= 1 then\n      v_q', 'suite'),
        ('M02 stage context not recognised', 'v_stage := coalesce(v_stage, false) or coalesce(clinic_private.stage_billing(v_visit), false);', 'v_stage := coalesce(v_stage, false);', 'suite'),
        ('M02b invoice stage_billing flag not recognised', 'select i.visit_id, coalesce(i.stage_billing, false) into v_visit, v_stage', 'select i.visit_id, false into v_visit, v_stage', 'suite'),
        ('M03 minimum ignores row/invoice discount', 'v_factor := v_q * (1 - coalesce(v_line.diskon_persen, 0) / 100) * v_share;', 'v_factor := v_q;', 'suite'),
        ('M04 minimum rounds down instead of up', 'greatest(ceil(coalesce(v_line.hpp, 0) / v_factor), 1)', 'greatest(floor(coalesce(v_line.hpp, 0) / v_factor), 1)', 'suite'),
        ('M05 RULE tightened: equal to HPP refused', "when v_line.hpp is null then 'COST' when v_net < v_line.hpp then 'BELOW' end;", "when v_line.hpp is null then 'COST' when v_net <= v_line.hpp then 'BELOW' end;", 'matrix'),
        ('M06 RULE loosened: zero net allowed for rows', "v_kind := case when v_net <= 0 then 'ZERO' when v_line.hpp is null", "v_kind := case when v_net < 0 then 'ZERO' when v_line.hpp is null", 'matrix'),
        ('M07 RULE loosened: invoice discount ignored', 'v_share := case when p_subtotal > 0 then (p_subtotal - p_discount) / p_subtotal else 0 end;\n  -- Inpatient stage invoices', 'v_share := 1;\n  -- Inpatient stage invoices', 'matrix'),
        ('M08 RULE loosened: package below HPP passes', "v_kind := case when v_net <= 0 then 'ZERO' when v_net < v_line.hpp then 'BELOW' end;", "v_kind := case when v_net <= 0 then 'ZERO' end;", 'matrix'),
        ('M09 RULE loosened: missing HPP passes', "when v_line.hpp is null then 'COST' when", 'when', 'matrix'),
        ('M10 only the last cost-missing name is kept', 'v_cost := v_cost || v_name;', 'v_cost := array[v_name];', 'suite'),
        ('M11 racikan hint dropped', 'v_racik := v_racik or v_line.racik;', 'v_racik := false;', 'suite'),
        ('M12 name not sanitized', "v_name := btrim(regexp_replace(v_line.deskripsi, '\\s+', ' ', 'g'));", 'v_name := v_line.deskripsi;', 'suite'),
        ('M13 per-unit price shown as row total', 'clinic_private.rupiah_text(v_net / v_q), v_unit,', 'clinic_private.rupiah_text(v_net), v_unit,', 'suite'),
        ('M14 prefix taken from the last failing row', 'if v_first is null then\n      v_first := v_kind;\n      v_head := case when v_kind = \'ZERO\' then format(\n          \'PRICE_ZERO: Harga neto %s Rp0. Obat', 'if true then\n      v_first := v_kind;\n      v_head := case when v_kind = \'ZERO\' then format(\n          \'PRICE_ZERO: Harga neto %s Rp0. Obat', 'suite'),
        ('M15 list not capped', 'if v_count <= 30 then\n      v_q', 'if v_count <= 100000 then\n      v_q', 'suite'),
        ('M16 package minimum ignores invoice discount', 'greatest(ceil(v_line.hpp / v_share), 1)', 'greatest(ceil(v_line.hpp), 1)', 'suite'),
        ('M17 old discount hint comes back for stage invoices', "then 'Naikkan Harga di baris tersebut atau ubah Harga jual di Barang & Jasa.'", "then 'Naikkan harga atau kurangi diskon.'", 'suite'),
    ]


def run_mutations(db):
    build_chain(db, {CANDIDATE, *LATER})
    baseline_matrix = matrix(db)
    cand = (MIGRATIONS / CANDIDATE).read_text()
    plan = [('M00 control (unmodified candidate)', cand, 'control')]
    for name, old, new, killer in mutants(cand):
        n = cand.count(old)
        if n != 1:
            check(name + ' anchor occurs once', False, 'anchor count %d' % n)
            continue
        plan.append((name, cand.replace(old, new), killer))
    for i, (name, text, killer) in enumerate(plan):
        os.environ.pop('PGDATABASE', None)
        db.sql('create database v%d template postgres' % i)
        os.environ['PGDATABASE'] = 'v%d' % i
        try:
            apply(db, text)
            try:
                db.sql((TESTS / 'p03_price_floor_pesan.sql').read_text()); suite_ok = True; why = ''
            except RuntimeError as e:
                suite_ok = False; why = str(e).strip().splitlines()[0][:160]
            m = matrix(db)
            matrix_same = (m == baseline_matrix)
        except RuntimeError as e:
            suite_ok, matrix_same, why = False, False, 'apply failed: ' + str(e).strip().splitlines()[0][:160]
        finally:
            os.environ.pop('PGDATABASE', None)
        if killer == 'control':
            check(name, suite_ok and matrix_same, 'suite_pass=%s matrix_same=%s %s' % (suite_ok, matrix_same, why))
        else:
            killed_by = [k for k, v in (('suite', not suite_ok), ('matrix', not matrix_same)) if v]
            check(name + ' KILLED', bool(killed_by), 'killed_by=%s expected=%s %s' % (killed_by, killer, why))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True)
    ap.add_argument('--json')
    g = ap.add_mutually_exclusive_group()
    g.add_argument('--baseline', action='store_true')
    g.add_argument('--differential', action='store_true')
    g.add_argument('--mutations', action='store_true')
    a = ap.parse_args()
    fn = run_baseline if a.baseline else run_differential if a.differential else run_mutations if a.mutations else run_default
    with NativePostgres(a.pg_bin) as db:
        fn(db)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(mode=fn.__name__, results=RESULTS), indent=1))
    fails = [r for r in RESULTS if r['status'] == 'FAIL']
    print('SUMMARY mode=%s pass=%d fail=%d' % (fn.__name__, len(RESULTS) - len(fails), len(fails)))
    if fn is run_baseline:
        sys.exit(0)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
