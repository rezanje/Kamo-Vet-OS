#!/usr/bin/env python3
"""LOCAL ONLY: original public inpatient-note compound RPC, full native schema.
No remote URL, packages or business stubs. All people/catalogue rows fictional.
--baseline omits only this candidate; preserves RED JSON independently.
"""
import argparse
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = '20261104030000_ranap_racikan_setelah_dp.sql'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


r = load('original_full', 'test-ranap-mitigasi-penuh-postgres.py')
dp = load('original_dp', 'test-dp-lanjut-ranap-postgres.py')
c = load('original_sessions', 'test-ranap-mitigasi-concurrency-postgres.py')
q, j = r.q, r.j
MATERIAL, SKU = r.uid('e', 801), r.uid('e', 802)
RESULTS = []


class LocalPostgres(r.NativePostgres):
    def __enter__(self):
        # Native helper uses initdb's default 128MB shared_buffers. Keep <=128MB.
        db = super().__enter__()
        assert db.sql('show shared_buffers') == '128MB'
        return db


def claims(user):
    return "set role authenticated; select set_config('request.jwt.claims'," + q(json.dumps(dict(sub=user, role='authenticated'))) + ',false);\n'


class Harness(r.Harness):
    def sql(self, sql, user=None):
        return self.db.sql(sql if user is None else claims(user) + sql)


def check(case, ok, detail):
    RESULTS.append(dict(case=case, status='PASS' if ok else 'FAIL', detail=detail))
    print(RESULTS[-1]['status'], case, json.dumps(detail, ensure_ascii=False), flush=True)


def setup(h):
    h.sql(r.dasar_sql())
    h.sql(f"""
insert into public.items(id,code,name,unit,item_type,is_active,is_compound_material,sell_price,buy_price) values
 ({q(MATERIAL)},'UJI-RANAP-MAT','Bahan racik Fiktif','gram','Persediaan',true,true,5000,1000),
 ({q(SKU)},'UJI-RANAP-SKU','Obat Racik Fiktif','pcs','Persediaan',true,false,20000,0);
insert into public.stock(warehouse_id,item_id,qty) values({q(r.WH)},{q(MATERIAL)},500);
insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
 values({q(r.WH)},{q(MATERIAL)},current_date,500,500,1000,'purchase');
""")
    version = h.nilai(f"select public.publish_compound_formula(null,'UJI-RANAP-FORMULA','Racikan resmi Fiktif','kapsul','Instruksi Fiktif',{j([dict(item_id=MATERIAL,quantity=2,unit='gram')])});", r.OWNER)
    formula = h.nilai(f'select formula_id from public.compound_formula_versions where id={q(version)}')
    h.sql(f'select public.bind_compound_formula_sale_item({q(formula)},{q(SKU)});', r.OWNER)
    return version


def visit(h, n, admitted=True, paid=False):
    v = dp.visit(h, n)
    if admitted:
        h.sql(dp.post(v, n), r.OWNER)
        if paid:
            inv=h.aktif(v)
            h.sql(f"select public.clinic_receive_invoice_payment({q(inv)},'2026-11-03',170000,'Tunai','1101','Fiktif',{q('settle-'+str(n))});",r.OWNER)
            # Complete chain guards payment status from closing active care.
            # Selesai compatibility is exercised separately as a labelled fixture.
    return v, r.uid(7, n)


def payload(version, key, custom=False, sku=True):
    row: dict = dict(request_key=key, dosage_instruction='Instruksi Fiktif')
    if sku:
        row['sale_item_id'] = SKU
    if custom:
        row['recipe'] = dict(recipe_name='Obat Racik Fiktif', dosage_instruction='Instruksi Fiktif', dosage_form='kapsul',
                             ingredients=[dict(item_id=MATERIAL, quantity=3, unit='gram', unit_price=5000)])
    else:
        row['official_version_id'] = version
    return row


def note(h, v, m, key, row):
    stay = h.nilai(f'select id from public.inpatient_records where visit_id={q(v)} order by admitted_at desc limit 1')
    return f"select public.clinic_save_inpatient_log_with_status({q(stay)},{q(m)},{j(dict(condition_note='Monitoring Fiktif',log_kind='monitoring'))},'[]'::jsonb,{j([row])},{q(key)},null);"


def issue(v, m, row):
    if 'sale_item_id' in row:
        return f"select public.clinic_issue_master_compound({q(m)},{q(v)},{q(SKU)},{j(row['recipe']) if 'recipe' in row else 'null'},{q(row['request_key'])},{q(row['official_version_id']) if 'official_version_id' in row else 'null'},{q(row['dosage_instruction'])});"
    if 'official_version_id' in row:
        return f"select public.clinic_issue_official_compound({q(m)},{q(v)},{q(row['official_version_id'])},{q(row['request_key'])},{q(row['dosage_instruction'])});"
    return f"select public.clinic_issue_compound({q(m)},{q(v)},{j(row['recipe'])},{q(row['request_key'])});"


def state(h):
    return json.loads(h.nilai(f"""select json_build_object(
 'stock',(select qty from public.stock where warehouse_id={q(r.WH)} and item_id={q(MATERIAL)}),
 'layers',(select sum(qty_left) from public.stock_layers where item_id={q(MATERIAL)}),
 'recipes',(select count(*) from public.compounding_recipes),
 'issues',(select count(*) from public.compound_issues),
 'moves',(select count(*) from public.stock_moves),
 'logs',(select count(*) from public.inpatient_daily_logs),
 'prescriptions',(select count(*) from public.prescription_items),
 'invoices',(select count(*) from public.invoices),
 'journals',(select count(*) from public.journal_entries))"""))


def invoice_snapshot(h, v):
    return h.nilai(f"select jsonb_agg(to_jsonb(i) order by id) from public.invoices i where visit_id={q(v)}")


def recipe_row(h, key):
    return h.nilai(f'select id from public.compounding_recipes where request_key={q(key)}')


def line(h, recipe):
    return json.loads(h.nilai(f"select json_build_object('description',nama_obat,'qty',qty,'price',harga,'unit',satuan,'item_id',item_id,'prescription_item_id',id,'recipe_id',compound_recipe_id,'kind',jenis,'discount_percent',0) from public.prescription_items where compound_recipe_id={q(recipe)}"))


def tracer(h, version):
    v,m = visit(h,801)
    row=payload(version,'tracer-issue')
    sql=note(h,v,m,'tracer-note',row)
    before=state(h); old=invoice_snapshot(h,v)
    err=h.gagal(sql,r.DOCTOR)
    after=state(h)
    ingredients=h.nilai("select coalesce(jsonb_agg(jsonb_build_object('quantity',i.quantity,'unit',i.unit,'unit_price',i.unit_price)), '[]'::jsonb) from public.compounding_ingredients i join public.compounding_recipes r on r.id=i.recipe_id where r.request_key='tracer-issue'")
    check('DOCTOR official original Catatan public RPC after DP',not err and after['stock']==before['stock']-2
          and after['recipes']==before['recipes']+1 and after['logs']==before['logs']+1
          and json.loads(ingredients)==[dict(quantity=2,unit='gram',unit_price=5000)]
          and invoice_snapshot(h,v)==old,dict(error=err,before=before,after=after,ingredients=json.loads(ingredients)))
    return not err


def session(db, name, user):
    s=c.Session(db,name)
    s.sql(claims(user))
    return s


def denied(h, label, sql, user, expected):
    before=state(h)
    err=h.gagal(sql,user)
    check(label,bool(err and expected in err) and state(h)==before,
          dict(error=err,unchanged=state(h)==before))


def matrix(h, db, version):
    # The tracer's issued prescription is later billed with the real staged RPC.
    v,m=r.uid(6,801),r.uid(7,801)
    recipe=recipe_row(h,'tracer-issue')
    first=h.nilai(f"select id from public.invoices where visit_id={q(v)} and request_key='dp-first-801'")
    old_sql=f"select jsonb_build_object('header',to_jsonb(i),'lines',(select jsonb_agg(to_jsonb(l) order by id) from public.invoice_items l where l.invoice_id=i.id),'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.invoice_payments p where p.invoice_id=i.id)) from public.invoices i where i.id={q(first)}"
    old=h.nilai(old_sql); stock=state(h)
    bill=r.tagih_sql(v,'tracer-stage',[line(h,recipe)],r.OWNER)
    inv=h.nilai(bill,r.OWNER)
    no=h.no_tagihan(inv)
    cost=h.angka(f'select sum(qty*unit_cost) from public.compound_issues where recipe_id={q(recipe)} and posted_invoice_item_id is not null')
    check('later stage posts revenue AR HPP without second ingredient issue',
          state(h)['stock']==stock['stock'] and state(h)['moves']==stock['moves']
          and cost==2000 and h.saldo_ref('4201',no)==-20000 and h.saldo_ref('5101',no)==2000
          and h.saldo_ref('1201',no)==20000 and h.diterima(inv)==0
          and h.angka(f'select count(*) from public.invoice_items where compound_recipe_id={q(recipe)}')==1,
          dict(stock_before=stock,stock_after=state(h),posted_cost=cost,revenue=h.saldo_ref('4201',no),hpp=h.saldo_ref('5101',no),ar=h.saldo_ref('1201',no)))
    # Original DP invoice, its lines and money stay untouched after new stage.
    check('original DP retained',h.nilai(old_sql)==old and h.diterima(first)==200000 and h.status_bayar(first)=='DP'
          and h.angka(f'select total from public.invoices where id={q(first)}')==370000
          and h.angka(f'select count(*) from public.invoice_items where invoice_id={q(first)}')==4,
          dict(received=h.diterima(first),status=h.status_bayar(first),total=370000,lines=4,header_lines_payments_unchanged=h.nilai(old_sql)==old))
    before=state(h)
    row=payload(version,'tracer-issue')
    retry=h.nilai(issue(v,m,row),r.DOCTOR)
    h.sql(note(h,v,m,'tracer-note',row),r.DOCTOR)
    h.sql(bill,r.OWNER)
    check('exact issue note stage replay after posting is effect-free',retry==recipe and state(h)==before,state(h))
    denied(h,'changed compound retry conflicts',issue(v,m,payload(version,'tracer-issue',custom=True)),r.DOCTOR,'IDEMPOTENCY_CONFLICT')
    denied(h,'old billed recipe cannot be returned',f"select public.clinic_return_compound({q(recipe)},'Fiktif');",r.OWNER,'RECIPE_LINKED')
    denied(h,'old billed recipe cannot be voided',f"select public.clinic_void_compound({q(recipe)});",r.OWNER,'RECIPE_LINKED')
    # Correctly use original master-SKU custom path (DOCTOR allowed), not legacy
    # no-SKU exception wrapper (OWNER/ADMIN only). STAFF remains official-only.
    for n,user,custom,label in [(802,r.DOCTOR,True,'DOCTOR custom'),(803,r.STAFF,False,'STAFF official'),(804,r.OWNER,True,'OWNER custom'),(805,r.ADMIN,False,'ADMIN official')]:
        v,m=visit(h,n);row=payload(version,f'issue-{n}',custom)
        before=state(h);old=invoice_snapshot(h,v)
        err=h.gagal(note(h,v,m,f'note-{n}',row),user)
        check(label+' after DP',not err and state(h)['stock']==before['stock']-(3 if custom else 2)
              and state(h)['recipes']==before['recipes']+1 and invoice_snapshot(h,v)==old,
              dict(error=err,before=before,after=state(h)))
        if not err and custom:
            rec=recipe_row(h,f'issue-{n}')
            denied(h,label+' cannot alter issued composition after DP',f"select public.clinic_adjust_compound({q(rec)},{j([dict(item_id=MATERIAL,quantity=4,unit='gram')])},'Fiktif');",user,'INVOICE_PAID')
    v,m=visit(h,806)
    denied(h,'STAFF manual remains denied',note(h,v,m,'staff-custom',payload(version,'staff-custom-issue',True)),r.STAFF,'ACCESS_DENIED')
    denied(h,'DOCTOR legacy no-SKU custom remains denied',issue(v,m,payload(version,'doctor-direct-custom',True,False)),r.DOCTOR,'ACCESS_DENIED')
    denied(h,'FINANCE not compound stock role',issue(v,m,payload(version,'finance-issue')),r.FINANCE,'ACCESS_DENIED')
    # Legacy original official entrypoint must share the coordinator too.
    before=state(h);row=payload(version,'direct-official',sku=False)
    err=h.gagal(issue(v,m,row),r.STAFF)
    check('direct public official after DP',not err and state(h)['stock']==before['stock']-2,dict(error=err))
    before=state(h);row=payload(version,'direct-custom',True,False)
    err=h.gagal(issue(v,m,row),r.OWNER)
    check('legacy OWNER direct custom after DP',not err and state(h)['stock']==before['stock']-3,dict(error=err))
    # Actual full-chain payment keeps Pembayaran while inpatient care is open.
    # Selesai is tested separately as historical-state compatibility, NOT claimed
    # as a public journey generated by the current complete migration chain.
    v,m=visit(h,807,paid=True)
    financial=h.nilai(f'select status from public.visits where id={q(v)}')
    err=h.gagal(note(h,v,m,'paid-note',payload(version,'paid-issue')),r.DOCTOR)
    check('actual fully paid admission still permits NEW compound',not err and financial=='Pembayaran'
          and h.status_bayar(h.aktif(v))=='Lunas',dict(error=err,actual_financial_status=financial))
    h.sql(f"update public.visits set status='Selesai' where id={q(v)}")
    err=h.gagal(note(h,v,m,'legacy-selesai-note',payload(version,'legacy-selesai-issue')),r.DOCTOR)
    check('explicit historical Selesai active-care fixture permits NEW compound',not err
          and h.nilai(f'select status from public.visits where id={q(v)}')=='Selesai',dict(error=err,fixture='Selesai seeded by test SQL, not a current public financial journey'))
    # Outpatient ANY invoice history, including a voided-only history, denies.
    for n,voided in [(808,False),(809,True)]:
        v,m=visit(h,n,False)
        h.sql(r.tagih_biasa_sql(v,f'out-{n}',dp.lines(n),r.OWNER,dp=200000),r.OWNER)
        if voided:
            h.sql(f"update public.invoices set voided_at=now() where visit_id={q(v)}")
        denied(h,'outpatient '+('voided historical' if voided else 'issued')+' invoice denies',issue(v,m,payload(version,f'out-issue-{n}')),r.DOCTOR,'RECIPE_POSTED')
    for n,label in [(810,'discharged'),(811,'checked-out'),(812,'wrong-branch'),(813,'inactive'),(814,'foreign-record'),(816,'nonclinical')]:
        v,m=visit(h,n)
        user=r.DOCTOR;expected='ACCESS_DENIED'
        if label=='discharged':
            stay=h.nilai(f'select id from public.inpatient_records where visit_id={q(v)}')
            h.sql(f"select public.clinic_change_inpatient_condition({q(stay)},'sembuh','Fiktif');",r.DOCTOR)
            expected='RECIPE_POSTED'
        if label=='checked-out':
            h.sql(f'update public.visits set checked_out_at=now() where id={q(v)}');expected='RECIPE_POSTED'
        if label=='wrong-branch':user=r.FIN_LUAR
        if label=='inactive':
            h.sql(f'update public.profiles set is_active=false where id={q(r.DOCTOR)}')
        if label=='foreign-record':m=r.uid(7,801)
        if label=='nonclinical':
            h.sql(f"update public.visits set poli='grooming' where id={q(v)}");expected='RECIPE_POSTED'
        denied(h,label+' denied before stock',issue(v,m,payload(version,f'deny-{n}')),user,expected)
        if label=='inactive':h.sql(f'update public.profiles set is_active=true where id={q(r.DOCTOR)}')
    initial_path(h,db,version)
    reverse_race(h,db,version)
    races(h,db,version)
    check('nonempty per-entry journals balanced and posting context clean',h.angka('select count(*) from public.journal_entries')>0
          and h.angka('select count(*) from (select entry_id from public.journal_lines group by entry_id having sum(debit)<>sum(credit)) t')==0
          and h.angka('select count(*) from clinic_private.posting_ctx')==0,dict(journals=h.angka('select count(*) from public.journal_entries')))


def initial_path(h,db,version):
    n=830
    customer=r.buat_pelanggan(h,n)
    v,pet=r.uid(6,n),r.uid(5,n)
    h.sql(f"insert into public.pets(id,customer_id,name) values({q(pet)},{q(customer['id'])},'Fiktif initial');insert into public.visits(id,branch_id,customer_id,pet_id,status,doctor_id,service_started_at) values({q(v)},{q(r.BRANCH)},{q(customer['id'])},{q(pet)},'Diperiksa',{q(r.DOKTER_PEGAWAI)},now());")
    sql=f"select public.clinic_save_initial_record({q(v)},{q(pet)},'{{}}'::jsonb,'[]'::jsonb,'[]'::jsonb,{j([payload(version,'initial-official')])},null,{q(r.DOKTER_PEGAWAI)},'Dokter Fiktif','Keluhan Fiktif','initial-note');"
    before=state(h);evidence=[]
    with c.Session(db,'initial-obs') as obs,c.Session(db,'initial-gate') as gate,session(db,'initial-waiter',r.DOCTOR) as waiter:
        gate.sql(f'begin;select clinic_private.billing_lock(clinic_private.billing_keys_visit({q(v)}));select id from public.visits where id={q(v)} for update;')
        waiter.send('begin;'+sql);c.wait_block(obs,waiter,gate,evidence)
        gate.sql('commit;');result=c.attempt(waiter)
    check('original invoker initial outpatient record retains permissions and coordinator order',result['ok'] and evidence[0]['wait_event']=='advisory'
          and state(h)['stock']==before['stock']-2 and state(h)['recipes']==before['recipes']+1
          and state(h)['invoices']==before['invoices'],dict(result=result,barriers=evidence,before=before,after=state(h)))


def reverse_race(h,db,version):
    v,m=visit(h,831);before=state(h)
    sql=note(h,v,m,'issue-first-note',payload(version,'issue-first'))
    extra=r.uid(9,83199)
    h.sql(f"insert into public.prescription_items(id,medical_record_id,nama_obat,qty,harga,satuan,jenis) values({q(extra)},{q(m)},'Jasa reverse Fiktif',1,60000,'kali','jasa');")
    stage=r.tagih_sql(v,'stage-second',[dict(description='Jasa reverse Fiktif',qty=1,price=60000,unit='kali',kind='jasa',prescription_item_id=extra,discount_percent=0)],r.OWNER)
    evidence=[]
    with c.Session(db,'reverse-obs') as obs,session(db,'reverse-issue',r.DOCTOR) as a,session(db,'reverse-stage',r.OWNER) as b:
        a.sql('begin;'+sql);b.send('begin;'+stage)
        c.wait_block(obs,b,a,evidence);a.sql('commit;');result=c.attempt(b)
    invoice=h.nilai(f"select id from public.invoices where request_key='stage-second'")
    check('new issue first concurrent stage second both commit once',result['ok'] and evidence[0]['wait_event']=='advisory'
          and state(h)['stock']==before['stock']-2 and state(h)['recipes']==before['recipes']+1
          and state(h)['invoices']==before['invoices']+1 and h.saldo_ref('4201',h.no_tagihan(invoice))==-60000
          and h.saldo_ref('1201',h.no_tagihan(invoice))==60000,
          dict(result=result,barriers=evidence,before=before,after=state(h)))


def races(h,db,version):
    # Real sessions. Holding the coordinator and the visit while issue starts is
    # the discriminating schedule: the old outer visit-before-coordinator path
    # cannot reach the advisory barrier and would form the inverse lock order.
    for n,label in [(820,'master'),(821,'official'),(822,'direct'),(823,'note')]:
        v,m=visit(h,n)
        extra=r.uid(9,n*100+99)
        h.sql(f"insert into public.prescription_items(id,medical_record_id,nama_obat,qty,harga,satuan,jenis) values({q(extra)},{q(m)},'Jasa race Fiktif',1,60000,'kali','jasa');")
        stage=[dict(description='Jasa race Fiktif',qty=1,price=60000,unit='kali',kind='jasa',prescription_item_id=extra,discount_percent=0)]
        before=state(h)
        row=payload(version,f'race-{n}',custom=label=='direct',sku=label not in ('official','direct'))
        sql=note(h,v,m,f'race-note-{n}',row) if label=='note' else issue(v,m,row)
        evidence=[]
        with c.Session(db,f'obs-{n}') as obs,c.Session(db,f'gate-{n}') as gate,session(db,f'issue-{n}',r.OWNER) as waiter:
            gate.sql(f'begin;select clinic_private.billing_lock(clinic_private.billing_keys_visit({q(v)}));select id from public.visits where id={q(v)} for update;')
            waiter.send('begin;'+sql)
            c.wait_block(obs,waiter,gate,evidence)
            # Only advisory wait proves coordinator before visit/recipe/catalogue.
            gate.sql(claims(r.OWNER)+r.tagih_sql(v,f'race-stage-{n}',stage,r.OWNER)+'commit;')
            result=c.attempt(waiter)
        delta=3 if label=='direct' else 2
        check(label+' simultaneous original stage and new issue no deadlock',result['ok']
              and evidence[0]['wait_event']=='advisory' and state(h)['stock']==before['stock']-delta
              and state(h)['recipes']==before['recipes']+1,dict(result=result,barriers=evidence,before=before,after=state(h)))
    v,m=visit(h,824);row=payload(version,'concurrent-duplicate')
    sql=note(h,v,m,'concurrent-duplicate-note',row);before=state(h);evidence=[]
    with c.Session(db,'duplicate-obs') as obs,session(db,'duplicate-a',r.DOCTOR) as a,session(db,'duplicate-b',r.DOCTOR) as b:
        a.sql('begin;'+sql);b.send('begin;'+sql)
        c.wait_block(obs,b,a,evidence);a.sql('commit;');result=c.attempt(b)
    check('concurrent duplicate note issues and prescribes exactly once',result['ok'] and state(h)['recipes']==before['recipes']+1
          and state(h)['prescriptions']==before['prescriptions']+1 and state(h)['moves']==before['moves']+1
          and state(h)['stock']==before['stock']-2 and state(h)['logs']==before['logs']+1,
          dict(result=result,barriers=evidence,before=before,after=state(h)))
    for n,kind in [(825,'inactive'),(826,'DOCTOR-to-STAFF-custom'),(827,'branch-revoked')]:
        v,m=visit(h,n);row=payload(version,f'wait-role-{n}',custom=kind=='DOCTOR-to-STAFF-custom')
        sql=note(h,v,m,f'wait-note-{n}',row);before=state(h);evidence=[]
        with c.Session(db,f'role-obs-{n}') as obs,c.Session(db,f'role-gate-{n}') as gate,session(db,f'role-wait-{n}',r.DOCTOR) as waiter:
            gate.sql(f'begin;select clinic_private.billing_lock(clinic_private.billing_keys_visit({q(v)}));')
            waiter.send('begin;'+sql);c.wait_block(obs,waiter,gate,evidence)
            change=(f'update public.profiles set is_active=false where id={q(r.DOCTOR)};' if kind=='inactive' else
                    f"update public.profiles set role='STAFF' where id={q(r.DOCTOR)};" if kind=='DOCTOR-to-STAFF-custom' else
                    f'delete from public.user_branches where user_id={q(r.DOCTOR)};')
            gate.sql(change+'commit;');result=c.attempt(waiter)
        check('recheck after coordinator wait '+kind,not result['ok'] and 'ACCESS_DENIED' in result.get('error','')
              and state(h)==before,dict(result=result,barriers=evidence,unchanged=state(h)==before))
        h.sql(f"update public.profiles set is_active=true,role='DOCTOR' where id={q(r.DOCTOR)};insert into public.user_branches(user_id,branch_id) values({q(r.DOCTOR)},{q(r.BRANCH)}) on conflict do nothing;")


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--baseline',action='store_true')
    p.add_argument('--json',type=Path,required=True)
    p.add_argument('--definitions',type=Path)
    args=p.parse_args()
    migrations=sorted((ROOT/'supabase/migrations').glob('*.sql'))
    selected=[x for x in migrations if not(args.baseline and x.name==CANDIDATE)]
    try:
        with tempfile.TemporaryDirectory(prefix='kamo-racikan-chain-',dir='/opt/data') as folder:
            target=Path(folder)/'supabase/migrations';target.mkdir(parents=True)
            for source in selected:(target/source.name).symlink_to(source)
            r.fixture.ROOT=Path(folder)
            with LocalPostgres(r.BIN) as db:
                r.fixture.DisposablePostgres.bootstrap(db)
                h=Harness(db)
                if args.definitions:
                    args.definitions.write_text(db.sql("select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in ('clinic_issue_master_compound','clinic_issue_compound','clinic_issue_official_compound','clinic_save_initial_record','clinic_save_inpatient_log','clinic_save_inpatient_log_with_status','clinic_change_inpatient_condition')) or (n.nspname='clinic_private' and p.proname in ('clinic_issue_compound','assert_compound_visit_unposted')) order by n.nspname,p.proname"))
                version=setup(h)
                if tracer(h,version) and not args.baseline:
                    matrix(h,db,version)
    except Exception as error:
        check('HARNESS',False,str(error))
    totals={s:sum(x['status']==s for x in RESULTS) for s in ('PASS','FAIL')}
    args.json.write_text(json.dumps(dict(mode='RED baseline' if args.baseline else 'GREEN candidate',migration_count=len(selected),last_migration=selected[-1].name,totals=totals,cases=RESULTS),indent=2,ensure_ascii=False))
    print('TOTAL',totals,flush=True)
    return int(totals['FAIL']>0)


if __name__=='__main__':
    sys.exit(main())
