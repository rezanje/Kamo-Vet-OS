// @vitest-environment jsdom
import {act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {beforeEach,afterEach,expect,it,vi} from 'vitest';
vi.mock('@/app/(app)/penjualan/retur/actions',()=>({buatReturJual:vi.fn(),recoverReturJual:vi.fn()}));
vi.mock('@/app/(app)/penjualan/online/actions',()=>({recoverUnitPosting:vi.fn()}));
import {ReturJualForm} from '@/app/(app)/penjualan/retur/baru/ReturJualForm';
let root:Root,host:HTMLDivElement;
const rows=[{source_line_id:'line',item_id:'item',nama:'Fictional service',harga:50000,sisa:2,source_qty:2,source_unit:'pcs',source_factor:1,units:[{unit:'pcs',factor:1,buy_price:0,sell_price:0}],berstok:false,trackExpiry:false}];
beforeEach(()=>{sessionStorage.clear();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);});afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function render(){await act(async()=>root.render(<ReturJualForm userId="fictional" saleId="sale" info="STR.FICTION — Umum" rows={rows}/>));}
async function type(selector:string,value:string){const input=host.querySelector<HTMLInputElement>(selector)!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
async function transfer(){const select=host.querySelector<HTMLSelectElement>('[name=refund_method]')!;expect(select).not.toBeNull();await act(async()=>{select.value='Transfer';select.dispatchEvent(new Event('change',{bubbles:true}));});}
it('requires an explicit payout choice and explains pending transfer before creating financial effects',async()=>{
 await render();expect(host.querySelector<HTMLSelectElement>('[name=refund_method]')?.value).toBe('');await transfer();
 expect(host.querySelector('[name=refund_bank]')).not.toBeNull();expect(host.querySelector('[name=refund_account]')).not.toBeNull();expect(host.querySelector('[name=refund_name]')).not.toBeNull();expect(host.textContent).toContain('belum diposting');
});
it('restores selected payout and destination with the same durable request after reload',async()=>{
 await render();await transfer();await type('[name=refund_account]','00012345');const key=host.querySelector<HTMLInputElement>('[name=request_key]')!.value;
 await act(async()=>root.unmount());root=createRoot(host);await render();expect(host.querySelector<HTMLSelectElement>('[name=refund_method]')!.value).toBe('Transfer');expect(host.querySelector<HTMLInputElement>('[name=refund_account]')!.value).toBe('00012345');expect(host.querySelector<HTMLInputElement>('[name=request_key]')!.value).toBe(key);
});
