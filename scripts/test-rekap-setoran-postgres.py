#!/usr/bin/env python3
"""Rekap Setoran (migrasi *_rekap_setoran.sql). Native throwaway PostgreSQL only; never accepts a database URL.

  python3 -I scripts/test-rekap-setoran-postgres.py --pg-bin DIR [--json out.json] [--baseline | --mutations | --conc | --digest]
  (default)   chain + candidate: SQL suite supabase/tests/rekap_setoran.sql (>= 250 assertions), second application fails closed.
  --baseline  chain WITHOUT the candidate: the suite must fail with 0 passes (RED) and no setoran object may exist.
  --conc      two independent sessions (real locks): two different approvers racing on one setoran; same approver + same key racing.
  --digest    'nothing else changed': md5 of every function (+ACL), trigger, column, constraint, policy and index outside the new objects
              is identical on the chain without and with the candidate.
  --mutations every mutant of the candidate in a cloned database must be killed by the suite.
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse, importlib.util, json, os, re, subprocess, sys, tempfile, threading, time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bpbase', ROOT / 'scripts/test-batalkan-penerimaan-petshop-postgres.py')
bp = importlib.util.module_from_spec(spec); sys.modules['bpbase'] = bp; spec.loader.exec_module(bp)
CAND = sorted(p.name for p in (ROOT / 'supabase/migrations').glob('*_rekap_setoran.sql'))[0]
bp.CAND = CAND
MIGRATIONS, TESTS = bp.MIGRATIONS, bp.TESTS
SUITE = 'rekap_setoran.sql'
check, raw, clone, run_suite, build_chain, apply = bp.check, bp.raw, bp.clone, bp.run_suite, bp.build_chain, bp.apply
NativePostgres, RESULTS = bp.NativePostgres, bp.RESULTS

# Hosted Supabase gives every new public function/table EXECUTE/ALL to anon, authenticated and service_role by default privileges; the bare native chain does not.
PRELUDE = ("alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;\n"
           "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;\n")


SEED = ("insert into coa_accounts(code,name,type,normal_balance) select c,'Fiktif '||c,'BEBAN','D' from unnest(array['720002','720003','720004','740017','740005','720008','740021','740016','730002','720005','720006','720009','740002','740014','740013','740022','740012','760003']) c on conflict(code) do update set is_active=true,is_header=false;\n")
DATA_FIX_KEYS = ('koreksi_saldo_awal_fb', 'ralat_saldo_awal', 'sambung_jurnal_pengeluaran', 'saldo_awal_kas_toko_ke_cabang')
DATA_FIX = [f.read_text() for f in MIGRATIONS.glob('*.sql') if any(k in f.name for k in DATA_FIX_KEYS)]
SKIPPED = []


class Hook:
    """Wraps the native database during chain building: seeds expense accounts before the category migration and skips hosted-data fixes."""
    def __init__(self, db): self.db = db
    def __getattr__(self, k): return getattr(self.db, k)
    def sql(self, source):
        if source.startswith('begin;\n-- Kategori pengeluaran rinci'): source = SEED + source
        if any(t in source for t in DATA_FIX):
            try: return self.db.sql(source)
            except RuntimeError as e:
                SKIPPED.append(str(e)[:80]); return ''
        return self.db.sql(source)


def build_chain(db, exclude=()):
    tmp = Path(tempfile.mkdtemp(prefix='rschain.', dir='/opt/data'))
    try:
        (tmp / 'supabase/migrations').mkdir(parents=True)
        (tmp / 'supabase/tests/fixtures').mkdir(parents=True)
        fx = ROOT / 'supabase/tests/fixtures/hosted_auth_uid.sql'
        if fx.exists(): (tmp / 'supabase/tests/fixtures/hosted_auth_uid.sql').write_text(fx.read_text())
        for f in MIGRATIONS.glob('*.sql'):
            if f.name != CAND and f.name not in exclude and not f.name > CAND:
                (tmp / 'supabase/migrations' / f.name).symlink_to(f)
        old = bp.fixture.ROOT
        bp.fixture.ROOT = tmp
        try:
            bp.fixture.DisposablePostgres.bootstrap(Hook(db))
        finally:
            bp.fixture.ROOT = old
    finally:
        for f in (tmp / 'supabase/migrations').glob('*'): f.unlink()
        (tmp / 'supabase/migrations').rmdir()
        for f in (tmp / 'supabase/tests/fixtures').glob('*'): f.unlink()
        (tmp / 'supabase/tests/fixtures').rmdir(); (tmp / 'supabase/tests').rmdir(); (tmp / 'supabase').rmdir(); tmp.rmdir()


def fresh(db):
    build_chain(db)
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')


def run_green(db, a):
    fresh(db)
    clone(db, 'cand'); apply(db, 'cand', PRELUDE + (MIGRATIONS / CAND).read_text())
    ok, passes, why = run_suite(db, 'cand', SUITE)
    check('GREEN suite on the candidate (%d assertions)' % len(passes), ok and len(passes) >= 250, why)
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
    rc, out, err = raw(db, "select count(*) from pg_class where relname like 'setoran%' and relnamespace='public'::regnamespace", 'base')
    check('BASELINE: no setoran table exists before the candidate', out.strip() == '0', out)
    rc, out, err = raw(db, "select count(*) from pg_proc where proname like 'setoran\\_%'", 'base')
    check('BASELINE: no setoran function exists before the candidate', out.strip() == '0', out)


DIGEST = r"""
with new_t as (select unnest(array['setoran','setoran_shift','setoran_keuangan','setoran_pengeluaran','setoran_transfer','setoran_kasbon','setoran_event','setoran_permintaan']) t),
f as (select p.oid::regprocedure::text k, md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('public','clinic_private','admin_online_private','role_settings_private') and p.prokind='f' and p.proname not like 'setoran\_%' and p.proname not like 'guard\_setoran%'),
t as (select tg.tgrelid::regclass::text||'.'||tg.tgname k, md5(pg_get_triggerdef(tg.oid)) h from pg_trigger tg where not tg.tgisinternal and tg.tgrelid::regclass::text not in (select 'public.'||t from new_t) and tg.tgrelid::regclass::text not in (select t from new_t)),
c as (select table_name||'.'||column_name k, md5(data_type||is_nullable||coalesce(column_default,'')) h from information_schema.columns where table_schema='public' and table_name not in (select t from new_t)),
k as (select conrelid::regclass::text||'.'||conname k, md5(pg_get_constraintdef(oid)) h from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text not in (select t from new_t) and conrelid::regclass::text not in (select 'public.'||t from new_t)),
po as (select polrelid::regclass::text||'.'||polname k, md5(coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'')||polcmd::text) h from pg_policy where polrelid::regclass::text not in (select t from new_t)),
ix as (select schemaname||'.'||indexname k, md5(indexdef) h from pg_indexes where schemaname='public' and tablename not in (select t from new_t)),
a as (select 'F'||k k,h from f union all select 'T'||k,h from t union all select 'C'||k,h from c union all select 'K'||k,h from k union all select 'P'||k,h from po union all select 'I'||k,h from ix)
select count(*)||' '||md5(string_agg(k||h,',' order by k)) from a;
"""


def run_digest(db, a):
    fresh(db)
    clone(db, 'old'); clone(db, 'new'); apply(db, 'new', PRELUDE + (MIGRATIONS / CAND).read_text())
    ro = raw(db, DIGEST, 'old'); rn = raw(db, DIGEST, 'new')
    o = ro[1].strip() or '0 ERR'; n = rn[1].strip() or '0 ERR'
    if o == '0 ERR' or n == '0 ERR': print('DIGEST SQL error:', (ro[2] or rn[2])[:400], flush=True)
    check('DIGEST objects outside the new ones are identical before and after (%s | %s)' % (o, n), o == n and int(o.split()[0]) > 1000, '')
    rc, out, err = raw(db, "select count(*) from journal_entries; select count(*) from expenses; select count(*) from cash_advances", 'new')
    check('DIGEST the migration writes no journal, expense or cashbon rows', out.split() == ['0', '0', '0'], out)
    rc, out, err = raw(db, "select (select count(*) from setoran)+(select count(*) from setoran_event)+(select count(*) from setoran_permintaan)", 'new')
    check('DIGEST new tables are empty after install', out.strip() == '0', out)


# ----------------------------------------------------------------------------------------------- concurrency
CONC_FIX = r"""
begin;
insert into auth.users(id,raw_user_meta_data) select ('c5100000-0000-4000-8000-0000000000'||n)::uuid,jsonb_build_object('full_name','CONC '||n) from unnest(array['01','02','03','04']) n;
update profiles set role='FINANCE',is_active=true where id in('c5100000-0000-4000-8000-000000000001','c5100000-0000-4000-8000-000000000002');
update profiles set role='STAFF',is_active=true where id in('c5100000-0000-4000-8000-000000000003');
update profiles set role='OWNER',is_active=true where id='c5100000-0000-4000-8000-000000000004';
insert into role_modules(role,module_id) values('STAFF','pos'),('FINANCE','pos') on conflict do nothing;
insert into branches(id,code,name,type) values('c5200000-0000-4000-8000-000000000001','CNC','Conc','PETSHOP');
insert into user_branches(user_id,branch_id) select ('c5100000-0000-4000-8000-0000000000'||n)::uuid,'c5200000-0000-4000-8000-000000000001' from unnest(array['01','02','03']) n;
insert into employees(id,nama,profile_id,status) values('c5300000-0000-4000-8000-000000000001','Conc Kasir','c5100000-0000-4000-8000-000000000003','Aktif');
update accounting_locks set closed_until=null;
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at,closing_balance,expected_cash,selisih,closed_at,status,closing_breakdown)
 values('c5400000-0000-4000-8000-000000000001','c5200000-0000-4000-8000-000000000001','c5100000-0000-4000-8000-000000000003','petshop',0,
  (((now() at time zone 'Asia/Jakarta')::date-3)::timestamp+time '08:00') at time zone 'Asia/Jakarta',500000,500000,0,(((now() at time zone 'Asia/Jakarta')::date-3)::timestamp+time '17:00') at time zone 'Asia/Jakarta','closed','{"Tunai":500000}');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) values('119900','Conc kas','ASET','D',false,true) on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code,is_active) values('c5500000-0000-4000-8000-000000000001','Conc kas','Kas','119900',true) on conflict do nothing;
commit;
"""
CONC_STEPS = r"""
set role authenticated;
select set_config('request.jwt.claim.sub','c5100000-0000-4000-8000-000000000003',false);select set_config('request.jwt.claims','{"role":"authenticated"}',false);
create temp table r(k text,v jsonb);
insert into r select 'p',public.setoran_buat('c5200000-0000-4000-8000-000000000001',((now() at time zone 'Asia/Jakarta')::date-3),((now() at time zone 'Asia/Jakarta')::date-3),((now() at time zone 'Asia/Jakarta')::date-2),'12:00','c5600000-0000-4000-8000-000000000001');
insert into r select 't',public.setoran_tambah_transfer((select (v->>'id')::uuid from r where k='p'),((now() at time zone 'Asia/Jakarta')::date-2),400000,'Serah tunai',(select id from public.cash_accounts where nama='Conc kas'),null,null,0,'c5600000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','c5100000-0000-4000-8000-000000000001',false);
select public.setoran_putuskan_transfer((select (v->>'id')::uuid from r where k='p'),(select (v->>'transfer_id')::uuid from r where k='t'),true,null,'c5600000-0000-4000-8000-000000000003');
select set_config('request.jwt.claim.sub','c5100000-0000-4000-8000-000000000003',false);
select public.setoran_ajukan((select (v->>'id')::uuid from r where k='p'),1,'c5600000-0000-4000-8000-000000000004');
select 'PID '||(v->>'id') from r where k='p';
"""


def psql_session(db, sql, dbname, results, key, delay=0):
    time.sleep(delay)
    t0 = time.time()
    rc, out, err = raw(db, sql, dbname)
    results[key] = (rc, out, err, time.time() - t0)


def run_conc(db, a):
    fresh(db)
    clone(db, 'conc'); apply(db, 'conc', PRELUDE + (MIGRATIONS / CAND).read_text())
    rc, out, err = raw(db, CONC_FIX, 'conc')
    check('CONC fixture committed', rc == 0, err[-300:])
    rc, out, err = raw(db, CONC_STEPS, 'conc')
    pid = re.search(r'PID ([0-9a-f-]{36})', out)
    check('CONC setoran Diajukan siap (satu transfer dikonfirmasi 400.000, kewajiban 500.000 -> kurang 100.000)', rc == 0 and bool(pid), (err or out)[-400:])
    if not pid: return
    sid = pid.group(1)
    head = "set role authenticated;select set_config('request.jwt.claim.sub','%s',false);select set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false);\nbegin;\n"
    appr = "select public.setoran_setujui('%s','%s',null,'[{\"employee_id\":\"c5300000-0000-4000-8000-000000000001\",\"jumlah\":100000}]'::jsonb,false,false,null);\n"
    # 1) two different approvers race: the first holds its transaction open 3 s
    s1 = head % 'c5100000-0000-4000-8000-000000000001' + appr % (sid, 'c5600000-0000-4000-8000-0000000000a1') + "select pg_sleep(3);\ncommit;\n"
    s2 = head % 'c5100000-0000-4000-8000-000000000002' + appr % (sid, 'c5600000-0000-4000-8000-0000000000a2') + "commit;\n"
    res = {}
    t1 = threading.Thread(target=psql_session, args=(db, s1, 'conc', res, 's1')); t2 = threading.Thread(target=psql_session, args=(db, s2, 'conc', res, 's2', 1.2))
    t1.start(); t2.start(); t1.join(); t2.join()
    rc1, o1, e1, d1 = res['s1']; rc2, o2, e2, d2 = res['s2']
    check('CONC approver 1 succeeded', rc1 == 0, e1[-300:])
    check('CONC approver 2 was blocked until approver 1 committed, then refused as already decided (waited %.1fs)' % d2, rc2 != 0 and 'sudah diputuskan' in e2 and d2 >= 1.5, e2[-300:])
    rc, out, err = raw(db, "select (select count(*) from journal_entries where source='setoran')||' '||(select count(*) from cash_advances where alasan like 'Selisih kurang setoran%')||' '||(select count(*) from setoran_kasbon)||' '||(select status from setoran)", 'conc')
    check('CONC exactly one settlement journal, one cashbon, status Disetujui (%s)' % out.strip(), out.strip() == '1 1 1 Disetujui', out)
    # 2) same approver, same key, two sessions on a fresh setoran: second returns the stored result
    # fresh branch+shift+setoran for race 2
    fix2 = r"""
begin;
insert into branches(id,code,name,type) values('c5200000-0000-4000-8000-000000000002','CNC2','Conc2','PETSHOP');
insert into user_branches(user_id,branch_id) select ('c5100000-0000-4000-8000-0000000000'||n)::uuid,'c5200000-0000-4000-8000-000000000002' from unnest(array['01','02','03']) n;
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at,closing_balance,expected_cash,selisih,closed_at,status,closing_breakdown)
 values('c5400000-0000-4000-8000-000000000002','c5200000-0000-4000-8000-000000000002','c5100000-0000-4000-8000-000000000003','petshop',0,
  (((now() at time zone 'Asia/Jakarta')::date-3)::timestamp+time '08:00') at time zone 'Asia/Jakarta',300000,300000,0,(((now() at time zone 'Asia/Jakarta')::date-3)::timestamp+time '17:00') at time zone 'Asia/Jakarta','closed','{"Tunai":300000}');
commit;
"""
    raw(db, fix2, 'conc')
    steps2 = CONC_STEPS.replace('c5200000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000002').replace('c5600000-0000-4000-8000-000000000', 'c5600000-0000-4000-8000-000000100').replace("400000,'Serah", "300000,'Serah")
    rc, out, err = raw(db, steps2, 'conc')
    pid2 = re.search(r'PID ([0-9a-f-]{36})', out)
    check('CONC setoran kedua siap (pas)', rc == 0 and bool(pid2), (err or out)[-400:])
    if not pid2: return
    same = "set role authenticated;select set_config('request.jwt.claim.sub','c5100000-0000-4000-8000-000000000001',false);select set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false);\nbegin;\nselect public.setoran_setujui('%s','c5600000-0000-4000-8000-0000000000b1',null,null,false,false,null);\n%scommit;\n" % (pid2.group(1), '%s')
    res = {}
    t1 = threading.Thread(target=psql_session, args=(db, same % "select pg_sleep(3);\n", 'conc', res, 's1')); t2 = threading.Thread(target=psql_session, args=(db, same % '', 'conc', res, 's2', 1.2))
    t1.start(); t2.start(); t1.join(); t2.join()
    check('CONC same approver + same key: both sessions succeed (second waits, then gets the stored result)', res['s1'][0] == 0 and res['s2'][0] == 0 and res['s2'][3] >= 1.5, res['s2'][2][-300:])
    rc, out, err = raw(db, "select (select count(*) from setoran where status='Disetujui')||' '||(select count(*) from setoran_event where jenis='disetujui')", 'conc')
    check('CONC same-key race: still exactly one approval event per setoran (%s)' % out.strip(), out.strip() == '2 2', out)


def mutants():
    return []


def run_mutations(db, a):
    fresh(db)
    base = (MIGRATIONS / CAND).read_text()
    clone(db, 'ctl'); apply(db, 'ctl', PRELUDE + base, later=False)
    ok, passes, why = run_suite(db, 'ctl', SUITE)
    check('CONTROL: unmutated candidate passes the suite (%d assertions)' % len(passes), ok, why)
    want = len(passes)
    only = os.environ.get('BP_ONLY')
    killed_n = total = 0
    muts = json.loads((ROOT / 'scripts/rekap-setoran-mutants.json').read_text())
    for name, old, new in muts:
        if only and not any(name.startswith(o) for o in only.split(',')): continue
        total += 1
        n = base.count(old)
        if n != 1:
            check('MUTANT ' + name + ' (anchor found exactly once)', False, 'anchor count %d' % n); continue
        mutated = base.replace(old, new)
        clone(db, 'mut')
        try:
            apply(db, 'mut', PRELUDE + mutated, later=False)
        except RuntimeError as e:
            killed_n += 1
            check('MUTANT ' + name + ' -> killed (does not even apply: %s)' % str(e)[:80].replace('\n', ' '), True); continue
        ok, passes, why = run_suite(db, 'mut', SUITE)
        killed = (not ok) or len(passes) < want
        killed_n += 1 if killed else 0
        check('MUTANT ' + name + ' -> %s' % ('KILLED: ' + why[:90] if not ok else 'SURVIVED (suite still green, %d)' % len(passes)), killed, why)
    print('MUTANTS killed %d / %d' % (killed_n, total), flush=True)
    RESULTS.append(dict(case='MUTANT TOTAL killed %d of %d' % (killed_n, total), status='PASS' if killed_n == total and (total >= 30 or only) else 'FAIL', detail=''))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--conc', action='store_true'); ap.add_argument('--digest', action='store_true')
    a = ap.parse_args()
    fn = run_baseline if a.baseline else run_green
    if a.mutations: fn = run_mutations
    if a.conc: fn = run_conc
    if a.digest: fn = run_digest
    with NativePostgres(a.pg_bin) as db:
        fn(db, a)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(mode=fn.__name__, results=RESULTS), indent=1))
    fails = [r for r in RESULTS if r['status'] == 'FAIL']
    print('SUMMARY mode=%s pass=%d fail=%d' % (fn.__name__, len(RESULTS) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
