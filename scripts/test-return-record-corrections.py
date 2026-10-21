#!/usr/bin/env python3
"""All migrations + real return correction SQL in an owned disposable Docker DB."""
from pathlib import Path
import json
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'kamo-return-correction-' + uuid.uuid4().hex[:8]

def sql(source):
    result = subprocess.run(['docker','exec','-i',CONTAINER,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'],input=source,text=True,capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout

AUTH = """set role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"role":"authenticated"}',false);
"""
def start(source):
    process=subprocess.Popen(['docker','exec','-i',CONTAINER,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    process.stdin.write(AUTH+source);process.stdin.close()
    return process

def barrier(marker, event):
    for _ in range(120):
        if sql(f"select exists(select 1 from pg_stat_activity where datname=current_database() and query like '%{marker}%' and {event});").strip()=='t':
            return
        time.sleep(.02)
    raise RuntimeError('Missing two-session barrier: '+marker)

def finish(process, success=True):
    process.wait(timeout=15)
    out,err=process.stdout.read(),process.stderr.read()
    if (process.returncode==0)!=success:
        raise RuntimeError(out+err)
    return out,err

def race_tests():
    def post(key):
        return json.loads(sql(AUTH+f"select post_unit_return('sales','f6000000-0000-4000-8000-000000000011','{key}',jsonb_build_object('tanggal',current_date),'[{{\"source_line_id\":\"f7000000-0000-4000-8000-000000000021\",\"item_id\":\"f5000000-0000-4000-8000-000000000001\",\"qty\":1,\"satuan\":\"pcs\",\"kondisi\":\"baik\"}}]');").splitlines()[-1])['document_id']
    def correct(doc,key):
        return f"select correct_return_record('sales','{doc}',0,'{key}','Incorrect receipt','TEST-ZERO signed physical verification','[]');"
    for same in [True,False]:
        doc=post('race-source-'+str(same))
        first=start('begin;'+correct(doc,'race-'+str(same))+"select pg_sleep(2) /* return-holder */;commit;")
        barrier('return-holder',"wait_event='PgSleep'")
        second=start('/* return-waiter */'+correct(doc,'race-'+str(same) if same else 'race-competing'))
        barrier('return-waiter',"wait_event_type='Lock'")
        out_a,_=finish(first);out_b,error=finish(second,same)
        if same:
            values=lambda out:[json.loads(line) for line in out.splitlines() if line.startswith('{') and 'audit_id' in line]
            assert values(out_a)==values(out_b),(out_a,out_b)
        else:
            assert 'berubah' in error,error
        assert sql(f"select count(*) from return_record_corrections where return_id='{doc}';").strip()=='1'
    print('Real waiting sessions: identical retry returns one audit; competing correction rejects stale revision.',flush=True)
    doc=post('stock-race-source')
    consumer="select stock_out_fifo('f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001',1,'test-consume','RETURN.RACE',current_date);"
    first=start('begin;'+consumer+'select pg_sleep(2) /* stock-holder */;commit;')
    barrier('stock-holder',"wait_event='PgSleep'")
    second=start('/* stock-correction-waiter */'+correct(doc,'stock-race-correction'))
    barrier('stock-correction-waiter',"wait_event_type='Lock'")
    finish(first);_,error=finish(second,False)
    assert 'mutasi lanjutan' in error,error
    assert sql(f"select voided_at is null from sales_returns where id='{doc}';").strip()=='t'
    print('Concurrent downstream stock issue commits first; waiting correction rechecks and rejects without reversal.',flush=True)
    doc=post('bank-race-source')
    first=start("reset role;begin;lock table journal_entries,journal_lines in share row exclusive mode;insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code,catatan) select current_date,id,'1101','RETURN.RACE.BANK' from cash_accounts where coa_code='1101';select pg_sleep(2) /* bank-holder */;commit;")
    barrier('bank-holder',"wait_event='PgSleep'")
    second=start('/* bank-correction-waiter */'+correct(doc,'bank-race-correction'))
    barrier('bank-correction-waiter',"wait_event_type='Lock'")
    finish(first);_,error=finish(second,False)
    assert 'Rekonsiliasi bank' in error,error
    sql("delete from bank_reconciliations where catatan='RETURN.RACE.BANK';")
    doc=post('correction-first-bank-source')
    balance="select coalesce(sum(l.debit-l.credit),0) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='1101';"
    before=float(sql(balance).strip())
    first=start('begin;'+correct(doc,'correction-before-bank')+'select pg_sleep(2) /* correction-before-bank-holder */;commit;')
    barrier('correction-before-bank-holder',"wait_event='PgSleep'")
    second=start('reset role;begin;/* bank-snapshot-waiter */lock table journal_entries,journal_lines in share row exclusive mode;'+balance+'commit;')
    barrier('bank-snapshot-waiter',"wait_event_type='Lock'")
    finish(first);out,_=finish(second)
    values=[float(line) for line in out.splitlines() if line.lstrip('-').replace('.','',1).isdigit()]
    assert values[-1]==before+18,(before,out)
    print('Both bank ledger lock orders passed: covering reconciliation blocks, or waiting snapshot includes reversal.',flush=True)
    doc=post('revoked-actor-source')
    first=start("reset role;select set_config('request.jwt.claim.sub','',false);begin;update profiles set is_active=false where id='f1000000-0000-4000-8000-000000000001';select pg_sleep(2) /* actor-revoker-holder */;commit;")
    barrier('actor-revoker-holder',"wait_event='PgSleep'")
    second=start('/* actor-correction-waiter */'+correct(doc,'revoked-correction'))
    barrier('actor-correction-waiter',"wait_event_type='Lock'")
    finish(first);_,error=finish(second,False)
    assert 'OWNER aktif' in error,error
    assert sql(f"select voided_at is null from sales_returns where id='{doc}';").strip()=='t'
    print('Actor revoked in an earlier waiting transaction cannot complete correction.',flush=True)

try:
    subprocess.run(['docker','run','-d','--name',CONTAINER,'-e','POSTGRES_PASSWORD=fictional-return-only','postgres:16'],check=True,capture_output=True)
    for _ in range(150):
        logs=subprocess.run(['docker','logs',CONTAINER],capture_output=True,text=True)
        if 'PostgreSQL init process complete' in logs.stdout and subprocess.run(['docker','exec',CONTAINER,'pg_isready','-U','postgres'],capture_output=True).returncode==0:
            break
        time.sleep(.1)
    sql('''create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create publication supabase_realtime;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;''')
    migrations=sorted((ROOT/'supabase/migrations').glob('*.sql'))
    for migration in migrations:
        if migration.name.startswith('0068'):
            sql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Test cash','ASET','D'),('1102','Test bank','ASET','D') on conflict do nothing")
        try:
            sql('begin;'+migration.read_text()+'commit;')
        except RuntimeError as error:
            raise RuntimeError(migration.name+': '+str(error)) from error
    print(f'Applied {len(migrations)} migrations to disposable PostgreSQL 16.',flush=True)
    sql((ROOT/'supabase/tests/online_return_unit_posting.sql').read_text())
    print('Existing online/return transaction regression suite passed.',flush=True)
    fees=(ROOT/'supabase/tests/pos_merchant_fees.sql').read_text()
    sql(fees)
    sql(fees.split('set local role authenticated;')[0]+(ROOT/'supabase/tests/return_planned_corrections.sql').read_text())
    print('Existing merchant-fee suite and split-method 80% to 60% correction/cancel/full re-return passed.',flush=True)
    fixtures=(ROOT/'supabase/tests/online_return_unit_posting.sql').read_text().split('set local role authenticated;')[0]
    sql(fixtures+'commit;')
    sql((ROOT/'supabase/tests/return_record_corrections.sql').read_text())
    print('Return record correction SQL passed.',flush=True)
    race_tests()
finally:
    subprocess.run(['docker','rm','-f',CONTAINER],capture_output=True)
