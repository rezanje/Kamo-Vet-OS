#!/usr/bin/env python3
"""Owned PostgreSQL16 fixture; no target connection and no migration replay.
Schema is a narrow clinical fixture; branch helpers/old guard are read verbatim
from repository sources. Only the candidate forward migration is applied.
"""
import importlib.util, re, sys, subprocess, selectors, time
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('isolated_fixture',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
bootstrap=(ROOT/'supabase/tests/fixtures/unpaid_clinical_schema.sql').read_text()
access=(ROOT/'supabase/migrations/20261017090000_role_capabilities.sql').read_text()
for name in ['has_role_capability','user_can_access_branch']:
 pattern=r'create (?:or replace )?function public\.'+name+r'\(.*?\$\$;'
 bootstrap+='\n'+re.search(pattern,access,re.S).group(0)
bootstrap+='''\ncreate policy visit_all on visits for all to authenticated using(public.user_can_access_branch(branch_id))with check(public.user_can_access_branch(branch_id));\ncreate policy mr_all on medical_records for all to authenticated using(exists(select 1 from visits v where v.id=visit_id and public.user_can_access_branch(v.branch_id)))with check(exists(select 1 from visits v where v.id=visit_id and public.user_can_access_branch(v.branch_id)));\ncreate policy invoice_all on invoices for all to authenticated using(exists(select 1 from visits v where v.id=visit_id and public.user_can_access_branch(v.branch_id)))with check(exists(select 1 from visits v where v.id=visit_id and public.user_can_access_branch(v.branch_id)));\n'''
old=(ROOT/'supabase/migrations/20260924141000_atomic_initial_clinic_record.sql').read_text()
bootstrap+='\n'+old[old.index('create function public.protect_submitted_clinic_record'):old.index('create function public.clinic_save_initial_record')]
with fixture.DisposablePostgres() as db:
 db.sql(bootstrap)
 if '--baseline' not in sys.argv:
  candidates=list((ROOT/'supabase/migrations').glob('*_unpaid_clinical_correction.sql'))
  assert len(candidates)==1
  db.sql('begin;\n'+candidates[0].read_text()+'\ncommit;')
 db.sql((ROOT/'supabase/tests/unpaid_clinical_correction.sql').read_text())
 # Real wait/commit boundary, not two calls within one transaction. No replay.
 seed=(ROOT/'supabase/tests/unpaid_clinical_correction.sql').read_text().split('create temporary table invariant_snapshot')[0]
 db.sql(seed+'commit;')
 actor="set role authenticated;select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',false);"
 fields='{"anamnesis":"Race note","diagnosis":null,"therapy":null,"suhu":38.25,"gejala_klinis":null,"hasil_penunjang":null}'
 rpc="select public.clinic_correct_unpaid_record('f2000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',0,'"+fields+"','Concurrent correction','race-first');"
 def race(first,second,application,error):
  owner=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  waiter=None
  try:
   owner.stdin.write('begin;\n\\o /dev/null\n'+first+"\n\\o\n\\echo LOCK_READY\n");owner.stdin.flush()
   selector=selectors.DefaultSelector();selector.register(owner.stdout,selectors.EVENT_READ)
   deadline=time.monotonic()+5
   while True:
    if time.monotonic()>deadline or not selector.select(timeout=5):raise AssertionError('Lock owner did not become ready')
    if owner.stdout.readline().strip()=='LOCK_READY':break
   selector.close()
   waiter=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
   waiter.stdin.write("set application_name='"+application+"';begin;"+actor+second+'commit;');waiter.stdin.close();waiter.stdin=None
   for _ in range(100):
    if db.sql("select count(*)from pg_stat_activity where application_name='"+application+"'and wait_event_type='Lock';")=='1':break
    time.sleep(.02)
   else:raise AssertionError('Correction never reached the contested lock')
   owner.stdin.write('commit;\n\\q\n');owner.stdin.close();owner.stdin=None
   _,first_error=owner.communicate(timeout=10);assert owner.returncode==0,first_error
   _,second_error=waiter.communicate(timeout=10);assert waiter.returncode!=0 and error in second_error,second_error
  finally:
   for process in(owner,waiter):
    if process is not None and process.poll()is None:process.kill();process.wait()
 # Invoice posting uses this same visit lock in the production RPC. Attempt the
 # direct table API too: it cannot bypass the receipt trigger's post-lock check.
 invoice="select id from visits for update;insert into invoices values('f7000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001',null,'Belum Lunas');"
 direct="insert into clinic_record_corrections(medical_record_id,expected_revision,changes,reason,request_key,created_by,transaction_id,before_value,after_value)values('f4000000-0000-4000-8000-000000000001',0,'"+fields+"','Concurrent correction','race-invoice','f0000000-0000-4000-8000-000000000001',0,'{}','{}');"
 race(invoice,direct,'unpaid-correction-invoice-race','kunjungan sudah berubah atau memiliki invoice')
 assert db.sql('select count(*)from clinic_record_corrections;')=='0'
 assert db.sql('select clinical_revision from medical_records;')=='0'
 db.sql('delete from invoices;')
 race(actor+rpc,rpc.replace('race-first','race-second'),'unpaid-correction-revision-race','Rekam medis sudah berubah')
 assert db.sql('select count(*)from clinic_record_corrections;')=='1'
 assert db.sql('select clinical_revision from medical_records;')=='1'
 before_rollback=db.sql("select to_jsonb(m)::text from medical_records m;")
 db.sql((ROOT/'docs/rollback/2026-10-24-unpaid-clinical-correction.sql').read_text())
 assert db.sql("select to_jsonb(m)::text from medical_records m;")==before_rollback
 assert db.sql('select count(*)from clinic_record_corrections;')=='1'
 assert db.sql(actor+"select public.clinic_can_correct_record('f4000000-0000-4000-8000-000000000001');").splitlines()[-1]=='f'
 try:db.sql(actor+rpc)
 except RuntimeError as error:assert 'permission denied' in str(error)
 else:raise AssertionError('Rollback failed to freeze correction RPC')
 print('PASS rollback freezes correction entry without deleting clinical values or audit history.')
 print('PASS two-connection invoice/correction and correction/correction races; blocked writes leave no receipt.')
 print('PASS unpaid clinical corrections, same identities/times, audit, retries, stale saves, RLS/module/branch and posted guards; no migration replay.')
