// Schema definitions only; adapted local PostgreSQL engine and fictional data.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
if(!process.env.LOCAL_SCHEMA_SQL || !process.env.LOCAL_COMPOUND_FUNCTIONS)throw Error('Provide schema-only local SQL and compound function JSON');
const db=new PGlite();
const actor='d1000000-0000-4000-8000-000000000002',visit='d6000000-0000-4000-8000-000000000001',medical='d7000000-0000-4000-8000-000000000001';
const sku='d8000000-0000-4000-8000-000000000006',ingredient='d8000000-0000-4000-8000-000000000002',branch='d2000000-0000-4000-8000-000000000001',warehouse='d3000000-0000-4000-8000-000000000001';
try{
 await db.exec(await fs.readFile(process.env.LOCAL_SCHEMA_SQL,'utf8'));
 await db.exec('create schema clinic_private;');
 for(const f of JSON.parse(await fs.readFile(process.env.LOCAL_COMPOUND_FUNCTIONS,'utf8')))await db.exec(f.definition+';');
 const fixture=await fs.readFile('supabase/tests/clinic_invoice_post.sql','utf8');await db.exec(fixture.slice(fixture.indexOf('insert into auth.users'),fixture.indexOf('do $$\nbegin\n  if not has_function_privilege')));
 await db.exec(`insert into profiles(id,full_name,role) values('${actor}','Fiction Owner','OWNER');
 insert into item_categories(id,name) values('d9000000-0000-4000-8000-000000000006','Obat Racik');
 insert into items(id,code,name,unit,sell_price,buy_price,item_type,is_active,is_compound_material,category_id) values('${sku}','FIC-SKU','Fiction Master Compound','pcs',900,5,'Persediaan',true,false,'d9000000-0000-4000-8000-000000000006');
 insert into item_branch_prices(item_id,branch_id,unit,sell_price) values('${sku}','${branch}','pcs',1200);
 insert into stock(warehouse_id,item_id,qty) values('${warehouse}','${sku}',7);
 update visits set service_started_at=now(),service_finished_at=now(),status='Pembayaran';update cashier_shifts set opened_by='${actor}';
 select set_config('request.jwt.claim.sub','${actor}',false),set_config('request.jwt.claims','{"role":"authenticated"}',false),set_config('request.jwt.claim.role','authenticated',false);
 create trigger link_compound after insert on compounding_recipes for each row execute function link_compound_recipe_to_prescription();
 create trigger official_prescription_snapshot before insert or update or delete on prescription_items for each row execute function protect_official_compound_snapshot();`);

 const inpatient='dc000000-0000-4000-8000-000000000001',doctor='dc000000-0000-4000-8000-000000000002',paramedic='dc000000-0000-4000-8000-000000000003',groomer='dc000000-0000-4000-8000-000000000004';
 await db.query("insert into employees(id,nama,jabatan,branch_id,status) values($1,'Fiction Doctor','DR HEWAN',$4,'Aktif'),($2,'Fiction Nurse','Perawat',$4,'Aktif'),($3,'Fiction Groomer','Groomer',$4,'Aktif')",[doctor,paramedic,groomer,branch]);
 await db.query("update visits set doctor_id=$1,dokter='Fiction Doctor' where id=$2",[doctor,visit]);
 await db.query("insert into inpatient_records(id,visit_id,branch_id,medical_record_id,doctor_name) values($1,$2,$3,$4,'Historical PJ')",[inpatient,visit,branch,medical]);
 for(const f of JSON.parse(await fs.readFile(process.env.LOCAL_CARE_FUNCTIONS,'utf8')))await db.exec(f.definition+';');
 const call=(key,log,rows=[])=>db.query('select clinic_save_inpatient_log($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6) id',[inpatient,medical,JSON.stringify(log),JSON.stringify(rows),'[]',key]);
 const base={condition_note:'Fiction monitoring',log_kind:'doctor_visit'};
 if(process.env.EXPECT_PROVIDER_RED){
  const id='dc000000-0000-4000-8000-000000000099';
  await db.query("insert into employees(id,nama,jabatan,branch_id,status) values($1,'Secondary performer','Perawat','d2000000-0000-4000-8000-000000000002','Aktif')",[id]);
  await db.query("insert into employee_branch_assignments(employee_id,branch_id,role,effective_date) values($1,$2,'SECONDARY',current_date-1)",[id,branch]);
  await db.query("select set_visit_service_state($1,'provider',$2)",[visit,id]);
 }
 if(process.env.EXPECT_CARE_RED){await assert.rejects(call('red',base),/CARE_INVALID/);}
 await db.exec(await fs.readFile('supabase/migrations/20261006090000_inpatient_care_staff.sql','utf8'));
 await db.exec('set role authenticated');
 const state=async()=>(await db.query("select jsonb_build_object(\'logs\',(select count(*) from inpatient_daily_logs),\'prescriptions\',(select count(*) from prescription_items),\'edits\',(select count(*) from inpatient_daily_log_edits)) state")).rows[0].state;
 const newInpatient='dc000000-0000-4000-8000-000000000010';
 await db.query("insert into inpatient_records(id,visit_id,branch_id,doctor_name) values($1,$2,$3,'Forged PJ')",[newInpatient,visit,branch]);
 const newPJ=(await db.query('select doctor_id,doctor_name from inpatient_records where id=$1',[newInpatient])).rows[0];assert.equal(newPJ.doctor_id,doctor);assert.equal(newPJ.doctor_name,'Fiction Doctor');
 const secondary='dc000000-0000-4000-8000-000000000005',otherBranch='d2000000-0000-4000-8000-000000000002';
 await db.query("insert into employees(id,nama,jabatan,branch_id,status) values($1,'Fiction Secondary Doctor','Dokter',$2,'Aktif')",[secondary,otherBranch]);
 await assert.rejects(call('unassigned',{...base,visit_doctor_id:secondary}),/CARE_INVALID/);
 await db.query("insert into employee_branch_assignments(employee_id,branch_id,role,effective_date) values($1,$2,'SECONDARY',current_date+10)",[secondary,branch]);
 await assert.rejects(call('future-assigned',{...base,visit_doctor_id:secondary}),/CARE_INVALID/);
 await db.query('update employee_branch_assignments set effective_date=current_date-1 where employee_id=$1',[secondary]);
 await call('secondary-good',{...base,visit_doctor_id:secondary});
 await db.query("select set_visit_service_state($1,'provider',$2)",[visit,secondary]);
 assert.equal((await db.query('select service_provider_id from visits where id=$1',[visit])).rows[0].service_provider_id,secondary);
 await db.query('update employee_branch_assignments set effective_date=current_date+10 where employee_id=$1',[secondary]);
 await assert.rejects(db.query("select set_visit_service_state($1,'provider',$2)",[visit,secondary]),/Pelaksana tidak aktif/);
 await db.query('update employee_branch_assignments set effective_date=current_date-1 where employee_id=$1',[secondary]);
 await db.exec('reset role');await db.query('update profiles set is_active=false where id=$1',[actor]);await assert.rejects(call('inactive-user',{condition_note:'Fiction condition',log_kind:'monitoring'}),/ACCESS_DENIED/);await db.query('update profiles set is_active=true where id=$1',[actor]);await db.exec('set role authenticated');
 const before=await state();await assert.rejects(call('no-doctor',base),/CARE_INVALID/);assert.deepEqual(await state(),before);
 await assert.rejects(call('wrong-role',{...base,visit_doctor_id:groomer}),/CARE_INVALID/);assert.deepEqual(await state(),before);
 await assert.rejects(call('space',{condition_note:'   ',log_kind:'monitoring'}),/LOG_INVALID/);assert.deepEqual(await state(),before);
 const id=(await call('good',{...base,visit_doctor_id:doctor,paramedic_id:paramedic,doctor_name:'Forged doctor',paramedic_name:'Forged nurse'})).rows[0].id;
 const saved=(await db.query('select * from inpatient_daily_logs where id=$1',[id])).rows[0];assert.equal(saved.doctor_name,'Fiction Doctor');assert.equal(saved.paramedic_name,'Fiction Nurse');assert.equal(saved.visit_doctor_id,doctor);assert.equal(saved.paramedic_id,paramedic);
 assert.equal((await call('good',{...base,visit_doctor_id:doctor,paramedic_id:paramedic,doctor_name:'Forged doctor',paramedic_name:'Forged nurse'})).rows[0].id,id);
 const beforeBadMaterial=await state();await assert.rejects(call('bad-material',{...base,visit_doctor_id:doctor},[{nama_obat:'Invalid medicine',item_id:ingredient,qty:'invalid',harga:1,satuan:'gram',faktor:1,jenis:'obat'}]),/invalid input/);assert.deepEqual(await state(),beforeBadMaterial,'log and prescriptions roll back together');
 const monitoring=(await call('monitoring',{condition_note:'Fiction stable',log_kind:'monitoring',paramedic_id:paramedic})).rows[0].id;
 assert.equal((await db.query('select doctor_name from inpatient_daily_logs where id=$1',[monitoring])).rows[0].doctor_name,null);
 const pj=(await db.query('select doctor_name,doctor_id from inpatient_records where id=$1',[inpatient])).rows[0];assert.equal(pj.doctor_name,'Historical PJ');assert.equal(pj.doctor_id,null,'historical identities are not guessed');
 await assert.rejects(db.query("update inpatient_records set doctor_name=\'Changed PJ\' where id=$1",[inpatient]),/CARE_INVALID/);
 await db.query("update employees set status='Nonaktif' where id=$1",[doctor]);
 await assert.rejects(call('inactive-doctor',{...base,visit_doctor_id:doctor}),/CARE_INVALID/);
 await db.query('select clinic_update_inpatient_log($1,$2,$3::jsonb,$4)',[inpatient,id,JSON.stringify({condition_note:'Corrected condition',log_kind:'doctor_visit',visit_doctor_id:doctor,paramedic_id:paramedic}),'Fiction correction']);
 const edit=(await db.query('select * from inpatient_daily_log_edits where log_id=$1',[id])).rows[0];assert.equal(edit.before.condition_note,base.condition_note);assert.equal(edit.before.visit_doctor_id,doctor);assert.equal(edit.alasan,'Fiction correction');
 const preEdit=await state();await db.exec('reset role');await db.exec("create function reject_care_audit() returns trigger language plpgsql as $$begin raise exception 'INJECTED_AUDIT_FAIL';end;$$;create trigger reject_care_audit before insert on inpatient_daily_log_edits for each row execute function reject_care_audit();");await db.exec('set role authenticated');
 await assert.rejects(db.query('select clinic_update_inpatient_log($1,$2,$3::jsonb,$4)',[inpatient,id,JSON.stringify({condition_note:'Must roll back',log_kind:'doctor_visit',visit_doctor_id:doctor,paramedic_id:paramedic}),'Fiction failure']),/INJECTED_AUDIT_FAIL/);assert.deepEqual(await state(),preEdit);assert.equal((await db.query('select condition_note from inpatient_daily_logs where id=$1',[id])).rows[0].condition_note,'Corrected condition');
 await db.exec('reset role');await db.exec('drop trigger reject_care_audit on inpatient_daily_log_edits');await db.exec('set role authenticated');
 await db.query('update inpatient_records set discharged_at=now() where id=$1',[inpatient]);
 await assert.rejects(call('closed',{condition_note:'Closed',log_kind:'monitoring'}),/CARE_INVALID/);
 await assert.rejects(db.query('select clinic_update_inpatient_log($1,$2,$3::jsonb,$4)',[inpatient,id,JSON.stringify({condition_note:'Closed edit'}),null]),/CARE_INVALID/);
 console.log(JSON.stringify({passed:true,masterRoles:true,doctorRequired:true,monitoringWithoutDoctor:true,preservedPJ:true,preservedInactiveSnapshots:true,atomicAuditRollback:true,retry:true,closedDenied:true,productionMutations:false}));
}finally{await db.close()}
