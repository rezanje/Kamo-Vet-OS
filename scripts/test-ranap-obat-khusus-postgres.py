#!/usr/bin/env python3
"""Local native PG17, complete actual migration chain. No business stubs/network."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('racikan', ROOT/'scripts/test-ranap-racikan-postgres.py')
assert spec is not None and spec.loader is not None
x = importlib.util.module_from_spec(spec)
spec.loader.exec_module(x)
r, dp, c, q, j = x.r, x.dp, x.c, x.q, x.j
CANDIDATE = '20261104120000_inpatient_billable_medicines.sql'
RESULTS = []


def check(case, ok, detail):
    RESULTS.append(dict(case=case, status='PASS' if ok else 'FAIL', detail=detail))
    print(RESULTS[-1]['status'], case, json.dumps(detail), flush=True)


def save(stay, key, rows, compounds=None):
    return f"select public.clinic_add_inpatient_billables({q(stay)},{j(rows)},{j(compounds or [])},'Penambahan perawatan Fiktif',{q(key)});"


def run(h, db, version):
    for n,user in [(920,r.DOCTOR),(921,r.STAFF)]:
        vv,mm=x.visit(h,n);before=x.state(h)
        err=h.gagal(x.note(h,vv,mm,f'original-note-{n}',x.payload(version,f'original-recipe-{n}')),user)
        check('ORIGINAL public care '+r.PERAN[user]+' baseline contract official compound',not err and x.state(h)['logs']==before['logs']+1 and x.state(h)['stock']==before['stock']-2,dict(error=err))
    v, m = x.visit(h, 901)
    stay = h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
    h.sql(f"select public.clinic_save_inpatient_log_with_status({q(stay)},{q(m)},'{json.dumps(dict(condition_note='Kondisi historis Fiktif',log_kind='monitoring'))}'::jsonb,'[]'::jsonb,'[]'::jsonb,'historical-clinical-log',null);",r.DOCTOR)
    protocol=r.uid('e',9901)
    h.sql(x.claims(r.OWNER).replace('set role authenticated;','')+f"insert into inpatient_medications(id,inpatient_record_id,nama_obat,dosis,frekuensi_per_hari,durasi_hari,created_by) values({q(protocol)},{q(stay)},'Protokol historis Fiktif','1 ml',2,3,{q(r.DOCTOR)});insert into inpatient_med_doses(medication_id,diberikan_oleh,nama_pemberi) values({q(protocol)},{q(r.STAFF)},'Pemberi Fiktif');")
    history=care_history(h)
    row = dict(nama_obat='Obat Fiktif', item_id=r.ITEM, qty=2, satuan='pcs', faktor=1, harga=50000, jenis='obat')
    before = x.state(h)
    sql = save(stay, 'standalone-tracer', [row])
    error = h.gagal(sql, r.DOCTOR)
    after = x.state(h)
    check('standalone DOCTOR medicine persists same-MR pending bill with NO daily log or early stock/money',
          not error and after['prescriptions']==before['prescriptions']+1
          and all(after[k]==before[k] for k in before if k!='prescriptions')
          and care_history(h)==history
          and h.angka(f"select count(*) from clinic_inpatient_billable_entries e join prescription_items p on p.id=any(e.prescription_ids) where e.request_key='standalone-tracer' and p.medical_record_id={q(m)}")==1,
          dict(error=error,before=before,after=after,rows=h.nilai(f"select jsonb_agg(to_jsonb(p)) from prescription_items p where medical_record_id={q(m)}")))
    if error:
        return
    matrix(h, db, version, v, m, stay, row, sql)


def care_history(h):
    return h.nilai("select jsonb_build_object('visits',(select count(*) from visits),'stays',(select count(*) from inpatient_records),'records',(select count(*) from medical_records),'logs',(select jsonb_agg(to_jsonb(t) order by id) from inpatient_daily_logs t),'protocols',(select jsonb_agg(to_jsonb(t) order by id) from inpatient_medications t),'doses',(select jsonb_agg(to_jsonb(t) order by id) from inpatient_med_doses t))")


def snapshot(h):
    return h.nilai("select jsonb_build_object('rx',(select jsonb_agg(to_jsonb(p) order by id) from prescription_items p),'audit',(select jsonb_agg(to_jsonb(e) order by id) from clinic_inpatient_billable_entries e),'logs',(select jsonb_agg(to_jsonb(l) order by id) from inpatient_daily_logs l),'state',"+j(x.state(h))+ ")")


def denied(h,label,sql,user,expected):
    before=snapshot(h);err=h.gagal(sql,user)
    check(label,bool(err and expected in err) and snapshot(h)==before,dict(error=err,unchanged=snapshot(h)==before))


def matrix(h,db,version,v,m,stay,row,sql):
    before=snapshot(h)
    result=h.nilai(sql,r.DOCTOR);again=h.nilai(sql,r.DOCTOR)
    check('exact replay no Rx audit stock money or clinical duplication',result==again and snapshot(h)==before,dict(id=result))
    denied(h,'changed replay is conflict',save(stay,'standalone-tracer',[dict(row,qty=3)]),r.DOCTOR,'IDEMPOTENCY_CONFLICT')
    # Distinct clinical accounts retain the ORIGINAL care-entry role contract.
    for n,user in [(902,r.OWNER),(903,r.ADMIN),(904,r.STAFF),(905,r.DOCTOR)]:
        vv,mm=x.visit(h,n);ss=h.nilai(f'select id from inpatient_records where visit_id={q(vv)}')
        before=x.state(h);err=h.gagal(save(ss,f'role-{n}',[row]),user)
        check(r.PERAN[user]+' standalone ordinary medicine allowed',not err and x.state(h)['prescriptions']==before['prescriptions']+1 and x.state(h)['logs']==before['logs'],dict(error=err))
    for user,label in [(r.FINANCE,'FINANCE'),(r.FIN_LUAR,'other branch')]:
        denied(h,label+' fresh denied',save(stay,'forbidden-'+label,[row]),user,'ACCESS_DENIED')
    h.sql(f'update profiles set is_active=false where id={q(r.DOCTOR)}')
    denied(h,'inactive exact replay denied',sql,r.DOCTOR,'ACCESS_DENIED')
    h.sql(f'update profiles set is_active=true where id={q(r.DOCTOR)};delete from user_branches where user_id={q(r.DOCTOR)};')
    denied(h,'branch revoked exact replay denied',sql,r.DOCTOR,'ACCESS_DENIED')
    h.sql(f'insert into user_branches(user_id,branch_id) values({q(r.DOCTOR)},{q(r.BRANCH)})')
    h.sql("insert into role_modules(role,module_id) values('DOCTOR','laporan') on conflict do nothing")
    denied(h,'module override denies replay',sql,r.DOCTOR,'ACCESS_DENIED')
    h.sql("delete from role_modules where role='DOCTOR'")
    # One-row original care RPC with a real Jasa/clinical note remains compatible.
    before=x.state(h)
    err=h.gagal(x.note(h,v,m,'original-care-regression',x.payload(version,'original-care-compound')),r.STAFF)
    check('original STAFF clinical care with official compound after DP still succeeds',not err and x.state(h)['logs']==before['logs']+1 and x.state(h)['stock']==before['stock']-2,dict(error=err))
    vv,mm=x.visit(h,906);ss=h.nilai(f'select id from inpatient_records where visit_id={q(vv)}')
    h.sql(x.claims(r.OWNER).replace('set role authenticated;','')+f'update inpatient_records set medical_record_id={q(m)} where id={q(ss)}')
    denied(h,'foreign patient MR linkage denied atomically',save(ss,'foreign-record',[row]),r.DOCTOR,'RECORD_INVALID')
    h.sql(x.claims(r.OWNER).replace('set role authenticated;','')+f'update inpatient_records set medical_record_id={q(mm)} where id={q(ss)}')
    # Full-stock/money tracer: ordinary product + inventory procedure BMHP + official compound.
    proc=r.uid('e',1900);cat=r.uid('e',1901)
    h.sql(f"insert into item_categories(id,name) values({q(cat)},'TINDAKAN');insert into items(id,code,name,unit,item_type,is_active,sell_price,category_id) values({q(proc)},'UJI-OBAT-PROC','Tindakan Fiktif','kali','Persediaan',true,80000,{q(cat)});")
    bmhp=dict(nama_obat='Tindakan Fiktif',item_id=proc,qty=2,satuan='kali',harga=80000,jenis='obat',bmhp_components=[dict(item_id=x.MATERIAL,qty=3,unit='gram')],service_performers=dict(doctor_id=r.DOKTER_PEGAWAI,staff_id=None))
    before=x.state(h);old=x.invoice_snapshot(h,vv)
    err=h.gagal(save(ss,'bmhp-and-official',[row,bmhp],[x.payload(version,'standalone-official')]),r.DOCTOR)
    check('DOCTOR BMHP and compound persist without log invoice journal; compound only issues once',not err and x.state(h)['prescriptions']==before['prescriptions']+3 and x.state(h)['stock']==before['stock']-2 and x.state(h)['logs']==before['logs'] and x.state(h)['journals']==before['journals'] and x.invoice_snapshot(h,vv)==old,dict(error=err,before=before,after=x.state(h)))
    if err:return
    entry=h.nilai("select id from clinic_inpatient_billable_entries where request_key='bmhp-and-official'")
    provenance=json.loads(h.nilai(f"select jsonb_build_object('actor',created_by,'reason',reason,'source',source,'timestamp',created_at is not null,'n',cardinality(prescription_ids),'mr',medical_record_id,'visit',visit_id) from clinic_inpatient_billable_entries where id={q(entry)}"))
    check('immutable source audit actor time reason same stay/visit/record and actual Rx IDs',provenance==dict(actor=r.DOCTOR,reason='Penambahan perawatan Fiktif',source='OBAT_KHUSUS',timestamp=True,n=3,mr=mm,visit=vv),provenance)
    denied(h,'direct audit mutation denied',f"update clinic_inpatient_billable_entries set reason='Forged' where id={q(entry)}",r.DOCTOR,'permission denied')
    for user,custom,n in [(r.STAFF,False,907),(r.DOCTOR,True,908)]:
        v2,m2=x.visit(h,n);s2=h.nilai(f'select id from inpatient_records where visit_id={q(v2)}');before=x.state(h)
        err=h.gagal(save(s2,f'compound-{n}',[],[x.payload(version,f'compound-issue-{n}',custom)]),user)
        check(r.PERAN[user]+(' manual' if custom else ' official')+' standalone compound preserves original issue-once contract',not err and x.state(h)['stock']==before['stock']-(3 if custom else 2) and x.state(h)['logs']==before['logs'],dict(error=err))
    denied(h,'STAFF manual compound still denied; ordinary rows roll back too',save(ss,'staff-manual-atomic',[row],[x.payload(version,'staff-manual-issue',True)]),r.STAFF,'ACCESS_DENIED')
    denied(h,'checkpoint rejects compound batch before any issue',save(ss,'compound-batch',[],[x.payload(version,'batch-a'),x.payload(version,'batch-b')]),r.DOCTOR,'COMPOUND_BATCH_UNSUPPORTED')
    # Original one-action bill/pay scans the pending SAME VISIT prescriptions.
    before=x.state(h);stock=h.angka(f'select qty from stock where item_id={q(r.ITEM)}')
    bill=f"select public.clinic_bill_and_pay_inpatient({q(ss)},{q(vv)},'standalone-bill','2026-11-03','[]'::jsonb,null,false,null);"
    err=h.gagal(bill,r.OWNER)
    if err:
        check('original bill-and-pay successful',False,dict(error=err))
        return
    invoice=h.nilai(f"select id from invoices where visit_id={q(vv)} and request_key<>'dp-first-906' order by created_at desc,id desc limit 1")
    no=h.no_tagihan(invoice)
    # BMHP quantities are the original engine's TOTAL for the procedure line,
    # not multiplied by the procedure count (3g total on the 2-unit procedure).
    check('original bill-and-pay collects same pending medicines BMHP compounds: revenue 280k AR 280k HPP 9k once',not err and h.saldo_ref('4201',no)==-280000 and h.saldo_ref('1201',no)==280000 and h.saldo_ref('5101',no)==9000 and h.angka(f'select qty from stock where item_id={q(r.ITEM)}')==stock-2 and x.state(h)['stock']==before['stock']-3 and h.diterima(invoice)==0,dict(error=err,revenue=h.saldo_ref('4201',no),ar=h.saldo_ref('1201',no),hpp=h.saldo_ref('5101',no),before=before,after=x.state(h)))
    before=snapshot(h);h.sql(bill,r.OWNER)
    h.sql(save(ss,'bmhp-and-official',[row,bmhp],[x.payload(version,'standalone-official')]),r.DOCTOR)
    check('post-billing exact entry/billing replay effect-free',snapshot(h)==before,dict(unchanged=snapshot(h)==before))
    check('journal entries nonempty individually balanced',h.angka('select count(*) from journal_entries')>0 and h.angka('select count(*) from (select entry_id from journal_lines group by entry_id having sum(debit)<>sum(credit))t')==0,{})
    h.sql(f"select public.clinic_change_inpatient_condition({q(ss)},'sembuh','Fiktif');",r.DOCTOR)
    denied(h,'closed stay exact replay denied',save(ss,'bmhp-and-official',[row,bmhp],[x.payload(version,'standalone-official')]),r.DOCTOR,'STAY_CLOSED')
    races(h,db,version,row)


def races(h,db,version,row):
    for n,kind in [(930,'record'),(931,'request')]:
        v,m=x.visit(h,n);stay=h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
        key=f'late-wait-{n}';sql=save(stay,key,[row]);h.sql(sql,r.DOCTOR);before=snapshot(h);evidence=[]
        with c.Session(db,f'late-obs-{n}') as obs,c.Session(db,f'late-gate-{n}') as gate,x.session(db,f'late-wait-{n}',r.DOCTOR) as waiter:
            lock=(f'select id from medical_records where id={q(m)} for update;' if kind=='record' else f"select pg_advisory_xact_lock(hashtextextended('inpatient-entry:'||{q(r.DOCTOR)}||':'||{q(key)},0));")
            gate.sql('begin;'+lock);waiter.send('begin;'+sql);c.wait_block(obs,waiter,gate,evidence)
            gate.sql(f'update profiles set is_active=false where id={q(r.DOCTOR)};commit;');result=c.attempt(waiter)
        check('authorization after late '+kind+' wait BEFORE cached replay',not result['ok'] and 'ACCESS_DENIED' in result.get('error','') and snapshot(h)==before,dict(result=result,barriers=evidence))
        h.sql(f'update profiles set is_active=true where id={q(r.DOCTOR)}')
    v,m=x.visit(h,932);stay=h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
    sql=save(stay,'custom-role-replay',[],[x.payload(version,'custom-role-issue',True)])
    h.sql(sql,r.DOCTOR);h.sql(f"update profiles set role='STAFF' where id={q(r.DOCTOR)}")
    denied(h,'DOCTOR to STAFF cannot replay manual compound',sql,r.DOCTOR,'ACCESS_DENIED')
    h.sql(f"update profiles set role='DOCTOR' where id={q(r.DOCTOR)}")
    for n,kind in [(910,'normal'),(911,'inactive'),(912,'branch'),(913,'role'),(914,'closed')]:
        v,m=x.visit(h,n);stay=h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
        sql=save(stay,f'race-{n}',[row])
        if kind=='normal':h.sql(save(stay,'race-seed',[row]),r.DOCTOR)
        if kind!='normal':h.sql(sql,r.DOCTOR) # stale authorization must deny CACHED replay too
        before=snapshot(h);evidence=[]
        with c.Session(db,f'observer-{n}') as obs,c.Session(db,f'gate-{n}') as gate,x.session(db,f'waiter-{n}',r.DOCTOR) as waiter:
            gate.sql(f'begin;select clinic_private.billing_lock(clinic_private.billing_keys_visit({q(v)}));select id from visits where id={q(v)} for update;')
            waiter.send('begin;'+sql);c.wait_block(obs,waiter,gate,evidence)
            change=(f'update profiles set is_active=false where id={q(r.DOCTOR)};' if kind=='inactive' else
                    f'delete from user_branches where user_id={q(r.DOCTOR)};' if kind=='branch' else
                    f"update profiles set role='FINANCE' where id={q(r.DOCTOR)};" if kind=='role' else
                    f"update inpatient_records set discharged_at=now(),condition_status='sembuh' where id={q(stay)};" if kind=='closed' else '')
            if kind=='normal':
                change=f"select public.clinic_bill_and_pay_inpatient({q(stay)},{q(v)},'race-cashier','2026-11-03','[]'::jsonb,null,false,null);"
                gate.sql(x.claims(r.OWNER)+change+'commit;')
            else:gate.sql(x.claims(r.OWNER).replace('set role authenticated;','')+change+'commit;')
            result=c.attempt(waiter)
        expected='STAY_CLOSED' if kind=='closed' else 'ACCESS_DENIED'
        check('coordinator BEFORE outer row locks / recheck '+kind,all(e['wait_event_type']=='Lock' and e['wait_event']=='advisory' for e in evidence) and (result['ok'] if kind=='normal' else not result['ok'] and expected in result.get('error','') and snapshot(h)==before),dict(result=result,barriers=evidence))
        if kind=='normal':
            invoice=h.nilai(f'select id from invoices where visit_id={q(v)} order by created_at desc,id desc limit 1');no=h.no_tagihan(invoice)
            pending=h.angka(f'select count(*) from prescription_items p where medical_record_id={q(m)} and not exists(select 1 from invoice_items i where i.prescription_item_id=p.id)')
            check('simultaneous actual bill/pay then new entry: billed seed once, new medicine remains pending SAME visit',h.saldo_ref('4201',no)==-100000 and h.saldo_ref('1201',no)==100000 and h.saldo_ref('5101',no)==4000 and pending==1,dict(revenue=h.saldo_ref('4201',no),ar=h.saldo_ref('1201',no),hpp=h.saldo_ref('5101',no),pending=pending))
        h.sql(f"update profiles set is_active=true,role='DOCTOR' where id={q(r.DOCTOR)};insert into user_branches(user_id,branch_id) values({q(r.DOCTOR)},{q(r.BRANCH)}) on conflict do nothing")
    # Branch eligibility must survive the final MR/request wait without relying
    # on the optional operational-branch header, for fresh AND cached requests.
    for n,kind,cached,change in [(950,'record',False,'inactive'),(951,'record',True,'inactive'),(952,'request',False,'type'),(953,'request',True,'type')]:
        v,m=x.visit(h,n);stay=h.nilai(f'select id from inpatient_records where visit_id={q(v)}');key=f'branch-late-{n}';sql=save(stay,key,[row])
        if cached:h.sql(sql,r.DOCTOR)
        before=snapshot(h);evidence=[];old_type=h.nilai(f'select type from branches where id={q(r.BRANCH)}')
        with c.Session(db,f'branch-obs-{n}') as obs,c.Session(db,f'branch-gate-{n}') as gate,x.session(db,f'branch-wait-{n}',r.DOCTOR) as waiter:
            waiter.sql("select set_config('request.headers','{}',false);")
            lock=(f'select id from medical_records where id={q(m)} for update;' if kind=='record' else f"select pg_advisory_xact_lock(hashtextextended('inpatient-entry:'||{q(r.DOCTOR)}||':'||{q(key)},0));")
            gate.sql('begin;'+lock);waiter.send('begin;'+sql);c.wait_block(obs,waiter,gate,evidence)
            gate.sql((f'update branches set is_active=false where id={q(r.BRANCH)};' if change=='inactive' else f"update branches set type='PETSHOP' where id={q(r.BRANCH)};")+'commit;');result=c.attempt(waiter)
        check(f'branch {change} rechecked after late {kind} wait '+('cached' if cached else 'fresh'),not result['ok'] and 'ACCESS_DENIED' in result.get('error','') and snapshot(h)==before,dict(result=result,barriers=evidence))
        h.sql(f'update branches set is_active=true,type={q(old_type)} where id={q(r.BRANCH)}')
    v,m=x.visit(h,940);stay=h.nilai(f'select id from inpatient_records where visit_id={q(v)}');sql=save(stay,'simultaneous-duplicate',[row]);before=x.state(h);evidence=[]
    with c.Session(db,'dup-obs') as obs,x.session(db,'dup-a',r.DOCTOR) as a,x.session(db,'dup-b',r.DOCTOR) as b:
        a.sql('begin;'+sql);b.send('begin;'+sql);c.wait_block(obs,b,a,evidence);a.sql('commit;');result=c.attempt(b)
    check('simultaneous identical requests create one Rx and one audit only',result['ok'] and x.state(h)['prescriptions']==before['prescriptions']+1 and h.angka("select count(*) from clinic_inpatient_billable_entries where request_key='simultaneous-duplicate'")==1 and x.state(h)['logs']==before['logs'],dict(result=result,barriers=evidence))


def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline',action='store_true');p.add_argument('--json',type=Path,required=True);p.add_argument('--definitions',type=Path)
    a=p.parse_args()
    selected=sorted(s for s in (ROOT/'supabase/migrations').glob('*.sql') if not(a.baseline and s.name==CANDIDATE))
    try:
        with tempfile.TemporaryDirectory(prefix='kamo-obat-khusus-',dir='/opt/data') as folder:
            target=Path(folder)/'supabase/migrations';target.mkdir(parents=True)
            for source in selected:(target/source.name).symlink_to(source)
            r.fixture.ROOT=Path(folder)
            with x.LocalPostgres(r.BIN) as db:
                r.fixture.DisposablePostgres.bootstrap(db)
                if a.definitions:
                    a.definitions.write_text(db.sql("select pg_get_functiondef('public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text)'::regprocedure)"))
                h=x.Harness(db);version=x.setup(h);run(h,db,version)
    except Exception as error:
        check('HARNESS',False,str(error))
    totals={s:sum(row['status']==s for row in RESULTS) for s in ('PASS','FAIL')}
    a.json.write_text(json.dumps(dict(mode='RED baseline' if a.baseline else 'candidate',migration_count=len(selected),totals=totals,cases=RESULTS),indent=2))
    print('TOTAL',totals,flush=True)
    return int(totals['FAIL']>0)


if __name__=='__main__':sys.exit(main())
