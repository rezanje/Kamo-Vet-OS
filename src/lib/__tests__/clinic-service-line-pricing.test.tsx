import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
import type {PromoHitung} from '../promo-hitung';
const state=vi.hoisted(()=>({promos:[] as PromoHitung[],percent:0}));
vi.mock('@/components/useClinicDraft',()=>({useClinicDraft:({requestKey}:{requestKey:string})=>({submissionKey:requestKey,submit:vi.fn(),capture:vi.fn(),attachForm:vi.fn(),discard:vi.fn(),recovered:false,storageError:'',saveError:''})}));
vi.mock('@/app/(app)/klinik/pembayaran/[visitId]/actions',()=>({bayarVisit:vi.fn()}));
vi.mock('@/lib/promo-hitung',async()=>({...await vi.importActual('../promo-hitung'),loadPromoAktif:async()=>state.promos}));
vi.mock('@/lib/harga-golongan',async()=>({...await vi.importActual('../harga-golongan'),loadAturanDiskon:async()=>[],loadInfoBarang:async()=>new Map()}));
import {PembayaranForm} from '@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm';
import {hitungPotonganKlinik} from '../tagihan-klinik';
const client={from(){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{category_id:'category',customer_categories:{diskon_persen:state.percent,is_active:true}}})};return q}};
const promo=(minQty:number,maxQty:number|null):PromoHitung=>({id:'promo',name:'Promo jasa',itemIds:['service'],minQty,maxQty,kelipatan:false,autoApply:true,discountType:'percent',discountValue:20});
const rows=(price=100)=>[{deskripsi:'Jasa',item_id:'service',qty:1,harga:price,satuan:'tindakan',service_performers:{doctor_id:'doctor',staff_id:null}},{deskripsi:'Jasa',item_id:'service',qty:1,harga:price,satuan:'tindakan',service_performers:{doctor_id:null,staff_id:'nurse'}}];
function ui(price:number,physical=false){return renderToStaticMarkup(<PembayaranForm visitId="visit" requestKey="request" patient={{photo:null,name:'Pasien',species:'Kucing',owner:'Pemilik',phone:'',address:'',dokter:'PIC',jenisLayanan:'Klinik',noInvoice:'baru',tanggal:'2026-10-23'}} initialObat={physical?rows(price):[]} initialJasa={physical?[]:rows(price)} catatanResep={null} bekal={{promos:state.promos,aturanDiskon:[],golonganPersen:state.percent,infoBarang:{},vouchers:[],hariIni:'2026-10-23',customerId:'customer',categoryId:'category',poinSaldo:0,rupiahPerPoin:1}}/>)}
beforeEach(()=>{state.promos=[];state.percent=0});
it.each([{min:2,max:null,discount:40},{min:1,max:1,discount:20}])('server preserves pre-split service promo minimum/cap $min/$max',async({min,max,discount})=>{
 state.promos=[promo(min,max)];const source=rows();
 const result=await hitungPotonganKlinik(client,{branchId:'branch',customerId:'customer',rows:source.map(row=>({...row,jenis:'jasa'}))});
 expect(result.promo).toBe(discount);expect(source.map(row=>row.qty)).toEqual([1,1]);
});
it.each([{min:2,max:null,total:160},{min:1,max:1,total:180}])('UI preserves pre-split service promo minimum/cap $min/$max even without jenis in input rows',({min,max,total})=>{
 state.promos=[promo(min,max)];expect(ui(100)).toContain(`Rp ${total}`);
});
it('server rounds the customer category discount once for the original service quantity',async()=>{
 state.percent=33;const result=await hitungPotonganKlinik(client,{branchId:'branch',customerId:'customer',rows:rows(99).map(row=>({...row,jenis:'jasa'}))});expect(result.golongan).toBe(65);
});
it('UI keeps the original 65 category discount and 133 total for two services priced 99 at 33 percent',()=>{
 state.percent=33;const html=ui(99);expect(html).toContain('Rp 133');expect(html).toContain('Rp 65');
});
it('server preserves physical-product per-row caps and rounding',async()=>{
 state.promos=[promo(1,1)];let result=await hitungPotonganKlinik(client,{branchId:'branch',customerId:'customer',rows:rows().map(row=>({...row,jenis:'obat'}))});expect(result.promo).toBe(40);
 state.promos=[];state.percent=33;result=await hitungPotonganKlinik(client,{branchId:'branch',customerId:'customer',rows:rows(99).map(row=>({...row,jenis:'obat'}))});expect(result.golongan).toBe(66);
});
it('UI preserves physical-product per-row caps and rounding',()=>{
 state.promos=[promo(1,1)];expect(ui(100,true)).toContain('Rp 160');state.promos=[];state.percent=33;expect(ui(99,true)).toContain('Rp 132');
});

it('can explicitly retain legacy per-row promo and category rounding for committed replays',async()=>{
 state.promos=[promo(1,1)];let result=await hitungPotonganKlinik(client,{branchId:'branch',customerId:'customer',rows:rows().map(row=>({...row,jenis:'jasa'})),groupServices:false});expect(result.promo).toBe(40);
 state.promos=[];state.percent=33;result=await hitungPotonganKlinik(client,{branchId:'branch',customerId:'customer',rows:rows(99).map(row=>({...row,jenis:'jasa'})),groupServices:false});expect(result.golongan).toBe(66);
});
