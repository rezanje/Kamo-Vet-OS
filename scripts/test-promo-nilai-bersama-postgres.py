#!/usr/bin/env python3
"""Promo Syarat-Hasil: the `nilai` syarat is ONE shared pool per receipt (migration 20261111150000_promo_syarat_nilai_bersama.sql).
Native throwaway PostgreSQL only; never accepts a database URL.

  python3 -I scripts/test-promo-nilai-bersama-postgres.py --pg-bin DIR [--json out.json] [--baseline | --mutations] [--only NAME]
  (default)   chain + candidate: SQL suite supabase/tests/promo_nilai_bersama.sql GREEN, the three existing promo_syarat_hasil_* suites still
              GREEN with the candidate, structural diff (ONLY promo_sh_verify_claims changed; ACL/owner/definer/config identical; no other
              object changed), compile twice-apply refusal (drift guard), idempotence of the anchors.
  --baseline  chain WITHOUT the candidate: the suite must FAIL at the first stacking assertion (RED).
  --mutations every mutant of the candidate in a cloned database must be killed by the suite.
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse, importlib.util, json, os, re, subprocess, sys, tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
from native_postgres import NativePostgres  # noqa: E402

CAND = '20261111150000_promo_syarat_nilai_bersama.sql'
MIGRATIONS = ROOT / 'supabase/migrations'
TESTS = ROOT / 'supabase/tests'
SUITE = 'promo_nilai_bersama.sql'
RESULTS = []


def check(name, ok, detail=''):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=str(detail)[:700]))
    print(RESULTS[-1]['status'], name, str(detail)[:300], flush=True)
    return ok


def build_chain(db, exclude):
    tmp = Path(tempfile.mkdtemp(prefix='pnbchain.', dir='/opt/data'))
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


def raw(db, sql, dbname=None):
    env = {**os.environ, 'PSQLRC': '/dev/null'}
    if dbname: env['PGDATABASE'] = dbname
    r = subprocess.run(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                       input=sql, text=True, capture_output=True, env=env)
    return r.returncode, r.stdout, r.stderr


def clone(db, name, template='tpl_base'):
    os.environ.pop('PGDATABASE', None)
    db.sql('drop database if exists %s' % name)
    db.sql('create database %s template %s' % (name, template))


def apply(db, dbname, text):
    rc, out, err = raw(db, 'begin;\n' + text + '\ncommit;', dbname)
    if rc: raise RuntimeError(err + out)


def suite_sql(name):
    fx = (TESTS / 'promo_syarat_hasil_fixture.sql').read_text()
    helpers = '' if name.endswith('definition.sql') else (TESTS / 'promo_syarat_hasil_helpers.sql').read_text()
    return 'begin;\n' + fx + '\n' + helpers + '\n' + (TESTS / name).read_text() + '\nrollback;'


def run_suite(db, dbname, name=SUITE):
    rc, out, err = raw(db, suite_sql(name), dbname)
    passes = [l for l in (out + err).splitlines() if 'PASS ' in l]
    why = ''
    if rc:
        errs = [l for l in err.splitlines() if 'ERROR' in l or 'Expected rejection' in l or 'WRONG REJECTION' in l or 'Assertion failed' in l]
        why = (errs[0] if errs else err.strip().splitlines()[-1] if err.strip() else 'error')[:400]
    return rc == 0, passes, why


FUNC_SQL = ("select p.oid::regprocedure::text s, md5(pg_get_functiondef(p.oid)) d, md5(coalesce(p.proacl::text,'')||'|'||coalesce(p.proconfig::text,'')||'|'||p.prosecdef::text||'|'||"
            "p.provolatile::text||'|'||pg_get_userbyid(p.proowner)||'|'||p.prorettype::text||'|'||p.pronargs::text) m from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname in ('public','clinic_private','role_settings_private') and p.prokind in ('f','p') order by 1")
OBJ = {
 'triggers': "select md5(coalesce(string_agg(c.oid::regclass::text||pg_get_triggerdef(t.oid),'|' order by c.oid::regclass::text,t.tgname),'')) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal",
 'policies': "select md5(coalesce(string_agg(schemaname||tablename||policyname||coalesce(qual,'')||coalesce(with_check,''),'|' order by schemaname,tablename,policyname),'')) from pg_policies",
 'indexes': "select md5(coalesce(string_agg(schemaname||indexname||indexdef,'|' order by schemaname,indexname),'')) from pg_indexes where schemaname in ('public','clinic_private')",
 'constraints': "select md5(coalesce(string_agg(conrelid::regclass::text||conname||pg_get_constraintdef(oid),'|' order by conrelid::regclass::text,conname),'')) from pg_constraint where connamespace in ('public'::regnamespace)",
 'columns': "select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,''),'|' order by table_name,column_name),'')) from information_schema.columns where table_schema='public'",
 'acl_rls': "select md5(coalesce(string_agg(c.oid::regclass::text||coalesce(c.relacl::text,'')||c.relrowsecurity::text,'|' order by c.oid::regclass::text),'')) from pg_class c where c.relnamespace='public'::regnamespace",
}


def digests(db, dbname):
    rc, out, err = raw(db, FUNC_SQL, dbname); assert rc == 0, err
    funcs = {l.split('|')[0]: tuple(l.split('|')[1:]) for l in out.splitlines() if l}
    objs = {}
    for k, q in OBJ.items():
        rc, out, err = raw(db, q, dbname); assert rc == 0, err
        objs[k] = out.strip()
    return funcs, objs


# --------------------------------------------------------------------------- mutants of the candidate (exact text -> replacement)
MUTANTS = {
    'M01_no_shared_check': ("if need>cart then", "if false then"),
    'M02_sets_ignored': ("need:=need+a*nmax;nmax:=0;", "need:=need+nmax;nmax:=0;"),
    'M03_smallest_row_not_largest': ("nmax:=greatest(nmax,(row_json->>'min')::numeric);", "nmax:=case when nmax=0 then (row_json->>'min')::numeric else least(nmax,(row_json->>'min')::numeric) end;"),
    'M04_boundary_off_by_one_strict': ("if need>cart then", "if need>=cart then"),
    'M05_boundary_off_by_one_lax': ("if need>cart then", "if need>cart+1 then"),
    'M06_nmax_not_reset_between_promos': ("need:=need+a*nmax;nmax:=0;", "need:=need+a*nmax;"),
    'M07_max_instead_of_sum': ("need:=need+a*nmax;nmax:=0;", "need:=greatest(need,a*nmax);nmax:=0;"),
    'M08_only_last_promo_counts': ("need:=need+a*nmax;nmax:=0;", "need:=a*nmax;nmax:=0;"),
    'M09_reward_discount_counts_as_spend': ("if need>cart then", "if need>cart+(select coalesce(sum(promo_discount),0) from public.sale_items where sale_id=p_sale and promo_claim_id is not null) then"),
    'M10_qty_promos_consume_spend': ("need:=need+a*nmax;nmax:=0;", "need:=need+a*greatest(nmax,100000);nmax:=0;"),
    'M11_client_header_subtotal_trusted': ("if need>cart then", "if need>s.subtotal then"),
    'M12_first_row_only': ("nmax:=greatest(nmax,(row_json->>'min')::numeric);", "if nmax=0 then nmax:=(row_json->>'min')::numeric;end if;"),
    'M13_wrong_error_code': ("raise exception 'PROMO_SH_NILAI: whole-cart value % is below the combined need", "raise exception 'PROMO_SH_XXXXX: whole-cart value % is below the combined need"),
    'M14_second_promo_only_when_repeat_sets_gt1': ("need:=need+a*nmax;nmax:=0;", "need:=need+case when a>1 then a*nmax else 0 end;nmax:=0;"),
}


# --------------------------------------------------------------------------- modes
def run_baseline(db, a):
    build_chain(db, {CAND})
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')
    clone(db, 'red')
    ok, passes, why = run_suite(db, 'red')
    check('RED: suite fails at the baseline on the stacking case (two Rp100.000 promos on one Rp115.000 receipt are accepted)', not ok and 'Expected rejection' in why and '1.' in why, why)
    for name in ('promo_syarat_hasil_sales.sql', 'promo_syarat_hasil_hpp.sql', 'promo_syarat_hasil_definition.sql'):
        clone(db, 'nb')
        ok2, p2, why2 = run_suite(db, 'nb', name)
        check('baseline chain: existing suite %s passes (%d assertions)' % (name, len(p2)), ok2, why2)


def run_green(db, a):
    build_chain(db, {CAND})
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')
    cand = (MIGRATIONS / CAND).read_text()
    check('migration has no BEGIN/COMMIT of its own', not re.search(r'^\s*(begin|commit|rollback)\s*;', cand, re.I | re.M))
    check('server is native PostgreSQL 17', 170000 <= int(db.last('show server_version_num')) < 180000)
    # structural diff
    clone(db, 'before'); before_f, before_o = digests(db, 'before')
    clone(db, 'g'); apply(db, 'g', cand); after_f, after_o = digests(db, 'g')
    changed = sorted(k for k in set(before_f) | set(after_f) if before_f.get(k) != after_f.get(k))
    check('STRUCTURE: exactly ONE function definition changed (promo_sh_verify_claims) and its ACL/owner/definer/config/signature are identical', changed == ['promo_sh_verify_claims(uuid)'] and before_f['promo_sh_verify_claims(uuid)'][1] == after_f['promo_sh_verify_claims(uuid)'][1], changed)
    check('STRUCTURE: triggers/policies/indexes/constraints/columns/ACL+RLS digests identical', before_o == after_o, [k for k in before_o if before_o[k] != after_o[k]])
    rc, out, err = raw(db, "select pg_get_functiondef('public.promo_sh_verify_claims(uuid)'::regprocedure)", 'g')
    check('the patched definition carries the three markers', out.count('SH_NILAI_SHARED') == 3 and 'need numeric:=0;nmax numeric:=0' in out, out.count('SH_NILAI_SHARED'))
    # drift guard: a second apply is refused (idempotence guard) and leaves the function untouched
    try:
        apply(db, 'g', cand); again = True
    except RuntimeError as e:
        again = 'SH_NILAI_SHARED_DRIFT' in str(e)
    check('DRIFT GUARD: applying the migration twice is refused (SH_NILAI_SHARED_DRIFT), definition unchanged', again is True and digests(db, 'g')[0] == after_f)
    # the SQL suite
    clone(db, 'g'); apply(db, 'g', cand)
    ok, passes, why = run_suite(db, 'g')
    check('SQL suite %s GREEN: %d assertions passed' % (SUITE, len(passes)), ok and len(passes) >= 20, why or 'passes=%d' % len(passes))
    # the existing syarat_hasil suites still pass with the candidate
    for name in ('promo_syarat_hasil_definition.sql', 'promo_syarat_hasil_sales.sql', 'promo_syarat_hasil_hpp.sql'):
        clone(db, 'ex'); apply(db, 'ex', cand)
        ok2, p2, why2 = run_suite(db, 'ex', name)
        check('with candidate: existing suite %s passes (%d assertions)' % (name, len(p2)), ok2 and len(p2) > 5, why2)
    # neighbouring money suites that call the finalize chain
    for name in ('quantity_pool_pricing.sql', 'cashier_atomic_fifo_floor.sql', 'p03_price_floor.sql'):
        p = TESTS / name
        if not p.exists(): continue
        clone(db, 'nb'); apply(db, 'nb', cand)
        rc, out, err = raw(db, p.read_text(), 'nb')
        clone(db, 'nb0')
        rc0, out0, err0 = raw(db, p.read_text(), 'nb0')
        check('neighbour suite %s: same outcome with and without the candidate (%s)' % (name, 'pass' if rc == 0 else 'fails identically at baseline'), (rc == 0) == (rc0 == 0), (err or err0).strip().splitlines()[-1:] )


def run_mutations(db, a):
    build_chain(db, {CAND})
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')
    cand = (MIGRATIONS / CAND).read_text()
    clone(db, 'ctl'); apply(db, 'ctl', cand)
    ok, passes, why = run_suite(db, 'ctl')
    check('CONTROL: the unmutated candidate passes the suite (%d assertions)' % len(passes), ok, why)
    for name, (old, new) in MUTANTS.items():
        if a.only and a.only != name: continue
        assert cand.count(old) == 1, 'mutant anchor not unique: ' + name
        mt = cand.replace(old, new)
        clone(db, 'mut')
        try:
            apply(db, 'mut', mt); applied = True; err = ''
        except RuntimeError as e:
            applied = False; err = str(e)
        if not applied:
            check('MUTANT %s killed (does not even compile/apply)' % name, True, err[:200]); continue
        ok, passes, why = run_suite(db, 'mut')
        check('MUTANT %s killed by the suite' % name, not ok, why if not ok else 'SURVIVED: suite passed (%d assertions)' % len(passes))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only')
    a = ap.parse_args()
    fn = run_baseline if a.baseline else run_mutations if a.mutations else run_green
    with NativePostgres(a.pg_bin) as db:
        fn(db, a)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(mode=fn.__name__, results=RESULTS), indent=1))
    fails = [r for r in RESULTS if r['status'] == 'FAIL']
    print('SUMMARY mode=%s pass=%d fail=%d' % (fn.__name__, len(RESULTS) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
