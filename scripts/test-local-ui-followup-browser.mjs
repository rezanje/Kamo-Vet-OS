// Local fixture only: real components, fictional data, no live actions or requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
const require=createRequire(import.meta.url),{chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright');
const source=path.resolve('src'),out=path.resolve('docs/evidence/2026-10-23-local-ui-followup');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'kamo-local-ui-'));
await fs.mkdir(out,{recursive:true});
const css=(await fs.readFile(path.join(source,'app/globals.css'),'utf8')).replace(/@import[^;]+;/g,'').replace(/@theme inline\s*\{[^}]*\}/g,'');
await fs.writeFile(path.join(root,'fixture.css'),css+'\nbody{margin:0;background:#f0ede8}*{box-sizing:border-box}button,input,select{font:inherit}');
await fs.writeFile(path.join(root,'index.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/main.tsx"></script>');
await fs.writeFile(path.join(root,'main.tsx'),`import React from'react';import{createRoot}from'react-dom/client';import{BarisJualForm}from'${source}/app/(app)/penjualan/BarisJualForm';import{OnlineForm}from'${source}/app/(app)/penjualan/online/baru/OnlineForm';import{ResepForm}from'${source}/app/(app)/pos/produksi/ResepForm';
const units=[{unit:'pcs',factor:1,sell_price:10,buy_price:5},{unit:'box',factor:12,sell_price:120,buy_price:60}];const items=[{id:'a',code:'SKU-A',name:'Nama sama',unit:'pcs',sell_price:10,units},{id:'b',code:'SKU-B',name:'Nama sama',unit:'pcs',sell_price:20,units}];
createRoot(document.getElementById('root')).render(<main style={{maxWidth:1100,margin:'auto',padding:12,minWidth:0}}><h1>U03 · Fixture lokal</h1><p>Data fiktif, tanpa transaksi live.</p><section id="quote"><h2>Penawaran / pesanan</h2><form><BarisJualForm userId="fixture" scope="fixture-quote" listId="fixture" items={items}/></form></section><section id="online"><h2>Online</h2><OnlineForm userId="fixture" items={items} warehouses={[]} customers={[]}/></section><section id="production"><h2>Resep produksi</h2><ResepForm barang={items}/></section></main>);`);
const server=await createServer({root,configFile:false,logLevel:'error',oxc:{jsx:{runtime:'automatic'}},server:{host:'127.0.0.1',port:3190,strictPort:true,fs:{allow:[root,source,path.resolve('node_modules'),'/opt/codex']}},resolve:{dedupe:['react','react-dom'],alias:[{find:'@',replacement:source},{find:'react-dom',replacement:path.dirname(require.resolve('react-dom'))},{find:'react',replacement:path.dirname(require.resolve('react'))}]},plugins:[{name:'fixture',enforce:'pre',resolveId(id,importer){if(id==='next/navigation')return '\0nav';if(id==='next/link')return '\0link';if(id==='../actions'&&importer?.endsWith('/OnlineForm.tsx')||id.endsWith('/penjualan/online/actions')||id.endsWith('/penjualan/online/actions.ts'))return '\0online';if(id==='./actions'&&importer?.endsWith('/ResepForm.tsx'))return '\0production';},load(id){if(id==='\0nav')return 'export const useSearchParams=()=>new URLSearchParams(location.search);';if(id==='\0link')return 'import React from "react";export default function Link({children,...p}){return React.createElement("a",p,children)}';if(id==='\0online')return 'export async function buatPenjualanOnline(){throw new Error("fixture only")};export async function recoverUnitPosting(){throw new Error("fixture only")}';if(id==='\0production')return 'export async function simpanResep(){throw new Error("fixture only")}';}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const results=[];
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}});const errors=[];let external=0;
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin==='http://127.0.0.1:3190')return route.continue();external++;return route.abort();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:3190');
  for(const label of ['Barang / jasa 1','Barang online 1','Barang jadi','Bahan produksi 1']){
   const input=page.getByRole('combobox',{name:label,exact:true});await input.fill('SKU-B');await input.press('ArrowDown');const option=page.getByRole('option',{name:/Kode: SKU-B/});const bounds=await option.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width+1);await input.press('Enter');assert.equal(await input.inputValue(),'Nama sama');
  }
  const quote=page.locator('#quote');await quote.locator('select').selectOption('box');const quoteRows=()=>quote.locator('[name=items]').inputValue().then(JSON.parse);assert.deepEqual((await quoteRows())[0],{nama:'Nama sama',qty:1,harga:120,item_id:'b',satuan:'box',faktor:12});
  const online=page.locator('#online');await online.locator('select[title=Satuan]').selectOption('box');assert.equal(JSON.parse(await online.locator('[name=items]').inputValue())[0].harga,120);const key=await online.locator('[name=request_key]').inputValue();
  const production=page.locator('#production');assert.equal(await production.locator('[name=item_id]').inputValue(),'b');await production.locator('[aria-label="Satuan bahan 1"]').selectOption('box');assert.deepEqual(JSON.parse(await production.locator('[name=bahan]').inputValue()),[{item_id:'b',qty:1,satuan:'box'}]);
  const output=page.getByRole('combobox',{name:'Barang jadi',exact:true});await output.fill('belum dipilih');assert.equal(await output.evaluate(el=>el.checkValidity()),false);assert.equal(await production.locator('[name=item_id]').inputValue(),'');await output.press('Escape');
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,nodes:[...document.querySelectorAll('main *')].map(e=>({tag:e.tagName,cls:e.className,text:e.textContent?.slice(0,50),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})).filter(e=>e.right>innerWidth+2).slice(0,30)}));if(overflow.scroll>width)console.log(JSON.stringify(overflow));assert.ok(overflow.scroll<=width);await page.screenshot({path:path.join(out,`selectors-${width}.png`),fullPage:true});
  await page.reload();await page.waitForFunction(()=>document.querySelector('#quote [role=combobox]')?.value==='Nama sama');assert.equal((await quoteRows())[0].faktor,12);assert.equal(await online.locator('[name=request_key]').inputValue(),key);assert.equal(JSON.parse(await online.locator('[name=items]').inputValue())[0].satuan,'box');assert.deepEqual(errors,[]);assert.equal(external,0);
  results.push({width,explicitId:true,keyboard:true,nameCodeSeparate:true,tablePopupVisible:true,unitPricePreserved:true,draftIdentityPreserved:true,requiredOutput:true,pageOverflow:false,runtimeErrors:0,externalRequests:0,liveWrites:0});await context.close();
 }
 await fs.writeFile(path.join(out,'browser.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
}finally{await browser?.close();await server.close();await fs.rm(root,{recursive:true,force:true});}
