// Real import/review components with fictional actions only; external requests are blocked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KAMO_PLAYWRIGHT_MODULE || '/opt/codex/cua_node/lib/node_modules/playwright');
const source = path.resolve('src');
const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'kamo-import-continuation-'));
const output = path.resolve('docs/evidence/2026-10-22-import-continuation');
await fs.mkdir(output, { recursive: true });
// Use the application's plain CSS; omit Tailwind compiler directives in this Vite fixture.
const css = (await fs.readFile(path.join(source, 'app/globals.css'), 'utf8'))
  .replace('@import "tailwindcss";', '').replace(/@theme inline \{[^}]*\}/, '');
await fs.writeFile(path.join(runtime, 'fixture.css'), css);
await fs.writeFile(path.join(runtime, 'index.html'), '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/main.tsx"></script>');
await fs.writeFile(path.join(runtime, 'main.tsx'), `
import React from 'react';import{createRoot}from'react-dom/client';import './fixture.css';
import{AccurateImportForm}from'${source}/app/(app)/pos/sku/impor/AccurateImportForm.tsx';
import{InventoryAccountingForm}from'${source}/app/(app)/keuangan/persediaan-awal/InventoryAccountingForm.tsx';
const runId='11111111-1111-4111-8111-111111111111';
const review=location.pathname==='/keuangan/persediaan-awal';
createRoot(document.getElementById('root')).render(<main style={{maxWidth:960,margin:'auto',padding:16}}>
<h1>{review?'Tinjauan persediaan awal':'Impor Barang'}</h1><p>Fixture fiktif — tanpa database atau transaksi pelanggan.</p>
{review?<InventoryAccountingForm initialRunId={new URLSearchParams(location.search).get('run_id')||''} batches={[{id:runId,source_name:'fiction.xlsx',status:'previewed',as_of_date:'2026-01-01',branch_id:'fiction',created_at:''}]} accounts={[{id:'22222222-2222-4222-8222-222222222222',code:'3101',name:'Ekuitas fiktif'}]}/>:<AccurateImportForm/>}</main>);
`);
const importActions = `
const master={ok:true,phase:'preview',message:'Master fiktif siap',run_id:'fiction-master',source_hash:'fiction',source_fingerprint:'fiction',rows:[],total_rows:1,hierarchy_count:0,summary:{Baru:1,Update:0,Sama:0,Dilewati:0,Ditolak:0},new_masters:{categories:[],brands:[],units:[],suppliers:[]}};
const stock={ok:true,phase:'preview',message:'Saldo fiktif siap',run_id:null,branch_id:null,warehouse_id:null,master_run_id:null,as_of:'2026-01-01',source_hash:null,rows:[{row:2,itemCode:'FIX-001',itemName:'Barang fiktif',unit:'pcs',baseQty:10,status:'valid'}],source_qty:10,source_value:125,checks:[],scope_clarification:null};
const count=name=>{const calls=JSON.parse(sessionStorage.getItem('importCalls')||'{}');calls[name]=(calls[name]||0)+1;sessionStorage.setItem('importCalls',JSON.stringify(calls));};
export async function previewImporAccurate(){count('masterPreview');return master;}
export async function preflightSaldoAwalSekali(){count('preflight');return stock;}
export async function konfirmasiImporAccurate(){count('masterConfirm');return{...master,phase:'done'};}
export async function previewSaldoAwalAccurate(){count('stockPreview');return{...stock,run_id:'11111111-1111-4111-8111-111111111111',master_run_id:'fiction-master',branch_id:'fiction',warehouse_id:'fiction',source_hash:'fiction'};}
`;
const accountingActions = `
export async function previewInventoryAccounting(runId){return{ok:true,report:{run_id:runId,status:'previewed',source_name:'fiction.xlsx',source_hash:'fiction',branch_name:'Cabang fiktif',warehouse_name:'Gudang fiktif',as_of:'2026-01-01',selected_rows:1,excluded_rows:0,original_qty:10,original_value:125,remaining_value:125,inventory_account:{code:'1301',name:'Persediaan'},equity_account:{id:'22222222-2222-4222-8222-222222222222',code:'3101',name:'Ekuitas fiktif'},blockers:[],can_post:true,receipt:null}};}
export async function postInventoryAccounting(){throw new Error('Fixture must stop before posting');}
`;
const server = await createServer({ root: runtime, configFile: false, logLevel: 'error', oxc: { jsx: { runtime: 'automatic' } },
  server: { host: '127.0.0.1', port: 3188, strictPort: true, fs: { allow: [runtime, source, path.resolve('node_modules')] } },
  resolve: { dedupe: ['react', 'react-dom'], alias: [
    { find: 'react-dom', replacement: path.dirname(require.resolve('react-dom')) },
    { find: 'react', replacement: path.dirname(require.resolve('react')) },
    { find: '@', replacement: source },
  ] },
  plugins: [{ name: 'fictional-actions', enforce: 'pre', resolveId(id, importer) {
    if (id === 'next/link') return '\0fiction-link';
    if (id === './actions' && /\/(AccurateImportForm|InitialStockImport)\.tsx$/.test(importer || '')) return '\0fiction-import';
    if (id === './actions' && importer?.endsWith('/InventoryAccountingForm.tsx')) return '\0fiction-accounting';
  }, load(id) {
    if (id === '\0fiction-link') return `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children);}`;
    if (id === '\0fiction-import') return importActions;
    if (id === '\0fiction-accounting') return accountingActions;
  } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const checks = [];
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3188' ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:3188/pos/sku/impor');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'fiction.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('fictional action fixture') });
    await page.locator('input[type=date]').fill('2026-01-01');
    await page.getByRole('button', { name: 'Cek perubahan', exact: true }).click();
    const prepare = page.getByRole('button', { name: 'Import Sekali', exact: true });
    await prepare.waitFor();
    assert.equal(await prepare.isEnabled(), true);
    assert.equal(await page.getByRole('link', { name: 'Tinjau dan posting stok + jurnal', exact: true }).count(), 0);
    await prepare.click();
    await page.getByText('Master tersimpan, batch saldo siap ditinjau', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Import Sekali/ }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Cek perubahan', exact: true }).isDisabled(), true);
    assert.equal(await page.getByText('Import selesai', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const calls = await page.evaluate(() => JSON.parse(sessionStorage.getItem('importCalls')));
    assert.deepEqual(calls, { masterPreview: 1, preflight: 1, masterConfirm: 1, stockPreview: 1 });
    await page.screenshot({ path: path.join(output, `prepared-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Tinjau dan posting stok + jurnal', exact: true }).first().click();
    await page.waitForURL('**/keuangan/persediaan-awal?run_id=11111111-1111-4111-8111-111111111111');
    assert.equal(await page.getByLabel('Batch Accurate').inputValue(), '11111111-1111-4111-8111-111111111111');
    await page.getByLabel('Akun ekuitas', { exact: true }).selectOption('22222222-2222-4222-8222-222222222222');
    await page.getByRole('button', { name: 'Preview / laporan tanpa posting' }).click();
    await page.getByRole('heading', { name: 'Tinjauan posting batch baru' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Posting stok + jurnal cabang' }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, `review-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    checks.push({ width, calls, exactReviewBatch: true, explicitReviewRequired: true, noOverflow: true, runtimeErrors: errors });
    await context.close();
  }
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify({ fictionalActionsOnly: true, checks }, null, 2) + '\n');
  console.log('PASS real import → review components at 1280/390px: exactly one preparation, exact batch selected, explicit posting review retained; no overflow/runtime errors. Fictional actions only.');
} finally {
  await browser?.close(); await server.close();
  await fs.rm(runtime, { recursive: true, force: true });
}
