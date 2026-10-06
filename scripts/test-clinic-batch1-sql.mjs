// Isolated PostgreSQL/PGlite checks. Core invoice/stock and service-state routines
// are test doubles; receipt and new Batch 1 RPCs use real repository SQL.
// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-clinic-batch1-sql.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const actor='a1000000-0000-4000-8000-000000000001';
const branch='a2000000-0000-4000-8000-000000000001';
const visit='a6000000-0000-4000-8000-000000000001';
const pet='a5000000-0000-4000-8000-000000000001';
const doctor='a7000000-0000-4000-8000-000000000001';
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create table visits(id uuid primary key,branch_id uuid,pet_id uuid,poli text,status text,dokter text,doctor_id uuid,keluhan text,service_started_at timestamptz,service_finished_at timestamptz,checked_out_at timestamptz);
create function public.user_can_access_branch(b uuid) returns boolean language sql as $$select b='${branch}'::uuid$$;
create table invoices(id uuid primary key default gen_random_uuid(),visit_id uuid,invoice_no text,total numeric,dp_amount numeric,paid_status text,paid_at timestamptz,voided_at timestamptz,correction_pending boolean default false,request_key text unique,request_hash text);
create table invoice_payments(id uuid primary key default gen_random_uuid(),invoice_id uuid,tanggal date,amount numeric,metode text,catatan text,kas_code text,created_by uuid,request_key text unique,request_hash text);
create table cash_accounts(coa_code text,is_active boolean,branch_id uuid);
create table coa_accounts(code text,is_active boolean,is_header boolean);
insert into cash_accounts values('1101',true,null),('1102',true,null);
insert into coa_accounts values('1101',true,false),('1102',true,false);
create table test_journals(id serial primary key,source text,ref text,lines jsonb);
create function clinic_write_journal(d date,description text,s text,r text,b uuid,l jsonb) returns uuid language plpgsql set search_path=public as $$begin insert into test_journals(source,ref,lines) values(s,r,l); return gen_random_uuid(); end$$;
create table clinic_invoice_operations(request_key text,invoice_id uuid,request_hash text,kind text,result_invoice_id uuid);
create table test_stock(qty integer); insert into test_stock values(10);
create function clinic_post_invoice(v uuid,k text,i jsonb,l jsonb) returns uuid language plpgsql set search_path=public as $$declare found_invoice invoices%rowtype; result uuid; h text;begin
h:=md5(jsonb_build_object('invoice',i,'lines',l)::text);select * into found_invoice from invoices where request_key=k;
if found then if found_invoice.request_hash<>h or found_invoice.visit_id<>v then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT: invoice';end if;return found_invoice.id;end if;
insert into invoices(visit_id,invoice_no,total,dp_amount,paid_status,request_key,request_hash) values(v,'INV-'||k,(i->>'total')::numeric,0,i->>'paid_status',k,h) returning id into result;
update test_stock set qty=qty-1;
perform clinic_write_journal(current_date,'test','klinik','INV-'||k,null,jsonb_build_array(jsonb_build_object('code','1201','debit',(i->>'total')::numeric,'credit',0),jsonb_build_object('code','4101','credit',(i->>'total')::numeric,'debit',0)));
return result;end$$;
create function set_visit_service_state(v uuid,a text,p uuid default null) returns void language plpgsql set search_path=public as $$begin
if a='checkout' then update visits set checked_out_at=now(),status='Selesai' where id=v;
elsif a='finish' then update visits set service_finished_at=now(),status='Pembayaran' where id=v;end if;end$$;
insert into visits values('${visit}','${branch}','${pet}','Poli Umum','Diperiksa',null,null,null,now(),null,null);
select set_config('request.jwt.claim.sub','${actor}',false),set_config('request.jwt.claim.role','authenticated',false);
`);
const billing = await fs.readFile('supabase/migrations/20260929120000_clinic_billing_lifecycle.sql','utf8');
await db.exec(billing.slice(billing.indexOf('create function public.clinic_receive_invoice_payment('),billing.indexOf('-- One status change')).replaceAll("current_setting('request.jwt.claim.role', true)",'auth.role()'));
const invoice={tanggal:'2026-10-05',subtotal:1000000,discount:0,tax:0,total:1000000,dp_amount:0,paid_status:'Lunas',metode_bayar:'Tunai'};
const parts=[{method:'Tunai',amount:500000,kas_code:'1101'},{method:'Transfer',amount:500000,kas_code:'1102'}];
const call=(key,p=parts,v=visit)=>db.query('select clinic_post_split_invoice($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) id',[v,key,JSON.stringify(invoice),'[]',JSON.stringify(p)]);
await assert.rejects(call('missing'),/does not exist/); // RED: missing Batch 1 RPC
await db.exec(await fs.readFile('supabase/migrations/20261005090000_clinic_split_payment.sql','utf8'));
const state=async()=> (await db.query(`select jsonb_build_object('invoices',(select count(*) from invoices),'payments',(select count(*) from invoice_payments),'journals',(select count(*) from test_journals),'stock',(select qty from test_stock)) s`)).rows[0].s;
const original=await state();
await assert.rejects(call('bad-total',[parts[0],{...parts[1],amount:499999}]),/PAYMENT_INVALID/);
assert.deepEqual(await state(),original);
await assert.rejects(call('bad-account',[parts[0],{...parts[1],kas_code:'9999'}]),/ACCOUNT_INVALID/);
assert.deepEqual(await state(),original,'second receipt failure must roll back invoice, first receipt, journals and stock');
const result=await call('complete');
assert.deepEqual(await state(),{invoices:1,payments:2,journals:3,stock:9});
assert.equal((await db.query('select paid_status from invoices')).rows[0].paid_status,'Lunas');
assert.equal((await db.query('select status from visits')).rows[0].status,'Selesai');
const ledger=(await db.query("select sum((l->>'debit')::numeric) debit,sum((l->>'credit')::numeric) credit from test_journals cross join lateral jsonb_array_elements(lines) l")).rows[0];
assert.equal(Number(ledger.debit),2000000);assert.equal(Number(ledger.credit),2000000);
await db.exec("select set_config('request.jwt.claim.role','',false),set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false)");
assert.equal((await call('complete')).rows[0].id,result.rows[0].id,'claims-only authenticated retry must work');
await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
const committed=await state();
assert.equal((await call('complete')).rows[0].id,result.rows[0].id);assert.deepEqual(await state(),committed);
await assert.rejects(call('complete',[{...parts[0],amount:400000},{...parts[1],amount:600000}]),/IDEMPOTENCY_CONFLICT/);assert.deepEqual(await state(),committed);
await db.exec("select set_config('request.jwt.claim.role','anon',false)");await assert.rejects(call('anon'),/ACCESS_DENIED/);await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
assert.equal((await db.query("select has_function_privilege('anon','clinic_post_split_invoice(uuid,text,jsonb,jsonb,jsonb)','execute') allowed")).rows[0].allowed,false);
await db.exec(`
create table medical_records(id uuid primary key default gen_random_uuid(),visit_id uuid,diagnosis text,anamnesis text,suhu numeric,berat numeric,gejala_klinis text,hasil_penunjang text,follow_up text,catatan_resep text,penunjang_urls text[],submission_key text unique,submission_hash text,submitted_by uuid);
create table pets(id uuid primary key,customer_id uuid,weight numeric);insert into pets values('${pet}',null,null);
create table employees(id uuid primary key,nama text,jabatan text,status text,branch_id uuid);insert into employees values('${doctor}','Drh. Fiction','Dokter','Aktif','${branch}');
create table employee_branch_assignments(employee_id uuid,branch_id uuid);
update visits set service_finished_at=null,checked_out_at=null,status='Diperiksa';
`);
await db.exec(await fs.readFile('supabase/migrations/20261005091000_clinic_required_fields.sql','utf8'));
const record=(d,complaint,key='record')=>db.query('select clinic_save_initial_record($1,$2,$3::jsonb,$4::jsonb,$4::jsonb,$4::jsonb,null,$5,$6,$7,$8) id',[visit,pet,'{}','[]',d,'Drh. Fiction',complaint,key]);
await assert.rejects(record(null,'Batuk'),/DOCTOR_REQUIRED/);
await assert.rejects(record(doctor,'   '),/COMPLAINT_REQUIRED/);
await db.exec(`update employees set branch_id=gen_random_uuid()`);await assert.rejects(record(doctor,'Batuk'),/DOCTOR_REQUIRED/);
await db.exec(`update employees set branch_id='${branch}',nama='Fiction Staff',jabatan='Admin'`);await assert.rejects(record(doctor,'Batuk'),/DOCTOR_REQUIRED/);
assert.equal(Number((await db.query('select count(*) n from medical_records')).rows[0].n),0);
await db.exec(`update employees set nama='Drh. Fiction',jabatan='Dokter'`);
await db.exec("select set_config('request.jwt.claim.role','',false),set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false)");
const saved=await record(doctor,'Batuk');assert.equal((await record(doctor,'Batuk')).rows[0].id,saved.rows[0].id);
await db.exec("delete from medical_records; update visits set poli='Grooming',service_finished_at=null");await record(null,null,'grooming');
console.log(JSON.stringify({passed:true,splitRollback:true,splitRetry:true,changedPayloadRejected:true,balancedReceiptJournals:true,anonymousRejected:true,requiredClinicalFields:true,branchDoctorEligibility:true,groomingException:true,engine:'isolated PGlite/PostgreSQL',coreInvoiceStockStubbed:true,productionMutations:false}));
await db.close();
