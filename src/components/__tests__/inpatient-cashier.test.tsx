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
const data:InpatientCashierData={tax_settings:{mode_pkp:false,ppn_rate:0},snapshot:'current-snapshot',rows:[{id:'rx',item_id:'sku',nama_obat:'Obat Fiktif',qty:1,harga:1000,satuan:'pcs',jenis:'obat'}],history:[{id:'issued',invoice_no:'INV-FIKTIF',total:5000,received:2000,dp_amount:2000,paid_status:'DP',correction_pending:false,lines:[]}],receipts:[],applications:[],quote:{token:'q',remaining:4000,pending:1000,debt:3000,credit:0,subtotal:1000,tax:0,amount:0,excess:0,accounts:[{method:'Tunai',code:'110003',name:'Kas Fiktif',bank:null,number:null}]}};
const render=async(value=data)=>act(async()=>root.render(<InpatientCashier patient={{photo:null,name:'Pasien Fiktif',species:'Kucing',owner:'Pemilik Fiktif',phone:'080000000000',address:'Alamat fiktif',dokter:'Dokter Fiktif',jenisLayanan:'Rawat Inap',noInvoice:'(baru)',tanggal:'01/11/2026'}} data={value} visitId="visit" recordId="stay" requestKey="cashier-key" masterObat={[{id:'sku',code:'F',name:'Obat Fiktif',unit:'pcs',harga:1000}]} masterJasa={[]} ppnRate={0} minDpPercent={50} bolehTerobos={false}/>));
async function change(label:string,value:string){await act(async()=>{const input=host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})}
const submit=async()=>act(async()=>{host.querySelector('form')!.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true}))});
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});s.save.mockReset();s.push.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove()});
it('preserves pending compound warning before accepting money, without blocking billing after acknowledgment',async()=>{await render({...data,compound_pending:true});s.save.mockResolvedValue({status:'SAVED',href:'/klinik/pembayaran/visit'});await submit();expect(s.save).not.toHaveBeenCalled();await act(async()=>{host.querySelector<HTMLInputElement>('[aria-label="Konfirmasi racikan belum siap"]')!.click()});await submit();expect(s.save).toHaveBeenCalledTimes(1)});
it('uses actual outpatient ItemTable pending edits, sealed discounts and sends isolated snapshot to existing payment panel',async()=>{
 await render();await change('Jumlah Obat Fiktif','2');await change('Jumlah Bayar','5000');
 expect((host.querySelector('[aria-label="Diskon Obat Fiktif"]') as HTMLInputElement).readOnly).toBe(true);
 s.save.mockResolvedValue({status:'SAVED',href:'/klinik/pembayaran/visit?success=transaksi&invoice=actual'});await submit();
 const sent=s.save.mock.calls[0][0] as FormData;
 expect(sent.get('pending_snapshot')).toBe('current-snapshot');expect(JSON.parse(String(sent.get('pending_rows')))).toMatchObject([{id:'rx',qty:2,item_id:'sku'}]);expect(s.push).toHaveBeenCalledWith('/klinik/pembayaran/visit?success=transaksi&invoice=actual');
});
it('requires a fresh overpayment confirmation after any pending cart change',async()=>{
 await render();await change('Jumlah Bayar','5000');s.save.mockResolvedValue({status:'OVERPAYMENT_CONFIRM_REQUIRED',quote:{...data.quote,amount:5000,excess:1000}});await submit();
 expect(host.querySelector('[role="dialog"]')).not.toBeNull();await change('Jumlah Obat Fiktif','2');
 await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent==='Setuju, simpan saldo pemilik')!.click()});
 expect(s.save).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Keranjang berubah');
});
it('expands a package picked in the inpatient cart into its contents instead of sending the Grup item (Anisa 2 Nov)',async()=>{
 const resep={id:'paket',name:'Paket Darah Fiktif',komponen:[
  {item_id:'tabung',name:'Tabung Fiktif',item_type:'Persediaan',base_unit:'pcs',qty:1,unit:'pcs',factor:1},
  {item_id:'reagen',name:'Reagen Fiktif',item_type:'Persediaan',base_unit:'pcs',qty:2,unit:'pcs',factor:1}]};
 const unit=(p:number)=>[{unit:'pcs',factor:1,sell_price:p,buy_price:0}];
 const masterObat=[{id:'sku',code:'F',name:'Obat Fiktif',unit:'pcs',harga:1000,units:unit(1000)},{id:'tabung',code:'T',name:'Tabung Fiktif',unit:'pcs',harga:2000,units:unit(2000)},
  {id:'reagen',code:'R',name:'Reagen Fiktif',unit:'pcs',harga:9000,units:unit(9000)},{id:'paket',code:'P',name:'Paket Darah Fiktif',unit:'pcs',harga:80000,units:unit(80000),paket:true}];
 await act(async()=>root.render(<InpatientCashier patient={{photo:null,name:'Pasien Fiktif',species:'Kucing',owner:'Pemilik Fiktif',phone:'080000000000',address:'Alamat fiktif',dokter:'Dokter Fiktif',jenisLayanan:'Rawat Inap',noInvoice:'(baru)',tanggal:'01/11/2026'}}
  data={data} visitId="visit" recordId="stay" requestKey="cashier-key" masterObat={masterObat} masterJasa={[]} ppnRate={0} minDpPercent={50} bolehTerobos={false}
  packages={[{id:'paket',name:'Paket Darah Fiktif',componentIds:['tabung','reagen'],perPaket:{tabung:1,reagen:2},resep}]}/>));
 await act(async()=>{[...host.querySelectorAll('button')].find(button=>button.textContent?.includes('Tambah'))!.click()});
 const picker=host.querySelector<HTMLInputElement>('input[aria-label="Nama obat baris 2"]')!;
 await act(async()=>{picker.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(picker,'Paket Darah');picker.dispatchEvent(new Event('input',{bubbles:true}))});
 await act(async()=>{picker.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))});
 await act(async()=>{picker.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))});
 expect(host.querySelectorAll('tr[data-paket="paket"]')).toHaveLength(1);
 await change('Jumlah Bayar','90000');
 s.save.mockResolvedValue({status:'SAVED',href:'/klinik/pembayaran/visit'});await submit();
 const rows=JSON.parse(String((s.save.mock.calls[0][0] as FormData).get('pending_rows'))) as {id:string;item_id:string;qty:number;harga:number}[];
 expect(rows.map(row=>row.item_id)).toEqual(['sku','tabung','reagen']);
 expect(rows.slice(1).reduce((sum,row)=>sum+row.qty*row.harga,0)).toBe(80000);
 expect(rows.every(row=>row.id&&row.item_id!=='paket')).toBe(true);
});
