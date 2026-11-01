#!/usr/bin/env python3
"""Backoffice /pos/transaksi atomic posting: fictional fixtures on a throwaway PostgreSQL.

Never accepts a database URL. Applies every repository migration EXCEPT the candidate,
fingerprints the original money/stock/finalization functions, applies the candidate
last, proves those originals are byte-identical, then runs (each suite rolls back):
  supabase/tests/pos_backoffice_atomic.sql   parity with the old per-line path, mid-line
                                             failure rollback, retry without double issue
  regression: cashier_atomic_fifo_floor.sql, pos_split_payments.sql, pos_merchant_fees.sql,
              quantity_pool_pricing.sql, pos_payment_method_corrections.sql, sales_safe_posting.sql,
              c05_campaign_codes.sql, c05_q01_followup.sql
  (p03_price_floor.sql and posted_sale_cancellations.sql already fail on main without this
  migration because their fixtures predate later clinic/warehouse rules, so they are not used.)

Usage:
  python3 scripts/test-pos-backoffice-atomic-postgres.py                # Docker postgres:16, network none
  python3 scripts/test-pos-backoffice-atomic-postgres.py --pg-bin DIR   # native throwaway cluster
  e.g. --pg-bin /usr/lib/postgresql/16/bin
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = '20261106030000_pos_backoffice_atomic.sql'
SUITE = 'pos_backoffice_atomic.sql'
REGRESSIONS = ['cashier_atomic_fifo_floor.sql', 'pos_split_payments.sql', 'pos_merchant_fees.sql',
               'quantity_pool_pricing.sql', 'pos_payment_method_corrections.sql', 'sales_safe_posting.sql',
               'c05_campaign_codes.sql', 'c05_q01_followup.sql']
ORIGINALS = ("('sale_stock_out_fifo','stock_out_fifo','finalize_pos_sale','pos_sale_assert_actor',"
             "'pos_sale_record_payments','pos_sale_cancel_pending','cashier_post_stock_atomic',"
             "'quantity_pool_post_backoffice_atomic','quantity_pool_finalize_guard','cancel_posted_sale')")
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def run(db, bootstrap):
    with tempfile.TemporaryDirectory(prefix='pos-backoffice-atomic-') as tmp:
        migrations = Path(tmp) / 'supabase/migrations'
        migrations.mkdir(parents=True)
        for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
            if path.name != CANDIDATE:
                (migrations / path.name).symlink_to(path)
        fixture.ROOT = Path(tmp)
        try:
            bootstrap(db)
        finally:
            fixture.ROOT = ROOT
    fingerprint = ("select coalesce(jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object("
                   "'body',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text,'definer',p.prosecdef)),'{}') "
                   "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in " + ORIGINALS)
    policies = ("select jsonb_object_agg(c.relname,jsonb_build_object('acl',c.relacl::text,'rls',c.relrowsecurity,"
                "'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') from pg_policies p "
                "where p.schemaname='public' and p.tablename=c.relname))) from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                "where n.nspname='public' and c.relname in('sales','sale_items','stock','stock_layers','stock_moves','sale_payments','journal_entries','journal_lines')")
    before, policies_before = json.loads(db.last(fingerprint)), db.last(policies)
    assert len(before) == 10, 'Expected all original functions present: ' + json.dumps(sorted(before))
    candidate = ROOT / 'supabase/migrations' / CANDIDATE
    db.sql('begin;\n' + candidate.read_text() + '\ncommit;')
    print('FORWARD', CANDIDATE, 'sha256', hashlib.sha256(candidate.read_bytes()).hexdigest(), flush=True)
    assert before == json.loads(db.last(fingerprint)), 'Original stock/payment/finalization function drift'
    assert policies_before == db.last(policies), 'Original ACL/RLS policy drift'
    print('PASS original FIFO/finalizer/cancellation function bodies, grants and RLS policies unchanged', flush=True)
    print('PostgreSQL', db.last('show server_version'), flush=True)
    for name in [SUITE] + REGRESSIONS:
        output = db.sql((ROOT / 'supabase/tests' / name).read_text())
        if name == SUITE:
            print(output, flush=True)
        print('PASS ' + name, flush=True)
    left = db.sql("select (select count(*) from sales where no_struk like 'BOA.%')"
                  "+(select count(*) from branches where code like 'BOA%');")
    assert left == '0', 'Fixture rows leaked: ' + left
    print('PASS backoffice atomic fixtures rolled back', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--pg-bin', help='PostgreSQL bin dir for a native throwaway cluster instead of Docker')
    args = parser.parse_args()
    if args.pg_bin:
        sys.path.insert(0, str(ROOT / 'scripts'))
        from native_postgres import NativePostgres
        if sys.platform == 'darwin':
            os.environ.setdefault('LC_ALL', 'en_US.UTF-8')
        with NativePostgres(args.pg_bin) as db:
            run(db, lambda target: fixture.DisposablePostgres.bootstrap(target))
    else:
        with fixture.DisposablePostgres() as db:
            run(db, lambda target: target.bootstrap())


if __name__ == '__main__':
    main()
