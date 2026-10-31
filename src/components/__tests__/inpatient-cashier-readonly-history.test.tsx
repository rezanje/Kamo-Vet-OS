import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ error: null as null | {message:string}, readOnly: true, malformed: false }));
vi.mock('@/lib/clinic-payment', () => ({ loadClinicPaymentMaster: async () => ({ obat: [], jasa: [] }) }));
vi.mock('@/lib/dp-minimal', () => ({ getDpMinimalPercent: async () => 50, bolehMenerobosDp: () => false }));
vi.mock('@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier', () => ({ InpatientCashier: () => <form data-editable-cashier>Editable payment</form> }));
import { InpatientPaymentPage } from '@/app/(app)/klinik/pembayaran/[visitId]/InpatientPaymentPage';
function client() {
 const data = { state: state.readOnly ? 'SHIFT_REQUIRED' : 'EDITABLE', snapshot: state.readOnly ? null : 'snap', rows: [],
  history: [{id:'exact-invoice',invoice_no:'VET_FIKTIF-001',total:330000,received:330000,dp_amount:100000,paid_status:'Lunas',correction_pending:false,lines:[{id:'line',deskripsi:'Obat historis',qty:1,harga:330000}]}],
  receipts:[{id:'receipt',no_kwitansi:'KW-FIKTIF',total:230000,status:'aktif',parts:[{metode:'Tunai',amount:230000}]}], applications:[],
  tax_settings:state.readOnly ? null : {mode_pkp:false,ppn_rate:0}, quote:state.readOnly ? null : {accounts:[],remaining:0,pending:0} };
 return {rpc:async()=>({data:state.malformed?{state:'SHIFT_REQUIRED'}:data,error:state.error}),from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{role:'FINANCE'},error:null})};return q;}};
}
async function render() {return renderToStaticMarkup(await InpatientPaymentPage({db:client() as never,visitId:'visit',recordId:'stay',branchId:'branch',userId:'staff',query:{success:'transaksi',invoice:'exact-invoice'},patient:{photo:null,name:'Pasien Fiktif',species:'Kucing',owner:'Pemilik Fiktif',phone:'080000000000',address:'Alamat fiktif',dokter:'Dokter Fiktif',jenisLayanan:'Rawat Inap',noInvoice:'(baru)',tanggal:'01/11/2026'},stayStatus:'Sudah pulang'}));}
beforeEach(()=>{state.error=null;state.readOnly=true;state.malformed=false;});
it('renders issued invoice and receipt history without a shift, editable cart, zero quote or success claim',async()=>{
 const html=await render();expect(html).toContain('VET_FIKTIF-001');expect(html).toContain('Obat historis');expect(html).toContain('KW-FIKTIF');expect(html).toContain('DP awal tersimpan');expect(html).toContain('invoice?invoice_id=exact-invoice');expect(html).toContain('Buka shift');expect(html).not.toContain('data-editable-cashier');expect(html).not.toContain('Pembayaran lunas');expect(html).not.toContain('Sisa pembayaran Rp 0');
});
it('does not turn an unknown monetary read error into readable zero or paid history',async()=>{
 state.error={message:'unknown dependency failure'};const html=await render();expect(html).toContain('belum dapat diverifikasi');expect(html).not.toContain('VET_FIKTIF-001');expect(html).not.toContain('data-editable-cashier');
});
it('does not accept an incomplete read-only state',async()=>{state.malformed=true;const html=await render();expect(html).toContain('belum dapat diverifikasi');});
it('keeps the editable flow when the trusted RPC has an own-shift quote',async()=>{state.readOnly=false;expect(await render()).toContain('data-editable-cashier');});
