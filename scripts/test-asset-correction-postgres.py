#!/usr/bin/env python3
"""Isolated fictional PostgreSQL 16 only; no remote database URL accepted."""
from pathlib import Path
import subprocess, time, uuid, sys, json
ROOT = Path(__file__).resolve().parents[1]
# Single source of the exact hosted auth.uid() (fingerprinted by migration 20261101120000).
HOSTED_AUTH_UID = (ROOT / 'supabase/tests/fixtures/hosted_auth_uid.sql').read_text()
CONTAINER = 'vetos-asset-correction-' + uuid.uuid4().hex[:8]
def sql(source, check=True, tuples=False):
    cmd = ['docker','exec','-i',CONTAINER,'psql','-U','postgres','-v','ON_ERROR_STOP=1']
    if tuples: cmd += ['-At']
    result = subprocess.run(cmd,input=source,text=True,capture_output=True)
    if check and result.returncode: raise RuntimeError(result.stderr)
    return result
AUTH="set role authenticated;select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000001',false);select set_config('request.jwt.claim.role','authenticated',false);"
def race(first_call,second_call,expected_error=None,same=True):
    cmd=['docker','exec','-i',CONTAINER,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1']
    first=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    first.stdin.write(AUTH+"begin;set application_name='asset-race-holder';"+first_call+";select pg_sleep(2);commit;");first.stdin.close()
    for _ in range(100):
        if sql("select count(*) from pg_stat_activity where application_name='asset-race-holder' and wait_event='PgSleep'",tuples=True).stdout.strip()=='1':break
        if first.poll() is not None:raise RuntimeError('Holder failed: '+first.stderr.read())
        time.sleep(.02)
    else:raise RuntimeError('Holder never reached barrier')
    second=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    second.stdin.write(AUTH+second_call+';');second.stdin.close()
    for _ in range(100):
        if int(sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and application_name<>'asset-race-holder'",tuples=True).stdout.strip())>0:break
        if second.poll() is not None:raise RuntimeError('Waiter did not wait: '+second.stderr.read())
        time.sleep(.01)
    else:raise RuntimeError('No real lock wait observed')
    first.wait(timeout=15);second.wait(timeout=15)
    a,err_a=first.stdout.read(),first.stderr.read();b,err_b=second.stdout.read(),second.stderr.read()
    if first.returncode:raise RuntimeError(err_a)
    if expected_error:
        assert second.returncode and expected_error in err_b,(b,err_b)
    else:
        assert second.returncode==0,err_b
        records_a=[json.loads(line) for line in a.splitlines() if line.startswith('{')]
        records_b=[json.loads(line) for line in b.splitlines() if line.startswith('{')]
        if same: assert records_a==records_b and len(records_a)==1,(a,b)
    print('PASS: real lock wait / '+(expected_error or ('identical retry' if same else 'both operations serialize')),flush=True)
try:
    subprocess.run(['docker','run','-d','--network','none','--name',CONTAINER,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16'],check=True,capture_output=True)
    for _ in range(500):
        logs=subprocess.run(['docker','logs',CONTAINER],capture_output=True,text=True)
        if 'PostgreSQL init process complete' in logs.stdout and subprocess.run(['docker','exec',CONTAINER,'pg_isready','-U','postgres'],capture_output=True).returncode==0: break
        time.sleep(.1)
    sql("""create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
""" + HOSTED_AUTH_UID + """
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create publication supabase_realtime;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;
""")
    migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    for migration in migrations:
        if '--baseline' in sys.argv and migration.name=='20261021074519_fixed_asset_purchase_corrections.sql': continue
        if migration.name.startswith('0068'):
            sql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Test cash','ASET','D'),('1102','Test bank','ASET','D') on conflict do nothing")
        try:
            sql('begin;\n' + migration.read_text() + '\ncommit;')
        except RuntimeError as error:
            raise RuntimeError(migration.name + ': ' + str(error)) from error
    print(f'Applied {len(migrations)} repository migrations to isolated PostgreSQL 16 with auth/storage shims and pre-0068 COA fixtures.')
    sql("alter database postgres set timezone='Asia/Jakarta'")
    sql((ROOT/'supabase/tests/asset_purchase_correction.sql').read_text())
    print('PASS: asset correction SQL suite',flush=True)
    suite=(ROOT/'supabase/tests/asset_purchase_correction.sql').read_text()
    sql(suite.split('-- RED:')[0]+'reset role;commit;')
    asset=sql("select id from fixed_assets where nama='Fictional machine'",tuples=True).stdout.strip()
    def correction(revision,amount,key):return f"select correct_fixed_asset_purchase('{asset}',{revision},current_date,{amount},'Wrong amount','{key}')"
    race(correction(0,10000000,'same'),correction(0,10000000,'same'))
    assert sql('select count(*) from fixed_asset_corrections',tuples=True).stdout.strip()=='1'
    race(correction(1,8000000,'compete-a'),correction(1,7000000,'compete-b'),'berubah')
    assert sql('select count(*) from fixed_asset_corrections',tuples=True).stdout.strip()=='2'
    dep=f"insert into asset_depreciations(asset_id,periode,amount) values('{asset}',to_char(current_date,'YYYY-MM'),166667)"
    race(dep,correction(2,6000000,'after-dep'),'penyusutan')
    sql('delete from asset_depreciations') # trusted fixture maintenance only
    race(correction(2,6000000,'before-dep'),dep,'hitung ulang penyusutan')
    assert sql('select count(*) from asset_depreciations',tuples=True).stdout.strip()=='0'
    # Reconciliation takes the same ledger lock; the correction must see its
    # newly committed snapshot and reject, regardless of a previous preview.
    recon="select mutate_bank_reconciliation('recon-race','create',null,null,jsonb_build_object('account_id','ac200000-0000-4000-8000-000000000001','tanggal',current_date,'saldo_bank',-6000000,'biaya_adm',0,'bunga',0),null)"
    race(recon,correction(3,5000000,'after-recon'),'Rekonsiliasi bank')
    assert sql('select harga_perolehan from fixed_assets',tuples=True).stdout.strip()=='6000000'
    sql('delete from bank_reconciliation_requests;delete from bank_reconciliations')
    race(correction(3,5000000,'before-recon'),recon.replace('recon-race','after-correction'),same=False)
    assert sql('select saldo_buku from bank_reconciliations',tuples=True).stdout.strip()=='-5000000'
    sql('delete from bank_reconciliation_requests;delete from bank_reconciliations')
    disposal=f"insert into asset_disposals(asset_id,jenis,harga_perolehan) values('{asset}','hapus',5000000)"
    race(disposal,correction(4,4000000,'after-disposal'),'dilepas')
    sql('delete from asset_disposals')
    race(correction(4,4000000,'before-disposal'),disposal,'hitung ulang pelepasan')
    addition=f"select add_fixed_asset_value_atomic('{asset}',current_date,1000000,'110299','Fictional repair','addition-race')"
    race(addition,addition)
    assert sql('select harga_perolehan from fixed_assets',tuples=True).stdout.strip()=='5000000'
    assert sql('select count(*) from asset_changes',tuples=True).stdout.strip()=='1'
    # Account revocation committed while the correction waits on the asset.
    revoke=f"reset role;update fixed_assets set nama=nama where id='{asset}';update profiles set is_active=false where id='ac000000-0000-4000-8000-000000000001'"
    race(revoke,correction(7,5000000,'revoked-waiter'),'OWNER aktif')
    print('PASS: concurrency, stale depreciation, reconciliation and permission revocation',flush=True)

finally:
    subprocess.run(['docker','rm','-f',CONTAINER],capture_output=True)
