#!/usr/bin/env node
// Fictional loopback acceptance: real Next forms, GoTrue, PostgREST and PostgreSQL.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'http://127.0.0.1:3112';
const CONTAINER = 'supabase_db_vetos_hris_acceptance';
const RUNTIME = '/workspace/purchase-browser-runtime';
const auth = JSON.parse(fs.readFileSync('/workspace/hris-local-runtime/local-auth.json', 'utf8'));
assert.equal(auth.API_URL, 'http://127.0.0.1:55421', 'Refuse any remote or unknown API');
fs.mkdirSync(RUNTIME, { recursive: true });
const env = { ...process.env };
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete env[key];
const sql = query => execFileSync('docker', ['--host=unix:///var/run/docker.sock','exec','-i',CONTAINER,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'], { input:query, encoding:'utf8', env }).trim();
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const pass = label => console.log('PASS:', label);
const token = randomUUID().slice(0,8);
const ids = Object.fromEntries(['branch','warehouse','item','po','line','cash'].map(name => [name, randomUUID()]));
// A future fixture avoids lazy asset depreciation in the finalized HRIS period.
const DATE = '2035-01-03';
const noPo = `FIC-PUR-${token}`;
const category = sql("select id from asset_categories where nama='Peralatan'and is_active limit 1");
const bankCode = `19${Date.now().toString().slice(-8)}`;
const assetName = `Fiction purchase machine ${token}`;
const protectedHRIS = () => sql(`select md5(jsonb_build_object(
 'payrolls',(select coalesce(jsonb_agg(to_jsonb(p)order by id),'[]')from payrolls p where periode='2026-10'),
 'runs',(select coalesce(jsonb_agg(to_jsonb(r)order by periode),'[]')from hris_payroll_runs r where periode='2026-10'),
 'events',(select coalesce(jsonb_agg(to_jsonb(e)order by id),'[]')from hris_payroll_events e where periode='2026-10'),
 'journals',(select coalesce(jsonb_agg(to_jsonb(j)order by id),'[]')from journal_entries j where source='payroll'and tanggal>='2026-10-01'and tanggal<'2026-11-01'),
 'lines',(select coalesce(jsonb_agg(to_jsonb(l)order by l.id),'[]')from journal_lines l join journal_entries j on j.id=l.entry_id where j.source='payroll'and j.tanggal>='2026-10-01'and j.tanggal<'2026-11-01')
 )::text);`);
assert.equal(sql("select count(*)from auth.users where email='owner@hris-fiction.local'"), '1', 'Requires the known fictional local auth fixture');
const hrisBefore = protectedHRIS();
sql(`begin;
 insert into coa_accounts(code,name,type,normal_balance)values('1301','Fiction purchase inventory','ASET','D'),('2101','Fiction purchase AP','LIABILITAS','K')on conflict(code)do nothing;
 insert into branches(id,code,name,type)values(${q(ids.branch)},${q('PUR-'+token)},'Fiction purchase acceptance','KLINIK');
 insert into warehouses(id,branch_id,code,name,type)values(${q(ids.warehouse)},${q(ids.branch)},${q('PW-'+token)},'Fiction purchase warehouse','VET');
 insert into items(id,code,name,unit,item_type,buy_price,is_active)values(${q(ids.item)},${q('PI-'+token)},'Fiction staged medicine','pcs','Persediaan',10,true);
 insert into item_units(item_id,unit,factor,buy_price)values(${q(ids.item)},'box',10,100);
 insert into purchase_orders(id,no_po,branch_id,to_warehouse_id,tanggal,status,total)values(${q(ids.po)},${q(noPo)},${q(ids.branch)},${q(ids.warehouse)},${q(DATE)},'Dipesan',400);
 insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor)values(${q(ids.line)},${q(ids.po)},${q(ids.item)},'Fiction staged medicine',4,100,'box',10);
 insert into coa_accounts(code,name,type,normal_balance)values(${q(bankCode)},'Fiction purchase bank','ASET','D');
 insert into cash_accounts(id,nama,jenis,coa_code,branch_id)values(${q(ids.cash)},${q('Fiction purchase bank '+token)},'Bank',${q(bankCode)},${q(ids.branch)});
 notify pgrst,'reload schema';commit;`);
pass('separate fictional purchase fixtures seeded without changing finalized HRIS rows');

const log = fs.openSync(RUNTIME+'/next.log', 'a');
const ready = await fetch(APP+'/login').then(r => r.ok).catch(() => false);
const next = ready ? null : spawn(process.execPath, [require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3112'], {
 cwd:ROOT, env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:auth.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:auth.ANON_KEY,NEXT_TELEMETRY_DISABLED:'1'}, stdio:['ignore',log,log],
});
let browser;
let page;
try {
 for (let i=0;i<180;i++) {
  if (await fetch(APP+'/login').then(r=>r.ok).catch(()=>false)) break;
  if(i===179) throw new Error('Purchase Next app did not become ready');
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 browser = await chromium.launch({headless:true,executablePath:process.env.PURCHASE_CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
 const context = await browser.newContext();
 page = await context.newPage();
 page.setDefaultTimeout(90000);
 // The test cannot send browser traffic outside loopback.
 await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.goto(APP+'/login');
 await page.locator('input[name=email]').fill('owner@hris-fiction.local');
 await page.locator('input[name=password]').fill('FictionLocalOnly123!');
 await Promise.all([page.waitForURL('**/mulai'),page.getByRole('button',{name:'Masuk',exact:true}).click()]);
 assert.ok((await context.cookies()).some(cookie=>cookie.name.includes('auth-token')), 'Real Supabase SSR login cookie');
 pass('real browser owner login through GoTrue');

 async function receiptForm(qty, surat) {
  await page.goto(`${APP}/pembelian/${ids.po}/terima`);
  const form=page.locator('form:has(input[name=rows])');
  await form.locator('input[name=request_key]').waitFor({state:'attached'});
  await page.waitForFunction(()=>!!document.querySelector('form input[name=request_key]')?.value);
  await form.locator('input[name=tanggal]').fill(DATE);
  await form.locator('input[name=surat_jalan]').fill(surat);
  await form.locator('tbody tr input[type=number]').first().fill(String(qty));
  return form;
 }
 const firstForm=await receiptForm(2,`FIC-STAGE1-${token}`);
 const firstKey=await firstForm.locator('input[name=request_key]').inputValue();
 await Promise.all([page.waitForURL('**/pembelian?success_terima=*'),firstForm.getByRole('button',{name:'Simpan penerimaan'}).click()]);
 assert.equal(sql(`select qty=20 from stock where warehouse_id=${q(ids.warehouse)}and item_id=${q(ids.item)}`),'t');
 assert.equal(sql(`select status from purchase_orders where id=${q(ids.po)}`),'Dipesan');
 assert.equal(sql(`select count(*)from goods_receipts where po_id=${q(ids.po)}`),'1');
 assert.equal(sql(`select count(*)from journal_entries where branch_id=${q(ids.branch)}and source='purchase'`),'1');
 pass('actual receipt form commits first staged 2 box = 20 base units and GRNI journal');

 const secondForm=await receiptForm(2,`FIC-STAGE2-${token}`);
 const secondKey=await secondForm.locator('input[name=request_key]').inputValue();
 assert.notEqual(secondKey, firstKey, 'Confirmed first shipment retires its request key');
 let dropped=false;
 await page.route(`${APP}/pembelian/${ids.po}/terima`,async route=>{
  if(!dropped && route.request().method()==='POST' && route.request().headers()['next-action']) {
   const response=await route.fetch();
   assert.ok(response.status()<400,`Action upstream status ${response.status()}`);
   assert.equal(sql(`select count(*)from goods_receipts where po_id=${q(ids.po)}`),'2','Commit exists before response loss');
   dropped=true;
   await route.abort('failed');
  } else await route.continue();
 });
 await secondForm.getByRole('button',{name:'Simpan penerimaan'}).click();
 await page.waitForFunction(()=>document.body.innerText.length>0);
 for(let i=0;i<100 && !dropped;i++)await new Promise(resolve=>setTimeout(resolve,100));
 assert.ok(dropped,'Dropped one real action response after server commit');
 await page.unroute(`${APP}/pembelian/${ids.po}/terima`);
 const receiptIds=sql(`select string_agg(id::text,','order by id)from goods_receipts where po_id=${q(ids.po)}`);
 await page.reload();
 await page.waitForURL('**/pembelian?error=*&recover_receipt=*');
 const recoverForm=page.locator('form:has(input[name=request_scope])');
 await page.waitForFunction(()=>!!document.querySelector('form input[name=request_key]')?.value);
 assert.equal(await recoverForm.locator('input[name=request_key]').inputValue(),secondKey,'Refresh keeps the uncertain submission key');
 await Promise.all([page.waitForURL('**/pembelian?success_terima=*&request_done=*'),recoverForm.getByRole('button',{name:'Periksa hasil transaksi terakhir'}).click()]);
 assert.equal(sql(`select string_agg(id::text,','order by id)from goods_receipts where po_id=${q(ids.po)}`),receiptIds);
 assert.equal(sql(`select qty=40 from stock where warehouse_id=${q(ids.warehouse)}and item_id=${q(ids.item)}`),'t');
 assert.equal(sql(`select count(*)from journal_entries where branch_id=${q(ids.branch)}and source='purchase'`),'2');
 assert.equal(sql(`select count(distinct source_ref)from journal_entries where branch_id=${q(ids.branch)}and source='purchase'`),'2');
 assert.equal(sql(`select count(*)from stock_layers where item_id=${q(ids.item)}and source='purchase'and source_ref=${q(noPo)}`),'2');
 assert.equal(sql(`select count(*)=2 and bool_and(debit=200 and credit=200)from(select j.id,sum(l.debit)debit,sum(l.credit)credit from journal_entries j join journal_lines l on l.entry_id=j.id where j.branch_id=${q(ids.branch)}and j.source='purchase'group by j.id)entries`),'t');
 assert.equal(sql(`select count(*)from stock_moves where item_id=${q(ids.item)}and source='purchase'`),'2');
 await page.screenshot({path:RUNTIME+'/receipt-recovered.png',fullPage:true});
 pass('lost real action response → refresh → read-only recovery preserves receipt IDs, stock and two distinct journals');

 await page.goto(APP+'/pembelian/faktur/baru');
 const invoiceForm=page.locator('form:has(input[name=items])');
 await invoiceForm.locator('select').selectOption(ids.po);
 await invoiceForm.locator('input[name=tanggal]').fill(DATE);
 await invoiceForm.locator('input[name=jatuh_tempo]').fill('2035-02-03');
 await invoiceForm.locator('input[name=no_faktur_pemasok]').fill(`FIC-SUP-${token}`);
 await invoiceForm.locator('input[title="Qty faktur dalam box"]').fill('1');
 await invoiceForm.locator('input[title="Harga faktur per box"]').fill('120');
 const invoiceKey=await invoiceForm.locator('input[name=request_key]').inputValue();
 await Promise.all([page.waitForURL('**/pembelian/faktur?success=*'),invoiceForm.getByRole('button',{name:'Simpan faktur'}).click()]);
 assert.equal(sql(`select count(*)from purchase_invoices where po_id=${q(ids.po)}`),'1');
 assert.equal(sql(`select total=120 from purchase_invoices where po_id=${q(ids.po)}`),'t');
 assert.equal(sql(`select sum(qty*faktor)=10 from purchase_invoice_items where po_item_id=${q(ids.line)}`),'t');
 assert.equal(sql(`select sum(qty_left)=10 from stock_layers where item_id=${q(ids.item)}and unit_cost=12`),'t');
 assert.equal(sql(`select qty=40 from stock where item_id=${q(ids.item)}`),'t');
 assert.equal(sql(`select sum(case when a.code='2102'then l.debit else 0 end)=100 and sum(case when a.code='2101'then l.credit else 0 end)=120 and sum(l.debit)=sum(l.credit)from journal_entries j join journal_lines l on l.entry_id=j.id join coa_accounts a on a.id=l.account_id where j.branch_id=${q(ids.branch)}and j.source='purchase-invoice'`),'t');
 pass('actual partial invoice form → real PostgREST atomically splits/reprices 10 received base units');

 await page.goto(APP+'/keuangan/aset');
 const assetForm=page.locator('form:has(input[name=request_scope][value=asset])');
 await assetForm.locator('input[name=nama]').fill(assetName);
 await assetForm.locator('input[name=tanggal]').fill(DATE);
 await assetForm.locator('select[name=category_id]').selectOption(category);
 await assetForm.locator('input[name=harga]').fill('1250');
 await assetForm.locator('input[name=nilai_sisa]').fill('50');
 await assetForm.locator('select[name=sumber]').selectOption('Bank');
 await assetForm.locator('select[name=account_id]').selectOption(ids.cash);
 await assetForm.locator('select[name=branch_id]').selectOption(ids.branch);
 const assetKey=await assetForm.locator('input[name=request_key]').inputValue();
 await Promise.all([page.waitForURL('**/keuangan/aset?success=pembelian*'),assetForm.getByRole('button',{name:/Simpan|Catat|Tambah/}).click()]);
 assert.equal(sql(`select count(*)from fixed_assets where nama=${q(assetName)}`),'1');
 const assetId=sql(`select id from fixed_assets where nama=${q(assetName)}`);
 assert.equal(sql(`select count(*)from journal_entries where source='asset-purchase'and source_ref=${q(assetId)}`),'1');
 assert.equal(sql(`select l.credit=1250 from journal_lines l join journal_entries j on j.id=l.entry_id join coa_accounts a on a.id=l.account_id where j.source='asset-purchase'and j.source_ref=${q(assetId)}and a.code=${q(bankCode)}`),'t');
 assert.equal(sql(`select sum(l.debit)=1250 and sum(l.credit)=1250 and sum(case when a.code='1501'then l.debit else 0 end)=1250 from journal_lines l join journal_entries j on j.id=l.entry_id join coa_accounts a on a.id=l.account_id where j.source='asset-purchase'and j.source_ref=${q(assetId)}`),'t');
 await page.waitForFunction(old=>document.querySelector('form input[name=request_scope][value=asset]')?.parentElement.querySelector('input[name=request_key]')?.value!==old,assetKey);
 await page.screenshot({path:RUNTIME+'/asset-purchased.png',fullPage:true});
 pass('actual bank asset form saves one asset, balanced mapped-bank journal and rotates same-page request key');
 assert.equal(protectedHRIS(),hrisBefore,'Finalized October HRIS snapshot and payroll journals unchanged');
 fs.writeFileSync(RUNTIME+'/result.json',JSON.stringify({app:APP,api:auth.API_URL,fixtureDate:DATE,ids,noPo,receiptIds,assetId,requestKeys:{firstKey,secondKey,invoiceKey,assetKey},hrisProtectedHash:hrisBefore},null,2));
 pass('finalized HRIS snapshot and payroll journals remain byte-equivalent');
 await context.close();
} catch (error) {
 if(page) {
  await page.screenshot({path:RUNTIME+'/failure.png',fullPage:true}).catch(()=>{});
  fs.writeFileSync(RUNTIME+'/failure-page.txt',await page.locator('body').innerText().catch(()=>''));
 }
 throw error;
} finally {
 await browser?.close();next?.kill('SIGTERM');fs.closeSync(log);
}
