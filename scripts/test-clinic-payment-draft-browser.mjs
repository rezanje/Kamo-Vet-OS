import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clinic-payment-draft-'));
const source = path.resolve('src');
await fs.writeFile(path.join(root,'index.html'),'<div id="root"></div><script type="module" src="/main.tsx"></script>');
await fs.writeFile(path.join(root,'main.tsx'),`
import React from 'react'; import {createRoot} from 'react-dom/client';
import {PembayaranForm} from '${source}/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm.tsx';
const unit=(unit,factor,sell_price)=>({unit,factor,sell_price,buy_price:500});
const master=[{id:'medicine',code:'FIC',name:'Fiction medicine',unit:'PCS',harga:1000,units:[unit('PCS',1,1000),unit('box',10,9000)]}];
const props={draftUserId:new URLSearchParams(location.search).get('user')||'user-a',requestKey:crypto.randomUUID(),visitId:'visit',
 patient:{photo:null,name:'Fictional patient',species:'Kucing',owner:'Fictional owner',phone:'',address:'',dokter:'Doctor',jenisLayanan:'Klinik',noInvoice:'(baru)',tanggal:'QA'},
 initialObat:[{deskripsi:'Fiction medicine',qty:1,harga:1000,item_id:'medicine',satuan:'PCS'},{deskripsi:'Fiction compound',qty:1,harga:5000,item_id:null,satuan:'racikan',recipe_id:'sealed-recipe',prescription_item_id:'sealed-prescription'}],
 initialJasa:[{deskripsi:'Fiction inpatient',qty:4,harga:1000,item_id:'inpatient',satuan:'hari',terkunci:true}],masterObat:master,masterJasa:[],manualUnitsEnabled:true,
 bekal:{promos:[],aturanDiskon:[],golonganPersen:0,infoBarang:{},vouchers:[],hariIni:'2026-10-05',customerId:null,categoryId:null,poinSaldo:100,rupiahPerPoin:1},catatanResep:null,
 salespeople:[{id:'doctor',nama:'Fiction Doctor',jabatan:'Doctor'},{id:'staff',nama:'Fiction Groomer',jabatan:'Groomer'}],initialSalespersonId:'doctor'};
const appRoot=createRoot(document.getElementById('root'));
window.__renderPayment=patch=>{Object.assign(props,patch);appRoot.render(<PembayaranForm key={props.draftUserId+':'+props.visitId+':'+(props.draftScope||'new')+':'+props.requestKey} {...props}/>);};
window.__renderPayment({});
`);
const server=await createServer({root,logLevel:'error',oxc:{jsx:{runtime:'automatic'},tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}}},server:{host:'127.0.0.1',port:3163,strictPort:true,fs:{allow:[root,source,path.resolve('node_modules'),'/opt/codex']}},optimizeDeps:{include:['react','react-dom','react-dom/client']},resolve:{dedupe:['react','react-dom'],alias:[{find:'@',replacement:source},{find:'react-dom',replacement:require.resolve('react-dom').replace(/\/index\.js$/,'')},{find:'react',replacement:require.resolve('react').replace(/\/index\.js$/,'')}]},plugins:[{
 name:'payment-fixtures',enforce:'pre',resolveId(id,importer){
  if(id==='next/link')return '\0fixture-link';if(id==='next/navigation')return '\0fixture-navigation';
  if(id==='@/lib/tagihan-klinik')return '\0fixture-tagihan';
  if(id.endsWith('actions')&&importer?.endsWith('PembayaranForm.tsx'))return '\0fixture-actions';
 },load(id){
  if(id==='\0fixture-link')return 'import React from "react";export default function Link({children,href,...props}){return React.createElement("a",{href,...props},children)}';
  if(id==='\0fixture-navigation')return 'export const useRouter=()=>({push:href=>location.assign(href)});';
  if(id==='\0fixture-tagihan')return 'export const hargaNetto=r=>r.harga*(1-(r.diskon_persen||0)/100);export const nilaiBaris=r=>r.qty*hargaNetto(r);';
  if(id==='\0fixture-actions')return 'export const bayarVisit=async(data)=>{window.__submitted=Object.fromEntries(data);if(window.__saveMode==="network")throw Error("Network unavailable");if(window.__saveMode==="success")return {saved:true,href:"/saved"};location.assign(location.pathname+"?error=failed");await new Promise(()=>{});};';
 }
}]});
await server.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({baseURL:'http://127.0.0.1:3163',timezoneId:'Asia/Jakarta'});
await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:3163'?route.continue():route.abort());
const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
const values=async()=>({key:await page.locator('[name=requestKey]').inputValue(),items:JSON.parse(await page.locator('[name=items]').inputValue()),discount:await page.locator('[name=discount]').inputValue(),metode:await page.locator('[name=metode_bayar]').inputValue(),staff:await page.locator('[name=salesperson_id]').inputValue(),dp:await page.locator('[name=dp_amount]').inputValue(),points:await page.locator('[name=poinDigunakan]').inputValue(),voucher:await page.locator('[name=voucherCode]').inputValue()});
try{
 await page.goto('/payment');await page.locator('[name=requestKey]').waitFor({state:'attached'});
 const medicine=page.locator('tr').filter({has:page.locator('input[value="Fiction medicine"]')});
 await medicine.locator('input[type=number]').nth(0).fill('3');await page.getByLabel('Satuan Fiction medicine',{exact:true}).selectOption('box');
 await medicine.locator('input[type=number]').nth(2).fill('10');
 await page.getByText('Diskon',{exact:true}).locator('..').locator('input').fill('200');
 await page.getByText('Jumlah Bayar',{exact:true}).locator('..').locator('input').fill('1000');
 await page.getByRole('button',{name:/Transfer Bayar/}).click();
 await page.locator('[name=salesperson_id]').selectOption('staff');
 await page.getByPlaceholder('opsional').fill('FICTION');
 await page.getByPlaceholder('0',{exact:true}).fill('50');
 const original=await values();
 // Recovering an older draft must retain newly authoritative locked inpatient rows.
 await page.evaluate(()=>{const key='vetos:clinic-draft:v1:user-a:payment:visit:new';const draft=JSON.parse(sessionStorage.getItem(key));draft.snapshot.jasa=[];sessionStorage.setItem(key,JSON.stringify(draft));});
 await page.reload();await page.locator('[name=requestKey]').waitFor({state:'attached'});await page.waitForTimeout(100);
 assert.deepEqual(await values(),original,'reload must retain rows/references/units/discount/payment/staff/request key');
 assert.equal(original.items[0].satuan,'box');assert.equal(original.items[0].harga,9000);assert.equal(original.items[0].qty,3);
 assert.equal(original.items[1].recipe_id,'sealed-recipe');assert.equal(original.items[1].prescription_item_id,'sealed-prescription');assert.equal(original.items[2].qty,4);
 await Promise.all([page.waitForURL('**?error=failed'),page.getByRole('button',{name:'Simpan',exact:true}).click()]);
 await page.locator('[name=requestKey]').waitFor({state:'attached'});await page.getByText('Draf dipulihkan.',{exact:false}).waitFor();assert.deepEqual(await values(),original,'server validation redirect preserves draft');
 await page.evaluate(()=>{window.__saveMode='network'});await page.getByRole('button',{name:'Simpan',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Belum tersimpan'}).waitFor();assert.deepEqual(await values(),original,'network failure must not reset payment');
 await page.evaluate(()=>window.__renderPayment({draftUserId:'user-b',visitId:'visit-b',requestKey:crypto.randomUUID()}));
 await page.waitForTimeout(100);assert.equal(await page.locator('[name=salesperson_id]').inputValue(),'doctor','mounted identity change resets staff');
 assert.equal(JSON.parse(await page.locator('[name=items]').inputValue())[0].qty,1,'mounted identity change must not retain prior visit rows');
 await page.evaluate(()=>window.__renderPayment({draftUserId:'user-a',visitId:'visit',requestKey:crypto.randomUUID()}));
 await page.getByText('Draf dipulihkan.',{exact:false}).waitFor();assert.deepEqual(await values(),original,'returning to the original identity recovers its own draft');
 await page.goto('/payment?user=user-b');await page.locator('[name=requestKey]').waitFor({state:'attached'});await page.waitForTimeout(100);assert.equal(await page.locator('[name=salesperson_id]').inputValue(),'doctor','account isolation');
 await page.goto('/payment');await page.getByText('Draf dipulihkan.',{exact:false}).waitFor();assert.deepEqual(await values(),original);
 // Fresh server data remounts the form; discard resets to those authoritative rows.
 await page.evaluate(()=>window.__renderPayment({requestKey:crypto.randomUUID(),initialJasa:[{deskripsi:'Fiction inpatient',qty:7,harga:1000,item_id:'inpatient',satuan:'hari',terkunci:true}]}));
 await page.getByText('Draf dipulihkan.',{exact:false}).waitFor();
 assert.equal(JSON.parse(await page.locator('[name=items]').inputValue())[2].qty,7,'restored locked qty follows refreshed server data');
 await page.getByRole('button',{name:'Buang draf',exact:true}).click();
 const discarded=await values();assert.equal(discarded.items[0].qty,1);assert.equal(discarded.items[0].satuan,'PCS');assert.equal(discarded.items[2].qty,7,'discard restores current server rows');
 await page.evaluate(()=>{window.__saveMode='success'});await Promise.all([page.waitForURL('**/saved'),page.getByRole('button',{name:'Simpan',exact:true}).click()]);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('vetos:clinic-draft:v1:user-a:payment:visit:new')),null,'only acknowledged success clears draft');
 await page.goto('/payment');await page.getByLabel('Bayar dengan beberapa metode').check();
 await page.getByLabel('Nominal pembayaran 1',{exact:true}).fill('5000');
 await page.getByLabel('Nominal pembayaran 2',{exact:true}).fill('4999');
 assert.equal(await page.getByRole('button',{name:'Bayar & Selesai',exact:true}).isDisabled(),true,'underpaid split is blocked');
 await page.getByLabel('Nominal pembayaran 2',{exact:true}).fill('5000');
 assert.equal(await page.getByRole('button',{name:'Bayar & Selesai',exact:true}).isDisabled(),false,'complete split can be saved');
 const mixedKey=await page.locator('[name=requestKey]').inputValue();
 const parts=JSON.parse(await page.locator('[name=split_payments]').inputValue());
 assert.deepEqual(parts,[{method:'Tunai',amount:5000},{method:'Transfer',amount:5000}]);
 await page.reload();await page.getByText('Draf dipulihkan.',{exact:false}).waitFor();
 assert.equal(await page.getByLabel('Bayar dengan beberapa metode').isChecked(),true);
 assert.deepEqual(JSON.parse(await page.locator('[name=split_payments]').inputValue()),parts,'split parts survive reload');
 assert.equal(await page.locator('[name=requestKey]').inputValue(),mixedKey,'mixed request key survives reload');
 await page.addStyleTag({content:(await fs.readFile(path.join(source,'app/globals.css'),'utf8')).split('/* Color tokens live')[1].replace(/^.*?\*\//s,'')+'\n*{box-sizing:border-box}body{font-family:system-ui;background:#f0ede8;padding:24px;margin:0}'});
 await page.screenshot({path:'/tmp/vetos-split-payment-demo.png',fullPage:true});
 // A draft from before this change still recovers its original payment/rows.
 await page.evaluate(()=>{const key='vetos:clinic-draft:v1:user-a:payment:visit:new';const draft=JSON.parse(sessionStorage.getItem(key));delete draft.snapshot.mixed;delete draft.snapshot.splitPayments;sessionStorage.setItem(key,JSON.stringify(draft));});
 await page.reload();await page.getByText('Draf dipulihkan.',{exact:false}).waitFor();
 assert.equal(await page.getByLabel('Bayar dengan beberapa metode').isChecked(),false,'legacy drafts remain single method');
 assert.equal(await page.locator('[name=requestKey]').inputValue(),mixedKey,'legacy draft retains request key');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log(JSON.stringify({passed:true,reload:true,serverFailure:true,networkFailure:true,stableRequestKey:true,accountIsolation:true,refsUnitsAmountsStaff:true,acknowledgedSuccessCleanup:true,mixedPayment:true,mixedDraftRecovery:true,legacyDraftRecovery:true,productionMutations:false}));
}finally{await context.close();await browser.close();await server.close();await fs.rm(root,{recursive:true,force:true});}
