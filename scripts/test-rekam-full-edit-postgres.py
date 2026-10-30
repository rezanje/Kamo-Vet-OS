#!/usr/bin/env python3
"""Local full-schema public-RPC tracer. Platform shims only; fictional fixtures."""
import argparse, importlib.util, json, sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
spec=importlib.util.spec_from_file_location('ranap',ROOT/'scripts/test-ranap-racikan-postgres.py')
assert spec and spec.loader
x=importlib.util.module_from_spec(spec);spec.loader.exec_module(x)
r,q,j=x.r,x.q,x.j
CANDIDATE='20261104080000_doctor_full_record_edit.sql'
RESULTS=[]
def check(name,ok,detail):
 RESULTS.append(dict(case=name,status='PASS' if ok else 'FAIL',detail=detail));print(RESULTS[-1],flush=True)
def edit(v,m,revision,rows,key='full-edit',fields=None):
 return f"select public.clinic_edit_queued_record({q(v)},{q(m)},{revision},{j(fields or dict(anamnesis='Koreksi Fiktif',diagnosis='Diagnosis Fiktif',therapy='Terapi Fiktif',suhu=38.25,gejala_klinis=None,hasil_penunjang=None))},{j(rows)},'Alasan Fiktif',{q(key)});"
def visit(h,n):
 v=r.buat_kunjungan(h,n,r.buat_pelanggan(h,n))
 m=r.uid(7,n)
 h.sql(f"update medical_records set submission_key='initial-{n}',submitted_by={q(r.DOCTOR)} where id={q(m)}; update visits set status='Pembayaran',service_started_at=now()-interval '10 minutes',service_finished_at=now() where id={q(v)};")
 return v,m
def rows(h,m):return json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from prescription_items p where medical_record_id={q(m)}"))
def run(h):
 x.setup(h)
 v,m=visit(h,1900);before=rows(h,m);cart=[dict(row) for row in before]
 cart[0]['qty']=3
 sql=edit(v,m,0,cart)
 err=h.gagal(sql,r.DOCTOR)
 check('DOCTOR public full roundtrip same record ordinary qty no stock invoice',not err and rows(h,m)[0]['qty']==3 and h.angka(f'select count(*) from medical_records where visit_id={q(v)}')==1 and h.angka(f'select count(*) from invoices where visit_id={q(v)}')==0,dict(error=err))
 if err:return
 snap=h.nilai(f"select to_jsonb(m) from medical_records m where id={q(m)}")
 err=h.gagal(sql,r.DOCTOR)
 check('exact replay once',not err and h.nilai(f"select to_jsonb(m) from medical_records m where id={q(m)}")==snap,dict(error=err))
 for user in [r.OWNER,r.ADMIN,r.STAFF,r.FINANCE,r.FIN_NONAKTIF,r.FIN_LUAR]:
  err=h.gagal(edit(v,m,1,cart,'deny-'+user),user)
  check('persisted role denied '+r.PERAN[user]+' '+user,bool(err and 'ACCESS_DENIED' in err),dict(error=err))
 # Existing legacy text-only API must not undermine the feature-specific role gate.
 err=h.gagal(f"select clinic_correct_unpaid_record({q(v)},{q(m)},1,{j(dict(anamnesis='STAFF',diagnosis=None,therapy=None,suhu=None,gejala_klinis=None,hasil_penunjang=None))},'Denied legacy','legacy-denied');",r.STAFF)
 check('legacy STAFF correction denied',bool(err and ('42501' in err or 'ditolak' in err or 'permission denied' in err)),dict(error=err))
 check('same identity revision history',h.angka(f'select clinical_revision from medical_records where id={q(m)}')==1,dict(revision=h.angka(f'select clinical_revision from medical_records where id={q(m)}')))
 # Real inventory procedure BMHP: record-only save does not issue, then billing
 # uses the unchanged original BMHP/stock/job-order engine exactly once.
 material=x.MATERIAL; procedure=r.uid('e',1900)
 h.sql(f"insert into item_categories(id,name) values({q(r.uid('e',1901))},'TINDAKAN');insert into items(id,code,name,unit,item_type,is_active,sell_price,category_id) values({q(procedure)},'UJI-FULL-PROC','Tindakan Fiktif','kali','Persediaan',true,80000,{q(r.uid('e',1901))});")
 cart=rows(h,m);cart[2].update(item_id=procedure,nama_obat='Tindakan Fiktif',qty=2,harga=80000,satuan='kali',jenis='obat',bmhp_components=[dict(item_id=material,qty=3,unit='gram')])
 stock=h.angka(f'select qty from stock where item_id={q(material)}')
 err=h.gagal(edit(v,m,1,cart,'full-bmhp'),r.DOCTOR)
 check('DOCTOR replace product with procedure and BMHP same Rx ID no early stock',not err and h.angka(f'select qty from stock where item_id={q(material)}')==stock and rows(h,m)[2]['item_id']==procedure and rows(h,m)[2]['bmhp_components'][0]['qty']==3,dict(error=err))
 # Preserve issued recipe reference and its original stock movement, never reissue.
 sql=x.issue(v,m,x.payload(h.nilai('select id from compound_formula_versions limit 1'),'full-compound'))
 err=h.gagal(sql,r.DOCTOR)
 check('fixture original public compound issue',not err,dict(error=err))
 if not err:
  stock=h.angka(f'select qty from stock where item_id={q(material)}');cart=rows(h,m)
  err=h.gagal(edit(v,m,2,cart,'keep-issued'),r.DOCTOR)
  check('issued compound kept without second stock issue',not err and h.angka(f'select qty from stock where item_id={q(material)}')==stock,dict(error=err))
 # Component failure must undo text revision, audit and earlier ordinary rows.
 cart=rows(h,m);snapshot=h.nilai(f"select to_jsonb(m) from medical_records m where id={q(m)}");oldrows=rows(h,m)
 cart[0]['qty']=9;cart[2]['bmhp_components']=[dict(item_id=material,qty=-1,unit='gram')]
 err=h.gagal(edit(v,m,3,cart,'invalid-bmhp'),r.DOCTOR)
 check('invalid BMHP atomic rollback clinical Rx audit stock',bool(err) and rows(h,m)==oldrows and h.nilai(f"select to_jsonb(m) from medical_records m where id={q(m)}")==snapshot,dict(error=err))
 for user in [r.STAFF,r.DOCTOR]:
  err=h.gagal(f"update prescription_items set qty=20 where id={q(oldrows[0]['id'])};",user)
  check('direct submitted Rx update denied '+r.PERAN[user],bool(err and 'ACCESS_DENIED' in err),dict(error=err))
 # A raw INSERT also cannot bypass the doctor editor. Transaction deliberately
 # rolls back if the unguarded baseline succeeds, preserving later test fixtures.
 err=h.gagal(f"begin; insert into prescription_items(medical_record_id,nama_obat,qty,harga,jenis) values({q(m)},'Forged STAFF item',1,100,'obat');rollback;",r.STAFF)
 check('direct submitted Rx insert denied STAFF',bool(err and 'ACCESS_DENIED' in err),dict(error=err))
 # Source attribution is real normalized data, not NULL-only toy rows: a new
 # line ordered by the doctor must keep its doctor when the product is replaced.
 cart=rows(h,m);cart.append(dict(item_id=r.ITEM,nama_obat='Obat Fiktif',qty=1,harga=25000,satuan='pcs',jenis='obat',service_performers=dict(doctor_id=r.DOKTER_PEGAWAI,staff_id=None)))
 err=h.gagal(edit(v,m,3,cart,'add-attributed'),r.DOCTOR)
 check('doctor new row carries normalized ordering attribution',not err,dict(error=err))
 if not err:
  cart=rows(h,m);newrow=next(row for row in cart if row['id'] not in {old['id'] for old in oldrows});author=newrow['service_performers'];newrow.update(item_id=material,nama_obat='Bahan racik Fiktif',harga=5000,satuan='gram')
  err=h.gagal(edit(v,m,4,cart,'replace-attributed'),r.DOCTOR)
  check('doctor replaces attributed product without rewriting who ordered it',not err and next(row for row in rows(h,m) if row['id']==newrow['id'])['service_performers']==author,dict(error=err))
 # Actual money-engine concurrency: doctor owns coordinator first, cashier waits,
 # then sees the committed clinical cart. No reverse row/coord order, no 40P01.
 import contextlib
 v2,m2=visit(h,1902);cart2=rows(h,m2);cart2[0]['qty']=2
 stay=h.nilai(f'select id from inpatient_records where visit_id={q(v2)}')
 sql=f"select public.clinic_bill_and_pay_inpatient({q(stay)},{q(v2)},'post-race','2026-11-03','[{{\"method\":\"Tunai\",\"amount\":430000}}]'::jsonb,null,false,null);"
 barriers=[]
 with contextlib.ExitStack() as stack:
  observer=stack.enter_context(x.c.Session(h.db,'full-observer'))
  first=stack.enter_context(x.c.Session(h.db,'full-doctor'));first.sql(x.claims(r.DOCTOR))
  second=stack.enter_context(x.c.Session(h.db,'full-cashier'));second.sql(x.claims(r.STAFF))
  first.sql('begin;'+edit(v2,m2,0,cart2,'doctor-first'))
  second.send('begin;'+sql)
  x.c.wait_block(observer,second,first,barriers);first.sql('commit;');out=x.c.attempt(second)
 check('doctor save then cashier atomic352 post real lock barrier no deadlock',out['ok'] and len(barriers)==1 and h.angka(f'select sum(total) from invoices where visit_id={q(v2)}')==430000,dict(outcome=out,barriers=barriers))
 err=h.gagal(edit(v2,m2,1,cart2,'after-post'),r.DOCTOR)
 check('posted DP or paid stage closes doctor edit',bool(err and 'RECORD_POSTED' in err),dict(error=err))
 # A role revoked while queued must be re-read before mutations/replay.
 v3,m3=visit(h,1903);cart3=rows(h,m3);barriers=[]
 with contextlib.ExitStack() as stack:
  observer=stack.enter_context(x.c.Session(h.db,'revoke-observer'));gate=stack.enter_context(x.c.Session(h.db,'revoke-gate'))
  waiter=stack.enter_context(x.c.Session(h.db,'revoke-doctor'));waiter.sql(x.claims(r.DOCTOR))
  gate.sql(f'begin;select clinic_private.billing_lock(clinic_private.billing_keys_visit({q(v3)}));')
  waiter.send('begin;'+edit(v3,m3,0,cart3,'revoked'))
  x.c.wait_block(observer,waiter,gate,barriers)
  gate.sql(f"update profiles set role='STAFF' where id={q(r.DOCTOR)};commit;");out=x.c.attempt(waiter)
 h.sql(f"update profiles set role='DOCTOR' where id={q(r.DOCTOR)}")
 check('persisted doctor role rechecked after coordinator wait',not out['ok'] and 'ACCESS_DENIED' in out.get('error','') and h.angka(f'select clinical_revision from medical_records where id={q(m3)}')==0,dict(outcome=out,barriers=barriers))
 # Post the saved inventory procedure and previously issued compound through
 # the actual 352 wrapper: material stock/HPP are real, not mocked cores.
 stay=h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
 quote=json.loads(h.nilai(f'select clinic_quote_inpatient_payment({q(stay)},{q(v)},\'[]\');',r.STAFF))
 stock=h.angka(f'select qty from stock where item_id={q(material)}')
 parts=[dict(method='Tunai',amount=int(quote['remaining']))]
 err=h.gagal(f"select clinic_bill_and_pay_inpatient({q(stay)},{q(v)},'post-full-bmhp','2026-11-03',{j(parts)},null,false,null);",r.STAFF)
 inv=h.aktif(v);no=h.no_tagihan(inv)
 check('saved procedure BMHP posts original stock HPP once with issued compound preserved',not err and h.angka(f'select qty from stock where item_id={q(material)}')==stock-4 and h.angka(f'select total from invoices where id={q(inv)}')==quote['pending'] and h.saldo_ref('5101',no)==6000 and h.saldo_ref('1201',no)==0,dict(error=err,quote=quote,stock_before=stock,stock_after=h.angka(f'select qty from stock where item_id={q(material)}'),hpp=h.saldo_ref('5101',no)))

def main():
 p=argparse.ArgumentParser();p.add_argument('--baseline',action='store_true');p.add_argument('--include-cashier',action='store_true');p.add_argument('--json',type=Path,required=True);a=p.parse_args()
 # Bootstrap the entire original chain first, then the candidate (never fingerprint bypass).
 candidates=list((ROOT/'supabase/migrations').glob('*.sql'))
 import tempfile
 with tempfile.TemporaryDirectory(prefix='chain.',dir=ROOT) as d:
  root=Path(d);target=root/'supabase/migrations';target.mkdir(parents=True)
  selected=[s for s in candidates if not(a.baseline and s.name==CANDIDATE) and (a.include_cashier or s.name!='20261104090000_inpatient_cashier_pending_cart.sql')]
  for s in selected:(target/s.name).symlink_to(s)
  r.fixture.ROOT=root
  try:
   with r.NativePostgres(r.BIN) as db:
    r.fixture.DisposablePostgres.bootstrap(db)
    run(x.Harness(db))
  except Exception as e:check('HARNESS',False,str(e))
 totals={s:sum(c['status']==s for c in RESULTS) for s in ['PASS','FAIL']}
 a.json.write_text(json.dumps(dict(mode='RED' if a.baseline else 'candidate',migration_count=len(selected),cases=RESULTS,totals=totals),indent=2));print(totals)
 return int(totals['FAIL']>0)
if __name__=='__main__':sys.exit(main())
