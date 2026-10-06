import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clinic-draft-'));
const source = path.resolve('src');
await fs.writeFile(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/main.tsx"></script>');
await fs.writeFile(path.join(root, 'main.tsx'), `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {RekamForm} from '${source}/app/(app)/klinik/rekam-medis/[visitId]/RekamForm.tsx';
import {CatatanForm} from '${source}/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm.tsx';
const unit=(unit,factor,sell_price)=>({unit,factor,sell_price,buy_price:0});
const items=[{id:'medicine',name:'Fictional medicine',unit:'ml',sell_price:1000,stok:200,units:[unit('ml',1,1000),unit('btl',50,40000)]},...Array.from({length:54},(_,i)=>({id:'ordinary-'+i,name:'Ordinary medicine '+i,unit:'ml',sell_price:1000,stok:100,units:[unit('ml',1,1000)]}))];
const common={draftUserId:new URLSearchParams(location.search).get('user')||'user-a',requestKey:crypto.randomUUID(),patient:{name:'Fictional patient',species:'Kucing',noRM:'QA',owner:'Fictional owner',tglPeriksa:'QA',tglMasuk:'QA',phone:'',address:'',tier:'',dokter:'Fictional doctor',dokterId:'doctor',providerId:null,kondisi:'stabil',breed:null,photo:null,keluhan:'Fiction complaint'},items,racikanItems:[{id:'master-compound',name:'Fictional master racikan',code:'FIC',unit:'pcs',sell_price:1200,stok:7,units:[unit('pcs',1,1200)]}],bahanItems:[{id:'material',name:'Fictional ingredient',unit:'gram',sell_price:999999,stok:20}],katalogRacikan:[],bolehManual:true,doctors:[{id:"dc000000-0000-4000-8000-000000000002",nama:"Drh Fiction Visit",jabatan:"Dokter"}],paramedics:[{id:"dc000000-0000-4000-8000-000000000003",nama:"Fiction Nurse",jabatan:"Perawat"}]};
const Form=location.pathname==='/inpatient'?CatatanForm:RekamForm;
createRoot(document.getElementById('root')).render(<Form {...common} recordId="inpatient" backHref="/inpatient" visitId="visit" petId="pet" jasaItems={[]} currentWeight={null} dokterOpsi={[{id:'doctor',nama:'Drh Fictional doctor',jabatan:'Dokter'}]} providerOpsi={[]}/>);
`);
const server = await createServer({root,logLevel:'error',oxc:{jsx:{runtime:'automatic'},tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}}},server:{host:'127.0.0.1',port:3159,strictPort:true,fs:{allow:[root,source,path.resolve('node_modules'),'/opt/codex']}},optimizeDeps:{include:['react','react-dom','react-dom/client']},resolve:{dedupe:['react','react-dom'],alias:[{find:'@',replacement:source},{find:'react-dom',replacement:require.resolve('react-dom').replace(/\/index\.js$/,'')},{find:'react',replacement:require.resolve('react').replace(/\/index\.js$/,'')}]},plugins:[{
name:'clinic-fixtures',enforce:'pre',
resolveId(id,importer){
if(id==='next/link')return '\0fixture-link';
if(id==='next/navigation')return '\0fixture-navigation';
if(id==='@/lib/supabase/client'||/\/lib\/supabase\/client(?:\.ts)?$/.test(id))return '\0fixture-supabase';
if(id==='@/components/PetPhotoUpload'||/\/components\/PetPhotoUpload(?:\.tsx)?$/.test(id))return '\0fixture-photo';
if(id.endsWith('actions') && importer && /(?:RekamForm|CatatanForm)\.tsx/.test(importer))return '\0fixture-actions';
},
load(id){
if(id==='\0fixture-link')return 'import React from "react"; export default function Link({children,href,...props}){return React.createElement("a",{href,...props},children)}';
if(id==='\0fixture-navigation')return 'export const useRouter=()=>({push:href=>location.assign(href)});';
if(id==='\0fixture-supabase')return 'export const createClient=()=>({storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:()=>({data:{publicUrl:"https://fiction.local/photo.png"}})})}});';
if(id==='\0fixture-photo')return 'export const PetPhotoUpload=()=>null;';
if(id==='\0fixture-actions')return 'const save=async()=>{if(window.__saveMode==="network")throw Error("Network unavailable");if(window.__saveMode==="success")return {saved:true,href:"/saved"};location.assign(location.pathname+"?error=failed");await new Promise(()=>{});}; export const simpanRekamMedis=save;export const addDailyLogPos=save;';
}
}]});
await server.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({baseURL:'http://127.0.0.1:3159',timezoneId:'Asia/Jakarta'});
await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:3159'?route.continue():route.abort());
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto('/inpatient');await page.locator('[name=condition_note]').waitFor();
 assert.equal(await page.locator('[name=visit_doctor_id]').evaluate(e=>e.required),false,'monitoring never forces paramedics to pose as doctors');
 await page.getByLabel('Jenis laporan',{exact:true}).selectOption('doctor_visit');
 assert.equal(await page.locator('[name=visit_doctor_id]').evaluate(e=>e.required),true);
 assert.equal(await page.locator('form').evaluate(e=>e.checkValidity()),false);
 await page.getByLabel('Dokter visit',{exact:true}).selectOption('dc000000-0000-4000-8000-000000000002');
 await page.getByLabel('Paramedis yang membantu',{exact:true}).selectOption('dc000000-0000-4000-8000-000000000003');
 await page.locator('[name=condition_note]').fill('Fiction doctor visit');
 await page.reload();await page.getByLabel('Jenis laporan',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Jenis laporan',{exact:true}).inputValue(),'doctor_visit');
 assert.equal(await page.getByLabel('Dokter visit',{exact:true}).inputValue(),'dc000000-0000-4000-8000-000000000002');
 assert.equal(await page.getByLabel('Paramedis yang membantu',{exact:true}).inputValue(),'dc000000-0000-4000-8000-000000000003');
 await page.getByRole('button',{name:'Buang draf',exact:true}).click();
 assert.equal(await page.getByLabel('Jenis laporan',{exact:true}).inputValue(),'monitoring');
 for(const route of ['/exam','/inpatient']){
  await page.goto(route);await page.locator('input[name=request_key]').waitFor({state:'attached'});
  await page.getByRole('button',{name:'Racikan',exact:true}).click();
  const editor=page.getByRole('region',{name:'Editor obat racik'});
  assert.equal(await editor.getByRole('button',{name:'Pilih Fictional master racikan',exact:true}).count(),0);
  await editor.getByRole('textbox',{name:'Cari obat racik',exact:true}).fill('Fictional');
  await editor.getByRole('button',{name:'Pilih Fictional master racikan',exact:true}).click();
  assert.equal(JSON.parse(await page.locator('input[name=resep]').inputValue()).length,0,'selecting master must not issue stock');
  await editor.getByRole('textbox',{name:'Cari bahan racikan',exact:true}).fill('ingredient');
  assert.equal((await editor.innerText()).includes('999.999'),false,'material selling price must be hidden');
  await editor.getByRole('button',{name:'Pilih bahan Fictional ingredient',exact:true}).click();
  await editor.getByRole('spinbutton',{name:'Jumlah bahan Fictional ingredient'}).fill('0.5');
  await page.reload();await page.locator('input[name=request_key]').waitFor({state:'attached'});
  await page.getByRole('button',{name:'Racikan',exact:true}).click();
  await editor.getByText('Fictional master racikan',{exact:true}).waitFor();
  assert.equal(await editor.getByRole('spinbutton',{name:'Jumlah bahan Fictional ingredient'}).inputValue(),'0.5');
  await editor.getByRole('button',{name:'Tambah racikan ke keranjang',exact:true}).click();
  const cart=JSON.parse(await page.locator('input[name=resep]').inputValue());
  assert.equal(cart.length,1);assert.equal(cart[0].sale_item_id,'master-compound');assert.equal(cart[0].item_id,null);assert.equal(cart[0].harga,1200);assert.equal(cart[0].qty,1);assert.equal(cart[0].ingredients[0].qty,0.5);
  await page.reload();await page.locator('input[name=request_key]').waitFor({state:'attached'});
  assert.deepEqual(JSON.parse(await page.locator('input[name=resep]').inputValue()),cart,'compound cart survives reload');
  await page.getByRole('button',{name:'Buang draf'}).click();
 }
 for(const route of ['/exam','/inpatient']){
  await page.goto(route);await page.locator('input[name=request_key]').waitFor({state:'attached'});
  assert.equal(await page.getByRole('button',{name:'Obat berikutnya',exact:true}).count(),1,'all ordinary medicines must be browsable beyond 40 rows');
  await page.getByRole('button',{name:'Obat berikutnya',exact:true}).click();
  await page.getByText('Ordinary medicine 53',{exact:true}).waitFor();
  await page.getByPlaceholder('Cari nama obat / scan barcode…').fill('Fictional medicine');
  const field=route==='/exam'?'anamnesis':'condition_note';
  await page.locator('[name='+field+']').fill('Clinical work to retain');
  await page.getByRole('row').filter({hasText:'Fictional medicine'}).getByTitle('Tambah',{exact:true}).click();
  await page.getByTitle('Satuan',{exact:true}).selectOption('btl');
  await page.locator('[name=berat]').fill('4.5');
  await page.locator('[name=suhu]').fill('38.6');
  if(route==='/exam'){
   const followup=page.locator('.crm-sec').filter({hasText:'RENCANA FOLLOW UP'});
   await followup.locator('input[type=date]').fill('2026-10-15');
   await followup.locator('input:not([type])').fill('Fictional followup note');
   await followup.getByRole('button',{name:'Tambah',exact:true}).click();
   await page.locator('input[type=file][multiple]').setInputFiles([{name:'lab-a.png',mimeType:'image/png',buffer:Buffer.from('fictional')},{name:'lab-b.png',mimeType:'image/png',buffer:Buffer.from('fictional')}]);
   await page.waitForFunction(()=>JSON.parse(document.querySelector('[name=penunjang_urls]').value).length===2);
  }else{
   await page.locator('[name=makan]').selectOption({index:1});
   await page.locator('input[type=file]').setInputFiles({name:'patient.png',mimeType:'image/png',buffer:Buffer.from('fictional')});
   await page.waitForFunction(()=>document.querySelector('[name=foto_url]').value==='https://fiction.local/photo.png');
  }
  const key=await page.locator('input[name=request_key]').inputValue();
  await page.reload();await page.locator('input[name=request_key]').waitFor({state:'attached'});
  await page.waitForTimeout(100);
  assert.equal(await page.locator('[name='+field+']').inputValue(),'Clinical work to retain','reload must retain clinical fields');
  assert.equal(await page.locator('input[name=request_key]').inputValue(),key,'reload must retain original idempotency key');
  assert.equal(await page.locator('[name=berat]').inputValue(),'4.5');
  assert.equal(await page.locator('[name=suhu]').inputValue(),'38.6');
  if(route==='/exam'){
   assert.equal(JSON.parse(await page.locator('[name=follow_ups]').inputValue())[0].catatan,'Fictional followup note');
   assert.equal(JSON.parse(await page.locator('[name=penunjang_urls]').inputValue()).length,2);
  }else assert.equal(await page.locator('[name=foto_url]').inputValue(),'https://fiction.local/photo.png');
  let cart=JSON.parse(await page.locator('input[name=resep]').inputValue());
  assert.equal(cart[0].satuan,'btl');assert.equal(cart[0].faktor,50);assert.equal(cart[0].harga,40000);
  await page.getByText('Draf dipulihkan').waitFor();
  await Promise.all([page.waitForURL('**?error=failed'),page.getByRole('button',{name:route==='/exam'?'Simpan & Cetak Resep':'Simpan Catatan & Lanjut'}).click()]);
  await page.locator('input[name=request_key]').waitFor({state:'attached'});await page.waitForTimeout(100);
  assert.equal(await page.locator('[name='+field+']').inputValue(),'Clinical work to retain','failed save must retain fields');
  assert.equal(await page.locator('input[name=request_key]').inputValue(),key);
  await page.evaluate(()=>{window.__saveMode='network'});
  await page.getByRole('button',{name:route==='/exam'?'Simpan & Cetak Resep':'Simpan Catatan & Lanjut'}).click();
  await page.getByRole('alert').filter({hasText:'Belum tersimpan'}).waitFor();
  assert.equal(await page.locator('[name='+field+']').inputValue(),'Clinical work to retain');
  await page.goto(route+'?user=user-b');await page.locator('input[name=request_key]').waitFor({state:'attached'});await page.waitForTimeout(100);
  assert.equal(await page.locator('[name='+field+']').inputValue(),'','other accounts must not see draft');
  await page.goto(route);await page.locator('input[name=request_key]').waitFor({state:'attached'});await page.waitForTimeout(100);
  assert.equal(await page.locator('[name='+field+']').inputValue(),'Clinical work to retain');
  await page.getByRole('button',{name:'Buang draf'}).click();
  assert.equal(await page.locator('[name='+field+']').inputValue(),'');
  await page.locator('[name='+field+']').fill('Successful save');
  await page.evaluate(()=>{window.__saveMode='success'});
  await Promise.all([page.waitForURL('**/saved'),page.getByRole('button',{name:route==='/exam'?'Simpan & Cetak Resep':'Simpan Catatan & Lanjut'}).click()]);
  assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('vetos:clinic-draft:')).filter(key=>key.includes('user-a')).length),0,'confirmed success must clear this user draft');
 }
 await page.goto('/exam');await page.locator('[name=anamnesis]').waitFor();
 await page.locator('[name=anamnesis]').fill('Expired draft');
 await page.evaluate(()=>{const key='vetos:clinic-draft:v1:user-a:exam:visit';const draft=JSON.parse(sessionStorage.getItem(key));draft.savedAt=Date.now()-13*60*60*1000;sessionStorage.setItem(key,JSON.stringify(draft));});
 await page.reload();await page.locator('[name=anamnesis]').waitFor();await page.waitForTimeout(100);
 assert.equal(await page.locator('[name=anamnesis]').inputValue(),'','expired drafts must not reappear');
 await page.evaluate(()=>sessionStorage.setItem('vetos:clinic-draft:v1:user-a:exam:visit','invalid-json'));
 await page.reload();await page.getByRole('alert').filter({hasText:'Draf browser tidak dapat dipulihkan'}).waitFor();
 await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Disabled storage','SecurityError')}});
 await page.locator('[name=anamnesis]').fill('Keep this work in the current page');
 await page.getByRole('alert').filter({hasText:'Draf browser tidak dapat disimpan'}).waitFor();
 assert.equal(await page.locator('[name=anamnesis]').inputValue(),'Keep this work in the current page');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log(JSON.stringify({passed:true,forms:2,reload:true,failedSave:true,networkError:true,inpatientStaffRequiredAndDraft:true,unifiedCompoundEditor:true,masterCartAndDraft:true,hiddenMaterialPrices:true,fractionalIngredients:true,ordinaryPagination:true,followupsAndUploadedReferences:true,unitFactorPrice:true,accountIsolation:true,discard:true,successCleanup:true,expiredDrafts:true,malformedDrafts:true,disabledStorage:true,productionMutations:false}));
}finally{await context.close();await browser.close();await server.close();await fs.rm(root,{recursive:true,force:true});}
