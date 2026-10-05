// Local-only test using schema definitions and fictional fixtures; never connects to production.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const {PGlite} = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
if (!process.env.LOCAL_SCHEMA_SQL) throw new Error('LOCAL_SCHEMA_SQL must point to schema-only SQL for an isolated local database');
const db=new PGlite();
try {
 await db.exec(await fs.readFile(process.env.LOCAL_SCHEMA_SQL,'utf8'));
 const fixture=await fs.readFile('supabase/tests/clinic_invoice_post.sql','utf8');
 await db.exec(fixture.slice(fixture.indexOf('insert into auth.users'),fixture.indexOf('do $$\nbegin\n  if not has_function_privilege')));
 await db.exec(`insert into profiles(id,full_name,role) values ('d1000000-0000-4000-8000-000000000001','Fiction Doctor','DOCTOR'); update visits set service_started_at=now(), service_finished_at=now(), status='Pembayaran'; select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',false),set_config('request.jwt.claim.role','authenticated',false);`);
 await db.exec(await fs.readFile('supabase/migrations/20261005090000_clinic_split_payment.sql','utf8'));
 await db.exec(await fs.readFile('supabase/migrations/20261005091000_clinic_required_fields.sql','utf8'));
 const invoice={tanggal:'2026-10-05',subtotal:200,discount:0,tax:0,total:200,dp_amount:0,paid_status:'Lunas',metode_bayar:'Tunai',shift_id:'da000000-0000-4000-8000-000000000001'};
 const lines=[{description:'Obat Unit',qty:2,price:100,kind:'obat',item_id:'d8000000-0000-4000-8000-000000000001',unit:'strip',prescription_item_id:'d9000000-0000-4000-8000-000000000001',recipe_id:null,discount_percent:0}];
 const parts=[{method:'Tunai',amount:100,kas_code:'1101'},{method:'Transfer',amount:100,kas_code:'1101'}];
 const call=(key,p=parts)=>db.query('select clinic_post_split_invoice($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) id',['d6000000-0000-4000-8000-000000000001',key,JSON.stringify(invoice),JSON.stringify(lines),JSON.stringify(p)]);
 const state=async()=> (await db.query(`select jsonb_build_object('invoices',(select count(*) from invoices),'payments',(select count(*) from invoice_payments),'journals',(select count(*) from journal_entries),'stock',(select qty from stock where item_id='d8000000-0000-4000-8000-000000000001')) s`)).rows[0].s;
 const initial=await state();
 await assert.rejects(call('bad-account',[parts[0],{...parts[1],kas_code:'9999'}]),/ACCOUNT_INVALID/); assert.deepEqual(await state(),initial);
 const result=(await call('real-split')).rows[0].id;
 assert.deepEqual(await state(),{invoices:1,payments:2,journals:4,stock:10});
 assert.equal((await call('real-split')).rows[0].id,result);
 const posted=await state(); await assert.rejects(call('real-split',[{...parts[0],amount:90},{...parts[1],amount:110}]),/IDEMPOTENCY_CONFLICT/); assert.deepEqual(await state(),posted);
 assert.equal(Number((await db.query('select count(*) n from invoice_payments where checkout_payment')).rows[0].n),2);
 const ledger=(await db.query('select sum(debit) debit,sum(credit) credit from journal_lines')).rows[0]; assert.equal(ledger.debit,ledger.credit);
 const reissue=(await db.query('select clinic_void_reissue_invoice($1,$2,$3) id',[result,'real-reissue','Fiction correction'])).rows[0].id;
 assert.equal(Number((await db.query('select count(*) n from invoice_payments where invoice_id=$1 and checkout_payment',[reissue])).rows[0].n),2);
 assert.equal((await state()).stock,posted.stock,'reissue must not deduct stock again');
 console.log(JSON.stringify({passed:true,source:'production schema definitions only, fictional local data',realInvoiceStockJournals:true,secondPaymentRollback:true,retry:true,reissueCheckoutProvenance:true,productionMutations:false,limits:'No RLS triggers or concurrent sessions in adapted PGlite'}));
} catch(e) { console.error(e.message);process.exitCode=1; } finally { await db.close(); }
