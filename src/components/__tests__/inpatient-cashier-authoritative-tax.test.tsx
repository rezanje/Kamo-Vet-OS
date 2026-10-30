import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const test = vi.hoisted(() => ({ tax: { mode_pkp: true, ppn_rate: 12 } as {mode_pkp:boolean;ppn_rate:number}|null }));
vi.mock('@/lib/clinic-payment', () => ({ loadClinicPaymentMaster: async () => ({ obat: [], jasa: [] }) }));
vi.mock('@/lib/pajak', () => ({ getPajakSettings: async () => { throw new Error('Do not use a separate fallible tax fallback after the trusted quote'); } }));
vi.mock('@/lib/dp-minimal', () => ({ getDpMinimalPercent: async () => 50, bolehMenerobosDp: () => false }));
vi.mock('@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier', () => ({ InpatientCashier: ({ppnRate}:{ppnRate:number}) => <div>Trusted PPN {ppnRate}</div> }));
import { InpatientPaymentPage } from '@/app/(app)/klinik/pembayaran/[visitId]/InpatientPaymentPage';
function client() { return {rpc:async()=>({data:{snapshot:'snap',rows:[],history:[],receipts:[],applications:[],tax_settings:test.tax,quote:{accounts:[],remaining:112,pending:112,subtotal:100,tax:12}},error:null}),from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{role:'STAFF'},error:null})};return q;}}; }
it('uses exact database tax configuration that came with the trusted cashier snapshot',async()=>{
 test.tax={mode_pkp:true,ppn_rate:12};const html=renderToStaticMarkup(await InpatientPaymentPage({db:client() as never,visitId:'visit',recordId:'stay',branchId:'branch',userId:'staff',query:{},patientLabel:'Pasien Fiktif'}));expect(html).toContain('Trusted PPN 12');
});
it('does not create a zero-tax fallback if trusted snapshot tax settings are missing',async()=>{
 test.tax=null;const html=renderToStaticMarkup(await InpatientPaymentPage({db:client() as never,visitId:'visit',recordId:'stay',branchId:'branch',userId:'staff',query:{},patientLabel:'Pasien Fiktif'}));expect(html).toContain('belum dapat diverifikasi');expect(html).not.toContain('Trusted PPN');
});
