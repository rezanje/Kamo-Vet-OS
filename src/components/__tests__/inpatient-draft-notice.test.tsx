import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ error: null as null | {message:string}, readOnly: false, malformed: false }));
vi.mock("@/lib/service-performers-server", () => ({ loadServiceStaff: async () => [], loadBranchGroomingPolicy: async () => ({ applies: false, doctorRequired: false }) }));
vi.mock('@/lib/clinic-payment', () => ({ loadClinicPaymentMaster: async () => ({ obat: [], jasa: [] }), loadClinicPackages: async () => [] }));
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
async function render() {return renderToStaticMarkup(await InpatientPaymentPage({db:client() as never,visitId:'visit',recordId:'stay',branchId:'branch',userId:'staff',query:{success:'draft'},patient:{photo:null,name:'Pasien Fiktif',species:'Kucing',owner:'Pemilik Fiktif',phone:'080000000000',address:'Alamat fiktif',dokter:'Dokter Fiktif',jenisLayanan:'Rawat Inap',noInvoice:'(baru)',tanggal:'01/11/2026'},stayStatus:'Sudah pulang'}));}
beforeEach(()=>{state.error=null;state.readOnly=false;state.malformed=false;});
it('the draft-saved popup says THIS save made no invoice / recorded no money (an earlier stage invoice or DP may exist)',async()=>{
 const html=await render();
 expect(html).toContain('Draft keranjang tersimpan');expect(html).toContain('Penyimpanan ini belum membuat invoice dan belum mencatat uang');
 expect(html).not.toContain('Belum ada invoice dan belum ada uang yang tercatat');
});
