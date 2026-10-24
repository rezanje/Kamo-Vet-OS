// @vitest-environment jsdom
import { act } from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({path:'/laporan/promo',search:'',user:'a',fail:false,lostResponse:false,server:{} as Record<string,{id:string;name:string;href:string;savedAt:string}[]>,writes:[] as {id:string;name:string;href:string}[]}));
vi.mock('@/app/(app)/laporan/preset-actions',()=>({listPrivateReportPresets:async()=>state.fail?{ok:false,message:'Daftar akun belum dapat dimuat.'}:{ok:true,userId:state.user,rows:state.server[state.user]??[]},savePrivateReportPreset:async(input:{id:string;name:string;href:string})=>{state.writes.push(input);if(state.fail)return {ok:false,message:'Hasil penyimpanan belum dapat dikonfirmasi.'};const rows=state.server[state.user]??[];state.server[state.user]=[...rows.filter(r=>r.id!==input.id),{...input,savedAt:'2026-10-23T12:00:00Z'}];if(state.lostResponse){state.lostResponse=false;return {ok:false,message:'Hasil penyimpanan belum dapat dikonfirmasi.'};}return {ok:true,userId:state.user,rows:state.server[state.user]};},deletePrivateReportPreset:async(id:string)=>{if(state.fail)return {ok:false,message:'Penghapusan belum dapat dikonfirmasi.'};state.server[state.user]=(state.server[state.user]??[]).filter(r=>r.id!==id);return {ok:true,userId:state.user,rows:state.server[state.user]};}}));
vi.mock('next/navigation',()=>({usePathname:()=>state.path,useSearchParams:()=>new URLSearchParams(state.search)}));
vi.mock('next/link',()=>({default:({href,children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a href={href} {...props}>{children}</a>}));
import {DraftUserProvider} from '../LocalTransactionDraft';
import {ReportPresets} from '../ReportPresets';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{localStorage.clear();Object.assign(state,{path:'/laporan/promo',search:'',user:'a',fail:false,lostResponse:false,server:{},writes:[]});Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
async function render(user='a',directory=false,defaults='dari=2026-10-01&sampai=2026-10-31&dokter=doc-a'){state.user=user;await act(async()=>root.render(<DraftUserProvider userId={user}><div data-report-page><form data-report-filters><input name="dari" defaultValue="2026-10-01"/><input name="sampai" defaultValue="2026-10-31"/><select name="dokter" defaultValue="doc-a"><option value="doc-a">Dokter A</option><option value="doc-b">Dokter B</option></select></form><ReportPresets title="Promo" directory={directory} appliedDefaults={defaults}/></div></DraftUserProvider>));}
async function name(value:string){const input=host.querySelector<HTMLInputElement>('[aria-label="Nama konfigurasi laporan"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
async function click(text:string){const button=Array.from(host.querySelectorAll('button')).find(x=>x.textContent===text)!;expect(button).toBeDefined();await act(async()=>button.click());}
it('saves applied default filters, ignores unsubmitted edits and restores after reload',async()=>{
 await render();host.querySelector<HTMLInputElement>('[name=dari]')!.value='2099-01-01';await name('Vaksin');await click('Simpan konfigurasi');
 const link=Array.from(host.querySelectorAll('a')).find(x=>x.textContent==='Vaksin')!;
 expect(link.getAttribute('href')).toContain('dari=2026-10-01');expect(link.getAttribute('href')).toContain('dokter=doc-a');
 await act(async()=>root.unmount());root=createRoot(host);await render();expect(host.textContent).toContain('Vaksin');
});
it('does not expose another account and allows directory reopening and deletion',async()=>{
 await render();await name('Milik A');await click('Simpan konfigurasi');await render('b');expect(host.textContent).not.toContain('Milik A');
 state.path='/laporan';await render('a',true);expect(host.querySelector('a')?.getAttribute('href')).toContain('/laporan/promo?');
 await click('Hapus Milik A');expect(host.textContent).not.toContain('Milik A');
});
it('does not claim persistence or delete the displayed preference when server calls fail',async()=>{
 await render();await name('Existing');await click('Simpan konfigurasi');state.fail=true;await name('Gagal');await click('Simpan konfigurasi');
 expect(host.querySelector('[role=alert]')?.textContent).toContain('belum dapat dikonfirmasi');expect(host.textContent).toContain('Existing');expect(host.querySelector('a')?.textContent).not.toBe('Gagal');
 await click('Hapus Existing');expect(host.textContent).toContain('Existing');
});
it('uses server persistence even when legacy browser storage is corrupt, preserving navigation defaults',async()=>{
 await render();await name('Awal');await click('Simpan konfigurasi');state.search='dari=2026-11-01&sampai=2026-11-30&dokter=doc-b';await render('a',false,state.search);await name('Baru');await click('Simpan konfigurasi');
 expect(Array.from(host.querySelectorAll('a')).find(x=>x.textContent==='Baru')?.getAttribute('href')).toContain('dari=2026-11-01');
 vi.spyOn(Storage.prototype,'getItem').mockReturnValue('broken');await name('Server tetap');await click('Simpan konfigurasi');expect(state.server.a.some(r=>r.name==='Server tetap')).toBe(true);expect(host.textContent).toContain('Awal');
});
it('uses server-applied reset filters after navigation even when dirty uncontrolled inputs remain',async()=>{
 state.search='dokter=doc-a';await render();host.querySelector<HTMLSelectElement>('[name=dokter]')!.value='doc-b';host.querySelector<HTMLInputElement>('[name=dari]')!.value='2099-01-01';
 state.search='';await render('a',false,'dari=2026-11-01&sampai=2026-11-30&dokter=');await name('Reset');await click('Simpan konfigurasi');
 const href=host.querySelector('a')!.getAttribute('href')!;expect(href).toContain('dari=2026-11-01');expect(href).toContain('dokter=');expect(href).not.toContain('doc-b');expect(href).not.toContain('2099');
});

it('reloads the same server configuration with an empty browser store and keeps kolom on month changes',async()=>{
 state.search='periode=2026-10&kolom=%7B%22t12345678-1%22%3A%5B2%5D%7D';await render('a',false,'periode=2026-10');await name('Bulanan');await click('Simpan konfigurasi');
 await act(async()=>root.unmount());localStorage.clear();root=createRoot(host);state.search='periode=2026-11&kolom=%7B%22t12345678-1%22%3A%5B2%5D%7D';await render('a',false,'periode=2026-11');
 expect(host.textContent).toContain('Bulanan');expect(host.querySelector('a')?.getAttribute('href')).toContain('kolom=');await name('November');await click('Simpan konfigurasi');expect(state.server.a.find(r=>r.name==='November')?.href).toContain('periode=2026-11');expect(state.server.a.find(r=>r.name==='November')?.href).toContain('kolom=');
});
it('retries an uncertain response with the same ID and preserves another browser configuration',async()=>{
 await render();state.server.a=[{id:'fa200000-0000-4000-8000-000000000099',name:'Browser lain',href:'/laporan/promo',savedAt:'2026-10-23T10:00:00Z'}];state.lostResponse=true;await name('Retry');await click('Simpan konfigurasi');await click('Simpan konfigurasi');expect(state.writes[0].id).toBe(state.writes[1].id);expect(state.server.a).toHaveLength(2);expect(host.textContent).toContain('Browser lain');
});
it('offers explicit copying of legacy local configurations without silently uploading or deleting them',async()=>{
 const legacy=[{id:'fa200000-0000-4000-8000-000000000077',name:'Browser lama',href:'/laporan/promo?dokter=old',savedAt:'2026-10-20T10:00:00Z'}];localStorage.setItem('vetos:report-presets:v1:a',JSON.stringify(legacy));await render();expect(state.writes).toEqual([]);expect(host.textContent).toContain('Browser lama');await click('Salin Browser lama ke akun');expect(state.server.a[0].href).toContain('dokter=old');expect(JSON.parse(localStorage.getItem('vetos:report-presets:v1:a')!)).toEqual(legacy);
});
