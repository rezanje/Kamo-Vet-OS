// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
vi.mock('@/app/(app)/penjualan/online/actions',()=>({buatPenjualanOnline:vi.fn(),recoverUnitPosting:vi.fn()}));
vi.mock('@/app/(app)/pembelian/retur/actions',()=>({buatReturBeli:vi.fn()}));
vi.mock('@/app/(app)/penjualan/retur/actions',()=>({buatReturJual:vi.fn()}));
import {OnlineForm} from '@/app/(app)/penjualan/online/baru/OnlineForm';
import {ReturJualForm} from '@/app/(app)/penjualan/retur/baru/ReturJualForm';
import {ReturBeliForm} from '@/app/(app)/pembelian/retur/baru/ReturBeliForm';
const units=[{unit:'pcs',factor:1,sell_price:10,buy_price:5},{unit:'box',factor:12,sell_price:120,buy_price:60}];
async function mount(tree:React.ReactNode){Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const c=document.createElement('div');document.body.append(c);const root=createRoot(c);await act(async()=>root.render(tree));return {c,dispose:async()=>{await act(async()=>root.unmount());c.remove();}};}
it('online exposes the selected unit and submits its name',async()=>{
 const {c,dispose}=await mount(<OnlineForm warehouses={[]} customers={[]} items={[{id:'sku',code:'S',name:'SKU',sell_price:10,units}]}/>);
 try{const input=c.querySelector<HTMLInputElement>('input[list="onl-items"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'S — SKU');input.dispatchEvent(new Event('input',{bubbles:true}));});
 const select=c.querySelector<HTMLSelectElement>('select[title="Satuan"]');expect(select).not.toBeNull();
 await act(async()=>{select!.value='box';select!.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(JSON.parse(c.querySelector<HTMLInputElement>('input[name="items"]')!.value)[0]).toMatchObject({satuan:'box',harga:120});
 }finally{await dispose();}
});
it.each(['sale','purchase'])('return %s uses exact source and divides base ceiling by selected factor',async(kind)=>{
 const row={source_line_id:'line',item_id:'sku',nama:'SKU',harga:10,sisa:18,units};
 const {c,dispose}=await mount(kind==='sale'?<ReturJualForm saleId="s" info="test" rows={[row]}/>:<ReturBeliForm options={[{id:'po',label:'PO',items:[row]}]}/>);
 try{if(kind==='purchase'){const po=c.querySelector('select')!;await act(async()=>{po.value='po';po.dispatchEvent(new Event('change',{bubbles:true}));});}
 const unit=c.querySelector<HTMLSelectElement>('select[title="Satuan retur"]');expect(unit).not.toBeNull();await act(async()=>{unit!.value='box';unit!.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(c.querySelector<HTMLInputElement>('input[title="Qty retur"]')!.max).toBe('1.5');
 }finally{await dispose();}
});
it('online restores selected-unit cart after refresh and clears only confirmed request',async()=>{
 sessionStorage.clear();
 let mounted=await mount(<OnlineForm userId="actor" warehouses={[]} customers={[]} items={[{id:'sku',code:'S',name:'SKU',sell_price:10,units}]}/>);
 const input=mounted.c.querySelector<HTMLInputElement>('input[list="onl-items"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'S — SKU');input.dispatchEvent(new Event('input',{bubbles:true}));});
 const unit=mounted.c.querySelector<HTMLSelectElement>('select[title="Satuan"]')!;
 await act(async()=>{unit.value='box';unit.dispatchEvent(new Event('change',{bubbles:true}));});
 const original=mounted.c.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
 await disposeAndReset();
 async function disposeAndReset(){await mounted.dispose();mounted=await mount(<OnlineForm userId="actor" warehouses={[]} customers={[]} items={[{id:'sku',code:'S',name:'SKU',sell_price:10,units}]}/>);}
 try {
  expect(mounted.c.querySelector<HTMLSelectElement>('select[title="Satuan"]')!.value).toBe('box');
  expect(JSON.parse(mounted.c.querySelector<HTMLInputElement>('input[name="items"]')!.value)[0]).toMatchObject({satuan:'box',harga:120});
  expect(mounted.c.querySelector<HTMLInputElement>('input[name="request_key"]')!.value).toBe(original);
  history.replaceState({},'',`/?request_scope=online&request_done=${original}`);
  await disposeAndReset();
  expect(JSON.parse(mounted.c.querySelector<HTMLInputElement>('input[name="items"]')!.value)).toEqual([]);
  expect(mounted.c.querySelector<HTMLInputElement>('input[name="request_key"]')!.value).not.toBe(original);
 }finally{history.replaceState({},'','/');await mounted.dispose();sessionStorage.clear();}
});
it('a same-mounted success rotates only its matching acknowledgement and resets the cart',async()=>{
 sessionStorage.clear();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const c=document.createElement('div');document.body.append(c);const root=createRoot(c);
 const render=(confirmedScope?:string,confirmedKey?:string)=><OnlineForm userId="same-actor" confirmedScope={confirmedScope} confirmedKey={confirmedKey} warehouses={[]} customers={[]} items={[{id:'sku',code:'S',name:'SKU',sell_price:10,units}]}/>;
 try{
  await act(async()=>root.render(render()));const key=c.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
  const input=c.querySelector<HTMLInputElement>('input[list="onl-items"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'S — SKU');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>root.render(render('different',key)));expect(c.querySelector<HTMLInputElement>('input[name="request_key"]')!.value).toBe(key);
  await act(async()=>root.render(render('online',key)));
  expect(c.querySelector<HTMLInputElement>('input[name="request_key"]')!.value).not.toBe(key);
  expect(JSON.parse(c.querySelector<HTMLInputElement>('input[name="items"]')!.value)).toEqual([]);
  await act(async()=>{const next=c.querySelector<HTMLInputElement>('input[list="onl-items"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(next,'S — SKU');next.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(JSON.parse(c.querySelector<HTMLInputElement>('input[name="items"]')!.value)).toHaveLength(1);
 }finally{await act(async()=>root.unmount());c.remove();sessionStorage.clear();}
});
