// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
vi.mock('@/app/login/actions',()=>({login:vi.fn()}));
import LoginPage from '@/app/login/page';

it('public login never publishes sample accounts, roles or shared-password hints',async()=>{
 const html=renderToStaticMarkup(await LoginPage({searchParams:Promise.resolve({})}));
 const host=document.createElement('div');host.innerHTML=html;
 expect(host.querySelector('[aria-labelledby="akun-demo-title"]')===null).toBe(true);
 expect(host.querySelector('table')===null).toBe(true);
 expect(/akun demo|password semua akun/i.test(host.textContent??'')).toBe(false);
 expect(/\b(?:OWNER|ADMIN|FINANCE|STAFF|DOCTOR)\b/.test(host.textContent??'')).toBe(false);
 expect(host.querySelector('input[name="email"][type="email"][required]')!==null).toBe(true);
 expect(host.querySelector('input[name="password"][type="password"][required]')!==null).toBe(true);
 expect(host.querySelector('button[type="submit"]')!==null).toBe(true);
});
it('keeps original escaped login errors and administrator help without demo disclosure',async()=>{
 const html=renderToStaticMarkup(await LoginPage({searchParams:Promise.resolve({error:'<img src=x onerror=alert(1)> sesi berakhir'})}));
 const host=document.createElement('div');host.innerHTML=html;
 expect(host.textContent?.includes('sesi berakhir')).toBe(true);
 expect(host.querySelector('img')===null).toBe(true);
 expect(host.textContent?.includes('Hubungi admin Kamo Group')).toBe(true);
});
it('removes demo credential definitions from the server page, not just their CSS visibility',()=>{
 const source=readFileSync('src/app/login/page.tsx','utf8');
 expect(/AKUN_DEMO|PASSWORD_DEMO|akun-demo-title/.test(source)).toBe(false);
});
