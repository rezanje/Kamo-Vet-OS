#!/usr/bin/env python3
"""Focused I06 fixtures in an owned network-none PostgreSQL container only."""
import importlib.util
from pathlib import Path
import sys
import subprocess
import time
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
with fixture.DisposablePostgres() as db:
    db.bootstrap()
    prefix=(ROOT/'supabase/tests/pos_split_payments.sql').read_text().split('set local role authenticated;')[0]
    db.sql(prefix+(ROOT/'supabase/tests/opname_draft_cancel.sql').read_text())
    print('PASS opname_draft_cancel.sql: permissions, locked/posted/effect rejection, immutable cancel and audit',flush=True)

    # Two deterministic parent-lock races; fixture-only, no target connection.
    db.sql(prefix+"""
insert into opname_orders(id,no_opname,warehouse_id,penanggung_jawab)
select md5('i06-race-'||name)::uuid,'OPO.I06.RACE.'||name,'e3300000-0000-4000-8000-000000000001','Fictional race'
from unnest(array['count','effect']) name;
commit;
""")
    claims="""set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
"""
    def held_transaction(statement, contender, expected):
        holder=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        holder.stdin.write("begin;set application_name='i06-held';"+claims+statement+";select pg_sleep(2);commit;")
        holder.stdin.close();holder.stdin=None
        try:
            for _ in range(100):
                if db.sql("select count(*) from pg_stat_activity where application_name='i06-held' and wait_event='PgSleep'")=='1':break
                if holder.poll() is not None:raise RuntimeError('Holder exited before lock: '+str(holder.communicate()))
                time.sleep(0.02)
            else:raise RuntimeError('Holder never reached its lock barrier')
            result=subprocess.run(db.command(),input='begin;'+claims+contender+';commit;',capture_output=True,text=True,timeout=10)
            if result.returncode==0 or expected not in result.stderr:raise RuntimeError('Unexpected contender result: '+result.stdout+result.stderr)
            out,err=holder.communicate(timeout=10)
            if holder.returncode:raise RuntimeError(out+err)
        finally:
            if holder.poll() is None:holder.kill();holder.communicate()
    held_transaction("insert into opname_counts(order_id,item_id) values(md5('i06-race-count')::uuid,'e5500000-0000-4000-8000-000000000001')",
      "select cancel_opname_draft(md5('i06-race-count')::uuid,'Must see committed count')",'OPNAME_NOT_DRAFT')
    held_transaction("select cancel_opname_draft(md5('i06-race-effect')::uuid,'Cancel wins before effect')",
      "insert into stock_moves(warehouse_id,item_id,tanggal,qty,unit_cost,source,source_ref) values('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',current_date,1,1,'opname','OPO.I06.RACE.effect')",'Opname sudah dibatalkan')
    if db.sql("select count(*) from opname_orders where no_opname='OPO.I06.RACE.count' and status::text='Terbuka'")!='1':raise RuntimeError('Count race cancelled a locked order')
    if db.sql("select count(*) from stock_moves where source_ref='OPO.I06.RACE.effect'")!='0':raise RuntimeError('Effect race changed cancelled inventory')
    print('PASS two-session races: count wins -> cancel rejected; cancel wins -> stock effect rejected',flush=True)
