#!/usr/bin/env python3
"""Local full original migration/public RPC proof. No URLs, business stubs or retries."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = '20261104040000_ranap_simpan_bayar.sql'
spec = importlib.util.spec_from_file_location('racikan', ROOT/'scripts/test-ranap-racikan-postgres.py')
assert spec is not None and spec.loader is not None
x = importlib.util.module_from_spec(spec)
spec.loader.exec_module(x)
r, q, j = x.r, x.q, x.j
RESULTS = []

class LocalPostgres(r.NativePostgres):
    def __enter__(self):
        self.root = Path(tempfile.mkdtemp(prefix='pg.', dir=ROOT))
        self.as_user = ['runuser','-u','postgres','--'] if os.geteuid() == 0 else []
        if self.as_user: shutil.chown(self.root, 'postgres')
        self.run(self.bin/'initdb','-D',self.root/'data','-U','postgres','-E','UTF8','--locale=C.UTF-8','-A','trust')
        self.run(self.bin/'pg_ctl','-D',self.root/'data','-l',self.root/'log','-w','start','-o',f"-c listen_addresses='' -k {self.root} -c timezone=Etc/UTC -c shared_buffers=128MB")
        return self

def check(case, ok, detail):
    RESULTS.append(dict(case=case,status='PASS' if ok else 'FAIL',detail=detail))
    print(RESULTS[-1]['status'],case,json.dumps(detail),flush=True)

def bill(v, n, parts, ack=None, credit=False, record=None, key=None, reason=None):
    return f"select public.clinic_bill_and_pay_inpatient({q(record or r.uid(7,n))},{q(v)},{q(key or 'unified-'+str(n))},'2026-11-03',{j(parts)},{q(ack) if ack else 'null'},{'true' if credit else 'false'},{q(reason) if reason else 'null'});"

def state(h):
    return h.nilai("select jsonb_build_object('invoices',(select jsonb_agg(to_jsonb(t) order by id) from invoices t),'payments',(select jsonb_agg(to_jsonb(t) order by id) from invoice_payments t),'receipts',(select jsonb_agg(to_jsonb(t) order by id) from clinic_payment_receipts t),'advances',(select jsonb_agg(to_jsonb(t) order by id) from clinic_customer_advances t),'stock',(select jsonb_agg(to_jsonb(t) order by item_id) from stock t),'layers',(select jsonb_agg(to_jsonb(t) order by id) from stock_layers t),'moves',(select jsonb_agg(to_jsonb(t) order by id) from stock_moves t),'journals',(select jsonb_agg(to_jsonb(t) order by id) from journal_entries t),'lines',(select jsonb_agg(to_jsonb(t) order by id) from journal_lines t),'rx',(select jsonb_agg(to_jsonb(t) order by id) from prescription_items t))")

def tracer(h):
    h.sql("insert into role_modules(role,module_id) values('FINANCE','klinik') on conflict do nothing;")
    v=r.buat_kunjungan(h,900,r.buat_pelanggan(h,900))
    before=h.angka(f'select qty from stock where item_id={q(r.ITEM)}')
    sql=bill(v,900,[dict(method='Tunai',amount=130000),dict(method='Transfer',amount=200000)],record=h.nilai(f'select id from inpatient_records where visit_id={q(v)}'))
    error=h.gagal(sql,r.STAFF)
    check('one action pending medicine and services posts invoice stock revenue AR actual split receipt',not error,dict(error=error))
    if error:return False
    inv=h.aktif(v);no=h.no_tagihan(inv)
    check('real invoice and journal amounts',h.angka(f'select total from invoices where id={q(inv)}')==330000 and h.diterima(inv)==330000 and h.status_bayar(inv)=='Lunas' and h.angka(f'select qty from stock where item_id={q(r.ITEM)}')==before-2 and h.saldo_ref('510002',no)==-330000 and h.saldo_ref('600001',no)==4000 and h.saldo_ref('170001',no)==-4000 and h.saldo_ref('150001',no)==0,dict(invoice=inv,revenue=h.saldo_ref('510002',no),hpp=h.saldo_ref('600001',no),ar=h.saldo_ref('150001',no),stock=h.angka(f'select qty from stock where item_id={q(r.ITEM)}')))
    snap=state(h);h.sql(sql,r.STAFF)
    check('exact replay invoice receipt stock GL once',state(h)==snap,dict(unchanged=state(h)==snap))
    return True

def credit_against_old_debt(h):
    customer=r.buat_pelanggan(h,901)
    v=r.buat_kunjungan(h,901,customer)
    # Original public ordinary DP followed by typed admission already exists here.
    h.sql(r.tagih_sql(v,'credit-old-stage',r.baris(901,1),r.FINANCE, ganti={'dp_override_reason':'Fiktif awal piutang'}),r.FINANCE)
    other=r.buat_kunjungan(h,902,customer)
    h.sql(r.bayar_sql(other,'owner-other-credit',[dict(method='Transfer',amount=400000)]),r.STAFF)
    record=h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
    sql=bill(v,901,[],record=record)
    err=h.gagal(sql,r.STAFF)
    check('available owner advance offsets existing and pending debt without collecting twice',not err and h.angka(f"select sum(i.total-clinic_private.invoice_received(i.id)) from invoices i where visit_id={q(v)} and voided_at is null")==0,dict(error=err,debt=h.angka(f"select sum(i.total-clinic_private.invoice_received(i.id)) from invoices i where visit_id={q(v)} and voided_at is null")))


def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline',action='store_true');p.add_argument('--json',type=Path,required=True);p.add_argument('--definitions',type=Path);args=p.parse_args()
    migrations=sorted((ROOT/'supabase/migrations').glob('*.sql'))
    selected=[m for m in migrations if not(args.baseline and m.name==CANDIDATE)]
    try:
        with tempfile.TemporaryDirectory(prefix='chain.',dir=ROOT) as folder:
            target=Path(folder)/'supabase/migrations';target.mkdir(parents=True)
            for source in selected:(target/source.name).symlink_to(source)
            r.fixture.ROOT=Path(folder)
            with LocalPostgres(r.BIN) as db:
                r.fixture.DisposablePostgres.bootstrap(db);h=x.Harness(db)
                if args.definitions: args.definitions.write_text(db.sql("select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in ('clinic_post_invoice','clinic_post_inpatient_stage_invoice','clinic_receive_visit_payment')) or (n.nspname='clinic_private' and p.proname in ('invoice_received','enforce_min_dp')) order by n.nspname,p.proname"))
                version=x.setup(h)
                if tracer(h) and not args.baseline:
                    credit_against_old_debt(h)
                    import ranap_bayar_cases
                    ranap_bayar_cases.run(sys.modules[__name__],h,db,version)
    except Exception as error:check('HARNESS',False,str(error))
    totals={s:sum(c['status']==s for c in RESULTS) for s in ['PASS','FAIL']}
    args.json.write_text(json.dumps(dict(mode='RED baseline' if args.baseline else 'candidate',migration_count=len(selected),cases=RESULTS,totals=totals),indent=2));print('TOTAL',totals)
    return int(totals['FAIL']>0)

if __name__=='__main__':sys.exit(main())
