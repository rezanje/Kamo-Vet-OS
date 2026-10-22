// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {it,expect,vi,beforeEach,afterEach} from 'vitest';
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/app/(app)/pembelian/actions',()=>({buatPO:async()=>{throw new Error('fixture offline')},recoverPurchaseSubmission:vi.fn()}));
import {POForm} from '@/app/(app)/pembelian/baru/POForm';
let root:Root,host:HTMLDivElement;const render=async()=>{await act(async()=>root.render(<POForm userId="fixture-owner" suppliers={[]} warehouses={[]} branches={[]} items={[]}/>));};
const price=()=>host.querySelector<HTMLInputElement>('input[placeholder="Harga beli"]')!;
const payload=()=>JSON.parse(host.querySelector<HTMLInputElement>('input[name=items]')!.value)[0];
async function input(value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(price(),value);price().dispatchEvent(new Event('input',{bubbles:true}));});}
beforeEach(async()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);await render();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('starts blank and lets a cleared price remain blank without reinserting zero',async()=>{expect(price().value).toBe('');await input('10000');await input('');expect(price().value).toBe('');expect(payload().harga_beli).toBe(0);await input('10000');expect(payload().harga_beli).toBe(10000);});
it('keeps decimal numeric payload and restores it through real purchase draft reload',async()=>{await input('12.75');expect(payload().harga_beli).toBe(12.75);await act(async()=>window.dispatchEvent(new Event('pagehide')));await act(async()=>root.unmount());root=createRoot(host);await render();expect(price().value).toBe('12.75');expect(payload().harga_beli).toBe(12.75);expect(typeof payload().harga_beli).toBe('number');});
it('accepts an explicit zero and keeps empty payload numeric rather than NaN',async()=>{await input('0');expect(payload().harga_beli).toBe(0);await input('');expect(Number.isFinite(payload().harga_beli)).toBe(true);expect(host.querySelector<HTMLInputElement>('input[name=items]')!.value).not.toContain('"harga_beli":null');});
it('replaces a zero on refocus so new typing cannot append to it',async()=>{await input('0');await act(async()=>price().focus());expect(price().value).toBe('');await input('10000');expect(price().value).toBe('10000');expect(payload().harga_beli).toBe(10000);});
