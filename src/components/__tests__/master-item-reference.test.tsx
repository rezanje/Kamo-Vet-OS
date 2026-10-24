// @vitest-environment jsdom
import {act} from 'react';import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('@/app/(app)/pos/sku/varian/actions',()=>({saveVariantFamily:vi.fn()}));
import {ItemReferenceField} from '@/components/ItemReferenceField';
import {VariantFamilyForm} from '@/app/(app)/pos/sku/varian/VariantFamilyForm';
const items=[{id:'a',name:'Nama sama',code:'SKU-A'},{id:'b',name:'Nama sama',code:'SKU-B'}];
let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove()});
async function pick(label:string,code:string){const input=host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);expect(input).not.toBeNull();await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,code);input!.dispatchEvent(new Event('input',{bubbles:true}))});await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('[role=option]')].find(b=>b.textContent?.includes(code))!.click());expect(input!.value).toBe('Nama sama');}
it('keeps unavailable master references until the operator explicitly changes them',async()=>{await act(async()=>root.render(<form><ItemReferenceField name="reference" items={items} defaultValue="inactive" ariaLabel="Pengganti"/></form>));expect(new FormData(host.querySelector('form')!).get('reference')).toBe('inactive');expect(host.textContent).toContain('Pilihan tersimpan tidak tersedia');await pick('Pengganti','SKU-B');expect(new FormData(host.querySelector('form')!).get('reference')).toBe('b');expect(host.querySelector('[data-item-code]')!.textContent).toBe('Kode: SKU-B')});
it('preserves repeated variant IDs and associated labels when a middle row is removed',async()=>{await act(async()=>root.render(<VariantFamilyForm items={items} categories={[]}/>));await pick('SKU varian 1','SKU-A');await pick('SKU varian 2','SKU-B');await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('Tambah SKU'))!.click());await pick('SKU varian 3','SKU-A');const fields=host.querySelectorAll<HTMLInputElement>('[name=label]');await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(fields[2],'Varian ketiga');fields[2].dispatchEvent(new Event('input',{bubbles:true}))});const removes=host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Hapus SKU"]');expect(removes).toHaveLength(3);await act(async()=>removes[1].click());const data=new FormData(host.querySelector('form')!);expect(data.getAll('item_id')).toEqual(['a','a']);expect(data.getAll('label')).toEqual(['','Varian ketiga'])});

it('required reference fields reject typed text until an explicit ID is selected',async()=>{
 await act(async()=>root.render(<form><ItemReferenceField name="reference" items={items} required ariaLabel="Required SKU"/></form>));const input=host.querySelector<HTMLInputElement>('[role=combobox]')!;expect(input.checkValidity()).toBe(false);await pick('Required SKU','SKU-B');expect(input.checkValidity()).toBe(true);
});
it('follows a new stored reference when the same master field is reused for another record',async()=>{
 const field=(defaultValue:string)=><form><ItemReferenceField name="reference" items={items} defaultValue={defaultValue} ariaLabel="Stored SKU"/></form>;
 await act(async()=>root.render(field('a')));expect(new FormData(host.querySelector('form')!).get('reference')).toBe('a');await act(async()=>root.render(field('b')));expect(new FormData(host.querySelector('form')!).get('reference')).toBe('b');expect(host.textContent).toContain('Kode: SKU-B');
});
it('blocks unfinished optional substitute searches while allowing deliberate empty clearing',async()=>{
 await act(async()=>root.render(<form><ItemReferenceField name="reference" items={items} defaultValue="a" ariaLabel="Optional substitute"/></form>));const input=host.querySelector<HTMLInputElement>('[role=combobox]')!;
 const edit=async(value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))});
 await edit('Belum dipilih');expect(input.checkValidity()).toBe(false);expect(host.querySelector('form')!.checkValidity()).toBe(false);await edit('');expect(input.checkValidity()).toBe(true);expect(new FormData(host.querySelector('form')!).get('reference')).toBe('');
});
