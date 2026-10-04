#!/usr/bin/env python3
"""Fictional isolated PostgreSQL checks; no remote credentials or connections."""
from pathlib import Path
import os, subprocess, time, sys
root = Path(__file__).resolve().parents[1]
env = {k:v for k,v in os.environ.items() if not k.startswith('DOCKER_')}
cmd = ['docker','--host=unix:///var/run/docker.sock']
def docker(*args, **kwargs):
    return subprocess.run([*cmd,*args],env=env,text=True,**kwargs)
container = docker('run','--rm','-d','--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16',capture_output=True,check=True).stdout.strip()
def sql(source):
    r=docker('exec','-i',container,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1',input=source,capture_output=True)
    if r.returncode: raise RuntimeError(r.stdout[-2000:]+r.stderr)
    return r.stdout.strip()
try:
    for _ in range(300):
        if docker('exec',container,'pg_isready','-h','127.0.0.1','-U','postgres',capture_output=True).returncode==0: break
        time.sleep(.2)
    fixture='''create role authenticated nologin; create role anon nologin; create role service_role nologin;
create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role()returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
'''
    names=['0001_core','0002_rls','0004_perf_security_fixes','0005_klinik_visits','0006_rekam_medis','0007_crm_fields','0008_klinik_pembayaran','0010_pos_sales','0013_stock','0015_keuangan','0021_pembelian','0029_compounding','0040_klinik_satuan','0043_ar_ap_fixed_assets','0055_tutup_buku','0056_faktur_pembelian','0058_stock_layers_fifo','0060_user_admin','0063_satuan_berjenjang','0064_penerimaan_qty','0065_barang_jasa_master','0066_master_data_kategori','0068_kas_bank','0074_kartu_stok','0093_penerimaan_barang','0101_akses_grup','0104_kadaluarsa','0109_faktur_langsung','0113_coa_header_detail','0117_kadaluarsa_bertingkat']
    for name in names:
        files=list((root/'supabase/migrations').glob(name.split('_')[0]+'_*.sql'))
        if len(files)!=1: raise RuntimeError('Ambiguous migration '+name)
        if name=='0066_master_data_kategori': fixture+="alter table customers add column kategori text default 'Umum';\n"
        if name=='0068_kas_bank': fixture+="insert into coa_accounts(code,name,type,normal_balance)values('1101','Fiction cash','ASET','D'),('1102','Fiction bank','ASET','D'),('1301','Fiction inventory','ASET','D'),('1501','Fiction asset','ASET','D'),('2101','Fiction AP','LIABILITAS','K'),('1105','Fiction VAT','ASET','D')on conflict(code)do nothing;\n"
        fixture+=files[0].read_text()+'\n'
    fixture+='alter table stock_layers add column batch_no varchar(80);\n'
    fixture+=(root/'supabase/migrations/20260924120000_purchase_invoice_po_units.sql').read_text()+'\n'
    fixture+=(root/'supabase/migrations/20260924121000_atomic_purchase_layer_reprice.sql').read_text()+'\n'
    fixture+=(root/'supabase/migrations/20260924122000_atomic_po_invoice_and_stock_out.sql').read_text()+'\n'
    fixture+=(root/'supabase/migrations/20260924123000_atomic_fixed_asset_purchase.sql').read_text()+'\n'
    fixture+='grant usage on schema public,auth to authenticated;grant all on all tables in schema public to authenticated;grant execute on function auth.uid(),auth.role()to authenticated;\n'
    new=root/'supabase/migrations/20261004120000_purchase_recovery.sql'
    if new.exists() and "--baseline" not in sys.argv:fixture+=new.read_text()
    sql(fixture)
    sql((root/'supabase/tests/purchase_recovery.sql').read_text())
    print('PASS: purchase atomicity, staged quantities, recovery and authorization',flush=True)
    source=(root/'supabase/tests/purchase_recovery.sql').read_text()
    sql(source[:source.index('create function public.purchase_test_failure')].replace('begin;','',1))
    auth="begin;set local role authenticated;select set_config('request.jwt.claim.role','authenticated',true);select set_config('request.jwt.claim.sub','dc000000-0000-4000-8000-000000000001',true);"
    def race(queries, label, successes=2):
        jobs=[subprocess.Popen([*cmd,'exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],env=env,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)for q in queries]
        for job,q in zip(jobs,queries):
            job.stdin.write(auth+q+';select pg_sleep(.4);commit;');job.stdin.close()
        results=[]
        for job in jobs:
            job.wait(timeout=30)
            results.append((job.returncode,job.stdout.read(),job.stderr.read()))
        if sum(r[0]==0 for r in results)!=successes:raise RuntimeError(label+str(results))
        print('PASS: '+label,flush=True)
        return results
    def receipt(key):
        return "select receive_purchase_order('dc400000-0000-4000-8000-000000000001','"+key+"','TB.RACE.',5,current_date,null,null,'[{\"id\":\"dc500000-0000-4000-8000-000000000001\",\"qty_terima\":2}]')->>'receipt_id'"
    results=race([receipt('same-receipt'),receipt('same-receipt')],'concurrent identical receipt retry')
    ids=[r[1].splitlines()[2]for r in results]
    if ids[0]!=ids[1]or sql('select count(*)from goods_receipts')!='1'or sql('select qty=20 from stock')!='t':raise RuntimeError('concurrent receipt retry duplicated effects')
    results=race([receipt('rest-one'),receipt('rest-two')],'concurrent remaining receipt accepts one complete shipment',1)
    if sql('select count(*)from goods_receipts')!='2'or sql('select qty=40 from stock')!='t'or sql("select count(*)from journal_entries where source='purchase'")!='2':raise RuntimeError('competing receipt corrupted quantity or journal')
    if not any('PO batal atau lengkap' in r[2]for r in results):raise RuntimeError('Unexpected losing receipt failure '+str(results))
    def invoice(key,qty):
        return "select invoice_id from create_purchase_invoice_from_po('dc400000-0000-4000-8000-000000000001','FB.RACE.',5,null,current_date,current_date+30,null,'[{\"po_item_id\":\"dc500000-0000-4000-8000-000000000001\",\"qty\":"+str(qty)+",\"harga\":100,\"expected_harga_po\":100,\"expected_faktor\":10}]','[]','[]',0,'"+key+"')"
    results=race([invoice('same-invoice',1),invoice('same-invoice',1)],'concurrent identical partial invoice retry')
    if results[0][1].splitlines()[2]!=results[1][1].splitlines()[2]or sql('select count(*)from purchase_invoices')!='1':raise RuntimeError('concurrent invoice retry duplicated documents')
    results=race([invoice('remaining-invoice-one',3),invoice('remaining-invoice-two',3)],'concurrent remaining invoice accepts one complete allocation',1)
    if sql('select sum(qty*faktor)=40 from purchase_invoice_items')!='t'or sql('select count(*)from purchase_invoices')!='2':raise RuntimeError('concurrent invoice overbilled')
    if not any('Qty faktur melebihi' in r[2]for r in results):raise RuntimeError('Unexpected losing invoice failure '+str(results))
    category=sql("select id from asset_categories where nama='Peralatan'")
    asset="select create_fixed_asset_purchase('Fiction concurrent asset','"+category+"',current_date,1000,0,48,'dc100000-0000-4000-8000-000000000001','Bank','1102','same-asset')"
    results=race([asset,asset],'concurrent identical bank asset purchase retry')
    if results[0][1].splitlines()[2]!=results[1][1].splitlines()[2]or sql('select count(*)from fixed_assets')!='1'or sql("select count(*)from journal_entries where source='asset-purchase'")!='1':raise RuntimeError('concurrent asset retry duplicated purchase')


    # A waiting recovery must use permissions after the PO lock holder commits.
    def revoked_recovery(update, expected, label):
        locker=subprocess.Popen([*cmd,'exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],env=env,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        locker.stdin.write("begin;set application_name='purchase-access-revoke';select id from purchase_orders where id='dc400000-0000-4000-8000-000000000001'for update;"+update+";select pg_sleep(1);commit;");locker.stdin.close()
        for _ in range(100):
            if sql("select count(*)from pg_stat_activity where application_name='purchase-access-revoke'and wait_event='PgSleep'")=='1':break
            time.sleep(.02)
        else:raise RuntimeError('Access writer did not reach the lock barrier')
        caller=docker('exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1',input=auth+"select get_purchase_operation_result('receipt','same-receipt');commit;",capture_output=True)
        locker.wait(timeout=10)
        if locker.returncode:raise RuntimeError(locker.stderr.read())
        if caller.returncode==0 or expected not in caller.stderr:raise RuntimeError(label+caller.stdout+caller.stderr)
        print('PASS: '+label,flush=True)
    revoked_recovery("update profiles set role='STAFF'where id='dc000000-0000-4000-8000-000000000001'",'Akses modul ditolak','waiting recovery rejects newly revoked role')
    sql("update profiles set role='DOCTOR'where id='dc000000-0000-4000-8000-000000000001';insert into user_branches(user_id,branch_id)values('dc000000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001');")
    revoked_recovery("delete from user_branches where user_id='dc000000-0000-4000-8000-000000000001'",'Cabang tidak dapat diakses','waiting recovery rejects newly revoked branch')
finally:
    docker('rm','-f',container,capture_output=True)
