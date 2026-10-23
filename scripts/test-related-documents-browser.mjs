// Actual server pages, loopback Chromium, fictional user-scoped query boundary.
// No live Supabase, financial actions, RPC, migrations, credentials or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
let playwright;
try{playwright=require('playwright')}catch(error){
 if(error.code!=='MODULE_NOT_FOUND')throw error;
 playwright=require('/opt/codex/cua_node/lib/node_modules/playwright');
}
const {chromium}=playwright;
const {SearchParamsContext}=require('next/dist/shared/lib/hooks-client-context.shared-runtime');
const integration=process.env.KAMO_FEEDBACK_INTEGRATION==='1';
const evidence=path.resolve(integration?'docs/evidence/2026-10-23-feedback-integration/browser':'docs/evidence/2026-10-22-n01');
await fs.mkdir(evidence,{recursive:true});
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const fixture=`
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
let denied=false;export function configure(value){denied=value}
const receipts=[{id:id(2),no_terima:'GR-ONE',tanggal:'2026-10-22'},{id:id(3),no_terima:'GR-TWO',tanggal:'2026-10-22'}];
const po={id:id(1),no_po:'PO-1',tanggal:'2026-10-22',status:'Diterima',total:100,branch_id:id(99),purchase_order_items:[],goods_receipts:receipts,purchase_advances:[{id:id(4),no_um:'DP-ONE',status:'aktif'}]};
const pay=(n,rest={})=>({id:id(n),tanggal:'2026-10-22',amount:10,metode:'Transfer',revision:0,...rest});
const payments=[pay(11,{voided_at:'2026-10-22'}),pay(12,{reversal_of:id(11),amount:-10}),pay(13,{replaces_payment_id:id(11),advance_id:id(4),advance:{id:id(4),no_um:'DP-ONE',status:'aktif'},payment_order_id:id(30),payment_order:{id:id(30),no_pp:'PP-ONE',status:'dibayar'}})];
const salesReceipts=[{id:id(41),no_terima:'SPLIT-CASH',tanggal:'2026-10-22',jumlah:20,dari_uang_muka:0,metode:'Tunai'}, {id:id(42),no_terima:'SPLIT-DP',tanggal:'2026-10-22',jumlah:30,dari_uang_muka:10,metode:'Transfer',advance_id:id(43),advance:{id:id(43),no_um:'SALES-DP',status:'aktif'}}];
export async function createClient(){return {auth:{getUser:async()=>({data:{user:{id:'fictional-admin'}}})},from(table){
 let single=false;const filters={};
 const q={select(){return q},eq(k,v){filters[k]=v;return q},in(){return q},is(){return q},gt(){return q},order(){return q},limit(){return q},range(){return q},maybeSingle(){single=true;return q},then(resolve){
 let data=[];
 if(table==='profiles')data={role:'ADMIN',is_active:true};
 if(table==='company_settings')data={ppn_rate:11};
 if(table==='purchase_orders')data=single?po:[];
 if(table==='goods_receipts')data=single?{...(receipts.find(r=>r.id===filters.id)??receipts[0]),po_id:po.id,purchase_orders:denied?null:po,goods_receipt_items:[]}:receipts;
 if(table==='purchase_invoices')data=single?(filters.replaces_invoice_id?null:{id:filters.id,no_faktur:'INV-1',total:100,tanggal:'2026-10-22',jatuh_tempo:'2026-11-22',po_id:po.id,purchase_orders:denied?null:po,replaces_invoice_id:id(20),original:denied?null:{id:id(20),no_faktur:'INV-ORIGINAL',voided_at:'2026-10-22'},purchase_invoice_items:[],purchase_invoice_payments:payments.map(p=>denied?{...p,advance:null,payment_order:null}:p)}):[{id:id(10),no_faktur:'INV-1',voided_at:null}];
 if(table==='purchase_invoices'&&single&&filters.id===id(20))data=denied?null:{id:id(20),no_faktur:'INV-ORIGINAL',voided_at:'2026-10-22'};
 if(table==='sales_invoices')data=single?{id:id(40),no_faktur:'SI-1',order_id:null,total:100,carried_paid:0,status:'berjalan',tanggal:'2026-10-22',jatuh_tempo:'2026-11-22'}:[{id:id(40),no_faktur:'SI-1',total:100,carried_paid:0,status:'berjalan',sales_receipts:salesReceipts.map(r=>denied?{...r,advance:null}:r)}];
 if(table==='purchase_advances')data=[{id:id(4),no_um:'DP-ONE',tanggal:'2026-10-22',jumlah:100,terpakai:10,status:'aktif',metode:'Transfer'}];
 if(table==='sales_advances')data=[{id:id(43),no_um:'SALES-DP',tanggal:'2026-10-22',jumlah:100,terpakai:10,status:'aktif'}];
 if(table==='payment_orders')data=[{id:id(30),no_pp:'PP-ONE',tanggal:'2026-10-22',status:'dibayar',total:10,payment_order_items:[]}];
 resolve({data,count:Array.isArray(data)?data.length:1,error:null});return Promise.resolve();
 }};return q;
 }}}
`;
const source=path.resolve('src');
const vite=await createServer({root:path.resolve('.'),configFile:false,logLevel:'error',oxc:{jsx:{runtime:'automatic'},tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}}},server:{middlewareMode:true},resolve:{alias:[{find:'@',replacement:source}]},plugins:[{name:'n01-fixture',enforce:'pre',resolveId(name){
 if(name==='@/lib/supabase/server'||name.endsWith('/lib/supabase/server'))return '\0n01-db';
 if(name==='next/link')return '\0n01-link';
 if(name==='@/lib/master-guard'||name.endsWith('/lib/master-guard'))return '\0n01-guard';
 if(name==='@/components/dokumen/DokumenPanel'||name.endsWith('/components/dokumen/DokumenPanel'))return '\0n01-panel';
 if(name.endsWith('POCorrectionForm')||name.endsWith('InvoiceCorrectionForm')||name.endsWith('PaymentCorrectionForm')||name.endsWith('WholesaleCorrectionForm'))return '\0n01-corrections';
 },load(name){
 if(name==='\0n01-db')return fixture;
 if(name==='\0n01-link')return 'import React from "react";export default function Link({children,...props}){return React.createElement("a",props,children)}';
 if(name==='\0n01-guard')return 'export async function bolehTransaksiKas(){return false}export async function bolehKelolaMaster(){return false}export async function assertRole(){throw Error("Financial action forbidden in browser fixture")}';
 if(name==='\0n01-panel')return 'export function DokumenPanel(){return null}';
 if(name==='\0n01-corrections')return 'export const POEditForm=()=>null;export const POCancelForm=()=>null;export const InvoiceCorrectionForm=()=>null;export const PaymentCorrectionForm=()=>null;export const WholesaleCorrectionForm=()=>null;';
 }}]});
let server,browser;
try{
 const paths={po:'/src/app/(app)/pembelian/[id]/page.tsx',receipt:'/src/app/(app)/pembelian/penerimaan/[id]/page.tsx',invoice:'/src/app/(app)/pembelian/faktur/[id]/page.tsx',sales:'/src/app/(app)/penjualan/faktur/[id]/page.tsx',advance:'/src/app/(app)/pembelian/uang-muka/page.tsx',salesAdvance:'/src/app/(app)/penjualan/uang-muka/page.tsx',order:'/src/app/(app)/pembelian/perintah-bayar/page.tsx'};
 const pages=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([key,p])=>[key,(await vite.ssrLoadModule(p)).default])));
 const db=await vite.ssrLoadModule('\0n01-db');
 const {ActivityNavigationProvider}=await vite.ssrLoadModule('/src/components/ActivityHistoryLink.tsx');
 const css=(await fs.readFile('src/app/globals.css','utf8')).replace(/@import[^;]+;/g,'').replace(/@theme inline\s*\{[^}]*\}/g,'');
 const errors=[];
 server=http.createServer(async(req,res)=>{try{
 if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return}
 const u=new URL(req.url,'http://127.0.0.1');db.configure(u.searchParams.has('denied'));
 const route=u.pathname.startsWith('/pembelian/penerimaan/')?'receipt':u.pathname.startsWith('/pembelian/faktur/')?'invoice':u.pathname.startsWith('/penjualan/faktur/')?'sales':u.pathname==='/pembelian/uang-muka'?'advance':u.pathname==='/penjualan/uang-muka'?'salesAdvance':u.pathname==='/pembelian/perintah-bayar'?'order':'po';
 const content=await pages[route]({params:Promise.resolve({id:u.pathname.split('/').at(-1)}),searchParams:Promise.resolve(Object.fromEntries(u.searchParams))});
 const html=renderToStaticMarkup(createElement(SearchParamsContext.Provider,{value:u.searchParams},createElement(ActivityNavigationProvider,{allowed:integration},content)));
 res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<!doctype html><html lang="id"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'\n*{box-sizing:border-box}body{margin:0;background:#f0ede8;font-family:Arial,sans-serif}.ct{padding:18px;max-width:1280px;margin:auto}p{overflow-wrap:anywhere}td{vertical-align:top}</style><main class="ct">'+html+'</main></html>');
 }catch(e){errors.push(String(e));res.writeHead(500);res.end(String(e))}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const context=await browser.newContext({baseURL:origin,viewport:{width:1280,height:900}});await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/pembelian/'+id(1));
 if(integration)assert.equal(await page.getByRole('link',{name:'Riwayat aktivitas'}).count(),1);
 for(const label of ['Penerimaan GR-ONE','Penerimaan GR-TWO','Faktur INV-1','Uang muka DP-ONE'])assert.equal(await page.getByRole('link',{name:label,exact:true}).count(),1,label+' '+await page.locator('body').innerText());
 await page.getByRole('link',{name:'Penerimaan GR-TWO',exact:true}).click();assert(page.url().includes('/pembelian/penerimaan/'+id(3)));assert((await page.locator('main').innerText()).includes('PO yang sama'));
 await page.getByRole('link',{name:'Faktur INV-1',exact:true}).click();
 if(integration)assert.equal(await page.getByRole('link',{name:'Riwayat aktivitas'}).count(),4);
 for(const n of [11,12,13])assert.equal(await page.locator('#payment-'+id(n)).count(),1);
 if(integration)assert.equal(await page.locator('a[href*=\"purchase_invoice_payments\"]').count(),3);
 const payment=page.locator('#payment-'+id(13));await payment.getByRole('link',{name:'Uang muka DP-ONE',exact:true}).click();assert(page.url().endsWith('#advance-'+id(4)));assert.equal(await page.locator('#advance-'+id(4)).count(),1,await page.locator('body').innerText());
 await page.getByRole('link',{name:'Kembali ke transaksi asal'}).click();assert(page.url().endsWith('#payment-'+id(13)));
 await page.locator('#payment-'+id(13)).getByRole('link',{name:'Perintah bayar PP-ONE',exact:true}).click();assert(page.url().endsWith('#payment-order-'+id(30)));assert.equal(await page.locator('#payment-order-'+id(30)).count(),1);await page.getByRole('link',{name:'Kembali ke transaksi asal'}).click();
 await page.screenshot({path:path.join(evidence,'purchase-desktop.png'),fullPage:true});
 await page.goto('/penjualan/faktur/'+id(40));for(const n of [41,42])assert.equal(await page.locator('#receipt-'+id(n)).count(),1);
 await page.getByRole('link',{name:'SPLIT-DP',exact:true}).click();assert(page.url().endsWith('#receipt-'+id(42)));
 await page.getByRole('link',{name:'Uang muka SALES-DP',exact:true}).click();assert.equal(await page.locator('#advance-'+id(43)).count(),1,await page.locator('body').innerText());await page.getByRole('link',{name:'Kembali ke transaksi asal'}).click();assert(page.url().endsWith('#receipt-'+id(42)));
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(evidence,'sales-mobile.png'),fullPage:true});
 await page.getByRole('link',{name:'Uang muka SALES-DP',exact:true}).click();assert.equal(await page.locator('#advance-'+id(43)).count(),1);await page.getByRole('link',{name:'Kembali ke transaksi asal'}).click();assert(page.url().endsWith('#receipt-'+id(42)));
 await page.goto('/pembelian/faktur/'+id(10));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(evidence,'purchase-mobile.png'),fullPage:true});
 await page.goto('/pembelian/faktur/'+id(10)+'?denied=1');const text=await page.locator('main').innerText();assert(text.includes('tidak tersedia atau tidak dapat diakses'));assert(!text.includes('INV-ORIGINAL')&&!text.includes('PP-ONE')&&!text.includes('DP-ONE'));
 assert.deepEqual(errors,[]);console.log('PASS actual detail/list pages: two receipts, PO-linked invoice grouping, every purchase payment/reversal/replacement anchor, exact DP/payment-order destination and return, split sales receipt/DP links, unavailable-source redaction, desktop/390px mobile. Fictional query boundary; no live auth/DB or mutations.');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await vite.close()}
