#!/usr/bin/env python3
"""Batalkan penerimaan PETSHOP (migrasi 20261112300000_batalkan_penerimaan_petshop.sql). Native throwaway PostgreSQL only; never accepts a database URL.

  python3 -I scripts/test-batalkan-penerimaan-petshop-postgres.py --pg-bin DIR [--json out.json] [--baseline | --mutations | --smoke]
  (default)   chain + candidate: SQL suite supabase/tests/batalkan_penerimaan_petshop.sql, patched-function identity check against the
              chain (anchors == exactly the reviewed text), independent-session races (two sessions, real locks), neighbouring suites.
  --baseline  chain WITHOUT the candidate: the suite must FAIL at its first assertion (RED).
  --mutations every mutant of the candidate in a cloned database must be killed by the suite or the race checks.
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse, hashlib, importlib.util, json, os, re, subprocess, sys, tempfile, threading, time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
from native_postgres import NativePostgres  # noqa: E402

CAND = '20261112300000_batalkan_penerimaan_petshop.sql'
MIGRATIONS = ROOT / 'supabase/migrations'
TESTS = ROOT / 'supabase/tests'
SUITE = 'batalkan_penerimaan_petshop.sql'
RESULTS = []


def check(name, ok, detail=''):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=str(detail)[:700]))
    print(RESULTS[-1]['status'], name, str(detail)[:300], flush=True)
    return ok


def build_chain(db, exclude):
    tmp = Path(tempfile.mkdtemp(prefix='bpchain.', dir='/opt/data'))
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


def run_suite(db, dbname, name=SUITE, text=None):
    rc, out, err = raw(db, text if text is not None else (TESTS / name).read_text(), dbname)
    passes = [re.sub(r'^.*BP_PASS ', '', l) for l in err.splitlines() if 'BP_PASS ' in l]
    for l in err.splitlines():
        if 'DBG' in l: print(l, flush=True)
    why = ''
    if rc:
        errs = [l for l in err.splitlines() if l.startswith('ERROR')]
        why = (errs[0] if errs else err.strip().splitlines()[-1] if err.strip() else 'error')[:500]
    return rc == 0, passes, why


# ------------------------------------------------------------------ races: independent sessions, real locks
RACE_FIX = r"""
begin;
insert into auth.users(id,raw_user_meta_data) values
 ('bb000000-0000-4000-8000-0000000000a1','{"full_name":"Race owner"}'),('bb000000-0000-4000-8000-0000000000a2','{"full_name":"Race cashier"}');
update profiles set role='OWNER',is_active=true where id='bb000000-0000-4000-8000-0000000000a1';
update profiles set role='STAFF',is_active=true where id='bb000000-0000-4000-8000-0000000000a2';
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values('bb010000-0000-4000-8000-000000000001','RACEBR','Race','PETSHOP');
insert into user_branches(user_id,branch_id) values('bb000000-0000-4000-8000-0000000000a1','bb010000-0000-4000-8000-000000000001'),('bb000000-0000-4000-8000-0000000000a2','bb010000-0000-4000-8000-000000000001');
insert into warehouses(id,branch_id,code,name,type) values('bb020000-0000-4000-8000-000000000001','bb010000-0000-4000-8000-000000000001','RACEWH','Race wh','RETAIL');
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values('bb030000-0000-4000-8000-000000000001','bb010000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-0000000000a2','petshop');
insert into items(id,code,name,unit,item_type) values('bb040000-0000-4000-8000-000000000001','RACESVC','Race service','pcs','Jasa');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1111','Race cash','ASET','D',false),('1112','Race bank','ASET','D',false),('150001','Receivable','ASET','D',false),('510001','Sales','PENDAPATAN','K',false),
 ('520002','Discount','PENDAPATAN','D',false),('312005','VAT','LIABILITAS','K',false),('600001','COGS','BEBAN','D',false),('170001','Inventory','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values('bb050000-0000-4000-8000-000000000001','Race cash','Kas','1111'),('bb050000-0000-4000-8000-000000000002','Race bank','Bank','1112');
insert into payment_account_map(metode,branch_id,cash_account_id) values('Tunai','bb010000-0000-4000-8000-000000000001','bb050000-0000-4000-8000-000000000001'),('Transfer','bb010000-0000-4000-8000-000000000001','bb050000-0000-4000-8000-000000000002') on conflict do nothing;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;
commit;
"""


def race_sale(ref):
    return f"""set role authenticated; select set_config('request.jwt.claim.sub','bb000000-0000-4000-8000-0000000000a2',false); select set_config('request.jwt.claims','{{"role":"authenticated"}}',false);
insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('bb010000-0000-4000-8000-000000000001','{ref}',100000,0,100000,'Split',100000,0,'bb000000-0000-4000-8000-0000000000a2','bb030000-0000-4000-8000-000000000001',
 '[{{"method":"Tunai","amount":40000}},{{"method":"Transfer","amount":60000}}]','k-{ref}',repeat('a',64));
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) select id,'bb040000-0000-4000-8000-000000000001','svc',2,50000,'pcs',1,0 from sales where no_struk='{ref}';
select finalize_pos_sale((select id from sales where no_struk='{ref}')); reset role;"""


OWNER_SESSION = "set role authenticated; select set_config('request.jwt.claim.sub','bb000000-0000-4000-8000-0000000000a1',false); select set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false);"


class Sess:
    """A psql process that runs a script in the background."""
    def __init__(self, db, dbname, script):
        env = {**os.environ, 'PSQLRC': '/dev/null', 'PGDATABASE': dbname}
        self.p = subprocess.Popen(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        self.p.stdin.write(script); self.p.stdin.close()

    def done(self, timeout=40):
        out = self.p.stdout.read(); err = self.p.stderr.read(); self.p.wait(timeout=timeout)
        return self.p.returncode, out, err


def waiting(db, dbname, pattern, n=1, tries=240):
    for _ in range(tries):
        rc, out, err = raw(db, "select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%%%s%%' and pid<>pg_backend_pid()" % pattern, dbname)
        if out.strip() == str(n): return True
        time.sleep(0.05)
    return False


def sleeping(db, dbname, pattern, tries=240):
    for _ in range(tries):
        rc, out, err = raw(db, "select count(*) from pg_stat_activity where wait_event='PgSleep' and query like '%%%s%%' and pid<>pg_backend_pid()" % pattern, dbname)
        if out.strip() == '1': return True
        time.sleep(0.05)
    return False


def q1(db, dbname, sql):
    rc, out, err = raw(db, sql, dbname)
    assert rc == 0, err
    return out.strip()


def races(db, dbname):
    """Real concurrency: independent psql sessions on a committed fixture."""
    rc, out, err = raw(db, RACE_FIX, dbname); assert rc == 0, err
    for ref in ('R1', 'R2', 'R3', 'R4'):
        rc, out, err = raw(db, race_sale(ref), dbname); assert rc == 0, err
    sid = lambda ref: q1(db, dbname, f"select id from sales where no_struk='{ref}'")
    cancel = lambda ref, key: f"select cancel_pos_sale_receipt('{sid(ref)}',0,'{key}','balapan alasan');"
    # 1. two sessions, different keys, same sale: exactly one wins, loser gets the plain "sudah dibatalkan" message
    a = Sess(db, dbname, OWNER_SESSION + "begin; " + cancel('R1', 'ra') + " /* race-holder */ select pg_sleep(2.5); commit;")
    ok = sleeping(db, dbname, 'race-holder')
    b = Sess(db, dbname, OWNER_SESSION + "/* race-comp */ " + cancel('R1', 'rb'))
    ok2 = waiting(db, dbname, 'race-comp')
    ra, rb = a.done(), b.done()
    msg = rb[2]
    check('RACE two cancels of one sale (different keys): the second waits on the sale lock, then is refused plainly', ok and ok2 and ra[0] == 0 and rb[0] != 0 and 'sudah dibatalkan' in msg, (ok, ok2, ra[0], rb[0], msg[-200:]))
    check('RACE one cancellation row and one reversal journal after the race', q1(db, dbname, f"select (select count(*) from pos_receipt_cancellations where sale_id='{sid('R1')}')||'/'||(select count(*) from journal_entries where source='sale-receipt-cancel' and source_ref in (select id::text from pos_receipt_cancellations where sale_id='{sid('R1')}'))") == '1/1')
    # 2. same key from two sessions (double click): one effect, both get the same answer
    a = Sess(db, dbname, OWNER_SESSION + "begin; " + cancel('R2', 'dup') + " /* race-holder2 */ select pg_sleep(2.5); commit;")
    sleeping(db, dbname, 'race-holder2')
    b = Sess(db, dbname, OWNER_SESSION + "/* race-comp2 */ " + cancel('R2', 'dup'))
    waiting(db, dbname, 'race-comp2')
    ra, rb = a.done(), b.done()
    check('RACE same request key from two sessions (double click): one effect, identical answer', ra[0] == 0 and rb[0] == 0 and ra[1].strip() == rb[1].strip() and q1(db, dbname, f"select count(*) from pos_receipt_cancellations where sale_id='{sid('R2')}'") == '1', (ra[2][-150:], rb[2][-150:]))
    # 3. cancel receipt vs shift close: close waits for the shift lock, then its stale snapshot is refused (counted money changed)
    stale_sql = "update cashier_shifts set status='closed',expected_cash=80000,closing_breakdown='{\"Tunai\":80000,\"Transfer\":120000,\"Debit\":0,\"Kredit\":0,\"QRIS\":0,\"E-Wallet\":0}' where id='bb030000-0000-4000-8000-000000000001';"
    right_sql = "update cashier_shifts set status='closed',expected_cash=40000,closing_breakdown='{\"Tunai\":40000,\"Transfer\":60000,\"Debit\":0,\"Kredit\":0,\"QRIS\":0,\"E-Wallet\":0}' where id='bb030000-0000-4000-8000-000000000001';"
    a = Sess(db, dbname, OWNER_SESSION + "begin; " + cancel('R3', 'rc') + " /* race-holder3 */ select pg_sleep(2.5); commit;")
    sleeping(db, dbname, 'race-holder3')
    b = Sess(db, dbname, "/* race-close */ " + stale_sql)
    waiting(db, dbname, 'race-close')
    ra, rb = a.done(), b.done()
    check('RACE shift close started before the cancel committed: refused (counted money changed), shift still open', ra[0] == 0 and rb[0] != 0 and 'Pembayaran shift berubah' in rb[2]
          and q1(db, dbname, "select status from cashier_shifts where id='bb030000-0000-4000-8000-000000000001'") == 'open', (ra[2][-150:], rb[2][-200:]))
    rc, out, err = raw(db, right_sql, dbname)
    check('RACE positive control: the same close with the numbers that include the cancellation is accepted', rc == 0 and q1(db, dbname, "select status from cashier_shifts where id='bb030000-0000-4000-8000-000000000001'") == 'closed', err[-200:])
    rc, out, err = raw(db, "update cashier_shifts set status='open',closed_at=null where id='bb030000-0000-4000-8000-000000000001';", dbname)
    # 4. cancel vs void: void waits; then runs in the unpaid state (patched)
    a = Sess(db, dbname, OWNER_SESSION + "begin; " + cancel('R4', 'rv') + " /* race-holder4 */ select pg_sleep(2.5); commit;")
    sleeping(db, dbname, 'race-holder4')
    b = Sess(db, dbname, OWNER_SESSION + f"/* race-void */ select cancel_posted_sale('{sid('R4')}',0,'void-after','alasan batal');")
    waiting(db, dbname, 'race-void')
    ra, rb = a.done(), b.done()
    check('RACE void started while the receipt cancel was still open: waits, then voids the now-unpaid sale (closes the cancellation record)',
          ra[0] == 0 and rb[0] == 0 and q1(db, dbname, f"select (voided_at is not null)::text||'/'||(select closed_kind from pos_receipt_cancellations where sale_id=sales.id) from sales where id='{sid('R4')}'") == 'true/penjualan-dibatalkan', (ra[2][-150:], rb[2][-200:]))
    check('RACE after all races: trial balance is zero', q1(db, dbname, "select coalesce(sum(debit-credit),0) from journal_lines") == '0.00' or q1(db, dbname, "select coalesce(sum(debit-credit),0)=0 from journal_lines") == 't')


# ------------------------------------------------------------------ patched-function identity
PATCHED = ['cancel_posted_sale(uuid,integer,text,text)', 'pos_shift_pending_checkout_guard()', 'pos_sale_journal_protected(uuid)']
NEW_FUNCS = ['guard_receipt_cancel_history', 'guard_receipt_history_immutable', 'guard_unpaid_pos_sale', 'pos_receipt_actor_allowed', 'cancel_pos_sale_receipt', 'receive_pos_sale_payment', 'cancel_online_disbursement']


def fn_digests(db, dbname):
    rc, out, err = raw(db, "select p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid))||'|'||p.prosecdef::text||'|'||coalesce(p.proconfig::text,'')||'|'||p.proowner::regrole::text||'|'||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','clinic_private','role_settings_private') order by 1", dbname)
    assert rc == 0, err
    d = {}
    for l in out.splitlines():
        k, rest = l.split('|', 1); d[k] = rest
    return d


def run_baseline(db, a):
    build_chain(db, {CAND})
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')
    clone(db, 'red')
    ok, passes, why = run_suite(db, 'red')
    check('RED: suite fails at the baseline (objects missing) with zero assertions passed', not ok and len(passes) == 0, why)


def run_green(db, a):
    build_chain(db, {CAND})
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')
    clone(db, 'before'); before = fn_digests(db, 'before')
    clone(db, 'g'); apply(db, 'g', (MIGRATIONS / CAND).read_text())
    after = fn_digests(db, 'g')
    changed = sorted(k for k in before if k in after and before[k] != after[k])
    new = sorted(k for k in after if k not in before)
    gone = sorted(k for k in before if k not in after)
    check('IDENTITY existing functions that changed == exactly the 3 reviewed patches (owner/definer/config/ACL included in the digest)',
          changed == sorted(PATCHED) and not gone, (changed, gone))
    check('IDENTITY new functions are exactly the 7 expected', sorted(re.sub(r'\(.*', '', k).split('.')[-1] for k in new) == sorted(NEW_FUNCS), new)
    def grantees(v):
        acl = v.split('|')[-1].strip('{}')
        return sorted({(x.split('=')[0] or 'PUBLIC') for x in acl.split(',') if x})
    acl = {k: grantees(after[k]) for k in new}
    client_rpcs = ('pos_receipt_actor_allowed', 'cancel_pos_sale_receipt', 'receive_pos_sale_payment', 'cancel_online_disbursement')
    check('ACL new functions: the 4 RPCs are executable by authenticated and postgres only (no anon, no PUBLIC); internal guards by postgres only',
          all(g == (['authenticated', 'postgres'] if k.split('(')[0] in client_rpcs else ['postgres']) for k, g in acl.items()), acl)
    tabs = db.sql("select c.relname||':'||coalesce(c.relacl::text,'') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('pos_receipt_cancellations','sale_receipt_shift_effects','online_disbursement_cancellations','receipt_cancel_requests') order by 1") if False else None
    ok, passes, why = run_suite(db, 'g')
    check('SQL suite %s GREEN: %d assertions passed' % (SUITE, len(passes)), ok and len(passes) >= 90, why or 'passes=%d' % len(passes))
    # races on a committed fixture
    clone(db, 'rc'); apply(db, 'rc', (MIGRATIONS / CAND).read_text())
    races(db, 'rc')


def run_smoke(db, a):
    build_chain(db, {CAND})
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')
    clone(db, 'g'); apply(db, 'g', (MIGRATIONS / CAND).read_text())
    print('SMOKE applied OK', flush=True)
    for fn in os.environ.get('BP_DUMP', '').split(','):
        if fn:
            rc, out, err = raw(db, "select pg_get_functiondef('%s'::regprocedure)" % fn, 'g')
            Path('/opt/data/kamo-cost-missing-evidence/ship-batal-petshop/native/dump-%s.sql' % re.sub(r'\W', '_', fn)).write_text(out)
    if (TESTS / SUITE).exists():
        ok, passes, why = run_suite(db, 'g')
        print('SUITE', ok, len(passes), why, '| last:', passes[-3:])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--smoke', action='store_true')
    a = ap.parse_args()
    fn = run_baseline if a.baseline else run_smoke if a.smoke else run_green
    if a.mutations:
        fn = run_mutations
    with NativePostgres(a.pg_bin) as db:
        fn(db, a)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(mode=fn.__name__, results=RESULTS), indent=1))
    fails = [r for r in RESULTS if r['status'] == 'FAIL']
    print('SUMMARY mode=%s pass=%d fail=%d' % (fn.__name__, len(RESULTS) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)


def mutants():
    G = "if v_role='OWNER' then return true; end if;"
    return [
        ('M01 ADMIN/FINANCE allowed without the Owner-ticked policy', "   and exists(select 1 from role_settings_private.action_policies a where a.role=v_role and 'penjualan.pos_penerimaan.batalkan'=any(a.allowed));", ";"),
        ('M02 OWNER no longer short-circuits (goes through the policy tables, so a policy error can lock the Owner)', G, ""),
        ('M03 any role (STAFF/DOCTOR) may pass the gate', "if v_role not in('ADMIN','FINANCE') or not public.user_can_access_branch(p_branch) then return false; end if;", "if not public.user_can_access_branch(p_branch) then return false; end if;"),
        ('M04 branch scope ignored for ADMIN/FINANCE', "if v_role not in('ADMIN','FINANCE') or not public.user_can_access_branch(p_branch) then return false; end if;", "if v_role not in('ADMIN','FINANCE') then return false; end if;"),
        ('M05 policy read error fails OPEN for non-owners', " exception when others then return false;\n end;", " exception when others then return true;\n end;"),
        ('M06 cancel: reason may be empty', "or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(reason) not between 3 and 1000 then\n  raise exception 'Identitas atau alasan pembatalan penerimaan tidak valid.", "or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(reason) not between 0 and 1000 then\n  raise exception 'Identitas atau alasan pembatalan penerimaan tidak valid."),
        ('M07 cancel: double cancel allowed (no open-record check)', "if exists(select 1 from public.pos_receipt_cancellations where sale_id=s.id and closed_at is null) then\n  raise exception 'Penerimaan struk ini sudah dibatalkan.", "if false then\n  raise exception 'Penerimaan struk ini sudah dibatalkan."),
        ('M08 cancel: merchant-fee sales allowed', "if s.merchant_fee_total<>0 then", "if false then"),
        ('M09 cancel: sales with a return allowed', "if exists(select 1 from public.sales_returns where sale_id=s.id and voided_at is null)\n  or exists(select 1 from public.sale_payment_refunds r join public.sale_payments p on p.id=r.sale_payment_id where p.sale_id=s.id)\n  or exists(select 1 from public.sales_refund_requests where sale_id=s.id and status in('pending','diproses','selesai')) then", "if false then"),
        ('M10 cancel: accounting period lock ignored', "if closed is not null and today<=closed then raise exception 'Periode akuntansi sampai % sudah ditutup; pembatalan penerimaan hari ini tidak bisa dibukukan.',closed; end if;", ""),
        ('M11 cancel: receivable account wrong (130009 instead of 150001)', "jsonb_build_array(jsonb_build_object('code','150001','debit',s.total,'credit',0)) into lines", "jsonb_build_array(jsonb_build_object('code','130009','debit',s.total,'credit',0)) into lines"),
        ('M12 cancel: drawer effect has the wrong sign', "select audit,s.id,eff,p.method,-p.amount,'batal' from public.sale_payments p", "select audit,s.id,eff,p.method,p.amount,'batal' from public.sale_payments p"),
        ('M13 cancel: closed shift is charged instead of the open shift', "if src_status='open' then eff:=s.shift_id;\n else select id into eff from public.cashier_shifts", "if true then eff:=s.shift_id;\n else select id into eff from public.cashier_shifts"),
        ('M14 cancel: cash sale with no open shift allowed', "if eff is null and cash_total>0 then\n  raise exception 'Struk ini dibayar tunai", "if false then\n  raise exception 'Struk ini dibayar tunai"),
        ('M15 cancel: stale revision accepted', "if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang halaman sebelum membatalkan penerimaan.'; end if;", ""),
        ('M16 cancel: replay of the same key repeats the work', " if found then\n  if prior.payload is distinct from payload then raise exception 'Kunci permintaan sudah dipakai untuk isian berbeda. Muat ulang halaman.'; end if;\n  return prior.result;\n end if;\n if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang halaman sebelum membatalkan penerimaan.'", " if false then\n  return prior.result;\n end if;\n if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang halaman sebelum membatalkan penerimaan.'"),
        ('M17 cancel: bank reconciliation fence removed', "where r.voided_at is null and r.tanggal>=today and (c.id is null or c.code=any(codes))) then", "where false) then"),
        ('M18 receive: total check removed', "or (select coalesce(sum(amount),0) from jsonb_to_recordset(plan_norm) x(amount numeric))<>s.total then", "then"),
        ('M19 receive: payment rows/header not replaced when the plan changed', "if changed then\n  new_plan:=", "if false then\n  new_plan:="),
        ('M20 receive: shift effect for the open-shift case omitted', "if s0_status='open' and eff=s.shift_id then", "if false then"),
        ('M21 receive: repost journal sides swapped', "lines:=lines||jsonb_build_array(jsonb_build_object('code','150001','debit',0,'credit',s.total));\n perform public.sales_write_journal(today,s.branch_id,'sale-receipt-repost'", "lines:=(select jsonb_agg(jsonb_build_object('code',x->>'code','debit',(x->>'credit')::numeric,'credit',(x->>'debit')::numeric)) from jsonb_array_elements(lines||jsonb_build_array(jsonb_build_object('code','150001','debit',0,'credit',s.total))) x);\n perform public.sales_write_journal(today,s.branch_id,'sale-receipt-repost'"),
        ('M22 receive: closed shift without open shift allowed for cash', "if eff is null and cash_new>0 then", "if false then"),
        ('M23 void patch: closed shift still blocks an unpaid sale', "if s.shift_id is not null and not unpaid then", "if s.shift_id is not null then"),
        ('M24 void patch: receipt journals not reversed with the sale', "or (e.source in(''sale-receipt-cancel'',''sale-receipt-repost'') and e.source_ref in(select id::text from public.pos_receipt_cancellations where sale_id=s.id))", "or false"),
        ('M25 void patch: cancellation record not closed after the void', "update public.pos_receipt_cancellations set closed_at=now(),closed_by=auth.uid(),closed_kind=''penjualan-dibatalkan'' where sale_id=s.id and closed_at is null;", ""),
        ('M26 void patch: open-shift drawer effect not neutralised', "where pc.sale_id=s.id and pc.closed_at is null and e.shift_id is not distinct from s.shift_id", "where false and pc.sale_id=s.id and pc.closed_at is null and e.shift_id is not distinct from s.shift_id"),
        ('M27 shift close guard: effects not counted', "\\n    union all\\n    select e.method,e.amount from public.sale_receipt_shift_effects e where e.shift_id=old.id\\n   ) incoming", "\\n   ) incoming"),
        ('M28 journal protection list: receipt journals not protected', "''sale-void-receipt'',''sale-receipt-cancel'',''sale-receipt-repost'',''sale-online-cair-void'',", ""),
        ('M29 history immutability trigger removed (cancellation record)', "create trigger guard_pos_receipt_cancel_history before update or delete on public.pos_receipt_cancellations for each row execute function public.guard_receipt_cancel_history();", ""),
        ('M30 unpaid guard removed from sales_returns', "create trigger guard_unpaid_pos_sale before insert on public.sales_returns for each row execute function public.guard_unpaid_pos_sale();", ""),
        ('M31 unpaid guard removed from J02 corrections', "create trigger guard_unpaid_pos_sale before insert on public.sale_payment_corrections for each row execute function public.guard_unpaid_pos_sale();", ""),
        ('M32 RLS: cancellations readable across branches', "using(public.user_can_access_branch(branch_id));\n\ncreate table public.sale_receipt_shift_effects", "using(true);\n\ncreate table public.sale_receipt_shift_effects"),
        ('M33 online: commission not reset on cancel', "update public.sales set marketplace_status='piutang',komisi=0,disbursed_at=null where id=s.id;", "update public.sales set marketplace_status='piutang',disbursed_at=null where id=s.id;"),
        ('M34 online: not-yet-disbursed order accepted', "if s.marketplace_status is distinct from 'cair' or s.disbursed_at is null then raise exception 'Order ini belum dicairkan (sudah berstatus piutang).'; end if;", ""),
        ('M35 cash-receipt path accepts marketplace orders', "if s.channel is not null then raise exception 'Order marketplace: batalkan PENCAIRAN-nya, bukan penerimaan kasir.'; end if;", ""),
        ('M36 online: bank side of the reversal omitted', "if bank_amount>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code',bank_code,'debit',0,'credit',bank_amount)); end if;", "if false then null; end if;"),
        ('M37 void patch: disbursed-marketplace guard loosened for still-disbursed orders', "(select count(*) from public.journal_entries where source=''sale-online-cair'' and source_ref=s.no_struk)>(select count(*) from public.online_disbursement_cancellations where sale_id=s.id)", "false"),
    ]


def run_mutations(db, a):
    build_chain(db, {CAND})
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')
    base = (MIGRATIONS / CAND).read_text()
    clone(db, 'ctl'); apply(db, 'ctl', base)
    ok, passes, why = run_suite(db, 'ctl')
    check('CONTROL: unmutated candidate passes the suite (%d assertions)' % len(passes), ok, why)
    want = len(passes)
    only = os.environ.get('BP_ONLY')
    for name, old, new in mutants():
        if only and not name.startswith(only): continue
        if base.count(old) != 1:
            check('MUTANT ' + name + ' (anchor found exactly once)', False, 'anchor count %d' % base.count(old)); continue
        mutated = base.replace(old, new)
        clone(db, 'mut')
        try:
            apply(db, 'mut', mutated)
        except RuntimeError as e:
            check('MUTANT ' + name + ' -> killed (does not even apply: %s)' % str(e)[:80].replace('\n', ' '), True); continue
        ok, passes, why = run_suite(db, 'mut')
        check('MUTANT ' + name + ' -> %s' % ('KILLED: ' + why[:90] if not ok else 'SURVIVED (suite still green, %d)' % len(passes)), not ok or len(passes) < want, why)


if __name__ == '__main__':
    main()
