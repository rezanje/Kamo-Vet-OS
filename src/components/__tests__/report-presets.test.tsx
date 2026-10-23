// @vitest-environment jsdom
import { act } from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({path:'/laporan/promo',search:''}));
vi.mock('next/navigation',()=>({usePathname:()=>state.path,useSearchParams:()=>new URLSearchParams(state.search)}));
vi.mock('next/link',()=>({default:({href,children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a href={href} {...props}>{children}</a>}));
import {DraftUserProvider} from '../LocalTransactionDraft';
import {ReportPresets} from '../ReportPresets';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{localStorage.clear();state.path='/laporan/promo';state.search='';Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
async function render(user='a',directory=false,defaults='dari=2026-10-01&sampai=2026-10-31&dokter=doc-a'){await act(async()=>root.render(<DraftUserProvider userId={user}><div data-report-page><form data-report-filters><input name="dari" defaultValue="2026-10-01"/><input name="sampai" defaultValue="2026-10-31"/><select name="dokter" defaultValue="doc-a"><option value="doc-a">Dokter A</option><option value="doc-b">Dokter B</option></select></form><ReportPresets title="Promo" directory={directory} appliedDefaults={defaults}/></div></DraftUserProvider>));}
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
it('does not claim persistence or overwrite data when browser storage fails',async()=>{
 await render();await name('Gagal');vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});await click('Simpan konfigurasi');
 expect(host.querySelector('[role=alert]')?.textContent).toContain('belum tersimpan');expect(host.querySelector('a')).toBeNull();
});
it('retains existing configurations on a corrupt store and supports navigation without stale filters',async()=>{
 await render();await name('Awal');await click('Simpan konfigurasi');state.search='dari=2026-11-01&sampai=2026-11-30&dokter=doc-b';await render('a',false,state.search);await name('Baru');await click('Simpan konfigurasi');
 expect(Array.from(host.querySelectorAll('a')).find(x=>x.textContent==='Baru')?.getAttribute('href')).toContain('dari=2026-11-01');
 vi.spyOn(Storage.prototype,'getItem').mockReturnValue('broken');await name('Rusak');await click('Simpan konfigurasi');expect(host.querySelector('[role=alert]')?.textContent).toContain('belum tersimpan');expect(host.textContent).toContain('Awal');
});
it('uses server-applied reset filters after navigation even when dirty uncontrolled inputs remain',async()=>{
 state.search='dokter=doc-a';await render();host.querySelector<HTMLSelectElement>('[name=dokter]')!.value='doc-b';host.querySelector<HTMLInputElement>('[name=dari]')!.value='2099-01-01';
 state.search='';await render('a',false,'dari=2026-11-01&sampai=2026-11-30&dokter=');await name('Reset');await click('Simpan konfigurasi');
 const href=host.querySelector('a')!.getAttribute('href')!;expect(href).toContain('dari=2026-11-01');expect(href).toContain('dokter=');expect(href).not.toContain('doc-b');expect(href).not.toContain('2099');
});
