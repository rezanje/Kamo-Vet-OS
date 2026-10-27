// R05 browser check: save → reload → open in another browser session of the same account.
// Real ReportPresets / ReportColumns components on loopback Chromium; the server actions are replaced
// by an in-process store keyed by account (stands in for private_report_presets + RLS). No login,
// no hosted app, no database. Usage: node scripts/test-report-presets-sessions-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const source=path.resolve('src'),out=path.resolve('docs/evidence/2026-10-27-r05-saved-config'),root=await fs.mkdtemp(path.join(os.tmpdir(),'kamo-r05-sessions-'));
const port=3191,origin=`http://127.0.0.1:${port}`,store=new Map();
await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(root,'index.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/main.tsx"></script>');
await fs.writeFile(path.join(root,'main.tsx'),`import React from 'react';import{createRoot}from'react-dom/client';
import{ReportPresets}from'${source}/components/ReportPresets';import{ReportColumns,ReportColumnsFilterInput}from'${source}/components/ReportColumns';
import{DraftUserProvider}from'${source}/components/LocalTransactionDraft';import{useSearchParams,useRouter}from'next/navigation';
function App(){const query=useSearchParams(),router=useRouter(),month=query.get('periode')||'2026-10',promo=query.get('promo_id')||'';
 return <DraftUserProvider userId={window.__account}><main style={{maxWidth:1000,margin:'auto',padding:12,fontFamily:'Arial'}}>
  <ReportPresets title="Promo"/>
  <form key={query.toString()} data-report-filters onSubmit={event=>{event.preventDefault();router.replace('/laporan/promo?'+new URLSearchParams(new FormData(event.currentTarget)));}}>
   <ReportColumnsFilterInput/>
   <label>Periode<input type="month" name="periode" defaultValue={month}/></label>
   <label>Promo<select name="promo_id" defaultValue={promo}><option value="">Semua promo</option><option value="p1">Promo grooming</option><option value="p2">Promo vaksin</option></select></label>
   <button>Terapkan filter</button>
  </form>
  <ReportColumns><table><thead><tr><th>Barang</th><th>Qty</th><th>Total</th></tr></thead><tbody><tr><td>Jasa fiktif</td><td>2</td><td>300</td></tr></tbody></table></ReportColumns>
 </main></DraftUserProvider>;}
createRoot(document.getElementById('root')).render(<App/>);`);
const actions=`const account=()=>window.__account;
const call=async(method,body)=>{const response=await fetch('/__presets?account='+encodeURIComponent(account()),{method,headers:{'content-type':'application/json'},body:body&&JSON.stringify(body)});return {ok:true,userId:account(),rows:await response.json()};};
export const listPrivateReportPresets=()=>call('GET');
export const savePrivateReportPreset=input=>call('POST',{id:input.id,name:input.name,href:input.href});
export const deletePrivateReportPreset=id=>call('DELETE',{id});`;
const server=await createServer({root,configFile:false,logLevel:'error',oxc:{jsx:{runtime:'automatic'}},
 server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[root,source,path.resolve('node_modules')]}},
 resolve:{dedupe:['react','react-dom'],alias:[{find:'@',replacement:source},{find:'react-dom',replacement:path.dirname(require.resolve('react-dom'))},{find:'react',replacement:path.dirname(require.resolve('react'))}]},
 plugins:[{name:'r05-fixture',enforce:'pre',
  configureServer(dev){dev.middlewares.use('/__presets',(req,res)=>{
   const account=new URL(req.url,origin).searchParams.get('account');let body='';
   req.on('data',chunk=>body+=chunk);req.on('end',()=>{
    const rows=store.get(account)??[];
    if(req.method==='POST'){const row=JSON.parse(body);store.set(account,[{...row,savedAt:new Date().toISOString()},...rows.filter(r=>r.id!==row.id)]);}
    if(req.method==='DELETE'){const {id}=JSON.parse(body);store.set(account,rows.filter(r=>r.id!==id));}
    res.setHeader('content-type','application/json');res.end(JSON.stringify(store.get(account)??[]));
   });
  });},
  resolveId(id){if(id==='next/navigation')return '\0navigation';if(id==='next/link')return '\0link';if(id.includes('laporan/preset-actions'))return '\0actions';},
  load(id){
   if(id==='\0navigation')return `import{useSyncExternalStore}from'react';const listen=cb=>{window.addEventListener('navigate',cb);window.addEventListener('popstate',cb);return()=>{window.removeEventListener('navigate',cb);window.removeEventListener('popstate',cb);}};export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(listen,()=>location.search));export const usePathname=()=>location.pathname;export const useRouter=()=>({replace:href=>{history.replaceState(null,'',href);window.dispatchEvent(new Event('navigate'));}});`;
   if(id==='\0link')return `import React from'react';export default function Link(props){return React.createElement('a',props);}`;
   if(id==='\0actions')return actions;
  }}]});
let browser;
const session=async(account)=>{const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(a=>{window.__account=a;},account);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let external=0;
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external++;return route.abort();});
 return {context,page,errors,external:()=>external};};
const qtyHidden=page=>page.waitForFunction(()=>document.querySelector('thead th:nth-child(2)')?.hidden===true);
const params=page=>page.evaluate(()=>Object.fromEntries(new URLSearchParams(location.search)));
try{
 await server.listen();browser=await chromium.launch();const results={};
 // Browser A: apply promo + month, hide a column, save, reload.
 const a=await session('fictional-finance-a');await a.page.goto(`${origin}/laporan/promo`);
 await a.page.getByLabel('Promo').selectOption('p2');await a.page.getByLabel('Periode').fill('2026-10');await a.page.getByRole('button',{name:'Terapkan filter'}).click();
 await a.page.waitForFunction(()=>location.search.includes('promo_id=p2'));
 await a.page.getByText('Pilih kolom laporan',{exact:true}).click();await a.page.getByRole('checkbox',{name:'Qty',exact:true}).uncheck();
 await a.page.getByRole('button',{name:'Terapkan kolom',exact:true}).click();await qtyHidden(a.page);
 await a.page.getByRole('textbox',{name:'Nama konfigurasi laporan'}).fill('Promo vaksin Oktober');await a.page.getByRole('button',{name:'Simpan konfigurasi'}).click();
 const saved=a.page.getByRole('link',{name:'Promo vaksin Oktober',exact:true});await saved.waitFor();const href=await saved.getAttribute('href');
 assert.match(href,/^\/laporan\/promo\?/);for(const key of ['periode=2026-10','promo_id=p2','kolom='])assert.ok(href.includes(key),`${key} missing in ${href}`);
 await a.page.reload();await a.page.getByRole('link',{name:'Promo vaksin Oktober',exact:true}).waitFor();results.savedAndReloaded=true;
 assert.equal(await a.page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('vetos:report-presets')).length),0);results.notBrowserStorage=true;
 // Month change keeps promo and columns.
 await a.page.getByLabel('Periode').fill('2026-11');await a.page.getByRole('button',{name:'Terapkan filter'}).click();
 await a.page.waitForFunction(()=>location.search.includes('periode=2026-11'));const afterMonth=await params(a.page);
 assert.equal(afterMonth.promo_id,'p2');assert.ok(afterMonth.kolom);await qtyHidden(a.page);results.monthChangeKeepsOtherParams=true;
 // Browser B: same account, fresh storage, opens the saved configuration.
 const b=await session('fictional-finance-a');await b.page.goto(`${origin}/laporan/promo`);
 await b.page.getByRole('link',{name:'Promo vaksin Oktober',exact:true}).click();await b.page.waitForFunction(()=>location.search.includes('promo_id=p2'));
 const opened=await params(b.page);assert.equal(opened.periode,'2026-10');assert.equal(opened.promo_id,'p2');assert.ok(opened.kolom);
 assert.equal(await b.page.getByLabel('Promo').inputValue(),'p2');assert.equal(await b.page.getByLabel('Periode').inputValue(),'2026-10');await qtyHidden(b.page);
 results.otherBrowserSameAccountRestores=true;
 // Browser C: another account sees nothing.
 const c=await session('fictional-finance-b');await c.page.goto(`${origin}/laporan/promo`);await c.page.getByText('Belum ada konfigurasi tersimpan.').waitFor();
 assert.equal(await c.page.getByRole('link',{name:'Promo vaksin Oktober'}).count(),0);results.otherAccountIsolated=true;
 for(const s of [a,b,c]){assert.deepEqual(s.errors,[]);assert.equal(s.external(),0);await s.context.close();}
 results.runtimeErrors=0;results.externalRequests=0;
 results.scope='Component fixture: real ReportPresets/ReportColumns, account-keyed in-process store instead of Supabase. Not an authenticated production/UAT run.';
 await fs.writeFile(path.join(out,'browser-sessions.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
}finally{await browser?.close();await server.close();await fs.rm(root,{recursive:true,force:true});}
