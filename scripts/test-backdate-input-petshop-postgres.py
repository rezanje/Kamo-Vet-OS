#!/usr/bin/env python3
"""Input penjualan PETSHOP bertanggal mundur (migrasi *_backdate_input_petshop.sql). Native throwaway PostgreSQL only; never accepts a database URL.

  python3 -I scripts/test-backdate-input-petshop-postgres.py --pg-bin DIR [--json out.json] [--baseline | --mutations]
  (default)   chain + candidate: SQL suite supabase/tests/backdate_input_petshop.sql.
  --baseline  chain WITHOUT the candidate: the suite must fail at its first assertion (objects absent) AND the real scenario (a sale of yesterday inserted by
              a client role) must NOT be refused today (shows the hole the gate closes) -- recorded as evidence.
  --mutations every mutant of the candidate in a cloned database must be killed by the suite.
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse, importlib.util, json, os, sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bpbase', ROOT / 'scripts/test-batalkan-penerimaan-petshop-postgres.py')
bp = importlib.util.module_from_spec(spec); sys.modules['bpbase'] = bp; spec.loader.exec_module(bp)
CAND = sorted(p.name for p in (ROOT / 'supabase/migrations').glob('*_backdate_input_petshop.sql'))[0]
bp.CAND = CAND
MIGRATIONS, TESTS = bp.MIGRATIONS, bp.TESTS
SUITE = 'backdate_input_petshop.sql'
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
    check('GREEN suite on the candidate (%d assertions)' % len(passes), ok and len(passes) >= 80, why)
    # idempotent object identity: the same migration cannot be applied twice (fails closed)
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
    # The real hole today: a client role may insert a sale dated in the past with no permission, no reason, no trace.
    sql = r"""
begin;
insert into auth.users(id,raw_user_meta_data) values('bd100000-0000-4000-8000-0000000000f1','{"full_name":"hole cashier"}');
update profiles set role='STAFF',is_active=true where id='bd100000-0000-4000-8000-0000000000f1';
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values('bd200000-0000-4000-8000-0000000000f1','HOLE','Hole','PETSHOP');
insert into user_branches(user_id,branch_id) values('bd100000-0000-4000-8000-0000000000f1','bd200000-0000-4000-8000-0000000000f1');
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values('bd600000-0000-4000-8000-0000000000f1','bd200000-0000-4000-8000-0000000000f1','bd100000-0000-4000-8000-0000000000f1','petshop');
insert into coa_accounts(code,name,type,normal_balance,is_header) values('1111','k','ASET','D',false),('510001','p','PENDAPATAN','K',false),('520002','d','PENDAPATAN','D',false),('312005','v','LIABILITAS','K',false),('600001','h','BEBAN','D',false),('170001','s','ASET','D',false) on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values('bd500000-0000-4000-8000-0000000000f1','kas','Kas','1111');
insert into payment_account_map(metode,branch_id,cash_account_id) values('Tunai','bd200000-0000-4000-8000-0000000000f1','bd500000-0000-4000-8000-0000000000f1') on conflict do nothing;
update accounting_locks set closed_until=null;
set local role authenticated;
select set_config('request.jwt.claim.sub','bd100000-0000-4000-8000-0000000000f1',true);select set_config('request.jwt.claims','{"role":"authenticated"}',true);
insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
 values('bd200000-0000-4000-8000-0000000000f1','HOLE.1',100,0,100,'Tunai',100,0,0,'bd100000-0000-4000-8000-0000000000f1','bd600000-0000-4000-8000-0000000000f1','[{"method":"Tunai","amount":100}]','k:hole',repeat('a',64),now()-interval '2 days');
reset role;
select 'HOLE_OPEN';
rollback;
"""
    rc, out, err = raw(db, sql, 'base')
    check('BASELINE hole: without the candidate a plain cashier role can insert a sale dated 2 days ago (what the gate closes)', rc == 0 and 'HOLE_OPEN' in out, (err or out)[:300])


def mutants():
    G = "pos_sale_backdate_gate_check"
    return [
        ('M01 gate: past-dated INSERT by client roles not gated', "and (new.created_at at time zone 'Asia/Jakarta')::date is distinct from (now() at time zone 'Asia/Jakarta')::date then\n  perform public.pos_sale_backdate_gate_check", "and false then\n  perform public.pos_sale_backdate_gate_check", 0),
        ('M02 gate: authenticated role skipped', "current_user in('authenticated','anon')", "current_user in('anon')", 0),
        ('M03 gate: time of day free (stamp not enforced)', "or p_created is distinct from public.pos_sale_backdate_stamp(d) or g.authorized_at", "or g.authorized_at", 0),
        ('M04 gate: authorization never expires', "or g.authorized_at<now()-interval '15 minutes' then", "then", 0),
        ('M05 gate: branch of the authorization ignored', "if not found or g.branch_id is distinct from p_branch or g.effective_date", "if not found or g.effective_date", 0),
        ('M06 gate: date of the authorization ignored', "or g.effective_date is distinct from d\n  or p_created", "\n  or p_created", 0),
        ('M07 gate: permission not re-checked at INSERT', "if not public.pos_sale_backdate_allowed(p_branch) then\n  raise exception 'Anda tidak punya izin mencatat penjualan di tanggal sebelum hari ini.'", "if false then\n  raise exception 'Anda tidak punya izin mencatat penjualan di tanggal sebelum hari ini.'", 0),
        ('M08 gate: date rules (period/payroll/bank) not re-checked at INSERT', "msg:=public.pos_sale_backdate_check(p_branch,d,p_plan);\n if msg is not null then raise exception '%',msg using errcode='22023';end if;\n if p_voucher", "if p_voucher", 0),
        ('M09 gate: voucher/campaign/points allowed in the header', "if p_voucher is not null or p_campaign is not null or coalesce(p_earned,0)>0 or coalesce(p_used,0)>0 then", "if false then", 0),
        ('M10 gate: cashier identity not compared', "or p_cashier is distinct from auth.uid() then\n  raise exception 'Tanggal struk mundur tidak diizinkan.'", "then\n  raise exception 'Tanggal struk mundur tidak diizinkan.'", 0),
        ('M11 gate: future date allowed', "if d>today then raise exception 'Tanggal struk tidak boleh di masa depan'", "if false then raise exception 'Tanggal struk tidak boleh di masa depan'", 0),
        ('M12 allowed: OWNER no longer short-circuits', " if v_role='OWNER' then return true; end if;\n begin\n  if v_role not in('ADMIN','FINANCE')", " begin\n  if v_role not in('ADMIN','FINANCE')", 0),
        ('M13 allowed: Owner-ticked policy row not required', "   and exists(select 1 from role_settings_private.action_policies a where a.role=v_role and 'penjualan.pos_penjualan.tanggal_mundur'=any(a.allowed));", ";", 0),
        ('M14 allowed: any role may pass (STAFF)', "  if v_role not in('ADMIN','FINANCE') or not public.user_can_access_branch(p_branch) then return false; end if;\n  return coalesce(public.role_action_allowed('penjualan.pos_penjualan.tanggal_mundur'),false)", "  if not public.user_can_access_branch(p_branch) then return false; end if;\n  return coalesce(public.role_action_allowed('penjualan.pos_penjualan.tanggal_mundur'),false)", 0),
        ('M15 allowed: branch scope ignored', "  if v_role not in('ADMIN','FINANCE') or not public.user_can_access_branch(p_branch) then return false; end if;\n  return coalesce(public.role_action_allowed('penjualan.pos_penjualan.tanggal_mundur'),false)", "  if v_role not in('ADMIN','FINANCE') then return false; end if;\n  return coalesce(public.role_action_allowed('penjualan.pos_penjualan.tanggal_mundur'),false)", 0),
        ('M16 allowed: the OLD batal-penerimaan permission also grants sales input', "coalesce(public.role_action_allowed('penjualan.pos_penjualan.tanggal_mundur'),false)\n   and exists(select 1 from role_settings_private.action_policies a where a.role=v_role and 'penjualan.pos_penjualan.tanggal_mundur'=any(a.allowed))", "coalesce(public.role_action_allowed('penjualan.pos_penerimaan.tanggal_mundur'),false)\n   and exists(select 1 from role_settings_private.action_policies a where a.role=v_role and 'penjualan.pos_penerimaan.tanggal_mundur'=any(a.allowed))", 0),
        ('M17 allowed: policy read error fails OPEN', " exception when others then return false;\n end;\nend $$;\nrevoke all on function public.pos_sale_backdate_allowed", " exception when others then return true;\n end;\nend $$;\nrevoke all on function public.pos_sale_backdate_allowed", 0),
        ('M18 check: today counts as backdated', "if p_date>=today then return", "if p_date>today then return", 0),
        ('M19 check: 32 days back allowed', "if today-p_date>31 then", "if today-p_date>32 then", 0),
        ('M20 check: closed period ignored', "if closed is not null and p_date<=closed then", "if false then", 0),
        ('M21 check: period closed exactly at the date allowed (off-by-one)', "if closed is not null and p_date<=closed then", "if closed is not null and p_date<closed then", 0),
        ('M22 check: paid payroll month ignored', "if exists(select 1 from public.payrolls where periode=to_char(p_date,'YYYY-MM')) then", "if false then", 0),
        ('M23 check: bank reconciliation fence ignored', "if p_plan is not null then\n  select array_agg", "if false then\n  select array_agg", 0),
        ('M24 check: bank fence uses today', "where r.voided_at is null and r.tanggal>=p_date and", "where r.voided_at is null and r.tanggal>=today and", 0),
        ('M25 authorize: permission not checked', "if not public.pos_sale_backdate_allowed(p_branch) then\n  raise exception 'Anda tidak punya izin mencatat penjualan di tanggal sebelum hari ini. Minta Owner", "if false then\n  raise exception 'Anda tidak punya izin mencatat penjualan di tanggal sebelum hari ini. Minta Owner", 0),
        ('M26 authorize: reason not required', "if length(v_reason) not between 3 and 200 then raise exception", "if false then raise exception", 0),
        ('M27 authorize: a used key with another date is accepted', "if g.branch_id=p_branch and g.effective_date=p_date then", "if true then", 0),
        ('M28 authorize: replacement does not update the date', "set branch_id=p_branch,effective_date=p_date,reason=v_reason,authorized_at=now() where id=g.id", "set branch_id=p_branch,reason=v_reason,authorized_at=now() where id=g.id", 0),
        ('M29 patch: stock-out refuses the backdated sale (today-only rule not relaxed)', "and not public.pos_sale_edit_allowed(s.id) and not public.pos_sale_backdated(s.id) /* BACKDATE_INPUT */)", "and not public.pos_sale_edit_allowed(s.id) /* BACKDATE_INPUT */)", 0),
        ('M30 patch: HPP journal follows the sale date', "or public.pos_sale_backdated(sale.id) /* BACKDATE_INPUT */ then", "/* BACKDATE_INPUT */ then", 0),
        ('M31 patch: promo discount not refused at finalize', "or exists(select 1 from public.sale_items where sale_id=sale.id and (promo_id is not null or promo_claim_id is not null or coalesce(promo_discount,0)>0", "or exists(select 1 from public.sale_items where sale_id=sale.id and (promo_id is not null or promo_claim_id is not null or false", 0),
        ('M32 patch: points not refused at finalize', "sale.campaign_code is not null or sale.poin_earned>0 or sale.poin_digunakan>0\n  or exists", "sale.campaign_code is not null\n  or exists", 0),
        ('M33 patch: whole finalize refusal off', "if public.pos_sale_backdated(sale.id) and (sale.voucher_code is not null", "if false and (sale.voucher_code is not null", 0),
        ('M34 link: sale never linked to its authorization', "update public.pos_sale_backdates set sale_id=new.id,linked_at=now()", "update public.pos_sale_backdates set sale_id=null,linked_at=now()", 0),
        ('M35 guard: audit rows deletable', "if tg_op='DELETE' then raise exception 'Jejak tanggal mundur tidak dapat dihapus';end if;", "if tg_op='DELETE' then return old;end if;", 0),
        ('M36 guard: used audit rows editable', "if new.sale_id is null and (to_jsonb(new)-array['sale_id','linked_at']) is not distinct from (to_jsonb(old)-array['sale_id','linked_at']) then return new;end if;\n raise exception 'Jejak tanggal mundur tidak dapat diubah';", "return new;", 0),
        ('M37 guard: actor of an unused row changeable', "or new.actor_id is distinct from old.actor_id\n   or new.checkout_key", "or new.checkout_key", 0),
        ('M38 stamp: time of day 12:00 instead of 23:59', "(p_date+time '23:59:00')", "(p_date+time '12:00:00')", 0),
        ('M39 bounds: can_backdate always true', "'can_backdate',public.pos_sale_backdate_allowed(p_branch))", "'can_backdate',true)", 0),
        ('M40 bounds: closed period ignored in effective_min', "mn:=greatest(today-31,coalesce(closed+1,today-31));", "mn:=today-31;", 0),
        ('M41 table: (actor, checkout key) not unique', " unique(actor_id,checkout_key),\n", "", 0),
        ('M42 table: effective date may be today', ",\n constraint pos_sale_backdates_date_check check(effective_date<(authorized_at at time zone 'Asia/Jakarta')::date)", "", 0),
        ('M43 ACL: authorize executable by anon', "revoke all on function public.pos_sale_backdate_authorize(uuid,text,date,text) from public,anon,service_role;", "revoke all on function public.pos_sale_backdate_authorize(uuid,text,date,text) from public,anon,service_role;\ngrant execute on function public.pos_sale_backdate_authorize(uuid,text,date,text) to anon;", 0),
        ('M44 ACL: audit table writable by clients', "grant select on public.pos_sale_backdates to authenticated;", "grant select,insert,update on public.pos_sale_backdates to authenticated;", 0),
        ('M45 ACL: audit table readable by anon', "grant select on public.pos_sale_backdates to authenticated;", "grant select on public.pos_sale_backdates to authenticated,anon;", 0),
        ('M46 ACL: internal marker callable by clients', "revoke all on function public.pos_sale_backdated(uuid) from public,anon,authenticated,service_role;", "revoke all on function public.pos_sale_backdated(uuid) from public,anon,authenticated,service_role;\ngrant execute on function public.pos_sale_backdated(uuid) to authenticated;", 0),
        ('M47 RLS: audit table without row level security', "alter table public.pos_sale_backdates enable row level security;", "alter table public.pos_sale_backdates disable row level security;", 0),
        ('M48 RLS: any user reads every branch audit', "using (public.user_can_access_branch(branch_id) and public.sales_module_access());", "using (true);", 0),
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
    RESULTS.append(dict(case='MUTANT TOTAL killed %d of %d' % (killed_n, total), status='PASS' if killed_n == total and total >= 25 else 'FAIL', detail=''))


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
