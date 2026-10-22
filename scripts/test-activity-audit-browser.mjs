// Actual server page with a fictional query boundary; loopback-only browser.
// Does not authenticate to Supabase, call business APIs, or mutate a database.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KAMO_PLAYWRIGHT_MODULE ?? 'playwright');
const evidence = path.resolve('docs/evidence/2026-10-22-a01');
await fs.mkdir(evidence, { recursive: true });
const source = path.resolve('src');
const css = (await fs.readFile('src/app/globals.css', 'utf8')).replace(/@import[^;]+;/g, '').replace(/@theme inline\s*\{[^}]*\}/g, '');
const fixture = `
let failure=false;let role='OWNER';
export function configure(f,r){failure=f;role=r??'OWNER'}
const rows=Array.from({length:95},(_,i)=>{const n=95-i;const customer=n%5===0;return {
 id:n,occurred_at:'2026-10-22T00:00:00Z',actor_id:'fictional-owner',actor_name:'Pemilik Fiktif',actor_kind:'user',
 entity:customer?'customers':'sales_orders',entity_id:customer?'customer-'+n:'order-'+Math.ceil(n/3),
 entity_ids:[customer?'customer-'+n:'order-'+Math.ceil(n/3)],row_entity:customer?'customers':'sales_orders',row_id:'row-'+n,
 object_label:customer?'customer-'+n:'SO-FIKTIF-'+n,module_id:customer?'crm':'penjualan',action:n%2===0?'delete':'update',
 changed_fields:['total','catatan'],before_state:{total:n*10},after_state:n%2===0?{}:{total:n*10+1}
 }}).map(r=>{
 if(r.id===94){r.row_entity='sales_receipts';r.row_id='receipt-94'}
 if(r.id===93){Object.assign(r,{entity:'visits',entity_id:'visit-93',entity_ids:['visit-93'],row_entity:'medical_records',row_id:'medical-93',object_label:'visit-93',module_id:'klinik',changed_fields:['metadata'],before_state:{},after_state:{}})}
 if(r.id===92){const composite=JSON.stringify({month_start:'2026-10-01',warehouse_id:'00000000-0000-4000-8000-000000000001',item_id:'00000000-0000-4000-8000-000000000002',costing_method:'MOVING_AVERAGE'});Object.assign(r,{entity:'inventory_month_values',entity_id:composite,entity_ids:[composite],row_entity:'inventory_month_values',row_id:composite,object_label:'Nilai persediaan fiktif',module_id:'pos',changed_fields:['metadata'],before_state:{},after_state:{}})}
 r.object_refs=[{entity:r.entity,id:r.entity_id},{entity:r.row_entity,id:r.row_id}];r.object_entities=[r.entity,r.row_entity];return r;
 });
export async function createClient(){return {auth:{getUser:async()=>({data:{user:{id:'fictional-owner'}}})},from(table){
 let data=rows;let ascending=false;let limit=41;
 const q={select(){return q},maybeSingle(){return Promise.resolve({data:{role,is_active:true}})},
 eq(k,v){data=data.filter(r=>r[k]===v);return q},contains(k,v){data=data.filter(r=>v.every(x=>r[k].some(y=>typeof x==='object'?JSON.stringify(x)===JSON.stringify(y):x===y)));return q},
 lt(k,v){data=data.filter(r=>r[k]<Number(v));return q},gt(k,v){data=data.filter(r=>r[k]>Number(v));return q},
 gte(k,v){data=data.filter(r=>Date.parse(r[k])>=Date.parse(v));return q},lte(k,v){data=data.filter(r=>Date.parse(r[k])<=Date.parse(v));return q},
 ilike(k,v){const term=v.slice(1,-1).replace(/\\\\([%_\\\\])/g,'$1').toLowerCase();data=data.filter(r=>r[k].toLowerCase().includes(term));return q},
 order(k,o){ascending=o.ascending;return q},limit(n){limit=n;return q},
 then(resolve){resolve({data:failure?null:[...data].sort((a,b)=>ascending?a.id-b.id:b.id-a.id).slice(0,limit),error:failure?{message:'internal fixture secret'}:null})}};return q
 }}}
`;
const vite = await createServer({ root: path.resolve('.'), configFile: false, logLevel: 'error',
  oxc: { jsx: { runtime: 'automatic' }, tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } } },
  server: { middlewareMode: true }, resolve: { alias: [{ find: '@', replacement: source }] },
  plugins: [{ name: 'activity-fictional-server', enforce: 'pre', resolveId(id) {
    if (id === '@/lib/supabase/server' || id.endsWith('/lib/supabase/server')) return '\0activity-db';
    if (id === 'next/link') return '\0activity-link';
  }, load(id) {
    if (id === '\0activity-db') return fixture;
    if (id === '\0activity-link') return 'import React from "react";export default function Link({children,...props}){return React.createElement("a",props,children)}';
  } }],
});
let server;
let browser;
try {
 const { default: Page } = await vite.ssrLoadModule('/src/app/(app)/perusahaan/log-aktifitas/page.tsx');
 const db = await vite.ssrLoadModule('\0activity-db');
 const errors=[];
 server=http.createServer(async(req,res)=>{try{
  if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return}
  const url=new URL(req.url,'http://127.0.0.1');
  db.configure(url.searchParams.has('failure'),url.searchParams.get('reader'));
  const tree=await Page({searchParams:Promise.resolve(Object.fromEntries(url.searchParams))});
  const html=renderToStaticMarkup(tree);
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
  res.end('<!doctype html><html lang="id"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'\n*{box-sizing:border-box}body{margin:0;background:#f0ede8;font-family:Arial,sans-serif}.ct{padding:18px;max-width:1280px;margin:auto}td{vertical-align:top}input,select{max-width:100%}</style><main class="ct">'+html+'</main></html>');
 }catch(e){errors.push(String(e));res.writeHead(500);res.end('Fixture render failure')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({baseURL:origin,viewport:{width:1280,height:900}});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/perusahaan/log-aktifitas');
 assert.equal(await page.locator('tbody tr').count(),40);
 await page.getByRole('link',{name:'Lebih lama',exact:true}).click();
 assert(page.url().includes('before=56'));
 assert.equal(await page.locator('tbody tr').count(),40);
 await page.getByRole('link',{name:'Lebih baru',exact:true}).click();
 assert(page.url().includes('after=55'));
 assert((await page.locator('tbody tr').first().innerText()).includes('customer-95'));
 await page.getByLabel('Modul',{exact:true}).selectOption('penjualan');
 await page.getByLabel('Aksi',{exact:true}).selectOption('delete');
 await page.getByRole('button',{name:'Terapkan'}).click();
 assert(!page.url().includes('before=')&&!page.url().includes('after='));
 assert((await page.locator('tbody').innerText()).includes('Dihapus'));
 assert(!(await page.locator('tbody').innerText()).includes('CRM'));
 await page.locator('tbody tr').first().locator('summary').click();
 assert((await page.locator('tbody tr').first().innerText()).includes('nilai disamarkan'));
 await page.screenshot({path:path.join(evidence,'activity-desktop-filtered.png'),fullPage:true});
 await page.locator('tbody tr').first().getByRole('link').first().click();
 assert(page.url().includes('entity=sales_orders')&&page.url().includes('object=order-'));
 assert((await page.locator('main').innerText()).includes('Riwayat Pesanan Penjualan'));
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(evidence,'activity-mobile-object.png'),fullPage:true});
 await page.goto('/perusahaan/log-aktifitas?entity=sales_receipts');
 assert.equal(await page.locator('tbody tr').count(),1);
 assert((await page.locator('tbody').innerText()).includes('receipt-94'));
 await page.getByRole('link',{name:'receipt-94',exact:true}).click();
 assert(page.url().includes('entity=sales_receipts')&&page.url().includes('object=receipt-94'));
 assert.equal(await page.locator('tbody tr').count(),1);
 await page.goto('/perusahaan/log-aktifitas?entity=medical_records&object=medical-93');
 assert((await page.locator('tbody').innerText()).includes('Aktivitas tercatat; rincian isi disamarkan.'));
 assert.equal(await page.locator('tbody details').count(),0);
 await page.goto('/perusahaan/log-aktifitas?entity=inventory_month_values');
 const longIdentity=await page.locator('tbody tr').first().getByRole('link').last().innerText();
 assert(longIdentity.length>120);
 await page.locator('tbody tr').first().getByRole('link').last().click();
 assert.equal(new URL(page.url()).searchParams.get('object'),longIdentity);
 assert((await page.locator('tbody').innerText()).includes('Nilai persediaan fiktif'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(evidence,'activity-mobile-composite.png'),fullPage:true});
 await page.goto('/perusahaan/log-aktifitas?failure=1');
 assert((await page.getByRole('alert').innerText()).includes('Riwayat belum dapat dimuat'));
 assert(!(await page.locator('main').innerText()).includes('internal fixture secret'));
 await page.goto('/perusahaan/log-aktifitas?reader=STAFF');
 assert((await page.getByRole('alert').innerText()).includes('OWNER/ADMIN aktif'));
 assert.deepEqual(errors,[]);
 console.log('PASS actual server-page Chromium: 40-row cursor pagination both directions, filter reset/preservation, retained deleted-object history, nested financial source lookup, metadata privacy, long composite identity, redaction, 390px no page overflow, failed-load and denied-role feedback. Fictional boundary only.');
} finally {
 await browser?.close();
 if(server)await new Promise(resolve=>server.close(resolve));
 await vite.close();
}
