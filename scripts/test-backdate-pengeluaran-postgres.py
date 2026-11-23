#!/usr/bin/env python3
"""Pengeluaran bertanggal mundur (migrasi *_backdate_pengeluaran.sql). Native throwaway PostgreSQL only; never accepts a database URL.

  python3 -I scripts/test-backdate-pengeluaran-postgres.py --pg-bin DIR [--json out.json] [--baseline | --mutations | --diff]
  (default)   chain + candidate: SQL suite supabase/tests/backdate_pengeluaran.sql (>= 80 assertions) + second application fails closed.
  --baseline  chain WITHOUT the candidate: the suite must fail with 0 passes AND the two real holes must be OPEN (a cashier can insert an expense
              dated 2 days ago directly; post_expense_atomic accepts a past date with no reason, no limit and no trace) -- recorded as evidence.
  --diff      differential: 100 pseudo-random same-day expenses (valid + invalid, all roles/contexts, replays) run on the chain WITHOUT and WITH the
              candidate must give identical per-call outcomes, expense rows, journals and request payloads.
  --mutations every mutant of the candidate in a cloned database must be killed by the suite.
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse, importlib.util, json, os, re, sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bpbase', ROOT / 'scripts/test-batalkan-penerimaan-petshop-postgres.py')
bp = importlib.util.module_from_spec(spec); sys.modules['bpbase'] = bp; spec.loader.exec_module(bp)
CAND = sorted(p.name for p in (ROOT / 'supabase/migrations').glob('*_backdate_pengeluaran.sql'))[0]
bp.CAND = CAND
MIGRATIONS, TESTS = bp.MIGRATIONS, bp.TESTS
SUITE = 'backdate_pengeluaran.sql'
check, raw, clone, run_suite, build_chain, apply = bp.check, bp.raw, bp.clone, bp.run_suite, bp.build_chain, bp.apply
NativePostgres, RESULTS = bp.NativePostgres, bp.RESULTS


# Hosted Supabase gives every new public function/table EXECUTE/ALL to anon, authenticated and service_role by default privileges; the bare native chain does not.
# Model the hosted behaviour in each clone BEFORE the candidate is applied, otherwise a missing REVOKE in the migration would be invisible (equivalent mutant).
PRELUDE = ("alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;\n"
           "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;\n")


def fresh(db):
    build_chain(db, {CAND})
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')


def run_green(db, a):
    fresh(db)
    clone(db, 'cand'); apply(db, 'cand', PRELUDE + (MIGRATIONS / CAND).read_text())
    ok, passes, why = run_suite(db, 'cand', SUITE)
    check('GREEN suite on the candidate (%d assertions)' % len(passes), ok and len(passes) >= 80, why)
    try:
        apply(db, 'cand', (MIGRATIONS / CAND).read_text(), later=False); twice = False
    except RuntimeError:
        twice = True
    check('second application of the migration fails closed (no silent re-apply)', twice)


HOLE_FIX = r"""
begin;
insert into auth.users(id,raw_user_meta_data) values('ed100000-0000-4000-8000-0000000000f1','{"full_name":"hole cashier"}');
update profiles set role='STAFF',is_active=true where id='ed100000-0000-4000-8000-0000000000f1';
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values('ed200000-0000-4000-8000-0000000000f1','HOLE','Hole','PETSHOP');
insert into user_branches(user_id,branch_id) values('ed100000-0000-4000-8000-0000000000f1','ed200000-0000-4000-8000-0000000000f1');
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values('ed600000-0000-4000-8000-0000000000f1','ed200000-0000-4000-8000-0000000000f1','ed100000-0000-4000-8000-0000000000f1','petshop');
update accounting_locks set closed_until=null;
set local role authenticated;
select set_config('request.jwt.claim.sub','ed100000-0000-4000-8000-0000000000f1',true);select set_config('request.jwt.claims','{"role":"authenticated"}',true);
%s
reset role;
rollback;
"""


def run_baseline(db, a):
    fresh(db)
    clone(db, 'base')
    ok, passes, why = run_suite(db, 'base', SUITE)
    check('RED baseline: suite fails without the candidate (passes before failure: %d)' % len(passes), (not ok) and len(passes) == 0, why)
    sql = HOLE_FIX % """insert into expenses(branch_id,tanggal,kategori,jumlah,metode_bayar,created_by) values('ed200000-0000-4000-8000-0000000000f1',current_date-2,'Operasional',99000,'Tunai',auth.uid());
select 'HOLE_DIRECT_INSERT_OPEN';"""
    rc, out, err = raw(db, sql, 'base')
    check('BASELINE hole 1: without the candidate a plain cashier role can INSERT an expense dated 2 days ago straight into the table (what the gate closes)', rc == 0 and 'HOLE_DIRECT_INSERT_OPEN' in out, (err or out)[:300])
    sql = HOLE_FIX % """select public.post_expense_atomic('hole-1','cashier',null,jsonb_build_object('tanggal',((now() at time zone 'Asia/Jakarta')::date-90)::text,'kategori','Operasional','jumlah',1000,'metode_bayar','Tunai'),
 '[{"path":"pengeluaran/h.jpg","nama":"h.jpg","mime":"image/jpeg","ukuran":100}]'::jsonb);
select 'HOLE_NO_REASON_NO_LIMIT_OPEN';"""
    rc, out, err = raw(db, sql, 'base')
    check('BASELINE hole 2: without the candidate post_expense_atomic accepts a date 90 days back with no reason and leaves no trace (what the candidate bounds)', rc == 0 and 'HOLE_NO_REASON_NO_LIMIT_OPEN' in out, (err or out)[:300])


# ----------------------------------------------------------------------------------------------- differential
DIFF_BLOCK = r"""
create temp table dres(i int,outcome text);grant all on dres to public;
do $d$
declare i int; p int; ctx text; br uuid; u text; k text; prevk text; prevamt numeric; amt numeric; kat text; met text; d text; att jsonb; acct text; r jsonb; ex jsonb;
 kats text[]:=array['Operasional','Listrik & Air','Perlengkapan','Transportasi','Perawatan','Perawatan Aset','Sewa Gedung','Lain-lain','Salah'];
 mets text[]:=array['Tunai','QRIS','Transfer','Debit','Kredit','E-Wallet','Cek'];
 users text[]:=array['ed100000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000002','ed100000-0000-4000-8000-000000000003','ed100000-0000-4000-8000-000000000004','ed100000-0000-4000-8000-000000000005'];
 today date:=(now() at time zone 'Asia/Jakarta')::date;
begin
 perform setseed(0.37);
 for i in 1..100 loop
  p:=floor(random()*5)::int+1; u:=users[p];
  ctx:=case when p<=3 then 'backoffice' when p=4 then 'cashier' else 'clinic' end;
  br:=case when p<=3 then (case when random()<0.5 then 'ed200000-0000-4000-8000-000000000001' else 'ed200000-0000-4000-8000-000000000002' end)::uuid else null end;
  k:='diff-'||i; prevamt:=amt;
  amt:=case when random()<0.06 then 0 when random()<0.05 then -5 when random()<0.04 then 12.345 else round((random()*900000+500)::numeric,2) end;
  kat:=kats[floor(random()*9)::int+1]; met:=mets[floor(random()*7)::int+1];
  d:=case when random()<0.9 then today::text when random()<0.5 then (today+1)::text else null end;
  att:=case when random()<0.93 then '[{"path":"pengeluaran/diff.jpg","nama":"diff.jpg","mime":"image/jpeg","ukuran":100}]'::jsonb else '[]'::jsonb end;
  acct:=case when ctx='backoffice' and random()<0.3 then (case when random()<0.7 then 'ed500000-0000-4000-8000-000000000002' else 'ed500000-0000-4000-8000-000000000001' end) else null end;
  if random()<0.07 then ctx:='backoffice'; br:='ed200000-0000-4000-8000-000000000001'; u:=users[4]; end if;   -- kasir biasa lewat back office: ditolak
  if ctx<>'backoffice' and random()<0.07 then acct:='ed500000-0000-4000-8000-000000000002'; end if;     -- kasir memilih rekening: ditolak
  if ctx='backoffice' and random()<0.07 then acct:=gen_random_uuid()::text; end if;                     -- rekening tidak ada: ditolak
  if i>1 and random()<0.1 then k:=prevk; if random()<0.5 then amt:=coalesce(prevamt,amt); end if; end if;
  ex:=jsonb_strip_nulls(jsonb_build_object('tanggal',d,'kategori',kat,'jumlah',amt,'metode_bayar',met,'deskripsi','DIFF '||i,'account_id',acct));
  prevk:=k;
  perform set_config('role','authenticated',true); perform pg_temp.as_(u);
  begin
   r:=public.post_expense_atomic(k,ctx,br,ex,att);
   insert into dres values(i,'OK');
  exception when others then insert into dres values(i,'ERR '||sqlerrm);
  end;
  perform set_config('role','none',true);
 end loop;
end $d$;
select 'DIFF O '||i||' '||outcome from dres order by i;
select 'DIFF E '||md5(row(b.code,e.tanggal,e.kategori,e.deskripsi,e.jumlah,e.metode_bayar,e.bukti_url is not null,e.shift_id is not null,e.revision,e.voided_at is not null,e.created_by,e.journal_entry_id is not null)::text)||' '||e.deskripsi
 from expenses e join branches b on b.id=e.branch_id where e.deskripsi like 'DIFF %' order by e.deskripsi;
select 'DIFF J '||md5(row(j.tanggal,j.source,j.deskripsi,b.code)::text||(select string_agg(a.code||':'||l.debit||':'||l.credit,'|' order by a.code,l.debit,l.credit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=j.id))
 from journal_entries j join branches b on b.id=j.branch_id where j.source='expense' and j.deskripsi like '%DIFF %' order by j.deskripsi;
select 'DIFF Q '||q.actor_id||' '||q.request_key||' '||q.kind||' '||md5(q.payload::text)||' '||(q.result is not null) from expense_posting_requests q where q.request_key like 'diff-%' order by q.actor_id,q.request_key;
select 'DIFF A '||count(*) from document_attachments where modul='pengeluaran' and uploaded_by::text like 'ed100000%';
select 'DIFF B '||count(*) from expense_backdates;
"""


def diff_sql():
    suite = (TESTS / SUITE).read_text()
    i = suite.index('-- ── 0. objek baru')
    pre = '\n'.join(l for l in suite[:i].splitlines() if not l.startswith(('create function pg_temp.nback', 'create function pg_temp.audit')))  # these reference the new table
    return pre + DIFF_BLOCK + '\nrollback;\n'


def diff_lines(db, name, text):
    rc, out, err = raw(db, text, name)
    lines = [l for l in (out + '\n' + err).splitlines() if 'DIFF ' in l]
    lines = [re.sub(r'^.*?(DIFF )', r'\1', l) for l in lines]
    return rc, lines, err


def run_diff(db, a):
    fresh(db)
    clone(db, 'old'); clone(db, 'new'); apply(db, 'new', PRELUDE + (MIGRATIONS / CAND).read_text())
    text = diff_sql()
    rc_o, old, err_o = diff_lines(db, 'old', text.replace('select \'DIFF B \'||count(*) from expense_backdates;', "select 'DIFF B 0';"))
    rc_n, new, err_n = diff_lines(db, 'new', text)
    old = [l for l in old if not l.startswith('DIFF B ')]; new = [l for l in new if not l.startswith('DIFF B ')]
    outcomes = [l for l in new if l.startswith('DIFF O ')]
    n_ok = sum(1 for l in outcomes if l.endswith(' OK'))
    check('DIFF both runs completed (rc old=%s new=%s)' % (rc_o, rc_n), rc_o == 0 and rc_n == 0, (err_o + err_n)[-300:])
    check('DIFF 100 calls on each side (%d outcomes; %d accepted, %d refused)' % (len(outcomes), n_ok, len(outcomes) - n_ok), len(outcomes) == 100 and 40 <= n_ok <= 95, '')
    same = old == new
    first = next(((x, y) for x, y in zip(old, new) if x != y), None)
    check('DIFF per-call outcomes, expense rows, journals, request payloads, attachments IDENTICAL old vs new (%d comparison lines)' % len(new), same and len(new) > 150, str(first) + ' lens %d/%d' % (len(old), len(new)))
    msgs = {re.sub(r'^DIFF O \d+ ', '', l) for l in outcomes if not l.endswith(' OK')}
    check('DIFF the refused calls cover several distinct refusal messages (%d)' % len(msgs), len(msgs) >= 5, '; '.join(sorted(msgs))[:300])
    nb = raw(db, "select count(*) from expense_backdates", 'new')[1].strip()
    check('DIFF no audit row was written by any same-day expense (expense_backdates empty on the new side)', nb == '0', nb)


def mutants():
    return [
        ('M01 precheck: today counts as backdated', "if p_date>=today then return null;end if;", "if p_date>today then return null;end if;"),
        ('M02 precheck: reason not required', "if length(v_reason) not between 3 and 200 then\n  raise exception 'Tanggal mundur: alasan wajib", "if false then\n  raise exception 'Tanggal mundur: alasan wajib"),
        ('M03 precheck: reason minimum 2', "if length(v_reason) not between 3 and 200 then", "if length(v_reason) not between 2 and 200 then"),
        ('M04 precheck: reason maximum 201', "if length(v_reason) not between 3 and 200 then", "if length(v_reason) not between 3 and 201 then"),
        ('M05 precheck: 32 days back allowed', "if today-p_date>31 then", "if today-p_date>32 then"),
        ('M06 precheck: no day limit', "if today-p_date>31 then\n  raise exception 'Tanggal mundur: paling lama", "if false then\n  raise exception 'Tanggal mundur: paling lama"),
        ('M07 precheck: reason not trimmed', "v_reason text:=btrim(coalesce(p_reason,''));", "v_reason text:=coalesce(p_reason,'');"),
        ('M08 patch: precheck call removed from post_expense_atomic', "perform public.expense_backdate_precheck(d,p_expense->>'alasan_tanggal');", "null;"),
        ('M09 patch: bank check call removed from post_expense_atomic', "perform public.expense_backdate_bank_check(d,cash_code);", "null;"),
        ('M10 bank: fence uses today instead of the date', "where r.voided_at is null and r.tanggal>=p_date and", "where r.voided_at is null and r.tanggal>=today and"),
        ('M11 bank: voided reconciliations also lock', "where r.voided_at is null and r.tanggal>=p_date", "where r.tanggal>=p_date"),
        ('M12 bank: unknown reconciliation account fails open', "(c.id is null or c.code=p_cash_code)", "(c.code=p_cash_code)"),
        ('M13 bank: every account is locked (not only the one used)', "(c.id is null or c.code=p_cash_code)", "(c.id is null or true)"),
        ('M14 bank: same-day expenses are checked too', " if p_date>=today then return;end if;\n if exists(select 1 from public.bank_reconciliations", " if p_date>today then return;end if;\n if exists(select 1 from public.bank_reconciliations"),
        ('M15 patch: audit row never written', "if d<(now() at time zone 'Asia/Jakarta')::date then\n   insert into public.expense_backdates", "if false then\n   insert into public.expense_backdates"),
        ('M16 patch: audit written for same-day expenses too', "if d<(now() at time zone 'Asia/Jakarta')::date then\n   insert into public.expense_backdates", "if true then\n   insert into public.expense_backdates"),
        ('M17 patch: audit stores a constant reason', "p_request_key,d,btrim(p_expense->>'alasan_tanggal'),case when", "p_request_key,d,'alasan tetap',case when"),
        ('M18 patch: audit stores the wrong actor', "values(doc,auth.uid(),branch,p_context,p_request_key,d,", "values(doc,(select id from public.profiles where role='OWNER' order by created_at limit 1),branch,p_context,p_request_key,d,"),
        ('M19 patch: audit stores the wrong effective date', "values(doc,auth.uid(),branch,p_context,p_request_key,d,btrim(", "values(doc,auth.uid(),branch,p_context,p_request_key,least(d+1,(now() at time zone 'Asia/Jakarta')::date-1),btrim("),
        ('M20 patch: audit does not record the shift', "then shift.id else null end,category,amount);", "then null::uuid else null end,category,amount);"),
        ('M21 guard: audit rows deletable/editable by anyone', "raise exception 'Jejak tanggal mundur pengeluaran tidak dapat diubah atau dihapus';\nend $$;", "return old;\nend $$;"),
        ('M22 guard: TRUNCATE trigger missing', "create trigger expense_backdates_guard_truncate before truncate on public.expense_backdates for each statement execute function public.guard_expense_backdates();", "select 1;"),
        ('M23 gate: authenticated role not gated', "if current_user not in ('authenticated','anon') then return new;end if;", "if true then return new;end if;"),
        ('M24 gate: INSERT with any date allowed', "if new.tanggal is distinct from (now() at time zone 'Asia/Jakarta')::date then", "if false then"),
        ('M25 gate: only past dates refused (future allowed)', "if new.tanggal is distinct from (now() at time zone 'Asia/Jakarta')::date then", "if new.tanggal<(now() at time zone 'Asia/Jakarta')::date then"),
        ('M26 gate: UPDATE of tanggal not refused', " if tg_op='UPDATE' then\n  if new.tanggal is not distinct", " if false then\n  if new.tanggal is not distinct"),
        ('M27 gate: trigger fires on INSERT only', "before insert or update of tanggal on public.expenses", "before insert on public.expenses"),
        ('M28 gate: function is SECURITY DEFINER (sees the owner, not the caller)', "create function public.expense_date_gate() returns trigger language plpgsql set search_path='' as $$", "create function public.expense_date_gate() returns trigger language plpgsql security definer set search_path='' as $$"),
        ('M29 table: any user reads every audit row', "using (public.user_can_access_branch(branch_id)\n  and (actor_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in ('OWNER','ADMIN','FINANCE'))));", "using (true);"),
        ('M30 table: clients may write the audit table', "grant select on public.expense_backdates to authenticated;", "grant select,insert,update,delete on public.expense_backdates to authenticated;"),
        ('M31 ACL: precheck executable by clients', "revoke all on function public.expense_backdate_precheck(date,text) from public,anon,authenticated,service_role;", "revoke all on function public.expense_backdate_precheck(date,text) from public,anon,service_role;"),
        ('M32 ACL: gate function executable by anon', "revoke all on function public.expense_date_gate() from public,anon,authenticated,service_role;", "revoke all on function public.expense_date_gate() from public,authenticated,service_role;"),
        ('M33 ACL: post_expense_atomic also granted to anon', "grant execute on function public.post_expense_atomic(text,text,uuid,jsonb,jsonb) to authenticated;", "grant execute on function public.post_expense_atomic(text,text,uuid,jsonb,jsonb) to authenticated,anon;"),
        ('M34 search_path: precheck without fixed search_path', "create function public.expense_backdate_precheck(p_date date, p_reason text) returns text language plpgsql stable set search_path='' as $$", "create function public.expense_backdate_precheck(p_date date, p_reason text) returns text language plpgsql stable as $$"),
        ('M35 Admin Online: fence_all call removed', "select admin_online_private.fence_all();", "select 1;"),
        ('M36 table: date CHECK removed', " constraint expense_backdates_date_check check(effective_date<(recorded_at at time zone 'Asia/Jakarta')::date\n   and effective_date>=(recorded_at at time zone 'Asia/Jakarta')::date-31)", " constraint expense_backdates_date_check check(true)"),
        ('M37 table: (actor, request key) not unique', " unique(actor_id,request_key),\n", ""),
        ('M38 table: expense_id not unique', " expense_id uuid not null unique,", " expense_id uuid not null,"),
        ('M39 table: RLS disabled', "alter table public.expense_backdates enable row level security;", "alter table public.expense_backdates disable row level security;"),
    ]


def run_mutations(db, a):
    fresh(db)
    base = (MIGRATIONS / CAND).read_text()
    clone(db, 'ctl'); apply(db, 'ctl', PRELUDE + base, later=False)
    ok, passes, why = run_suite(db, 'ctl', SUITE)
    check('CONTROL: unmutated candidate passes the suite (%d assertions)' % len(passes), ok, why)
    want = len(passes)
    only = os.environ.get('BP_ONLY')
    killed_n = total = 0
    for name, old, new in mutants():
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
    RESULTS.append(dict(case='MUTANT TOTAL killed %d of %d' % (killed_n, total), status='PASS' if killed_n == total and (total >= 25 or only) else 'FAIL', detail=''))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--diff', action='store_true')
    a = ap.parse_args()
    fn = run_baseline if a.baseline else run_green
    if a.mutations: fn = run_mutations
    if a.diff: fn = run_diff
    with NativePostgres(a.pg_bin) as db:
        fn(db, a)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(mode=fn.__name__, results=RESULTS), indent=1))
    fails = [r for r in RESULTS if r['status'] == 'FAIL']
    print('SUMMARY mode=%s pass=%d fail=%d' % (fn.__name__, len(RESULTS) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
