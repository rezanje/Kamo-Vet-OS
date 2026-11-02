#!/usr/bin/env python3
"""Portable full-original-schema pending-package RED/GREEN; local fictional PG17 only.

--baseline omits the owned candidate and must fail the required package SAVE.
--out stores exact manifests/definitions/snapshot SQL and machine-readable results.
Original clinical and inpatient regression runners execute without business stubs.
"""
import argparse, fcntl, copy, difflib, contextlib, hashlib, importlib.util, io, json, os, signal, subprocess, sys, tarfile, tempfile, time, traceback
from pathlib import Path
sys.dont_write_bytecode=True
REPO=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline',action='store_true')
parser.add_argument('--out',type=Path,required=True)
parser.add_argument('--pg-bin',default=os.environ.get('KAMO_PG_BIN','/opt/data/kamo-pg-harness/bin'))
parser.add_argument('--lock',default='/opt/data/kamo-heavy-test.lock')
args=parser.parse_args()
CANDIDATE='supabase/migrations/20261106110000_clinic_pending_package_origin.sql'
BASE='f6aa3e4c9cb7e72140f778b0bd73775ea205c0cb'
OUT=args.out.resolve()
PREFIX=OUT/('pending-package-red' if args.baseline else 'pending-package-green')
REPORT={'base':BASE,'scope':'original full-schema public RPC; fictional fixtures; socket-only PG17; no hosted services or source changes','cases':[]}
START=time.monotonic()
def record(name,ok,details):
    row={'case':name,'status':'PASS' if ok else 'FAIL','detail':details}; REPORT['cases'].append(row); print(json.dumps(row),flush=True)
def git(*args):return subprocess.check_output(['git','-C',str(REPO),*args])
def sha(data):return hashlib.sha256(data).hexdigest()
def alarm(*_):raise TimeoutError('Native evidence run exceeded its 240-second bound')
def fingerprint(h):
    tables=json.loads(h.nilai("select json_agg(json_build_array(n.nspname,c.relname) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','clinic_private','auth','storage') and c.relkind='r';"))
    pieces=[]
    for schema,name in tables:
        ident='"'+schema.replace('"','""')+'"."'+name.replace('"','""')+'"'
        label=(schema+'.'+name).replace("'","''")
        pieces.append(f"select '{label}' name,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) hash from {ident} t")
    return json.loads(h.nilai("select jsonb_object_agg(name,jsonb_build_object('rows',n,'md5',hash)) from ("+' union all '.join(pieces)+') s;'))
def function_fingerprints(h):
    return json.loads(h.nilai("select jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('definition_md5',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig,'owner',p.proowner,'language',p.prolang,'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private','auth') and p.prokind in ('f','p');"))
def main():
    OUT.mkdir(parents=True,exist_ok=True)
    lock=open(args.lock,'a');fcntl.flock(lock,fcntl.LOCK_EX)
    signal.signal(signal.SIGALRM,alarm);signal.alarm(240)
    candidate=None if args.baseline else (REPO/CANDIDATE).read_bytes()
    REPORT['mode']='RED' if args.baseline else 'candidate'
    REPORT['candidate_sha256']=sha(candidate) if candidate else None
    if candidate:Path(str(PREFIX)+'-candidate.sql').write_bytes(candidate)
    REPORT['runner_sha256']=sha(Path(__file__).read_bytes())
    with tempfile.TemporaryDirectory(prefix='pending-package-base.',dir=OUT) as temp:
        root=Path(temp)
        archive=git('archive',BASE,'scripts','supabase/migrations','supabase/tests/fixtures','src/lib/paket-klinik.ts')
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:tar.extractall(root,filter='data')
        names=git('ls-tree','-r','--name-only',BASE,'supabase/migrations').decode().splitlines()
        assert len(names)==364,len(names)
        manifest=[]
        for name in names:
            original=git('show',BASE+':'+name); disk=(REPO/name).read_bytes(); frozen=(root/name).read_bytes()
            assert original==disk==frozen,name
            manifest.append({'path':name,'sha256':sha(original),'bytes':len(original)})
        for path in sorted((root/'scripts').glob('*.py')):
            relative=path.relative_to(root).as_posix()
            assert path.read_bytes()==git('show',BASE+':'+relative),relative
        fixture_file=root/'supabase/tests/fixtures/hosted_auth_uid.sql'
        assert fixture_file.read_bytes()==git('show',BASE+':supabase/tests/fixtures/hosted_auth_uid.sql')
        REPORT['original_migrations']={'count':len(manifest),'byteverified':True,'first':names[0],'last':names[-1],'manifest_sha256':sha(json.dumps(manifest,sort_keys=True).encode())}
        REPORT['platform_fixture_sha256']=sha(fixture_file.read_bytes())
        REPORT['dependencies_sha256']={path.relative_to(root).as_posix():sha(path.read_bytes()) for path in sorted((root/'scripts').glob('*.py'))}
        REPORT['dependencies_sha256']['src/lib/paket-klinik.ts']=sha((root/'src/lib/paket-klinik.ts').read_bytes())
        Path(str(PREFIX)+'-migration-manifest.json').write_text(json.dumps(manifest,indent=2))
        sys.path.insert(0,str(root/'scripts'))
        spec=importlib.util.spec_from_file_location('original_cart',root/'scripts/test-inpatient-cashier-cart-postgres.py');assert spec and spec.loader;cartmod=importlib.util.module_from_spec(spec);spec.loader.exec_module(cartmod)
        x,r,q,j=cartmod.x,cartmod.r,cartmod.q,cartmod.j
        with r.NativePostgres(args.pg_bin) as db:
            REPORT['cluster']={'root':str(db.root),'listen_addresses':db.sql('show listen_addresses'),'server_version':db.sql('show server_version')}
            assert db.sql('show server_version_num').startswith('17')
            r.fixture.DisposablePostgres.bootstrap(db)
            h=x.Harness(db)
            policy_sql="select jsonb_agg(jsonb_build_array(n.nspname,c.relname,p.polname,p.polcmd,p.polroles,p.polpermissive,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by n.nspname,c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace"
            before_policies=h.nilai(policy_sql)
            before_functions=function_fingerprints(h)
            Path(str(PREFIX)+'-original-functions.json').write_text(json.dumps(before_functions,indent=2))
            defs=h.nilai("select jsonb_object_agg(p.oid::regprocedure::text,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private') and p.prokind='f';")
            Path(str(PREFIX)+'-installed-definitions.json').write_text(json.dumps(json.loads(defs),indent=2))
            x.setup(h)
            legacy_v,legacy_m=cartmod.m.visit(h,2800)
            legacy_stay=h.nilai(f'select id from inpatient_records where visit_id={q(legacy_v)}')
            legacy_draft=cartmod.read(h,legacy_v,legacy_stay)
            legacy_lines=[dict(description=row['nama_obat'],qty=row['qty'],price=row['harga'],kind=row['jenis'],item_id=row['item_id'],unit=row['satuan'],prescription_item_id=row['id'],recipe_id=row.get('compound_recipe_id'),discount_percent=0) for row in legacy_draft['rows']]
            legacy_header=dict(tanggal='2026-11-03',subtotal=330000,discount=0,tax=0,total=330000,dp_amount=0,dp_date=None,paid_status='Belum Lunas',metode_bayar='Tunai',shift_id=r.SHIFT[r.STAFF],voucher_code=None,salesperson_id=None,dp_override_reason=None)
            h.sql(f"select clinic_receive_visit_payment({q(legacy_v)},'pre-migration-receipt','2026-11-03',{j([dict(method='Tunai',amount=330000)])},null,null)",r.STAFF)
            legacy_sql=f"select clinic_post_inpatient_stage_invoice({q(legacy_v)},'pre-migration-stage',{j(legacy_header)},{j(legacy_lines)})"
            h.sql(legacy_sql,r.STAFF)
            open_v,open_m=cartmod.m.visit(h,2801)
            open_stay=h.nilai(f'select id from inpatient_records where visit_id={q(open_v)}')
            open_before=cartmod.read(h,open_v,open_stay)
            open_version_before=h.nilai(f'select clinic_outpatient_cart_version({q(open_v)})',r.STAFF)
            if candidate: db.sql('begin;'+candidate.decode()+';commit;')
            open_after=cartmod.read(h,open_v,open_stay)
            open_version_after=h.nilai(f'select clinic_outpatient_cart_version({q(open_v)})',r.STAFF)
            old_tabs_ok=open_before['rows']==open_after['rows'] and open_before['snapshot']==open_after['snapshot'] and open_before['quote']==open_after['quote'] and open_version_before==open_version_after
            record('Unchanged untagged open tab preserves exact rows quote snapshot and outpatient version across migration',old_tabs_ok,{'rows_equal':open_before['rows']==open_after['rows'],'snapshot_equal':open_before['snapshot']==open_after['snapshot'],'quote_equal':open_before['quote']==open_after['quote'],'outpatient_equal':open_version_before==open_version_after})
            if candidate:assert old_tabs_ok,'Untouched legacy open tabs invalidated by null provenance fields'
            legacy_snapshot=fingerprint(h);legacy_error=h.gagal(legacy_sql,r.STAFF)
            record('Pre-migration untagged public stage exact replay unchanged',not legacy_error and legacy_snapshot==fingerprint(h),{'error':legacy_error})
            if candidate:assert not legacy_error,'Legacy replay regression: '+str(legacy_error)
            after_functions=function_fingerprints(h)
            record('Every original RLS policy unchanged',before_policies==h.nilai(policy_sql),{'policy_sha256':sha(before_policies.encode())})
            REPORT['modified_functions']=[k for k in before_functions if before_functions[k]!=after_functions.get(k)]
            group=r.uid('e',2900); service=r.uid('e',2901); inventory=[r.uid('e',n) for n in range(2902,2906)]
            h.sql(f"insert into items(id,code,name,unit,item_type,is_active,sell_price,buy_price) values({q(group)},'FICTION-GROUP-RED','Paket Pemeriksaan Fiktif','paket','Grup',true,100000,0),({q(service)},'FICTION-GROUP-JASA','Jasa Pemeriksaan Fiktif','kali','Jasa',true,96000,0);")
            for i,item in enumerate(inventory):
                h.sql(f"insert into items(id,code,name,unit,item_type,is_active,sell_price,buy_price) values({q(item)},'FICTION-GROUP-MAT-{i}','Bahan Paket Fiktif {i}','pcs','Persediaan',true,1000,0);insert into stock(warehouse_id,item_id,qty) values({q(r.WH)},{q(item)},100);insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values({q(r.WH)},{q(item)},current_date,100,100,2000,'purchase');")
            for item in [service,*inventory]:h.sql(f"insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values({q(group)},{q(item)},1,{'\'kali\'' if item==service else '\'pcs\''},1);")
            v,mr=cartmod.m.visit(h,2900); stay=h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
            initial=cartmod.read(h,v,stay)
            actual_fixture=json.loads(h.nilai(f"select jsonb_build_object('item_type',i.item_type,'is_active',i.is_active,'components',(select count(*) from item_group_components c where c.group_item_id=i.id),'visit_status',v.status,'stay_exists',exists(select 1 from inpatient_records s where s.visit_id=v.id)) from items i cross join visits v where i.id={q(group)} and v.id={q(v)}"))
            record('fictional active Grup with five components and actual admitted stay',actual_fixture['item_type']=='Grup' and actual_fixture['is_active'] and actual_fixture['components']==5 and actual_fixture['stay_exists'],actual_fixture)
            raw=list(initial['rows'])+[dict(id=r.uid('e',2910),item_id=group,nama_obat='Paket Pemeriksaan Fiktif',qty=1,harga=100000,satuan='paket',jenis='obat')]
            amount=sum(row['qty']*row['harga'] for row in raw)
            sql=cartmod.save(v,stay,initial['snapshot'],raw,[dict(method='Tunai',amount=amount)],key='fiction-group-red')
            before=fingerprint(h); err=h.gagal(sql,r.STAFF);after=fingerprint(h)
            Path(str(PREFIX)+'-group-fingerprints.json').write_text(json.dumps({'before':before,'after':after},indent=2))
            record('Raw Group remains rejected by original public cashier',bool(err and 'CART_INVALID: pilih item master aktif' in err),{'error':err,'authenticated_staff':r.STAFF,'amount':amount,'expectation':'raw Group denied; only valid expanded tagged package may save'})
            record('Group rejection has zero effects across every actual table',before==after,{'tables':len(before),'changed':[k for k in before if before[k]!=after[k]],'fingerprint_sha256':sha(json.dumps(before,sort_keys=True).encode()),'critical':{k:v for k,v in after.items() if any(s in k for s in ['invoice','receipt','request','stock','journal','prescription','pending_cart','permit'])}})
            err2=h.gagal(sql,r.STAFF)
            record('Rejected request retry remains deterministic and uncached',bool(err2 and 'CART_INVALID: pilih item master aktif' in err2) and fingerprint(h)==before,{'retry_error':err2,'cached_requests':h.nilai("select count(*) from clinic_private.inpatient_cashier_requests where request_key='fiction-group-red'")})
            recipe={'id':group,'name':'Paket Pemeriksaan Fiktif','komponen':[{'item_id':item,'name':'Komponen Fiktif '+str(i),'item_type':'Jasa' if item==service else 'Persediaan','base_unit':'kali' if item==service else 'pcs','qty':1,'unit':'kali' if item==service else 'pcs','factor':1} for i,item in enumerate([service,*inventory])]}
            js="import {pecahPaket} from "+json.dumps((root/'src/lib/paket-klinik.ts').as_uri())+"; const resep="+json.dumps(recipe)+"; console.log(JSON.stringify(pecahPaket(resep,100000,1,(id)=>id==="+json.dumps(service)+"?96000:1000)));"
            result=subprocess.run(['node','--input-type=module','-e',js],text=True,capture_output=True,check=True)
            expansion=json.loads(result.stdout);assert expansion['error'] is None
            REPORT['real_pecahPaket']=expansion
            expanded=[]
            for i,row in enumerate(expansion['baris']):expanded.append(dict(id=r.uid('e',2920+i),item_id=row['item_id'],nama_obat=row['nama'],qty=row['qty'],harga=row['harga'],satuan=row['satuan'],jenis=row['jenis'],package_item_id=group,package_qty=1))
            rows=list(initial['rows'])+expanded
            amount=sum(row['qty']*row['harga'] for row in rows)
            sql=cartmod.save(v,stay,initial['snapshot'],rows,[dict(method='Tunai',amount=amount)],key='fiction-group-expand-floor')
            before=fingerprint(h); err=h.gagal(sql,r.STAFF);after=fingerprint(h)
            Path(str(PREFIX)+'-expansion-floor-fingerprints.json').write_text(json.dumps({'before':before,'after':after},indent=2))
            record('expanded tagged five-component package SAVES with original aggregate FIFO margin',not err,{'error':err,'package_revenue':sum(row['qty']*row['harga'] for row in expanded),'fifo_hpp':8000,'allocations':[row['harga'] for row in expanded],'zero_effects_if_denied':before==after})
            assert not err, 'Required package SAVE failed: '+str(err)
            inv=h.aktif(v)
            facts=json.loads(h.nilai(f"select jsonb_build_object('tags',(select count(*) from invoice_items where invoice_id={q(inv)} and package_item_id={q(group)} and package_qty=1),'source_tags',(select count(*) from prescription_items where medical_record_id={q(mr)} and package_item_id={q(group)} and package_qty=1),'hpp',(select sum(hpp) from invoice_items where invoice_id={q(inv)}),'total',(select total from invoices where id={q(inv)}),'receipts',(select count(*) from clinic_payment_receipts where visit_id={q(v)}))"))
            record('original H05 invoice tags and durable prescription tags persist',facts['tags']==5 and facts['source_tags']==5 and facts['total']==amount and facts['hpp']==12000 and facts['receipts']==1,facts)
            issued_read=cartmod.read(h,v,stay)
            issued_lines=next(history['lines'] for history in issued_read['history'] if history['id']==inv)
            tagged_history=[line for line in issued_lines if line.get('package_item_id')==group]
            record('Cashier history returns full original invoice rows plus bound package name',len(tagged_history)==5 and all(line.get('package_name')=='Paket Pemeriksaan Fiktif' and line.get('package_qty')==1 for line in tagged_history),{'tagged_lines':len(tagged_history),'line_keys':sorted(tagged_history[0]) if tagged_history else [],'package_names':[line.get('package_name') for line in tagged_history]})
            snapshot=fingerprint(h);err=h.gagal(sql,r.STAFF)
            record('exact successful request replay changes no table',not err and fingerprint(h)==snapshot,{'error':err,'tables':len(snapshot)})
            # Further tracer bullets: never use a business substitute or role bypass.
            def fixture(n):
                visit,medical=cartmod.m.visit(h,n)
                stay=h.nilai(f'select id from inpatient_records where visit_id={q(visit)}')
                draft=cartmod.read(h,visit,stay)
                ex=copy.deepcopy(expanded)
                for ix,row in enumerate(ex):row['id']=r.uid('e',n*10+ix)
                return visit,medical,stay,draft,ex
            def deny(name,sql,user=r.STAFF,token=None):
                before=fingerprint(h);error=h.gagal(sql,user);after=fingerprint(h)
                record(name,bool(error) and (token is None or token in error) and before==after,{'error':error,'zero_effects':before==after,'tables':len(before)})
            for n,user in [(3001,r.DOCTOR),(3002,r.OWNER)]:
                vv,mm,ss,dd,ex=fixture(n);rr=dd['rows']+ex;amount2=sum(row['qty']*row['harga'] for row in rr)
                error=h.gagal(cartmod.save(vv,ss,dd['snapshot'],rr,[dict(method='Tunai',amount=amount2)],key='role-package-'+str(n)),user)
                tagged=h.angka(f'select count(*) from invoice_items l join invoices i on i.id=l.invoice_id where i.visit_id={q(vv)} and l.package_item_id={q(group)}')
                record('Actual public '+r.PERAN[user]+' aggregate-margin tagged package SAVE',not error and tagged==5,{'error':error,'tags':tagged})
            vv,mm,ss,dd,ex=fixture(3010)
            attacks=[]
            for name,modify in [
                ('incomplete',lambda rr:rr.pop()),
                ('missing-pair',lambda rr:rr[0].pop('package_qty')),
                ('incoherent-count',lambda rr:rr[0].update(package_qty=2)),
                ('forged-member',lambda rr:rr[0].update(item_id=r.ITEM)),
                ('wrong-units',lambda rr:rr[1].update(satuan='forged-unit')),
                ('wrong-kind',lambda rr:rr[0].update(jenis='obat')),
                ('duplicate-member',lambda rr:rr[1].update(item_id=service)),
                ('wrong-component-quantity',lambda rr:rr[1].update(qty=2)),
                ('aggregate-under-HPP',lambda rr:[row.update(harga=1000) for row in rr]),
                ('shortage',lambda rr:[row.update(qty=1000,package_qty=1000) for row in rr])]:
                altered=copy.deepcopy(ex);modify(altered);rr=dd['rows']+altered
                deny(name+' package rejected atomically',cartmod.save(vv,ss,dd['snapshot'],rr,[],key='package-deny-'+name))
            sql2=cartmod.save(vv,ss,dd['snapshot'],dd['rows']+ex,[],key='package-actor-deny')
            for user in [r.FIN_NONAKTIF,r.FIN_LUAR]:deny('Current inactive/foreign actor remains denied '+user,sql2,user,'ACCESS_DENIED')
            # Actual clinical writers create durable pending origin; no recipe inference.
            for n,user in [(3020,r.DOCTOR),(3021,r.STAFF),(3022,r.OWNER)]:
                fresh=r.buat_kunjungan(h,n,r.buat_pelanggan(h,n),admitted=False)
                h.sql(f"delete from prescription_items where medical_record_id={q(r.uid(7,n))};delete from medical_records where id={q(r.uid(7,n))};update visits set status='Diperiksa',service_started_at=now(),poli='Umum' where id={q(fresh)};")
                fields=dict(anamnesis='Awal Fiktif',diagnosis='Diagnosis awal',therapy='Terapi awal',suhu=38.25,berat=3,penunjang_urls=[])
                clinical=copy.deepcopy(expanded)
                for row in clinical:row.pop('id');row['faktor']=1
                initial_sql=f"select clinic_save_initial_record({q(fresh)},{q(r.uid(5,n))},{j(fields)},'[]',{j(clinical)},'[]',null,{q(r.DOKTER_PEGAWAI)},'Dokter Fiktif','Keluhan awal Fiktif',{q('initial-package-'+str(n))});"
                error=h.gagal(initial_sql,user)
                tags=h.angka(f'select count(*) from prescription_items p join medical_records m on m.id=p.medical_record_id where m.visit_id={q(fresh)} and p.package_item_id={q(group)}')
                record('Original initial-record '+r.PERAN[user]+' explicit complete package persists',not error and tags==5,{'error':error,'tags':tags})
                if not error:
                    snap=fingerprint(h);error=h.gagal(initial_sql,user)
                    record('Initial-record exact tagged replay '+r.PERAN[user],not error and snap==fingerprint(h),{'error':error})
            vv,mm,ss,dd,ex=fixture(3030)
            clinical=copy.deepcopy(ex)
            for row in clinical:row.pop('id');row['faktor']=1
            add_sql=f"select clinic_add_record_items({q(vv)},'add-package',{j(clinical)},'[]');"
            error=h.gagal(add_sql,r.DOCTOR)
            reread=cartmod.read(h,vv,ss)
            version=h.nilai(f'select clinic_outpatient_cart_version({q(vv)})',r.DOCTOR)
            tags=[row for row in reread['rows'] if row.get('package_item_id')==group]
            record('Original add-record p_items and pending reader preserve five tags',not error and len(tags)==5,{'error':error,'tags':len(tags)})
            if not error:
                # Same valid source, remove origin explicitly via original queued editor.
                rr=cartmod.m.rows(h,mm)
                for row in rr:row['package_item_id']=None;row['package_qty']=None
                edit_sql=cartmod.m.edit(vv,mm,0,rr,'remove-explicit-origin')
                error=h.gagal(edit_sql,r.DOCTOR)
                afterread=cartmod.read(h,vv,ss);version2=h.nilai(f'select clinic_outpatient_cart_version({q(vv)})',r.DOCTOR)
                record('Original queued edit persists explicit origin change bound to both cart hashes',not error and reread['snapshot']!=afterread['snapshot'] and version!=version2,{'error':error,'inpatient_changed':reread['snapshot']!=afterread['snapshot'],'outpatient_changed':version!=version2})
            # Authoritative non-base units and coherent multiple-package count.
            vv,mm,ss,dd,ex=fixture(3035)
            h.sql(f"insert into item_units(item_id,unit,factor) values({q(inventory[0])},'box2',2)")
            for row in ex:row.update(qty=2,package_qty=2)
            ex[1].update(qty=1,satuan='box2',harga=2000)
            rr=dd['rows']+ex;amount2=sum(row['qty']*row['harga'] for row in rr)
            error=h.gagal(cartmod.save(vv,ss,dd['snapshot'],rr,[dict(method='Tunai',amount=amount2)],key='two-packages-converted-unit'),r.STAFF)
            tags=h.angka(f'select count(*) from invoice_items l join invoices i on i.id=l.invoice_id where i.visit_id={q(vv)} and l.package_item_id={q(group)} and l.package_qty=2')
            record('Two coherent packages and real box2 unit persist original H05 tags',not error and tags==5,{'error':error,'tags':tags})
            # Both original daily/billable ingress write explicit metadata unchanged.
            for n,kind in [(3036,'daily-log'),(3037,'billable-entry')]:
                vv,mm,ss,dd,ex=fixture(n)
                for row in ex:row.pop('id');row['faktor']=1
                if kind=='daily-log':
                    call=f"select clinic_save_inpatient_log_with_status({q(ss)},{q(mm)},{j(dict(condition_note='Monitoring Fiktif',log_kind='monitoring'))},{j(ex)},'[]','package-daily-log',null)"
                else:call=f"select clinic_add_inpatient_billables({q(ss)},{j(ex)},'[]','Tambahan paket Fiktif','package-billable-entry')"
                error=h.gagal(call,r.STAFF)
                tags=h.angka(f'select count(*) from prescription_items where medical_record_id={q(mm)} and package_item_id={q(group)}')
                record('Original '+kind+' public ingress persists explicit five-component origin',not error and tags==5,{'error':error,'tags':tags})
            # Legacy stage path supplies no package fields; durable source restores them.
            vv,mm,ss,dd,ex=fixture(3040)
            clinical=copy.deepcopy(ex)
            for row in clinical:row.pop('id');row['faktor']=1
            h.sql(f"select clinic_add_record_items({q(vv)},'stage-add-package',{j(clinical)},'[]');",r.DOCTOR)
            dd=cartmod.read(h,vv,ss)
            lines=[dict(description=row['nama_obat'],qty=row['qty'],price=row['harga'],kind=row['jenis'],item_id=row['item_id'],unit=row['satuan'],prescription_item_id=row['id'],recipe_id=row.get('compound_recipe_id'),discount_percent=0) for row in dd['rows']]
            nominal=sum(row['qty']*row['harga'] for row in dd['rows'])
            header=dict(tanggal='2026-11-03',subtotal=nominal,discount=0,tax=0,total=nominal,dp_amount=0,dp_date=None,paid_status='Belum Lunas',metode_bayar='Tunai',shift_id=r.SHIFT[r.STAFF],voucher_code=None,salesperson_id=None,dp_override_reason=None)
            # Use real receipt first, just as the original unified engine does.
            h.sql(f"select clinic_receive_visit_payment({q(vv)},'legacy-stage-receipt','2026-11-03',{j([dict(method='Tunai',amount=nominal)])},null,null)",r.STAFF)
            stage_sql=f"select clinic_post_inpatient_stage_invoice({q(vv)},'legacy-package-stage',{j(header)},{j(lines)})"
            error=h.gagal(stage_sql,r.STAFF)
            tags=h.angka(f'select count(*) from invoice_items l join invoices i on i.id=l.invoice_id where i.visit_id={q(vv)} and l.package_item_id={q(group)}')
            record('Original legacy public stage enriches only durable source tags',not error and tags==5,{'error':error,'tags':tags})
            snap=fingerprint(h);error=h.gagal(stage_sql,r.STAFF)
            record('Legacy stage exact replay retains source tags and zero new effects',not error and snap==fingerprint(h),{'error':error})
            # Compose the new main's PR420 withdrawal trigger with durable origin.
            # Every action uses the actual authenticated public RPC and original
            # FIFO/revenue/HPP/receipt posting code, including a still-issued peer.
            def stock_state():
                return json.loads(h.nilai(f"select jsonb_build_object('qty',(select trim_scale(qty)::text from stock where warehouse_id={q(r.WH)} and item_id={q(x.MATERIAL)}),'layer_qty',(select trim_scale(sum(qty_left))::text from stock_layers where warehouse_id={q(r.WH)} and item_id={q(x.MATERIAL)}),'layer_value',(select trim_scale(sum(qty_left*unit_cost))::text from stock_layers where warehouse_id={q(r.WH)} and item_id={q(x.MATERIAL)}),'moves',(select count(*) from stock_moves where item_id={q(x.MATERIAL)}))"))
            for n,mode in [(3041,'H05-cashier'),(3042,'P03-stage')]:
                vv,mm,ss,dd,ex=fixture(n)
                version=h.nilai('select id from compound_formula_versions limit 1')
                start_stock=stock_state()
                recipes={}
                for action in ['live','return','void']:
                    issue_sql=x.issue(vv,mm,x.payload(version,f'coexist-{mode}-{action}'))
                    recipes[action]=h.nilai(issue_sql,r.DOCTOR)
                return_sql=f"select clinic_return_compound({q(recipes['return'])},'Bahan racikan fiktif dikembalikan')"
                void_sql=f"select clinic_void_compound({q(recipes['void'])})"
                h.sql(return_sql,r.DOCTOR);h.sql(void_sql,r.OWNER)
                after_return=stock_state()
                withdrawn=json.loads(h.nilai(f"select jsonb_agg(jsonb_build_object('status',c.status,'withdrawn',p.billing_withdrawn_at is not null,'actor',p.billing_withdrawn_by,'reason',p.billing_withdrawal_reason,'restored',(select count(*) from compound_issues ci where ci.recipe_id=c.id and ci.restored_at is not null)) order by c.id) from compounding_recipes c join prescription_items p on p.compound_recipe_id=c.id where c.id in ({q(recipes['return'])},{q(recipes['void'])})"))
                record(mode+' original return and void restore exactly once and PR420 withdraws both unbilled sources',len(withdrawn)==2 and all(row['status']=='void' and row['withdrawn'] and row['restored']==1 and row['actor'] in [r.DOCTOR,r.OWNER] and row['reason']=='Racikan dibatalkan; bahan dikembalikan ke stok' for row in withdrawn) and int(after_return['qty'])==int(start_stock['qty'])-2 and int(after_return['layer_qty'])==int(start_stock['layer_qty'])-2 and int(after_return['layer_value'])==int(start_stock['layer_value'])-2000,{'sources':withdrawn,'before':start_stock,'after':after_return})
                snap=fingerprint(h);h.sql(return_sql,r.DOCTOR);h.sql(void_sql,r.OWNER)
                record(mode+' exact public return and void replay is effect-free',snap==fingerprint(h),{'tables':len(snap),'stock':stock_state()})
                deny(mode+' direct authenticated withdrawal cannot forge nested PR420 exception',f"update prescription_items set billing_withdrawn_at=clock_timestamp(),billing_withdrawn_by=auth.uid(),billing_withdrawal_reason='Racikan dibatalkan; bahan dikembalikan ke stok' where compound_recipe_id={q(recipes['live'])}",r.DOCTOR,'ACCESS_DENIED: pembatalan penagihan hanya lewat revisi kasir berjejak')
                deny(mode+' returned official source price remains immutable',f"update prescription_items set harga=harga+1 where compound_recipe_id={q(recipes['return'])}",r.DOCTOR,'ACCESS_DENIED: resep tersimpan hanya diubah lewat alur klinis berjejak')
                clinical=copy.deepcopy(ex)
                for row in clinical:row.pop('id');row['faktor']=1
                h.sql(f"select clinic_add_record_items({q(vv)},{q('coexist-package-'+mode)},{j(clinical)},'[]')",r.DOCTOR)
                dd=cartmod.read(h,vv,ss)
                tagged=[row for row in dd['rows'] if row.get('package_item_id')==group]
                record(mode+' pending reader has all five canonical package tags and only live compound',len(tagged)==5 and all(row.get('package_qty')==1 for row in tagged) and [row['compound_recipe_id'] for row in dd['rows'] if row.get('compound_recipe_id')]==[recipes['live']],{'package_tags':len(tagged),'pending_recipes':[row.get('compound_recipe_id') for row in dd['rows'] if row.get('compound_recipe_id')]})
                nominal=sum(row['qty']*row['harga'] for row in dd['rows'])
                package_stock=json.loads(h.nilai(f"select jsonb_object_agg(item_id,qty) from stock where warehouse_id={q(r.WH)} and item_id in ("+','.join(q(item) for item in inventory)+')'))
                if mode=='H05-cashier':
                    post=cartmod.save(vv,ss,dd['snapshot'],dd['rows'],[dict(method='Tunai',amount=nominal)],key='coexist-'+mode)
                else:
                    lines=[dict(description=row['nama_obat'],qty=row['qty'],price=row['harga'],kind=row['jenis'],item_id=row['item_id'],unit=row['satuan'],prescription_item_id=row['id'],recipe_id=row.get('compound_recipe_id'),discount_percent=0) for row in dd['rows']]
                    header=dict(tanggal='2026-11-03',subtotal=nominal,discount=0,tax=0,total=nominal,dp_amount=0,dp_date=None,paid_status='Belum Lunas',metode_bayar='Tunai',shift_id=r.SHIFT[r.STAFF],voucher_code=None,salesperson_id=None,dp_override_reason=None)
                    h.sql(f"select clinic_receive_visit_payment({q(vv)},{q('coexist-receipt-'+mode)},'2026-11-03',{j([dict(method='Tunai',amount=nominal)])},null,null)",r.STAFF)
                    post=f"select clinic_post_inpatient_stage_invoice({q(vv)},{q('coexist-'+mode)},{j(header)},{j(lines)})"
                error=h.gagal(post,r.STAFF)
                inv=h.aktif(vv)
                facts=json.loads(h.nilai(f"select jsonb_build_object('total',(select total from invoices where id={q(inv)}),'hpp',(select sum(hpp) from invoice_items where invoice_id={q(inv)}),'tags',(select count(*) from invoice_items where invoice_id={q(inv)} and package_item_id={q(group)} and package_qty=1),'source_tags',(select count(*) from prescription_items where medical_record_id={q(mm)} and package_item_id={q(group)} and package_qty=1),'live_billed',(select count(*) from invoice_items where invoice_id={q(inv)} and compound_recipe_id={q(recipes['live'])}),'void_billed',(select count(*) from invoice_items where compound_recipe_id in ({q(recipes['return'])},{q(recipes['void'])})),'live_cost',(select sum(qty*unit_cost) from compound_issues where recipe_id={q(recipes['live'])} and posted_invoice_item_id is not null),'receipts',(select count(*) from clinic_payment_receipts where visit_id={q(vv)}),'package_stock',(select jsonb_object_agg(item_id,qty) from stock where warehouse_id={q(r.WH)} and item_id in ("+','.join(q(item) for item in inventory)+')))'))
                record(mode+' mixed package and live compound posts exact money stock HPP without cancelled billing',not error and facts['total']==nominal==450000 and facts['hpp']==14000 and facts['tags']==facts['source_tags']==5 and facts['live_billed']==1 and facts['void_billed']==0 and facts['live_cost']==2000 and facts['receipts']==1 and stock_state()==after_return and all(facts['package_stock'][item]==qty-1 for item,qty in package_stock.items()),{'error':error,'facts':facts,'compound_stock':stock_state()})
                no=h.no_tagihan(inv)
                journal={'revenue':h.saldo_ref('510002',no),'hpp':h.saldo_ref('600001',no),'ar':h.saldo_ref('150001',no)}
                record(mode+' original financial journals exact revenue HPP and settled AR',journal==dict(revenue=-450000,hpp=14000,ar=0),journal)
                snap=fingerprint(h);error=h.gagal(post,r.STAFF)
                record(mode+' composed posting exact replay preserves every original table',not error and snap==fingerprint(h),{'error':error,'tables':len(snap)})
                deny(mode+' billed live compound remains nonreturnable',f"select clinic_return_compound({q(recipes['live'])},'Ditolak setelah tagihan')",r.OWNER,'RECIPE_LINKED')
                deny(mode+' billed live compound remains nonvoidable',f"select clinic_void_compound({q(recipes['live'])})",r.OWNER,'RECIPE_LINKED')
            # Recipe changed after a real shift wait must not use stale input.
            vv,mm,ss,dd,ex=fixture(3050);barriers=[]
            with contextlib.ExitStack() as stack:
                observer=stack.enter_context(x.c.Session(h.db,'package-observer'))
                gate=stack.enter_context(x.c.Session(h.db,'package-shift-gate'))
                waiter=stack.enter_context(x.c.Session(h.db,'package-waiter'));waiter.sql(x.claims(r.STAFF))
                gate.sql(f'begin;select id from cashier_shifts where id={q(r.SHIFT[r.STAFF])} for update;')
                waiter.send('begin;'+cartmod.save(vv,ss,dd['snapshot'],dd['rows']+ex,[],key='stale-recipe-after-wait'))
                x.c.wait_block(observer,waiter,gate,barriers)
                gate.sql(f'update item_group_components set qty=2 where group_item_id={q(group)} and component_item_id={q(service)};commit;')
                outcome=x.c.attempt(waiter)
            record('Committed recipe mutation across observed shift wait rejected without invoice',not outcome['ok'] and 'PACKAGE_INVALID' in outcome.get('error','') and len(barriers)==1 and h.angka(f'select count(*) from invoices where visit_id={q(vv)}')==0,{'outcome':outcome,'barriers':barriers})
            h.sql(f'update item_group_components set qty=1 where group_item_id={q(group)} and component_item_id={q(service)}')
            # An original lifecycle writer starts with SELECT FOR UPDATE (RowShare,
            # not RowExclusive). A table-only fence must not let a later FK wait
            # reverse that writer's table upgrade. Require a fail-fast row fence.
            vv,mm,ss,dd,ex=fixture(3060)
            before=fingerprint(h)
            with contextlib.ExitStack() as stack:
                gate=stack.enter_context(x.c.Session(h.db,'package-master-row-gate'))
                waiter=stack.enter_context(x.c.Session(h.db,'package-master-row-waiter'));waiter.sql(x.claims(r.STAFF))
                gate.sql(f'begin;select id from items where id={q(group)} for update;')
                waiter.send('begin;'+cartmod.save(vv,ss,dd['snapshot'],dd['rows']+ex,[],key='master-row-failfast'))
                outcome=x.c.attempt(waiter)
                gate.sql('rollback;')
            record('Existing master FOR UPDATE fails fast before new provenance FK or lock inversion',not outcome['ok'] and '55P03' in outcome.get('error','') and 'could not obtain lock on row' in outcome.get('error','') and outcome.get('seconds_to_error',99)<1 and fingerprint(h)==before,{'outcome':outcome,'master_holder_pid':gate.pid,'zero_effects':fingerprint(h)==before})
            # Newly proposed inactive packages rejected; issued exact replay still works.
            h.sql(f"select change_master_data_lifecycle('items',{q(group)},'archive',0,'Inactive package proof')",r.OWNER)
            deny('Inactive package never silently loses origin',cartmod.save(vv,ss,dd['snapshot'],dd['rows']+ex,[],key='inactive-package'))
            h.sql(f"select change_master_data_lifecycle('items',{q(group)},'activate',1,'Restore fictional package')",r.OWNER)
            allowed={'protect_official_compound_snapshot','clinic_save_inpatient_cashier','clinic_read_inpatient_cashier','pending_cashier_rows','outpatient_cart_version','inpatient_payment_quote','clinic_post_inpatient_stage_invoice','clinic_edit_queued_record','clinic_save_initial_record','clinic_save_inpatient_log','clinic_add_inpatient_billables','clinic_add_record_items'}
            changed=REPORT['modified_functions']
            metadata_ok=all(all(before_functions[k][field]==after_functions[k][field] for field in before_functions[k] if field!='definition_md5') for k in changed)
            record('Only reviewed origin bridges change; all original metadata and other original definitions unchanged',metadata_ok and all(k.split('(')[0].split('.')[-1] in allowed for k in changed),{'modified':changed,'original_functions':len(before_functions),'metadata_unchanged':metadata_ok})
            definitions=json.loads(h.nilai("select jsonb_object_agg(p.oid::regprocedure::text,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private') and p.prokind='f';"))
            Path(str(PREFIX)+'-candidate-definitions.json').write_text(json.dumps(definitions,indent=2))
            original=json.loads(defs)
            diffs=''.join(''.join(difflib.unified_diff(original[k].splitlines(True),definitions[k].splitlines(True),fromfile=k+' original',tofile=k+' candidate')) for k in changed)
            Path(str(PREFIX)+'-function-diffs.patch').write_text(diffs)
        # Unmodified original regression runner in another disposable full cluster.
        with r.NativePostgres(args.pg_bin) as db:
            r.fixture.DisposablePostgres.bootstrap(db)
            if candidate:db.sql('begin;'+candidate.decode()+';commit;')
            cartmod.run(x.Harness(db))
            for row in cartmod.RESULTS:record('Original cashier regression: '+row['case'],row['status']=='PASS',row['detail'])
        with r.NativePostgres(args.pg_bin) as db:
            r.fixture.DisposablePostgres.bootstrap(db)
            if candidate:db.sql('begin;'+candidate.decode()+';commit;')
            cartmod.m.run(x.Harness(db))
            for row in cartmod.m.RESULTS:record('Original clinical regression: '+row['case'],row['status']=='PASS',row['detail'])
    signal.alarm(0)
if __name__=='__main__':
    code=0
    try:main()
    except BaseException as e:
        code=1;REPORT['blocker']=str(e);REPORT['traceback']=traceback.format_exc();print(REPORT['traceback'],flush=True)
    finally:
        REPORT['elapsed_seconds']=round(time.monotonic()-START,3)
        REPORT['totals']={s:sum(c['status']==s for c in REPORT['cases']) for s in ['PASS','FAIL']}
        Path(str(PREFIX)+'-native-report.json').write_text(json.dumps(REPORT,indent=2))
        print(json.dumps({'totals':REPORT['totals'],'blocker':REPORT.get('blocker'),'elapsed_seconds':REPORT['elapsed_seconds']}),flush=True)
    sys.exit(code or int(REPORT['totals']['FAIL']>0))
