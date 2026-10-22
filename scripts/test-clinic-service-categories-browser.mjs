// Real clinic forms/classifier, fictional catalog only. No business submit or remote requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KAMO_PLAYWRIGHT_MODULE || '/opt/codex/cua_node/lib/node_modules/playwright');
const source = path.resolve('src');
const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'kamo-clinic-service-'));
const output = path.resolve('docs/evidence/2026-10-22-clinic-services');
await fs.mkdir(output, { recursive: true });
const css = (await fs.readFile(path.join(source, 'app/globals.css'), 'utf8'))
  .replace('@import "tailwindcss";', '').replace(/@theme inline \{[^}]*\}/, '');
await fs.writeFile(path.join(runtime, 'fixture.css'), css);
await fs.writeFile(path.join(runtime, 'index.html'), '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/main.tsx"></script>');
await fs.writeFile(path.join(runtime, 'main.tsx'), `
import React from 'react';import{createRoot}from'react-dom/client';import './fixture.css';
import{RekamForm}from'${source}/app/(app)/klinik/rekam-medis/[visitId]/RekamForm.tsx';
import{CatatanForm}from'${source}/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm.tsx';
import{splitClinicItems}from'${source}/lib/clinic-item-categories.ts';
const categories=[{id:'consult',name:'KONSULTASI'},{id:'action',name:'TINDAKAN'},{id:'medicine',name:'OBAT'}];
const base={unit:'kali',stok:0,sell_price:45000,is_compound_material:false,item_type:'Jasa',tindakan_kategori:'Konsultasi'};
const items=[{...base,id:'fiction-service',name:'Konsultasi fiktif',category_id:'consult'},
 {...base,id:'fiction-action',name:'Tindakan fiktif',category_id:'action',tindakan_kategori:'Operasi'},
 {...base,id:'fiction-medicine',name:'Obat fiktif',category_id:'medicine',item_type:'Persediaan',stok:5}];
const groups=splitClinicItems(items,categories,new Set());
const common={requestKey:'fiction-request',draftUserId:'fiction-user',items:groups.obat,jasaItems:groups.jasa,tindakanItems:groups.tindakan,bahanItems:groups.bahan,racikanItems:groups.racikan,katalogRacikan:[],bolehManual:false};
const patient={name:'Pasien fiktif',species:'Kucing',breed:null,noRM:'FIX-RM',owner:'Pemilik fiktif',phone:'',address:'',photo:null,dokter:'Dokter fiktif'};
const inpatient=location.pathname==='/inpatient';
createRoot(document.getElementById('root')).render(<main style={{maxWidth:1450,margin:'auto',padding:16}}><h1>Fixture klinik — data fiktif</h1>
{inpatient?<CatatanForm {...common} recordId="fiction-inpatient" backHref="/inpatient" patient={{...patient,tglMasuk:'22 Oct 2026',kondisi:'Stabil'}}/>:
<RekamForm {...common} visitId="fiction-visit" petId="fiction-pet" currentWeight={null} dokterOpsi={[]} providerOpsi={[]} patient={{...patient,tglPeriksa:'22 Oct 2026',dokterId:null,providerId:null,tier:'Umum',keluhan:'Kontrol'}}/>}</main>);
`);
const server = await createServer({ root: runtime, configFile: false, logLevel: 'error', oxc: { jsx: { runtime: 'automatic' } },
  server: { host: '127.0.0.1', port: 3190, strictPort: true, fs: { allow: [runtime, source, path.resolve('node_modules')] } },
  resolve: { dedupe: ['react', 'react-dom'], alias: [
    { find: 'react-dom', replacement: path.dirname(require.resolve('react-dom')) }, { find: 'react', replacement: path.dirname(require.resolve('react')) },
    { find: '@', replacement: source },
  ] },
  plugins: [{ name: 'fictional-clinic-boundaries', enforce: 'pre', resolveId(id, importer) {
    if (id === 'next/link') return '\0link';
    if (id === 'next/navigation') return '\0navigation';
    if (['@/components/PetPhotoUpload', '@/components/PenunjangUpload'].includes(id)) return '\0uploads';
    if ((id === './actions' && importer?.endsWith('/RekamForm.tsx')) || (id === '../../actions' && importer?.endsWith('/CatatanForm.tsx'))) return '\0actions';
    if (id === '@/lib/supabase/client') return '\0client';
  }, load(id) {
    if (id === '\0link') return `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children);}`;
    if (id === '\0navigation') return `export const useRouter=()=>({push:()=>{throw new Error('Fixture does not navigate after a business submit')}});`;
    if (id === '\0uploads') return 'export const PetPhotoUpload=()=>null;export const PenunjangUpload=()=>null;';
    if (id === '\0actions') return `export async function simpanRekamMedis(){throw new Error('Fixture must not submit')};export async function addDailyLogPos(){throw new Error('Fixture must not submit')};`;
    if (id === '\0client') return `export function createClient(){throw new Error('Fixture must not connect to database')};`;
  } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const checks = [];
  for (const route of ['exam', 'inpatient']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', request => new URL(request.request().url()).origin === 'http://127.0.0.1:3190' ? request.continue() : request.abort());
    await page.goto('http://127.0.0.1:3190/' + route);
    await page.getByRole('button', { name: 'Jasa', exact: true }).click();
    const list = page.getByRole('region', { name: 'Pilihan jasa' });
    assert.match(await list.innerText(), /Konsultasi fiktif/);
    assert.doesNotMatch(await list.innerText(), /Obat fiktif|Tindakan fiktif|Belum ada/);
    await list.getByLabel('Cari jasa', { exact: true }).fill('tidak-cocok');
    await page.getByText('Tidak ada jasa cocok.', { exact: true }).waitFor();
    await list.getByLabel('Cari jasa', { exact: true }).fill('Konsultasi');
    await list.getByRole('button', { name: 'Tambah Konsultasi fiktif', exact: true }).click();
    const cartInput = page.locator('input[name=resep],input[name=pos_items]').first();
    const cart = JSON.parse(await cartInput.inputValue());
    assert.equal(cart.length, 1);
    assert.equal(cart[0].item_id, 'fiction-service');
    assert.equal(cart[0].harga, 45000); assert.equal(cart[0].jenis, 'jasa'); assert.equal(cart[0].kategori, 'Konsultasi');
    const panel = page.locator('.crm-sec').filter({ hasText: 'INPUT OBAT & JASA (POS)' }).first();
    await panel.screenshot({ path: path.join(output, route + '-desktop.png') });
    await page.waitForFunction(() => Object.keys(sessionStorage).some(key => key.startsWith('vetos:clinic-draft:') && JSON.parse(sessionStorage.getItem(key)).snapshot.cart.length === 1));
    await page.reload();
    await page.getByRole('status').filter({ hasText: 'Draf dipulihkan' }).waitFor();
    await page.getByRole('button', { name: 'Jasa', exact: true }).click();
    assert.deepEqual(JSON.parse(await cartInput.inputValue()), cart);
    await page.getByRole('button', { name: 'Tindakan', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Tambah Tindakan fiktif', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Jasa', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 1000 });
    assert.equal(await page.getByRole('button', { name: 'Tambah Konsultasi fiktif', exact: true }).isVisible(), true);
    await panel.screenshot({ path: path.join(output, route + '-mobile.png') });
    assert.deepEqual(errors, []);
    checks.push({ route, serviceFromImportedCategoryVisible: true, transactionMetadataPreserved: true, draftRestored: true, desktopAndMobile: true, runtimeErrors: errors });
    await context.close();
  }
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify({ fictionalCatalogOnly: true, businessSubmit: false, checks }, null, 2) + '\n');
  console.log('PASS real exam/inpatient forms with shared classifier: imported-category service search/add/draft restore, unchanged item ID/price/kind/consent, Tindakan retained, desktop/mobile, no runtime errors. No business submit or external requests.');
} finally { await browser?.close(); await server.close(); await fs.rm(runtime, { recursive: true, force: true }); }
