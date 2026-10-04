#!/usr/bin/env node
// Fictional LOCAL acceptance with real GoTrue/PostgREST and browser cookies.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = '/workspace/hris-local-runtime';
const CLI = process.env.HRIS_LOCAL_SUPABASE_CLI ?? 'supabase';
const APP = 'http://127.0.0.1:3108';
const CONTAINER = 'supabase_db_vetos_hris_acceptance';
const status = fs.existsSync(RUNTIME+'/local-auth.json')
  ? JSON.parse(fs.readFileSync(RUNTIME+'/local-auth.json','utf8'))
  : JSON.parse(execFileSync(CLI, ['status', '--workdir', RUNTIME, '-o', 'json'], { encoding:'utf8', stdio:['ignore','pipe','ignore'] }));
const API = status.API_URL ?? status.api_url;
assert.equal(API, 'http://127.0.0.1:55421', 'Refuse any unknown/remote API');
const ANON = status.ANON_KEY ?? status.anon_key;
const SERVICE = status.SERVICE_ROLE_KEY ?? status.service_role_key;
assert.ok(ANON && SERVICE, 'Local-only generated auth keys required');
const options = { auth: { persistSession:false, autoRefreshToken:false } };
const admin = createClient(API, SERVICE, options);
const password = 'FictionLocalOnly123!';
const ids = {
  branchA:'a1000000-0000-4000-8000-000000000001', branchB:'a1000000-0000-4000-8000-000000000002',
  employeeA:'a2000000-0000-4000-8000-000000000001', employeeB:'a2000000-0000-4000-8000-000000000002', employeeC:'a2000000-0000-4000-8000-000000000003',
  shiftA:'a3000000-0000-4000-8000-000000000001', shiftB:'a3000000-0000-4000-8000-000000000002',
};
const env = {...process.env};
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete env[key];
const sql = query => execFileSync('docker', ['--host=unix:///var/run/docker.sock','exec','-i',CONTAINER,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'], { input:query,encoding:'utf8',env }).trim();
const q = value => `'${String(value).replaceAll("'","''")}'`;
const pass = label => console.log('PASS:',label);
const roles = ['owner','adminA','adminB','staffA','staffB','staffC'];
const users = {}, clients = {};
async function value(result, label) { assert.equal(result.error,null,label+': '+(result.error?.message??'')); return result.data; }
async function rpc(client,name,args) { return value(await client.rpc(name,args),name); }
async function deny(client,name,args,pattern) { const result = await client.rpc(name,args); assert.ok(result.error,name+' must reject'); if(pattern) assert.match(result.error.message,pattern); }
const today = sql("select(statement_timestamp()at time zone'Asia/Jakarta')::date");
const tomorrow = sql("select(statement_timestamp()at time zone'Asia/Jakarta')::date+1");
const period = today.slice(0,7);

async function seed() {
  const resume = process.argv.includes('--resume-fixture');
  assert.equal(sql('select count(*)from public.employees'),resume?'3':'0','Run only on an empty fictional local DB, or resume its explicit fixture');
  const existing = resume ? await value(await admin.auth.admin.listUsers(), 'Existing fictional users') : null;
  for (const role of roles) {
    const user = resume ? {user:existing.users.find(u=>u.email===`${role.toLowerCase()}@hris-fiction.local`)}
      : await value(await admin.auth.admin.createUser({ email:`${role.toLowerCase()}@hris-fiction.local`,password,email_confirm:true,user_metadata:{full_name:`Fiction ${role}`} }), 'Create '+role);
    users[role] = user.user.id;
    clients[role] = createClient(API,ANON,options);
    await value(await clients[role].auth.signInWithPassword({email:`${role.toLowerCase()}@hris-fiction.local`,password}), 'Login '+role);
  }
  if(!resume) sql(`update profiles set role='OWNER'where id=${q(users.owner)};
    update profiles set role='ADMIN'where id in(${q(users.adminA)},${q(users.adminB)});
    insert into branches(id,code,name,type,lat,lng,radius_m)values
    (${q(ids.branchA)},'FIC-HR-A','Fiction HR branch A','KLINIK',-6,106,500),
    (${q(ids.branchB)},'FIC-HR-B','Fiction HR branch B','KLINIK',-7,107,500);
    insert into user_branches(user_id,branch_id,effective_date)values
    (${q(users.adminA)},${q(ids.branchA)},'2026-01-01'),(${q(users.adminB)},${q(ids.branchB)},'2026-01-01'),
    (${q(users.staffA)},${q(ids.branchA)},'2026-01-01'),(${q(users.staffB)},${q(ids.branchA)},'2026-01-01'),(${q(users.staffC)},${q(ids.branchB)},'2026-01-01');
    insert into employees(id,nama,profile_id,branch_id,gaji_pokok,nik,jabatan)values
    (${q(ids.employeeA)},'Fiction Alice',${q(users.staffA)},${q(ids.branchA)},1000000,'FIC-A','Kasir'),
    (${q(ids.employeeB)},'Fiction Bob',${q(users.staffB)},${q(ids.branchA)},2000000,'FIC-B','Kasir'),
    (${q(ids.employeeC)},'Fiction Carol',${q(users.staffC)},${q(ids.branchB)},3000000,'FIC-C','Kasir');
    insert into employee_branch_assignments(employee_id,branch_id,role,effective_date)select id,branch_id,'PRIMARY','2026-01-01'from employees;
    insert into work_shifts(id,nama,jam_masuk,jam_pulang,branch_id)values
    (${q(ids.shiftA)},'Fiction morning','08:00','16:00',${q(ids.branchA)}),(${q(ids.shiftB)},'Fiction evening','16:00','23:59',${q(ids.branchA)});
    insert into employee_schedules(employee_id,tanggal,shift_id)values(${q(ids.employeeA)},${q(tomorrow)},${q(ids.shiftA)}),(${q(ids.employeeB)},${q(tomorrow)},${q(ids.shiftB)});
    insert into coa_accounts(code,name,type,normal_balance)values('5201','Fiction salary expense','BEBAN','D')on conflict(code)do nothing;
    insert into cash_advances(employee_id,jumlah,tenor_bulan,status,disbursed_at)values(${q(ids.employeeA)},100000,2,'Disetujui',statement_timestamp());
    insert into reimbursements(employee_id,kategori,jumlah,status)values(${q(ids.employeeA)},'Fiction approved transport',25000,'Disetujui');
    notify pgrst,'reload schema';`);
  if(sql('select count(*)from payroll_period_components')==='0') await rpc(clients.owner,'hris_save_period_component',{p_employee:ids.employeeA,p_month:period,p_name:'Fiction existing allowance',p_type:'tunjangan',p_amount:100000,p_reason:'Fiction monthly acceptance allowance'});
  fs.writeFileSync(RUNTIME+'/fixture-manifest.json',JSON.stringify({app:APP,api:API,container:CONTAINER,period,today,tomorrow,ids,users,emails:roles.map(r=>`${r.toLowerCase()}@hris-fiction.local`)},null,2));
  pass('fictional real auth users, linked employees and dated assignments seeded');
}

async function apiChecks() {
  for (const [role, expected] of [['staffA',1],['adminA',2],['adminB',1],['owner',3]]) {
    const rows = await value(await clients[role].from('employees').select('id,nama,gaji_pokok,nik'), 'Scoped employee '+role);
    assert.equal(rows.length,expected,role+' employee privacy');
    if(role==='staffA') assert.equal(rows[0].id,ids.employeeA);
  }
  const anonymous = createClient(API,ANON,options);
  await deny(anonymous,'hris_my_attendance',{});
  await deny(clients.adminA,'hris_payroll_source_state',{p_period:period},/pemilik|OWNER|perusahaan/i);
  await deny(clients.staffA,'hris_clock_attendance',{p_action:'in',p_branch_id:ids.branchB,p_lat:-7,p_lng:107});
  await deny(clients.staffA,'hris_clock_attendance',{p_action:'in',p_branch_id:ids.branchA,p_lat:null,p_lng:null},/GPS/);
  await deny(clients.staffA,'hris_clock_attendance',{p_action:'in',p_branch_id:ids.branchA,p_lat:-5,p_lng:106},/radius/);
  assert.equal(sql('select count(*)from attendance'),'0');
  pass('actual PostgREST own/foreign staff, scoped ADMIN/OWNER and GPS/anonymous denials');
}

async function login(browser, role, geolocation) {
  const context = await browser.newContext({acceptDownloads:true,...(geolocation?{geolocation,permissions:['geolocation']}:{})});
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(APP+'/login');
  await page.locator('input[name=email]').fill(`${role.toLowerCase()}@hris-fiction.local`);
  await page.locator('input[name=password]').fill(password);
  await Promise.all([page.waitForURL('**/mulai'),page.getByRole('button',{name:'Masuk'}).click()]);
  assert.ok((await context.cookies()).some(c=>c.name.includes('auth-token')),'Real Supabase SSR cookie');
  return {context,page};
}

async function browserChecks(browser) {
  const denied = await login(browser,'staffB');
  await denied.context.grantPermissions([]);
  await denied.page.goto(APP+'/me');
  fs.writeFileSync(RUNTIME+'/denied-page.txt',await denied.page.locator('body').innerText());
  await denied.page.getByRole('button',{name:'Clock In'}).click();
  await denied.page.waitForURL('**/me?error=*');
  await denied.page.getByText(/Izinkan GPS/).waitFor();
  assert.match(await denied.page.locator('body').innerText(),/GPS/);
  assert.equal(sql(`select count(*)from attendance where employee_id=${q(ids.employeeB)}`),'0');
  await denied.context.close();
  pass('browser denied geolocation reports error and creates no attendance');

  const staff = await login(browser,'staffA',{latitude:-6,longitude:106});
  await staff.page.goto(APP+'/me');
  await staff.page.getByRole('button',{name:'Clock In'}).click();
  await staff.page.waitForURL('**/me?success=in');
  await staff.page.getByRole('button',{name:'Clock Out'}).click();
  await staff.page.waitForURL('**/me?success=out');
  const attendance = await value(await clients.staffA.from('attendance').select('*').single(),'Own completed attendance');
  assert.ok(attendance.checked_in_at && attendance.checked_out_at);
  await deny(clients.staffA,'hris_clock_attendance',{p_action:'out',p_branch_id:ids.branchA,p_lat:-6,p_lng:106});
  pass('browser GPS success, server clock-in/out, cookies and repeated checkout rejection');

  const correctedIn = new Date(Math.max(Date.parse(`${today}T00:00:00+07:00`),Date.parse(attendance.checked_in_at)-60000)).toISOString();
  await rpc(clients.adminA,'hris_correct_attendance',{p_id:attendance.id,p_expected_updated_at:attendance.updated_at,p_checked_in_at:correctedIn,p_checked_out_at:attendance.checked_out_at,p_reason:'Fiction actual-hours correction',p_void:false});
  await deny(clients.adminA,'hris_correct_attendance',{p_id:attendance.id,p_expected_updated_at:attendance.updated_at,p_checked_in_at:correctedIn,p_checked_out_at:attendance.checked_out_at,p_reason:'Fiction stale correction',p_void:false});
  assert.equal(sql('select count(*)from attendance_corrections'),'1');
  pass('authenticated HR correction is versioned and audited; stale retry rejected');

  const owner = await login(browser,'owner');
  await owner.page.goto(`${APP}/hris/jadwal?cabang=${ids.branchA}&bulan=${period}&minggu=${today}`);
  assert.match(await owner.page.locator('body').innerText(),/Fiction morning/);
  const downloadWait = owner.page.waitForEvent('download');
  await owner.page.getByRole('button',{name:'Ekspor periode'}).click();
  const download = await downloadWait;
  const saved = await download.path();
  assert.ok(saved);
  const Excel = require('exceljs');
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(saved);
  assert.equal(workbook.getWorksheet('Cabang').getCell('A2').value,ids.branchA);
  await owner.page.locator('#excel-jadwal').setInputFiles({name:'round-trip.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:fs.readFileSync(saved)});
  await owner.page.getByText(/0 baris baru · 2 jadwal sama dilewati · 0 masalah/).waitFor();
  pass('browser weekly schedule Excel export/preview round-trip and scoped branch reference');

  const schedules = await value(await clients.owner.from('employee_schedules').select('id,employee_id,updated_at,shift_id').eq('tanggal',tomorrow).order('employee_id'),'Swap cells');
  const [a,b] = schedules;
  const request = await rpc(clients.staffA,'hris_request_schedule_swap',{p_own_id:a.id,p_own_version:a.updated_at,p_peer_id:b.id,p_peer_version:b.updated_at,p_branch_id:ids.branchA,p_reason:'Fiction two-party shift swap'});
  await deny(clients.adminA,'hris_decide_schedule_swap',{p_id:request.id,p_approve:true,p_reason:'Fiction approval before consent'});
  await rpc(clients.staffB,'hris_respond_schedule_swap',{p_id:request.id,p_accept:true,p_reason:'Fiction Bob explicitly agrees'});
  await rpc(clients.adminA,'hris_decide_schedule_swap',{p_id:request.id,p_approve:true,p_reason:'Fiction scoped HR approves'});
  assert.equal(sql(`select shift_id from employee_schedules where id=${q(a.id)}`),ids.shiftB);
  assert.equal(sql(`select shift_id from employee_schedules where id=${q(b.id)}`),ids.shiftA);
  await staff.page.goto(APP+'/me/jadwal/tukar');
  await staff.page.locator('summary').filter({hasText:'Disetujui'}).waitFor();
  assert.match(await staff.page.locator('body').innerText(),/Disetujui/);
  pass('real API mutual swap requires consent, exchanges both cells, browser reload shows approval');

  await owner.page.goto(`${APP}/laporan/absensi?periode=${period}&cabang=${ids.branchA}`);
  await owner.page.getByText('Fiction Alice',{exact:true}).first().waitFor();
  assert.match(await owner.page.locator('body').innerText(),/Fiction Alice/);
  const recap = await rpc(clients.owner,'hris_attendance_recap',{p_start:`${period}-01`,p_end:sql(`select(date_trunc('month',${q(today)}::date)+interval'1 month'-interval'1 day')::date`),p_branch_id:ids.branchA});
  assert.ok(recap);
  const exported = await owner.context.request.get(`${APP}/laporan/absensi/export?periode=${period}&cabang=${ids.branchA}`);
  assert.equal(exported.status(),200);
  assert.match(exported.headers()['content-type'],/spreadsheet/);
  pass('authenticated browser scoped recap and actual Excel export route');

  await owner.page.goto(`${APP}/hris/penggajian?periode=${period}`);
  await owner.page.getByRole('button',{name:'Hitung'}).click();
  await owner.page.waitForURL('**&success=hitung');
  const slips = await value(await clients.owner.from('payrolls').select('employee_id,total,status,source_snapshot').eq('periode',period),'Calculated payroll');
  const totals = Object.fromEntries(slips.map(s=>[s.employee_id,Number(s.total)]));
  assert.deepEqual(totals,{[ids.employeeA]:1075000,[ids.employeeB]:2000000,[ids.employeeC]:3000000});
  assert.ok(slips.every(s=>s.status==='draft' && s.source_snapshot));
  await owner.page.locator('input[name=catatan]').fill('Fiction one-period existing-policy acceptance');
  await owner.page.getByRole('button',{name:'Sahkan & bukukan'}).click();
  await owner.page.waitForURL('**&success=sah');
  assert.equal(sql(`select count(*)from payrolls where periode=${q(period)}and status='final'`),'3');
  assert.equal(sql(`select sum(jumlah)from cash_advance_installments where periode=${q(period)}`),'50000.00');
  assert.equal(sql(`select count(*)from journal_entries where source='payroll'and source_ref=${q(period)}`),'1');
  assert.equal(sql(`select sum(debit)=sum(credit)and sum(debit)=6125000 from journal_lines l join journal_entries j on j.id=l.entry_id where j.source='payroll'and j.source_ref=${q(period)}`),'t');
  await deny(clients.owner,'hris_finalize_payroll',{p_period:period,p_version:1,p_account:null,p_reason:'Fiction duplicate retry'});
  await owner.page.reload();
  await owner.page.getByText('Sudah disahkan',{exact:true}).waitFor();
  assert.match(await owner.page.locator('body').innerText(),/Sudah disahkan/);
  await deny(clients.adminA,'hris_correct_attendance',{p_id:attendance.id,p_expected_updated_at:sql(`select updated_at from attendance where id=${q(attendance.id)}`),p_checked_in_at:`${today}T09:00:00+07:00`,p_checked_out_at:`${today}T16:00:00+07:00`,p_reason:'Fiction final history change',p_void:false});
  pass('browser actual payroll collector/finalization matches manual1075000+2000000+3000000; one50000 installment, one balanced6125000 journal, retry and finalized correction denied');
  await staff.context.close(); await owner.context.close();
}

async function followupChecks(browser) {
  const before = sql(`select string_agg(source_snapshot::text,'|'order by employee_id)from payrolls where periode=${q(period)}and status='final'`);
  assert.ok(before,'Main one-period acceptance must finish first');
  const owner = await login(browser,'owner');
  await owner.page.goto(`${APP}/hris/penggajian/sumber?periode=${period}&employee=${ids.employeeA}`);
  await owner.page.getByText('Fiction existing allowance').waitFor();
  await owner.page.getByText('Fiction approved transport').waitFor();
  pass('browser historical source detail renders saved allowance and reimbursement');
  const date = sql(`select(date_trunc('month',${q(today)}::date)+interval'1 month')::date`);
  const month = date.slice(0,7);
  await owner.page.goto(`${APP}/hris/jadwal?cabang=${ids.branchA}&bulan=${month}&minggu=${date}`);
  if(sql(`select count(*)from employee_schedules where tanggal=${q(date)}and employee_id=${q(ids.employeeA)}`)==='0') {
    await owner.page.getByRole('button',{name:'Fiction morning'}).click();
    await owner.page.getByRole('button',{name:`Fiction Alice, ${date}, Kosong`}).click();
    await Promise.all([owner.page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/hris/jadwal')),owner.page.getByRole('button',{name:'Simpan jadwal'}).click()]);
    await owner.page.waitForURL('**&success=1');
  }
  assert.equal(sql(`select count(*)from employee_schedules where tanggal=${q(date)}and employee_id=${q(ids.employeeA)}and shift_id=${q(ids.shiftA)}`),'1');
  const downloaded = owner.page.waitForEvent('download');
  await owner.page.getByRole('button',{name:'Ekspor periode'}).click();
  const file = await (await downloaded).path();
  const Excel = require('exceljs');const book = new Excel.Workbook();await book.xlsx.readFile(file);
  book.getWorksheet('Jadwal').addRow([ids.employeeB,date,ids.shiftB,ids.branchA]);
  const bytes = await book.xlsx.writeBuffer();
  await owner.page.locator('#excel-jadwal').setInputFiles({name:'fiction-new-row.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
  await owner.page.getByText(/1 baris baru · 1 jadwal sama dilewati · 0 masalah/).waitFor();
  await owner.page.getByRole('checkbox',{name:/Saya sudah memeriksa/}).check();
  await Promise.all([owner.page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/hris/jadwal')),owner.page.getByRole('button',{name:'Simpan impor'}).click()]);
  await owner.page.waitForURL('**&success=1');
  await owner.page.getByText(/Jadwal tersimpan/).waitFor();
  assert.equal(sql(`select count(*)from employee_schedules where tanggal=${q(date)}`),'2');
  assert.equal(sql(`select string_agg(source_snapshot::text,'|'order by employee_id)from payrolls where periode=${q(period)}and status='final'`),before);
  pass('browser atomic schedule board save and confirmed Excel import of one new row; final payroll snapshots unchanged');
  const outside = await login(browser,'staffC',{latitude:-6,longitude:106});
  await outside.page.goto(APP+'/me');
  await outside.page.getByRole('button',{name:'Clock In'}).click();
  await outside.page.waitForURL('**/me?error=*');
  await outside.page.getByText('Di luar radius cabang').waitFor();
  assert.equal(sql(`select count(*)from attendance where employee_id=${q(ids.employeeC)}`),'0');
  pass('browser actual GPS outside the assigned branch radius is rejected without attendance');
  await outside.context.close();
  await owner.context.close();
}

await seed();
if(!process.argv.includes('--followups')) await apiChecks();
if (!process.argv.includes('--seed-only')) {
  const log = fs.openSync('/workspace/hris-local-next.log','a');
  const ready = await fetch(APP+'/login').then(r=>r.ok).catch(()=>false);
  const next = ready ? null : spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3108'],{cwd:ROOT,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:API,NEXT_PUBLIC_SUPABASE_ANON_KEY:ANON},stdio:['ignore',log,log]});
  if(process.argv.includes('--keep-app')) next?.unref();
  let browser;
  try {
    for(let i=0;i<120;i++) { try { if((await fetch(APP+'/login')).ok) break; } catch {} if(i===119) throw new Error('Local Next did not become ready'); await new Promise(r=>setTimeout(r,500)); }
    pass('local Next endpoint ready '+APP);
    browser = await chromium.launch({headless:true,executablePath:process.env.HRIS_CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
    if(process.argv.includes('--followups')) await followupChecks(browser);else await browserChecks(browser);
  } finally {
    await browser?.close(); if(!process.argv.includes('--keep-app')) next?.kill('SIGTERM'); fs.closeSync(log);
  }
}
