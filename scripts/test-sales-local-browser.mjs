#!/usr/bin/env node
// Fictional LOCAL acceptance with real GoTrue/PostgREST, SSR cookies and Chromium.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const require=createRequire(import.meta.url);
const {createClient}=require('@supabase/supabase-js');
const {chromium}=require('playwright');
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const APP='http://127.0.0.1:3111';
const DB='supabase_db_vetos_hris_acceptance';
const status=JSON.parse(fs.readFileSync('/workspace/hris-local-runtime/local-auth.json','utf8'));
assert.equal(status.API_URL,'http://127.0.0.1:55421','Refuse an unknown or remote API');
const API=status.API_URL;
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(API,status.SERVICE_ROLE_KEY,options);
const actor=createClient(API,status.ANON_KEY,options);
const token=randomUUID().slice(0,8);
const output=`/tmp/vetos-sales-browser-${token}`;
fs.mkdirSync(output);
const ids=Object.fromEntries(['branch','warehouse','customer','item','order','line'].map(key=>[key,randomUUID()]));
const email=`sales-${token}@fiction-sales.local`,password='FictionSalesOnly123!';
const env={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const sql=source=>execFileSync('docker',['--host=unix:///var/run/docker.sock','exec','-i',DB,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'],{input:source,encoding:'utf8',env}).trim();
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const value=(result,label)=>{assert.equal(result.error,null,`${label}: ${result.error?.message??''}`);return result.data;};
const pass=label=>console.log('PASS:',label);
const log=fs.openSync(output+'/next.log','a');
let next,browser,context;
const counts=()=>JSON.parse(sql(`select json_build_object(
'deliveries',(select count(*)from sales_deliveries where order_id=${q(ids.order)}),
'invoices',(select count(*)from sales_invoices where order_id=${q(ids.order)}),
'moves',(select count(*)from stock_moves where warehouse_id=${q(ids.warehouse)}and source='sales-delivery'),
'journals',(select count(*)from journal_entries where branch_id=${q(ids.branch)}and source in('sales-delivery','sales-invoice')),
'allocations',(select count(*)from sales_invoice_delivery_allocations a join sales_invoice_items ii on ii.id=a.invoice_item_id join sales_invoices i on i.id=ii.invoice_id where i.order_id=${q(ids.order)}),
'stock',(select qty from stock where warehouse_id=${q(ids.warehouse)}and item_id=${q(ids.item)}))`));
try{
  assert.equal(sql("select exists(select 1 from pg_proc where proname='sales_get_posting_result')"),'t','Apply committed sales migration first');
  const user=value(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:`Fiction sales ${token}`}}),'Create fictional auth user').user;
  value(await admin.from('profiles').update({role:'OWNER',is_active:true}).eq('id',user.id),'Set fictional actor role');
  const session=value(await actor.auth.signInWithPassword({email,password}),'Authenticate fictional actor').session;
  sql(`insert into branches(id,code,name,type)values(${q(ids.branch)},'FSALE-${token}','Fiction sales ${token}','PETSHOP');
insert into warehouses(id,branch_id,code,name,type)values(${q(ids.warehouse)},${q(ids.branch)},'FSALE-W-${token}','Fiction sales warehouse','RETAIL');
insert into customers(id,name,phone)values(${q(ids.customer)},'Fiction sales customer','FSALE-${token}');
insert into items(id,code,name,unit,buy_price,sell_price,item_type)values(${q(ids.item)},'FSALE-I-${token}','Fiction sales pcs','pcs',2,10,'Persediaan');
insert into stock(warehouse_id,item_id,qty)values(${q(ids.warehouse)},${q(ids.item)},40);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)values(${q(ids.warehouse)},${q(ids.item)},'2035-01-01',40,40,2,'purchase');
insert into sales_orders(id,no_pesanan,customer_id,branch_id,warehouse_id,tanggal,total)values(${q(ids.order)},'SO.FSALE.${token}',${q(ids.customer)},${q(ids.branch)},${q(ids.warehouse)},'2035-01-10',200);
insert into sales_order_items(id,order_id,item_id,nama,satuan,faktor,qty,harga)values(${q(ids.line)},${q(ids.order)},${q(ids.item)},'Fiction sales pcs','pcs',1,20,10);
insert into coa_accounts(code,name,type,normal_balance,is_active,is_header)values
('1201','Piutang','ASET','D',true,false),('1301','Persediaan','ASET','D',true,false),('4101','Penjualan','PENDAPATAN','K',true,false),('5101','HPP','BEBAN','D',true,false),('2201','PPN Keluaran','LIABILITAS','K',true,false)on conflict(code)do nothing;`);
  // Test a still-valid real JWT against the disabled actor gate before UI login.
  value(await admin.from('profiles').update({is_active:false}).eq('id',user.id),'Disable fictional actor');
  const denied=await actor.rpc('sales_create_delivery',{p_order_id:ids.order,p_request_key:'disabled',p_header:{tanggal:'2035-01-10'},p_items:[{order_item_id:ids.line,qty:1}]});
  assert.equal(denied.error?.code,'42501');
  assert.equal(counts().deliveries,0);
  value(await admin.from('profiles').update({is_active:true}).eq('id',user.id),'Restore fictional actor');
  pass('real GoTrue JWT from disabled OWNER rejected by PostgREST without a posting');
  fs.writeFileSync(output+'/fixture.json',JSON.stringify({ids,actor:user.id,email,app:APP,api:API},null,2));
  const ready=await fetch(APP+'/login').then(r=>r.ok).catch(()=>false);
  if(!ready)next=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3111'],{cwd:ROOT,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:API,NEXT_PUBLIC_SUPABASE_ANON_KEY:status.ANON_KEY},stdio:['ignore',log,log]});
  for(let i=0;i<120;i++){
    if(await fetch(APP+'/login').then(r=>r.ok).catch(()=>false))break;
    if(i===119)throw new Error('Sales Next app did not start');
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  browser=await chromium.launch({headless:true,executablePath:process.env.SALES_CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
  context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(60000);
  await page.goto(APP+'/login');await page.locator('input[name=email]').fill(email);await page.locator('input[name=password]').fill(password);
  await Promise.all([page.waitForURL('**/mulai'),page.getByRole('button',{name:'Masuk',exact:true}).click()]);
  assert.ok((await context.cookies()).some(cookie=>cookie.name.includes('auth-token')),'Real SSR auth cookie');
  const detail=`${APP}/penjualan/pesanan/${ids.order}`;
  const formFor=kind=>page.locator('form').filter({has:page.locator(`input[name=request_scope][value="${kind}:${ids.order}"]`)}).filter({has:page.locator(`input[name=qty_${ids.line}]`)});
  async function keyFor(kind){const input=formFor(kind).locator('input[name=request_key]');await page.waitForFunction(scope=>[...document.querySelectorAll('input[name=request_scope]')].some(input=>input.value===scope&&input.form?.querySelector('input[name=request_key]')?.value),`${kind}:${ids.order}`);return input.inputValue();}
  async function loseResponse(kind,qty){
    await page.goto(detail);const key=await keyFor(kind);const form=formFor(kind);
    await form.locator(`input[name=qty_${ids.line}]`).fill(String(qty));await form.locator('input[name=tanggal]').fill('2035-01-10');
    if(kind==='invoice')await form.locator('input[name=jatuh_tempo]').fill('2035-02-10');
    let resolveLost;const lost=new Promise(resolve=>{resolveLost=resolve;});let intercepted=false;
    const handler=async route=>{
      if(!intercepted&&route.request().method()==='POST'&&route.request().headers()['next-action']){
        intercepted=true;
        const response=await route.fetch();await response.body();
        await route.abort('failed');resolveLost();
      }else await route.continue();
    };
    await page.route(detail,handler);
    await form.getByRole('button',{name:kind==='delivery'?'Catat pengiriman':'Terbitkan faktur'}).click();
    let timer;
    try { await Promise.race([lost,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Did not discard a committed action response')),60000);})]); }
    finally { clearTimeout(timer); }
    await page.unroute(detail,handler);
    const before=counts();assert.equal(before[kind==='delivery'?'deliveries':'invoices'],1,'Original action committed exactly one document');
    await page.goto(detail);assert.equal(await keyFor(kind),key,'Reload retains the uncertain identity');
    await formFor(kind).getByRole('button',{name:'Periksa hasil transaksi terakhir',exact:true}).click();
    await page.waitForURL(url=>url.searchParams.get('request_done')===key);
    await page.getByText(/Dokumen .* sudah tersimpan\./).waitFor();
    assert.deepEqual(counts(),before,'Read-only recovery creates no financial or inventory effect');
    await page.waitForFunction(scope=>[...document.querySelectorAll('input[name=request_scope]')].some(input=>input.value===scope&&input.form?.querySelector('input[name=request_key]')?.value!==new URL(location.href).searchParams.get('request_done')),`${kind}:${ids.order}`);
    assert.notEqual(await keyFor(kind),key,'Confirmed success rotates identity');
    const recovered=value(await actor.rpc('sales_get_posting_result',{p_order_id:ids.order,p_kind:kind,p_request_key:key}),'PostgREST recover');
    assert.ok(recovered.document_id);
    await page.screenshot({path:`${output}/${kind}-recovered.png`,fullPage:true});
    pass(`actual ${kind} form commits, response is discarded, reload/recovery keeps one posting and rotates only after confirmation`);
  }
  await loseResponse('delivery',2);await loseResponse('invoice',1);
  assert.deepEqual(counts(),{deliveries:1,invoices:1,moves:1,journals:2,allocations:1,stock:38});
  assert.ok(session.access_token,'Real GoTrue session used');
  const costs=JSON.parse(sql(`select json_build_object(
'shipment_hpp',(select sum(di.hpp)from sales_delivery_items di join sales_deliveries d on d.id=di.delivery_id where d.order_id=${q(ids.order)}),
'invoice_hpp',(select sum(ii.hpp)from sales_invoice_items ii join sales_invoices i on i.id=ii.invoice_id where i.order_id=${q(ids.order)}),
'allocated_hpp',(select sum(a.hpp)from sales_invoice_delivery_allocations a join sales_invoice_items ii on ii.id=a.invoice_item_id join sales_invoices i on i.id=ii.invoice_id where i.order_id=${q(ids.order)}))`));
  assert.deepEqual(costs,{shipment_hpp:4,invoice_hpp:2,allocated_hpp:2});
  pass('one shipment, one invoice, one allocation, two journals and stock38 remain after both lost responses');
  console.log('Local fictional fixture/artifacts:',output);
}finally{
  await context?.close();await browser?.close();if(next)next.kill('SIGTERM');fs.closeSync(log);
}
