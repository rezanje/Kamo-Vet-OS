// Runs only against the localhost fictional auth/data fixture.
const { chromium } = await import(process.env.KAMO_PLAYWRIGHT_MODULE ?? '/tmp/kamo-browser/node_modules/playwright/index.mjs');
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext();const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const fixture=async patch=>fetch('http://127.0.0.1:54390/fixture',{method:'POST',body:JSON.stringify(patch)});
const a='eb200000-0000-4000-8000-000000000001',b='eb200000-0000-4000-8000-000000000002';
const select=async id=>{await page.selectOption('select[name="branchId"]',id);await page.getByRole('button',{name:'Lanjutkan',exact:true}).click();};
try{
 await fixture({role:'STAFF',active:true,grants:[a,b],shift:null,rules:[],branchFailure:false});
 await page.goto('http://localhost:3001/login');
 await page.locator('input[name="email"]').fill('fictional@test.local');await page.locator('input[name="password"]').fill('fictional-password');
 await page.locator('button[type="submit"]').click();await page.waitForURL('**/mulai');
 console.log('PASS login → mode selection');
 await page.getByText('Klinik',{exact:true}).click();await page.waitForURL('**/mulai/cabang?mode=klinik');
 await select(a);await page.waitForURL('**/klinik');
 assert((await page.locator('body').innerText()).includes('Cabang aktif: A · Fictional Cabang A'));
 console.log('PASS clinic branch selection and visible active context');
 for(let i=0;i<3;i++){await page.reload();assert((await page.locator('body').innerText()).includes('Cabang aktif: A'));}
 console.log('PASS repeated navigation retains context');
 await page.getByRole('link',{name:'Ganti cabang'}).click();await page.waitForURL('**/mulai/cabang?mode=klinik');await select(b);await page.waitForURL('**/klinik');
 assert((await page.locator('body').innerText()).includes('Cabang aktif: B'));console.log('PASS branch switching without shift');
 await fixture({shift:{id:'eb700000-0000-4000-8000-000000000001',branch_id:b,shift_type:'klinik',opening_balance:0,opened_at:new Date().toISOString(),branches:{name:'Fictional Cabang B',code:'B'}}});
 await page.getByRole('link',{name:'Ganti cabang'}).click();await page.waitForURL('**/mulai/cabang?mode=klinik');
 assert(await page.locator(`option[value="${a}"]`).isDisabled());console.log('PASS shift locks branch switching');
 await fixture({shift:null,grants:[a]});await page.goto('http://localhost:3001/klinik/antrian');await page.waitForURL('**/mulai/cabang?mode=klinik');
 assert.equal(await page.locator(`option[value="${b}"]`).count(),0);console.log('PASS revoked branch/direct URL returns to allowed selection');
 await fixture({grants:[]});await page.reload();assert((await page.locator('body').innerText()).includes('Belum ada cabang aktif'));console.log('PASS no assignment feedback');
 await fixture({grants:[a],branchFailure:true});await page.reload();assert((await page.locator('body').innerText()).includes('Cabang gagal dimuat'));console.log('PASS failed branch load and recovery');
 await fixture({branchFailure:false});await page.reload();await select(a);await page.waitForURL('**/klinik');
 await page.goto('http://localhost:3001/mulai');await page.getByText('Petshop',{exact:true}).click();await page.waitForURL('**/mulai/cabang?mode=petshop');await select(a);await page.waitForURL('**/kasir/mulai');
 assert((await page.locator('body').innerText()).includes('Cabang aktif: A'));assert.equal(await page.locator('select[name="branchId"]').inputValue(),a);
 console.log('PASS petshop requires independent selection before opening shift');
 await page.goto('http://localhost:3001/mulai');await page.getByRole('button',{name:'Keluar',exact:true}).click();await page.waitForURL('**/login');
 assert(!(await context.cookies()).some(c=>c.name.startsWith('kamo-branch-')));console.log('PASS logout clears branch context');
 await page.goto('http://localhost:3001/klinik');await page.waitForURL('**/login');console.log('PASS anonymous direct operational navigation');
 assert.deepEqual(errors,[]);console.log('PASS zero browser runtime errors; no business writes performed');
}finally{await browser.close();}
