// Actual React components, fictional action responses, loopback-only Chromium.
// This is UI acceptance; it does not authenticate to Next/Supabase or write a DB.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KAMO_PLAYWRIGHT_MODULE ?? '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = await fs.mkdtemp(path.join(os.tmpdir(),'master-lifecycle-browser-'));
const source = path.resolve('src');
const evidence = path.resolve('docs/evidence/2026-10-21-master-data-lifecycle');
await fs.mkdir(evidence,{recursive:true});
const css=(await fs.readFile(path.join(source,'app/globals.css'),'utf8')).replace(/@import[^;]+;/g,'').replace(/@theme inline\s*\{[^}]*\}/g,'');
await fs.writeFile(path.join(root,'fixture.css'),css+'\nbody{margin:0;background:#f0ede8}*{box-sizing:border-box}button,a,textarea{font:inherit}');
await fs.writeFile(path.join(root,'index.html'),'<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/main.tsx"></script>');
await fs.writeFile(path.join(root,'main.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {MasterLifecycleActions} from '${source}/components/MasterLifecycleActions.tsx';
import {MasterLifecycleFilter} from '${source}/components/MasterLifecycleFilter.tsx';
const masters=[['employees','Karyawan contoh',true,false],['items','Barang contoh',true,false],['brands','Merek contoh',false,false],['suppliers','Pemasok contoh',true,false],['supplier_categories','Kategori pemasok contoh',false,false],['units','Satuan contoh',false,true]];
createRoot(document.getElementById('root')).render(<main style={{maxWidth:1200,margin:'auto',padding:20}}><h1 style={{color:'var(--sb)',fontSize:24}}>Aksi master data</h1><p>Preview lokal dengan data fiktif. Riwayat tetap tersimpan.</p><MasterLifecycleFilter entity="items" view="inactive"/><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:14}}>{masters.map(([entity,name,active,trashed],i)=><section key={entity} className="crm-sec" style={{margin:0,padding:18}}><h2 style={{fontSize:16,marginTop:0}}>{name}</h2><p style={{fontSize:12}}>{trashed?'Sampah':active?'Aktif':'Nonaktif'}</p><MasterLifecycleActions entity={entity} name={name} id={'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0')} active={active} trashed={trashed} revision={4}/></section>)}</div></main>);
`);
const server=await createServer({root,logLevel:'error',oxc:{jsx:{runtime:'automatic'},tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}}},server:{host:'127.0.0.1',port:3167,strictPort:true,fs:{allow:[root,source,path.resolve('node_modules'),'/opt/codex']}},optimizeDeps:{include:['react','react-dom','react-dom/client']},resolve:{dedupe:['react','react-dom'],alias:[{find:'@',replacement:source},{find:'react-dom',replacement:require.resolve('react-dom').replace(/\/index\.js$/,'')},{find:'react',replacement:require.resolve('react').replace(/\/index\.js$/,'')}]},plugins:[{name:'master-fixture',enforce:'pre',resolveId(id){if(id==='next/navigation')return '\0navigation';if(id==='next/link')return '\0link';if(id.endsWith('/master-data/actions'))return '\0masteractions';},load(id){
 if(id==='\0navigation')return 'export const useSearchParams=()=>new URLSearchParams(window.location.search);';
 if(id==='\0link')return 'import React from "react";export default function Link({children,...props}){return React.createElement("a",props,children)}';
 if(id==='\0masteractions')return `export async function changeMasterLifecycle(form){window.__submitted=Object.fromEntries(form);if(window.__uncertain)throw new Error('fixture transport failure');return {error:'Data masih memiliki pemakaian atau riwayat. Gunakan Nonaktifkan; riwayat dan relasi tetap disimpan'};}`;
}}]});
await server.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const context=await browser.newContext({baseURL:'http://127.0.0.1:3167',viewport:{width:1280,height:900}});
 await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:3167'?route.continue():route.abort());
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?view=inactive&cari=kucing&hal=2&kat=obat');
 const employee=page.locator('section').filter({hasText:'Karyawan contoh'});
 await employee.getByRole('button',{name:'Pindah ke Sampah',exact:true}).click();
 await employee.getByLabel('Alasan').fill('Fictional duplicated employee');
 await employee.getByRole('button',{name:'Konfirmasi',exact:true}).click();
 await employee.getByRole('alert').waitFor();
 assert.equal(await employee.getByLabel('Alasan').inputValue(),'Fictional duplicated employee');
 const payload=await page.evaluate(()=>window.__submitted);
 assert.equal(payload.entity,'employees');assert.equal(payload.action,'trash');assert.equal(payload.revision,'4');assert.equal(payload.filters,'view=inactive&cari=kucing&hal=2&kat=obat');
 assert((await employee.innerText()).includes('tidak mencabut akses login'));
 assert((await employee.innerText()).includes('tidak dihapus permanen'));
 const unit=page.locator('section').filter({hasText:'Satuan contoh'});
 assert.equal(await unit.getByRole('button',{name:'Pindah ke Sampah',exact:true}).count(),0);
 await unit.getByRole('button',{name:'Pulihkan',exact:true}).click();
 assert((await unit.innerText()).includes('daftar Nonaktif'));
 await page.screenshot({path:path.join(evidence,'desktop-referenced-and-restore.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await employee.getByLabel('Alasan').fill('Fictional uncertain outcome');
 await page.evaluate(()=>{window.__uncertain=true;});
 await employee.getByRole('button',{name:'Konfirmasi',exact:true}).click();
 assert((await employee.getByRole('alert').innerText()).includes('belum terkonfirmasi'));
 assert.equal(await employee.getByLabel('Alasan').inputValue(),'Fictional uncertain outcome');
 await page.screenshot({path:path.join(evidence,'mobile-uncertain-outcome.png'),fullPage:true});
 const trash=page.getByRole('link',{name:'Sampah',exact:true});
 const href=await trash.getAttribute('href');
 assert(href.includes('cari=kucing')&&href.includes('kat=obat')&&!href.includes('hal='));
 await trash.click();await page.waitForURL('**/pos/sku?*view=trash*');
 await page.reload();assert(page.url().includes('view=trash')&&page.url().includes('kat=obat'));
 assert.deepEqual(errors,[]);
 console.log('PASS Chromium desktop/390px: confirmation, referenced rejection, retained reason, explicit inactive restore, uncertain outcome, no horizontal overflow, filters after navigation/reload, zero runtime errors. Fictional UI only; no DB writes.');
} finally {await browser.close();await server.close();await fs.rm(root,{recursive:true,force:true});}
