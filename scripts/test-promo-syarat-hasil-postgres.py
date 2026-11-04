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
REGRESSION = ['quantity_pool_pricing.sql', 'cashier_atomic_fifo_floor.sql', 'p03_price_floor.sql', 'pos_split_payments.sql',
              'pos_merchant_fees.sql', 'promo_edit.sql', 'promo_package_total.sql', 'promo_kadaluarsa.sql', 'promo_excel_batch.sql']

# name -> (candidate file, exact text, replacement). Each must break at least one named suite assertion.
MUTATIONS = {
    'flag_gate': ('20261106300000_promo_syarat_hasil_definition.sql',
                  "if not public.promo_release_enabled('syarat_hasil') then\n   raise exception 'PROMO_SH_RELEASE: promo Syarat-Hasil belum dirilis; aplikasi harus live dan flag rilis dinyalakan dulu' using errcode='55000';\n  end if;\n  if new_allowed",
                  "if false then\n   raise exception 'PROMO_SH_RELEASE';\n  end if;\n  if new_allowed"),
    'owner_only_waiver': ('20261106300000_promo_syarat_hasil_definition.sql',
                          "if not public.promo_sh_actor_is_owner() then\n    raise exception 'PROMO_SH_OWNER_ONLY: izin penjualan di bawah HPP hanya boleh diatur oleh Owner' using errcode='42501';\n   end if;\n  end if;\n  if new_allowed and (not old_allowed",
                          "if false then\n    raise exception 'PROMO_SH_OWNER_ONLY';\n   end if;\n  end if;\n  if new_allowed and (not old_allowed"),
    'stale_token': ('20261106300000_promo_syarat_hasil_definition.sql',
                    "if p_expected_version is null or public.promo_edit_snapshot(pid)->>'version' is distinct from p_expected_version then",
                    "if false then"),
    'discount_formula': ('20261106310000_promo_syarat_hasil_sale_claims.sql', 'FORMULA_ANCHOR', 'FORMULA_MUTANT'),
}


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', default='/opt/data/kamo-pg-harness/bin')
    ap.add_argument('--baseline', action='store_true')
    ap.add_argument('--upto', type=int, default=len(CANDIDATES))
    ap.add_argument('--no-regression', action='store_true')
    ap.add_argument('--no-concurrency', action='store_true')
    ap.add_argument('--mutate', choices=sorted(MUTATIONS))
    args = ap.parse_args()
    cands = [] if args.baseline else CANDIDATES[:args.upto]
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
            applied = []
            for name, _ in cands:
                text = (ROOT / 'supabase/migrations' / name).read_text()
                if args.mutate and MUTATIONS[args.mutate][0] == name:
                    _, old, new = MUTATIONS[args.mutate]
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
                # edit_promo: only the SYARAT_HASIL_READONLY guard inserted
                e = 'public.edit_promo(uuid,text,jsonb,uuid[])'
                d0, d1 = meta_before[e]['definition'], after[e]['definition']
                anchor = "if jsonb_typeof(p_values) is distinct from 'object' or not p_values ?& fields"
                inserted = d1.replace(d0.split(anchor)[0], '', 1) if d1.startswith(d0.split(anchor)[0]) else None
                assert inserted is not None and inserted.endswith(anchor + d0.split(anchor)[1]) and 'SYARAT_HASIL_READONLY' in inserted.split(anchor)[0], 'edit_promo changed outside the readonly guard'
                assert {k: v for k, v in meta_before[e].items() if k != 'definition'} == {k: v for k, v in after[e].items() if k != 'definition'}, 'edit_promo ACL/config drift'
                print('PASS edit_promo differs only by the SYARAT_HASIL_READONLY guard; ACL/definer/search_path unchanged', flush=True)
                if len(cands) >= 2:
                    g = 'public.quantity_pool_finalize_guard()'
                    assert after[g]['definition'] != meta_before[g]['definition'] and 'SH_POOL' in after[g]['definition']
                    assert {k: v for k, v in meta_before[g].items() if k != 'definition'} == {k: v for k, v in after[g].items() if k != 'definition'}, 'pool guard ACL/config drift'
                    print('PASS quantity_pool_finalize_guard patched (SH_POOL markers present), ACL/definer/search_path unchanged', flush=True)
                if len(cands) >= 3:
                    c = 'public.cashier_post_stock_atomic(uuid,uuid)'
                    old_floor = "if line.hpp is null or (gross-item_discount)*net_total/after_items < line.hpp then"
                    assert meta_before[c]['definition'].count(old_floor) == 1
                    new_floor = "if line.hpp is null or (gross-item_discount)*net_total/after_items < case when coalesce(line.promo_floor_waiver,false) and manual<=0 then least(line.hpp,gross-item_discount) else line.hpp end then"
                    assert after[c]['definition'] == meta_before[c]['definition'].replace(old_floor, new_floor), 'cashier_post_stock_atomic differs outside the exact floor expression'
                    assert {k: v for k, v in meta_before[c].items() if k != 'definition'} == {k: v for k, v in after[c].items() if k != 'definition'}, 'cashier ACL/config drift'
                    print('PASS cashier_post_stock_atomic differs ONLY by the exact HPP-floor expression; ACL unchanged', flush=True)
                pol_after = json.loads(db.last(policies)); pol_before = json.loads(policies_before)
                for t in pol_before:  # existing tables: ACL/RLS/policies unchanged (new columns do not change them)
                    assert pol_before[t] == pol_after[t], 'ACL/RLS drift on ' + t
                print('PASS original ACL/RLS/policies on promos, promo_items, sales, sale_items, stock*, payments unchanged', flush=True)
            fixture_sql = (ROOT / 'supabase/tests/promo_syarat_hasil_fixture.sql').read_text()
            for name, suites in CANDIDATES[:args.upto]:
                for suite in suites:
                    body = (ROOT / 'supabase/tests' / suite).read_text()
                    print(db.sql('begin;\n' + fixture_sql + '\n' + body + '\nrollback;'), flush=True)
                    print('PASS suite', suite, flush=True)
            left = db.sql("select (select count(*) from promos where name like 'Direct %')+(select count(*) from promo_release_flags where enabled)")
            assert left == '0', 'suite fixtures leaked: ' + left
            print('PASS suites rolled back, release flags still OFF', flush=True)
            if cands and not args.no_regression and not args.mutate:
                for name in REGRESSION:
                    p = ROOT / 'supabase/tests' / name
                    if not p.exists():
                        print('SKIP (absent)', name)
                        continue
                    text = p.read_text()
                    if name == 'refund_payout.sql':
                        text = (ROOT / 'supabase/tests/pos_merchant_fees.sql').read_text().split('set local role authenticated;')[0] + text
                    db.sql(text)
                    print('PASS original regression', name, flush=True)
                prelude = (ROOT / 'supabase/tests/pos_merchant_fees.sql').read_text().split('set local role authenticated;')[0]
                db.sql(prelude + (ROOT / 'supabase/tests/refund_payout.sql').read_text())
                print('PASS original regression refund_payout.sql with the original merchant-fee fixture prelude', flush=True)
            if cands and len(cands) >= 2 and not args.no_concurrency and not args.mutate:
                concurrency(db, fixture_sql)
    return 0


def psql_async(db, sql, out):
    def run():
        r = subprocess.run(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                           input=sql, text=True, capture_output=True, env={**__import__('os').environ, 'PSQLRC': '/dev/null'})
        out.append((r.returncode, r.stdout, r.stderr))
    t = threading.Thread(target=run)
    t.start()
    return t


def concurrency(db, fixture_sql):
    """Two real sessions on a COMMITTED fixture: finalization vs deactivation, and two racing saves with one token."""
    suite = (ROOT / 'supabase/tests/promo_syarat_hasil_concurrency.sql')
    if not suite.exists():
        print('SKIP concurrency suite absent')
        return
    parts = suite.read_text().split('-- @@SESSION')
    setup, scenario = parts[0], parts[1:]
    print(db.sql(fixture_sql + '\n' + setup), flush=True)
    for chunk in scenario:
        header, body = chunk.split('\n', 1)
        sessions = [s for s in re.split(r'\n-- @@PARALLEL\n', body)]
        results = []
        threads = []
        for i, s in enumerate(sessions):
            threads.append(psql_async(db, s, results))
            time.sleep(0.6 if i == 0 else 0)
        for t in threads:
            t.join(60)
        print('CONCURRENCY', header.strip(), json.dumps([(rc, o.strip()[-300:], e.strip()[-300:]) for rc, o, e in results]), flush=True)
        check = chunk.split('-- @@CHECK', 1)
        if len(check) == 2:
            print(db.sql(check[1]), flush=True)
    print('PASS concurrency suite', flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
