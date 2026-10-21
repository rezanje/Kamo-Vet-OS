import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'docs/evidence/2026-10-21-kasir-direct-quantity');
await fs.mkdir(output,{recursive:true});
const require=createRequire(root+'/package.json');
const {createServer}=await import(pathToFileURL(require.resolve('vite')));
const {chromium}=require(process.env.KAMO_PLAYWRIGHT_MODULE||'/opt/codex/cua_node/lib/node_modules/playwright');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'kamo-quantity-'));
await fs.writeFile(path.join(temp,'index.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/main.tsx"></script>');
await fs.writeFile(path.join(temp,'main.tsx'),`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{KasirQuantityInput}from'${root}/src/app/kasir/KasirQuantityInput.tsx';function Fixture(){const[q,setQ]=useState(2);return <main style={{maxWidth:360,margin:'auto',padding:12,fontFamily:'sans-serif'}}><h1>Qty Kasir</h1><p>Komponen asli, data fiktif</p><form onSubmit={e=>{e.preventDefault();window.submitted=true}}><div style={{display:'flex',alignItems:'center',gap:3}}><button type="button" onClick={()=>setQ(q-1)}>−</button><KasirQuantityInput quantity={q} label="Jumlah Pakan (pcs)" onChange={setQ}/><button type="button" onClick={()=>setQ(q+1)}>+</button></div><output data-quantity={q}>{q}</output><button type="submit">Bayar fiktif</button></form></main>};createRoot(document.getElementById('root')).render(<Fixture/>);`);
const server=await createServer({root:temp,configFile:false,logLevel:'error',oxc:{jsx:{runtime:'automatic'}},server:{host:'127.0.0.1',port:3179,strictPort:true,fs:{allow:[root,temp,path.dirname(path.dirname(require.resolve('react')))]}},resolve:{dedupe:['react','react-dom'],alias:[{find:'react-dom',replacement:path.dirname(require.resolve('react-dom'))},{find:'react',replacement:path.dirname(require.resolve('react'))}]}});
let browser;
try {
 await server.listen();browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const results=[];
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:800}});const errors=[];let outside=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin==='http://127.0.0.1:3179')return route.continue();outside++;return route.abort();});
  await page.goto('http://127.0.0.1:3179');const input=page.getByRole('spinbutton');await input.fill('12');await input.press('Enter');
  assert.equal(await page.locator('output').getAttribute('data-quantity'),'12');
  await input.focus();await input.press('ControlOrMeta+A');await input.pressSequentially('0.3333');
  assert.equal(await page.locator('output').getAttribute('data-quantity'),'0.3333');
  await input.fill('');assert.equal(await input.evaluate(el=>el.checkValidity()),false);
  await input.press('Enter');assert.equal(await input.inputValue(),'0.3333');
  await input.fill('-2');assert.equal(await page.locator('output').getAttribute('data-quantity'),'0.3333');
  await input.press('Tab');assert.equal(await input.inputValue(),'0.3333');
  await input.fill('0');await input.press('Enter');assert.equal(await input.inputValue(),'0.3333');
  await input.fill('2.5');await page.getByRole('button',{name:'+',exact:true}).click();assert.equal(await input.inputValue(),'3.5');
  assert.equal(await page.evaluate(()=>Boolean(window.submitted)),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);assert.equal(outside,0);
  await page.screenshot({path:path.join(output,(width===390?'mobile':'desktop')+'.png'),fullPage:true});
  results.push({width,keyboardFractionalTyping:true,invalidAndEmptyRestore:true,enterDoesNotCheckout:true,plusPreserved:true,overflow:false,runtimeErrors:0,externalRequests:outside});await page.close();
 }
 await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser?.close();await server.close();}
