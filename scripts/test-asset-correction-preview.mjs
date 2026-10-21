#!/usr/bin/env node
// Actual React correction form, fictional action responses, loopback only.
// This verifies browser behavior and produces review screenshots, not SSR/auth/DB integration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'kamo-asset-preview-'));
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
fs.symlinkSync(path.join(root,'node_modules'),path.join(runtime,'node_modules'));
fs.writeFileSync(path.join(runtime,'navigation.ts'),'export const useSearchParams=()=>new URLSearchParams(location.search);');
fs.writeFileSync(path.join(runtime,'actions.ts'),`export async function previewKoreksiAset(form){
 if(String(form.get('alasan')).includes('historis'))return {allowed:false,blockers:['Sudah ada penyusutan. Finance perlu merekonsiliasi jurnal historis sebelum koreksi.']};
 return {allowed:true,blockers:[],harga_before:100000000,harga_after:Number(form.get('harga')),tanggal_before:'${date}',tanggal_after:form.get('tanggal'),monthly_before:2083333,monthly_after:Math.round(Number(form.get('harga'))/48),cash_code:'110299'};
} export async function koreksiPembelianAset(form){window.__assetRecovery={key:form.get('draft_key'),action:form.get('tindakan')};}`);
fs.writeFileSync(path.join(runtime,'preview.css'),fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8').replace('@import "tailwindcss";',''));
fs.writeFileSync(path.join(runtime,'main.tsx'),`import React from 'react';import{createRoot}from'react-dom/client';import{AssetCorrectionForm}from'${root}/src/app/(app)/keuangan/aset/[id]/AssetCorrectionForm.tsx';import'./preview.css';createRoot(document.getElementById('root')).render(<main style={{maxWidth:840,margin:'24px auto',padding:16}}><h1>Pratinjau koreksi aset</h1><p>Data fiktif · formulir asli · tanpa penyimpanan atau koneksi produksi</p><AssetCorrectionForm userId="fictional-owner" assetId="fictional-machine" revision={Number(new URLSearchParams(location.search).get('revision')||0)} tanggal="${date}" harga={100000000}/></main>);`);
fs.writeFileSync(path.join(runtime,'index.html'),'<html lang="id"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/main.tsx"></script></html>');
const server=await createServer({root:runtime,configFile:false,oxc:{jsx:{runtime:'automatic'}},server:{host:'127.0.0.1',port:3187,strictPort:true,fs:{allow:[root,runtime]}},optimizeDeps:{include:['react','react-dom','react-dom/client','react/jsx-runtime']},resolve:{dedupe:['react','react-dom'],alias:{'./correction-actions':path.join(runtime,'actions.ts'),'@':path.join(root,'src'),'next/navigation':path.join(runtime,'navigation.ts')}},plugins:[{name:'fictional-asset-actions',resolveId(source,importer){if(source==='./correction-actions'&&importer?.endsWith('/AssetCorrectionForm.tsx'))return path.join(runtime,'actions.ts');}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1200,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:3187');
 await page.locator('input[name="draft_key"]').waitFor({state:'attached'});
 await page.waitForFunction(()=>document.querySelector('input[name="draft_key"]')?.value);
 const key=await page.locator('input[name="draft_key"]').inputValue();
 await page.locator('input[name="harga"]').fill('10000000');await page.locator('textarea[name="alasan"]').fill('Salah input nominal pembelian');
 assert.equal(await page.getByRole('button',{name:'Simpan koreksi'}).isDisabled(),true);
 await page.getByRole('button',{name:'Lihat dampak koreksi'}).click();
 await page.getByText('Penyusutan bulanan:',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Simpan koreksi'}).isEnabled(),true);
 await page.screenshot({path:path.join(runtime,'desktop-preview.png'),fullPage:true});
 await page.goto('http://127.0.0.1:3187/?revision=1');await page.waitForFunction(()=>document.querySelector('input[name="harga"]')?.value==='10000000');
 assert.equal(await page.locator('input[name="draft_key"]').inputValue(),key);
 assert.equal(await page.locator('input[name="revision"]').inputValue(),'1');
 assert.equal(await page.getByRole('button',{name:'Simpan koreksi'}).isDisabled(),true);
 await page.setViewportSize({width:390,height:1000});await page.locator('textarea[name="alasan"]').fill('Koreksi historis');
 await page.getByRole('button',{name:'Lihat dampak koreksi'}).click();await page.getByText('Sudah ada penyusutan.',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Simpan koreksi'}).isDisabled(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(runtime,'mobile-blocked.png'),fullPage:true});
 await page.locator('textarea[name="alasan"]').fill('');await page.getByRole('button',{name:'Periksa hasil terakhir'}).click();

 await page.waitForFunction(()=>window.__assetRecovery);
 assert.deepEqual(await page.evaluate(()=>window.__assetRecovery),{key,action:'periksa'});
 assert.deepEqual(errors,[]);console.log('PASS: browser preview, refresh identity, dependency block, mobile overflow');console.log('Screenshots: '+runtime);
}finally{await browser?.close();await server.close();}
