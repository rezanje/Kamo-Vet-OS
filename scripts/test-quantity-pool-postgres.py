#!/usr/bin/env python3
"""Quantity-pool proof on unmodified full main schema + forward migration last.
Fictional data, original public business RPCs, disposable socket-only native PG17.
No URL/credentials/network. Run under /opt/data/kamo-heavy-test.lock.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = '20261105020000_quantity_pool_pricing.sql'
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres
spec = importlib.util.spec_from_file_location('fullschema', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
assert spec is not None and spec.loader is not None
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', action='store_true')
    parser.add_argument('--pg-bin', default='/opt/data/kamo-pg-harness/bin')
    parser.add_argument('--suite', default='quantity_pool_pricing.sql')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='qp-main-', dir='/opt/data') as tmp:
        migrations = Path(tmp) / 'supabase/migrations'
        migrations.mkdir(parents=True)
        originals = sorted(p for p in (ROOT/'supabase/migrations').glob('*.sql') if p.name != CANDIDATE)
        for p in originals:
            (migrations/p.name).symlink_to(p)
        fixture.ROOT = Path(tmp)
        with NativePostgres(args.pg_bin) as db:
            fixture.DisposablePostgres.bootstrap(db)
            preserved = "('cashier_post_stock_atomic','finalize_pos_sale','pos_sale_assert_actor','pos_sale_record_payments','pos_sale_post_refund_selected','cancel_posted_sale','sale_stock_out_fifo')"
            sql = "select coalesce(jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))),'{}') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in " + preserved
            before = json.loads(db.last(sql))
            assert 170000 <= int(db.last('show server_version_num')) < 180000, 'Native PostgreSQL17 required'
            refund_patches={
                'public.sales_refund_quote(uuid,jsonb,uuid)':('raw_total:=raw_total+base*l.harga/l.faktor*ratio;', 'raw_total:=raw_total+base*public.quantity_pool_refund_unit_price(l.id,l.harga/l.faktor*ratio);'),
                'public.return_record_post_base(text,uuid,text,jsonb,jsonb)':('price:=src.harga/src.faktor*ratio;', 'price:=public.quantity_pool_refund_unit_price(src.id,src.harga/src.faktor*ratio);'),
            }
            def function_meta(sig):
                return json.loads(db.last("select jsonb_build_object('definition',pg_get_functiondef(oid),'acl',proacl::text,'definer',prosecdef,'config',proconfig) from pg_proc where oid='"+sig+"'::regprocedure"))
            refund_before={sig:function_meta(sig) for sig in refund_patches}
            policies="select jsonb_object_agg(c.relname,jsonb_build_object('acl',c.relacl::text,'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') from pg_policies p where p.schemaname='public' and p.tablename=c.relname))) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('sales','sale_items','stock','stock_layers','stock_moves','promos','promo_items','sale_payments','sale_payment_refunds')"
            policies_before=db.last(policies)
            print('ORIGINAL RPC HASHES', json.dumps(before, sort_keys=True), flush=True)
            if not args.baseline:
                candidate = ROOT/'supabase/migrations'/CANDIDATE
                db.sql(candidate.read_text())
                print('FORWARD', CANDIDATE, 'sha256', hashlib.sha256(candidate.read_bytes()).hexdigest(), flush=True)
                assert before == json.loads(db.last(sql)), 'Original money/stock/role/finalization RPC definition drift'
                assert policies_before==db.last(policies), 'Original ACL/RLS policy drift'
                for sig,(old,new) in refund_patches.items():
                    meta=refund_before[sig].copy()
                    assert meta['definition'].count(old)==1
                    meta['definition']=meta['definition'].replace(old,new)
                    assert meta==function_meta(sig), 'Refund changed outside exact source-price expression: '+sig
                print('PASS original ACL/RLS policies unchanged; BOTH refund cores differ only by exact source-price expression', flush=True)
                print('PASS original roles/stock/FIFO/HPP/payments/finalization/cancellation function bodies unchanged', flush=True)
            suite = ROOT/'supabase/tests'/args.suite
            print(db.sql(suite.read_text()), flush=True)
            print('PASS', args.suite, flush=True)
            if not args.baseline:
                for name in ['cashier_atomic_fifo_floor.sql', 'pos_split_payments.sql', 'pos_merchant_fees.sql']:
                    p=ROOT/'supabase/tests'/name
                    if p.exists():
                        db.sql(p.read_text())
                        print('PASS original regression', name, flush=True)
                prelude=(ROOT/'supabase/tests/pos_merchant_fees.sql').read_text().split('set local role authenticated;')[0]
                db.sql(prelude+(ROOT/'supabase/tests/refund_payout.sql').read_text())
                print('PASS original regression refund_payout.sql with original merchant-fee fixture prelude', flush=True)
    return 0
if __name__ == '__main__':
    raise SystemExit(main())
