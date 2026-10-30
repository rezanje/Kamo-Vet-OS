// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({save:vi.fn(),push:vi.fn(),refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:s.push,refresh:s.refresh})}));
vi.mock('@/app/(app)/klinik/rawat-inap/[id]/tagihan/actions',()=>({simpanBayar:s.save}));
vi.mock('@/app/(app)/klinik/pembayaran/[visitId]/actions',()=>({bayarVisit:vi.fn()}));
import {InpatientCashier} from '@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier';
import type {InpatientCashierData} from '@/lib/inpatient-cashier';
let host:HTMLDivElement,root:Root;
const data:InpatientCashierData={snapshot:'current-snapshot',rows:[{id:'rx',item_id:'sku',nama_obat:'Obat Fiktif',qty:1,harga:1000,satuan:'pcs',jenis:'obat'}],history:[{id:'issued',invoice_no:'INV-FIKTIF',total:5000,received:2000,dp_amount:2000,paid_status:'DP',correction_pending:false,lines:[]}],receipts:[],applications:[],quote:{token:'q',remaining:4000,pending:1000,debt:3000,credit:0,subtotal:1000,tax:0,amount:0,excess:0,accounts:[{method:'Tunai',code:'1101',name:'Kas Fiktif',bank:null,number:null}]}};
const render=async(value=data)=>act(async()=>root.render(<InpatientCashier data={value} visitId="visit" recordId="stay" requestKey="cashier-key" masterObat={[{id:'sku',code:'F',name:'Obat Fiktif',unit:'pcs',harga:1000}]} masterJasa={[]} ppnRate={0} minDpPercent={50} bolehTerobos={false}/>));
async function change(label:string,value:string){await act(async()=>{const input=host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})}
const submit=async()=>act(async()=>{host.querySelector('form')!.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true}))});
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});s.save.mockReset();s.push.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove()});
it('preserves pending compound warning before accepting money, without blocking billing after acknowledgment',async()=>{await render({...data,compound_pending:true});s.save.mockResolvedValue({status:'SAVED',href:'/klinik/pembayaran/visit'});await submit();expect(s.save).not.toHaveBeenCalled();await act(async()=>{host.querySelector<HTMLInputElement>('[aria-label="Konfirmasi racikan belum siap"]')!.click()});await submit();expect(s.save).toHaveBeenCalledTimes(1)});
it('uses actual outpatient ItemTable pending edits, sealed discounts and sends isolated snapshot to existing payment panel',async()=>{
 await render();await change('Jumlah Obat Fiktif','2');await change('Nominal pembayaran 1','5000');
 expect((host.querySelector('[aria-label="Diskon Obat Fiktif"]') as HTMLInputElement).readOnly).toBe(true);
 s.save.mockResolvedValue({status:'SAVED',href:'/klinik/pembayaran/visit?success=transaksi&invoice=actual'});await submit();
 const sent=s.save.mock.calls[0][0] as FormData;
 expect(sent.get('pending_snapshot')).toBe('current-snapshot');expect(JSON.parse(String(sent.get('pending_rows')))).toMatchObject([{id:'rx',qty:2,item_id:'sku'}]);expect(s.push).toHaveBeenCalledWith('/klinik/pembayaran/visit?success=transaksi&invoice=actual');
});
it('requires a fresh overpayment confirmation after any pending cart change',async()=>{
 await render();await change('Nominal pembayaran 1','5000');s.save.mockResolvedValue({status:'OVERPAYMENT_CONFIRM_REQUIRED',quote:{...data.quote,amount:5000,excess:1000}});await submit();
 expect(host.querySelector('[role="dialog"]')).not.toBeNull();await change('Jumlah Obat Fiktif','2');
 await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent==='Setuju, simpan saldo pemilik')!.click()});
 expect(s.save).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Keranjang berubah');
});
