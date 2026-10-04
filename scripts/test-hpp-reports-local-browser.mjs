#!/usr/bin/env node
// Real GoTrue/PostgREST + browser acceptance against the named fictional LOCAL fixture only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const RUNTIME = "/workspace/hris-local-runtime";
const auth = JSON.parse(fs.readFileSync(`${RUNTIME}/local-auth.json`,"utf8"));
assert.equal(auth.API_URL,"http://127.0.0.1:55421","Refuse remote API");
const APP = "http://127.0.0.1:3109";
const CONTAINER = "supabase_db_vetos_hris_acceptance";
const branch = "b1000000-0000-4000-8000-000000000001";
const warehouse = "b1000000-0000-4000-8000-000000000002";
const options = { auth: { persistSession:false, autoRefreshToken:false } };
const setup = createClient(auth.API_URL,auth.SERVICE_ROLE_KEY,options); // Local fictional AUTH setup only.
const password = "FictionLocalOnly123!";
const env = { ...process.env };
for(const key of ["DOCKER_HOST","DOCKER_CONTEXT","DOCKER_TLS","DOCKER_TLS_VERIFY","DOCKER_CERT_PATH"]) delete env[key];
const sql = query => execFileSync("docker",["--host=unix:///var/run/docker.sock","exec","-i",CONTAINER,"psql","-U","postgres","-At","-v","ON_ERROR_STOP=1"],{ input:query,encoding:"utf8",env }).trim();
const quote = value => `'${String(value).replaceAll("'","''")}'`;
const evidence = { app:APP,api:auth.API_URL,container:CONTAINER,checks:[],fixture:{ branch,warehouse },limits:["Adapted fictional local stack, not production or full Supabase CLI reset.","Report reads are not a transaction snapshot."] };
const pass = label => { evidence.checks.push(label); console.log("PASS:",label); };
let next,browser;
const log = fs.openSync("/workspace/vetos-reports-local-next.log","a");
const oldFinanceRules = JSON.parse(sql("select coalesce(json_agg(module_id),'[]'::json) from role_modules where role='FINANCE'"));
const oldStaffRules = JSON.parse(sql("select coalesce(json_agg(module_id),'[]'::json) from role_modules where role='STAFF'"));
async function result(value,label) { assert.equal(value.error,null,label+": "+(value.error?.message ?? "")); return value.data; }
function parseCsv(csv) {
  return csv.trimEnd().replace(/^\uFEFF/,"").split("\r\n").map(line => line.slice(1,-1).split('","').map(cell => cell.replaceAll('""','"')));
}
const sessions = {};
async function actor(email,role,active=true) {
  const users = await result(await setup.auth.admin.listUsers(),"Local auth users");
  let user = users.users.find(row => row.email === email);
  if(!user) user = (await result(await setup.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:`Fiction reports ${role}`}}),"Create fictional account")).user;
  sql(`update profiles set role=${quote(role)},is_active=${active} where id=${quote(user.id)}`);
  const client = createClient(auth.API_URL,auth.ANON_KEY,options);
  const login = await result(await client.auth.signInWithPassword({email,password}),"Real password login");
  sessions[email] = { client,session:login.session };
  return user.id;
}
async function contextFor(email) {
  const context = await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});
  const session = sessions[email].session;
  const cookie = "base64-"+Buffer.from(JSON.stringify(session)).toString("base64url");
  await context.addCookies([{name:"sb-127-auth-token",value:cookie,domain:"127.0.0.1",path:"/",httpOnly:false,sameSite:"Lax"}]);
  return context;
}
const inventoryPath = `/laporan/nilai-persediaan?cabang=${branch}&gudang=${warehouse}`;
const compoundPath = `/laporan/margin-racikan?cabang=${branch}&dari=2010-01-15&sampai=2010-01-15`;
const downloadPath = route => route.replace("?","/unduh?");
async function download(context,route) {
  const response = await context.request.get(APP+downloadPath(route),{maxRedirects:0});
  assert.equal(response.status(),200,await response.text());
  assert.match(response.headers()["cache-control"],/private.*no-store/);
  return parseCsv(await response.text());
}

try {
  assert.equal(sql("select count(*) from branches where code='QA-PERF'"),"1");
  // Do not infer a payroll schema: snapshot finalized rows as JSON independently.
  const beforePayroll = sql("select coalesce(json_agg(t order by t.id),'[]'::json) from payrolls t");
  sql(fs.readFileSync(path.join(ROOT,"supabase/tests/hpp_reports_local_fixture.sql"),"utf8"));
  assert.equal(sql(`select count(*)||'|'||sum(qty_left*unit_cost) from stock_layers where warehouse_id=${quote(warehouse)}`),"1200|1320000");
  pass("guarded historical LOCAL fixtures:1200 layers at110,1200 active compound lines plus a void line");
  const ownerClient = createClient(auth.API_URL,auth.ANON_KEY,options);
  const ownerLogin = await result(await ownerClient.auth.signInWithPassword({email:"owner@hris-fiction.local",password}),"Existing owner login");
  sessions["owner@hris-fiction.local"] = {client:ownerClient,session:ownerLogin.session};
  await actor("finance@reports-fiction.local","FINANCE");
  await actor("disabled-finance@reports-fiction.local","FINANCE",false);
  await actor("disabled-owner@reports-fiction.local","OWNER",false);
  await actor("admin@reports-fiction.local","ADMIN");
  await actor("staff@reports-fiction.local","STAFF");
  await actor("doctor@reports-fiction.local","DOCTOR");
  sql("delete from role_modules where role='FINANCE'");
  assert.equal((await result(await sessions["finance@reports-fiction.local"].client.from("stock_layers").select("id",{count:"exact"}).eq("warehouse_id",warehouse),"Real capped API")).length,1000);
  pass("real PostgREST cap1000 exists; report reader must span multiple500-row pages");
  next = spawn(process.execPath,[require.resolve("next/dist/bin/next"),"dev","--hostname","127.0.0.1","--port","3109"],{
    cwd:ROOT,env:{...env,NEXT_PUBLIC_SUPABASE_URL:auth.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:auth.ANON_KEY},stdio:["ignore",log,log],
  });
  for(let i=0;i<120;i++) {
    if(next.exitCode!==null) throw new Error("Local Next terminated; inspect local log");
    try { if((await fetch(APP+"/login")).ok) break; } catch {}
    if(i===119) throw new Error("Local Next readiness timeout");
    await new Promise(resolve => setTimeout(resolve,500));
  }
  browser = await chromium.launch({headless:true,executablePath:"/usr/bin/chromium",args:["--no-sandbox","--disable-dev-shm-usage"]});
  const contexts=[];
  for(const email of ["owner@hris-fiction.local","finance@reports-fiction.local"]) {
    const context = await contextFor(email); contexts.push(context);
    const page = await context.newPage(); page.setDefaultTimeout(90000);
    await page.goto(APP+inventoryPath);
    await page.getByText("NILAI PERSEDIAAN FIFO SAAT INI",{exact:true}).waitFor();
    assert.equal(await page.locator("#laporan-isi tbody tr").count(),100);
    const inventory = await download(context,inventoryPath);
    assert.equal(inventory.length-1,1200);
    assert.equal(inventory.slice(1).reduce((sum,row) => sum+Number(row[10]),0),1320000);
    assert.equal(inventory.slice(1).filter(row => Number(row[11])===110).length,1200);
    await page.screenshot({path:`/workspace/vetos-reports-${email.startsWith("owner")?"owner":"finance"}-inventory.png`});
    await page.goto(APP+compoundPath);
    await page.getByText("HPP & MARGIN RACIKAN",{exact:true}).waitFor();
    assert.equal(await page.locator("#laporan-isi tbody tr").count(),100);
    const compounds = await download(context,compoundPath);
    assert.equal(compounds.length-1,1200);
    assert.equal(compounds.slice(1).reduce((sum,row) => sum+Number(row[9]),0),216000);
    assert.equal(compounds.slice(1).reduce((sum,row) => sum+Number(row[10]),0),60000);
    assert.equal(compounds.slice(1).reduce((sum,row) => sum+Number(row[11]),0),156000);
    assert.equal(compounds.slice(1).filter(row => row[6]==="c5000000-0000-4000-8000-000000000001"&&row[7]==="1").length,600);
    assert.equal(compounds.slice(1).filter(row => row[6]==="c5000000-0000-4000-8000-000000000003"&&row[7]===(email.startsWith("finance")?"":"1")).length,600);
    const doctorRows = await download(context,compoundPath+"&dokter="+encodeURIComponent("nama:Fiction Report Doctor A"));
    assert.equal(doctorRows.length-1,600);
    const searchRows = await download(context,compoundPath+"&q="+encodeURIComponent("QA-RPT Compound 0001"));
    assert.equal(searchRows.length-1,1);
    await page.screenshot({path:`/workspace/vetos-reports-${email.startsWith("owner")?"owner":"finance"}-compound.png`});
    pass(`${email}: HTML100 vs CSV1200; FIFO1320000; compound revenue216000/cost60000/profit156000; historical/inactive versions; doctor600/search1`);
    await page.goto(APP+"/laporan");
    assert.equal(await page.locator('a[href="/laporan/nilai-persediaan"]').count(),1);
    assert.equal(await page.locator('a[href="/laporan/margin-racikan"]').count(),1);
  }
  for(const email of ["disabled-finance@reports-fiction.local","disabled-owner@reports-fiction.local","admin@reports-fiction.local","staff@reports-fiction.local","doctor@reports-fiction.local"]) {
    const context = await contextFor(email);contexts.push(context);
    if(email.startsWith("staff")) {
      const response = await context.request.get(APP+downloadPath(inventoryPath),{maxRedirects:0});
      assert.equal(response.status(),307,"Default STAFF module gate denies before export handler");
      assert.equal(new URL(response.headers().location,APP).pathname,"/mulai");
      sql("delete from role_modules where role='STAFF';insert into role_modules(role,module_id)values('STAFF','klinik'),('STAFF','laporan')");
      pass("default STAFF module redirects denied export; local laporan grant exercises additional role guard");
    }
    for(const route of [inventoryPath,compoundPath]) {
      const response = await context.request.get(APP+downloadPath(route),{maxRedirects:0});
      assert.equal(response.status(),403,email+" direct financial export denied");
      assert.match(response.headers()["content-type"],/application\/json/);
    }
    pass(`${email}: both direct sensitive exports403`);
    if(["admin","staff","doctor"].some(role => email.startsWith(role))) {
      const page = await context.newPage();
      await page.goto(APP+"/laporan");
      assert.equal(await page.locator('a[href="/laporan/nilai-persediaan"]').count(),0);
      assert.equal(await page.locator('a[href="/laporan/margin-racikan"]').count(),0);
      pass(`${email}: protected report navigation absent`);
    }
  }
  const financeContext = contexts[1];
  sql("insert into role_modules(role,module_id)values('FINANCE','klinik')");
  for(const route of [inventoryPath,compoundPath]) {
    const response = await financeContext.request.get(APP+downloadPath(route),{maxRedirects:0});
    assert.equal(response.status(),307);
    assert.equal(new URL(response.headers().location,APP).pathname,"/mulai");
    assert.doesNotMatch(response.headers()["content-type"] ?? "",/text\/csv/);
  }
  pass("FINANCE custom module denial: both direct exports redirected307 before handler, no CSV");
  assert.equal(sql("select coalesce(json_agg(t order by t.id),'[]'::json) from payrolls t"),beforePayroll,"Existing HRIS slips unchanged");
  pass("existing HRIS payroll slip rows byte-for-byte unchanged");
  for(const context of contexts) await context.close();
  fs.writeFileSync("/workspace/vetos-reports-local-acceptance.json",JSON.stringify(evidence,null,2));
} finally {
  sql("delete from role_modules where role='FINANCE';"+oldFinanceRules.map(module => `insert into role_modules(role,module_id)values('FINANCE',${quote(module)});`).join(""));
  sql("delete from role_modules where role='STAFF';"+oldStaffRules.map(module => `insert into role_modules(role,module_id)values('STAFF',${quote(module)});`).join(""));
  await browser?.close(); next?.kill("SIGTERM"); fs.closeSync(log);
}
