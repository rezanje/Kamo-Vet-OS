#!/usr/bin/env python3
"""Dokter pemeriksa di antrian (migrasi *_dokter_pemeriksa_antrian.sql). Native throwaway PostgreSQL only; never accepts a database URL.

  python3 -I scripts/test-dokter-pemeriksa-antrian-postgres.py --pg-bin DIR [--json out.json] [--baseline | --mutations]
  (default)   chain + candidate: SQL suite supabase/tests/dokter_pemeriksa_antrian.sql.
  --baseline  chain WITHOUT the candidate: the suite must fail at its first assertion (column absent) = RED.
  --mutations every mutant of the candidate in a cloned database must be killed by the suite.
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse, importlib.util, json, os, sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bpbase', ROOT / 'scripts/test-batalkan-penerimaan-petshop-postgres.py')
bp = importlib.util.module_from_spec(spec); sys.modules['bpbase'] = bp; spec.loader.exec_module(bp)
CAND = sorted(p.name for p in (ROOT / 'supabase/migrations').glob('*_dokter_pemeriksa_antrian.sql'))[0]
bp.CAND = CAND
MIGRATIONS, TESTS = bp.MIGRATIONS, bp.TESTS
SUITE = 'dokter_pemeriksa_antrian.sql'
check, raw, clone, run_suite, build_chain, apply = bp.check, bp.raw, bp.clone, bp.run_suite, bp.build_chain, bp.apply
NativePostgres, RESULTS = bp.NativePostgres, bp.RESULTS


def fresh(db):
    build_chain(db, {CAND})
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')


def run_green(db, a):
    fresh(db)
    clone(db, 'cand'); apply(db, 'cand', (MIGRATIONS / CAND).read_text())
    ok, passes, why = run_suite(db, 'cand', SUITE)
    check('GREEN suite on the candidate (%d assertions)' % len(passes), ok and len(passes) >= 50, why)
    try:
        apply(db, 'cand', (MIGRATIONS / CAND).read_text(), later=False); twice = False
    except RuntimeError:
        twice = True
    check('second application of the migration fails closed (no silent re-apply)', twice)


def run_baseline(db, a):
    fresh(db)
    clone(db, 'base')
    ok, passes, why = run_suite(db, 'base', SUITE)
    check('RED baseline: suite fails without the candidate (passes before failure: %d)' % len(passes), (not ok) and len(passes) == 0, why)


def mutants():
    return [
        ('M01 guard: inactive/missing employee accepted', "if not found or e.status is distinct from 'Aktif' or e.trashed_at is not null then", "if false then", 0),
        ('M02 guard: trashed employee accepted', "or e.trashed_at is not null then\n  raise exception using errcode='P0001',message='PEMERIKSA_TIDAK_VALID", "then\n  raise exception using errcode='P0001',message='PEMERIKSA_TIDAK_VALID", 0),
        ('M03 guard: inactive status ignored', "if not found or e.status is distinct from 'Aktif' or", "if not found or", 0),
        ('M04 guard: doctor role not required (groomer accepted)', "if coalesce(e.jabatan,'') !~* '(dokter|doctor|drh|\\ydr\\s+hewan\\y)'\n  or ", "if ", 0),
        ('M05 guard: paramedic exclusion removed', "\n  or coalesce(e.jabatan,'') ~* '(paramedis|perawat|nurse|asisten.*(dokter|doctor)|vet.*technician)' then", " then", 0),
        ('M06 guard: doctor regex matches substrings (Doktoral)', "(dokter|doctor|drh|\\ydr\\s+hewan\\y)", "(dokter|doctor|drh|dr\\s+hewan|doktor)", 0),
        ('M07 guard: drh abbreviation not recognised', "(dokter|doctor|drh|\\ydr\\s+hewan\\y)'\n  or", "(dokter|doctor|\\ydr\\s+hewan\\y)'\n  or", 0),
        ('M08 guard: case sensitive jabatan match', "!~* '(dokter|doctor|drh", "!~ '(dokter|doctor|drh", 0),
        ('M09 guard: branch not checked', "if e.branch_id is distinct from new.branch_id and not exists(", "if false and not exists(", 0),
        ('M10 guard: ended assignment accepted', "and (a.end_date is null or a.end_date>=today))", ")", 0),
        ('M11 guard: assignment ending today excluded (off-by-one)', "a.end_date>=today", "a.end_date>today", 0),
        ('M12 guard: future assignment accepted', "a.effective_date<=today and ", "", 0),
        ('M13 guard: assignment branch not matched', "where a.employee_id=e.id and a.branch_id=new.branch_id and", "where a.employee_id=e.id and", 0),
        ('M14 guard: invoice lock removed', "if exists(select 1 from public.invoices i where i.visit_id=new.id and i.voided_at is null) then", "if false then", 0),
        ('M15 guard: voided invoice also locks', "where i.visit_id=new.id and i.voided_at is null) then", "where i.visit_id=new.id) then", 0),
        ('M16 guard: archive lock removed', "if old.archived_at is not null then", "if false then", 0),
        ('M17 guard: unchanged value is re-validated (blocks harmless rewrites)', "if tg_op='UPDATE' and new.pemeriksa_id is not distinct from old.pemeriksa_id then return new; end if;", "", 0),
        ('M18 guard: clearing the doctor blocked', "if new.pemeriksa_id is null then return new; end if;", "", 0),
        ('M19 trigger: not fired on INSERT', "before insert or update of pemeriksa_id on public.visits", "before update of pemeriksa_id on public.visits", 0),
        ('M20 trigger: not fired on UPDATE', "before insert or update of pemeriksa_id on public.visits", "before insert on public.visits", 0),
        ('M21 FK: employee delete cascades the visit instead of clearing', "references public.employees(id) on delete set null;\ncomment", "references public.employees(id) on delete cascade;\ncomment", 0),
        ('M22 FK: no FK to employees', "uuid references public.employees(id) on delete set null;", "uuid;", 0),
        ('M23 ACL: guard function callable by clients', "revoke all on function clinic_private.guard_visit_pemeriksa() from public,anon,authenticated,service_role;", "revoke all on function clinic_private.guard_visit_pemeriksa() from public,anon,authenticated,service_role;\ngrant execute on function clinic_private.guard_visit_pemeriksa() to authenticated;", 0),
        ('M24 guard function not SECURITY DEFINER', "language plpgsql security definer set search_path='' as $$\ndeclare e record;", "language plpgsql set search_path='' as $$\ndeclare e record;", 0),
        ('M27 index missing', "create index visits_pemeriksa_id_idx on public.visits(pemeriksa_id) where pemeriksa_id is not null;", "", 0),
        ('M29 default: column has a default value', "add column pemeriksa_id uuid references", "add column pemeriksa_id uuid default 'dd500000-0000-4000-8000-000000000001' references", 0),
        ('M30 master reference guard missing', "create trigger master_ref_employees_pemeriksa_id before insert or update on public.visits\n for each row execute function public.guard_trashed_master_reference('employees','pemeriksa_id');", "", 0),
    ]


def run_mutations(db, a):
    fresh(db)
    base = (MIGRATIONS / CAND).read_text()
    clone(db, 'ctl'); apply(db, 'ctl', base, later=False)
    ok, passes, why = run_suite(db, 'ctl', SUITE)
    check('CONTROL: unmutated candidate passes the suite (%d assertions)' % len(passes), ok, why)
    want = len(passes)
    only = os.environ.get('BP_ONLY')
    killed_n = total = 0
    for name, old, new, nth in mutants():
        if only and not name.startswith(only): continue
        total += 1
        n = base.count(old)
        if n != 1:
            check('MUTANT ' + name + ' (anchor found exactly once)', False, 'anchor count %d' % n); continue
        mutated = base.replace(old, new)
        clone(db, 'mut')
        try:
            apply(db, 'mut', mutated, later=False)
        except RuntimeError as e:
            killed_n += 1
            check('MUTANT ' + name + ' -> killed (does not even apply: %s)' % str(e)[:80].replace('\n', ' '), True); continue
        ok, passes, why = run_suite(db, 'mut', SUITE)
        killed = (not ok) or len(passes) < want
        killed_n += 1 if killed else 0
        check('MUTANT ' + name + ' -> %s' % ('KILLED: ' + why[:90] if not ok else 'SURVIVED (suite still green, %d)' % len(passes)), killed, why)
    print('MUTANTS killed %d / %d' % (killed_n, total), flush=True)
    RESULTS.append(dict(case='MUTANT TOTAL killed %d of %d' % (killed_n, total), status='PASS' if killed_n == total and total >= 12 else 'FAIL', detail=''))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true')
    a = ap.parse_args()
    fn = run_baseline if a.baseline else run_green
    if a.mutations: fn = run_mutations
    with NativePostgres(a.pg_bin) as db:
        fn(db, a)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(mode=fn.__name__, results=RESULTS), indent=1))
    fails = [r for r in RESULTS if r['status'] == 'FAIL']
    print('SUMMARY mode=%s pass=%d fail=%d' % (fn.__name__, len(RESULTS) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
