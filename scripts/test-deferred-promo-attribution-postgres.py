#!/usr/bin/env python3
"""PENDING acceptance: ineligible attribution must be rejected. Intentionally RED.
Loads the preserved ORIGINAL candidate only in disposable local PG17 after the
complete current chain. Never installed by the independently usable import slice.
Run under flock /opt/data/kamo-heavy-test.lock; --json captures real counterexamples.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('promo_import',ROOT/'scripts/test-promo-master-import-postgres.py')
assert spec is not None and spec.loader is not None
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json',type=Path,required=True)
    args=parser.parse_args()
    cases=[]
    with m.NativePostgres('/opt/data/kamo-pg-harness/bin') as db:
        m.fixture.DisposablePostgres.bootstrap(db)
        original=ROOT/'docs/deferred/promo-reporting/original-unapplied-0415.sql'
        db.sql('begin;'+original.read_text()+'\ncommit;')
        h=m.Harness(db)
        h.sql(m.life.dasar_sql())
        promo=m.life.uid('e',1)
        h.sql(f"insert into promos(id,name,promo_type,rule,auto_apply,discount_type,discount_value,is_active,valid_until) values('{promo}','Ineligible false attribution','diskon_produk','{{}}',false,'percent',1,false,'2020-01-01');")
        for n,user in [(201,m.life.STAFF),(202,m.life.DOCTOR)]:
            c=m.life.buat_pelanggan(h,n)
            v=m.life.buat_kunjungan(h,n,c,False)
            lines=m.life.baris(n,3)
            lines[0].update(promo_id=promo,promo_discount=10000)
            source=m.life.tagih_biasa_sql(v,f'spoof-{n}',lines,user,dp=20000,ganti={'discount':10000,'total':40000,'voucher_discount':0,'diskon_kategori':0})
            error=h.gagal(source,user)
            stored=json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object('invoice',i.id,'discount',i.discount,'promo_id',ii.promo_id,'promo_discount',ii.promo_discount,'hpp',ii.hpp)),'[]') from invoices i join invoice_items ii on ii.invoice_id=i.id where i.visit_id='{v}';"))
            cases.append({'case':m.life.PERAN[user]+' cannot attribute discount to inactive ineligible promo',
                          'status':'PASS' if error else 'FAIL','error':error,'persisted':stored})
    result={'checkpoint_head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
            'deferred_candidate_source':'cb1135bad7f67405074705fe70f1fdef6d85b936',
            'cases':cases,'totals':{s:sum(r['status']==s for r in cases) for s in ('PASS','FAIL')}}
    args.json.write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
    sys.exit(bool(result['totals']['FAIL']))


if __name__=='__main__':
    main()
