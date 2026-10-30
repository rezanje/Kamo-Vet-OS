"""Additional fictional public-RPC cases, imported by test-ranap-bayar-postgres.py."""
import json

def run(t,h,db,version):
    r,x,q,j,check=t.r,t.x,t.q,t.j,t.check
    def fresh(n):
        v=r.buat_kunjungan(h,n,r.buat_pelanggan(h,n))
        return v,h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
    def pay(v,rec,n,parts,**kw):return t.bill(v,n,parts,record=rec,**kw)
    def call(sql,user=r.STAFF):return json.loads(h.nilai(sql,user))
    def extra(v,n,amount=100000):
        h.sql(f"insert into prescription_items(id,medical_record_id,nama_obat,qty,harga,satuan,jenis) values({q(r.uid(9,n*100+99))},{q(r.uid(7,n))},'Jasa susulan Fiktif',1,{amount},'kali','jasa')")
    def snapshot():return t.state(h)
    def count(table):return h.angka(f'select count(*) from {table}')
    def rejected(label,sql,user,expected):
        before=snapshot();err=h.gagal(sql,user)
        check(label,bool(err and expected in err) and snapshot()==before,dict(error=err,unchanged=snapshot()==before))

    v,rec=fresh(910);parts=[dict(method='Tunai',amount=100000),dict(method='Transfer',amount=300000)]
    before=snapshot();out=call(pay(v,rec,910,parts))
    check('direct public RPC overpayment rejected before ANY money or invoice writes',out['status']=='OVERPAYMENT_CONFIRM_REQUIRED' and out['quote']['remaining']==330000 and out['quote']['excess']==70000 and snapshot()==before,out)
    token=out['quote']['token']
    out=call(pay(v,rec,910,[dict(method='Tunai',amount=410000)],ack=token))
    check('confirmation bound to exact amount and split methods',out['status']=='OVERPAYMENT_CONFIRM_REQUIRED' and out['quote']['token']!=token and snapshot()==before,out)
    extra(v,910,10000);before=snapshot()
    out=call(pay(v,rec,910,parts,ack=token))
    check('added prescription invalidates acknowledged quote',out['status']=='OVERPAYMENT_CONFIRM_REQUIRED' and out['quote']['excess']==60000 and snapshot()==before,out)
    token=out['quote']['token'];cash=h.saldo('1101');bank=h.saldo('1102');moves=count('stock_moves')
    sql=pay(v,rec,910,parts,ack=token);out=call(sql);receipt=out['receipt_id'];invoice=out['invoice_id'];no=h.no_tagihan(invoice)
    check('acknowledged surplus kept once as real owner liability not revenue',out['status']=='SAVED' and h.diterima(invoice)==340000 and h.status_bayar(invoice)=='Lunas' and h.angka(f"select sum(amount-applied) from clinic_customer_advances where receipt_id={q(receipt)}")==60000 and h.saldo('1101')-cash==100000 and h.saldo('1102')-bank==300000 and h.saldo_ref('4201',no)==-340000 and count('stock_moves')==moves+1,dict(result=out,cash_delta=h.saldo('1101')-cash,bank_delta=h.saldo('1102')-bank,invoice_received=h.diterima(invoice),revenue=h.saldo_ref('4201',no),unused=60000))
    before=snapshot();call(sql)
    check('acknowledged double-submit idempotent including surplus',snapshot()==before,dict(unchanged=snapshot()==before))
    rejected('cached replay wrong branch denied',sql,r.FIN_LUAR,'ACCESS_DENIED')
    rejected('changed payload same key rejected',pay(v,rec,910,[dict(method='Tunai',amount=200000)]),r.STAFF,'IDEMPOTENCY_CONFLICT')
    # Settled primary may not silently collect again, even with exact surplus ack.
    parts2=[dict(method='QRIS',amount=50000)]
    out=call(pay(v,rec,911,parts2,key='settled-no-repeat'))
    rejected('settled/no-new-items primary cannot collect again',pay(v,rec,911,parts2,ack=out['quote']['token'],key='settled-no-repeat'),r.STAFF,'PAYMENT_SETTLED')
    out=call(pay(v,rec,911,parts2,credit=True,key='explicit-credit'))
    before=snapshot();out=call(pay(v,rec,911,parts2,credit=True,key='explicit-credit',ack=out['quote']['token']))
    check('explicit Tambah saldo owner mode preserves advance-before-items',out['status']=='SAVED' and out['invoice_id'] is None and snapshot()!=before,out)
    # Reversing a receipt changes actual net debt; it must invalidate the quote.
    pending=call(pay(v,rec,912,[dict(method='Debit',amount=100000)],credit=True,key='before-reversal'))
    advance=h.nilai(f'select id from clinic_customer_advances where receipt_id={q(receipt)}')
    h.sql(r.lepas_sql(advance,'unified-release'),r.FINANCE);h.sql(r.batal_kwitansi_sql(receipt,'unified-void'),r.FINANCE)
    before=snapshot();out=call(pay(v,rec,912,[dict(method='Debit',amount=100000)],ack=pending['quote']['token'],credit=True,key='before-reversal'))
    check('receipt reversal invalidates quote even when payment is no longer excess',out['status']=='OVERPAYMENT_CONFIRM_REQUIRED' and out['quote']['remaining']>0 and snapshot()==before,out)

    # Minimum initial DP, role overrides, optional subsequent zero money.
    v,rec=fresh(920)
    rejected('initial payment below minimum rolls back receipt advance invoice stock GL',pay(v,rec,920,[dict(method='Tunai',amount=10000)]),r.STAFF,'DP_MINIMAL')
    rejected('initial zero-money has no minimum bypass',pay(v,rec,920,[]),r.STAFF,'DP_MINIMAL')
    rejected('STAFF initial override still denied',pay(v,rec,920,[],reason='Fiktif'),r.STAFF,'DP_OVERRIDE_DENIED')
    result=call(pay(v,rec,920,[dict(method='Tunai',amount=165000)]));first=result['invoice_id']
    old=h.nilai(f'select to_jsonb(i) from invoices i where id={q(first)}');extra(v,920,100000)
    receipts=count('clinic_payment_receipts');result=call(pay(v,rec,921,[],key='optional-zero'))
    check('followup zero money posts revenue AR without fake zero receipt or changing old invoice',result['receipt_id'] is None and count('clinic_payment_receipts')==receipts and h.saldo_ref('4201',h.no_tagihan(result['invoice_id']))==-100000 and h.saldo_ref('1201',h.no_tagihan(result['invoice_id']))==100000 and h.nilai(f'select to_jsonb(i) from invoices i where id={q(first)}')==old,result)
    result=call(pay(v,rec,922,[dict(method='Tunai',amount=100000)],key='oldest-first'))
    check('new receipt allocates existing debt oldest-first not new-stage-first',h.diterima(first)==265000 and h.angka(f"select sum(amount) from invoice_payments where receipt_id={q(result['receipt_id'])} and invoice_id={q(first)}")==100000,result)
    v0,rec0=fresh(923);result=call(pay(v0,rec0,923,[],reason='Fiktif authorized initial zero'),r.FINANCE)
    check('authorized reason initial zero creates real AR and logged DP exception',result['receipt_id'] is None and h.angka(f'select count(*) from clinic_dp_overrides where invoice_id={q(result["invoice_id"])}')==1,result)
    # Ordinary initial HEADER DP invoice isn't repriced/reposted by this flow.
    vh=x.dp.visit(h,924);h.sql(x.dp.post(vh,924,user=r.STAFF),r.STAFF)
    rech=h.nilai(f'select id from inpatient_records where visit_id={q(vh)}');first=h.aktif(vh)
    before_header=h.nilai(f'select to_jsonb(i) from invoices i where id={q(first)}');extra(vh,924,200000)
    result=call(pay(vh,rech,924,[],key='after-header-DP'))
    check('ordinary initial header DP excluded from pending and preserved verbatim',h.angka(f'select total from invoices where id={q(result["invoice_id"])}')==200000 and h.diterima(first)==200000 and h.nilai(f'select to_jsonb(i) from invoices i where id={q(first)}')==before_header,result)

    # Branch mapping, all actual methods and old debt settlement after discharge.
    h.sql("insert into coa_accounts(code,name,type,normal_balance,is_active,is_header) values('1109','Bank cabang Fiktif','ASET','D',true,false);insert into cash_accounts(nama,jenis,coa_code,bank_nama,no_rekening) values('Bank cabang Fiktif','Bank','1109','Bank Uji','123456');")
    h.sql(f"insert into payment_account_map(metode,branch_id,cash_account_id) select 'Transfer',{q(r.BRANCH)},id from cash_accounts where coa_code='1109';")
    v,rec=fresh(925);bank=h.saldo('1109');parts=[dict(method=m,amount=55000) for m in ['Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet']]
    result=call(pay(v,rec,925,parts));receipt=result['receipt_id']
    check('six methods use actual branch bank map and preserve receipt split',h.saldo('1109')-bank==55000 and h.angka(f"select count(*) from clinic_payment_receipt_parts where receipt_id={q(receipt)}")==6 and h.nilai(f"select kas_code from clinic_payment_receipt_parts where receipt_id={q(receipt)} and metode='Transfer'")=='1109',result)
    h.sql(f"delete from payment_account_map where branch_id={q(r.BRANCH)} and metode='Transfer'")
    v,rec=fresh(926);call(pay(v,rec,926,[dict(method='Tunai',amount=165000)]));h.sql(f"select clinic_change_inpatient_condition({q(rec)},'sembuh','Fiktif pulang');",r.DOCTOR)
    extra(v,926,50000)
    result=call(pay(v,rec,927,[dict(method='Transfer',amount=215000)],key='discharged-pending'))
    check('discharged visit settles old debt and pending pre-discharge contract without re-admission',h.angka(f'select count(*) from inpatient_records where visit_id={q(v)}')==1 and h.angka(f'select count(*) from inpatient_records where visit_id={q(v)} and discharged_at is null')==0 and h.angka(f'select sum(i.total-clinic_private.invoice_received(i.id)) from invoices i where visit_id={q(v)} and voided_at is null')==0,result)

    for n,kind,user,code in [(930,'stock',r.STAFF,'STOCK_SHORT'),(931,'period',r.STAFF,'sudah ditutup'),(932,'shift',r.STAFF,'SHIFT_INVALID'),(933,'inactive',r.FIN_NONAKTIF,'ACCESS_DENIED'),(934,'branch',r.FIN_LUAR,'ACCESS_DENIED'),(935,'record',r.STAFF,'ACCESS_DENIED'),(936,'tax',r.STAFF,'query returned no rows'),(937,'account',r.STAFF,'ACCOUNT_INVALID')]:
        v,rec=fresh(n)
        if kind=='stock':h.sql(f'update stock set qty=0 where item_id={q(r.ITEM)}')
        if kind=='period':h.sql("update accounting_locks set closed_until='2026-11-03' where id")
        if kind=='shift':h.sql(f"update cashier_shifts set status='closed' where id={q(r.SHIFT[r.STAFF])}")
        if kind=='record':rec=r.uid(7,n)
        if kind=='tax':h.sql('delete from company_settings')
        if kind=='account':h.sql("update coa_accounts set is_active=false where code='1102'")
        rejected(kind+' failure rolls back BOTH receipt and invoice/advance/stock/GL',pay(v,rec,n,[dict(method='Transfer' if kind=='account' else 'Tunai',amount=330000)]),user,code)
        if kind=='stock':h.sql(f'update stock set qty=180 where item_id={q(r.ITEM)}')
        if kind=='period':h.sql('update accounting_locks set closed_until=null where id')
        if kind=='shift':h.sql(f"update cashier_shifts set status='open' where id={q(r.SHIFT[r.STAFF])}")
        if kind=='tax':h.sql('insert into company_settings(id) values(true)')
        if kind=='account':h.sql("update coa_accounts set is_active=true where code='1102'")

    # Original public clinical-note issue, then unified stage must not issue again.
    v,m=x.visit(h,940);rec=h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
    before=h.angka(f'select qty from stock where item_id={q(x.MATERIAL)}')
    h.sql(x.note(h,v,m,'unified-racik-note',x.payload(version,'unified-racik')),r.DOCTOR)
    issued=h.angka(f'select qty from stock where item_id={q(x.MATERIAL)}');moves=count('stock_moves')
    result=call(pay(v,rec,940,[],key='unified-compound'));no=h.no_tagihan(result['invoice_id'])
    check('original Catatan racikan billed HPP once without ingredient stock double-issue',issued==before-2 and h.angka(f'select qty from stock where item_id={q(x.MATERIAL)}')==issued and count('stock_moves')==moves and h.saldo_ref('4201',no)==-20000 and h.saldo_ref('5101',no)==2000 and h.saldo_ref('1201',no)==20000,dict(result=result,material_before=before,after_issue=issued,after_bill=h.angka(f'select qty from stock where item_id={q(x.MATERIAL)}'),hpp=h.saldo_ref('5101',no)))
    # Actual BMHP saved through original public Catatan, then billed once.
    v,m=x.visit(h,948);rec=h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
    service=r.uid('e',948)
    h.sql(f"insert into items(id,code,name,unit,item_type,is_active,sell_price) values({q(service)},'UJI-BMHP-SVC','Tindakan BMHP Fiktif','kali','Jasa',true,60000)")
    rx=[dict(nama_obat='Tindakan BMHP Fiktif',item_id=service,qty=1,satuan='kali',faktor=1,harga=60000,jenis='jasa',kategori='Tindakan',bmhp_components=[dict(item_id=x.MATERIAL,qty=3,unit='gram')])]
    h.sql(f"select clinic_save_inpatient_log_with_status({q(rec)},{q(m)},{j(dict(condition_note='BMHP Fiktif',log_kind='monitoring'))},{j(rx)},'[]'::jsonb,'unified-bmhp-note',null)",r.DOCTOR)
    before=h.angka(f'select qty from stock where item_id={q(x.MATERIAL)}');result=call(pay(v,rec,948,[],key='unified-bmhp'));no=h.no_tagihan(result['invoice_id'])
    check('original Catatan BMHP posts real material stock HPP revenue AR once',h.angka(f'select qty from stock where item_id={q(x.MATERIAL)}')==before-3 and h.saldo_ref('4201',no)==-60000 and h.saldo_ref('5101',no)==3000 and h.saldo_ref('1201',no)==60000,dict(result=result,before=before,stock=h.angka(f'select qty from stock where item_id={q(x.MATERIAL)}'),hpp=h.saldo_ref('5101',no)))
    before=snapshot();call(pay(v,rec,948,[],key='unified-bmhp'))
    check('BMHP unified replay has no second material issue or HPP',snapshot()==before,dict(unchanged=snapshot()==before))
    rejected('STAFF manual compound remains denied through original Catatan',x.note(h,v,m,'unified-manual-deny',x.payload(version,'unified-manual-deny',True)),r.STAFF,'ACCESS_DENIED')
    # Reissue/void lineage uses original public financial corrections.
    v,rec=fresh(960);result=call(pay(v,rec,960,[dict(method='Tunai',amount=165000)]));original=result['invoice_id'];receipt=result['receipt_id']
    h.sql(f"select clinic_change_inpatient_condition({q(rec)},'sembuh','Fiktif')",r.DOCTOR)
    h.sql(r.terbit_ulang_sql(original,'unified-reissue'),r.FINANCE);replacement=h.aktif(v)
    rejected('pending replacement blocks unified billing safely',pay(v,rec,961,[],key='pending-replacement'),r.STAFF,'INVOICE_INVALID')
    h.sql(r.koreksi_sql(h,replacement,'unified-reissue-finish',r.baris(960,1,2,3,4)),r.FINANCE)
    extra(v,960,10000);result=call(pay(v,rec,962,[],key='after-reissue'))
    check('completed replacement excludes all old Rx and counts transferred money once',h.angka(f'select total from invoices where id={q(result["invoice_id"])}')==10000 and h.diterima(replacement)==165000 and h.angka(f'select sum(total) from invoices where visit_id={q(v)} and voided_at is null')==340000,result)
    advance=h.nilai(f'select id from clinic_customer_advances where receipt_id={q(receipt)}')
    h.sql(r.lepas_sql(advance,'unified-release-reissue'),r.FINANCE);h.sql(r.batal_kwitansi_sql(receipt,'unified-cancel-reissue'),r.FINANCE)
    quote=json.loads(h.nilai(f"select clinic_quote_inpatient_payment({q(rec)},{q(v)},'[]')",r.STAFF))
    check('cancel/release after replacement nets once, no negative-payment double count',quote['remaining']==340000 and h.diterima(replacement)==0,quote)
    # Map can change independently of the billing coordinator: pause at the
    # original receipt's shift lock AFTER quote derivation, then change routing.
    v,rec=fresh(949);before=snapshot();barriers=[]
    with x.c.Session(db,'bank-race-obs') as obs,x.c.Session(db,'bank-race-gate') as gate,x.session(db,'bank-race-wait',r.STAFF) as waiter:
        gate.sql(f'begin;select id from cashier_shifts where id={q(r.SHIFT[r.STAFF])} for update;')
        waiter.send('begin;'+pay(v,rec,949,[dict(method='Transfer',amount=330000)]));x.c.wait_block(obs,waiter,gate,barriers)
        gate.sql(f"insert into payment_account_map(metode,branch_id,cash_account_id) select 'Transfer',{q(r.BRANCH)},id from cash_accounts where coa_code='1109';commit;")
        out=x.c.attempt(waiter)
    check('bank mapping changed after quote rolls back both money and invoice',not out['ok'] and 'ACCOUNT_INVALID' in out.get('error','') and snapshot()==before,dict(outcome=out,barriers=barriers,unchanged=snapshot()==before))
    h.sql(f"delete from payment_account_map where branch_id={q(r.BRANCH)} and metode='Transfer'")
    # Independent sessions: real waits, no retry masks, no expected technical errors.
    v,rec=fresh(950);sql=pay(v,rec,950,[dict(method='Tunai',amount=330000)]);barriers=[]
    with x.c.Session(db,'bill-pay-observer') as obs,x.session(db,'bill-pay-one',r.STAFF) as one,x.session(db,'bill-pay-two',r.STAFF) as two:
        one.sql('begin;'+sql);two.send('begin;'+sql);x.c.wait_block(obs,two,one,barriers);one.sql('commit;');out=x.c.attempt(two)
    check('concurrent exact bill/pay two sessions waits on coordinator and commits once',out['ok'] and barriers[0]['wait_event']=='advisory' and h.angka(f'select count(*) from invoices where visit_id={q(v)}')==1 and h.angka(f'select count(*) from clinic_payment_receipts where visit_id={q(v)}')==1,dict(outcome=out,barriers=barriers))
    # Doctor adds a NEW compound first while payment waits; quote is rederived.
    v,m=x.visit(h,951);rec=h.nilai(f'select id from inpatient_records where visit_id={q(v)}');barriers=[]
    note=x.note(h,v,m,'concurrent-doctor-note',x.payload(version,'concurrent-doctor-racik'))
    sql=pay(v,rec,951,[],key='concurrent-doctor-bill')
    with x.c.Session(db,'doctor-bill-observer') as obs,x.session(db,'doctor-adds',r.DOCTOR) as one,x.session(db,'cashier-bills',r.STAFF) as two:
        one.sql('begin;'+note);two.send('begin;'+sql);x.c.wait_block(obs,two,one,barriers);one.sql('commit;');out=x.c.attempt(two)
    inv=h.nilai("select id from invoices where request_key='bill:concurrent-doctor-bill'")
    check('doctor addition before waiting bill/pay included without deadlock',out['ok'] and barriers[0]['wait_event']=='advisory' and h.saldo_ref('4201',h.no_tagihan(inv))==-20000 and h.saldo_ref('5101',h.no_tagihan(inv))==2000,dict(outcome=out,barriers=barriers))
    v,rec=fresh(952);barriers=[];before=snapshot()
    with x.c.Session(db,'revoke-obs') as obs,x.c.Session(db,'revoke-gate') as gate,x.session(db,'revoke-wait',r.STAFF) as waiter:
        gate.sql(f'begin;select clinic_private.billing_lock(clinic_private.billing_keys_visit({q(v)}));')
        waiter.send('begin;'+pay(v,rec,952,[dict(method='Tunai',amount=330000)]));x.c.wait_block(obs,waiter,gate,barriers)
        gate.sql(f'update profiles set is_active=false where id={q(r.STAFF)};commit;');out=x.c.attempt(waiter)
    h.sql(f'update profiles set is_active=true where id={q(r.STAFF)}')
    check('role revocation after coordinator wait denies before any money',not out['ok'] and 'ACCESS_DENIED' in out.get('error','') and snapshot()==before,dict(outcome=out,barriers=barriers))
    # Different nonce after another cashier settles must not collect twice.
    v,rec=fresh(955);barriers=[]
    with x.c.Session(db,'nonce-obs') as obs,x.session(db,'nonce-one',r.STAFF) as one,x.session(db,'nonce-two',r.STAFF) as two:
        one.sql('begin;'+pay(v,rec,955,[dict(method='Tunai',amount=330000)],key='nonce-first'))
        two.send('begin;'+pay(v,rec,955,[dict(method='Tunai',amount=330000)],key='nonce-second'));x.c.wait_block(obs,two,one,barriers);one.sql('commit;');out=x.c.attempt(two)
    returned=json.loads(out['result'][0]) if out['ok'] else {}
    check('concurrent different-key settled payment requires new excess confirmation not second collection',out['ok'] and returned.get('status')=='OVERPAYMENT_CONFIRM_REQUIRED' and h.angka(f'select count(*) from clinic_payment_receipts where visit_id={q(v)}')==1,dict(outcome=out,barriers=barriers))
    # Confirmed quote must be rederived AFTER waiting for a doctor's addition.
    v,rec=fresh(953);parts=[dict(method='Tunai',amount=400000)];pending=call(pay(v,rec,953,parts));barriers=[]
    with x.c.Session(db,'stale-obs') as obs,x.session(db,'stale-doctor',r.DOCTOR) as doctor,x.session(db,'stale-cashier',r.STAFF) as waiter:
        doctor.sql('begin;'+x.note(h,v,r.uid(7,953),'stale-note',x.payload(version,'stale-racik')))
        waiter.send('begin;'+pay(v,rec,953,parts,ack=pending['quote']['token']));x.c.wait_block(obs,waiter,doctor,barriers);doctor.sql('commit;');out=x.c.attempt(waiter)
    returned=json.loads(out['result'][0]) if out['ok'] else {}
    check('acknowledged quote stale after real coordinator wait returns reconfirm with new pending amount',out['ok'] and returned.get('status')=='OVERPAYMENT_CONFIRM_REQUIRED' and returned['quote']['remaining']==350000 and h.angka(f'select count(*) from clinic_payment_receipts where visit_id={q(v)}')==0 and h.angka(f'select count(*) from invoices where visit_id={q(v)}')==0,dict(outcome=out,barriers=barriers))
    # Opposite ordering: cashier holds visit/coordinator, new original clinical
    # note waits at advisory (not visit lock); its new recipe stays pending.
    v,m=x.visit(h,954);rec=h.nilai(f'select id from inpatient_records where visit_id={q(v)}');extra(v,954,50000);barriers=[]
    with x.c.Session(db,'opposite-obs') as obs,x.session(db,'opposite-pay',r.STAFF) as cashier,x.session(db,'opposite-doctor',r.DOCTOR) as doctor:
        cashier.sql('begin;'+pay(v,rec,954,[dict(method='Tunai',amount=100000)],key='opposite-pay-first'))
        doctor.send('begin;'+x.note(h,v,m,'opposite-note',x.payload(version,'opposite-racik')));x.c.wait_block(obs,doctor,cashier,barriers);cashier.sql('commit;');out=x.c.attempt(doctor)
    inv=h.nilai("select id from invoices where request_key='bill:opposite-pay-first'")
    check('cashier-first doctor-second both commit without deadlock or auto-post on note save',out['ok'] and barriers[0]['wait_event']=='advisory' and h.angka(f'select total from invoices where id={q(inv)}')==50000 and h.angka(f'select count(*) from invoice_items where compound_recipe_id=(select id from compounding_recipes where request_key=\'opposite-racik\')')==0,dict(outcome=out,barriers=barriers))
    for n,user in [(970,r.DOCTOR),(971,r.ADMIN),(972,r.FINANCE),(973,r.OWNER)]:
        v,rec=fresh(n);result=call(pay(v,rec,n,[dict(method='Tunai',amount=165000)]),user)
        check(r.PERAN[user]+' original cashier role retained for valid initial collection',result['status']=='SAVED' and h.diterima(result['invoice_id'])==165000,result)
    check('public grant boundary and private orchestration state inaccessible to app role',h.nilai("select has_function_privilege('authenticated','public.clinic_bill_and_pay_inpatient(uuid,uuid,text,date,jsonb,text,boolean,text)','execute') and not has_function_privilege('anon','public.clinic_bill_and_pay_inpatient(uuid,uuid,text,date,jsonb,text,boolean,text)','execute') and not has_function_privilege('authenticated','clinic_private.apply_invoice_owner_credit(uuid,date)','execute') and not has_table_privilege('authenticated','clinic_private.inpatient_bill_pay_requests','select')")=='t',dict(checked=['authenticated public execute','anon denied','private helper denied','private request table denied']))
    check('nonempty journals each balanced and trusted posting context cleared',count('journal_entries')>0 and h.angka('select count(*) from (select entry_id from journal_lines group by entry_id having sum(debit)<>sum(credit)) t')==0 and count('clinic_private.posting_ctx')==0,dict(journals=count('journal_entries')))
