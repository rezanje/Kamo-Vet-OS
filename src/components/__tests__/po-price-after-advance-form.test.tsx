// @vitest-environment jsdom
import React,{act}from 'react';import{createRoot,type Root}from 'react-dom/client';import{beforeEach,afterEach,expect,it,vi}from 'vitest';
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/app/(app)/pembelian/actions',()=>({ubahHargaPO:vi.fn()}));
import{POPriceCorrectionForm}from '@/app/(app)/pembelian/[id]/POPriceCorrectionForm';
let root:Root,host:HTMLDivElement;
const render=async()=>act(async()=>root.render(<POPriceCorrectionForm userId="p05-owner" poId="p05-po" revision={2} originalTotal={600000} activeAdvances={400000} rows={[{id:'source-line',nama:'Fictional item',qty:2,satuan:'box',harga_beli:300000}]}/>));
const price=()=>host.querySelector<HTMLInputElement>('input[aria-label="Harga PO 1"]')!;
const payload=()=>JSON.parse(host.querySelector<HTMLInputElement>('input[name="items"]')!.value);
const button=()=>host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
async function input(text:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(price(),text);price().dispatchEvent(new Event('input',{bubbles:true}));});}
beforeEach(async()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);await render();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('submits exact source ID and price without editable quantity unit or parent fields',()=>{
 expect(payload()).toEqual([{id:'source-line',harga_beli:300000}]);expect(host.textContent).toContain('2 box');expect(host.querySelector('[name="supplier_id"],[name="qty"],[name="satuan"]')).toBeNull();expect(host.textContent).toContain('DP aktif Rp 400.000');
});
it('exact DP cap is allowed and lower new totals disable submission',async()=>{
 await input('200000');expect(button().disabled).toBe(false);await input('199999.99');expect(button().disabled).toBe(true);expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
it('empty editing state stays blank and new typing never appends default zero',async()=>{
 await input('');expect(price().value).toBe('');expect(button().disabled).toBe(true);await input('250000');expect(payload()[0].harga_beli).toBe(250000);expect(button().disabled).toBe(false);
});
it('restores exact cent prices and durable identity after draft reload',async()=>{
 await input('250000.25');const key=host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;
 await act(async()=>window.dispatchEvent(new Event('pagehide')));await act(async()=>root.unmount());root=createRoot(host);await render();
 expect(payload()).toEqual([{id:'source-line',harga_beli:250000.25}]);expect(host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value).toBe(key);expect(host.textContent).toContain('Rp 500.000,5');
});
it('subcent unit prices remain visible but cannot submit',async()=>{await input('250000.001');expect(button().disabled).toBe(true);expect(payload()[0].harga_beli).toBe(250000.001);});
