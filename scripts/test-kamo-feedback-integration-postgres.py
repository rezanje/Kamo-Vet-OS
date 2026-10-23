#!/usr/bin/env python3
"""Combined feedback tests in an owned network-none PostgreSQL17.6 container.

No target URL/credentials are accepted. --target-catalog is a private schema-only
snapshot from kamo-integration-catalog.py; no target source rows are imported.
--resume-owned is only for this task's verified, disposable fixture container.
"""
from pathlib import Path
import argparse,hashlib,importlib.util,json,subprocess,sys,tempfile,uuid
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1];BASE='102f3b0555305524611296e29d16affc12553eb7'
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
fixture=module('combined_fixture',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py');catalog=module('combined_catalog',ROOT/'scripts/kamo-integration-catalog.py');dp=module('combined_dp',ROOT/'scripts/test-purchase-advance-postgres.py')
DOCKER=fixture.DOCKER
class Database:
 owned_network_none=True
 def __init__(self,container,name):self.container=container;self.name=name
 def command(self):return DOCKER+['exec','-i',self.container,'psql','-X','-qAt','-U','postgres','-d',self.name,'-v','ON_ERROR_STOP=1']
 def sql(self,text):
  result=subprocess.run(self.command(),input="set time zone 'Asia/Jakarta';\n"+text,text=True,capture_output=True)
  if result.returncode:raise RuntimeError(result.stderr+result.stdout)
  return result.stdout.strip()
 def clone(self,name):self.sql('create database '+catalog.qi(name)+' template '+catalog.qi(self.name));return Database(self.container,name)
 def drop(self,name):self.sql('drop database '+catalog.qi(name)+' with(force)')
def verify_owned(name):
 if not name.startswith('kamo-accurate-accounting-test-'):raise ValueError('Not an owned fixture name')
 d=json.loads(subprocess.check_output(DOCKER+['inspect',name],text=True))[0]
 if d['Config']['Labels'].get('kamo-purpose')!='fictional-accurate-accounting-test'or d['HostConfig']['NetworkMode']!='none'or d['HostConfig']['PortBindings']:raise ValueError('Owned fixture must be network-none without published ports')
def apply_nine(db):
 manifest=json.loads((ROOT/'docs/evidence/2026-10-23-feedback-integration/manifest.json').read_text());assert len(manifest['migrations'])==9
 blocks=[]
 for entry in manifest['migrations']:
  path=ROOT/entry['path'];assert hashlib.sha256(path.read_bytes()).hexdigest()==entry['sha256'];blocks.append(path.read_text())
 db.sql('begin;\n'+'\n'.join(blocks)+'\ncommit;');print('PASS explicit nine reviewed migration files, one local transaction',flush=True)
def suite(db,name):
 path=ROOT/'supabase/tests'/name;source=path.read_text()
 if name in ['clinic_billing_consistency.sql','feedback_clinic_audit.sql']:source=(ROOT/'supabase/tests/clinic_invoice_post.sql').read_text().split('set local role authenticated;')[0]+source
 db.sql(source)
def import_races(db):
 source=(ROOT/'supabase/tests/accurate_inventory_accounting.sql').read_text().split('set local role authenticated;')[0];db.sql(source+'commit;')
 owner=db.sql("select md5('ai-owner')::uuid");auth="set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='"+owner+"';"
 payload="jsonb_build_array(jsonb_build_object('source_row',2,'source_code','AI-I','status','valid','payload',jsonb_build_object('item_id',md5('ai-item')::uuid,'warehouse_id',md5('ai-wh')::uuid,'base_qty',10,'base_unit_cost',12.5,'as_of','2026-01-01','source_values',jsonb_build_array(jsonb_build_object('qty','10','unit_cost','12.5','factor','1','unit','pcs')))))"
 prepare="select prepare_accurate_initial_stock('integration-parallel','fiction.csv',md5('ai-branch')::uuid,md5('ai-wh')::uuid,'2026-01-01',"+payload+",'STRICT');"
 active=[]
 def start(source):
  p=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);active.append(p);p.stdin.write(auth+source);p.stdin.close();return p
 def barrier(marker,event):
  import time
  for _ in range(500):
   if db.sql("select exists(select 1 from pg_stat_activity where datname=current_database()and query like '%"+marker+"%'and "+event+");")=='t':return
   time.sleep(.01)
  raise RuntimeError('Missing import race barrier '+marker)
 def finish(p):
  p.wait(timeout=15);out=p.stdout.read();err=p.stderr.read()
  if p.returncode:raise RuntimeError(err)
  return out.strip().splitlines()[0]
 try:
  first=start('begin;'+prepare+'select pg_sleep(1)/* integration-prepare-holder */;commit;');barrier('integration-prepare-holder',"wait_event='PgSleep'")
  second=start('/* integration-prepare-waiter */'+prepare);barrier('integration-prepare-waiter',"wait_event_type='Lock'");run=finish(first);assert run==finish(second)
  assert db.sql("select count(*)from import_runs where source_hash='integration-parallel'")=='1'
  reviewed=json.loads(db.sql(auth+"select preview_accurate_inventory_accounting('"+run+"',(select id from coa_accounts where code='3101'));"));assert reviewed['can_post']
  expected=json.dumps(reviewed).replace("'","''");post="select post_accurate_inventory_accounting('"+run+"',(select id from coa_accounts where code='3101'),'"+expected+"'::jsonb,'Fiction parallel review');"
  first=start('begin;'+post+'select pg_sleep(1)/* integration-post-holder */;commit;');barrier('integration-post-holder',"wait_event='PgSleep'")
  second=start('/* integration-post-waiter */'+post);barrier('integration-post-waiter',"wait_event_type='Lock'");assert json.loads(finish(first))==json.loads(finish(second))
  assert db.sql("select count(*)from journal_entries where source='accurate-stock-opening'and source_ref='"+run+"'")=='1'
  assert db.sql("select count(*)from activity_log where row_entity='journal_entries'and row_id in(select id::text from journal_entries where source='accurate-stock-opening'and source_ref='"+run+"')and action='create'")=='1'
  print('PASS concurrent preparation/posting: same run/receipt, one journal and audit',flush=True)
 finally:
  for p in active:
   if p.poll()is None:p.kill();p.wait()
def backup_roundtrip(db):
 # Synthetic fixture backup only: target physical backups are never downloaded.
 dump=subprocess.run(DOCKER+['exec',db.container,'pg_dump','-U','postgres','-d',db.name,'-Fc'],capture_output=True,check=True).stdout
 name='integration_restore_'+uuid.uuid4().hex[:8];db.sql('create database '+name);restored=Database(db.container,name)
 try:
  subprocess.run(DOCKER+['exec','-i',db.container,'pg_restore','-U','postgres','-d',name,'--exit-on-error'],input=dump,capture_output=True,check=True)
  comparison=catalog.compare_catalog(json.loads(restored.sql(catalog.CATALOG_QUERY)),json.loads(db.sql(catalog.CATALOG_QUERY)))
  if any(v['onlyLocal']or v['onlyTarget']or v['different']for v in comparison.values()):raise AssertionError('Synthetic restore catalog difference: '+json.dumps(comparison))
  assert restored.sql('select count(*)from customers')==db.sql('select count(*)from customers');print('PASS synthetic local pg_dump/pg_restore schema/ACL and fixture count roundtrip',flush=True)
 finally:db.drop(name)
def exercise(root,baseline,report,focused=False):
 red=baseline.clone('integration_red_'+uuid.uuid4().hex[:8])
 try:
  try:suite(red,'feedback_integration.sql')
  except RuntimeError as error:
   if 'Combined feedback migrations missing'not in str(error):raise
   print('RED confirmed combined acceptance rejects pre-candidate baseline',flush=True)
  else:raise AssertionError('Pre-candidate acceptance unexpectedly passed')
 finally:root.drop(red.name)
 backup_roundtrip(baseline)
 candidate=baseline.clone('integration_candidate_'+uuid.uuid4().hex[:8]);apply_nine(candidate)
 candidate.sql("insert into coa_accounts(code,name,type,normal_balance)values('4101','Fiction integration legacy audit prerequisite','PENDAPATAN','K')on conflict(code)do nothing")
 identity="select row(pg_get_functiondef(oid),proowner,prosecdef,proconfig,proacl)::text from pg_proc where oid='public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure;";before=candidate.sql(identity)
 candidate.sql((ROOT/'docs/rollback/2026-10-22-k08-paid-checkout.sql').read_text());candidate.sql((ROOT/'supabase/migrations/20261022232107_clinic_paid_checkout_atomic.sql').read_text());assert candidate.sql(identity)==before;print('PASS K08 surgical rollback/reapply preserves combined function/security/ACL',flush=True)
 names=['feedback_integration.sql','feedback_clinic_audit.sql','feedback_reset_cutoff.sql']if focused else['feedback_integration.sql','feedback_clinic_audit.sql','feedback_reset_cutoff.sql','purchase_advance_atomic.sql','accurate_inventory_preparation.sql','accurate_inventory_source_precision.sql','accurate_inventory_accounting.sql','accurate_inventory_accounting_guards.sql','accurate_inventory_accounting_review.sql','clinic_billing_consistency.sql','clinic_invoice_post.sql','clinic_billing_lifecycle.sql','inpatient_consent.sql','clinic_demo_financial_policy.sql','activity_audit.sql','activity_audit_framework.sql','activity_audit_financial.sql','activity_audit_inventory.sql','activity_audit_people_settings.sql','activity_audit_remaining_modules.sql']
 failures=[]
 for name in names:
  clone=candidate.clone('integration_suite_'+uuid.uuid4().hex[:8])
  try:suite(clone,name);print('PASS '+name,flush=True)
  except RuntimeError as error:failures.append(name);print('FAIL '+name+': '+str(error)[:2200],flush=True)
  finally:root.drop(clone.name)
 if not focused:
  for label,call in [('DP audit races',dp.races),('import audit races',import_races)]:
   clone=candidate.clone('integration_race_'+uuid.uuid4().hex[:8])
   try:call(clone);print('PASS '+label,flush=True)
   except Exception as error:failures.append(label);print('FAIL '+label+': '+str(error)[:2200],flush=True)
   finally:root.drop(clone.name)
 report.update({'suitesPassed':len(names)-len([n for n in names if n in failures]),'suitesRun':len(names),'failures':failures,'focused':focused});root.drop(candidate.name)
 if failures:raise RuntimeError('Combined failures: '+', '.join(failures))
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--target-catalog',type=Path,required=True);p.add_argument('--resume-owned');p.add_argument('--focused',action='store_true');p.add_argument('--report',type=Path,required=True);args=p.parse_args();target=json.loads(args.target_catalog.read_text());catalog.validate_catalog(target);report={'serverVersion':'17.6','targetCatalogProject':catalog.PROJECT,'sourceRowsCopied':0,'targetWrites':0,'physicalTargetRestoreTested':False,'unverifiedSecurityMetadata':catalog.UNVERIFIED_SECURITY_METADATA};owned=None
 try:
  if args.resume_owned:
   verify_owned(args.resume_owned);root=Database(args.resume_owned,'postgres');baseline=Database(args.resume_owned,'kamo_target')
  else:
   fixture.IMAGE='postgres:17.6';owned=fixture.DisposablePostgres();owned.__enter__();verify_owned(owned.container);root=Database(owned.container,'postgres')
   with tempfile.TemporaryDirectory(prefix='kamo-integration-base-')as temp:
    fixture.ROOT=Path(temp);migrations=Path(temp)/'supabase/migrations';migrations.mkdir(parents=True)
    for path in subprocess.check_output(['git','-C',str(ROOT),'ls-tree','-r','--name-only',BASE,'supabase/migrations'],text=True).splitlines():(migrations/Path(path).name).write_text(subprocess.check_output(['git','-C',str(ROOT),'show',BASE+':'+path],text=True))
    owned.bootstrap()
   baseline=root.clone('kamo_target');report['overlay']=catalog.apply_catalog(baseline,target)
  comparison=catalog.compare_catalog(json.loads(baseline.sql(catalog.CATALOG_QUERY)),target);report['baselineComparison']=comparison
  catalog.require_covered_parity(comparison)
  # PostgreSQL re-parses an old stored varchar-array coercion as element casts;
  # test both expressions including NULL in addition to requiring complete
  # normalized definition equality; this never exempts a different view.
  assert baseline.sql("select bool_and(((v::text=any((array['retur-jual'::varchar,'retur-jual-group'::varchar])::text[]))is not distinct from(v::text=any(array[('retur-jual'::varchar)::text,('retur-jual-group'::varchar)::text]))))from(values('retur-jual'),('retur-jual-group'),('other'),(null))x(v)")=='t'
  assert baseline.sql("select bool_and((((a and b)and c and d)is not distinct from(a and b and c and d)))from(values(true),(false),(null))x(a)cross join(values(true),(false),(null))y(b)cross join(values(true),(false),(null))z(c)cross join(values(true),(false),(null))w(d)")=='t'
  if target.get('operational_reset_cutoff')is not None:
   assert baseline.sql('select public.operational_reset_cutoff()::text')==target['operational_reset_cutoff'];report['resetCutoffMirrored']=True
  assert baseline.sql("select has_column_privilege('authenticated','public.inventory_month_closes','id','SELECT')and not has_column_privilege('authenticated','public.inventory_month_closes','total_value','SELECT')")=='t';report['restrictedHeaderColumnGrantVerified']=True
  report['viewCastEquivalenceFixture']=True;report['restoreAndAssociativityFixture']=True;print('PASS covered target catalog comparison; one stored-view cast representation has semantic fixture',flush=True)
  exercise(root,baseline,report,args.focused)
 finally:
  if owned:owned.__exit__(None,None,None)
  args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__':main()
