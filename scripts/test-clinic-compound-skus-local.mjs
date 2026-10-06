import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const app = new URL(process.env.VETOS_COMPOUND_TEST_URL || 'http://127.0.0.1:3140');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(app.hostname), 'Loopback app required');
const config = JSON.parse(fs.readFileSync('/workspace/hris-local-runtime/local-auth.json', 'utf8'));
assert.equal(config.API_URL, 'http://127.0.0.1:55421', 'Only the fictional local API may be seeded');
const manifest = JSON.parse(fs.readFileSync('/workspace/hris-local-runtime/fixture-manifest.json', 'utf8'));
async function api(path, method = 'GET', body) {
  const response = await fetch(config.API_URL + '/rest/v1/' + path, {
    method, headers: { apikey: config.SERVICE_ROLE_KEY, Authorization: `Bearer ${config.SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Fictional fixture API ${method} ${path.split('?')[0]} failed ${response.status}`);
  return response.status === 204 ? [] : response.json();
}
const uuid = n => `c5000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let categories = await api('item_categories?name=eq.OBAT%20RACIK');
if (!categories.length) categories = await api('item_categories', 'POST', [{ id: uuid(1), name: 'OBAT RACIK', is_active: true }]);
const category = categories[0].id;
await api('item_categories?on_conflict=id', 'POST', [{ id: uuid(2), name: 'QA other fictional category', is_active: true }]);
const items = Array.from({ length: 55 }, (_, i) => ({ id: uuid(100 + i), code: `QA-RACIK-SKU-${i + 1}`,
  name: `${i < 2 ? 'Obat Racik ' : ''}ZZ Fiction Obat Racik ${String(i + 1).padStart(2, '0')}`, unit: 'pcs', category_id: i < 2 ? uuid(2) : category,
  is_active: true, is_compound_material: false, item_type: 'Persediaan', sell_price: 20000, buy_price: 1000 }));
await api('items?on_conflict=id', 'POST', items);
await api('stock?on_conflict=item_id,warehouse_id', 'POST', items.map(item => ({ item_id: item.id, warehouse_id: manifest.benchmarkWarehouse, qty: 8 })));
await api('item_units?on_conflict=item_id,unit', 'POST', [{ item_id: items[54].id, unit: 'box', factor: 10, sell_price: 100000, buy_price: 10000 }]);
await api('item_branch_prices?on_conflict=item_id,branch_id,unit', 'POST', [
  { item_id: items[54].id, branch_id: manifest.benchmarkBranch, unit: 'pcs', sell_price: 25000 },
  { item_id: items[54].id, branch_id: manifest.benchmarkBranch, unit: 'box', sell_price: 98000 },
]);
const pets = await api('pets?select=id,customer_id&limit=1');
const visitId = uuid(900), inpatientId = uuid(901);
await api('visits?on_conflict=id', 'POST', [{ id: visitId, pet_id: pets[0].id, customer_id: pets[0].customer_id,
  branch_id: manifest.benchmarkBranch, status: 'Diperiksa', poli: 'Umum', created_at: '2010-01-01T00:00:00Z' }]);
await api('inpatient_records?on_conflict=id', 'POST', [{ id: inpatientId, visit_id: visitId, branch_id: manifest.benchmarkBranch,
  condition_status: 'stabil', admitted_at: '2010-01-01T00:00:00Z' }]);
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ baseURL: app.origin, timezoneId: 'Asia/Jakarta', viewport: { width: 1365, height: 900 } });
await context.route('**/*', route => new URL(route.request().url()).origin === app.origin ? route.continue() : route.abort());
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('/login');
  await page.locator('[name=email]').fill('owner@hris-fiction.local');
  await page.locator('[name=password]').fill('FictionLocalOnly123!');
  await Promise.all([page.waitForURL('**/mulai', { timeout: 60000 }), page.getByRole('button', { name: 'Masuk', exact: true }).click()]);
  for (const path of [`/klinik/rekam-medis/${visitId}`, `/klinik/rawat-inap/${inpatientId}/catatan`]) {
    const response = await page.goto(path); assert.equal(response.status(), 200);
    await page.getByRole('button', { name: 'Racikan', exact: true }).click();
    const list = page.getByRole('region', { name: 'Obat racik dari Barang & Jasa' });
    await list.waitFor();
    assert.equal(await list.getByRole('button', { name: /^Tambah / }).count(), 50);
    assert.equal(await list.getByRole('button', { name: 'Tambah Obat Racik ZZ Fiction Obat Racik 01', exact: true }).count(), 1);
    await list.getByRole('button', { name: 'Berikutnya', exact: true }).click();
    assert.equal(await list.getByRole('button', { name: /^Tambah / }).count(), 5);
    await list.getByRole('textbox', { name: 'Cari obat racik' }).fill('QA-RACIK-SKU-55');
    const add = list.getByRole('button', { name: 'Tambah ZZ Fiction Obat Racik 55', exact: true });
    await add.waitFor();
    assert.match(await list.innerText(), /Stok 8 pcs.*Rp 25\.000/);
    await add.click(); await add.click();
    const payload = page.locator('input[name=resep], input[name=pos_items]').first();
    assert.equal(await payload.count(), 1);
    let cart = JSON.parse(await payload.inputValue());
    assert.equal(cart.length, 1); assert.equal(cart[0].item_id, items[54].id);
    assert.equal(cart[0].jenis, 'obat'); assert.equal(cart[0].qty, 2); assert.equal(cart[0].harga, 25000);
    assert.equal(cart[0].official_version_id, undefined); assert.equal(cart[0].ingredients, undefined);
    await page.getByTitle('Satuan', { exact: true }).selectOption('box');
    cart = JSON.parse(await payload.inputValue());
    assert.equal(cart[0].satuan, 'box'); assert.equal(cart[0].faktor, 10); assert.equal(cart[0].harga, 98000);
    await page.screenshot({ path: `/tmp/compound-sku-${path.includes('rawat-inap') ? 'inpatient' : 'exam'}.png`, fullPage: true });
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ passed: true, routes: 2, fictionalCompoundSkus: 55, visiblePerPage: 50,
    searchBeyondOldLimit: true, legacyNamesOutsideCompoundCategory: true, secondPage: true, repeatedAddKeepsSkuIdentity: true, branchPrice: true,
    unitFactorAndPrice: true, browserErrors: errors.length, businessSubmit: false }));
} finally { await context.close(); await browser.close(); }
