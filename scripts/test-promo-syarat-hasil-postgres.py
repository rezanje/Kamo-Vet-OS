#!/usr/bin/env python3
"""Promo Syarat-Hasil stage 2 (DB + persistence) proof on a throwaway native PostgreSQL 17.

Every ORIGINAL migration is applied first (the three candidates are symlink-excluded from the fixture bootstrap and applied
afterwards in order), then the suites run. Fictional data, original public RPCs, unix socket only, no URL/credentials/network.
Run under the host heavy-test lock:

  flock /opt/data/kamo-heavy-test.lock python3 scripts/test-promo-syarat-hasil-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin

Options:
  --baseline      apply NO candidate migration (RED proof: the suites must fail on the original schema)
  --upto N        apply only the first N candidate migrations and run only their suites (TDD stepping)
  --no-regression skip the existing suites that touch the patched functions
  --mutate NAME   apply a named mutation of a candidate migration (mutation verification, see MUTATIONS) and run the suites
"""
import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres  # noqa: E402

spec = importlib.util.spec_from_file_location('fullschema', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
assert spec is not None and spec.loader is not None
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

CANDIDATES = [
    ('20261106300000_promo_syarat_hasil_definition.sql', ['promo_syarat_hasil_definition.sql']),
    ('20261106310000_promo_syarat_hasil_sale_claims.sql', ['promo_syarat_hasil_sales.sql']),
    ('20261106320000_promo_syarat_hasil_hpp_waiver.sql', ['promo_syarat_hasil_hpp.sql']),
]
# Existing suites that exercise the functions patched here (every one rolls back its own data).
REGRESSION = ['quantity_pool_pricing.sql', 'cashier_atomic_fifo_floor.sql', 'pos_split_payments.sql', 'pos_merchant_fees.sql', 'refund_payout.sql',
              'promo_edit.sql', 'promo_package_total.sql', 'promo_kadaluarsa.sql', 'p03_price_floor.sql', 'promo_excel_batch.sql']
# Suites that only run behind a fixture prelude in their own runner scripts.
PRELUDE = {'promo_edit.sql': 'pos_split_payments.sql', 'promo_package_total.sql': 'pos_split_payments.sql', 'refund_payout.sql': 'pos_merchant_fees.sql'}


def regression_outcomes(db):
    """Run each existing suite; (True,'') on success else (False, first error line). Every suite rolls back its own data."""
    out = {}
    for name in REGRESSION:
        p = ROOT / 'supabase/tests' / name
        if not p.exists():
            continue
        text = p.read_text()
        if name in PRELUDE:
            text = (ROOT / 'supabase/tests' / PRELUDE[name]).read_text().split('set local role authenticated;')[0] + text
        try:
            db.sql(text)
            out[name] = (True, '')
        except RuntimeError as e:
            out[name] = (False, str(e).strip().splitlines()[0][:160])
    return out

# name -> (candidate file, exact text, replacement). Each must break at least one named suite assertion.
MUTATIONS = {
    # name: (candidate file, exact text, replacement, suite assertion that must catch it)
    'flag_gate_trigger': ('20261106300000_promo_syarat_hasil_definition.sql',
        "if not public.promo_release_enabled('syarat_hasil') then\n   raise exception 'PROMO_SH_RELEASE: promo Syarat-Hasil belum dirilis; aplikasi harus live dan flag rilis dinyalakan dulu' using errcode='55000';\n  end if;\n  if new_allowed",
        "if false then\n   raise exception 'x';\n  end if;\n  if new_allowed"),
    'owner_only_waiver': ('20261106300000_promo_syarat_hasil_definition.sql',
        "if not public.promo_sh_actor_is_owner() then\n    raise exception 'PROMO_SH_OWNER_ONLY: izin penjualan di bawah HPP hanya boleh diatur oleh Owner' using errcode='42501';\n   end if;\n  end if;\n  if new_allowed and (not old_allowed",
        "if false then\n    raise exception 'x';\n   end if;\n  end if;\n  if new_allowed and (not old_allowed", ),
    'stale_token_save': ('20261106300000_promo_syarat_hasil_definition.sql',
        "if p_expected_version is null or public.promo_edit_snapshot(pid)->>'version' is distinct from p_expected_version then", "if false then"),
    'waiver_ack_stamp': ('20261106300000_promo_syarat_hasil_definition.sql',
        "if new_allowed and (not old_allowed or new_sh->'below_hpp' is distinct from old_sh->'below_hpp') then", "if false then"),
    'discount_formula': ('20261106310000_promo_syarat_hasil_sale_claims.sql',
        "if l.promo_discount is distinct from l.promo_hasil_units*public.promo_sh_unit_discount(p.rule,l.harga) then", "if false then"),
    'syarat_units': ('20261106310000_promo_syarat_hasil_sale_claims.sql',
        "if supplied<a*(row_json->>'min')::numeric then", "if false then"),
    'sets_agree': ('20261106310000_promo_syarat_hasil_sale_claims.sql',
        "if (select count(distinct promo_sets) from public.sale_items where sale_id=p_sale and promo_claim_id=p.id)<>1 then", "if false then"),
    'stock_provenance': ('20261106310000_promo_syarat_hasil_sale_claims.sql',
        "if not exists(select 1 from public.stock_moves mv join", "if false and not exists(select 1 from public.stock_moves mv join"),
    'claim_immutable': ('20261106310000_promo_syarat_hasil_sale_claims.sql',
        "raise exception 'PROMO_SH_SNAPSHOT: promo claim is immutable';", "null;"),
    'pool_member_exclusion': ('20261106310000_promo_syarat_hasil_sale_claims.sql', " and l.promo_claim_id is null -- SH_POOL_MEMBERS$b$", "$b$"),
    'pool_pick': ('20261106310000_promo_syarat_hasil_sale_claims.sql',
        "when new.promo_pick_mode in('pilih','tanpa') then false else", "when new.promo_pick_mode in('pilih','tanpa') then true else"),
    'floor_no_stacking': ('20261106320000_promo_syarat_hasil_hpp_waiver.sql', "then least(line.hpp,gross-item_discount) else", "then 0 else"),
    'floor_waiver_flag_ignored': ('20261106320000_promo_syarat_hasil_hpp_waiver.sql', "when coalesce(line.promo_floor_waiver,false) and manual<=0 then", "when manual<=0 then"),
    # stage-2 review fixes
    's1_harga_fallback': ('20261106310000_promo_syarat_hasil_sale_claims.sql', "else u.sell_price end,0)),0) into cart", "else u.sell_price end,i.harga)),0) into cart"),
    's1_original_bug': [('20261106310000_promo_syarat_hasil_sale_claims.sql', "else u.sell_price end,0)),0) into cart", "else u.sell_price end,i.harga)),0) into cart"), ('20261106310000_promo_syarat_hasil_sale_claims.sql', "from public.sale_items i join public.items it on it.id=i.item_id and it.is_active\n     left join public.item_units u", "from public.sale_items i left join public.items it on it.id=i.item_id\n     left join public.item_units u")],
    's2_update_guard': ('20261106310000_promo_syarat_hasil_sale_claims.sql', "if new.promo_id is distinct from old.promo_id and new.promo_id is not null and new.promo_claim_id", "if false and new.promo_id is not null and new.promo_claim_id"),
    's3_selection_bound': ('20261106310000_promo_syarat_hasil_sale_claims.sql', "octet_length(promo_selection::text)<=8192", "true"),
    'l1_trigger': ('20261106310000_promo_syarat_hasil_sale_claims.sql', ' if new.promo_floor_waiver and (new.promo_hasil_units is distinct from new.qty or new.promo_syarat_units<>0) then', " if false then"),
    'l1_check': ('20261106310000_promo_syarat_hasil_sale_claims.sql', '(promo_hasil_units=qty and promo_syarat_units=0)', "promo_hasil_units>0"),
    'l1_both': [('20261106310000_promo_syarat_hasil_sale_claims.sql', ' if new.promo_floor_waiver and (new.promo_hasil_units is distinct from new.qty or new.promo_syarat_units<>0) then', " if false then"), ('20261106310000_promo_syarat_hasil_sale_claims.sql', '(promo_hasil_units=qty and promo_syarat_units=0)', "promo_hasil_units>0")],
    'l3_hint': ('20261106320000_promo_syarat_hasil_hpp_waiver.sql', "case when coalesce(line.promo_floor_waiver,false) then ' (baris promo", "case when false then ' (baris promo"),
}


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', default='/opt/data/kamo-pg-harness/bin')
    ap.add_argument('--baseline', action='store_true')
    ap.add_argument('--upto', type=int, default=len(CANDIDATES))
    ap.add_argument('--apply', type=int, help='apply only the first N candidates (default: --upto); suites still run for --upto')
    ap.add_argument('--only', type=int, help='run only the suites of candidate K (1-based)')
    ap.add_argument('--no-regression', action='store_true')
    ap.add_argument('--no-concurrency', action='store_true')
    ap.add_argument('--diff', type=int, default=300, help='TS-engine differential: scenarios to generate (0 = skip)')
    ap.add_argument('--diff-seed', type=int, default=20261104)
    ap.add_argument('--mutate', choices=sorted(MUTATIONS))
    args = ap.parse_args()
    cands = [] if args.baseline else CANDIDATES[:(args.apply if args.apply is not None else args.upto)]
    cand_names = {n for n, _ in CANDIDATES}
    with tempfile.TemporaryDirectory(prefix='psh-main-', dir='/opt/data') as tmp:
        migrations = Path(tmp) / 'supabase/migrations'
        migrations.mkdir(parents=True)
        for p in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
            if p.name not in cand_names:
                (migrations / p.name).symlink_to(p)
        fixture.ROOT = Path(tmp)
        with NativePostgres(args.pg_bin) as db:
            fixture.DisposablePostgres.bootstrap(db)
            assert 170000 <= int(db.last('show server_version_num')) < 180000, 'Native PostgreSQL17 required'
            preserved = ("('finalize_pos_sale','sale_stock_out_fifo','pos_sale_assert_actor','pos_sale_record_payments',"
                         "'pos_sale_post_refund_selected','cancel_posted_sale','quantity_pool_competing_discount',"
                         "'sales_refund_quote','return_record_post_base','quantity_pool_refund_unit_price','quantity_pool_claim_guard')")
            sql = ("select coalesce(jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))),'{}') from pg_proc p "
                   "join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in " + preserved)
            before = json.loads(db.last(sql))

            def meta(sig):
                return json.loads(db.last("select jsonb_build_object('definition',pg_get_functiondef(oid),'acl',proacl::text,'definer',prosecdef,'config',proconfig) from pg_proc where oid='" + sig + "'::regprocedure"))
            patched = ['public.edit_promo(uuid,text,jsonb,uuid[])', 'public.quantity_pool_finalize_guard()', 'public.cashier_post_stock_atomic(uuid,uuid)']
            meta_before = {s: meta(s) for s in patched}
            policies = ("select jsonb_object_agg(c.relname,jsonb_build_object('acl',c.relacl::text,'rls',c.relrowsecurity,'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') "
                        "from pg_policies p where p.schemaname='public' and p.tablename=c.relname))) from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                        "where n.nspname='public' and c.relname in('promos','promo_items','sale_items','sales','stock','stock_layers','stock_moves','sale_payments','sale_payment_refunds','sale_line_pricing')")
            policies_before = db.last(policies)
            print('ORIGINAL RPC HASHES', json.dumps(before, sort_keys=True), flush=True)
            reg_before = {} if (args.no_regression or args.mutate or not cands) else regression_outcomes(db)
            for k, v in reg_before.items():
                print('BASELINE original suite', k, 'PASS' if v[0] else 'FAIL(pre-existing on the unmodified schema): ' + v[1], flush=True)
            applied = []
            for name, _ in cands:
                text = (ROOT / 'supabase/migrations' / name).read_text()
                if args.mutate:
                    muts = MUTATIONS[args.mutate]
                    for mfile, old, new in (muts if isinstance(muts, list) else [muts]):
                        if mfile != name:
                            continue
                        assert text.count(old) == 1, 'mutation anchor not unique in ' + name
                        text = text.replace(old, new)
                        print('MUTANT', args.mutate, flush=True)
                db.sql(text)
                applied.append(name)
                print('FORWARD', name, 'sha256', sha(ROOT / 'supabase/migrations' / name), flush=True)
            if cands:
                assert before == json.loads(db.last(sql)), 'Original money/stock/finalization/refund function definition drift'
                print('PASS original finalize_pos_sale, sale_stock_out_fifo, refund cores, competing_discount etc. are byte-identical', flush=True)
                after = {s: meta(s) for s in patched}
                structural = not args.mutate
                # edit_promo: only the SYARAT_HASIL_READONLY guard inserted
                e = 'public.edit_promo(uuid,text,jsonb,uuid[])'
                structural = not args.mutate
                d0, d1 = meta_before[e]['definition'], after[e]['definition']
                anchor = "if jsonb_typeof(p_values) is distinct from 'object' or not p_values ?& fields"
                inserted = d1.replace(d0.split(anchor)[0], '', 1) if d1.startswith(d0.split(anchor)[0]) else None
                assert inserted is not None and inserted.endswith(anchor + d0.split(anchor)[1]) and 'SYARAT_HASIL_READONLY' in inserted.split(anchor)[0], 'edit_promo changed outside the readonly guard'
                assert {k: v for k, v in meta_before[e].items() if k != 'definition'} == {k: v for k, v in after[e].items() if k != 'definition'}, 'edit_promo ACL/config drift'
                print('PASS edit_promo differs only by the SYARAT_HASIL_READONLY guard; ACL/definer/search_path unchanged', flush=True)
                if structural and len(cands) >= 2:
                    g = 'public.quantity_pool_finalize_guard()'
                    assert after[g]['definition'] != meta_before[g]['definition'] and 'SH_POOL' in after[g]['definition']
                    assert {k: v for k, v in meta_before[g].items() if k != 'definition'} == {k: v for k, v in after[g].items() if k != 'definition'}, 'pool guard ACL/config drift'
                    print('PASS quantity_pool_finalize_guard patched (SH_POOL markers present), ACL/definer/search_path unchanged', flush=True)
                if structural and len(cands) >= 3:
                    c = 'public.cashier_post_stock_atomic(uuid,uuid)'
                    old_floor = "if line.hpp is null or (gross-item_discount)*net_total/after_items < line.hpp then"
                    assert meta_before[c]['definition'].count(old_floor) == 1
                    new_floor = "if line.hpp is null or (gross-item_discount)*net_total/after_items < (case when coalesce(line.promo_floor_waiver,false) and manual<=0 then least(line.hpp,gross-item_discount) else line.hpp end) then -- P05_PROMO_WAIVER"
                    old_raise = "raise exception 'Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak: %', line.nama using errcode='55000';"
                    new_raise = ("raise exception 'Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak: %', line.nama||(case when coalesce(line.promo_floor_waiver,false) then ' (baris promo di bawah HPP: total struk tidak boleh lebih rendah dari subtotal setelah promo - tanpa voucher, poin, diskon total, atau pembulatan tunai ke bawah)' else '' end) using errcode='55000';")
                    assert meta_before[c]['definition'].count(old_raise) == 1
                    assert after[c]['definition'] == meta_before[c]['definition'].replace(old_floor, new_floor).replace(old_raise, new_raise), 'cashier_post_stock_atomic differs outside the exact floor expression and its raise message'
                    assert {k: v for k, v in meta_before[c].items() if k != 'definition'} == {k: v for k, v in after[c].items() if k != 'definition'}, 'cashier ACL/config drift'
                    print('PASS cashier_post_stock_atomic differs ONLY by the exact HPP-floor expression and its raise hint (waiver lines); ACL unchanged', flush=True)
                pol_after = json.loads(db.last(policies)); pol_before = json.loads(policies_before)
                for t in pol_before:  # existing tables: ACL/RLS/policies unchanged (new columns do not change them)
                    assert pol_before[t] == pol_after[t], 'ACL/RLS drift on ' + t
                print('PASS original ACL/RLS/policies on promos, promo_items, sales, sale_items, stock*, payments unchanged', flush=True)
            fixture_sql = (ROOT / 'supabase/tests/promo_syarat_hasil_fixture.sql').read_text()
            for idx, (name, suites) in enumerate(CANDIDATES[:args.upto], 1):
                if args.only and idx != args.only:
                    continue
                for suite in suites:
                    body = (ROOT / 'supabase/tests' / suite).read_text()
                    helpers = '' if suite.endswith('definition.sql') else (ROOT / 'supabase/tests/promo_syarat_hasil_helpers.sql').read_text()
                    print(db.sql('begin;\n' + fixture_sql + '\n' + helpers + '\n' + body + '\nrollback;'), flush=True)
                    print('PASS suite', suite, flush=True)
            left = db.sql("select (select count(*) from promos where name like 'Direct %')+(select count(*) from promo_release_flags where enabled)")
            assert left == '0', 'suite fixtures leaked: ' + left
            print('PASS suites rolled back, release flags still OFF', flush=True)
            if reg_before:
                reg_after = regression_outcomes(db)
                for name, before_result in reg_before.items():
                    assert reg_after[name] == before_result, 'REGRESSION: %s changed from %r to %r' % (name, before_result, reg_after[name])
                    print('PASS original regression', name, '(unchanged: %s)' % ('passes' if before_result[0] else 'fails identically on the unmodified schema'), flush=True)
            if cands and len(cands) >= 2 and args.diff and not args.mutate:
                differential(db, fixture_sql, args.diff, args.diff_seed)
            if cands and len(cands) >= 2 and not args.no_concurrency and not args.mutate:
                concurrency(db, fixture_sql)  # commits its fixture: keep it LAST
    return 0


def psql_async(db, sql, out):
    def run():
        t0 = time.time()
        r = subprocess.run(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                           input=sql, text=True, capture_output=True, env={**__import__('os').environ, 'PSQLRC': '/dev/null'})
        out.append({'rc': r.returncode, 'out': r.stdout, 'err': r.stderr, 'elapsed': time.time() - t0, 't0': t0})
    t = threading.Thread(target=run)
    t.start()
    return t


ADMIN = "e1100000-0000-4000-8000-000000000004"
CASHIER = "e1100000-0000-4000-8000-000000000001"
WH = "e3300000-0000-4000-8000-000000000001"
IKAN, DONAT, ANC = ("e5500000-0000-4000-8000-000000000001", "e5500000-0000-4000-8000-000000000003", "e5500000-0000-4000-8000-000000000008")
TODAY = "(now() at time zone 'Asia/Jakarta')::date"


def as_user(uid):
    return ("set role authenticated;select set_config('request.jwt.claim.sub','%s',false),set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false);" % uid)


SYARAT = '[{"kind":"qty","min":2,"items":[{"item_id":"%s","unit":"PCS"},{"item_id":"%s","unit":"PCS"}]}]' % (IKAN, DONAT)


def hasil(discount):
    return '{"kind":"barang","items":[{"item_id":"%s","unit":"PCS"}],"discount":{"type":"nominal","value":%d}}' % (ANC, discount)


def values_json(name, discount):
    return ("jsonb_build_object('name','%s','suggest','s','branch_ids','[]'::jsonb,'valid_from',%s,'valid_until',%s+30,'repeat',true,'syarat','%s'::jsonb,'hasil','%s'::jsonb,"
            "'below_hpp','{\"allowed\":false}'::jsonb)" % (name, TODAY, TODAY, SYARAT, hasil(discount)))


def rule_json(discount):
    return ("jsonb_build_object('discount_mode','syarat_hasil','suggest','s','syarat_hasil',jsonb_build_object('version',1,'repeat',true,'syarat','%s'::jsonb,'hasil','%s'::jsonb,"
            "'below_hpp','{\"allowed\":false}'::jsonb))" % (SYARAT, hasil(discount)))


def run_pair(db, first, second, delay=0.7):
    results = []
    t1 = psql_async(db, first, results)
    time.sleep(delay)
    t2 = psql_async(db, second, results)
    t1.join(90)
    t2.join(90)
    assert len(results) == 2, 'a session did not finish (deadlock?)'
    # results are appended in completion order: return them in start order
    return sorted(results, key=lambda r: r['t0'])


def concurrency(db, fixture_sql):
    """Real two-session races on COMMITTED fixture data: promo changes vs finalization, racing stale-token saves, racing identical activations."""
    P = ['f3000000-0000-4000-8000-00000000000%d' % i for i in (1, 2, 3, 4)]
    S = {1: 'c0000000-0000-4000-8000-000000000001', 2: 'c0000000-0000-4000-8000-000000000002'}

    def promo(pid, discount, active):
        return ("insert into promos(id,name,promo_type,rule,is_active,auto_apply,kelipatan,valid_from,valid_until) values('%s','CC %s','bundling',%s,%s,true,true,%s,%s+30);"
                "insert into promo_items select '%s',x from unnest(array['%s','%s','%s']::uuid[]) x;\n") % (pid, pid[-3:], rule_json(discount), 'true' if active else 'false', TODAY, TODAY, pid, IKAN, DONAT, ANC)

    def sale(n, pid):
        ref, sid = 'CC.S%d' % n, S[n]
        return ("insert into sales(id,branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint) values"
                "('%s','e2200000-0000-4000-8000-000000000001','%s',55000,1000,54000,'Tunai',54000,'%s','e4400000-0000-4000-8000-000000000001','[{\"method\":\"Tunai\",\"amount\":54000}]','sql:%s',repeat('a',64));"
                "insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,promo_claim_id,promo_sets,promo_syarat_units,promo_hasil_units) values"
                "('%s','%s','Ikan',2,20000,'PCS',1,0,0,'%s',1,2,0);"
                "insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,promo_id,promo_discount,promo_claim_id,promo_sets,promo_syarat_units,promo_hasil_units) values"
                "('%s','%s','ANC',1,15000,'PCS',1,0,1,'%s',1000,'%s',1,0,1);\n") % (sid, ref, CASHIER, ref, sid, IKAN, pid, sid, ANC, pid, pid)

    setup = "begin;\n" + fixture_sql + "\nupdate promo_release_flags set enabled=true;\n"
    setup += promo(P[0], 1000, True) + promo(P[1], 1000, True) + promo(P[2], 1500, False) + promo(P[3], 1500, False) + as_user(CASHIER).replace('false', 'true') + sale(1, P[0]) + sale(2, P[1]) + "reset role;commit;"
    db.sql(setup)
    assert db.last("select count(*) from promos where rule->>'discount_mode'='syarat_hasil' and is_active") == '2', 'concurrency setup failed'

    # C1: finalization holds the promo FOR SHARE; a concurrent deactivation must WAIT and finalization still sees the promo active.
    a = as_user(CASHIER) + "begin;select (cashier_post_stock_atomic((select id from sales where no_struk='CC.S1'),'%s')->>'finalized');select pg_sleep(2.5);commit;" % WH
    b = "update promos set is_active=false where id='%s';" % P[0]
    ra, rb = run_pair(db, a, b)
    assert ra['rc'] == 0 and 'true' in ra['out'], 'C1 finalization failed: ' + ra['err']
    assert rb['rc'] == 0 and rb['elapsed'] >= 1.4, 'C1 deactivation did not wait for the finalizing transaction: %.2fs' % rb['elapsed']
    assert db.last("select (payments_finalized_at is not null)::text||(select count(*) from sale_line_pricing where sale_id=s.id)::text from sales s where no_struk='CC.S1'") == 'true2'
    assert db.last("select is_active::text from promos where id='%s'" % P[0]) == 'false'
    print('PASS concurrency C1: promo deactivation waits for an in-flight finalization (FOR SHARE); finalization completed with 2 snapshots (%.1fs wait)' % rb['elapsed'], flush=True)

    # C2: deactivation commits first; a finalization that started meanwhile blocks, then is REFUSED and leaves no stock/snapshot.
    a = "begin;update promos set is_active=false where id='%s';select pg_sleep(2.5);commit;" % P[1]
    b = as_user(CASHIER) + "select cashier_post_stock_atomic((select id from sales where no_struk='CC.S2'),'%s');" % WH
    ra, rb = run_pair(db, a, b)
    assert ra['rc'] == 0
    assert rb['rc'] != 0 and 'PROMO_SH_ELIGIBILITY' in rb['err'], 'C2 finalization should be refused: ' + rb['err'] + rb['out']
    assert rb['elapsed'] >= 1.4, 'C2 finalization did not wait: %.2f' % rb['elapsed']
    assert db.last("select (select count(*) from stock_moves where source_ref='CC.S2')::text||(select count(*) from sale_line_pricing where sale_id='%s')::text" % S[2]) == '00'
    print('PASS concurrency C2: finalization blocked by a committing deactivation is refused (PROMO_SH_ELIGIBILITY), no stock/snapshot left', flush=True)

    # C3: two admins save the same draft with the SAME token: exactly one wins, the other waits on the advisory lock then gets 40001.
    tok = "(public.read_promo_edit('%s')->>'version')" % P[2]
    a = as_user(ADMIN) + "begin;select save_promo_syarat_hasil('%s',%s,%s);select pg_sleep(2.2);commit;" % (P[2], tok, values_json('Race A', 2100))
    b = as_user(ADMIN) + "select save_promo_syarat_hasil('%s',%s,%s);" % (P[2], tok, values_json('Race B', 2200))
    ra, rb = run_pair(db, a, b, 0.6)
    assert ra['rc'] == 0 and rb['rc'] != 0 and 'PROMO_EDIT_CONFLICT' in rb['err'] and rb['elapsed'] >= 1.2, 'C3: ' + ra['err'] + rb['err']
    assert db.last("select name from promos where id='%s'" % P[2]) == 'Race A'
    print('PASS concurrency C3: two racing saves with one token: the first wins, the second waits on the advisory lock then gets PROMO_EDIT_CONFLICT (no lost update)', flush=True)

    # C4: two identical drafts activated at the same time: the advisory lock serialises them, the loser is refused as a duplicate.
    db.sql("update promos set rule=(select rule from promos where id='%s'),name='CC dup' where id='%s'" % (P[2], P[3]))
    ta = "(public.read_promo_edit('%s')->>'version')" % P[2]
    tb = "(public.read_promo_edit('%s')->>'version')" % P[3]
    a = as_user(ADMIN) + "begin;select set_promo_syarat_hasil_active('%s',%s,true);select pg_sleep(2.2);commit;" % (P[2], ta)
    b = as_user(ADMIN) + "select set_promo_syarat_hasil_active('%s',%s,true);" % (P[3], tb)
    ra, rb = run_pair(db, a, b, 0.6)
    assert ra['rc'] == 0 and rb['rc'] != 0 and 'PROMO_SH_DUPLICATE' in rb['err'], 'C4: ' + ra['err'] + rb['err']
    assert db.last("select count(*) from promos where id in('%s','%s') and is_active" % (P[2], P[3])) == '1'
    print('PASS concurrency C4: racing activation of identical definitions: exactly one active (PROMO_SH_DUPLICATE for the loser)', flush=True)
    print('PASS concurrency suite', flush=True)


def differential(db, fixture_sql, count, seed):
    """Real stage-1 engine -> claims -> original cashier RPC. Every engine claim must be ACCEPTED by the DB verification; a +1 Rp forged
    reward discount must be REFUSED with PROMO_SH_TOTAL."""
    gen = subprocess.run(['node', '--no-warnings', str(ROOT / 'scripts/promo-syarat-hasil-diff-gen.mts'), str(seed), str(count)], capture_output=True, text=True, cwd=ROOT, timeout=120)
    assert gen.returncode == 0, 'generator failed: ' + gen.stderr[-500:]
    scenarios = [json.loads(line) for line in gen.stdout.splitlines() if line.strip()]
    with_claims = [x for x in scenarios if x['claims']]
    assert len(with_claims) >= 50, 'too few claim scenarios: %d' % len(with_claims)
    calls = []
    for x in with_claims:
        body = '$j$' + json.dumps(x) + '$j$::jsonb'
        calls.append("select 'A'||pg_temp.diff_scenario(%s,false);" % body)
        calls.append("select 'F'||pg_temp.diff_scenario(%s,true);" % body)
    out = db.sql('begin;\n' + fixture_sql + '\n' + (ROOT / 'supabase/tests/promo_syarat_hasil_diff_prelude.sql').read_text() + '\n' + '\n'.join(calls) + '\nrollback;').splitlines()
    results = [l for l in out if l.startswith(('AACCEPTED', 'AREFUSED', 'ASKIP', 'FACCEPTED', 'FREFUSED', 'FSKIP'))]
    assert len(results) == len(calls), 'unexpected result count %d != %d' % (len(results), len(calls))
    bad_a = [l for l in results if l.startswith('A') and not l.startswith('AACCEPTED')]
    bad_f = [l for l in results if l.startswith('F') and not l.startswith(('FREFUSED: PROMO_SH_TOTAL', 'FSKIP'))]
    assert not bad_a, 'DB refused %d engine claims, e.g. %s' % (len(bad_a), bad_a[:3])
    assert not bad_f, 'forged claims not refused with PROMO_SH_TOTAL: %s' % bad_f[:3]
    n_forged = sum(1 for l in results if l.startswith('FREFUSED'))
    print('PASS differential: %d/%d scenarios carried claims; all %d engine claim sets ACCEPTED by the DB; %d forged (+1 Rp) variants all REFUSED (PROMO_SH_TOTAL)' % (len(with_claims), len(scenarios), len(with_claims), n_forged), flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
