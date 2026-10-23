#!/usr/bin/env python3
"""C01 only, owned network-none PostgreSQL; no external database or credentials."""
import importlib.util
from pathlib import Path
import sys
import json
import subprocess
import time
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
with fixture.DisposablePostgres() as db:
 db.bootstrap()
 prefix=(ROOT/'supabase/tests/pos_split_payments.sql').read_text().split('set local role authenticated;')[0]
 db.sql(prefix+(ROOT/'supabase/tests/promo_edit.sql').read_text())
 print('PASS C01: atomic edit/rollback, role/actor, stale token, catalog targets, safe A01 and posted sale immutability',flush=True)

 # Two bounded lock races: a newer header or child must invalidate stale forms.
 db.sql(prefix+"""
 update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
 insert into promos(id,name,promo_type,rule) values(md5('c01-race')::uuid,'Race base','diskon_produk','{"suggest":"Fiction race"}');
 commit;
 """)
 claims="""set local role authenticated;
 set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';
 set local request.jwt.claims='{"role":"authenticated"}';
 """
 values=json.dumps(dict(name='Race holder',promo_type='diskon_produk',suggest='Fiction race',min_subtotal=None,min_qty=None,max_qty=None,kelipatan=False,auto_apply=False,discount_type=None,discount_value=None,branch_ids=None,valid_from=None,valid_until=None))
 def version():return db.sql("begin;"+claims+"select read_promo_edit(md5('c01-race')::uuid)->>'version';commit;")
 def edit(token):return "select edit_promo(md5('c01-race')::uuid,'"+token+"','"+values+"',array[]::uuid[])"
 def race(statement):
  token=version()
  holder=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  holder.stdin.write("begin;set application_name='c01-held';"+claims+statement(token)+";select pg_sleep(1);commit;")
  holder.stdin.close();holder.stdin=None
  try:
   for _ in range(100):
    if db.sql("select count(*) from pg_stat_activity where application_name='c01-held' and wait_event='PgSleep'")=='1':break
    if holder.poll() is not None:raise RuntimeError('Holder exited before barrier: '+str(holder.communicate()))
    time.sleep(0.02)
   else:raise RuntimeError('Holder did not reach its lock barrier')
   result=subprocess.run(db.command(),input='begin;'+claims+edit(token)+';commit;',capture_output=True,text=True,timeout=10)
   if result.returncode==0 or 'PROMO_EDIT_CONFLICT' not in result.stderr:raise RuntimeError('Stale contender: '+result.stdout+result.stderr)
   out,err=holder.communicate(timeout=10)
   if holder.returncode:raise RuntimeError(out+err)
  finally:
   if holder.poll() is None:holder.kill();holder.communicate()
 race(lambda token:edit(token))
 race(lambda token:"insert into promo_items(promo_id,item_id) values(md5('c01-race')::uuid,'e5500000-0000-4000-8000-000000000001')")
 if db.sql("select count(*) from promo_items where promo_id=md5('c01-race')::uuid")!='1':raise RuntimeError('Stale editor removed the committed target')
 print('PASS C01 two-session header/child races: stale editor rejected after parent lock',flush=True)
