// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/app/(app)/penjualan/online/actions',()=>({buatPenjualanOnline:vi.fn(),recoverUnitPosting:vi.fn()}));
vi.mock('@/app/(app)/pos/produksi/actions',()=>({simpanResep:vi.fn()}));
import {BarisJualForm} from '@/app/(app)/penjualan/BarisJualForm';
import {OnlineForm} from '@/app/(app)/penjualan/online/baru/OnlineForm';
import {ResepForm} from '@/app/(app)/pos/produksi/ResepForm';
import {transactionDraftName} from '@/components/TransactionDraft';
const units=[{unit:'pcs',factor:1,sell_price:10,buy_price:5},{unit:'box',factor:12,sell_price:120,buy_price:60}];
const items=[{id:'a',code:'SKU-A',name:'Nama sama',unit:'pcs',sell_price:10,units},{id:'b',code:'SKU-B',name:'Nama sama',unit:'pcs',sell_price:20,units}];
let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();sessionStorage.clear();});
async function edit(input:HTMLInputElement|HTMLSelectElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));});}
async function pick(label:string,code:string){const input=host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);expect(input).not.toBeNull();await edit(input!,code);const option=[...document.querySelectorAll<HTMLButtonElement>('[role=option]')].find(b=>b.textContent?.includes(code));expect(option).toBeDefined();await act(async()=>option!.click());expect(input!.value).toBe('Nama sama');}
const payload=()=>JSON.parse(host.querySelector<HTMLInputElement>('[name=items]')!.value);
it('renders a legacy sales draft name without rewriting its saved payload or quantities',async()=>{
 const row={nama:'SKU-B — Nama sama',qty:7,harga:91,item_id:'b',satuan:'box',faktor:12};
 sessionStorage.setItem(transactionDraftName('actor','transaction','legacy-quote'),JSON.stringify({version:1,savedAt:Date.now(),requestKey:'saved-identity',fields:{},snapshot:{rows:[row]}}));
 await act(async()=>root.render(<form><BarisJualForm userId="actor" scope="legacy-quote" listId="legacy" items={items}/></form>));
 expect(host.querySelector<HTMLInputElement>('[role=combobox]')!.value).toBe('Nama sama');expect(payload()).toEqual([row]);expect(host.querySelector<HTMLInputElement>('[name=draft_key]')!.value).toBe('saved-identity');
});
it('sales rows choose duplicate names by ID and preserve selected units/prices across reload',async()=>{
 const render=async()=>act(async()=>root.render(<form><BarisJualForm userId="actor" scope="quote" listId="quote" items={items}/></form>));await render();await pick('Barang / jasa 1','SKU-B');
 expect(payload()[0]).toMatchObject({item_id:'b',nama:'Nama sama',harga:20,satuan:'pcs',faktor:1});
 await edit(host.querySelector('select')!,'box');expect(payload()[0]).toMatchObject({harga:120,satuan:'box',faktor:12});
 await act(async()=>root.unmount());root=createRoot(host);await render();expect(payload()[0]).toMatchObject({item_id:'b',harga:120,satuan:'box',faktor:12});expect(host.querySelector<HTMLInputElement>('[role=combobox]')!.value).toBe('Nama sama');
 await edit(host.querySelector<HTMLInputElement>('[role=combobox]')!,'');await edit(host.querySelector<HTMLInputElement>('[role=combobox]')!,'Nama sama');expect(payload()[0]).toMatchObject({item_id:null,nama:'Nama sama',harga:120});
});
it('online explicit selection keeps bare names and legacy exact labels; ambiguous text is not a SKU',async()=>{
 await act(async()=>root.render(<OnlineForm items={items} warehouses={[]} customers={[]}/>));await pick('Barang online 1','SKU-B');expect(payload()[0]).toMatchObject({item_id:'b',nama:'Nama sama',harga:20});
 const input=host.querySelector<HTMLInputElement>('[role=combobox]')!;await edit(input,'SKU-A — Nama sama');expect(input.value).toBe('Nama sama');expect(payload()[0].item_id).toBe('a');await edit(input,'');await edit(input,'Nama sama');expect(payload()).toEqual([]);expect(host.textContent).toContain('Belum cocok');
});
it('online replacement display does not reprice original rows or alter request identity on reload',async()=>{
 const replacement={id:'original',no_struk:'FIKTIF',branch_id:'branch',channel:'Shopee',customer_id:null,salesperson_id:null,buyer_name:null,external_ref:null,sale_items:[{item_id:'b',nama:'Nama historis',qty:3,harga:91,satuan:'box',faktor:12}]};
 const render=async()=>act(async()=>root.render(<OnlineForm userId="actor" replacement={replacement} items={items} warehouses={[]} customers={[]}/>));await render();expect(host.querySelector<HTMLInputElement>('[role=combobox]')?.value).toBe('Nama sama');expect(payload()[0]).toEqual({item_id:'b',nama:'Nama historis',qty:3,harga:91,satuan:'box'});const key=host.querySelector<HTMLInputElement>('[name=request_key]')!.value;
 await act(async()=>root.unmount());root=createRoot(host);await render();expect(payload()[0].harga).toBe(91);expect(host.querySelector<HTMLInputElement>('[name=request_key]')!.value).toBe(key);
});
it('production selects output/ingredients by ID with separate codes, retains quantities and blocks missing output',async()=>{
 await act(async()=>root.render(<ResepForm barang={items}/>));const output=host.querySelector<HTMLInputElement>('[aria-label="Barang jadi"]');expect(output).not.toBeNull();expect(output!.checkValidity()).toBe(false);
 await pick('Barang jadi','SKU-B');expect(host.querySelector<HTMLInputElement>('[name=item_id]')!.value).toBe('b');expect(output!.checkValidity()).toBe(true);
 await edit(host.querySelector<HTMLSelectElement>('[aria-label="Satuan hasil resep"]')!,'box');await pick('Bahan produksi 1','SKU-A');await edit(host.querySelector<HTMLSelectElement>('[aria-label="Satuan bahan 1"]')!,'box');
 expect(JSON.parse(host.querySelector<HTMLInputElement>('[name=bahan]')!.value)).toEqual([{item_id:'a',qty:1,satuan:'box'}]);expect(host.querySelector<HTMLSelectElement>('[name=output_unit]')!.value).toBe('box');
 await edit(output!,'tidak dikenal');expect(output!.checkValidity()).toBe(false);expect(host.querySelector<HTMLInputElement>('[name=item_id]')!.value).toBe('');
});
