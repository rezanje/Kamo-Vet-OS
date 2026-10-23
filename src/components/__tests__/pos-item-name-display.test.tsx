// @vitest-environment jsdom
import {act} from 'react';import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/app/(app)/pos/permintaan/actions',()=>({buatPermintaan:vi.fn()}));
vi.mock('@/app/(app)/pos/pemindahan/actions',()=>({buatKirim:vi.fn()}));
import {PermintaanForm} from '@/app/(app)/pos/permintaan/baru/PermintaanForm';
import {PemindahanForm} from '@/app/(app)/pos/pemindahan/baru/PemindahanForm';
const units=[{unit:'pcs',factor:1,buy_price:5,sell_price:10},{unit:'box',factor:10,buy_price:50,sell_price:100}];
const items=[{id:'a',code:'SKU-A',name:'Nama sama',unit:'pcs',kategori:'Fiktif',units},{id:'b',code:'SKU-B',name:'Nama sama',unit:'pcs',kategori:'Fiktif',units}];
let root:Root,host:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();sessionStorage.clear();});
async function edit(control:HTMLInputElement|HTMLSelectElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(control,value);control.dispatchEvent(new Event(control instanceof HTMLSelectElement?'change':'input',{bubbles:true}));});}
const payload=()=>JSON.parse(host.querySelector<HTMLInputElement>('[name=items]')!.value);
it.each(['request','transfer'])('%s chooses duplicate-name stock items by ID with name/code separate and restores units',async kind=>{
 const render=async()=>act(async()=>root.render(kind==='request'?<PermintaanForm userId="actor" branches={[]} warehouses={[]} items={items}/>:<PemindahanForm userId="actor" warehouses={[]} items={items}/>));
 await render();const input=host.querySelector<HTMLInputElement>('[role=combobox]');expect(input).not.toBeNull();await edit(input!,'SKU-B');await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('[role=option]')].find(b=>b.textContent?.includes('SKU-B'))!.click());expect(input!.value).toBe('Nama sama');expect(host.querySelector('[data-item-code]')!.textContent).toBe('Kode: SKU-B');expect(payload()[0].item_id).toBe('b');
 const unit=host.querySelector<HTMLSelectElement>(kind==='request'?'select[title=Satuan]':'select[aria-label="Satuan barang"]')!;await edit(unit,'box');const key=host.querySelector<HTMLInputElement>('[name=request_key]')?.value;
 await act(async()=>root.unmount());root=createRoot(host);await render();expect(payload()[0]).toMatchObject({item_id:'b',satuan:'box'});expect(host.querySelector<HTMLInputElement>('[role=combobox]')!.value).toBe('Nama sama');if(key)expect(host.querySelector<HTMLInputElement>('[name=request_key]')!.value).toBe(key);
});
it('retains a legacy transfer selection and its warehouse stock without rewriting the stored display',async()=>{
 const rows=[{display:'SKU-B — Nama sama',item_id:'b',qty:3,satuan:'box'}];sessionStorage.setItem('vetos:transaction-draft:v1:actor:transaction:pos:pemindahan:baru',JSON.stringify({version:1,savedAt:Date.now(),requestKey:'legacy-key',fields:{from_warehouse_id:'warehouse'},snapshot:{rows,requestKey:'transfer-key',warehouseId:'warehouse'}}));
 await act(async()=>root.render(<PemindahanForm userId="actor" warehouses={[{id:'warehouse',name:'Gudang fiktif'}]} items={items} stock={[{id:'stock',warehouse_id:'warehouse',item_id:'b',qty:25}]}/>));
 expect(host.querySelector<HTMLInputElement>('[role=combobox]')?.value).toBe('Nama sama');expect(payload()).toEqual([{item_id:'b',qty:3,satuan:'box'}]);expect(host.textContent).toContain('2,5 box');expect(host.querySelector<HTMLInputElement>('[name=request_key]')!.value).toBe('transfer-key');const stored=JSON.parse(sessionStorage.getItem('vetos:transaction-draft:v1:actor:transaction:pos:pemindahan:baru')!);expect(stored.snapshot.rows).toEqual(rows);
});
