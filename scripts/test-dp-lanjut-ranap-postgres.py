#!/usr/bin/env python3
"""LOCAL ONLY: full original schema/public RPC DP-first regression; fictional fixtures."""
import contextlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('ranap', ROOT / 'scripts/test-ranap-mitigasi-penuh-postgres.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


def consent(h, n, visit):
    h.sql(f"""insert into public.consents(id,visit_id,template_id,tindakan,isi_snapshot)
    values ({r.q(r.uid('d', n))},{r.q(visit)},{r.q(r.TEMPLATE_CONSENT)},'Fiktif','Fiktif');
    update public.consents set status='sudah_ttd',signer_name='Fiktif',
    signature_data='data:image/png;base64,ZmlrdGlm',signed_at=now() where id={r.q(r.uid('d', n))};""", r.OWNER)


def visit(h, n, signed=True):
    v = r.buat_kunjungan(h, n, r.buat_pelanggan(h, n), admitted=False)
    h.sql(f"update public.visits set status='Pembayaran' where id={r.q(v)};")
    # 100k + 120k + 50k stock + 100k = 370k, exactly the reported monetary shape.
    h.sql(f"update public.prescription_items set harga=100000 where id={r.q(r.uid(9,n*10+4))};")
    if signed:
        consent(h, n, v)
    return v


def lines(n):
    rows = r.baris(n, 1, 2, 3, 4)
    rows[-1]['price'] = 100000
    return rows


def post(v, n, user=r.OWNER, plan='Monitoring fiktif', stay='sakit', dp=200000):
    ordinary = r.tagih_biasa_sql(v, f'dp-first-{n}', lines(n), user, dp=dp)
    # Same original public posting payload, only the atomic orchestration differs.
    return ordinary.replace('clinic_post_invoice(', 'clinic_post_dp_and_admit(').replace(
        ');', f',{r.q(plan)},{r.q(stay)});')


def snapshot(h, v):
    return {
        'invoices': h.angka(f"select count(*) from public.invoices where visit_id={r.q(v)}"),
        'stays': h.angka(f"select count(*) from public.inpatient_records where visit_id={r.q(v)}"),
        'journals': h.angka('select count(*) from public.journal_entries'),
        'moves': h.angka('select count(*) from public.stock_moves'),
        'stock': h.angka(f"select qty from public.stock where item_id={r.q(r.ITEM)} and warehouse_id={r.q(r.WH)}"),
        'records': h.angka(f"select count(*) from public.medical_records where visit_id={r.q(v)}"),
        'prescriptions': h.angka(f"select count(*) from public.prescription_items where medical_record_id={r.q(r.uid(7,int(v[-12:])))}"),
    }


def concurrency(h, db):
    spec = importlib.util.spec_from_file_location('parallel', ROOT / 'scripts/test-ranap-mitigasi-concurrency-postgres.py')
    c = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(c)
    v=visit(h,230)
    evidence=[]
    with contextlib.ExitStack() as stack:
        observer=stack.enter_context(c.Session(db,'dp-observer'))
        first=stack.enter_context(c.Session(db,'dp-first',r.OWNER))
        second=stack.enter_context(c.Session(db,'dp-duplicate',r.OWNER))
        first.sql('begin; '+post(v,230))
        second.send('begin; '+post(v,230))
        c.wait_block(observer,second,first,evidence)
        first.sql('commit;')
        outcome=c.attempt(second)
    inv=h.aktif(v)
    r.catat('concurrent-double-submit',outcome['ok'] and len(evidence)==1
        and h.angka(f"select count(*) from public.inpatient_records where visit_id={r.q(v)}")==1
        and h.angka(f"select count(*) from public.invoices where visit_id={r.q(v)}")==1
        and h.diterima(inv)==200000
        and h.angka(f"select count(*) from public.stock_moves where source_ref={r.q(h.no_tagihan(inv))}")==1,
        {'lock_barriers':evidence,'outcome':outcome,'received':h.diterima(inv)})
    v=visit(h,231);before=snapshot(h,v);evidence=[]
    with contextlib.ExitStack() as stack:
        observer=stack.enter_context(c.Session(db,'dp-role-observer'))
        gate=stack.enter_context(c.Session(db,'dp-role-gate'))
        waiter=stack.enter_context(c.Session(db,'dp-role-waiter',r.ADMIN))
        gate.sql(f"begin; select clinic_private.billing_lock(clinic_private.billing_keys_visit({r.q(v)}));")
        waiter.send('begin; '+post(v,231,user=r.ADMIN))
        c.wait_block(observer,waiter,gate,evidence)
        gate.sql(f"update public.profiles set is_active=false where id={r.q(r.ADMIN)};commit;")
        outcome=c.attempt(waiter)
    h.sql(f"update public.profiles set is_active=true where id={r.q(r.ADMIN)}")
    r.catat('active-auth-rechecked-after-coordinator-wait',not outcome['ok'] and 'ACCESS_DENIED' in outcome.get('error','')
        and len(evidence)==1 and snapshot(h,v)==before,{'lock_barriers':evidence,'outcome':outcome})


def run(h, db):
    h.sql(r.dasar_sql())
    h.sql("insert into public.role_modules(role,module_id) values ('FINANCE','klinik') on conflict do nothing;")
    out=visit(h,200)
    h.sql(r.tagih_biasa_sql(out,'baseline-DP',lines(200),r.OWNER,dp=200000),r.OWNER)
    inv0=h.aktif(out)
    r.catat('baseline-ordinary-DP-does-not-route',h.status_bayar(inv0)=='DP' and h.diterima(inv0)==200000
            and h.angka(f"select count(*) from public.inpatient_records where visit_id={r.q(out)}")==0,
            'Original public RPC records DP200000 on total370000 but has no inpatient intent/admission')
    # Initial collection is NOT invoice correction. Prove the existing cashier
    # role contract before testing the new orchestrator (STAFF has no manual racikan).
    vstaff=visit(h,198)
    h.sql(r.tagih_biasa_sql(vstaff,'baseline-staff-DP',lines(198),r.STAFF,dp=200000),r.STAFF)
    staffinv=h.aktif(vstaff)
    r.catat('baseline-STAFF-initial-DP-allowed',h.status_bayar(staffinv)=='DP' and h.diterima(staffinv)==200000,
            'Original public clinic_post_invoice permits branch-authorized STAFF with own open clinic shift')
    for n,user,label in [(199,r.STAFF,'STAFF'),(197,r.DOCTOR,'DOCTOR'),(195,r.FINANCE,'FINANCE'),(194,r.ADMIN,'ADMIN')]:
        vv=visit(h,n);err=h.gagal(post(vv,n,user),user)
        r.catat(label+'-initial-DP-and-admit',not err and h.status_bayar(h.aktif(vv))=='DP'
                and h.angka(f"select count(*) from public.inpatient_records where visit_id={r.q(vv)}")==1,err or 'DP200000/370000; one stay')
    v = visit(h, 201)
    result = h.gagal(post(v, 201), r.OWNER)
    if result:
        r.catat('DP370-200-admit-atomic', False, result.strip().splitlines()[0])
        return
    inv = h.aktif(v)
    no = h.no_tagihan(inv)
    state = h.nilai(f"select status||'|'||(checked_out_at is null)::text from public.visits where id={r.q(v)}")
    r.catat('DP370-200-admit-atomic', h.status_bayar(inv)=='DP' and h.diterima(inv)==200000
        and h.saldo_ref('150001',no)==170000 and h.saldo_ref('110003',no)==200000
        and h.saldo_ref('510002',no)==-370000 and state=='Pembayaran|true'
        and h.angka(f"select count(*) from public.inpatient_records where visit_id={r.q(v)}")==1,
        f"paid={h.status_bayar(inv)} received={h.diterima(inv)} AR={h.saldo_ref('150001',no)} visit={state}")
    r.catat('STAFF-operational-and-history-RLS-visible',
        h.angka(f"select count(*) from public.inpatient_records where visit_id={r.q(v)} and discharged_at is null",r.STAFF)==1
        and h.angka(f"select count(*) from public.medical_records where visit_id={r.q(v)}",r.STAFF)==1,
        'Same-branch STAFF can read the real inpatient operational row and unchanged clinical history')
    before = snapshot(h,v)
    h.sql(post(v,201), r.OWNER)
    r.catat('same-request-retry-no-effects', snapshot(h,v)==before, snapshot(h,v))
    err = h.gagal(post(v,201,plan='Changed plan'),r.OWNER)
    r.catat('changed-admission-retry-denied', bool(err and 'IDEMPOTENCY_CONFLICT' in err) and snapshot(h,v)==before, err)
    err = h.gagal(post(v,201,user=r.FIN_LUAR),r.FIN_LUAR)
    r.catat('cross-branch-replay-denied', bool(err and 'ACCESS_DENIED' in err) and snapshot(h,v)==before, err)
    # New request must NOT reopen ordinary posting after admission.
    err = h.gagal(post(v,201).replace('dp-first-201','different-request'),r.OWNER)
    r.catat('second-key-no-extra-invoice-stay-stock', bool(err) and snapshot(h,v)==before, err)
    # Existing staged receipt path must allocate against the ordinary header-DP invoice.
    h.sql(r.bayar_sql(v,'later-partial',[{'method':'Transfer','amount':50000}]),r.OWNER)
    r.catat('later-receipt-retains-DP',h.status_bayar(inv)=='DP' and h.diterima(inv)==250000,
            {'status':h.status_bayar(inv),'received':h.diterima(inv)})
    # Stage new prescription on same visit/stay, never bill the old lines again.
    extra = r.uid(9, 2019)
    h.sql(f"insert into public.prescription_items(id,medical_record_id,nama_obat,qty,harga,satuan,jenis) values ({r.q(extra)},{r.q(r.uid(7,201))},'Jasa susulan fiktif',1,100000,'kali','jasa');")
    stage = [{'description':'Jasa susulan fiktif','qty':1,'price':100000,'kind':'jasa','unit':'kali','prescription_item_id':extra,'discount_percent':0}]
    h.sql(r.tagih_sql(v,'stage-after-dp',stage,r.OWNER,alasan='Uji fiktif'),r.OWNER)
    r.catat('subsequent-stage-same-stay-no-rebill',h.angka(f"select count(*) from public.invoices where visit_id={r.q(v)}")==2
            and h.angka(f"select count(*) from public.inpatient_records where visit_id={r.q(v)}")==1
            and h.angka(f"select count(*) from public.invoice_items where prescription_item_id={r.q(r.uid(9,2013))}")==1,
            '2 invoices, 1 stay, original stock prescription billed once')
    stay_id = h.nilai(f"select id from public.inpatient_records where visit_id={r.q(v)}")
    err = h.gagal(f"select public.clinic_change_inpatient_condition({r.q(stay_id)},'sembuh','Uji pulang fiktif');",r.OWNER)
    r.catat('discharge-with-AR',not err and h.angka(f"select count(*) from public.inpatient_records where id={r.q(stay_id)} and discharged_at is not null")==1
            and h.status_bayar(inv)=='DP' and h.diterima(inv)==250000,err or 'Discharged; first invoice remains DP/120000 unpaid')
    # Ordinary outpatient DP must never infer inpatient intent from service names/consent.
    out=visit(h,202)
    h.sql(r.tagih_biasa_sql(out,'ordinary-outpatient',lines(202),r.OWNER,dp=200000),r.OWNER)
    r.catat('normal-outpatient-DP-not-admitted',h.angka(f"select count(*) from public.inpatient_records where visit_id={r.q(out)}")==0,'ordinary RPC unchanged')
    # Existing DP gets an explicit, money-free continuation via the existing public admit RPC.
    oldinv=h.aktif(out); before=snapshot(h,out)
    h.sql(f"select public.clinic_admit_inpatient_typed({r.q(out)},'Fiktif legacy DP','old-dp-admit','sakit');",r.OWNER)
    after=snapshot(h,out)
    r.catat('prior-DP-explicit-admit-no-money-rewrite',all(after[k]==before[k] for k in before if k!='stays') and after['stays']==1
            and h.aktif(out)==oldinv and h.diterima(oldinv)==200000,'only stay inserted; invoice/payment/stock/history untouched')
    for n,label,user,change,expected in [
        (203,'missing-consent',r.OWNER,None,'CONSENT_REQUIRED'),
        (204,'missing-doctor',r.OWNER,'doctor','ADMISSION_INVALID'),
        (205,'missing-plan',r.OWNER,'plan','ADMISSION_INVALID'),
        (206,'cross-branch',r.FIN_LUAR,None,'ACCESS_DENIED'),
        (207,'inactive-role',r.FIN_NONAKTIF,None,'ACCESS_DENIED'),
        (210,'minimum-DP',r.OWNER,'minimum','DP_MINIMAL'),
        (211,'invalid-type',r.OWNER,'type','ADMISSION_INVALID'),
    ]:
        vv=visit(h,n,signed=label!='missing-consent')
        if change=='doctor': h.sql(f"update public.visits set doctor_id=null where id={r.q(vv)}")
        before=snapshot(h,vv)
        err=h.gagal(post(vv,n,user,plan='' if change=='plan' else 'Monitoring fiktif',stay='invalid' if change=='type' else 'sakit',dp=100000 if change=='minimum' else 200000),user)
        r.catat(label+'-atomic-no-money',bool(err and expected in err) and snapshot(h,vv)==before,err)
    concurrency(h,db)
    vv=visit(h,212);before=snapshot(h,vv)
    h.sql(f"update public.accounting_locks set closed_until='2026-11-03' where id;")
    err=h.gagal(post(vv,212),r.OWNER)
    r.catat('closed-period-atomic',bool(err and ('PERIOD' in err or 'tutup' in err.lower())) and snapshot(h,vv)==before,err)
    r.catat('all-journals-balanced',h.angka('select count(*) from (select entry_id from public.journal_lines group by entry_id having sum(debit)<>sum(credit)) x')==0,'per-entry nonempty journals, revenue/AR/cash checked above')


def main():
    with contextlib.ExitStack() as stack:
        r.fixture.ROOT=ROOT
        db=stack.enter_context(r.NativePostgres(r.BIN))
        r.fixture.DisposablePostgres.bootstrap(db)
        try: run(r.Harness(db),db)
        except Exception as e: r.catat('HARNESS',False,str(e))
    totals={s:sum(x['status']==s for x in r.HASIL) for s in ('PASS','FAIL')}
    print('TOTAL',json.dumps(totals))
    if len(sys.argv)>1: Path(sys.argv[1]).write_text(json.dumps({'total':totals,'cases':r.HASIL},indent=2))
    return 1 if totals['FAIL'] else 0

if __name__=='__main__': sys.exit(main())
