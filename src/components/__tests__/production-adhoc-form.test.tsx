// @vitest-environment jsdom
import {act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {beforeEach,afterEach,expect,it,vi} from 'vitest';
vi.mock('@/app/(app)/pos/produksi/actions',()=>({mulaiProduksiAdhoc:vi.fn(),recoverProductionPosting:vi.fn()}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));
import {ProductionAdhocForm} from '@/app/(app)/pos/produksi/ProductionAdhocForm';
let host:HTMLDivElement,root:Root;
const barang=[{id:'a',code:'A',name:'Bahan A',unit:'PCS',units:[{unit:'PCS',factor:1,sell_price:0,buy_price:0},{unit:'BOX',factor:2,sell_price:0,buy_price:0}]},{id:'b',code:'B',name:'Hasil B',unit:'PCS'}];
const gudang=[{id:'w1',name:'Sumber satu',branch_id:'one'},{id:'w2',name:'Sumber dua',branch_id:'one'},{id:'w3',name:'Lain cabang',branch_id:'two'}];
beforeEach(()=>{sessionStorage.clear();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);});afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function render(user='u'){await act(async()=>root.render(<ProductionAdhocForm userId={user} barang={barang} gudang={gudang} cabang={[{id:'one',name:'Cabang satu'},{id:'two',name:'Cabang dua'}]}/>));}
async function choose(label:string,value:string){const input=host.querySelector<HTMLInputElement|HTMLSelectElement>(`[aria-label="${label}"]`)!;if(input instanceof HTMLSelectElement){await act(async()=>{input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));});}else{const item=barang.find(x=>x.id===value)!;await act(async()=>input.focus());await type(label,item.code);const button=Array.from(document.querySelectorAll<HTMLButtonElement>('[role=option]')).find(x=>x.textContent===`${item.name}Kode: ${item.code}`)!;await act(async()=>button.click());}}
async function type(label:string,value:string){const input=host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
it('keeps exact material quantities, selectable units and warehouse per row without a master recipe',async()=>{
 await render();await choose('Cabang pekerjaan','one');await choose('Barang hasil','b');await choose('Gudang hasil','w2');await choose('Bahan 1','a');await choose('Gudang bahan 1','w1');await choose('Satuan bahan 1','BOX');await type('Jumlah bahan 1','0.1234567890123456789');
 const rows=JSON.parse(host.querySelector<HTMLInputElement>('[name=bahan]')!.value);expect(rows).toEqual([{item_id:'a',warehouse_id:'w1',qty:'0.1234567890123456789',satuan:'BOX'}]);
 expect(host.querySelector('[name=recipe_id]')).toBeNull();expect(host.querySelector('[name=production_mode]')?.getAttribute('value')).toBe('adhoc');
 expect(host.querySelector<HTMLSelectElement>('[name=warehouse_id]')!.textContent).not.toContain('Lain cabang');
});
it('keeps selections outside search, distinguishes codes, and isolates account drafts',async()=>{
 await render();await choose('Cabang pekerjaan','one');await choose('Bahan 1','a');await type('Bahan 1','Hasil');expect(JSON.parse(host.querySelector<HTMLInputElement>('[name=bahan]')!.value)[0].item_id).toBe('a');expect(host.textContent).toContain('Kode: A');
 await render('other');expect(JSON.parse(host.querySelector<HTMLInputElement>('[name=bahan]')!.value)[0].item_id).toBe('');
});
it('preserves ad hoc rows on reload, restores scoped posting key and never silently remaps warehouses on branch change',async()=>{
 await render();await choose('Cabang pekerjaan','one');await choose('Bahan 1','a');await choose('Gudang bahan 1','w1');await type('Jumlah bahan 1','5');
 const key=host.querySelector<HTMLInputElement>('[name=request_key]')!.value;
 await act(async()=>root.unmount());root=createRoot(host);await render();expect(JSON.parse(host.querySelector<HTMLInputElement>('[name=bahan]')!.value)[0].qty).toBe('5');expect(host.querySelector<HTMLInputElement>('[name=request_key]')!.value).toBe(key);
 await choose('Cabang pekerjaan','two');expect(host.querySelector<HTMLInputElement>('[aria-label="Bahan 1"]')!.value).toBe('Bahan A');expect(JSON.parse(host.querySelector<HTMLInputElement>('[name=bahan]')!.value)[0].warehouse_id).toBe('');
});
