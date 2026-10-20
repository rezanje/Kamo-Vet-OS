#!/usr/bin/env python3
"""Prove all-branch reset, rollback guards and preserved masters on localhost only."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import importlib.util

ROOT=Path(__file__).resolve().parents[1]
DB=f'vetos_reset_source_{os.getpid()}_{time.time_ns()}'
OWNER='e1100000-0000-4000-8000-000000000001'

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def main():
    fixture=load('backup_fixture',ROOT/'scripts/test-simulation-backup-postgres.py')
    restore=load('backup_restore',ROOT/'scripts/verify-simulation-backup.py')
    source=load('reset_source',ROOT/'scripts/test-posted-sales-postgres.py')
    source.DB=DB;source.ENV=restore.ENV
    source.PSQL=['psql','-X','-q','-At',*restore.LOCAL,'-d',DB,'-v','ON_ERROR_STOP=1']
    created=False
    def prepare():
        return json.loads(source.sql(f"set role service_role;select public.prepare_simulation_backup('{OWNER}');").stdout.strip())
    def execute(m,role='service_role',actor=OWNER):
        return source.sql(f"set role {role};select public.reset_verified_operational_history('{actor}','{m['backup_id']}','{m['sha256']}','RESET SIMULASI TOTAL');")
    def reject(m,expected,role='service_role'):
        result=source.sql(f"set role {role};select public.reset_verified_operational_history('{OWNER}','{m['backup_id']}','{m['sha256']}','RESET SIMULASI TOTAL');",succeeds=False)
        assert expected in result.stderr,result.stderr
    def start(statement):
        process=subprocess.Popen(source.PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=restore.ENV)
        process.stdin.write(statement);process.stdin.close();return process
    def finish(process,success=True):
        process.wait(timeout=15);out,err=process.stdout.read(),process.stderr.read()
        if (process.returncode==0)!=success:raise RuntimeError(err)
        return out,err
    def barrier(predicate):
        for _ in range(300):
            if source.sql('select exists(select 1 from pg_stat_activity where '+predicate+');').stdout.strip()=='t':return
            time.sleep(.01)
        raise AssertionError('Expected concurrent lock wait missing')
    def reset_statement(m):
        return f"set role service_role;select public.reset_verified_operational_history('{OWNER}','{m['backup_id']}','{m['sha256']}','RESET SIMULASI TOTAL');"
    def snapshot():return source.sql('select kamo_maintenance.public_snapshot()::text;').stdout.strip()
    try:
        subprocess.run(['createdb',*restore.LOCAL,DB],check=True,capture_output=True,env=restore.ENV);created=True
        source.bootstrap_database();fixture.seed_source(source)
        source.sql("""insert into public.recurring_journals(id,nama,lines,last_posted,branch_id) values('efa00000-0000-4000-8000-000000000001','Fictional recurring','[{"code":"1101","debit":100,"credit":0},{"code":"4101","debit":0,"credit":100}]','2026-01','e2200000-0000-4000-8000-000000000001');
update public.customers set points=10,total_spending=500,tier='Gold';""")
        before=json.loads(snapshot());m=prepare()
        reject(m,'permission denied',role='authenticated')
        reject(m,'Cadangan terverifikasi')
        source.sql("set role authenticated;select public.reset_simulasi_barang_dan_stok('RESET SIMULASI TOTAL');",succeeds=False)
        assert json.loads(snapshot())==before
        document=json.loads(source.sql(f"set role service_role;select public.download_simulation_backup('{m['backup_id']}');").stdout.strip())
        with tempfile.TemporaryDirectory(prefix='vetos-reset-restore-') as temporary:
            path=Path(temporary)/'snapshot.json';path.write_text(document['document']);path.chmod(0o600)
            receipt=restore.verify_backup(path,m['sha256'])
            payload=base64.b64encode(json.dumps(receipt).encode()).decode()
            source.sql(f"set role service_role;select public.verify_simulation_backup('{m['backup_id']}','{m['sha256']}',convert_from(decode('{payload}','base64'),'UTF8')::jsonb);")
        source.sql('create table public.unreviewed_transaction(id uuid);')
        reject(m,'Daftar data aplikasi berubah');source.sql('drop table public.unreviewed_transaction;')
        source.sql("update public.customers set name='Changed after backup' where id='ef940000-0000-4000-8000-000000000001';")
        reject(m,'Data berubah setelah cadangan')
        source.sql("update public.customers set name='Backup fictional customer' where id='ef940000-0000-4000-8000-000000000001';")
        assert json.loads(snapshot())==before
        writer=start("begin;update public.customers set name='Concurrent change' where id='ef940000-0000-4000-8000-000000000001';select pg_sleep(1) /* reset-source-writer */;commit;")
        barrier("wait_event='PgSleep' and query like '%reset-source-writer%'")
        waiting_reset=start(reset_statement(m).replace('select public.reset_verified','select /* reset-source-waiter */ public.reset_verified'))
        barrier("wait_event_type='Lock' and query like '%reset-source-waiter%'")
        finish(writer);_,failure=finish(waiting_reset,False)
        assert 'Data berubah setelah cadangan' in failure
        source.sql("update public.customers set name='Backup fictional customer' where id='ef940000-0000-4000-8000-000000000001';")
        assert json.loads(snapshot())==before
        # A final maintenance failure must roll back every earlier delete and trigger change.
        source.sql("create function kamo_maintenance.test_fail_reset() returns trigger language plpgsql as $$begin if new.reset_at is not null then raise exception 'RESET_FAULT';end if;return new;end$$;create trigger reset_fault before update on kamo_maintenance.simulation_backups for each row execute function kamo_maintenance.test_fail_reset();")
        reject(m,'RESET_FAULT');assert json.loads(snapshot())==before
        source.sql('drop trigger reset_fault on kamo_maintenance.simulation_backups;drop function kamo_maintenance.test_fail_reset();')
        winner=start('begin;'+reset_statement(m)+'select pg_sleep(1) /* reset-retry-holder */;commit;')
        barrier("wait_event='PgSleep' and query like '%reset-retry-holder%'")
        retry=start(reset_statement(m).replace('select public.reset_verified','select /* reset-retry-waiter */ public.reset_verified'))
        barrier("wait_event_type='Lock' and query like '%reset-retry-waiter%'")
        winner_out,_=finish(winner);retry_out,_=finish(retry)
        result=json.loads(winner_out.strip().splitlines()[0]);assert json.loads(retry_out.strip())==result
        after=json.loads(snapshot())
        clear=json.loads(source.sql('select to_jsonb(kamo_maintenance.reset_operational_tables());').stdout.strip())
        masters=json.loads(source.sql('select to_jsonb(kamo_maintenance.reset_master_tables());').stdout.strip())
        assert all(after['tables'][t]==[] for t in clear)
        assert before['schema']==after['schema'] and before['auth_ids']==after['auth_ids']
        for table in masters:
            removed={'customers':{'points','total_spending','tier','tier_downgraded_at'},'recurring_journals':{'last_posted'}}.get(table,set())
            clean=lambda rows:sorted(json.dumps({k:v for k,v in r.items() if k not in removed},sort_keys=True) for r in rows)
            assert clean(before['tables'][table])==clean(after['tables'][table]),table
        assert after['tables']['customers'][0]['points']==0
        assert result['medical_history_cleared'] and result['accounts_preserved']>0
        assert json.loads(execute(m).stdout.strip())==result
        assert json.loads(snapshot())==after
        current_month=source.sql("select to_char(now() at time zone 'Asia/Jakarta','YYYY-MM');").stdout.strip()
        source.sql(f"set role service_role;select public.post_recurring_journal_period('efa00000-0000-4000-8000-000000000001','{current_month}');")
        assert source.sql('select count(*) from public.journal_entries;').stdout.strip()=='0'
        source.sql(f"insert into public.journal_entries(no_jurnal,tanggal,deskripsi,source,source_ref) values('OLD.AUTOMATION','{current_month}-01','Fictional old automation','depreciation','{current_month}');",succeeds=False)
        assert source.sql('select count(*) from public.journal_entries;').stdout.strip()=='0'
        # Advance the fixture's reset boundary one month to exercise the next due period.
        previous_month=source.sql("select to_char(date_trunc('month',now() at time zone 'Asia/Jakarta')-interval '1 month','YYYY-MM');").stdout.strip()
        source.sql(f"update kamo_maintenance.simulation_backups set reset_at=('{previous_month}-15')::timestamptz where id='{m['backup_id']}';update public.recurring_journals set last_posted='{previous_month}';")
        posted=json.loads(source.sql(f"set role service_role;select to_jsonb(x) from public.post_recurring_journal_period('efa00000-0000-4000-8000-000000000001','{current_month}') x;").stdout.strip())
        assert posted['posted'] and posted['entry_id']
        source.sql(f"set role service_role;select public.post_recurring_journal_period('efa00000-0000-4000-8000-000000000001','{current_month}');")
        assert source.sql('select count(*) from public.journal_entries;').stdout.strip()=='1'
        print(f'PASS {len(clear)} operational tables empty incl medical; {len(masters)} master tables preserved; real restore, role/legacy/stale/unknown gates, rollback fault, real concurrent stale/retry sessions, automation cutoff')
    finally:
        if created:subprocess.run(['dropdb',*restore.LOCAL,'--if-exists',DB],check=True,capture_output=True,env=restore.ENV)

if __name__=='__main__':main()
