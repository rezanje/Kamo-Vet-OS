#!/usr/bin/env python3
"""CEGAH-SELISIH-SO (migrasi *_cegah_selisih_so.sql): selisih opname = hitungan - stok saat dikunci PERTAMA; stok akhir = stok sekarang + selisih.
Native throwaway PostgreSQL only (full migration chain, fictional fixtures). Never accepts a database URL.

  python3 -I scripts/test-cegah-selisih-so-postgres.py --pg-bin DIR [--json out.json] [--baseline | --diff | --mutations | --conc | --neighbours]
  (default)     chain + candidate: SQL suite supabase/tests/cegah_selisih_so.sql (>= 150 assertions incl. the exact OPR.00012 scenario), function/trigger/ACL
                identity (only post_opname_atomic changes + 3 trigger functions + 1 table), ROLLBACK proof, second application fails closed.
  --baseline    chain WITHOUT the candidate: the suite must fail early AND the defect must be shown (Buka + kunci ulang after a sale = false surplus +11).
  --diff        >= 500 randomised opnames WITHOUT movement on the chain WITHOUT and WITH the candidate (incl. Buka/kunci ulang cycles on the new side) must be
                identical (outcome, journals, moves, layers, stock, result items, receipt); + 200 randomised opnames WITH movements checked against an oracle.
  --mutations   every mutant of the candidate in a cloned database must be killed by the suite (or by the concurrency checks).
  --conc        independent sessions, real locks: sale during save, save during sale, lock during sale, Buka vs save, double save.
  --neighbours  existing opname suites on a pristine origin/main worktree vs this worktree; differences are listed, never hidden.
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse, importlib.util, json, os, random, re, subprocess, sys, tempfile, time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bpbase', ROOT / 'scripts/test-batalkan-penerimaan-petshop-postgres.py')
bp = importlib.util.module_from_spec(spec); sys.modules['bpbase'] = bp; spec.loader.exec_module(bp)
MIGRATIONS, TESTS = bp.MIGRATIONS, bp.TESTS
_found = sorted(MIGRATIONS.glob('*_cegah_selisih_so.sql')) or sorted((ROOT / 'supabase/candidates').glob('*_cegah_selisih_so.sql'))
CANDFILE = _found[0]
CAND = CANDFILE.name
bp.CAND = CAND
SUITE = 'cegah_selisih_so.sql'
check, raw, clone, run_suite, apply = bp.check, bp.raw, bp.clone, bp.run_suite, bp.apply
NativePostgres, RESULTS = bp.NativePostgres, bp.RESULTS
Sess, waiting, sleeping, q1 = bp.Sess, bp.waiting, bp.sleeping, bp.q1

# Hosted Supabase gives every new public function/table EXECUTE/ALL to anon, authenticated and service_role by default privileges; the bare native chain does not.
PRELUDE = ("alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;\n"
           "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;\n")
SEED = ("insert into coa_accounts(code,name,type,normal_balance) select c,'Fiktif '||c,'BEBAN','D' from unnest(array['720002','720003','720004','740017','740005','720008','740021','740016','730002','720005','720006','720009','740002','740014','740013','740022','740012','760003']) c on conflict(code) do update set is_active=true,is_header=false;\n")
DATA_FIX_KEYS = ('koreksi_saldo_awal_fb', 'ralat_saldo_awal', 'sambung_jurnal_pengeluaran', 'saldo_awal_kas_toko_ke_cabang')
SKIPPED = []


class Hook:
    def __init__(self, db): self.db = db
    def __getattr__(self, k): return getattr(self.db, k)

    def sql(self, source):
        if source.startswith('begin;\n-- Kategori pengeluaran rinci'): source = SEED + source
        if any(t in source for t in DATA_FIX):
            try: return self.db.sql(source)
            except RuntimeError as e:
                SKIPPED.append(str(e)[:80]); return ''
        return self.db.sql(source)


DATA_FIX = [f.read_text() for f in MIGRATIONS.glob('*.sql') if any(k in f.name for k in DATA_FIX_KEYS)]


def build_chain(db, exclude=()):
    tmp = Path(tempfile.mkdtemp(prefix='cschain.', dir='/opt/data'))
    try:
        (tmp / 'supabase/migrations').mkdir(parents=True)
        (tmp / 'supabase/tests/fixtures').mkdir(parents=True)
        (tmp / 'supabase/tests/fixtures/hosted_auth_uid.sql').write_text((ROOT / 'supabase/tests/fixtures/hosted_auth_uid.sql').read_text())
        for f in MIGRATIONS.glob('*.sql'):
            if f.name != CAND and f.name not in exclude:
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


def cand_text(): return CANDFILE.read_text()


def apply_cand(db, name, text=None, later=False):
    apply(db, name, PRELUDE + (text if text is not None else cand_text()), later=later)


PATCHED = ['post_opname_atomic(uuid,date,jsonb)']
NEW_FUNCS = ['opname_counts_beku_foto()', 'opname_counts_simpan_baseline()', 'opname_counts_tetapkan_baseline()']
FN_Q = ("select p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid))||'|'||p.prosecdef::text||'|'||coalesce(p.proconfig::text,'')||'|'||p.proowner::regrole::text||'|'||coalesce(p.proacl::text,'') "
        "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private','admin_online_private','role_settings_private') and p.prokind in ('f','p') order by 1")
TRG_Q = ("select tg.tgrelid::regclass::text||'.'||tg.tgname||'|'||md5(pg_get_triggerdef(tg.oid)) from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_namespace n on n.oid=c.relnamespace "
         "where not tg.tgisinternal and n.nspname in ('public','clinic_private') order by 1")
POL_Q = ("select pol.polrelid::regclass::text||'.'||pol.polname||'|'||md5(coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'')||pol.polcmd::text) from pg_policy pol order by 1")
COL_Q = ("select table_schema||'.'||table_name||'.'||column_name||'|'||data_type||coalesce(column_default,'')||is_nullable from information_schema.columns where table_schema in ('public','clinic_private') order by 1")
CON_Q = "select conrelid::regclass::text||'.'||conname||'|'||md5(pg_get_constraintdef(oid)) from pg_constraint where connamespace in ('public'::regnamespace) order by 1"


def digest(db, dbname, q):
    rc, out, err = raw(db, q, dbname); assert rc == 0, err
    d = {}
    for l in out.splitlines():
        k, rest = l.split('|', 1); d[k] = rest
    return d


def norm(k): return k[7:] if k.startswith('public.') else k


def rollback_sql(old_def):
    """ROLLBACK.sql from the OLD post_opname_atomic definition (hosted backup or the native 'before' clone)."""
    return ("-- ROLLBACK CEGAH-SELISIH-SO: pasang ulang definisi lama post_opname_atomic, lepas trigger, hapus fungsi trigger dan tabel baseline.\n"
            "set local lock_timeout = '10s';\n"
            "drop trigger if exists opname_counts_a_tetapkan_baseline on public.opname_counts;\n"
            "drop trigger if exists opname_counts_b_simpan_baseline on public.opname_counts;\n"
            "drop trigger if exists opname_counts_c_beku_foto on public.opname_counts;\n"
            + old_def.strip().rstrip(';') + ";\n"
            "revoke all on function public.post_opname_atomic(uuid,date,jsonb) from public,anon,service_role;\n"
            "grant execute on function public.post_opname_atomic(uuid,date,jsonb) to authenticated;\n"
            "drop function if exists public.opname_counts_simpan_baseline();\n"
            "drop function if exists public.opname_counts_tetapkan_baseline();\n"
            "drop function if exists public.opname_counts_beku_foto();\n"
            "drop table if exists public.opname_count_baselines;\n")


def run_green(db, a):
    fresh(db)
    clone(db, 'before'); before = {norm(k): v for k, v in digest(db, 'before', FN_Q).items()}
    b_trg = digest(db, 'before', TRG_Q); b_pol = digest(db, 'before', POL_Q); b_col = digest(db, 'before', COL_Q); b_con = digest(db, 'before', CON_Q)
    rc, out, err = raw(db, "select pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure)", 'before'); old_def = out.strip()
    clone(db, 'cand'); apply_cand(db, 'cand')
    after = {norm(k): v for k, v in digest(db, 'cand', FN_Q).items()}
    changed = sorted(k for k in before if k in after and before[k] != after[k])
    new = sorted(k for k in after if k not in before)
    gone = sorted(k for k in before if k not in after)
    check('IDENTITY existing functions that changed == exactly post_opname_atomic (definer/config/ACL included in the digest)', changed == sorted(PATCHED) and not gone, (changed, gone))
    check('IDENTITY new functions are exactly the 3 trigger functions', new == sorted(NEW_FUNCS), new)
    check('IDENTITY opname_surplus_cost / opname_posting_journal / opname_variance_charge_basis / stock_out_fifo / stock_in_fifo / issue_stock_document_recorded / capture_opname_price_report / guard_completed_opname_counts byte-identical',
          all(before[k] == after[k] for k in before if re.match(r'(opname_surplus_cost|opname_posting_journal|opname_variance_charge_basis|charge_opname_variance_to_employees|stock_out_fifo|stock_in_fifo|issue_stock_document_recorded|capture_opname_price_report|guard_completed_opname_counts|opname_posting_number|opname_posting_access|cancel_opname_draft|post_inventory_adjustment_atomic|stock_correction_plan|correct_stock_document)\(', k)), None)
    a_trg = digest(db, 'cand', TRG_Q); a_pol = digest(db, 'cand', POL_Q); a_col = digest(db, 'cand', COL_Q); a_con = digest(db, 'cand', CON_Q)
    new_trg = sorted(k for k in a_trg if k not in b_trg); gone_trg = sorted(k for k in b_trg if k not in a_trg); chg_trg = sorted(k for k in b_trg if k in a_trg and a_trg[k] != b_trg[k])
    check('IDENTITY triggers: only 3 new on opname_counts + the Admin Online write fence on the new table; none removed/changed',
          new_trg == sorted(['opname_counts.opname_counts_a_tetapkan_baseline', 'opname_counts.opname_counts_b_simpan_baseline', 'opname_counts.opname_counts_c_beku_foto', 'opname_count_baselines.zz_admin_online_write_fence']) and not gone_trg and not chg_trg, (new_trg, gone_trg, chg_trg))
    new_pol = sorted(k for k in a_pol if k not in b_pol); chg_pol = sorted(k for k in b_pol if k in a_pol and a_pol[k] != b_pol[k])
    check('IDENTITY policies: only the Admin Online read fence on the new table', new_pol == ['opname_count_baselines.admin_online_fence_r'] and not chg_pol, (new_pol, chg_pol))
    new_col = sorted(k for k in a_col if k not in b_col); chg_col = sorted(k for k in b_col if k in a_col and a_col[k] != b_col[k])
    check('IDENTITY columns: only the 5 columns of the new table; no existing column changed', len(new_col) == 5 and all(k.startswith('public.opname_count_baselines.') for k in new_col) and not chg_col, (new_col, chg_col))
    new_con = sorted(k for k in a_con if k not in b_con); chg_con = sorted(k for k in b_con if k in a_con and a_con[k] != b_con[k])
    check('IDENTITY constraints: only constraints of the new table', all(k.startswith('opname_count_baselines.') or k.startswith('public.opname_count_baselines.') for k in new_con) and not chg_con and len(new_con) >= 4, (new_con, chg_con))
    ok, passes, why = run_suite(db, 'cand', SUITE)
    check('SQL suite %s GREEN: %d assertions passed (>= 150 required)' % (SUITE, len(passes)), ok and len(passes) >= 150, why or 'passes=%d' % len(passes))
    try:
        apply(db, 'cand', cand_text(), later=False); twice = False
    except RuntimeError as e:
        twice = 'CEGAH_SELISIH_SO_SOURCE_CHANGED' in str(e)
    check('second application of the migration fails closed (precondition: already installed)', twice)
    # ROLLBACK proof on a native clone: candidate + ROLLBACK.sql == before (functions with ACL, triggers, columns, constraints, policies, table gone)
    clone(db, 'rb'); apply_cand(db, 'rb'); rb = rollback_sql(old_def)
    (Path(os.environ.get('CS_EVIDENCE', '/opt/data/kamo-cost-missing-evidence/ship-cegah-selisih-so')) / 'ROLLBACK-native.sql').write_text(rb)
    apply(db, 'rb', rb, later=False)
    r_fn = {norm(k): v for k, v in digest(db, 'rb', FN_Q).items()}
    check('ROLLBACK native: every function digest (definition + ACL + config + owner) equals the pre-candidate chain', r_fn == before, [k for k in set(r_fn) | set(before) if r_fn.get(k) != before.get(k)][:8])
    check('ROLLBACK native: triggers, policies, columns, constraints equal the pre-candidate chain; baseline table gone',
          digest(db, 'rb', TRG_Q) == b_trg and digest(db, 'rb', POL_Q) == b_pol and digest(db, 'rb', COL_Q) == b_col and digest(db, 'rb', CON_Q) == b_con, None)
    rc, out, err = raw(db, "select to_regclass('public.opname_count_baselines') is null", 'rb')
    check('ROLLBACK native: tabel baseline tidak ada lagi', out.strip() == 't', out)
    # the old SQL path works again after rollback (a post without the new keys)
    rc, out, err = raw(db, "select position('kunci-pertama-v1' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))=0", 'rb')
    check('ROLLBACK native: definisi posting kembali tanpa tanda baru', out.strip() == 't', out)
    # Admin Online fence verification on the candidate chain
    rc, out, err = raw(db, "select admin_online_private.guard_all()||'/'||admin_online_private.fence_all()", 'cand')
    check('Admin Online: guard_all()/fence_all() on the candidate chain add nothing (0/0)', out.strip() == '0/0', out + err[-200:])
    rc, out, err = raw(db, "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not exists(select 1 from pg_trigger g where g.tgrelid=c.oid and g.tgname='zz_admin_online_write_fence') and c.relname not in ('profiles','user_branches')", 'cand')
    check('Admin Online: every public table (also opname_count_baselines) carries the write fence', out.strip() in ('0',), out)
    rc, out, err = raw(db, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='public' and p.prokind='f' and p.prosecdef and l.lanname='plpgsql' and p.prorettype<>'trigger'::regtype and has_function_privilege('authenticated',p.oid,'execute') and p.prosrc !~ 'admin_online_private\\.deny_admin_online' and p.proname<>'post_online_order' and p.proname not like 'admin\\_online\\_%' and not exists (select 1 from pg_depend d join pg_policy pol on d.classid='pg_policy'::regclass and d.objid=pol.oid where d.refclassid='pg_proc'::regclass and d.refobjid=p.oid)", 'cand')
    check('Admin Online: no client-callable SECURITY DEFINER function lacks deny_admin_online (post_opname_atomic keeps its guard)', out.strip() == '0', out)


def run_baseline(db, a):
    fresh(db)
    clone(db, 'red')
    ok, passes, why = run_suite(db, 'red', SUITE)
    check('RED: suite fails at the baseline (%d assertions passed before the first failure)' % len(passes), not ok and len(passes) <= 4, why)
    probe = r"""
begin;
insert into auth.users(id,raw_user_meta_data) values('5c100000-0000-4000-8000-0000000000a1','{"full_name":"RED owner"}');
update profiles set role='OWNER',is_active=true where id='5c100000-0000-4000-8000-0000000000a1';
insert into branches(id,code,name,type) values('5c200000-0000-4000-8000-0000000000a1','REDA','RED klinik','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('5c300000-0000-4000-8000-0000000000a1','5c200000-0000-4000-8000-0000000000a1','REDW','RED gudang','VET');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) values('170001','Persediaan','ASET','D',false,true),('720010','Beban','BEBAN','D',false,true),('810004','Lain','PENDAPATAN','K',false,true) on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
insert into items(id,code,name,unit,item_type,buy_price,sell_price) values('5c400000-0000-4000-8000-0000000000a1','RED-MA','Meo Pouch Adult','PCS','Persediaan',0,6500);
select public.stock_in_fifo('5c300000-0000-4000-8000-0000000000a1','5c400000-0000-4000-8000-0000000000a1',11,5553.33,'fixture','FX-RED',current_date-5,null);
insert into opname_orders(id,no_opname,warehouse_id,penanggung_jawab,created_at) values('5c500000-0000-4000-8000-0000000000a1','OPO.RED','5c300000-0000-4000-8000-0000000000a1','x',now()-interval '2 days');
-- kunci pertama: hitungan 10, foto 11 (seperti aplikasi: qty_sistem = stok saat itu)
insert into opname_counts(order_id,item_id,qty_fisik,qty_sistem) values('5c500000-0000-4000-8000-0000000000a1','5c400000-0000-4000-8000-0000000000a1',10,11);
select public.stock_out_fifo('5c300000-0000-4000-8000-0000000000a1','5c400000-0000-4000-8000-0000000000a1',11,'sale','POS-20261124-0048',current_date);
-- Buka lalu kunci ulang "mengikuti sistem" 11: aplikasi membaca stok SAAT ITU (0)
delete from opname_counts where order_id='5c500000-0000-4000-8000-0000000000a1';
insert into opname_counts(order_id,item_id,qty_fisik,qty_sistem) values('5c500000-0000-4000-8000-0000000000a1','5c400000-0000-4000-8000-0000000000a1',11,0);
select set_config('request.jwt.claim.sub','5c100000-0000-4000-8000-0000000000a1',true);select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select public.post_opname_atomic('5c500000-0000-4000-8000-0000000000a1',current_date,'{"5c400000-0000-4000-8000-0000000000a1":11}'::jsonb) is not null;
select 'DEFECT selisih='||x.selisih||' qty_sistem='||x.qty_sistem||' journal810004='||coalesce((select sum(l.credit-l.debit) from journal_lines l join coa_accounts c on c.id=l.account_id join journal_entries e on e.id=l.entry_id where c.code='810004' and e.source='opname'),0)
 from (select selisih,qty_sistem from opname_result_items order by id limit 1) x;
rollback;
"""
    rc, out, err = raw(db, probe, 'red')
    line = [l for l in out.splitlines() if l.startswith('DEFECT')]
    check('RED defect shown on the old function: foto 11, terjual 11, Buka + kunci ulang 11 -> selisih LEBIH +11 palsu dan jurnal 810004 (Rp 61.086,63)', rc == 0 and bool(line) and 'selisih=11' in line[0] and 'qty_sistem=0' in line[0] and '810004=61086.63' in line[0], line or err[-400:])


# ------------------------------------------------------------------ differential
DIFF_PRELUDE = r"""
begin;
insert into auth.users(id,raw_user_meta_data) values('d1000000-0000-4000-8000-000000000001','{"full_name":"DF owner"}');
update profiles set role='OWNER',is_active=true where id='d1000000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values('d2000000-0000-4000-8000-000000000001','DFA','DF klinik','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','DFW','DF gudang','VET');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) values('170001','Persediaan','ASET','D',false,true),('720010','Beban selisih','BEBAN','D',false,true),('810004','Pendapatan lain','PENDAPATAN','K',false,true) on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
-- spec: [{layers:[{qty,cost}],master,mode:'locked'|'unlocked'|'reopen',delta,sale,recv,recvcost,drain}]
create function pg_temp.runcase(seed int,spec jsonb,side text) returns jsonb language plpgsql as $$
declare it jsonb;i int:=0;wh uuid:='d3000000-0000-4000-8000-000000000001';oid uuid:=gen_random_uuid();counts jsonb:='{}';iid uuid;l jsonb;n int;
 r jsonb;err text;ref text;out jsonb;ids uuid[]:='{}';cur numeric;cnt numeric;
begin
 insert into public.opname_orders(id,no_opname,warehouse_id,penanggung_jawab,created_at) values(oid,'OPO.DF.'||seed,wh,'Penghitung',now()-interval '2 days');
 for it in select * from jsonb_array_elements(spec) loop
  i:=i+1;iid:=md5('df-'||seed||'-'||i)::uuid;ids:=ids||iid;
  insert into public.items(id,code,name,unit,item_type,buy_price,sell_price) values(iid,'DF-'||seed||'-'||i,'Barang DF '||seed||'-'||i,'PCS','Persediaan',(it->>'master')::numeric,1000);
  n:=0;
  for l in select * from jsonb_array_elements(it->'layers') loop
   n:=n+1;perform public.stock_in_fifo(wh,iid,(l->>'qty')::numeric,(l->>'cost')::numeric,'fixture','DF-'||seed||'-'||i||'-'||n,(now() at time zone 'Asia/Jakarta')::date-(10-n),null);
  end loop;
  update public.stock_moves set created_at=now()-interval '10 days' where item_id=iid and source='fixture';
  if (it->>'drain')::boolean then perform public.stock_out_fifo(wh,iid,(select coalesce(sum(qty_left),0) from public.stock_layers where warehouse_id=wh and item_id=iid),'sale','DF-OUT-'||seed||'-'||i,(now() at time zone 'Asia/Jakarta')::date);
   update public.stock_moves set created_at=now()-interval '10 days' where item_id=iid and source_ref='DF-OUT-'||seed||'-'||i;end if;
  insert into public.stock(warehouse_id,item_id,qty) values(wh,iid,0) on conflict do nothing;
  cur:=(select coalesce(sum(qty),0) from public.stock where warehouse_id=wh and item_id=iid);
  cnt:=greatest(cur+(it->>'delta')::numeric,0);
  counts:=counts||jsonb_build_object(iid::text,cnt);
  if it->>'mode' in('locked','reopen') then
   insert into public.opname_counts(order_id,item_id,qty_fisik,qty_sistem) values(oid,iid,cnt,cur);
   if it->>'mode'='reopen' and side='new' then
    delete from public.opname_counts where order_id=oid and item_id=iid;
    insert into public.opname_counts(order_id,item_id,qty_fisik,qty_sistem) values(oid,iid,cnt,cur);   -- kunci ulang (tanpa gerakan)
    delete from public.opname_counts where order_id=oid and item_id=iid;
    insert into public.opname_counts(order_id,item_id,qty_fisik,qty_sistem) values(oid,iid,cnt,cur+7);  -- kunci ulang dengan foto klien ngawur
   elsif it->>'mode'='reopen' then null;
   end if;
  end if;
  -- gerakan SESUDAH dikunci (hanya kasus berbasis oracle)
  if coalesce((it->>'sale')::numeric,0)>0 then perform public.stock_out_fifo(wh,iid,(it->>'sale')::numeric,'sale','DF-SALE-'||seed||'-'||i,(now() at time zone 'Asia/Jakarta')::date);end if;
  if coalesce((it->>'recv')::numeric,0)>0 then perform public.stock_in_fifo(wh,iid,(it->>'recv')::numeric,coalesce((it->>'recvcost')::numeric,100),'terima-permintaan','DF-RECV-'||seed||'-'||i,(now() at time zone 'Asia/Jakarta')::date,null);end if;
 end loop;
 perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin
  r:=public.post_opname_atomic(oid,(now() at time zone 'Asia/Jakarta')::date,counts);ref:=r->>'no_hasil';
 exception when others then err:=sqlerrm;
 end;
 if err is not null then return jsonb_build_object('seed',seed,'err',err,'stock',(select coalesce(jsonb_agg(s.qty order by array_position(ids,s.item_id)),'[]') from public.stock s where s.warehouse_id=wh and s.item_id=any(ids)));end if;
 select jsonb_build_object('seed',seed,'err',null,
  'receipt',r-'bergerak_sejak_hitung'-'result_id'-'journal_ids'-'no_hasil',
  'journal',(select coalesce(jsonb_object_agg(code,net),'{}') from (select a.code,sum(l2.debit-l2.credit) net from public.journal_lines l2 join public.coa_accounts a on a.id=l2.account_id join public.journal_entries e on e.id=l2.entry_id where e.source='opname' and e.source_ref=ref group by a.code) x),
  'journals',(select count(*) from public.journal_entries where source='opname' and source_ref=ref),
  'desc',(select coalesce(jsonb_agg(e.deskripsi order by e.deskripsi),'[]') from public.journal_entries e where e.source='opname' and e.source_ref=ref),
  'ritems',(select coalesce(jsonb_agg(jsonb_build_object('i',array_position(ids,x.item_id),'sis',x.qty_sistem,'fis',x.qty_fisik,'sel',x.selisih) order by array_position(ids,x.item_id)),'[]') from public.opname_result_items x join public.opname_results rr on rr.id=x.result_id where rr.no_hasil=ref),
  'moves',(select coalesce(jsonb_agg(jsonb_build_object('i',array_position(ids,m.item_id),'q',m.qty,'c',round(m.unit_cost,6),'takes',(select coalesce(sum((t->>'qty')::numeric),0) from jsonb_array_elements(coalesce(m.fifo_takes,'[]')) t)) order by array_position(ids,m.item_id)),'[]') from public.stock_moves m where m.source='opname' and m.source_ref=ref),
  'layers',(select coalesce(jsonb_agg(jsonb_build_object('i',array_position(ids,l3.item_id),'in',l3.qty_in,'left',l3.qty_left,'c',round(l3.unit_cost,6),'src',l3.source) order by array_position(ids,l3.item_id),l3.tanggal,l3.created_at,l3.qty_in,l3.unit_cost),'[]') from public.stock_layers l3 where l3.item_id=any(ids)),
  'stock',(select coalesce(jsonb_agg(s.qty order by array_position(ids,s.item_id)),'[]') from public.stock s where s.warehouse_id=wh and s.item_id=any(ids)),
  'status',(select status::text from public.opname_orders where id=oid),
  'moved',coalesce((r->>'bergerak_sejak_hitung')::int,0)) into out;
 return out;
end$$;
"""


def gen_layers(rnd, role):
    layers = [dict(qty=rnd.randint(1, 12), cost=rnd.choice([0, 25, 40, 55.5, 100, 120.25, 333])) for _ in range(rnd.randint(0, 3))]
    if role == 'surplus' and not layers: layers = [dict(qty=rnd.randint(1, 6), cost=rnd.choice([40, 100, 250]))]
    return layers


def gen_case_a(seed, rnd):
    """No movement after the count: identical on old and new (kinds: locked / unlocked / reopen-on-new)."""
    items = []
    for _ in range(rnd.randint(1, 4)):
        layers = [dict(qty=rnd.randint(1, 12), cost=rnd.choice([0, 25, 40, 55.5, 100, 120.25, 333])) for _ in range(rnd.randint(0, 3))]
        have = sum(l['qty'] for l in layers)
        role = rnd.choice(['short', 'short', 'zero', 'surplus', 'surplus'])
        if role == 'short' and have == 0: role = 'zero'
        delta = 0 if role == 'zero' else (rnd.randint(1, 7) if role == 'surplus' else -rnd.randint(1, max(1, have)))
        drain = rnd.random() < 0.08
        if drain: layers = [dict(qty=rnd.randint(2, 6), cost=rnd.choice([60, 90]))]; delta = rnd.randint(0, 5)
        items.append(dict(layers=layers, master=rnd.choice([0, 0, 30, 75, 210.5]), mode=rnd.choice(['locked', 'unlocked', 'reopen']), delta=delta, drain=drain, sale=0, recv=0))
    if all(i['delta'] == 0 for i in items): items[0]['delta'] = 1
    return dict(seed=seed, spec=items)


def gen_case_b(seed, rnd):
    """Movement after the lock (new side only, oracle-checked)."""
    items = []
    for _ in range(rnd.randint(1, 3)):
        qty0 = rnd.randint(3, 14); cost = rnd.choice([40, 100, 120])
        mode = rnd.choice(['locked', 'locked', 'reopen', 'unlocked'])
        delta = rnd.randint(-qty0, 6)
        sale = rnd.choice([0, 0, 1, 2, rnd.randint(1, qty0 + 3)])
        recv = rnd.choice([0, 0, 0, rnd.randint(1, 9)])
        items.append(dict(layers=[dict(qty=qty0, cost=cost)], master=0, mode=mode, delta=delta, drain=False, sale=sale, recv=recv, recvcost=rnd.choice([100, 130])))
    return dict(seed=seed, spec=items)


def case_sql(cases, side):
    return DIFF_PRELUDE + "".join("select 'CASE '||pg_temp.runcase(%d,%s::jsonb,'%s')::text;\n" % (c['seed'], "'" + json.dumps(c['spec']).replace("'", "''") + "'", side) for c in cases) + "rollback;\n"


def parse(out):
    d = {}
    for l in out.splitlines():
        if l.startswith('CASE '):
            j = json.loads(l[5:]); d[j['seed']] = j
    return d


def oracle_b(spec):
    """Independent expectation for a class-B case: per item stock after, variance, and whether the post must be refused."""
    refuse = False; exp = []
    for it in spec:
        qty0 = it['layers'][0]['qty']
        cur_at_lock = qty0
        cnt = max(qty0 + it['delta'], 0)
        var = cnt - cur_at_lock
        mover = it['sale'] > 0 or it['recv'] > 0
        cur = qty0 - it['sale'] + it['recv']
        if it['mode'] == 'unlocked':
            if mover: refuse = True            # not locked + moved since SO start -> refused
            base = cur                         # (only reached when nothing moved)
            var = cnt - base
        if var < 0 and cur < -var: refuse = True
        exp.append(dict(var=var, cur=cur, after=cur + var, base=(cur_at_lock if it['mode'] != 'unlocked' else cur), cnt=cnt, moved=cur != (cur_at_lock if it['mode'] != 'unlocked' else cur)))
    return refuse, exp


def run_diff(db, a):
    rnd = random.Random(20261126)
    cases_a = [gen_case_a(s, rnd) for s in range(1, 521)]
    cases_b = [gen_case_b(s, rnd) for s in range(1001, 1241)]
    fresh(db)
    clone(db, 'old'); clone(db, 'new'); apply_cand(db, 'new')
    outs = {}
    rc, out, err = raw(db, case_sql(cases_a, 'old'), 'old'); outs['old'] = parse(out)
    check('DIFF old: all %d class-A cases executed' % len(cases_a), rc == 0 and len(outs['old']) == len(cases_a), (rc, len(outs['old']), err[-300:]))
    rc, out, err = raw(db, case_sql(cases_a, 'new'), 'new'); outs['new'] = parse(out)
    check('DIFF new: all %d class-A cases executed' % len(cases_a), rc == 0 and len(outs['new']) == len(cases_a), (rc, len(outs['new']), err[-300:]))
    o, n = outs['old'], outs['new']
    bad = []; errs = 0; posted = 0; reopen_items = 0; unlocked_items = 0; locked_items = 0; short_items = 0; surplus_items = 0
    for c in cases_a:
        s = c['seed']; ro, rn = o.get(s), n.get(s)
        if not ro or not rn: bad.append((s, 'missing')); continue
        for it in c['spec']:
            reopen_items += it['mode'] == 'reopen'; unlocked_items += it['mode'] == 'unlocked'; locked_items += it['mode'] == 'locked'
            short_items += it['delta'] < 0; surplus_items += it['delta'] > 0
        if ro.get('err'): errs += 1
        else: posted += 1
        # new key 'moved' must be 0 when nothing moved; everything else identical
        rn2 = {k: v for k, v in rn.items() if k != 'moved'}; ro2 = {k: v for k, v in ro.items() if k != 'moved'}
        if ro2 != rn2: bad.append((s, 'outcome differs', {k: (ro2.get(k), rn2.get(k)) for k in set(ro2) | set(rn2) if ro2.get(k) != rn2.get(k)}))
        if rn.get('moved', 0) != 0: bad.append((s, 'moved != 0 without movement'))
    check('DIFF A: %d cases with NO movement after the count (%d posted, %d refused; items: %d locked, %d unlocked, %d with Buka/kunci-ulang cycles on the new side; %d shortage, %d surplus) identical old vs new: outcome, error text, journals, descriptions, result items, moves, FIFO takes, layers, stock, status, receipt'
          % (len(cases_a), posted, errs, locked_items, unlocked_items, reopen_items, short_items, surplus_items), len(cases_a) >= 500 and not bad and posted >= 300 and reopen_items >= 150 and unlocked_items >= 150 and short_items >= 200 and surplus_items >= 200, bad[:4])
    # class B: new side only, oracle
    rc, out, err = raw(db, case_sql(cases_b, 'new'), 'new'); ob = parse(out)
    check('DIFF B: all %d class-B (movement after the lock) cases executed' % len(cases_b), rc == 0 and len(ob) == len(cases_b), (rc, len(ob), err[-300:]))
    badb = []; refused = 0; okc = 0; movedc = 0
    for c in cases_b:
        rn = ob.get(c['seed'])
        if not rn: badb.append((c['seed'], 'missing')); continue
        refuse, exp = oracle_b(c['spec'])
        if refuse:
            refused += 1
            if not rn.get('err') or not (rn['err'].startswith('Hitungan barang berikut perlu diulang') or rn['err'].startswith('Barang berikut belum dikunci')): badb.append((c['seed'], 'must be refused', rn.get('err'))); continue
            if rn['stock'] != [float(x['cur']) for x in exp] and [round(float(v), 4) for v in rn['stock']] != [round(float(x['cur']), 4) for x in exp]: badb.append((c['seed'], 'refusal changed stock', rn['stock']))
            continue
        okc += 1
        if rn.get('err'): badb.append((c['seed'], 'unexpected refusal', rn['err'])); continue
        for idx, e in enumerate(exp, start=1):
            ri = next((x for x in rn['ritems'] if x['i'] == idx), None)
            if not ri or round(float(ri['sel']), 4) != e['var'] or round(float(ri['sis']), 4) != e['base'] or round(float(ri['fis']), 4) != e['cnt']:
                badb.append((c['seed'], 'result item', idx, ri, e)); break
            if round(float(rn['stock'][idx - 1]), 4) != e['after']: badb.append((c['seed'], 'stock after', idx, rn['stock'], e)); break
        mv_q = {}
        for m in rn['moves']: mv_q[m['i']] = mv_q.get(m['i'], 0) + float(m['q'])
        for idx, e in enumerate(exp, start=1):
            if round(mv_q.get(idx, 0), 4) != e['var']: badb.append((c['seed'], 'opname movement qty != variance', idx, mv_q, e)); break
        if sum(float(v) for v in rn['journal'].values()) != 0: badb.append((c['seed'], 'journal unbalanced'))
        if rn['journals'] > 1: badb.append((c['seed'], 'more than one journal'))
        if rn['moved'] != sum(1 for e in exp if e['moved']): badb.append((c['seed'], 'moved count', rn['moved'], [e['moved'] for e in exp]))
        movedc += rn['moved'] > 0
        if float(rn['journal'].get('170001', 0)) != float(sum(m['q'] * m['c'] for m in rn['moves'])) and abs(float(rn['journal'].get('170001', 0)) - sum(float(m['q']) * float(m['c']) for m in rn['moves'])) > 0.02 * len(exp): badb.append((c['seed'], 'inventory journal != moves value'))
    check('DIFF B: %d cases WITH movement after the lock (%d refused as the oracle says, %d posted, %d of them with moved items): selisih = hitungan - foto, stok akhir = stok sekarang + selisih, opname mutasi = selisih, journal balanced/netted, refusals leave stock untouched'
          % (len(cases_b), refused, okc, movedc), len(cases_b) >= 200 and not badb and refused >= 20 and okc >= 80 and movedc >= 50, badb[:4])


# ------------------------------------------------------------------ mutants
def mutants():
    """(name, [(old, new), ...]) - each old must occur exactly once in the migration text."""
    return [
        ('M01 baseline: last Buka wins (on conflict do update)', [("values(old.order_id,old.item_id,old.qty_sistem,old.locked_at) on conflict(order_id,item_id) do nothing;", "values(old.order_id,old.item_id,old.qty_sistem,old.locked_at) on conflict(order_id,item_id) do update set qty_sistem=excluded.qty_sistem;")]),
        ('M02 baseline: stores the counted quantity instead of the system quantity', [("values(old.order_id,old.item_id,old.qty_sistem,old.locked_at)", "values(old.order_id,old.item_id,old.qty_fisik,old.locked_at)")]),
        ('M03 baseline: first_locked_at = now()', [("values(old.order_id,old.item_id,old.qty_sistem,old.locked_at)", "values(old.order_id,old.item_id,old.qty_sistem,now())")]),
        ('M04 baseline: order existence check removed (cascade delete hits the FK)', [(" if exists(select 1 from public.opname_orders o where o.id=old.order_id) then", " if true then")]),
        ('M05 insert trigger: baseline lookup ignored', [("select b.qty_sistem into base from public.opname_count_baselines b where b.order_id=new.order_id and b.item_id=new.item_id;", "base:=null;")]),
        ('M06 insert trigger: client value kept when non-zero (forgeable)', [("new.qty_sistem:=base;", "new.qty_sistem:=coalesce(nullif(new.qty_sistem,0),base);")]),
        ('M07 insert trigger: stock of the OTHER warehouses', [("where s.warehouse_id=wh and s.item_id=new.item_id for share;", "where s.warehouse_id<>wh and s.item_id=new.item_id for share;")]),
        ('M08 insert trigger: missing stock row not defaulted to 0', [("base:=coalesce(base,0);", "null;")]),
        ('M09 insert trigger: baseline lookup ignores the order (other opname leaks)', [("where b.order_id=new.order_id and b.item_id=new.item_id;", "where b.item_id=new.item_id;")]),
        ('M10 freeze trigger: qty_sistem comparison removed', [("(new.qty_sistem is distinct from old.qty_sistem or new.locked_at is distinct from old.locked_at\n   or new.order_id", "(new.locked_at is distinct from old.locked_at\n   or new.order_id")]),
        ('M11 freeze trigger: locked_at comparison removed', [("or new.locked_at is distinct from old.locked_at\n   or new.order_id", "or new.order_id")]),
        ('M12 freeze trigger: order/item identity comparison removed', [("\n   or new.order_id is distinct from old.order_id or new.item_id is distinct from old.item_id) then", ") then")]),
        ('M13 freeze trigger: authenticated no longer covered', [("current_user in ('authenticated','anon') and (new.qty_sistem", "current_user in ('anon') and (new.qty_sistem")]),
        ('M14 insert trigger is AFTER INSERT (cannot override)', [("create trigger opname_counts_a_tetapkan_baseline before insert", "create trigger opname_counts_a_tetapkan_baseline after insert")]),
        ('M15 delete trigger never fires (attached to UPDATE)', [("create trigger opname_counts_b_simpan_baseline before delete", "create trigger opname_counts_b_simpan_baseline before update")]),
        ('M16 ACL: insert-trigger function executable by authenticated (install check disabled too)', [("revoke all on function public.opname_counts_tetapkan_baseline() from public,anon,authenticated,service_role;", "grant execute on function public.opname_counts_tetapkan_baseline() to authenticated;"), ("  or has_function_privilege('authenticated','public.opname_counts_tetapkan_baseline()','EXECUTE')\n", "  or false\n")]),
        ('M17 ACL: baseline table readable by authenticated (install check disabled too)', [("revoke all on table public.opname_count_baselines from public,anon,authenticated,service_role;", "grant select on table public.opname_count_baselines to authenticated;"), ("if has_table_privilege('authenticated','public.opname_count_baselines','SELECT') or has_table_privilege('anon','public.opname_count_baselines','SELECT')", "if false")]),
        ('M18 ACL: baseline table writable by authenticated (install check disabled too)', [("revoke all on table public.opname_count_baselines from public,anon,authenticated,service_role;", "grant insert,update,delete on table public.opname_count_baselines to authenticated;"), ("  or has_table_privilege('authenticated','public.opname_count_baselines','INSERT') or has_table_privilege('authenticated','public.opname_count_baselines','DELETE')\n  or has_table_privilege('authenticated','public.opname_count_baselines','UPDATE') then", "  then")]),
        ('M19 delete-trigger function loses the empty search_path', [("create function public.opname_counts_simpan_baseline() returns trigger\nlanguage plpgsql security definer set search_path='' as $$", "create function public.opname_counts_simpan_baseline() returns trigger\nlanguage plpgsql security definer as $$")]),
        ('M20 freeze-trigger function becomes SECURITY DEFINER (current_user check defeated)', [("create function public.opname_counts_beku_foto() returns trigger\nlanguage plpgsql set search_path='' as $$", "create function public.opname_counts_beku_foto() returns trigger\nlanguage plpgsql security definer set search_path='' as $$")]),
        ('M21 refusal of unlocked+moved removed', [("if pending is not null then raise exception 'Barang berikut belum dikunci", "if false then raise exception 'Barang berikut belum dikunci")]),
        ('M22 refusal: movement test never true', [("m.item_id=u.item_id and m.created_at>doc.created_at);", "m.item_id=u.item_id and m.created_at>now()+interval '1 day');")]),
        ('M23 refusal also applies to items with a preserved baseline', [("   and not exists(select 1 from public.opname_count_baselines b where b.order_id=doc.id and b.item_id=u.item_id)\n", "")]),
        ('M24 refusal also applies to locked items', [("  where not exists(select 1 from public.opname_counts c where c.order_id=doc.id and c.item_id=u.item_id)\n   and not exists(select 1 from public.opname_count_baselines b", "  where not exists(select 1 from public.opname_count_baselines b")]),
        ('M25 refusal: movement looked up in another warehouse', [("where m.warehouse_id=wh.id and m.item_id=u.item_id and m.created_at>doc.created_at", "where m.warehouse_id<>wh.id and m.item_id=u.item_id and m.created_at>doc.created_at")]),
        ('M26 rows: baseline not used for the system quantity (old coalesce back)', [("'qty_sistem',coalesce(b.qty_sistem,c.qty_sistem,s.qty),", "'qty_sistem',coalesce(c.qty_sistem,s.qty),"), ("-coalesce(b.qty_sistem,c.qty_sistem,s.qty),'buy_price'", "-coalesce(c.qty_sistem,s.qty),'buy_price'")]),
        ('M27 rows: lock row wins over the first baseline', [("'qty_sistem',coalesce(b.qty_sistem,c.qty_sistem,s.qty),", "'qty_sistem',coalesce(c.qty_sistem,b.qty_sistem,s.qty),"), ("-coalesce(b.qty_sistem,c.qty_sistem,s.qty),'buy_price'", "-coalesce(c.qty_sistem,b.qty_sistem,s.qty),'buy_price'")]),
        ('M28 rows: current stock wins (selisih against the stock at save time)', [("'qty_sistem',coalesce(b.qty_sistem,c.qty_sistem,s.qty),", "'qty_sistem',coalesce(s.qty,b.qty_sistem,c.qty_sistem),"), ("-coalesce(b.qty_sistem,c.qty_sistem,s.qty),'buy_price'", "-coalesce(s.qty,b.qty_sistem,c.qty_sistem),'buy_price'")]),
        ('M29 rows: baseline join ignores the order', [("left join public.opname_count_baselines b on b.item_id=i.id and b.order_id=doc.id where", "left join public.opname_count_baselines b on b.item_id=i.id where")]),
        ('M30 rows: baseline join is an inner join', [("left join public.opname_count_baselines b on b.item_id=i.id and b.order_id=doc.id where", "join public.opname_count_baselines b on b.item_id=i.id and b.order_id=doc.id where")]),
        ('M31 message: change since the lock shown with the wrong sign', [("trim_scale(s.qty-x.qty_sistem),trim_scale(s.qty))", "trim_scale(x.qty_sistem-s.qty),trim_scale(s.qty))")]),
        ('M32 message: pointer to Penyesuaian Persediaan removed', [(" lalu catat kekurangannya lewat Penyesuaian Persediaan.'", ".'")]),
        ('M33 message: first-lock explanation removed', [("Hitungan harus sama dengan isi rak PADA SAAT barang pertama kali dikunci (isi rak sekarang ditambah yang sudah terjual sejak itu), bukan isi rak sekarang. ", "")]),
        ('M34 message: unlocked refusal loses the Kunci instruction', [(" Tekan Kunci pada barang tersebut tepat sesudah dihitung, lalu simpan lagi.',left(pending,600)", ".',left(pending,600)")]),
        ('M35 moved list includes every item', [("where s.qty is distinct from x.qty_sistem;", "where true;")]),
        ('M36 moved list: change with the wrong sign', [("'stok_sekarang',s.qty,'gerak',s.qty-x.qty_sistem)", "'stok_sekarang',s.qty,'gerak',x.qty_sistem-s.qty)")]),
        ('M37 receipt: moved counter always 0', [("'bergerak_sejak_hitung',jsonb_array_length(moved)", "'bergerak_sejak_hitung',0")]),
        ('M38 snapshot: rule marker removed', [("'baseline_rule','kunci-pertama-v1',", "")]),
        ('M39 snapshot: moved details dropped', [("'sejak_hitung',moved),je);", "'sejak_hitung','[]'::jsonb),je);")]),
        ('M40 snapshot: stok_sekarang shows the foto', [("'stok_sekarang',s.qty,", "'stok_sekarang',x.qty_sistem,")]),
        ('M41 ACL: post_opname_atomic left executable by anon (install check disabled too)', [("revoke all on function public.post_opname_atomic(uuid,date,jsonb) from public,anon,service_role;", "revoke all on function public.post_opname_atomic(uuid,date,jsonb) from public,service_role;"), ("  or has_function_privilege('anon','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE')\n  or has_function_privilege('public','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE') then", "  then")]),
        ('M42 Admin Online guards not re-run', [("select admin_online_private.guard_all();\nselect admin_online_private.fence_all();", "select 1;")]),
        ('M43 baseline table: first lock time not unique per item (no primary key)', [(" primary key (order_id,item_id)\n", " check (true)\n")]),
        ('M44 baseline table: no cascade on the order', [("order_id uuid not null references public.opname_orders(id) on delete cascade,", "order_id uuid not null references public.opname_orders(id),")]),
        ('M45 baseline table: NaN allowed', [(" check (qty_sistem::text not in ('NaN','Infinity','-Infinity'))", "")]),
        ('M46 baseline: first_locked_at refreshed by later Buka', [("on conflict(order_id,item_id) do nothing;\n end if;\n return old;", "on conflict(order_id,item_id) do update set first_locked_at=excluded.first_locked_at;\n end if;\n return old;")]),
        ('M47 refusal placed after the recount check (wrong position: install check)', [("if pending is not null then raise exception 'Barang berikut belum dikunci dan stoknya", "if pending is not null and false then raise exception 'Barang berikut belum dikunci dan stoknya")]),
        ('M48 table: no RLS enabled (fence_all must refuse, apply fails)', [("alter table public.opname_count_baselines enable row level security;\n", "")]),
    ]


def run_mutations(db, a):
    fresh(db)
    base = cand_text()
    clone(db, 'ctl'); apply_cand(db, 'ctl', base)
    ok, passes, why = run_suite(db, 'ctl', SUITE)
    check('CONTROL: unmutated candidate passes the suite (%d assertions)' % len(passes), ok, why)
    want = len(passes)
    only = os.environ.get('CS_ONLY', '').split(',') if os.environ.get('CS_ONLY') else None
    killed = 0; total = 0; detail = {}
    for name, edits in mutants():
        if only and not any(name.startswith(o) for o in only): continue
        total += 1
        bad_anchor = [o[:60] for o, n in edits if base.count(o) != 1]
        if bad_anchor:
            check('MUTANT ' + name + ' (anchor found exactly once)', False, bad_anchor); detail[name] = dict(killed=False, why='anchor'); continue
        mutated = base
        for o, n in edits: mutated = mutated.replace(o, n)
        clone(db, 'mut')
        try:
            apply_cand(db, 'mut', mutated)
        except RuntimeError as e:
            killed += 1; detail[name] = dict(killed=True, how='apply-fails', why=str(e)[:160].replace('\n', ' '))
            check('MUTANT ' + name + ' -> killed (does not even apply: %s)' % str(e)[:100].replace('\n', ' '), True); continue
        ok, passes, why = run_suite(db, 'mut', SUITE)
        dead = not ok or len(passes) < want
        killed += dead
        detail[name] = dict(killed=dead, how='suite' if dead else 'SURVIVED', why=why[:160])
        check('MUTANT ' + name + ' -> %s' % ('KILLED: ' + why[:100] if dead else 'SURVIVED (suite still green, %d)' % len(passes)), dead, why)
    check('MUTANTS killed %d / %d (>= 40 required)' % (killed, total), killed == total and (total >= 40 or only is not None))
    Path(os.environ.get('CS_EVIDENCE', '/opt/data/kamo-cost-missing-evidence/ship-cegah-selisih-so')).joinpath('mutants-detail.json').write_text(json.dumps(detail, indent=1))


# ------------------------------------------------------------------ concurrency
CONC_FIX = r"""
begin;
insert into auth.users(id,raw_user_meta_data) values('cc100000-0000-4000-8000-000000000001','{"full_name":"CC owner"}');
update profiles set role='OWNER',is_active=true where id='cc100000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values('cc200000-0000-4000-8000-000000000001','CCA','CC klinik','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('cc300000-0000-4000-8000-000000000001','cc200000-0000-4000-8000-000000000001','CCW','CC gudang','VET');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) values('170001','Persediaan','ASET','D',false,true),('720010','Beban','BEBAN','D',false,true),('810004','Lain','PENDAPATAN','K',false,true) on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
insert into items(id,code,name,unit,item_type,buy_price,sell_price) select ('cc400000-0000-4000-8000-0000000000'||lpad(i::text,2,'0'))::uuid,'CC-'||i,'Barang CC '||i,'PCS','Persediaan',0,1000 from generate_series(1,12) i;
select public.stock_in_fifo('cc300000-0000-4000-8000-000000000001',('cc400000-0000-4000-8000-0000000000'||lpad(i::text,2,'0'))::uuid,10,100,'fixture','FX-CC-'||i,current_date-5,null) from generate_series(1,12) i;
update stock_moves set created_at=now()-interval '10 days' where source='fixture';
insert into opname_orders(id,no_opname,warehouse_id,penanggung_jawab,created_at) select ('cc500000-0000-4000-8000-0000000000'||lpad(i::text,2,'0'))::uuid,'OPO.CC.'||i,'cc300000-0000-4000-8000-000000000001','x',now()-interval '2 days' from generate_series(1,8) i;
commit;
"""
W = 'cc300000-0000-4000-8000-000000000001'
OWN = "select set_config('request.jwt.claim.sub','cc100000-0000-4000-8000-000000000001',false); select set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false);"
it_ = lambda i: "cc400000-0000-4000-8000-0000000000%02d" % i
od_ = lambda i: "cc500000-0000-4000-8000-0000000000%02d" % i


def run_conc(db, a):
    fresh(db)
    clone(db, 'conc'); apply_cand(db, 'conc')
    rc, out, err = raw(db, CONC_FIX, 'conc'); assert rc == 0, err
    sq = lambda i: q1(db, 'conc', f"select qty::numeric(20,4)::text from stock where warehouse_id='{W}' and item_id='{it_(i)}'")
    cq = lambda o, i: q1(db, 'conc', f"select qty_sistem::numeric(20,4)::text from opname_counts where order_id='{od_(o)}' and item_id='{it_(i)}'")
    # 1. sale in flight, save arrives: save waits on the stock row, then sees the sale; baseline = lock photo 10, count 10 -> selisih 0, stock stays 5
    raw(db, f"insert into opname_counts(order_id,item_id,qty_fisik,qty_sistem) values('{od_(1)}','{it_(1)}',10,10);", 'conc')
    a1 = Sess(db, 'conc', f"begin; select public.stock_out_fifo('{W}','{it_(1)}',5,'sale','CC-SALE-1',current_date); /* conc-holder1 */ select pg_sleep(2.5); commit;")
    ok1 = sleeping(db, 'conc', 'conc-holder1')
    b1 = Sess(db, 'conc', OWN + f"/* conc-post1 */ select public.post_opname_atomic('{od_(1)}',current_date,'{{\"{it_(1)}\":10}}'::jsonb);")
    ok2 = waiting(db, 'conc', 'conc-post1')
    ra, rb = a1.done(), b1.done()
    check('CONC 1 sale in flight when the save starts: the save waits on the stock row, then posts against the lock photo (selisih 0, stock 5, no journal)',
          ok1 and ok2 and ra[0] == 0 and rb[0] == 0 and sq(1) == '5.0000' and q1(db, 'conc', f"select (selisih=0)::text from opname_result_items where result_id=(select id from opname_results where order_id='{od_(1)}')") == 'true'
          and q1(db, 'conc', "select count(*) from journal_entries where source='opname' and deskripsi like '%OPO.CC.1%'") == '0', (ok1, ok2, ra[2][-150:], rb[2][-200:], sq(1)))
    # 2. save in flight, a sale arrives: the sale waits, then runs on the post-save stock (variance -2 applied, then sale 3): 10 - 2 - 3 = 5
    raw(db, f"insert into opname_counts(order_id,item_id,qty_fisik,qty_sistem) values('{od_(2)}','{it_(2)}',8,10);", 'conc')
    a2 = Sess(db, 'conc', OWN + f"begin; select public.post_opname_atomic('{od_(2)}',current_date,'{{\"{it_(2)}\":8}}'::jsonb); /* conc-holder2 */ select pg_sleep(2.5); commit;")
    ok1 = sleeping(db, 'conc', 'conc-holder2')
    b2 = Sess(db, 'conc', f"/* conc-sale2 */ select public.stock_out_fifo('{W}','{it_(2)}',3,'sale','CC-SALE-2',current_date);")
    ok2 = waiting(db, 'conc', 'conc-sale2')
    ra, rb = a2.done(), b2.done()
    check('CONC 2 save in flight when a sale arrives: the sale waits, then sells from the adjusted stock (10 - 2 - 3 = 5), layers equal stock',
          ok1 and ok2 and ra[0] == 0 and rb[0] == 0 and sq(2) == '5.0000' and q1(db, 'conc', f"select coalesce(sum(qty_left),0)::numeric(20,4)::text from stock_layers where warehouse_id='{W}' and item_id='{it_(2)}'") == '5.0000', (ok1, ok2, ra[2][-150:], rb[2][-150:], sq(2)))
    # 3. lock while a sale is in flight: the lock photo waits for the sale (FOR SHARE) and records the post-sale stock (6), never the stale 10
    a3 = Sess(db, 'conc', f"begin; select public.stock_out_fifo('{W}','{it_(3)}',4,'sale','CC-SALE-3',current_date); /* conc-holder3 */ select pg_sleep(2.5); commit;")
    ok1 = sleeping(db, 'conc', 'conc-holder3')
    b3 = Sess(db, 'conc', f"/* conc-lock3 */ insert into opname_counts(order_id,item_id,qty_fisik,qty_sistem) values('{od_(3)}','{it_(3)}',6,999);")
    ok2 = waiting(db, 'conc', 'conc-lock3')
    ra, rb = a3.done(), b3.done()
    check('CONC 3 lock (kunci) while a sale is in flight: the photo waits for the sale and records the post-sale stock 6 (not the stale 10, not the client 999)', ok1 and ok2 and ra[0] == 0 and rb[0] == 0 and cq(3, 3) == '6.0000', (ok1, ok2, cq(3, 3), rb[2][-150:]))
    # 4. Buka vs save: Buka waits for the order lock, then is refused (order finished); no baseline row is written by the refused delete
    raw(db, f"insert into opname_counts(order_id,item_id,qty_fisik,qty_sistem) values('{od_(4)}','{it_(4)}',10,10);", 'conc')
    a4 = Sess(db, 'conc', OWN + f"begin; select public.post_opname_atomic('{od_(4)}',current_date,'{{\"{it_(4)}\":10}}'::jsonb); /* conc-holder4 */ select pg_sleep(2.5); commit;")
    ok1 = sleeping(db, 'conc', 'conc-holder4')
    b4 = Sess(db, 'conc', f"/* conc-buka4 */ delete from opname_counts where order_id='{od_(4)}' and item_id='{it_(4)}';")
    ok2 = waiting(db, 'conc', 'conc-buka4')
    ra, rb = a4.done(), b4.done()
    check('CONC 4 Buka while the save is in flight: waits, then refused (Opname tidak terbuka); the count row stays, NO baseline row is written',
          ok1 and ok2 and ra[0] == 0 and rb[0] != 0 and 'Opname tidak terbuka' in rb[2] and q1(db, 'conc', f"select count(*) from opname_count_baselines where order_id='{od_(4)}'") == '0' and cq(4, 4) == '10.0000', (ok1, ok2, rb[2][-200:]))
    # 5. two saves of the same order: one effect, same answer
    raw(db, f"insert into opname_counts(order_id,item_id,qty_fisik,qty_sistem) values('{od_(5)}','{it_(5)}',9,10);", 'conc')
    a5 = Sess(db, 'conc', OWN + f"begin; select public.post_opname_atomic('{od_(5)}',current_date,'{{\"{it_(5)}\":9}}'::jsonb); /* conc-holder5 */ select pg_sleep(2.5); commit;")
    ok1 = sleeping(db, 'conc', 'conc-holder5')
    b5 = Sess(db, 'conc', OWN + f"/* conc-post5 */ select public.post_opname_atomic('{od_(5)}',current_date,'{{\"{it_(5)}\":9}}'::jsonb);")
    ok2 = waiting(db, 'conc', 'conc-post5')
    ra, rb = a5.done(), b5.done()
    check('CONC 5 double save (two sessions): the second waits on the order lock, then returns the first answer (already_posted); one result, one journal, stock 9',
          ok1 and ok2 and ra[0] == 0 and rb[0] == 0 and 'true' in rb[1] and q1(db, 'conc', f"select count(*) from opname_results where order_id='{od_(5)}'") == '1' and sq(5) == '9.0000', (ok1, ok2, rb[1][-200:], rb[2][-150:]))
    # 6. Buka (row delete) in an open transaction, then a second session re-locks: the re-lock waits for nothing, takes the preserved photo only after Buka commits
    raw(db, f"insert into opname_counts(order_id,item_id,qty_fisik,qty_sistem) values('{od_(6)}','{it_(6)}',10,10);", 'conc')
    a6 = Sess(db, 'conc', f"begin; delete from opname_counts where order_id='{od_(6)}' and item_id='{it_(6)}'; select public.stock_out_fifo('{W}','{it_(6)}',7,'sale','CC-SALE-6',current_date); /* conc-holder6 */ select pg_sleep(2.5); commit;")
    ok1 = sleeping(db, 'conc', 'conc-holder6')
    b6 = Sess(db, 'conc', f"/* conc-relock6 */ insert into opname_counts(order_id,item_id,qty_fisik,qty_sistem) values('{od_(6)}','{it_(6)}',10,0);")
    ok2 = waiting(db, 'conc', 'conc-relock6')
    ra, rb = a6.done(), b6.done()
    check('CONC 6 Buka + sale in one open transaction, re-lock from a second session: the re-lock waits, then keeps the FIRST photo 10 (stock now 3)',
          ok1 and ok2 and ra[0] == 0 and rb[0] == 0 and cq(6, 6) == '10.0000' and sq(6) == '3.0000', (ok1, ok2, cq(6, 6), rb[2][-150:], ra[2][-150:]))
    check('CONC after all races: trial balance is zero and every stock row equals its layers', q1(db, 'conc', "select coalesce(sum(debit-credit),0)=0 from journal_lines") == 't'
          and q1(db, 'conc', "select count(*) from stock s where greatest(s.qty,0)<>(select coalesce(sum(l.qty_left),0) from stock_layers l where l.warehouse_id=s.warehouse_id and l.item_id=s.item_id)") == '0', None)


# ------------------------------------------------------------------ neighbours
NEIGH = ['test-opname-posting-postgres.py', 'test-opname-posting-native-postgres.py', 'test-opname-cancel-postgres.py', 'test-f1-opname-akun-selisih-postgres.py',
         'test-so-surplus-hpp-postgres.py', 'test-so-kasbon-neto-postgres.py']


def run_neighbours(db, a):
    base_tree = os.environ.get('CS_BASE_TREE')
    check('NEIGHBOUR prerequisite: pristine origin/main worktree given (CS_BASE_TREE)', bool(base_tree) and Path(base_tree).is_dir(), base_tree)
    for nb in NEIGH:
        res = {}
        for tag, tree in (('without', base_tree), ('with', str(ROOT))):
            r = subprocess.run([sys.executable, '-I', str(Path(tree) / 'scripts' / nb), '--pg-bin', a.pg_bin], capture_output=True, text=True, cwd=tree)
            lines = r.stdout.splitlines() + r.stderr.splitlines()
            res[tag] = (r.returncode, [l for l in lines if l.startswith(('FAIL', 'SUMMARY')) or 'passed' in l][-300:])
        fails = lambda t: sorted(l for l in res[t][1] if l.startswith('FAIL'))
        only_with = sorted(set(fails('with')) - set(fails('without')))
        check('NEIGHBOUR %s: rc without=%s with=%s; FAIL lines only with the candidate: %d' % (nb, res['without'][0], res['with'][0], len(only_with)), not only_with and res['with'][0] == res['without'][0],
              dict(only_with=only_with[:6], summary_with=res['with'][1][-3:], summary_without=res['without'][1][-3:]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json')
    for k in ('baseline', 'diff', 'mutations', 'conc', 'neighbours'): ap.add_argument('--' + k, action='store_true')
    a = ap.parse_args()
    fn = run_baseline if a.baseline else run_diff if a.diff else run_mutations if a.mutations else run_conc if a.conc else run_neighbours if a.neighbours else run_green
    with NativePostgres(a.pg_bin) as db:
        fn(db, a)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(mode=fn.__name__, candidate=CAND, skipped_data_fix_migrations=SKIPPED, results=RESULTS), indent=1))
    fails = [r for r in RESULTS if r['status'] == 'FAIL']
    print('SUMMARY mode=%s pass=%d fail=%d' % (fn.__name__, len(RESULTS) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
