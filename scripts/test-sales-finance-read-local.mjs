#!/usr/bin/env node
// Local-only financial read check against a fixture created by the sales browser harness.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {createClient}=require('@supabase/supabase-js');const {chromium}=require('playwright');
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const APP='http://127.0.0.1:3111';
const fixturePath=process.argv[2];
assert.match(fixturePath??'',/^\/tmp\/vetos-sales-browser-[a-f0-9]+\/fixture\.json$/,'Require an explicitly fictional local sales fixture');
const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
const status=JSON.parse(fs.readFileSync('/workspace/hris-local-runtime/local-auth.json','utf8'));
assert.equal(status.API_URL,'http://127.0.0.1:55421','Refuse unknown or remote API');
const env={...process.env};for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[k];
const sql=s=>execFileSync('docker',['--host=unix:///var/run/docker.sock','exec','-i','supabase_db_vetos_hris_acceptance','psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'],{input:s,encoding:'utf8',env}).trim();
const q=s=>`'${String(s).replaceAll("'","''")}'`;
assert.match(sql(`select code from branches where id=${q(fixture.ids.branch)}`),/^FSALE-/);
assert.equal(sql("select count(*)from role_modules where role='FINANCE'"),'0','This default-role test requires no shared custom FINANCE module rows');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options);const finance=createClient(status.API_URL,status.ANON_KEY,options);
const value=(r,label)=>{assert.equal(r.error,null,`${label}: ${r.error?.message??''}`);return r.data;};
const token=randomUUID().slice(0,8);const email=`sales-finance-${token}@fiction-sales.local`;const password='FictionSalesOnly123!';
const logPath=path.dirname(fixturePath)+'/finance-next.log';const log=fs.openSync(logPath,'a');let next,browser,context;
try{
  const user=value(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:`Fiction finance ${token}`}}),'Create fictional finance user').user;
  value(await admin.from('profiles').update({role:'FINANCE',is_active:true}).eq('id',user.id),'Set FINANCE role');
  value(await finance.auth.signInWithPassword({email,password}),'Real finance JWT');
  const expected=value(await admin.from('sales_invoices').select('id,no_faktur,total').eq('order_id',fixture.ids.order),'Privileged fixture invoice');
  const visible=value(await finance.from('sales_invoices').select('id,no_faktur,total').eq('order_id',fixture.ids.order),'Default FINANCE AR read');
  assert.deepEqual(visible,expected);assert.equal(visible.length,1);assert.ok(Number(visible[0].total)>0,'Receivable must not disappear');
  const denied=await finance.rpc('sales_create_invoice',{p_order_id:fixture.ids.order,p_request_key:`finance-denied-${token}`,p_header:{tanggal:'2035-01-10'},p_items:[{order_item_id:fixture.ids.line,qty:1}]});
  assert.equal(denied.error?.code,'42501','FINANCE without sales module cannot post');
  console.log('PASS: default FINANCE real PostgREST reads the AR invoice and cannot post a sales invoice');
  const ready=await fetch(APP+'/login').then(r=>r.ok).catch(()=>false);
  if(!ready)next=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3111'],{cwd:ROOT,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:status.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:status.ANON_KEY},stdio:['ignore',log,log]});
  for(let i=0;i<120;i++){
    if(await fetch(APP+'/login').then(r=>r.ok).catch(()=>false))break;
    if(i===119)throw new Error('Local sales app did not start');await new Promise(r=>setTimeout(r,500));
  }
  browser=await chromium.launch({headless:true,executablePath:process.env.SALES_CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
  context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(60000);
  await page.goto(APP+'/login');await page.locator('input[name=email]').fill(email);await page.locator('input[name=password]').fill(password);
  await Promise.all([page.waitForURL('**/mulai'),page.getByRole('button',{name:'Masuk',exact:true}).click()]);
  await page.goto(APP+'/keuangan/piutang');await page.getByText(visible[0].no_faktur,{exact:true}).waitFor();
  await page.screenshot({path:path.dirname(fixturePath)+'/finance-ar.png',fullPage:true});
  console.log('PASS: actual default FINANCE /keuangan/piutang page includes the sales invoice');
  value(await admin.from('profiles').update({is_active:false}).eq('id',user.id),'Disable own fictional finance user');
  assert.deepEqual(value(await finance.from('sales_invoices').select('id').eq('order_id',fixture.ids.order),'Disabled finance read'),[]);
  console.log('PASS: disabled FINANCE valid JWT cannot read the invoice');
  console.log('Finance screenshot:',path.dirname(fixturePath)+'/finance-ar.png');
}finally{await context?.close();await browser?.close();if(next)next.kill('SIGTERM');fs.closeSync(log);}
