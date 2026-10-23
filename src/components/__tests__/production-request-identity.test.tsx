// @vitest-environment jsdom
import { act } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({search:''}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(state.search)}));
vi.mock('@/app/(app)/pos/produksi/actions',()=>({recoverProductionPosting:vi.fn()}));
import { ProductionRequestIdentity } from '../ProductionRequestIdentity';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{sessionStorage.clear();state.search='';Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
const render=async(user='user-a',kind:'start'|'finish'='start',orderId='order-a')=>{await act(async()=>root.render(<form><ProductionRequestIdentity userId={user} kind={kind} orderId={orderId}/></form>));};
const key=()=>host.querySelector<HTMLInputElement>('[name=request_key]')!.value;
it('retains the same request across remount/reload and offers receipt recovery',async()=>{
 await render();const first=key();expect(first).not.toBe('');
 await act(async()=>root.unmount());root=createRoot(host);await render();
 expect(key()).toBe(first);expect(host.textContent).toContain('Periksa hasil produksi terakhir');
});
it('isolates accounts and completion identities by job',async()=>{
 await render();const a=key();await render('user-b');expect(key()).not.toBe(a);await render();expect(key()).toBe(a);
 await render('user-a','finish','one');const one=key();await render('user-a','finish','two');expect(key()).not.toBe(one);await render('user-a','finish','one');expect(key()).toBe(one);
});
it('retires only the matching confirmed request, retaining unknown outcomes',async()=>{
 await render();const first=key();state.search='request_scope=production-start&request_done=other';await render();expect(key()).toBe(first);
 state.search='request_scope=production-start&request_done='+first;await render();expect(key()).not.toBe(first);
});
it('cannot submit a durable identity when session storage is unavailable',async()=>{
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('blocked');});await render();
 expect(key()).toBe('');expect(host.textContent).toContain('Penyimpanan sesi tidak tersedia');
});
