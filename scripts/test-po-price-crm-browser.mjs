// Real components, fictional actions/catalog, loopback Chromium. No live submit.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {createServer} from 'vite';
const require=createRequire(import.meta.url),{chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright');
const source=path.resolve('src'),out=path.resolve('docs/evidence/2026-10-22-po-price-crm');await fs.mkdir(out,{recursive:true});
const root=await fs.mkdtemp(path.join(os.tmpdir(),'kamo-po-crm-'));
const css=(await fs.readFile(path.join(source,'app/globals.css'),'utf8')).replace(/@import[^;]+;/g,'').replace(/@theme inline\s*\{[^}]*\}/g,'');
await fs.writeFile(path.join(root,'fixture.css'),css+'\nbody{margin:0;background:#f0ede8}*{box-sizing:border-box}button,input,select{font:inherit}');
await fs.writeFile(path.join(root,'index.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/main.tsx"></script>');
await fs.writeFile(path.join(root,'main.tsx'),`import React from 'react';import{createRoot}from'react-dom/client';import{POForm}from'${source}/app/(app)/pembelian/baru/POForm';import PromoPage from'${source}/app/(app)/crm/promo/page';
const view=new URLSearchParams(location.search).get('view');const content=view==='crm'?await PromoPage({searchParams:Promise.resolve({})}):<POForm userId="fiction-owner" suppliers={[]} warehouses={[{id:'w',name:'Fiction warehouse'}]} branches={[{id:'b',name:'Fiction branch'}]} items={[]}/>;
createRoot(document.getElementById('root')).render(<main style={{maxWidth:1100,margin:'auto',padding:12,minWidth:0}}><h1 style={{fontSize:22}}>Uji UI PO & CRM</h1><p>Komponen asli · data fiktif · tanpa transaksi live</p>{content}</main>);`);
const stubDB=`export async function createClient(){return{auth:{getUser:async()=>({data:{user:{id:'fiction-owner'}}})},from(table){let from=0,to=999;const all=table==='items'?Array.from({length:1205},(_,i)=>({id:'i'+i,code:'SKU-'+String(i).padStart(4,'0'),name:i<2?'Nama Sama':i===1204?'Barang Setelah Seribu':'Barang Fiktif '+i})):table==='branches'?[{id:'b0',code:'BR-A',name:'Cabang Sama'},{id:'b1',code:'BR-B',name:'Cabang Sama'}]:[];const q={select(){return q},eq(){return q},order(){return q},range(a,b){from=a;to=b;return q},then(done){return Promise.resolve({data:all.slice(from,to+1),count:all.length,error:null}).then(done)}};return q}}}`;
const server=await createServer({root,configFile:false,logLevel:'error',oxc:{jsx:{runtime:'automatic'}},server:{host:'127.0.0.1',port:3182,strictPort:true,fs:{allow:[root,source,path.resolve('node_modules'),'/opt/codex']}},resolve:{dedupe:['react','react-dom'],alias:[{find:'@',replacement:source},{find:'react-dom',replacement:path.dirname(require.resolve('react-dom'))},{find:'react',replacement:path.dirname(require.resolve('react'))}]},plugins:[{name:'fixture',enforce:'pre',resolveId(id,importer){
 if(id==='next/navigation')return '\0navigation';if(id==='next/link')return '\0link';if(id.endsWith('/lib/supabase/server'))return '\0db';
 if(id.includes('/pembelian/actions')||(id==='../actions'&&importer?.endsWith('/POForm.tsx')))return '\0purchase';
 if(id.includes('/crm/promo/actions')||(id==='./actions'&&importer?.endsWith('/crm/promo/page.tsx')))return '\0promo';
},load(id){if(id==='\0navigation')return 'export const useSearchParams=()=>new URLSearchParams(location.search);';if(id==='\0link')return 'import React from "react";export default function Link({children,...p}){return React.createElement("a",p,children)}';if(id==='\0db')return stubDB;
 if(id==='\0purchase')return `export async function buatPO(data){window.__po=Object.fromEntries(data);throw new Error('fixture offline')};export async function recoverPurchaseSubmission(){throw new Error('fixture only')}`;
 if(id==='\0promo')return `export async function createPromo(data){window.__crm={items:data.getAll('item_ids'),branches:data.getAll('branch_ids')};throw new Error('fixture offline')};export async function togglePromo(){throw new Error('not tested')}`;
}}]});
let browser;
try{await server.listen();browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const results=[];
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900},permissions:['clipboard-read','clipboard-write']});let external=0;const errors=[];
  await context.route('**/*',r=>{if(new URL(r.request().url()).origin==='http://127.0.0.1:3182')return r.continue();external++;return r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:3182');
  const price=page.getByPlaceholder('Harga beli',{exact:true});await price.waitFor();assert.equal(await price.inputValue(),'');await price.focus();await price.pressSequentially('10000');assert.equal(await price.inputValue(),'10000');
  const payload=()=>page.locator('input[name=items]').inputValue().then(JSON.parse);assert.equal((await payload())[0].harga_beli,10000);
  await price.fill('');assert.equal(await price.inputValue(),'');await price.pressSequentially('12.75');await price.press('Tab');await price.focus();assert.equal(await price.inputValue(),'12.75');assert.equal((await payload())[0].harga_beli,12.75);
  await page.evaluate(()=>navigator.clipboard.writeText('10000'));await price.press('ControlOrMeta+A');await price.press('ControlOrMeta+V');assert.equal(await price.inputValue(),'10000');assert.equal((await payload())[0].harga_beli,10000);
  await page.reload();await price.waitFor();await page.waitForFunction(()=>document.querySelector('input[placeholder="Harga beli"]').value==='10000');
  await page.getByPlaceholder('Kode / nama barang').fill('Barang PO fiktif');await page.locator('[name=to_warehouse_id]').selectOption('w');await page.locator('[name=branch_id]').selectOption('b');
  await page.locator('form').evaluate(form=>form.requestSubmit());await page.getByRole('alert').waitFor();assert.equal(await price.inputValue(),'10000');assert.equal(JSON.parse((await page.evaluate(()=>window.__po)).items)[0].harga_beli,10000);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(out,`po-${width}.png`),fullPage:true});
  await page.goto('http://127.0.0.1:3182/?view=crm');const item=page.getByRole('combobox',{name:'Cari barang promo'});await item.waitFor();await item.fill('SKU-1204');await page.getByRole('option',{name:/SKU-1204/}).click();
  await item.fill('SKU-000');await page.getByRole('button',{name:'Pilih semua hasil (10)',exact:true}).click();
  assert.equal((await page.locator('input[name=item_ids]').evaluateAll(nodes=>nodes.map(node=>node.value))).length,11);await page.getByRole('button',{name:'Lepas semua hasil (10)',exact:true}).click();assert.deepEqual(await page.locator('input[name=item_ids]').evaluateAll(nodes=>nodes.map(node=>node.value)),['i1204']);
  await item.fill('Nama Sama');await item.press('ArrowDown');await item.press('Enter');await item.press('Escape');assert.deepEqual(await page.locator('input[name=item_ids]').evaluateAll(nodes=>nodes.map(node=>node.value)),['i1204','i0']);assert.equal(await page.evaluate(()=>Boolean(window.__crm)),false);
  const branch=page.getByRole('combobox',{name:'Cari cabang promo'});await branch.fill('BR-B');await page.getByRole('option',{name:/BR-B/}).click();assert.deepEqual(await page.locator('input[name=item_ids]').evaluateAll(nodes=>nodes.map(node=>node.value)),['i1204','i0']);
  await page.locator('[name=name]').fill('Promo Fiktif');await page.locator('[name=suggest]').fill('Pengingat fiktif');await page.getByRole('button',{name:'Buat Promo',exact:true}).click();await page.getByRole('alert').waitFor();assert.deepEqual((await page.evaluate(()=>window.__crm)).items,['i1204','i0']);
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('input[name=item_ids]').length===2);assert.deepEqual(await page.locator('input[name=branch_ids]').evaluateAll(nodes=>nodes.map(node=>node.value)),['b1']);
  await item.fill('Nama Sama');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(out,`crm-${width}.png`),fullPage:true});
  assert.deepEqual(errors,[]);assert.equal(external,0);results.push({width,priceTypingPasteClearDecimalRefocusDraftFailure:true,crmBeyond1000FilteredAllKeyboardBranchDraftFailure:true,documentOverflow:false,runtimeErrors:0,externalRequests:0,liveTransactions:0});await context.close();
 }
 await fs.writeFile(path.join(out,'browser.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
}finally{await browser?.close();await server.close();await fs.rm(root,{recursive:true,force:true});}
