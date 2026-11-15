#!/usr/bin/env python3
"""Tanggal efektif (backdate) PETSHOP (migrasi *_backdate_petshop.sql). Native throwaway PostgreSQL only; never accepts a database URL.

  python3 -I scripts/test-backdate-petshop-postgres.py --pg-bin DIR [--json out.json] [--baseline | --mutations | --smoke]
  (default)   chain + candidate: SQL suite supabase/tests/backdate_petshop.sql, function-identity check, independent-session races, neighbours.
  --baseline  chain WITHOUT the candidate: (a) the suite fails at its first assertion; (b) the real scenario (sale of yesterday, cancelled today with the
              old RPC) fails because the reversal is booked TODAY, not on the original date.
  --mutations every mutant of the candidate in a cloned database must be killed by the suite or the race checks.
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse, importlib.util, json, os, re, sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bpbase', ROOT / 'scripts/test-batalkan-penerimaan-petshop-postgres.py')
bp = importlib.util.module_from_spec(spec); sys.modules['bpbase'] = bp; spec.loader.exec_module(bp)
# The version prefix is renumbered above the live hosted max right before applying; the file is found by its stable suffix.
CAND = sorted(p.name for p in (ROOT / 'supabase/migrations').glob('*_backdate_petshop.sql'))[0]
bp.CAND = CAND
MIGRATIONS, TESTS = bp.MIGRATIONS, bp.TESTS
SUITE, RED = 'backdate_petshop.sql', 'backdate_petshop_red.sql'
check, raw, clone, run_suite, build_chain, apply, Sess, waiting, sleeping, q1 = (bp.check, bp.raw, bp.clone, bp.run_suite, bp.build_chain, bp.apply, bp.Sess, bp.waiting, bp.sleeping, bp.q1)
NativePostgres = bp.NativePostgres
RESULTS = bp.RESULTS


def fresh(db):
    build_chain(db, {CAND})
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')


def sess(sub, script):
    return Sess(sub[0], sub[1], script)


# ------------------------------------------------------------------ races (independent sessions, real locks) on aged sales
AGE = "set session_replication_role=replica; update sales set created_at=created_at-interval '4 days' where no_struk='{ref}'; update journal_entries set tanggal=tanggal-4 where source in('sale','sale-hpp') and source_ref='{ref}'; set session_replication_role=origin;"
TODAY = "(now() at time zone 'Asia/Jakarta')::date"


def races(db, dbname):
    rc, out, err = raw(db, bp.RACE_FIX, dbname); assert rc == 0, err
    refs = ('D1', 'D2', 'D3', 'D4', 'D5')
    for ref in refs:
        rc, out, err = raw(db, bp.race_sale(ref), dbname); assert rc == 0, err
        rc, out, err = raw(db, AGE.format(ref=ref), dbname); assert rc == 0, err
    sid = lambda ref: q1(db, dbname, f"select id from sales where no_struk='{ref}'")
    cancel = lambda ref, key, off, reason='balapan alasan': f"select cancel_pos_sale_receipt('{sid(ref)}',0,'{key}','{reason}',{TODAY}-{off});"
    # 1. two sessions, same sale, different keys AND different dates: exactly one wins, loser gets the plain message
    a = Sess(db, dbname, bp.OWNER_SESSION + "begin; " + cancel('D1', 'da', 2) + " /* race-holder */ select pg_sleep(2.5); commit;")
    ok = sleeping(db, dbname, 'race-holder')
    b = Sess(db, dbname, bp.OWNER_SESSION + "/* race-comp */ " + cancel('D1', 'db', 3))
    ok2 = waiting(db, dbname, 'race-comp')
    ra, rb = a.done(), b.done()
    check('RACE two backdated cancels of one sale (different keys, different dates): one wins, the loser waits then is refused plainly', ok and ok2 and ra[0] == 0 and rb[0] != 0 and 'sudah dibatalkan' in rb[2], (ok, ok2, ra[0], rb[0], rb[2][-200:]))
    check('RACE exactly one cancellation row and one reversal journal, dated by the winner', q1(db, dbname, f"select count(*)||'/'||min(effective_date - {TODAY}) from pos_receipt_cancellations where sale_id='{sid('D1')}'") == '1/-2'
          and q1(db, dbname, f"select count(*) from journal_entries where source='sale-receipt-cancel' and tanggal={TODAY}-2 and source_ref in (select id::text from pos_receipt_cancellations where sale_id='{sid('D1')}')") == '1')
    # 2. same key, same date, two sessions (double click): one effect, same answer
    a = Sess(db, dbname, bp.OWNER_SESSION + "begin; " + cancel('D2', 'dup', 2) + " /* race-holder2 */ select pg_sleep(2.5); commit;")
    sleeping(db, dbname, 'race-holder2')
    b = Sess(db, dbname, bp.OWNER_SESSION + "/* race-comp2 */ " + cancel('D2', 'dup', 2))
    waiting(db, dbname, 'race-comp2')
    ra, rb = a.done(), b.done()
    check('RACE same key + same date from two sessions (double click): one effect, identical answer', ra[0] == 0 and rb[0] == 0 and ra[1].strip() == rb[1].strip() and q1(db, dbname, f"select count(*) from pos_receipt_cancellations where sale_id='{sid('D2')}'") == '1', (ra[2][-150:], rb[2][-150:]))
    # 3. backdated cancel in flight vs Tutup Buku (accounting_locks): the closer waits for the share lock, then closes AFTER the journal exists
    a = Sess(db, dbname, bp.OWNER_SESSION + "begin; " + cancel('D3', 'dc', 2) + " /* race-holder3 */ select pg_sleep(2.5); commit;")
    sleeping(db, dbname, 'race-holder3')
    b = Sess(db, dbname, f"/* race-close-period */ update accounting_locks set closed_until={TODAY}-2;")
    w = waiting(db, dbname, 'race-close-period')
    ra, rb = a.done(), b.done()
    check('RACE Tutup Buku started while a backdated cancel was in flight: it waits for the lock, then closes the period AFTER the cancel (journal inside the closed period, nothing lost)',
          w and ra[0] == 0 and rb[0] == 0 and q1(db, dbname, "select closed_until from accounting_locks")[:4] == q1(db, dbname, f"select ({TODAY}-2)::text")[:4]
          and q1(db, dbname, f"select count(*) from journal_entries where source='sale-receipt-cancel' and tanggal={TODAY}-2 and source_ref in (select id::text from pos_receipt_cancellations where sale_id='{sid('D3')}')") == '1', (w, ra[2][-150:], rb[2][-150:]))
    a = Sess(db, dbname, bp.OWNER_SESSION + cancel('D4', 'dd', 2, 'setelah tutup buku'))
    ra = a.done()
    check('RACE after the period is closed: a backdated cancel into it is refused with the Tutup Buku hint', ra[0] != 0 and 'Tutup Buku' in ra[2], ra[2][-200:])
    raw(db, "update accounting_locks set closed_until=null;", dbname)
    # 4. backdated cancel vs shift close with stale numbers: close waits, then is refused; right numbers accepted
    stale_sql = "update cashier_shifts set status='closed',expected_cash=80000,closing_breakdown='{\"Tunai\":80000,\"Transfer\":120000,\"Debit\":0,\"Kredit\":0,\"QRIS\":0,\"E-Wallet\":0}' where id='bb030000-0000-4000-8000-000000000001';"
    a = Sess(db, dbname, bp.OWNER_SESSION + "begin; " + cancel('D5', 'de', 3) + " /* race-holder5 */ select pg_sleep(2.5); commit;")
    sleeping(db, dbname, 'race-holder5')
    b = Sess(db, dbname, "/* race-close5 */ " + stale_sql)
    waiting(db, dbname, 'race-close5')
    ra, rb = a.done(), b.done()
    check('RACE shift close (stale numbers) started before a BACKDATED cancel committed: refused, shift still open (the drawer effect is independent of the chosen date)', ra[0] == 0 and rb[0] != 0 and 'Pembayaran shift berubah' in rb[2]
          and q1(db, dbname, "select status from cashier_shifts where id='bb030000-0000-4000-8000-000000000001'") == 'open', (ra[2][-150:], rb[2][-200:]))
    right_sql = "update cashier_shifts set status='closed',expected_cash=40000,closing_breakdown='{\"Tunai\":40000,\"Transfer\":60000,\"Debit\":0,\"Kredit\":0,\"QRIS\":0,\"E-Wallet\":0}' where id='bb030000-0000-4000-8000-000000000001';"
    rc, out, err = raw(db, right_sql, dbname)
    check('RACE positive control: the same close with numbers that include the backdated cancel is accepted', rc == 0, err[-200:])
    check('RACE after all races: trial balance is zero per branch per date',
          q1(db, dbname, "select (not exists(select 1 from journal_entries e join journal_lines l on l.entry_id=e.id group by e.branch_id,e.tanggal having sum(l.debit-l.credit)<>0))::text") == 'true')


# ------------------------------------------------------------------ identity
NEW_FUNCS = ['cancel_pos_sale_receipt(uuid,integer,text,text,date)', 'receive_pos_sale_payment(uuid,integer,text,jsonb,date,text)', 'cancel_online_disbursement(uuid,integer,text,text,date)',
             'pos_receipt_backdate_allowed(uuid)', 'pos_receipt_date_bounds(uuid,text)', 'pos_receipt_date_floor(uuid,text)']
CHANGED = ['cancel_online_disbursement(uuid,integer,text,text)', 'cancel_pos_sale_receipt(uuid,integer,text,text)', 'guard_receipt_cancel_history()', 'receive_pos_sale_payment(uuid,integer,text,jsonb)']


def run_baseline(db, a):
    fresh(db)
    clone(db, 'red')
    ok, passes, why = run_suite(db, 'red', SUITE)
    check('RED: the suite fails at the baseline (objects missing) with zero assertions passed', not ok and len(passes) == 0, why)
    clone(db, 'red2')
    ok, passes, why = run_suite(db, 'red2', RED)
    check('RED (behaviour): with the OLD RPC a sale of yesterday cancelled today cannot be booked on its original date (reversal lands today)', not ok and len(passes) == 1 and 'KEMARIN' in why, (passes, why))


def run_green(db, a):
    fresh(db)
    clone(db, 'before'); before = bp.fn_digests(db, 'before')
    clone(db, 'g'); apply(db, 'g', (MIGRATIONS / CAND).read_text(), later=False)
    after = bp.fn_digests(db, 'g')
    changed = sorted(k.replace('public.', '') for k in before if k in after and before[k] != after[k])
    new = sorted(k.replace('public.', '') for k in after if k not in before)
    gone = sorted(k for k in before if k not in after)
    check('IDENTITY existing functions that changed == exactly the 3 old-form wrappers + the history guard (%d)' % len(CHANGED), changed == sorted(CHANGED) and not gone, (changed, gone))
    check('IDENTITY new functions are exactly the 6 expected', new == sorted(NEW_FUNCS), new)
    tail = lambda v: v.split('|', 1)[1]
    check('IDENTITY changed functions keep owner/definer/config/ACL unchanged (only the body differs)', all(tail(before[k]) == tail(after[k]) for k in before if k.replace('public.', '') in CHANGED and k in after),
          [(k, tail(before[k]), tail(after[k])) for k in before if k.replace('public.', '') in CHANGED])
    def grantees(v):
        acl = v.split('|')[-1].strip('{}')
        return sorted({(x.split('=')[0] or 'PUBLIC') for x in acl.split(',') if x})
    clients = ('cancel_pos_sale_receipt', 'receive_pos_sale_payment', 'cancel_online_disbursement', 'pos_receipt_backdate_allowed', 'pos_receipt_date_bounds')
    acl = {k: grantees(after[k]) for k in after if k.replace('public.', '') in NEW_FUNCS}
    check('ACL new functions: RPCs executable by authenticated and postgres only (no anon, no PUBLIC); the floor helper by postgres only',
          all(g == (['authenticated', 'postgres'] if k.split('(')[0].split('.')[-1] in clients else ['postgres']) for k, g in acl.items()), acl)
    rc, out, err = raw(db, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('cancel_pos_sale_receipt','receive_pos_sale_payment','cancel_online_disbursement')", 'g')
    check('PostgREST: each of the 3 RPC names has exactly 2 shapes (old + dated), distinguishable by parameter names', out.strip() == '6', out)
    ok, passes, why = run_suite(db, 'g', SUITE)
    check('SQL suite %s GREEN: %d assertions passed' % (SUITE, len(passes)), ok and len(passes) >= 120, why or 'passes=%d' % len(passes))
    # the #499 petshop suite (158 assertions) and its neighbours on candidate + later migrations are run by the dedicated runner (see report)
    clone(db, 'rc'); apply(db, 'rc', (MIGRATIONS / CAND).read_text(), later=False)
    races(db, 'rc')


def run_smoke(db, a):
    fresh(db)
    clone(db, 'g'); apply(db, 'g', (MIGRATIONS / CAND).read_text(), later=False)
    print('SMOKE applied OK', flush=True)
    ok, passes, why = run_suite(db, 'g', SUITE)
    print('SUITE', ok, len(passes), why, '| last:', passes[-3:])


def mutants():
    # (name, old, new, nth) — nth = 1-based occurrence of `old` to replace (0 = must be unique)
    return [
        ('M01 cancel: journal booked today (effective date ignored)', "perform public.sales_write_journal(edate,s.branch_id,'sale-receipt-cancel'", "perform public.sales_write_journal(today,s.branch_id,'sale-receipt-cancel'", 0),
        ('M02 receive: journal booked today', "perform public.sales_write_journal(edate,s.branch_id,'sale-receipt-repost'", "perform public.sales_write_journal(today,s.branch_id,'sale-receipt-repost'", 0),
        ('M03 online: journal booked today', "perform public.sales_write_journal(edate,s.branch_id,'sale-online-cair-void'", "perform public.sales_write_journal(today,s.branch_id,'sale-online-cair-void'", 0),
        ('M04 cancel: future date allowed', "if edate>today then raise exception 'Tanggal efektif % belum tiba", "if false then raise exception 'Tanggal efektif % belum tiba", 1),
        ('M05 receive: future date allowed', "if edate>today then raise exception 'Tanggal efektif % belum tiba", "if false then raise exception 'Tanggal efektif % belum tiba", 2),
        ('M06 online: future date allowed', "if edate>today then raise exception 'Tanggal efektif % belum tiba", "if false then raise exception 'Tanggal efektif % belum tiba", 3),
        ('M07 cancel: tomorrow allowed (off-by-one)', "if edate>today then raise exception 'Tanggal efektif % belum tiba", "if edate>today+1 then raise exception 'Tanggal efektif % belum tiba", 1),
        ('M08 cancel: floor check removed (before the sale date allowed)', "floor_date:=public.pos_receipt_date_floor(s.id,'cancel');\n if edate<floor_date then", "floor_date:=public.pos_receipt_date_floor(s.id,'cancel');\n if false then", 0),
        ('M09 receive: floor check removed (before the cancellation allowed)', "floor_date:=public.pos_receipt_date_floor(s.id,'receive');\n if edate<floor_date then", "floor_date:=public.pos_receipt_date_floor(s.id,'receive');\n if false then", 0),
        ('M10 online: floor check removed (before the disbursement allowed)', "if edate<floor_date then\n  raise exception 'Tanggal efektif % tidak boleh sebelum tanggal pencairan", "if false then\n  raise exception 'Tanggal efektif % tidak boleh sebelum tanggal pencairan", 0),
        ('M11 floor: sale date ignored', "fl:=greatest((s.created_at at time zone 'Asia/Jakarta')::date,\n  coalesce(", "fl:=greatest(date '1900-01-01',\n  coalesce(", 0),
        ('M12 floor: receive ignores the open cancellation date', "fl:=greatest(fl,coalesce(oc,date '1900-01-01'));", "fl:=fl;", 0),
        ('M13 floor: earlier re-receive journals ignored (second cycle)', "or (e.source='sale-receipt-repost' and e.source_ref in(select id::text from public.pos_receipt_cancellations where sale_id=s.id))\n     or e.source_ref in(select", "or (false)\n     or e.source_ref in(select", 0),
        ('M14 online floor: disbursement date ignored', "floor_date:=greatest(dj.tanggal,(s.created_at at time zone 'Asia/Jakarta')::date);", "floor_date:=(s.created_at at time zone 'Asia/Jakarta')::date;", 0),
        ('M15 cancel: backdate permission not checked', "if found and edate<today and not public.pos_receipt_backdate_allowed(s.branch_id) then\n  raise exception 'Hanya Owner (atau peran yang diberi izin Tanggal mundur di Pengaturan > Akses Grup) yang boleh memilih tanggal sebelum hari ini. Pilih hari ini.' using errcode='42501'; end if;\n select * into s from public.sales where id=p_sale_id for update;\n if not found then raise exception 'Penjualan tidak ditemukan'; end if;\n if not public.pos_receipt_actor_allowed(s.branch_id) then\n  raise exception 'Anda tidak diizinkan membatalkan penerimaan.", "if false then null; end if;\n select * into s from public.sales where id=p_sale_id for update;\n if not found then raise exception 'Penjualan tidak ditemukan'; end if;\n if not public.pos_receipt_actor_allowed(s.branch_id) then\n  raise exception 'Anda tidak diizinkan membatalkan penerimaan.", 0),
        ('M16 receive: backdate permission not checked', "if found and edate<today and not public.pos_receipt_backdate_allowed(s.branch_id) then\n  raise exception 'Hanya Owner (atau peran yang diberi izin Tanggal mundur di Pengaturan > Akses Grup) yang boleh memilih tanggal sebelum hari ini. Pilih hari ini.' using errcode='42501'; end if;\n select * into s from public.sales where id=p_sale_id for update;\n if not found then raise exception 'Penjualan tidak ditemukan'; end if;\n if not public.pos_receipt_actor_allowed(s.branch_id) then\n  raise exception 'Anda tidak diizinkan menerima pembayaran ulang", "if false then null; end if;\n select * into s from public.sales where id=p_sale_id for update;\n if not found then raise exception 'Penjualan tidak ditemukan'; end if;\n if not public.pos_receipt_actor_allowed(s.branch_id) then\n  raise exception 'Anda tidak diizinkan menerima pembayaran ulang", 0),
        ('M17 online: backdate permission not checked', "if found and edate<today and not public.pos_receipt_backdate_allowed(s.branch_id) then\n  raise exception 'Hanya Owner (atau peran yang diberi izin Tanggal mundur di Pengaturan > Akses Grup) yang boleh memilih tanggal sebelum hari ini. Pilih hari ini.' using errcode='42501'; end if;\n select * into s from public.sales where id=p_sale_id for update;\n if not found then raise exception 'Penjualan tidak ditemukan'; end if;\n if not public.pos_receipt_actor_allowed(s.branch_id) then\n  raise exception 'Anda tidak diizinkan membatalkan pencairan.", "if false then null; end if;\n select * into s from public.sales where id=p_sale_id for update;\n if not found then raise exception 'Penjualan tidak ditemukan'; end if;\n if not public.pos_receipt_actor_allowed(s.branch_id) then\n  raise exception 'Anda tidak diizinkan membatalkan pencairan.", 0),
        ('M18 backdate_allowed: ADMIN/FINANCE pass without the Owner-ticked policy', "   and coalesce(public.role_action_allowed('penjualan.pos_penerimaan.tanggal_mundur'),false)\n   and exists(select 1 from role_settings_private.action_policies a where a.role=v_role and 'penjualan.pos_penerimaan.tanggal_mundur'=any(a.allowed));", "   ;", 0),
        ('M19 backdate_allowed: OWNER no longer short-circuits (policy error can lock the Owner)', " if v_role='OWNER' then return true; end if;\n begin\n  if v_role not in('ADMIN','FINANCE') or not public.user_can_access_branch(p_branch) then return false; end if;\n  return public.pos_receipt_actor_allowed(p_branch)\n   and coalesce(public.role_action_allowed('penjualan.pos_penerimaan.tanggal_mundur')", " begin\n  if v_role not in('ADMIN','FINANCE') or not public.user_can_access_branch(p_branch) then return false; end if;\n  return public.pos_receipt_actor_allowed(p_branch)\n   and coalesce(public.role_action_allowed('penjualan.pos_penerimaan.tanggal_mundur')", 0),
        ('M20 backdate_allowed: policy read error fails OPEN', " exception when others then return false;\n end;\nend $$;\nrevoke all on function public.pos_receipt_backdate_allowed", " exception when others then return true;\n end;\nend $$;\nrevoke all on function public.pos_receipt_backdate_allowed", 0),
        ('M21 backdate_allowed: any role (STAFF) may pass', "  if v_role not in('ADMIN','FINANCE') or not public.user_can_access_branch(p_branch) then return false; end if;\n  return public.pos_receipt_actor_allowed(p_branch)\n   and coalesce(public.role_action_allowed('penjualan.pos_penerimaan.tanggal_mundur'),false)", "  if not public.user_can_access_branch(p_branch) then return false; end if;\n  return true\n   and coalesce(public.role_action_allowed('penjualan.pos_penerimaan.tanggal_mundur'),false)", 0),
        ('M22 backdate_allowed: branch scope ignored for ADMIN/FINANCE', "  if v_role not in('ADMIN','FINANCE') or not public.user_can_access_branch(p_branch) then return false; end if;\n  return public.pos_receipt_actor_allowed(p_branch)\n   and coalesce(public.role_action_allowed('penjualan.pos_penerimaan.tanggal_mundur'),false)", "  if v_role not in('ADMIN','FINANCE') then return false; end if;\n  return true\n   and coalesce(public.role_action_allowed('penjualan.pos_penerimaan.tanggal_mundur'),false)", 0),
        ('M23 cancel: closed period check ignores the effective date (uses today)', " if closed is not null and edate<=closed then\n  if edate=today then raise exception 'Periode akuntansi sampai % sudah ditutup; pembatalan penerimaan hari ini", " if closed is not null and today<=closed then\n  if edate=today then raise exception 'Periode akuntansi sampai % sudah ditutup; pembatalan penerimaan hari ini", 0),
        ('M24 receive: closed period check ignores the effective date', " if closed is not null and edate<=closed then\n  if edate=today then raise exception 'Periode akuntansi sampai % sudah ditutup; penerimaan hari ini", " if closed is not null and today<=closed then\n  if edate=today then raise exception 'Periode akuntansi sampai % sudah ditutup; penerimaan hari ini", 0),
        ('M25 online: closed period check ignores the effective date', " if closed is not null and edate<=closed then\n  if edate=today then raise exception 'Periode akuntansi sampai % sudah ditutup; pembatalan hari ini", " if closed is not null and today<=closed then\n  if edate=today then raise exception 'Periode akuntansi sampai % sudah ditutup; pembatalan hari ini", 0),
        ('M26 cancel: period closed up to exactly the date is allowed (off-by-one <)', " if closed is not null and edate<=closed then\n  if edate=today then raise exception 'Periode akuntansi sampai % sudah ditutup; pembatalan penerimaan hari ini", " if closed is not null and edate<closed then\n  if edate=today then raise exception 'Periode akuntansi sampai % sudah ditutup; pembatalan penerimaan hari ini", 0),
        ('M27 cancel: legacy today-message replaced (old-form message changed)', "  if edate=today then raise exception 'Periode akuntansi sampai % sudah ditutup; pembatalan penerimaan hari ini tidak bisa dibukukan.',closed; end if;\n", "", 0),
        ('M28 cancel: bank reconciliation fence uses today', "where r.voided_at is null and r.tanggal>=edate and (c.id is null or c.code=any(codes))) then", "where r.voided_at is null and r.tanggal>=today and (c.id is null or c.code=any(codes))) then", 0),
        ('M29 receive: bank reconciliation fence uses today', "where rc.voided_at is null and rc.tanggal>=edate and (cc.id is null or cc.code=any(codes))) then", "where rc.voided_at is null and rc.tanggal>=today and (cc.id is null or cc.code=any(codes))) then", 0),
        ('M30 receive: reason not required for a backdated receive', "or (edate<today and length(coalesce(rreason,'')) < 3) then", "then", 0),
        ('M31 cancel: effective date missing from the idempotency payload', "reason)\n  ||case when p_effective_date is not null then jsonb_build_object('effective_date',p_effective_date) else '{}'::jsonb end;\n perform pg_advisory_xact_lock(hashtextextended('vetos:receipt-cancel:'||actor::text||':'||p_request_key,0));\n select * into prior from public.receipt_cancel_requests where actor_id=actor and request_key=p_request_key;\n if found then\n  if prior.payload is distinct from payload then raise exception 'Kunci permintaan sudah dipakai untuk isian berbeda. Muat ulang halaman.'; end if;\n  return prior.result;\n end if;\n if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang halaman sebelum membatalkan penerimaan.'", "reason);\n perform pg_advisory_xact_lock(hashtextextended('vetos:receipt-cancel:'||actor::text||':'||p_request_key,0));\n select * into prior from public.receipt_cancel_requests where actor_id=actor and request_key=p_request_key;\n if found then\n  if prior.payload is distinct from payload then raise exception 'Kunci permintaan sudah dipakai untuk isian berbeda. Muat ulang halaman.'; end if;\n  return prior.result;\n end if;\n if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang halaman sebelum membatalkan penerimaan.'", 0),
        ('M32 receive: reason missing from the idempotency payload', "jsonb_build_object('effective_date',p_effective_date,'reason',rreason)", "jsonb_build_object('effective_date',p_effective_date)", 0),
        ('M33 cancel: effective date not recorded in the audit row', "created_by,shift_mode,effective_date)\n  values(audit,s.id,s.branch_id,reason,to_jsonb(s),before_payments,jid,s.shift_id,src_status,eff,actor,shift_mode,edate);", "created_by,shift_mode,effective_date)\n  values(audit,s.id,s.branch_id,reason,to_jsonb(s),before_payments,jid,s.shift_id,src_status,eff,actor,shift_mode,null);", 0),
        ('M34 receive: receive date/reason not recorded in the audit row', "receive_effective_date=edate,receive_reason=rreason where id=c.id;", "receive_effective_date=null,receive_reason=null where id=c.id;", 0),
        ('M35 online: effective date not recorded', "amount_fee,created_by,effective_date)\n  values(audit,s.id,s.branch_id,reason,to_jsonb(s),dj.id,jid,bank_code,bank_amount,fee,actor,edate);", "amount_fee,created_by,effective_date)\n  values(audit,s.id,s.branch_id,reason,to_jsonb(s),dj.id,jid,bank_code,bank_amount,fee,actor,null);", 0),
        ('M36 old-form cancel wrapper books yesterday instead of today', "return public.cancel_pos_sale_receipt(p_sale_id,p_expected_revision,p_request_key,p_reason,null::date);", "return public.cancel_pos_sale_receipt(p_sale_id,p_expected_revision,p_request_key,p_reason,((now() at time zone 'Asia/Jakarta')::date-1));", 0),
        ('M37 old-form receive wrapper books yesterday', "return public.receive_pos_sale_payment(p_sale_id,p_expected_revision,p_request_key,p_plan,null::date,null::text);", "return public.receive_pos_sale_payment(p_sale_id,p_expected_revision,p_request_key,p_plan,((now() at time zone 'Asia/Jakarta')::date-1),'x y z');", 0),
        ('M38 history guard: closing columns for the new fields not exempted', "'receive_effect_shift_id','receive_effective_date','receive_reason'])\n   is not distinct from", "'receive_effect_shift_id'])\n   is not distinct from", 0),
        ('M39 constraint: re-receive date may precede the cancellation', "and receive_effective_date >= coalesce(effective_date, (created_at at time zone 'Asia/Jakarta')::date))),", ")),", 0),
        ('M40 bounds: closed period ignored in effective_min', "'effective_min',greatest(fl,coalesce(closed+1,fl))", "'effective_min',fl", 0),
        ('M41 bounds: can_backdate always true', "'can_backdate',public.pos_receipt_backdate_allowed(s.branch_id))", "'can_backdate',true)", 0),
        ('M42 bounds: online floor ignores the disbursement journal date', "fl:=greatest((s.created_at at time zone 'Asia/Jakarta')::date,coalesce(dd,date '1900-01-01'));", "fl:=(s.created_at at time zone 'Asia/Jakarta')::date;", 0),
        ('M44 online: bank reconciliation fence uses today', "where r.voided_at is null and r.tanggal>=edate and (c.id is null or c.code=bank_code)) then", "where r.voided_at is null and r.tanggal>=today and (c.id is null or c.code=bank_code)) then", 0),
        ('M45 floor: sale journal date ignored (only the sale date)', "(e.source='sale' and e.source_ref=s.no_struk)\n     or (e.source='sale-receipt-repost'", "(false)\n     or (e.source='sale-receipt-repost'", 0),
        ('M46 bounds: receive uses the cancel floor (open cancellation date ignored)', "fl:=public.pos_receipt_date_floor(s.id,p_op);", "fl:=public.pos_receipt_date_floor(s.id,'cancel');", 0),
        ('M47 backdate_allowed: Owner check requires an active policy row (Owner locked when policy table empty)', " if v_role='OWNER' then return true; end if;\n begin\n  if v_role not in('ADMIN','FINANCE')", " if v_role='OWNER' and exists(select 1 from role_settings_private.action_policies where false) then return true; end if;\n begin\n  if v_role not in('ADMIN','FINANCE')", 0),
        ('M48 receive: reason length cap removed (1000)', "if length(coalesce(rreason,'')) > 1000 or (edate<today", "if (edate<today", 0),
        ('M43 cancel: audit description loses the effective date mark (no functional effect: equivalent control)', "||case when edate<today then ' [tanggal efektif '||to_char(edate,'DD/MM/YYYY')||']' else '' end,lines);\n select id into strict jid from public.journal_entries where source='sale-receipt-cancel'", ",lines);\n select id into strict jid from public.journal_entries where source='sale-receipt-cancel'", 0),
    ]


def run_mutations(db, a):
    fresh(db)
    base = (MIGRATIONS / CAND).read_text()
    clone(db, 'ctl'); apply(db, 'ctl', base, later=False)
    ok, passes, why = run_suite(db, 'ctl', SUITE)
    check('CONTROL: unmutated candidate passes the suite (%d assertions)' % len(passes), ok, why)
    want = len(passes)
    only = os.environ.get('BP_ONLY')
    for name, old, new, nth in mutants():
        if only and not name.startswith(only): continue
        n = base.count(old)
        if (nth == 0 and n != 1) or (nth > 0 and n < nth):
            check('MUTANT ' + name + ' (anchor found as expected)', False, 'anchor count %d' % n); continue
        if nth == 0:
            mutated = base.replace(old, new)
        else:
            i = -1
            for _ in range(nth): i = base.index(old, i + 1)
            mutated = base[:i] + new + base[i + len(old):]
        clone(db, 'mut')
        try:
            apply(db, 'mut', mutated, later=False)
        except RuntimeError as e:
            check('MUTANT ' + name + ' -> killed (does not even apply: %s)' % str(e)[:80].replace('\n', ' '), True); continue
        ok, passes, why = run_suite(db, 'mut', SUITE)
        killed = (not ok) or len(passes) < want
        # M43 is an intentionally equivalent control: the audit text carries no accounting effect
        if name.startswith('M43'):
            check('CONTROL-EQUIVALENT ' + name + ' -> %s' % ('suite unchanged (as expected for a text-only change)' if ok and len(passes) == want else 'unexpectedly changed'), ok and len(passes) == want, why)
        else:
            check('MUTANT ' + name + ' -> %s' % ('KILLED: ' + why[:90] if not ok else 'SURVIVED (suite still green, %d)' % len(passes)), killed, why)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--smoke', action='store_true')
    a = ap.parse_args()
    fn = run_baseline if a.baseline else run_smoke if a.smoke else run_green
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
