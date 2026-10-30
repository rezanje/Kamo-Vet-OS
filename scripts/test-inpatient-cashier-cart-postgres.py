#!/usr/bin/env python3
"""Native full schema: editable inpatient cart -> original atomic352 engine."""
import argparse,importlib.util,json,sys,tempfile
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
spec=importlib.util.spec_from_file_location('medical',ROOT/'scripts/test-rekam-full-edit-postgres.py');assert spec and spec.loader
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
x,r,q,j=m.x,m.r,m.q,m.j
CANDIDATE='20261104090000_inpatient_cashier_pending_cart.sql'
RESULTS=[]
def check(name,ok,detail):
 RESULTS.append(dict(case=name,status='PASS' if ok else 'FAIL',detail=detail));print(RESULTS[-1],flush=True)
def read(h,v,stay):return json.loads(h.nilai(f'select clinic_read_inpatient_cashier({q(stay)},{q(v)});',r.STAFF))
def save(v,stay,snapshot,rows,parts,key='cashier-full',ack=None):
 return f"select clinic_save_inpatient_cashier({q(stay)},{q(v)},{q(key)},'2026-11-03',{q(snapshot)},{j(rows)},{j(parts)},{q(ack) if ack else 'null'},false,null,'Koreksi kasir Fiktif');"
def run(h):
 x.setup(h);v,mr=m.visit(h,1950);stay=h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
 try:cart=read(h,v,stay)
 except RuntimeError as e:check('public cashier draft reads all actual pending rows with current snapshot',False,str(e));return
 check('public cashier draft reads all actual pending rows with current snapshot',len(cart['rows'])==4 and bool(cart['snapshot']),cart)
 rows=cart['rows'];drug=next(row for row in rows if row['item_id']==r.ITEM);drug['qty']=3;sql=save(v,stay,cart['snapshot'],rows,[dict(method='Tunai',amount=355000)])
 err=h.gagal(sql,r.STAFF)
 inv=h.aktif(v);no=h.no_tagihan(inv)
 check('STAFF edits pending cart then atomic352 stock revenue receipt AR',not err and h.angka(f'select total from invoices where id={q(inv)}')==355000 and h.saldo_ref('4201',no)==-355000 and h.saldo_ref('5101',no)==6000 and h.saldo_ref('1201',no)==0 and h.angka(f'select qty from prescription_items where id={q(drug["id"])}')==3,dict(error=err,invoice=inv,total=h.angka(f'select total from invoices where id={q(inv)}')))
 snap=h.nilai('select count(*) from journal_entries');err=h.gagal(sql,r.STAFF)
 check('exact cashier replay once after pending became issued',not err and h.nilai('select count(*) from journal_entries')==snap,dict(error=err))
 v2,mr2=m.visit(h,1951);stay2=h.nilai(f'select id from inpatient_records where visit_id={q(v2)}');cart2=read(h,v2,stay2)
 sku=r.uid('e',1951)
 h.sql(f"insert into items(id,code,name,unit,item_type,is_active,sell_price) values({q(sku)},'UJI-KASIR-SVC','Jasa Kasir Fiktif','kali','Jasa',true,20000);")
 rows2=cart2['rows'][1:];removed=cart2['rows'][0]['id']
 drug2=next(row for row in rows2 if row['item_id']==r.ITEM);drug2.update(item_id=sku,nama_obat='Jasa Kasir Fiktif',jenis='jasa',harga=20000,satuan='kali')
 rows2.append(dict(id=r.uid('e',1952),item_id=sku,nama_obat='Jasa Kasir Fiktif',qty=1,harga=20000,satuan='kali',jenis='jasa'))
 amount=sum(row['qty']*row['harga'] for row in rows2)
 err=h.gagal(save(v2,stay2,cart2['snapshot'],rows2,[dict(method='Tunai',amount=amount)],key='replace-withdraw-add'),r.STAFF)
 check('replace remove add pending preserves clinical history and bills only current edited rows',not err and h.angka(f'select total from invoices where visit_id={q(v2)}')==amount and h.angka(f'select count(*) from prescription_items where id={q(removed)}')==1 and h.angka(f'select count(*) from invoice_items where prescription_item_id={q(removed)}')==0 and h.angka(f'select count(*) from medical_records where visit_id={q(v2)}')==1,dict(error=err,expected_total=amount))
 if not err:
  nextcart=read(h,v2,stay2)
  check('withdrawn pending never auto-billed again by original atomic352',len(nextcart['rows'])==0 and nextcart['quote']['pending']==0,nextcart['quote'])
  oldline=r.baris(1951,1)
  err=h.gagal(r.tagih_sql(v2,'withdrawn-stage-attack',oldline,r.STAFF),r.STAFF)
  check('original stage RPC cannot re-bill withdrawn source',bool(err and 'CART_INVALID' in err),dict(error=err))
 # Mandatory edited-draft overpay confirmation must leave ALL pending/audit/money
 # unchanged until acknowledged. Generated new IDs must survive the retry token.
 v3,mr3=m.visit(h,1953);stay3=h.nilai(f'select id from inpatient_records where visit_id={q(v3)}');cart3=read(h,v3,stay3)
 rows3=cart3['rows'];next(row for row in rows3 if row['item_id']==r.ITEM)['qty']=3
 rows3.append(dict(id=r.uid('e',1953),item_id=sku,nama_obat='Jasa Kasir Fiktif',qty=1,harga=20000,satuan='kali',jenis='jasa'))
 before=m.rows(h,mr3);audit=h.angka('select count(*) from clinic_pending_cart_edits');journal=h.angka('select count(*) from journal_entries')
 response=json.loads(h.nilai(save(v3,stay3,cart3['snapshot'],rows3,[dict(method='Tunai',amount=500000)],key='overpay-edited'),r.STAFF))
 check('edited overpayment first call writes nothing and quotes actual excess',response.get('status')=='OVERPAYMENT_CONFIRM_REQUIRED' and response['quote']['excess']==125000 and m.rows(h,mr3)==before and h.angka('select count(*) from clinic_pending_cart_edits')==audit and h.angka('select count(*) from journal_entries')==journal,response)
 if response.get('status')=='OVERPAYMENT_CONFIRM_REQUIRED':
  response=json.loads(h.nilai(save(v3,stay3,cart3['snapshot'],rows3,[dict(method='Tunai',amount=500000)],key='overpay-edited',ack=response['quote']['token']),r.STAFF))
  check('same edited draft acknowledgment commits actual invoice and owner advance once',response.get('status')=='SAVED' and h.angka(f'select total from invoices where visit_id={q(v3)}')==375000 and h.angka(f'select sum(amount-applied) from clinic_customer_advances where visit_id={q(v3)} and status=\'aktif\'')==125000,response)
 # A concurrent doctor addition invalidates the ENTIRE old draft, not just the
 # IDs the cashier happened to load. It cannot be overwritten/omitted silently.
 v4,mr4=m.visit(h,1954);stay4=h.nilai(f'select id from inpatient_records where visit_id={q(v4)}');cart4=read(h,v4,stay4)
 doc=m.rows(h,mr4);doc.append(dict(item_id=sku,nama_obat='Jasa Kasir Fiktif',qty=1,harga=20000,satuan='kali',jenis='jasa'))
 h.sql(m.edit(v4,mr4,0,doc,'doctor-add-after-cashier-read'),r.DOCTOR)
 before=m.rows(h,mr4);err=h.gagal(save(v4,stay4,cart4['snapshot'],cart4['rows'],[dict(method='Tunai',amount=330000)],key='stale-cashier'),r.STAFF)
 check('old cashier snapshot fails after doctor addition without overwriting any line',bool(err and 'CART_STALE' in err) and m.rows(h,mr4)==before and h.angka(f'select count(*) from invoices where visit_id={q(v4)}')==0,dict(error=err))
 # Rollback shortage includes earlier changed RX, withdrawal, new Rx and text.
 current=read(h,v4,stay4);bad=current['rows'];next(row for row in bad if row['item_id']==r.ITEM)['qty']=100000
 before=m.rows(h,mr4);audit=h.angka('select count(*) from clinic_pending_cart_edits');journal=h.angka('select count(*) from journal_entries')
 err=h.gagal(save(v4,stay4,current['snapshot'],bad,[],key='shortage-cart'),r.STAFF)
 check('original stock shortage rolls back Rx audit invoices receipt journal',bool(err) and m.rows(h,mr4)==before and h.angka('select count(*) from clinic_pending_cart_edits')==audit and h.angka('select count(*) from journal_entries')==journal and h.angka(f'select count(*) from invoices where visit_id={q(v4)}')==0,dict(error=err))
 # Real independent-session duplicate schedule, same coordinator -> own shift.
 import contextlib
 current=read(h,v4,stay4);amount=sum(row['qty']*row['harga'] for row in current['rows']);sql=save(v4,stay4,current['snapshot'],current['rows'],[dict(method='Tunai',amount=amount)],key='parallel-cart');barriers=[]
 with contextlib.ExitStack() as stack:
  observer=stack.enter_context(x.c.Session(h.db,'cart-observer'));first=stack.enter_context(x.c.Session(h.db,'cart-first'));first.sql(x.claims(r.STAFF));second=stack.enter_context(x.c.Session(h.db,'cart-second'));second.sql(x.claims(r.STAFF))
  first.sql('begin;'+sql);second.send('begin;'+sql);x.c.wait_block(observer,second,first,barriers);first.sql('commit;');out=x.c.attempt(second)
 check('concurrent cashier duplicate one invoice receipt stock posting no deadlock',out['ok'] and len(barriers)==1 and h.angka(f'select count(*) from invoices where visit_id={q(v4)}')==1 and h.angka(f'select count(*) from clinic_payment_receipts where visit_id={q(v4)}')==1,dict(outcome=out,barriers=barriers))
 check('cashier billing revision does not edit clinical text or revision',h.angka(f'select clinical_revision from medical_records where id={q(mr4)}')==1 and h.nilai(f'select anamnesis from medical_records where id={q(mr4)}')=='Koreksi Fiktif',{})
 for user in [r.FIN_NONAKTIF,r.FIN_LUAR]:
  err=h.gagal(sql,user);check('cashier fresh/replay denied current actor '+user,bool(err and 'ACCESS_DENIED' in err),dict(error=err))
 # Money received against an old DP is NOT a rewrite of its original header.
 v5=x.dp.visit(h,1955);h.sql(x.dp.post(v5,1955,user=r.STAFF),r.STAFF);stay5=h.nilai(f'select id from inpatient_records where visit_id={q(v5)}');old=h.aktif(v5)
 header=h.nilai(f'select to_jsonb(i) from invoices i where id={q(old)}');oldlines=h.nilai(f'select jsonb_agg(to_jsonb(l) order by id) from invoice_items l where invoice_id={q(old)}')
 h.sql(f"insert into prescription_items(id,medical_record_id,nama_obat,item_id,qty,harga,satuan,jenis) values({q(r.uid('e',1955))},{q(r.uid(7,1955))},'Jasa Kasir Fiktif',{q(sku)},1,20000,'kali','jasa');")
 cart5=read(h,v5,stay5);cart5['rows'][0]['qty']=2
 err=h.gagal(save(v5,stay5,cart5['snapshot'],cart5['rows'],[],key='followup-zero-dp'),r.STAFF)
 check('old DP header and issued lines immutable with optional zero-DP followup',not err and h.nilai(f'select to_jsonb(i) from invoices i where id={q(old)}')==header and h.nilai(f'select jsonb_agg(to_jsonb(l) order by id) from invoice_items l where invoice_id={q(old)}')==oldlines and h.angka(f'select count(*) from invoices where visit_id={q(v5)}')==2,dict(error=err))
 # Issued compound through THIS new wrapper, not only its original inner core.
 v7,mr7=m.visit(h,1957);stay7=h.nilai(f'select id from inpatient_records where visit_id={q(v7)}')
 h.sql(x.issue(v7,mr7,x.payload(h.nilai('select id from compound_formula_versions limit 1'),'cashier-existing-compound')),r.DOCTOR)
 cart7=read(h,v7,stay7);material_stock=h.angka(f'select qty from stock where item_id={q(x.MATERIAL)}');amount=sum(row['qty']*row['harga'] for row in cart7['rows'])
 err=h.gagal(save(v7,stay7,cart7['snapshot'],cart7['rows'],[dict(method='Tunai',amount=amount)],key='cashier-issued-compound'),r.STAFF)
 check('new cashier bills actual issued compound without second ingredient deduction',not err and cart7.get('compound_pending') is True and h.angka(f'select qty from stock where item_id={q(x.MATERIAL)}')==material_stock and h.saldo_ref('5101',h.no_tagihan(h.aktif(v7)))==6000,dict(error=err))
 # Outer editable wrapper must not hide an account-map change during its OWN
 # shift wait from the original engine (which later reacquires the same shift).
 v6,mr6=m.visit(h,1956);stay6=h.nilai(f'select id from inpatient_records where visit_id={q(v6)}');cart6=read(h,v6,stay6);barriers=[]
 with contextlib.ExitStack() as stack:
  observer=stack.enter_context(x.c.Session(h.db,'account-observer'));gate=stack.enter_context(x.c.Session(h.db,'account-gate'));waiter=stack.enter_context(x.c.Session(h.db,'account-waiter'));waiter.sql(x.claims(r.STAFF))
  gate.sql(f'begin;select id from cashier_shifts where id={q(r.SHIFT[r.STAFF])} for update;')
  waiter.send('begin;'+save(v6,stay6,cart6['snapshot'],cart6['rows'],[dict(method='Transfer',amount=330000)],key='account-wait-cart'))
  x.c.wait_block(observer,waiter,gate,barriers);gate.sql("update cash_accounts set no_rekening='FIKTIF-BERUBAH' where coa_code='1102';commit;");out=x.c.attempt(waiter)
 check('account mapping rechecked across outer cashier shift wait no silent new destination',not out['ok'] and ('ACCOUNT_INVALID' in out.get('error','') or 'CART_STALE' in out.get('error','')) and h.angka(f'select count(*) from invoices where visit_id={q(v6)}')==0,dict(outcome=out,barriers=barriers))

def main():
 p=argparse.ArgumentParser();p.add_argument('--baseline',action='store_true');p.add_argument('--json',type=Path,required=True);a=p.parse_args();sources=sorted((ROOT/'supabase/migrations').glob('*.sql'));selected=[s for s in sources if not(a.baseline and s.name==CANDIDATE)]
 try:
  with tempfile.TemporaryDirectory(prefix='chain.',dir=ROOT) as d:
   target=Path(d)/'supabase/migrations';target.mkdir(parents=True)
   for s in selected:(target/s.name).symlink_to(s)
   r.fixture.ROOT=Path(d)
   with r.NativePostgres(r.BIN) as db:r.fixture.DisposablePostgres.bootstrap(db);run(x.Harness(db))
 except Exception as e:check('HARNESS',False,str(e))
 totals={s:sum(c['status']==s for c in RESULTS) for s in ['PASS','FAIL']};a.json.write_text(json.dumps(dict(mode='RED' if a.baseline else 'candidate',migration_count=len(selected),cases=RESULTS,totals=totals),indent=2));print(totals);return int(totals['FAIL']>0)
if __name__=='__main__':sys.exit(main())
