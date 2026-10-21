// Actual PR74 component with fictional actions; no authentication or DB access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KAMO_PLAYWRIGHT_MODULE || '/opt/codex/cua_node/lib/node_modules/playwright');
const source = path.resolve('src');
const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'kamo-priority-import-'));
const output = path.resolve('docs/evidence/2026-10-21-priority-integration');
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(runtime, 'index.html'), '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/main.tsx"></script>');
await fs.writeFile(path.join(runtime, 'main.tsx'), `import React from 'react';import{createRoot}from'react-dom/client';import{InventoryAccountingForm}from'${source}/app/(app)/keuangan/persediaan-awal/InventoryAccountingForm.tsx';
createRoot(document.getElementById('root')).render(<main style={{maxWidth:800,padding:16,margin:'auto'}}><h1>Fixture impor KAMO</h1><p>Data fiktif, tanpa koneksi database.</p><InventoryAccountingForm batches={['new','historical'].map(id=>({id,source_name:id+'.xlsx',status:id==='new'?'previewed':'posted',as_of_date:'2026-01-01',branch_id:'fiction',created_at:''}))} accounts={[{id:'equity',code:'3101',name:'Ekuitas fiktif'}]}/></main>);`);
const server = await createServer({root:runtime,configFile:false,logLevel:'error',oxc:{jsx:{runtime:'automatic'}},
 server:{host:'127.0.0.1',port:3177,strictPort:true,fs:{allow:[runtime,source,path.resolve('node_modules'),'/workspace/kamo-deps']}},
 resolve:{dedupe:['react','react-dom'],alias:[{find:'react-dom',replacement:path.dirname(require.resolve('react-dom'))},{find:'react',replacement:path.dirname(require.resolve('react'))}]},
 plugins:[{name:'fictional-import',enforce:'pre',resolveId(id,importer){if(id==='./actions'&&importer?.endsWith('/InventoryAccountingForm.tsx'))return '\0fictional-import';},load(id){if(id==='\0fictional-import')return `
export async function previewInventoryAccounting(runId){return {ok:true,report:{run_id:runId,status:runId==='new'?'previewed':'posted',source_name:runId+'.xlsx',source_hash:'fiction-only',branch_name:'Cabang fiktif',warehouse_name:'Gudang fiktif',as_of:'2026-01-01',selected_rows:1,excluded_rows:0,original_qty:10,original_value:125,remaining_value:100,inventory_account:{code:'1301',name:'Persediaan'},equity_account:{code:'3101',name:'Ekuitas'},blockers:[],can_post:runId==='new',receipt:null}};}
export async function postInventoryAccounting(input){(window.__attempts??=[]).push(input);if(window.__attempts.length===1)throw new Error('fictional lost response');return{ok:true,receipt:{entry_id:'fictional-journal',run_id:'new'}};}`;}}]});
let browser;
try {
 await server.listen();
 browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page = await browser.newPage({viewport:{width:1280,height:1000}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:3177'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:3177');
 await page.getByLabel('Batch Accurate').selectOption('historical');
 await page.getByLabel('Akun ekuitas').selectOption('equity');
 await page.getByRole('button',{name:'Preview / laporan tanpa posting'}).click();
 await page.getByRole('heading',{name:'Laporan batch historis'}).waitFor();
 assert.equal(await page.locator('textarea').count(),0);
 assert.equal(await page.getByRole('button').count(),2); // report + download only
 await page.screenshot({path:path.join(output,'import-historical.png'),fullPage:true});
 await page.getByLabel('Batch Accurate').selectOption('new');
 await page.getByRole('button',{name:'Preview / laporan tanpa posting'}).click();
 await page.getByRole('heading',{name:'Tinjauan posting batch baru'}).waitFor();
 await page.locator('textarea').fill('Fictional reviewed equity decision');
 await page.locator('input[type=checkbox]').check();
 const post=page.getByRole('button',{name:/Posting stok/});
 await post.click();
 await page.getByRole('button',{name:'Kirim ulang permintaan yang sama'}).waitFor();
 assert.equal(await page.getByLabel('Batch Accurate').isDisabled(),true);
 assert.equal(await page.locator('textarea').inputValue(),'Fictional reviewed equity decision');
 await page.setViewportSize({width:390,height:1000});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(output,'import-uncertain-mobile.png'),fullPage:true});
 await page.getByRole('button',{name:'Kirim ulang permintaan yang sama'}).click();
 await page.getByText('Bukti posting batch tersimpan',{exact:false}).waitFor();
 const attempts=await page.evaluate(()=>window.__attempts);
 assert.equal(attempts.length,2);assert.deepEqual(attempts[0],attempts[1]);assert.deepEqual(errors,[]);
 console.log('PASS real import component: historical report cannot post; lost response retains frozen request; exact retry resolves receipt; desktop/390px no overflow/runtime errors. Fictional actions only.');
} finally { await browser?.close();await server.close(); }
