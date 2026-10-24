/** Local fixture only: never connects to KAMO or writes business data.
 * Run: node scripts/test-numeric-input-browser.mjs
 * Requires Playwright and Chromium (available in the Codex runtime).
 * Optional: CHROMIUM_EXECUTABLE_PATH and KAMO_NUMERIC_EVIDENCE_DIR.
 */
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(createRequire(import.meta.url).resolve('playwright'));
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function main(){
 const {createServer}=await import('vite');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'kamo-numeric-browser-'));
 const evidenceDir=process.env.KAMO_NUMERIC_EVIDENCE_DIR;
 if(evidenceDir)fs.mkdirSync(evidenceDir,{recursive:true});
 fs.writeFileSync(path.join(temporary,'index.html'),HTML);
 fs.writeFileSync(path.join(temporary,'main.tsx'),FIXTURE.replaceAll('/workspace/Kamo-Vet-OS',repo));
 const server=await createServer({root:temporary,configFile:false,oxc:{jsx:{runtime:'automatic'}},resolve:{alias:{'@':path.join(repo,'src'),'react':path.join(repo,'node_modules/react'),'react-dom':path.join(repo,'node_modules/react-dom')}},server:{host:'127.0.0.1',port:0,fs:{allow:[repo,temporary]}}});
 await server.listen();
 const url='http://127.0.0.1:'+server.httpServer.address().port;
 let browser;
 try {
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1100,height:720},permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();await page.goto(url);const price=page.locator('[name=price]');await price.waitFor();
const get=()=>page.locator('form').evaluate(f=>Object.fromEntries(new FormData(f)));const paste=async text=>{await page.evaluate(t=>navigator.clipboard.writeText(t),text);await page.keyboard.press('Control+V');};const results=[];
for(const focus of[true,false]){await price[focus?'focus':'blur']();const b=await price.boundingBox();await page.mouse.move(b.x+30,b.y+10);const before=await price.inputValue();await page.mouse.wheel(0,180);await page.waitForTimeout(200);assert.equal(await price.inputValue(),before);assert.ok(await page.evaluate(()=>scrollY)>0);await page.evaluate(()=>scrollTo(0,0));results.push((focus?'focused':'unfocused')+' wheel stable + page scroll');}
await price.fill('15000.125');await price.focus();await page.keyboard.press('Control+A');await paste('1.000.000,125');assert.equal(await price.inputValue(),'1000000.125');assert.equal((await get()).price,'1000000.125');results.push('localized paste canonical payload');
await page.keyboard.press('Control+A');await paste('15.000');assert.equal(await price.inputValue(),'1000000.125');assert.ok((await page.locator('[role=alert]').textContent()).includes('bisa berarti'));results.push('ambiguous external paste rejected without changing value');
await price.fill('15000.125');await page.keyboard.press('End');await page.keyboard.press('ArrowLeft');await page.keyboard.insertText('9');assert.equal(await price.inputValue(),'15000.1295');results.push('middle insertion preserves caret and decimals');
await price.focus();await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'15000.1295');results.push('copy canonical value');
for(const shortcut of['Control+C','Control+X']){await price.fill('1.234');await page.keyboard.press('Control+A');await page.keyboard.press(shortcut);if(shortcut==='Control+X')assert.equal(await price.inputValue(),'');const target=page.locator('[name=purchase]');await target.focus();await page.keyboard.press('Control+A');await page.keyboard.press('Control+V');assert.equal(await target.inputValue(),'1.234');results.push(shortcut+' native decimal round trip');}
await price.fill('15000.125');await price.focus();await page.keyboard.press('Control+A');await paste('12345.6789');assert.equal(await price.inputValue(),'12345.6789');await price.blur();assert.equal(await page.locator('[data-number-display=price]').textContent(),'12.345,6789');results.push('unformatted decimal paste / formatting');
await price.fill('');assert.equal((await get()).price,'');await price.fill('0');assert.equal((await get()).price,'0');await price.blur();assert.equal(await page.locator('[data-number-display=price]').textContent(),'0');results.push('blank / zero');
const discount=page.locator('[name=discount]');for(const value of['101','-1','1.001']){await discount.fill(value);assert.equal(await discount.evaluate(i=>i.checkValidity()),false);}await discount.fill('12.34');assert.equal(await discount.evaluate(i=>i.checkValidity()),true);results.push('native range / step validation');
const qty=page.locator('[name=qty]');await qty.fill('24');await qty.press('ArrowUp');assert.equal(await qty.inputValue(),'25');await qty.fill('0.000001');assert.equal((await get()).qty,'0.000001');results.push('keyboard arrows + fractional canonical strings');
const balance=page.locator('[name=balance]');await balance.fill('-1234567.0012300');await balance.blur();assert.equal(await page.locator('[data-number-display=balance]').textContent(),'-1.234.567,0012300');assert.equal((await get()).balance,'-1234567.0012300');results.push('negative / trailing zero precision');
await balance.fill('1e-9999999999');await balance.blur();assert.equal((await get()).balance,'1e-9999999999');assert.equal(await page.locator('[data-number-display=balance]').textContent(),'1e-9999999999');results.push('bounded extreme exponent');
for(let i=0;i<3;i++){await price.fill('2000000.5');await page.locator('#cancel').click();assert.equal((await get()).price,'15000.125');}results.push('repeated edit / cancel');
await page.getByRole('button',{name:'Reset',exact:true}).click();assert.equal((await get()).purchase,'1000000');assert.equal((await get()).qty,'24');assert.equal((await get()).code,'0015000');await page.waitForFunction(()=>document.querySelector('[data-number-display=purchase]').textContent==='1.000.000' && document.querySelector('[data-number-display=qty]').textContent==='24');results.push('native form reset display and payload / identifier preserved');
await page.setViewportSize({width:390,height:844});assert.equal(await price.getAttribute('inputmode'),'decimal');const sizes=await qty.evaluate(i=>({input:i.getBoundingClientRect().width,wrapper:i.parentElement.getBoundingClientRect().width}));assert.equal(sizes.input,sizes.wrapper);assert.ok(sizes.input<=70&&sizes.input>50);if (evidenceDir) await page.screenshot({path:path.join(evidenceDir,'numeric-mobile.png')});results.push('mobile inputMode and compact width');
console.log(JSON.stringify({passed:results},null,2));if(evidenceDir) fs.writeFileSync(path.join(evidenceDir,'numeric-browser-results.json'),JSON.stringify({passed:results},null,2));
 } finally {
  await browser?.close();await server.close();fs.rmSync(temporary,{recursive:true,force:true});
 }
}
const HTML="<!DOCTYPE html><html lang=\"id\"><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/></head><body><div id=\"root\"></div><script type=\"module\" src=\"/main.tsx\"></script></body></html>\n";
const FIXTURE="import React, {useState} from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {NumberInput} from '/@fs/workspace/Kamo-Vet-OS/src/components/NumberInput.tsx';\nimport {NumericInputSafety} from '/@fs/workspace/Kamo-Vet-OS/src/components/NumericInputSafety.tsx';\nimport css from '/@fs/workspace/Kamo-Vet-OS/src/app/globals.css?raw';\nfunction App(){const[value,set]=useState('15000.125');return <><style>{css.replace('@import \"tailwindcss\";','')+'*{box-sizing:border-box}body{padding:24px}form{max-width:700px}.tall{height:1500px}'}</style><NumericInputSafety/><form><div className=\"frow\"><label>Harga jual<NumberInput className=\"fi\" name=\"price\" value={value} step=\"any\" onChange={e=>set(e.target.value)}/></label><label>Harga beli<NumberInput className=\"fi\" name=\"purchase\" defaultValue=\"1000000\" step=\"any\"/></label></div><div style={{display:'flex',gap:6}}><button type=\"button\">\u2212</button><NumberInput className=\"fi\" name=\"qty\" defaultValue=\"24\" min=\"0.001\" step=\"any\" style={{width:70,padding:'3px 2px',textAlign:'center',fontSize:10.5}}/><button type=\"button\">+</button><NumberInput className=\"fi\" name=\"tier\" defaultValue=\"14000\" style={{width:120}}/><NumberInput className=\"fi\" name=\"discount\" defaultValue=\"12.5\" min=\"0\" max=\"100\" step=\"0.01\" style={{width:90}}/></div><label>Saldo<NumberInput className=\"fi\" name=\"balance\" defaultValue=\"-1234567.0012300\" step=\"any\"/></label><label>Kode<input className=\"fi\" name=\"code\" defaultValue=\"0015000\"/></label><button type=\"button\" id=\"cancel\" onClick={()=>set('15000.125')}>Batal</button><button type=\"reset\">Reset</button><div className=\"tall\"/></form></>}\ncreateRoot(document.getElementById('root')!).render(<App/>);\n";
main().catch(error=>{console.error(error);process.exitCode=1;});
