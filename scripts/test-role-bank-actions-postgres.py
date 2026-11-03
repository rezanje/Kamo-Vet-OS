#!/usr/bin/env python3
"""Socket-only PG17 bank proof. Original base bytes, immutable candidate snapshots.

No hosted calls or substituted business functions. Missing foundation is a dependency,
NOT a green permission test. Acquire the shared heavy-test lock without polling.
"""
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres

BASE = '0d5e2434325157faff90c37ff7959a9798072ef9'
CORE = '20261106120000_role_settings_atomic.sql'
DOMAIN = '20261106130000_role_bank_actions.sql'
OUT = Path('/opt/data/kamo-role-settings-evidence/recompose2')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = {'enabled_keys': [], 'checks': [], 'dependency': None, 'native_action_red_green': False}
    def passed(label):
        report['checks'].append(label)
        print('PASS', label, flush=True)
    def git(*args):
        return subprocess.run(['git', *args], cwd=ROOT, check=True, capture_output=True).stdout
    try:
        with open('/opt/data/kamo-heavy-test.lock', 'a') as lock:
            # Serialize complete native proofs; a real advisory lock, no polling.
            fcntl.flock(lock, fcntl.LOCK_EX)
            with tempfile.TemporaryDirectory(prefix='bank-role-snapshot-', dir='/opt/data') as tmp:
                snapshot = Path(tmp)
                migrations = snapshot / 'supabase/migrations'
                migrations.mkdir(parents=True)
                rows = git('ls-tree', '-r', BASE, '--', 'supabase/migrations').decode().splitlines()
                originals = []
                for row in rows:
                    metadata, path = row.split('\t')
                    if not path.endswith('.sql'):
                        continue
                    raw = git('cat-file', 'blob', metadata.split()[2])
                    assert raw == (ROOT/path).read_bytes(), 'Original changed: ' + path
                    (migrations/Path(path).name).write_bytes(raw)
                    originals.append((Path(path).name, hashlib.sha256(raw).hexdigest()))
                assert len(originals) == 365, len(originals)
                report['original_hashes'] = dict(originals)
                candidates = {}
                for name in (CORE, DOMAIN):
                    source = ROOT/'supabase/migrations'/name
                    if source.exists():
                        raw = source.read_bytes()
                        candidates[name] = raw
                report['candidate_hashes'] = {name: hashlib.sha256(raw).hexdigest() for name, raw in candidates.items()}
                report['runner_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
                spec = importlib.util.spec_from_file_location('bank_fullschema', ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
                assert spec is not None and spec.loader is not None
                fixture = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(fixture)
                setattr(fixture, 'ROOT', snapshot)
                with NativePostgres('/opt/data/kamo-pg-harness/bin') as db:
                    fixture.DisposablePostgres.bootstrap(db)
                    report['server_version'] = db.last('show server_version')
                    assert 170000 <= int(db.last('show server_version_num')) < 180000
                    passed('365 byte-verified originals on PG17, official auth/storage fixtures only')
                    if CORE not in candidates:
                        report['dependency'] = '060700 foundation candidate is missing.'
                        return 2
                    db.sql('begin;\n' + candidates[CORE].decode() + '\ncommit;')
                    passed('060700 exact hashed snapshot applies over originals')
                    owner, admin, branch, source, target = [str(uuid.UUID(int=n)) for n in range(810001, 810006)]
                    db.sql(f"insert into auth.users(id,email) values('{owner}','owner@bank-proof.invalid'),('{admin}','admin@bank-proof.invalid'); update profiles set role='OWNER',is_active=true where id='{owner}'; update profiles set role='ADMIN',is_active=true where id='{admin}'; insert into branches(id,name,code,type) values('{branch}','Bank proof','BANKPROOF','OFFICE'); insert into coa_accounts(code,name,type,normal_balance) values('1171','Proof source','ASET','D'),('1172','Proof target','ASET','D'); insert into cash_accounts(id,nama,jenis,coa_code) values('{source}','Proof source','Bank','1171'),('{target}','Proof target','Bank','1172');")
                    def actor(who, statement):
                        return db.sql(f"begin;set local role authenticated;set local request.jwt.claim.sub='{who}';set local request.jwt.claim.role='authenticated';{statement};commit;")
                    header = f"jsonb_build_object('tanggal',current_date,'from_account_id','{source}','to_account_id','{target}','jumlah',100,'biaya_admin',0,'branch_id','{branch}')"
                    created = json.loads(actor(admin, f"select public.mutate_cash_transfer('baseline-create','create',null,null,{header},null)"))
                    assert created['transfer_id'] and created['journal_entry_id']
                    assert json.loads(actor(admin, "select public.get_cash_transfer_result('baseline-create')")) == created
                    assert db.last(f"select sum(debit)=100 and sum(credit)=100 from journal_lines where entry_id='{created['journal_entry_id']}'") == 't'
                    assert actor(admin, f"select count(*) from cash_transfers where id='{created['transfer_id']}'") == '1'
                    passed('legitimate authenticated ADMIN transfer create, exact balanced posting, public RLS read and recovery')
                    try:
                        actor(admin, f"select public.mutate_cash_transfer('ceiling','void','{created['transfer_id']}',0,'{{}}','Proof denial')")
                    except RuntimeError as error:
                        assert 'Akses' in str(error), str(error)
                    else:
                        raise AssertionError('Original OWNER-only correction ceiling lost')
                    passed('original ADMIN correction denial retained')
                    api = db.last("select to_regprocedure('public.role_action_allowed(text)') is not null and to_regprocedure('public.require_role_action(text)') is not null")
                    if api != 't':
                        report['dependency'] = 'Hashed 060700 snapshot lacks role_action_allowed(text)/require_role_action(text). No fabricated foundation, no SQL domain changes, no keys activated.'
                        return 2
                    # Real custom action denial, while retaining original eligibility and menus.
                    keys = ['bank.'+domain+'.'+action for domain in ('cash_transfer','bank_reconciliation') for action in ('create','edit','void','recover')]
                    db.sql("update role_settings_private.action_catalog set enforced=true where id in (" + ','.join("'"+k+"'" for k in keys) + ");")
                    config = json.loads(actor(owner, "select public.get_role_access_config('ADMIN')"))
                    actor(owner, "select public.save_role_access_config('ADMIN','"+config['revision']+"','"+str(uuid.uuid4())+"','custom','[\"kas-bank\"]','{\"all_branches\":true,\"create_accounts\":true}','Bank deny proof','[]')")
                    report['red_observations'] = []
                    before = db.last("select jsonb_build_array((select count(*) from cash_transfers),(select count(*) from journal_entries),(select count(*) from journal_lines))")
                    red = json.loads(actor(admin, f"select public.mutate_cash_transfer('actual-denied-create','create',null,null,{header},null)"))
                    assert actor(admin, "select public.role_action_allowed('bank.cash_transfer.create')") == 'f'
                    assert red['journal_entry_id'] and before != db.last("select jsonb_build_array((select count(*) from cash_transfers),(select count(*) from journal_entries),(select count(*) from journal_lines))")
                    report['red_observations'].append({'key':'bank.cash_transfer.create','unauthorized_result':red})
                    assert json.loads(actor(admin,"select public.get_cash_transfer_result('actual-denied-create')")) == red
                    report['red_observations'].append({'key':'bank.cash_transfer.recover','unauthorized_result':red})
                    passed('GENUINE RED custom deny create/recover ignored by original public transfer; unauthorized balanced journal persisted')
                    rec_header = f"jsonb_build_object('account_id','{target}','tanggal',current_date,'saldo_bank',200,'biaya_adm',0,'bunga',0)"
                    rec = json.loads(actor(admin,f"select public.mutate_bank_reconciliation('actual-denied-rec','create',null,null,{rec_header},null)"))
                    assert actor(admin,"select public.role_action_allowed('bank.bank_reconciliation.create')") == 'f'
                    assert json.loads(actor(admin,"select public.get_bank_reconciliation_result('actual-denied-rec')")) == rec
                    report['red_observations'].extend([{'key':'bank.bank_reconciliation.'+a,'unauthorized_result':rec} for a in ('create','recover')])
                    passed('GENUINE RED custom deny create/recover ignored by original public reconciliation')
                    # The fixed action fence retains actor SHARE. A competing actor
                    # UPDATE must wait, while this backend's original access still
                    # progresses. Inspect real blocker PIDs rather than sleeping.
                    command=db.as_user+[db.psql,'-X','-qAt','-h',str(db.root),'-U','postgres','-v','ON_ERROR_STOP=1']
                    import os
                    import time
                    def live(name, statement):
                        p=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
                        p.stdin.write("set application_name='"+name+"';"+statement+'\n');p.stdin.flush();return p
                    def finish(p, statement=''):
                        if statement: os.write(p.stdin.fileno(),(statement+'\n').encode())
                        p.stdin.close();p.stdin=None
                        out,err=p.communicate(timeout=12)
                        return p.returncode,out,err
                    def observed(name, predicate='true', blocker=None, deadline_s=30):
                        # Poll pg_stat_activity/pg_blocking_pids up to a generous deadline (a loaded host
                        # can delay a waiter well beyond the former fixed 4s window). A Lock-wait
                        # observation is ONLY accepted when pg_blocking_pids names a REAL blocker PID
                        # (and, when given, the expected one); a skipped/unobserved wait is a failure.
                        wants_lock="wait_event_type='Lock'" in predicate
                        deadline=time.monotonic()+deadline_s
                        last=[]
                        while time.monotonic()<deadline:
                            last=json.loads(db.last("select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait_event_type',wait_event_type,'wait_event',wait_event,'state',state)),'[]') from pg_stat_activity where application_name='"+name+"' and ("+predicate+")"))
                            for row in last:
                                if wants_lock and not row['blockers']: continue
                                if blocker is not None and blocker not in row['blockers']: continue
                                report.setdefault('observed_backends',[]).append({'name':name,'predicate':predicate,'row':row,'waited_s':round(deadline_s-(deadline-time.monotonic()),3)})
                                return row
                            time.sleep(.02)
                        raise AssertionError('No observed backend '+name+' (blocker='+str(blocker)+') within '+str(deadline_s)+'s; last='+json.dumps(last))
                    holder=live('bank-fence-holder',f"begin;set local role authenticated;set local request.jwt.claim.sub='{owner}';set local request.jwt.claim.role='authenticated';select public.require_role_action('bank.cash_transfer.create');")
                    fence=observed('bank-fence-holder',"state='idle in transaction'")
                    waiter=live('bank-actor-lock',f"begin;select id from profiles where id='{owner}' for update;")
                    actor_lock=observed('bank-actor-lock',"wait_event_type='Lock'",blocker=fence['pid'])
                    assert fence['pid'] in actor_lock['blockers']
                    assert holder.stdin is not None
                    os.write(holder.stdin.fileno(),b"select public.get_cash_transfer_result('fence-original-access');\n")
                    assert finish(holder,'rollback;')[0]==0
                    released_actor_lock=observed('bank-actor-lock',"state='idle in transaction'")
                    assert released_actor_lock['pid']==actor_lock['pid']
                    assert finish(waiter,'rollback;')[0]==0
                    report['observed_locks']=[{'fence_pid':fence['pid'],'actor_locker':actor_lock,
                        'actor_locker_after_fence_release':released_actor_lock,
                        'original_access_progressed_with_actor_fence':True}]
                    # A final-exit-only domain patch avoids the demonstrated ordering trap.
                    assert DOMAIN in candidates
                    originals_functions=json.loads(db.last("select jsonb_object_agg(oid::regprocedure::text,jsonb_build_object('body',prosrc,'acl',proacl,'config',proconfig,'definer',prosecdef,'owner',proowner)) from pg_proc where pronamespace='public'::regnamespace"))
                    # An actual original direct-DML bypass: row guards never see TRUNCATE.
                    truncate_red=db.sql(f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';truncate journal_lines;select count(*) from journal_lines;rollback;")
                    assert truncate_red=='0'
                    report['direct_dml_red']='Original authenticated TRUNCATE journal_lines succeeds and removes all lines inside rolled-back proof transaction.'
                    db.sql("update role_settings_private.action_catalog set enforced=false where id like 'bank.%';")
                    policies_before=db.last("select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p")
                    db.sql('begin;'+candidates[DOMAIN].decode()+'commit;')
                    assert policies_before==db.last("select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p")
                    assert set(json.loads(db.last("select jsonb_agg(id order by id) from role_settings_private.action_catalog where id like 'bank.%' and enforced")))==set(keys)
                    modified=json.loads(db.last("select jsonb_object_agg(oid::regprocedure::text,jsonb_build_object('body',prosrc,'acl',proacl,'config',proconfig,'definer',prosecdef,'owner',proowner)) from pg_proc where pronamespace='public'::regnamespace"))
                    allowed_functions={'mutate_cash_transfer(text,text,uuid,integer,jsonb,text)','mutate_bank_reconciliation(text,text,uuid,integer,jsonb,text)','get_cash_transfer_result(text)','get_bank_reconciliation_result(text)'}
                    import re
                    for name,original in originals_functions.items():
                        changed=modified[name]
                        if name not in allowed_functions: assert original==changed,name
                        else:
                            assert {k:v for k,v in original.items() if k!='body'}=={k:v for k,v in changed.items() if k!='body'},name
                            domain='cash_transfer' if 'cash_transfer' in name else 'bank_reconciliation'
                            action_arg="'bank."+domain+".'||p_action" if name.startswith('mutate_') else "'bank."+domain+".recover'"
                            action_guard='perform public.require_role_action('+action_arg+');'
                            assert changed['body'].count(action_guard)==2,name
                            cleaned=changed['body'].replace(' '+action_guard+'\n','').replace(action_guard+' ','')
                            domain='cash_transfer' if 'cash_transfer' in name else 'bank_reconciliation'
                            guard="perform role_settings_private.require_bank_request_scope('"+domain+"',p_request_key);"
                            assert changed['body'].count(guard)==2,name
                            cleaned=cleaned.replace(' '+guard+'\n','').replace(guard+' ','')
                            assert cleaned==original['body'],name
                    passed('exact original function bodies differ only by known final-exit action/scope calls; all other bodies/ACL/owner/search_path/definer unchanged')
                    report['ordering_caution']='The actor fence blocks competing UPDATE and permits repeated original access; domain checks remain at final exits after original locks. Account writers still require their complete original sorted lock set before a final fence.'
                    def money_snapshot():
                        tables=('cash_transfers','cash_transfer_requests','cash_transfer_revisions','bank_reconciliations','bank_reconciliation_requests','bank_reconciliation_revisions','journal_entries','journal_lines','activity_log','document_numbering')
                        return db.last("select jsonb_build_array("+','.join("(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public."+t+" t)" for t in tables)+")")
                    def denied(who, statement, match='ROLE_ACTION_DENIED'):
                        before=money_snapshot()
                        try: actor(who,statement)
                        except RuntimeError as error: assert match in str(error), str(error)
                        else: raise AssertionError('Expected denial: '+statement)
                        assert before==money_snapshot()
                    # Remove RED reconciliation using the original OWNER RPC so transfer
                    # rejection cannot be explained by an unrelated reconciliation ceiling.
                    actor(owner,f"select public.mutate_bank_reconciliation('clean-red-rec','void','{rec['reconciliation_id']}',0,'{{}}','Remove RED fixture')")
                    denied(admin,f"select public.mutate_cash_transfer('green-deny-create','create',null,null,{header},null)")
                    denied(admin,f"select public.mutate_cash_transfer('actual-denied-create','create',null,null,{header},null)")
                    denied(admin,"select public.get_cash_transfer_result('actual-denied-create')")
                    denied(admin,"select public.get_cash_transfer_result('missing-key')")
                    denied(admin,f"select public.mutate_bank_reconciliation('green-deny-rec','create',null,null,{rec_header},null)")
                    denied(admin,f"select public.mutate_bank_reconciliation('actual-denied-rec','create',null,null,{rec_header},null)")
                    denied(admin,"select public.get_bank_reconciliation_result('actual-denied-rec')")
                    denied(admin,"select public.get_bank_reconciliation_result('missing-key')")
                    passed('GREEN actual custom deny both create, cached mutation replay and existing/missing recovery; full money snapshots unchanged')
                    # Owner remains the intrinsic edit/void floor, not a configurable grant.
                    denied(admin,f"select public.mutate_cash_transfer('green-floor','edit','{created['transfer_id']}',0,{header},'No promotion')",'Akses')
                    denied(admin,f"select public.mutate_bank_reconciliation('green-rec-floor','void','{rec['reconciliation_id']}',0,'{{}}','No promotion')",'Hanya Owner')
                    made=json.loads(actor(owner,f"select public.mutate_cash_transfer('positive-create','create',null,null,{header},null)"))
                    edit=json.loads(actor(owner,f"select public.mutate_cash_transfer('positive-edit','edit','{made['transfer_id']}',0,jsonb_set({header},'{{jumlah}}','125'),'Correct original')"))
                    assert json.loads(actor(owner,"select public.get_cash_transfer_result('positive-edit')"))==edit
                    assert json.loads(actor(owner,f"select public.mutate_cash_transfer('positive-edit','edit','{made['transfer_id']}',0,jsonb_set({header},'{{jumlah}}','125'),'Correct original')"))==edit
                    actor(owner,f"select public.mutate_cash_transfer('positive-void','void','{edit['replacement_transfer_id']}',0,'{{}}','Void replacement')")
                    rec_header=f"jsonb_build_object('account_id','{target}','tanggal',current_date,'saldo_bank',200,'biaya_adm',10,'bunga',2)"
                    # Official original chart already owns fee/interest accounts.
                    r=json.loads(actor(owner,f"select public.mutate_bank_reconciliation('positive-rec-create','create',null,null,{rec_header},null)"))
                    edited=json.loads(actor(owner,f"select public.mutate_bank_reconciliation('positive-rec-edit','edit','{r['reconciliation_id']}',0,jsonb_set({rec_header},'{{biaya_adm}}','12'),'Correct original')"))
                    assert json.loads(actor(owner,"select public.get_bank_reconciliation_result('positive-rec-edit')"))==edited
                    actor(owner,f"select public.mutate_bank_reconciliation('positive-rec-void','void','{r['reconciliation_id']}',1,'{{}}','Void corrected')")
                    assert db.last("select not exists(select entry_id from journal_lines group by entry_id having sum(debit)<>sum(credit))")=='t'
                    passed('native positive original public transfer and reconciliation create/edit/void/recovery/replay; every journal balanced')
                    # BANK-SCOPE-POSTWAIT: exact independent schedule; retain action grant.
                    def scope_policy(all_branches=True, modules=('kas-bank',)):
                        cfg=json.loads(actor(owner,"select public.get_role_access_config('ADMIN')"))
                        return "select public.save_role_access_config('ADMIN','"+cfg['revision']+"','"+str(uuid.uuid4())+"','custom','"+json.dumps(list(modules))+"','"+json.dumps({'all_branches':all_branches,'create_accounts':True})+"','Scope race proof','"+json.dumps(keys)+"')"
                    actor(owner,scope_policy())
                    ledger=live('bank-scope-ledger','begin;lock table journal_entries,journal_lines in share row exclusive mode;')
                    ledger_pid=observed('bank-scope-ledger',"state='idle in transaction'")['pid']
                    racing=live('bank-scope-waiter',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';select public.mutate_cash_transfer('scope-race','create',null,null,{header},null);commit;")
                    scope_wait=observed('bank-scope-waiter',"wait_event_type='Lock'",blocker=ledger_pid);assert ledger_pid in scope_wait['blockers']
                    actor(owner,scope_policy(False))
                    assert actor(admin,f"select public.user_can_access_branch('{branch}')")=='f'
                    scope_before=money_snapshot()
                    finish(ledger,'commit;');code,out,err=finish(racing)
                    report['scope_race']={'ledger_pid':ledger_pid,'waiter':scope_wait,'returncode':code,'stdout':out,'stderr':err,'committed_all_branches_revocation':True}
                    assert code and ('BANK_SCOPE_DENIED' in err or 'Cabang' in err),(code,out,err)
                    assert scope_before==money_snapshot(),'scope denial changed money/request/revision/audit/numbering'
                    passed('BANK-SCOPE-POSTWAIT committed all_branches revocation retains action but denies with full zero-effects fingerprint')
                    # Reconciliation's original global-book floor must also see a
                    # committed capability revocation on its real ledger wait.
                    actor(owner,scope_policy())
                    ledger=live('scope-rec-ledger','begin;lock table journal_entries,journal_lines in share row exclusive mode;')
                    ledger_pid=observed('scope-rec-ledger',"state='idle in transaction'")['pid']
                    racing=live('scope-rec-reader',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';select public.mutate_bank_reconciliation('rec-scope-race','create',null,null,{rec_header},null);commit;")
                    row=observed('scope-rec-reader',"wait_event_type='Lock'",blocker=ledger_pid);assert ledger_pid in row['blockers']
                    actor(owner,scope_policy(False));before_scope=money_snapshot()
                    finish(ledger,'commit;');code,out,err=finish(racing)
                    assert code and ('seluruh cabang' in err or 'BANK_SCOPE_DENIED' in err),(code,out,err)
                    assert before_scope==money_snapshot()
                    report['scope_reconciliation_ledger_revocation']={'ledger_pid':ledger_pid,'reader':row,'error':err,'committed_all_branches_revocation':True}
                    passed('original reconciliation global-book floor sees committed all_branches revocation after real ledger wait; zero effects')
                    # Pin a valid scope against an otherwise unchanged ordinary
                    # Owner save, retaining all eight action grants and module.
                    actor(owner,scope_policy())
                    held=live('scope-capability-fence',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';select public.mutate_cash_transfer('scope-capability-held','create',null,null,{header},null);")
                    held_pid=observed('scope-capability-fence',"state='idle in transaction'")['pid']
                    writer=live('scope-capability-writer',f"begin;set local role authenticated;set local request.jwt.claim.sub='{owner}';set local request.jwt.claim.role='authenticated';{scope_policy(False)};commit;")
                    row=observed('scope-capability-writer',"wait_event_type='Lock'",blocker=held_pid);assert held_pid in row['blockers']
                    assert finish(held,'commit;')[0]==0
                    assert finish(writer)[0]==0
                    assert actor(admin,"select public.has_role_capability('all_branches')")=='f'
                    report['scope_capability_pin']={'holder_pid':held_pid,'owner_writer':row,'revocation_committed_after_posting':True}
                    passed('successful valid scope pins ordinary Owner all_branches-only config revocation with action grants retained until commit')
                    # Cached/recovery paths must refresh scope AFTER a real epoch wait,
                    # not rely on their original scope checks before it.
                    scope_calls=[
                        ("transfer-cached",f"select public.mutate_cash_transfer('baseline-create','create',null,null,{header},null)"),
                        ("transfer-recovery","select public.get_cash_transfer_result('baseline-create')"),
                        ("reconciliation-cached",f"select public.mutate_bank_reconciliation('actual-denied-rec','create',null,null,jsonb_build_object('account_id','{target}','tanggal',current_date,'saldo_bank',200,'biaya_adm',0,'bunga',0),null)"),
                        ("reconciliation-recovery","select public.get_bank_reconciliation_result('actual-denied-rec')"),
                        ("reconciliation-missing","select public.get_bank_reconciliation_result('scope-missing')")]
                    report['scope_epoch_waits']=[]
                    for label,call in scope_calls:
                        actor(owner,scope_policy())
                        writer=live('scope-epoch-writer',f"begin;set local role authenticated;set local request.jwt.claim.sub='{owner}';set local request.jwt.claim.role='authenticated';{scope_policy(False)};")
                        writer_pid=observed('scope-epoch-writer',"state='idle in transaction'")['pid']
                        racing=live('scope-epoch-reader',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';{call};commit;")
                        row=observed('scope-epoch-reader',"wait_event_type='Lock'",blocker=writer_pid);assert writer_pid in row['blockers']
                        finish(writer,'commit;');before_scope=money_snapshot()
                        code,out,err=finish(racing)
                        assert code and ('BANK_SCOPE_DENIED' in err or 'Cabang' in err),(label,code,out,err)
                        assert before_scope==money_snapshot(),label
                        report['scope_epoch_waits'].append({'case':label,'writer_pid':writer_pid,'reader':row,'error':err})
                    passed('cached transfer/reconciliation and existing/missing recovery refresh scope after actual Owner epoch-wait revocation; zero effects')
                    # False capability is NOT itself a transfer denial: explicit live
                    # document/account branch grants remain legitimate.
                    db.sql(f"update cash_accounts set branch_id='{branch}' where id in('{source}','{target}');")
                    actor(owner,f"insert into public.user_branches(user_id,branch_id) values('{admin}','{branch}')")
                    actor(owner,scope_policy(False))
                    explicit=json.loads(actor(admin,f"select public.mutate_cash_transfer('explicit-scope','create',null,null,{header},null)"))
                    assert json.loads(actor(admin,"select public.get_cash_transfer_result('explicit-scope')"))==explicit
                    assert json.loads(actor(admin,f"select public.mutate_cash_transfer('explicit-scope','create',null,null,{header},null)"))==explicit
                    denied(admin,f"select public.mutate_bank_reconciliation('false-cap-rec','create',null,null,{rec_header},null)",'seluruh cabang')
                    passed('all_branches=false explicit branch grant permits transfer create/cached/recovery, but never partial-book reconciliation')
                    # Document branch remains explicitly granted while ONLY an
                    # affected account branch loses its all_branches authorization.
                    other_branch=str(uuid.UUID(int=810006))
                    db.sql(f"insert into branches(id,name,code,type) values('{other_branch}','Other scope','BANKOTHER','OFFICE');update cash_accounts set branch_id='{other_branch}' where id='{source}';")
                    actor(owner,scope_policy())
                    ledger=live('scope-account-ledger','begin;lock table journal_entries,journal_lines in share row exclusive mode;')
                    ledger_pid=observed('scope-account-ledger',"state='idle in transaction'")['pid']
                    racing=live('scope-account-reader',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';select public.mutate_cash_transfer('account-scope-race','create',null,null,{header},null);commit;")
                    row=observed('scope-account-reader',"wait_event_type='Lock'",blocker=ledger_pid);assert ledger_pid in row['blockers']
                    actor(owner,scope_policy(False))
                    assert actor(admin,f"select public.user_can_access_branch('{branch}') and not public.user_can_access_branch('{other_branch}')")=='t'
                    before_scope=money_snapshot();finish(ledger,'commit;');code,out,err=finish(racing)
                    assert code and ('BANK_SCOPE_DENIED' in err or 'Cabang' in err),(code,out,err)
                    assert before_scope==money_snapshot()
                    report['scope_account_only_revocation']={'ledger_pid':ledger_pid,'reader':row,'document_granted':True,'account_denied':True,'error':err}
                    db.sql(f"update cash_accounts set branch_id='{branch}' where id='{source}';")
                    passed('exact persisted affected account branch revalidated although document branch remains explicitly granted; zero effects')
                    # Original user_branches DML is an actual ordinary Owner path in
                    # this 365+core+bank snapshot, independent of capability config.
                    ledger=live('scope-grant-ledger','begin;lock table journal_entries,journal_lines in share row exclusive mode;')
                    ledger_pid=observed('scope-grant-ledger',"state='idle in transaction'")['pid']
                    racing=live('scope-grant-reader',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';select public.mutate_cash_transfer('grant-race','create',null,null,{header},null);commit;")
                    row=observed('scope-grant-reader',"wait_event_type='Lock'",blocker=ledger_pid);assert ledger_pid in row['blockers']
                    actor(owner,f"delete from public.user_branches where user_id='{admin}' and branch_id='{branch}'")
                    assert db.last(f"select count(*) from user_branches where user_id='{admin}'")=='0'
                    before_scope=money_snapshot();finish(ledger,'commit;');code,out,err=finish(racing)
                    assert code and ('BANK_SCOPE_DENIED' in err or 'Cabang' in err),(code,out,err)
                    assert before_scope==money_snapshot()
                    report['scope_grant_revocation']={'ledger_pid':ledger_pid,'reader':row,'committed_delete':True,'error':err}
                    passed('independent real Owner user_branches revocation commits during ledger wait; transfer denied with zero effects')
                    # Successful explicit scope pins its grant until transaction commit.
                    actor(owner,f"insert into public.user_branches(user_id,branch_id) values('{admin}','{branch}')")
                    held=live('scope-grant-fence',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';select public.mutate_cash_transfer('grant-held','create',null,null,{header},null);")
                    held_pid=observed('scope-grant-fence',"state='idle in transaction'")['pid']
                    revoker=live('scope-grant-delete',f"begin;set local role authenticated;set local request.jwt.claim.sub='{owner}';set local request.jwt.claim.role='authenticated';delete from public.user_branches where user_id='{admin}' and branch_id='{branch}';commit;")
                    row=observed('scope-grant-delete',"wait_event_type='Lock'",blocker=held_pid);assert held_pid in row['blockers']
                    assert finish(held,'commit;')[0]==0
                    assert finish(revoker)[0]==0
                    report['scope_grant_pin']={'holder_pid':held_pid,'revoker':row}
                    passed('successful explicit-scope posting pins original user_branches grant against actual Owner DELETE through commit')
                    # Module revocation retaining action and capability still denies.
                    actor(owner,scope_policy())
                    ledger=live('scope-module-ledger','begin;lock table journal_entries,journal_lines in share row exclusive mode;')
                    ledger_pid=observed('scope-module-ledger',"state='idle in transaction'")['pid']
                    racing=live('scope-module-reader',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';select public.mutate_cash_transfer('module-race','create',null,null,{header},null);commit;")
                    row=observed('scope-module-reader',"wait_event_type='Lock'",blocker=ledger_pid);assert ledger_pid in row['blockers']
                    actor(owner,scope_policy(True,()))
                    before_scope=money_snapshot();finish(ledger,'commit;');code,out,err=finish(racing)
                    assert code and ('Kas & Bank' in err or 'ROLE_ACTION_DENIED' in err or 'BANK_SCOPE_DENIED' in err),(code,out,err)
                    assert before_scope==money_snapshot()
                    report['scope_module_revocation']={'ledger_pid':ledger_pid,'reader':row,'error':err}
                    passed('committed real Owner module deny retaining action and all_branches denies post-ledger transfer with zero effects')
                    actor(owner,scope_policy())
                    # Reconciliation retains its stronger whole-book capability floor.
                    actor(owner,scope_policy())
                    ledger=live('scope-rec-ledger','begin;lock table journal_entries,journal_lines in share row exclusive mode;')
                    ledger_pid=observed('scope-rec-ledger',"state='idle in transaction'")['pid']
                    racing=live('scope-rec-reader',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';select public.mutate_bank_reconciliation('rec-scope-race','create',null,null,{rec_header},null);commit;")
                    row=observed('scope-rec-reader',"wait_event_type='Lock'",blocker=ledger_pid);assert ledger_pid in row['blockers']
                    actor(owner,scope_policy(False))
                    before_scope=money_snapshot();finish(ledger,'commit;');code,out,err=finish(racing)
                    assert code and ('seluruh cabang' in err or 'BANK_SCOPE_DENIED' in err),(code,out,err)
                    assert before_scope==money_snapshot()
                    report['scope_reconciliation_revocation']={'ledger_pid':ledger_pid,'reader':row,'committed_all_branches_revocation':True,'error':err}
                    passed('reconciliation ledger wait observes committed all_branches revocation retaining action; full zero-effects fingerprint')
                    # Exact inverse direction: a successful scoped posting pins a
                    # same-action capability-only Owner save until its commit.
                    actor(owner,scope_policy())
                    held=live('scope-capability-fence',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';select public.mutate_cash_transfer('cap-held','create',null,null,{header},null);")
                    held_pid=observed('scope-capability-fence',"state='idle in transaction'")['pid']
                    writer=live('scope-capability-save',f"begin;set local role authenticated;set local request.jwt.claim.sub='{owner}';set local request.jwt.claim.role='authenticated';{scope_policy(False)};commit;")
                    row=observed('scope-capability-save',"wait_event_type='Lock'",blocker=held_pid);assert held_pid in row['blockers']
                    assert finish(held,'commit;')[0]==0
                    code,out,err=finish(writer);assert code==0,(code,out,err)
                    assert actor(admin,"select public.has_role_capability('all_branches')")=='f'
                    assert db.last("select count(*) from cash_transfer_requests where request_key='cap-held'")=='1'
                    report['scope_capability_pin']={'holder_pid':held_pid,'owner_save':row,'same_actions':True,'save_committed_after_posting':True}
                    passed('valid scope pins same-action capability-only real Owner save until posting commit; exact blocker PID')
                    # Final fence must take fresh policy AFTER real ledger wait. Policy
                    # revocation commits while original public RPC is demonstrably blocked.
                    config=json.loads(actor(owner,"select public.get_role_access_config('ADMIN')"))
                    def policy(allowed):
                        cfg=json.loads(actor(owner,"select public.get_role_access_config('ADMIN')"))
                        return "select public.save_role_access_config('ADMIN','"+cfg['revision']+"','"+str(uuid.uuid4())+"','custom','[\"kas-bank\"]','{\"all_branches\":true,\"create_accounts\":true}','Race action policy','"+json.dumps(allowed)+"')"
                    actor(owner,policy(['bank.cash_transfer.create','bank.bank_reconciliation.create']))
                    ledger=live('bank-ledger-holder','begin;lock table journal_entries,journal_lines in share row exclusive mode;')
                    ledger_pid=observed('bank-ledger-holder',"state='idle in transaction'")['pid']
                    racing=live('bank-policy-waiter',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';select public.mutate_cash_transfer('policy-race','create',null,null,{header},null);commit;")
                    observed_wait=observed('bank-policy-waiter',"wait_event_type='Lock'",blocker=ledger_pid)
                    assert ledger_pid in observed_wait['blockers']
                    actor(owner,policy([]))
                    finish(ledger,'commit;')
                    code,out,err=finish(racing)
                    assert code and 'ROLE_ACTION_DENIED' in err,(code,out,err)
                    assert db.last("select count(*) from cash_transfer_requests where request_key='policy-race'")=='0'
                    report['observed_locks'].append({'ledger_pid':ledger_pid,'policy_waiter':observed_wait,'committed_revocation':True})
                    passed('real public transfer ledger wait actual blocker PID; policy revocation commits before release; denied with no request')
                    actor(owner,policy(['bank.bank_reconciliation.create']))
                    ledger=live('bank-rec-ledger-holder','begin;lock table journal_entries,journal_lines in share row exclusive mode;')
                    ledger_pid=observed('bank-rec-ledger-holder',"state='idle in transaction'")['pid']
                    rec_before=db.last("select jsonb_build_array((select count(*) from bank_reconciliations),(select count(*) from bank_reconciliation_requests),(select count(*) from journal_entries),(select count(*) from journal_lines))")
                    racing=live('bank-rec-policy-waiter',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';select public.mutate_bank_reconciliation('rec-policy-race','create',null,null,{rec_header},null);commit;")
                    row=observed('bank-rec-policy-waiter',"wait_event_type='Lock'",blocker=ledger_pid);assert ledger_pid in row['blockers']
                    actor(owner,policy([]));finish(ledger,'commit;')
                    code,out,err=finish(racing);assert code and 'ROLE_ACTION_DENIED' in err,(code,out,err)
                    assert rec_before==db.last("select jsonb_build_array((select count(*) from bank_reconciliations),(select count(*) from bank_reconciliation_requests),(select count(*) from journal_entries),(select count(*) from journal_lines))")
                    report['observed_locks'].append({'reconciliation_ledger_pid':ledger_pid,'policy_waiter':row,'committed_revocation':True})
                    passed('real public reconciliation ledger wait sees committed action revocation; no reconciliation/request/journal effects')
                    # Original actor wait after a committed deactivation must deny.
                    locker=live('bank-actor-revoker',f"begin;update profiles set is_active=false where id='{admin}';")
                    locker_pid=observed('bank-actor-revoker',"state='idle in transaction'")['pid']
                    racing=live('bank-actor-waiter',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';select public.get_cash_transfer_result('actual-denied-create');commit;")
                    row=observed('bank-actor-waiter',"wait_event_type='Lock'",blocker=locker_pid);assert locker_pid in row['blockers']
                    finish(locker,'commit;');code,out,err=finish(racing);assert code and 'Akses' in err
                    report['observed_locks'].append({'revoker_pid':locker_pid,'actor_waiter':row,'committed_deactivation':True})
                    passed('actual original actor row wait sees committed inactive actor, recovery denied')
                    db.sql(f"update profiles set is_active=true where id='{admin}';")
                    for table in ('cash_transfers','cash_transfer_requests','cash_transfer_revisions','bank_reconciliations','bank_reconciliation_requests','bank_reconciliation_revisions'):
                        for statement in (f'truncate {table}',f'delete from {table}',f'update {table} set '+('request_key=request_key' if table.endswith('requests') else 'id=id')):
                            denied(owner,statement,'permission denied')
                    denied(owner,'truncate journal_lines','permission denied')
                    denied(owner,'truncate journal_entries cascade','permission denied')
                    denied(owner,"insert into journal_entries(no_jurnal,tanggal,deskripsi,source) values('FORGE.TRANSFER',current_date,'forged','transfer')",'jalur resmi')
                    denied(owner,"insert into journal_entries(no_jurnal,tanggal,deskripsi,source) values('FORGE.REC',current_date,'forged','bank-rec')",'jalur resmi')
                    passed('all six original direct-DML surfaces and shared ledger TRUNCATE denied; protected journal forge still denied')
                    # Gate held until commit prevents both policy and actor revocation.
                    actor(owner,policy(['bank.cash_transfer.create']))
                    revoke_statement=policy([])
                    held=live('bank-final-fence',f"begin;set local role authenticated;set local request.jwt.claim.sub='{admin}';set local request.jwt.claim.role='authenticated';select public.mutate_cash_transfer('fence-positive','create',null,null,{header},null);")
                    held_pid=observed('bank-final-fence',"state='idle in transaction'")['pid']
                    revoker=live('bank-post-fence-actor',f"begin;update profiles set is_active=false where id='{admin}';commit;")
                    row=observed('bank-post-fence-actor',"wait_event_type='Lock'",blocker=held_pid);assert held_pid in row['blockers']
                    writer=live('bank-post-fence-policy',f"begin;set local role authenticated;set local request.jwt.claim.sub='{owner}';set local request.jwt.claim.role='authenticated';{revoke_statement};commit;")
                    epoch_wait=observed('bank-post-fence-policy',"wait_event_type='Lock'",blocker=held_pid);assert held_pid in epoch_wait['blockers']
                    report['observed_locks'].append({'final_fence_pid':held_pid,'actor_revocation_wait':row,'policy_revocation_wait':epoch_wait})
                    assert finish(held,'commit;')[0]==0
                    assert finish(revoker)[0]==0
                    # Profile revoker may linearize first, but policy owner remains active.
                    writer_code,writer_out,writer_error=finish(writer)
                    if writer_code:
                        assert 'could not obtain lock' in writer_error,writer_error
                        report['observed_nowait_retry']={'error':writer_error,'first_attempt_committed':False}
                        actor(owner,revoke_statement)
                    denied(admin,"select public.get_cash_transfer_result('fence-positive')",'Akses')
                    passed('actual successful public posting holds final fence through commit; independent actor and policy revokers blocked by exact PID')
                    # Reuse the original positive transfer journey on a fresh full schema.
                    with NativePostgres('/opt/data/kamo-pg-harness/bin') as journey:
                        fixture.DisposablePostgres.bootstrap(journey)
                        journey.sql('begin;'+candidates[CORE].decode()+candidates[DOMAIN].decode()+'commit;')
                        original_suite=(ROOT/'supabase/tests/internal_transfer_corrections.sql').read_bytes()
                        report['original_transfer_journey_sha256']=hashlib.sha256(original_suite).hexdigest()
                        journey.sql(original_suite.decode())
                        merchant_fixture=(ROOT/'supabase/tests/pos_merchant_fees.sql').read_text().split('set local role authenticated;',1)[0]
                        journey.sql(merchant_fixture+"alter table profiles disable trigger guard_profile_privileges;update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';alter table profiles enable trigger guard_profile_privileges;commit;")
                        rec_suite=(ROOT/'supabase/tests/bank_reconciliation_lifecycle.sql').read_text()
                        report['original_reconciliation_journey_sha256']=hashlib.sha256(rec_suite.encode()).hexdigest()
                        # Foundation intentionally forbids old direct configuration API.
                        # These three privileged fixture-only mutations use explicit no-JWT
                        # DBA maintenance, preserving every original business assertion.
                        def maintenance(match):
                            return "select set_config('test.fixture_sub',coalesce(current_setting('request.jwt.claim.sub',true),''),true);select set_config('test.fixture_claims',coalesce(current_setting('request.jwt.claims',true),'{}'),true);select set_config('request.jwt.claim.sub','',true);select set_config('request.jwt.claims','{}',true);"+match.group(0)+"select set_config('request.jwt.claim.sub',current_setting('test.fixture_sub'),true);select set_config('request.jwt.claims',current_setting('test.fixture_claims'),true);"
                        rec_suite=re.sub(r'(?m)^(?:insert into role_capabilities|update role_capabilities|insert into role_modules)[^;]+;',maintenance,rec_suite)
                        report['reconciliation_fixture_adapter_sha256']=hashlib.sha256(rec_suite.encode()).hexdigest()
                        journey.sql(rec_suite)
                    passed('original transfer and full reconciliation lifecycle journeys on fresh 365+core+bank; only config fixtures use explicit no-JWT DBA scope')
                    report['enabled_keys']=keys
                    report['dependency']='Native snapshot current foundation action API used; final-only authorization fences avoid demonstrated original actor-lock trap.'
                    report['native_action_red_green']=True
                    report['status']='native_bank_green_pending_full_ingress_review'
                    return 0
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        (OUT/'action-bank-native-report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({k:v for k,v in report.items() if k != 'original_hashes'}, indent=2), flush=True)


if __name__ == '__main__':
    sys.exit(main())
