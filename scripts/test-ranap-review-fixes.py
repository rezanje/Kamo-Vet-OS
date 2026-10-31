#!/usr/bin/env python3
"""IR01/02/03 native regression; pinned independent RED is never rewritten.
Same original public RPC schedules, fresh isolated IR01 credit/debt preconditions.
"""
import sys, importlib.util, json
from pathlib import Path
sys.dont_write_bytecode=True
repo=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('candidate_review',repo/'scripts/test-ranap-bayar-postgres.py')
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
t.ROOT=repo
r,x,q=t.r,t.x,t.q
out={'probes':[]}
def check(case,ok,**detail):
    out['probes'].append(dict(case=case,ok=bool(ok),**detail))
    print(json.dumps(out['probes'][-1]),flush=True)
def call(h,sql):return json.loads(h.nilai(sql,r.STAFF))
def rec(h,v):return h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
def credit_fixture(h,n):
    customer=r.buat_pelanggan(h,n);v=r.buat_kunjungan(h,n,customer);record=rec(h,v)
    first=call(h,t.bill(v,n,[dict(method='Tunai',amount=165000)],record=record))
    other=r.buat_kunjungan(h,n+1,customer);otherrec=rec(h,other)
    parts=[dict(method='Transfer',amount=495000)];key='ir-credit-source-'+str(n)
    confirm=call(h,t.bill(other,n+1,parts,record=otherrec,key=key))
    call(h,t.bill(other,n+1,parts,record=otherrec,key=key,ack=confirm['quote']['token']))
    return customer,v,record,first
with t.LocalPostgres(r.BIN) as db:
    r.fixture.DisposablePostgres.bootstrap(db);h=x.Harness(db);x.setup(h)
    h.sql("insert into role_modules(role,module_id) values('FINANCE','klinik') on conflict do nothing")
    customer,v,record,first=credit_fixture(h,9901)
    sql=t.bill(v,9903,[],record=record,key='independent-credit-only')
    receipts=h.angka('select count(*) from clinic_payment_receipts');invoices=h.angka('select count(*) from invoices')
    result=call(h,sql);ids=result['application_ids']
    proof=json.loads(h.nilai(f"select jsonb_agg(to_jsonb(a)) from clinic_advance_applications a where a.id=any(array[{','.join(q(i) for i in ids)}]::uuid[]) and a.invoice_id={q(first['invoice_id'])}"))
    check('credit_only_existing_AR_no_pending',result['status']=='SAVED' and not result['invoice_id'] and not result['receipt_id'] and ids==[a['id'] for a in proof] and sum(a['amount'] for a in proof)==165000 and h.diterima(first['invoice_id'])==330000 and h.angka('select count(*) from invoices')==invoices and h.angka('select count(*) from clinic_payment_receipts')==receipts,result=result,proof=proof,debt_after=330000-h.diterima(first['invoice_id']))
    before=t.state(h);replay=call(h,sql)
    check('credit_only_exact_replay_once',replay==result and t.state(h)==before,result=replay)
    # New debt, only partial available credit: no zero receipt, real remaining AR.
    customerp,vp,recordp,firstp=credit_fixture(h,9911)
    otherp=r.buat_kunjungan(h,9913,customerp);otherrecord=rec(h,otherp)
    # Consume 100000 credit on another real stage, leaving 65000 available.
    h.sql(r.tagih_sql(otherp,'partial-credit-consumer',r.baris(9913,1),r.FINANCE,ganti={'dp_override_reason':'Fiktif'}),r.FINANCE)
    h.sql("update cash_accounts set is_active=false where coa_code='120002'")
    partial=call(h,t.bill(vp,9914,[],record=recordp,key='partial-credit-only'))
    h.sql("update cash_accounts set is_active=true where coa_code='120002'")
    received=h.diterima(firstp['invoice_id'])
    check('partial_credit_only_real_allocation_without_bank',partial['application_ids'] and received==230000 and not partial['receipt_id'],result=partial,received=received,remaining_debt=330000-received)
    before=t.state(h);error=h.gagal(t.bill(vp,9915,[],record=recordp,key='empty-credit-only'),r.STAFF)
    check('zero_money_no_pending_no_credit_rejects',error and 'PAYMENT_INVALID' in error and before==t.state(h),error=error)
    # Inactive bank vs cash: retain old public cash baseline and new cash success.
    vc=r.buat_kunjungan(h,9921,r.buat_pelanggan(h,9921));rc=rec(h,vc)
    call(h,t.bill(vc,9921,[dict(method='Tunai',amount=165000)],record=rc))
    h.sql("update cash_accounts set is_active=false where coa_code='120002'")
    baseline_error=h.gagal(r.bayar_sql(vc,'independent-original-cash',[dict(method='Tunai',amount=1000)]),r.STAFF)
    cash_error=h.gagal(t.bill(vc,9922,[dict(method='Tunai',amount=1000)],record=rc,key='independent-unified-cash'),r.STAFF)
    quote=call(h,f"select clinic_quote_inpatient_payment({q(rc)},{q(vc)},'[]')")
    check('unused_inactive_bank_blocks_cash',not baseline_error and not cash_error and [a['method'] for a in quote['accounts']]==['Tunai'],original_cash_error=baseline_error,unified_cash_error=cash_error,quote=quote)
    before=t.state(h);error=h.gagal(t.bill(vc,9923,[dict(method='Transfer',amount=1000)],record=rc),r.STAFF)
    check('selected_inactive_bank_fails_closed',error and 'ACCOUNT_INVALID' in error and before==t.state(h),error=error)
    # A zero-money pending followup still works with no bank.
    h.sql(f"insert into prescription_items(medical_record_id,nama_obat,qty,harga,jenis) values({q(r.uid(7,9921))},'Fiktif susulan',1,10000,'jasa')")
    later=call(h,t.bill(vc,9924,[],record=rc))
    check('pay_later_without_bank',later['invoice_id'] and not later['receipt_id'],result=later)
    h.sql("update cash_accounts set is_active=true where coa_code='120002'")
    v2=r.buat_kunjungan(h,9905,r.buat_pelanggan(h,9905));rec2=rec(h,v2)
    h.sql(t.bill(v2,9905,[dict(method='Tunai',amount=165000)],record=rec2),r.STAFF)
    barriers=[];before=t.state(h)
    with x.c.Session(db,'review-role-observer') as obs,x.c.Session(db,'review-role-gate') as gate,x.session(db,'review-role-waiter',r.STAFF) as waiter:
        gate.sql(f'begin;select id from cashier_shifts where id={q(r.SHIFT[r.STAFF])} for update;')
        waiter.send('begin;'+t.bill(v2,9906,[dict(method='Tunai',amount=1000)],record=rec2,key='independent-shift-role'))
        x.c.wait_block(obs,waiter,gate,barriers)
        gate.sql(f'update profiles set is_active=false where id={q(r.STAFF)};commit;')
        attempt=x.c.attempt(waiter)
    check('inactive_after_shift_wait_existing_AR',not attempt['ok'] and 'ACCESS_DENIED' in attempt.get('error','') and before==t.state(h),outcome=attempt,barriers=barriers)
    h.sql(f'update profiles set is_active=true where id={q(r.STAFF)}')
    # ISOLATED fixture: never reuse IR02's now-settled debt/consumed credit.
    customer,v,record,first=credit_fixture(h,9931)
    h.sql(r.bayar_sql(v,'ir01-original-cash',[dict(method='Tunai',amount=1000)]),r.STAFF)
    debt=330000-h.diterima(first['invoice_id']);credit=h.angka(f"select sum(amount-applied) from clinic_customer_advances where customer_id={q(customer['id'])} and status='aktif'")
    assert debt==164000 and credit==165000,(debt,credit)
    v3=r.buat_kunjungan(h,9907,r.buat_pelanggan(h,9907));rec3=rec(h,v3)
    payment_sql=t.bill(v,9908,[dict(method='Tunai',amount=1000)],record=record,key='independent-credit-shift-deadlock')
    confirmation=call(h,payment_sql)
    payment_sql=t.bill(v,9908,[dict(method='Tunai',amount=1000)],record=record,key='independent-credit-shift-deadlock',ack=confirmation['quote']['token'])
    barriers=[]
    with x.c.Session(db,'review-deadlock-observer') as obs,x.c.Session(db,'review-deadlock-shift-holder') as gate,x.session(db,'review-deadlock-credit-waiter',r.STAFF) as waiter:
        gate.sql(f'begin;select id from cashier_shifts where id={q(r.SHIFT[r.STAFF])} for update;'+x.claims(r.STAFF))
        waiter.send('begin;'+payment_sql);x.c.wait_block(obs,waiter,gate,barriers)
        gate.send(t.bill(v3,9907,[dict(method='Tunai',amount=330000)],record=rec3,key='independent-second-owner'))
        # Correct order: shift holder finishes and commits BEFORE waiting caller.
        second_out=x.c.attempt(gate);credit_out=x.c.attempt(waiter)
    check('new_credit_application_before_shift_vs_other_owner_same_cashier',credit_out['ok'] and second_out['ok'] and h.diterima(first['invoice_id'])==330000 and h.angka("select count(*) from clinic_payment_receipts where request_key='pay:independent-credit-shift-deadlock'")==1 and barriers[0]['wait_event_type']=='Lock' and bool(barriers[0]['wait_event']),precondition=dict(debt=debt,credit=credit),credit_outcome=credit_out,second_owner_outcome=second_out,barriers=barriers)
    check('nonempty_per_entry_balanced_GL',h.angka('select count(*) from journal_entries')>0 and h.angka('select count(*) from (select entry_id from journal_lines group by entry_id having sum(debit)<>sum(credit)) j')==0,journals=h.angka('select count(*) from journal_entries'))
out['totals']={k:sum(p['ok']==v for p in out['probes']) for k,v in [('PASS',True),('FAIL',False)]}
Path('/opt/data/kamo-ranap-bayar-fixes-green.json').write_text(json.dumps(out,indent=2))
print(out['totals'])
sys.exit(bool(out['totals']['FAIL']))
