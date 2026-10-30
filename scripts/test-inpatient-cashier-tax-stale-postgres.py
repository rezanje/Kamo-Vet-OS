#!/usr/bin/env python3
"""Reproduce/reject stale tax settings through the actual cashier public RPC."""
import sys,json,tempfile,importlib.util,argparse
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('cashier',ROOT/'scripts/test-inpatient-cashier-cart-postgres.py');assert spec and spec.loader
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
r,x,q=t.r,t.x,t.q
p=argparse.ArgumentParser();p.add_argument('--json',type=Path,required=True);a=p.parse_args();cases:list[dict[str,object]]=[];out:dict[str,object]={'cases':cases}
def state(h,v):
 return h.nilai(f"select jsonb_build_object('invoices',(select count(*) from invoices where visit_id={q(v)}),'receipts',(select count(*) from clinic_payment_receipts where visit_id={q(v)}),'audit',(select count(*) from clinic_pending_cart_edits where visit_id={q(v)}),'rx',(select jsonb_agg(to_jsonb(p) order by p.id) from prescription_items p join medical_records m on m.id=p.medical_record_id where m.visit_id={q(v)}),'journal',(select count(*) from journal_entries),'stock',(select sum(qty) from stock))")
with r.NativePostgres(r.BIN) as db:
 r.fixture.DisposablePostgres.bootstrap(db);h=x.Harness(db);x.setup(h)
 v,m=t.m.visit(h,1980);stay=h.nilai(f'select id from inpatient_records where visit_id={q(v)}');draft=t.read(h,v,stay);before=state(h,v)
 h.sql("update company_settings set mode_pkp=true,ppn_rate=12 where id=true",r.OWNER)
 error=h.gagal(t.save(v,stay,draft['snapshot'],draft['rows'],[dict(method='Tunai',amount=int(draft['quote']['remaining']))],key='tax-changed-after-read'),r.STAFF)
 unchanged=state(h,v)==before
 case={'case':'tax change after cashier draft read requires fresh snapshot before ANY writes','status':'PASS' if error and 'CART_STALE' in error and unchanged else 'FAIL','error':error,'unchanged':unchanged};cases.append(case);print(json.dumps(case),flush=True)
out['totals']={s:sum(c['status']==s for c in cases) for s in ('PASS','FAIL')};a.json.write_text(json.dumps(out,indent=2));sys.exit(int(out['totals']['FAIL']>0))
