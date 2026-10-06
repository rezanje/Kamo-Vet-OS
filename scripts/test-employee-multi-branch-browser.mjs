import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'employee-branches-')),source=path.resolve('src');
await fs.writeFile(path.join(root,'index.html'),'<div id="root"></div><script type="module" src="/main.tsx"></script>');
await fs.writeFile(path.join(root,'main.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {PenugasanCabangForm} from '${source}/app/(app)/hris/karyawan/PenugasanCabangForm.tsx';
createRoot(document.getElementById('root')).render(<PenugasanCabangForm today="2026-10-05" employees={[{id:'employee-a',nama:'Fiction doctor A',jabatan:'Dokter',branch_id:'primary'},{id:'employee-b',nama:'Fiction doctor B',jabatan:'Dokter',branch_id:'additional-a'}]} branches={[{id:'primary',name:'Fiction Main'},{id:'additional-a',name:'Fiction East'},{id:'additional-b',name:'Fiction West'}]}/>);
`);
const server=await createServer({root,logLevel:'error',oxc:{jsx:{runtime:'automatic'},tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}}},server:{host:'127.0.0.1',port:3165,strictPort:true,fs:{allow:[root,source,path.resolve('node_modules'),'/opt/codex']}},optimizeDeps:{include:['react','react-dom','react-dom/client']},resolve:{dedupe:['react','react-dom'],alias:[{find:'@',replacement:source},{find:'react-dom',replacement:require.resolve('react-dom').replace(/\/index\.js$/,'')},{find:'react',replacement:require.resolve('react').replace(/\/index\.js$/,'')}]},plugins:[{name:'assignment-fixture',enforce:'pre',resolveId(id,importer){if(id.endsWith('actions')&&importer?.endsWith('PenugasanCabangForm.tsx'))return '\0actions';},load(id){if(id==='\0actions')return 'export const simpanPenugasanCabang=async form=>{window.__saved={employee:form.get("employee_id"),branches:form.getAll("branch_ids"),date:form.get("effective_date")};};';}}]});
await server.listen();const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({baseURL:'http://127.0.0.1:3165'});
 await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:3165'?route.continue():route.abort());
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');const save=page.getByRole('button',{name:'Simpan Penugasan'});
 assert.equal(await save.isDisabled(),true);
 await page.getByLabel('Karyawan *',{exact:true}).selectOption('employee-a');assert.equal(await page.getByLabel('Fiction Main',{exact:true}).isDisabled(),true);
 await page.getByLabel('Fiction East',{exact:true}).check();await page.getByLabel('Fiction West',{exact:true}).check();assert.equal(await save.isDisabled(),false);
 await page.getByLabel('Cari cabang',{exact:true}).fill('East');
 await save.click();await page.waitForFunction(()=>window.__saved);
 assert.deepEqual(await page.evaluate(()=>window.__saved),{employee:'employee-a',branches:['additional-a','additional-b'],date:'2026-10-05'});
 await page.getByLabel('Karyawan *',{exact:true}).selectOption('employee-b');assert.equal(await save.isDisabled(),true);assert.equal(await page.locator('[name=branch_ids]').count(),0);
 assert.equal(await page.getByLabel('Fiction East',{exact:true}).isDisabled(),true);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,multiSelection:true,filteredSelectionPreserved:true,primaryDisabled:true,emptySelectionBlocked:true,employeeChangeReset:true,productionMutations:false}));
}finally{await browser.close();await server.close();await fs.rm(root,{recursive:true,force:true});}
