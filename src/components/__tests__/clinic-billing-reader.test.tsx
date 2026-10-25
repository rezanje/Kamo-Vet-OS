import {createHash} from "node:crypto";
vi.mock("@/lib/service-performers-server",()=>({loadServiceStaff:async()=>[],loadBranchGroomingPolicy:async()=>({applies:true,doctorRequired:true}),loggedInCashier:async()=>({employeeId:null,name:"Kasir Login"})}));
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({mode:'draft',fail:'',inpatientOpen:false,visitStatus:'Pembayaran',calls:[] as unknown[][]}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'cashier'}}})},rpc:async()=>({data:false,error:null}),from(table:string){
 let single=false;let selected='';let range:number[]|undefined;let ids:string[]|undefined;const filters:Record<string,unknown>={};const q:Record<string,unknown>={then:(resolve:(v:unknown)=>void)=>{
 let data:unknown=[];const error=state.fail===table?{message:'PRIVATE database problem'}:null;
 if(table==='visits')data={id:state.mode==='old'?'old-visit':'new-visit',status:state.visitStatus,poli:'Umum',created_at:'2026-10-22T00:00:00Z',branch_id:'branch',pets:{name:state.mode==='old'?'Old patient':'New patient'},customers:{name:'Fictional owner'}};
 if(table==='medical_records')data={id:'mr-new'};
 if(table==='inpatient_records')data=state.inpatientOpen?{id:'inpatient',discharged_at:null,consent_id:null}:null;
 if(table==='invoices')data=!single&&selected.includes('visits(pets')?[{id:'old-invoice',visit_id:'old-visit',invoice_no:'INV-OLD-415',created_at:'2026-10-22T00:00:00Z',total:415000,dp_amount:0,paid_status:'Lunas',invoice_payments:[],visits:null},{id:'dp-invoice',visit_id:'dp-visit',invoice_no:'INV-DP',created_at:'2026-10-22T00:00:00Z',total:400000,dp_amount:100000,paid_status:'DP',invoice_payments:[{amount:50000}],visits:null}]:single?(state.mode==='draft'?null:{id:state.mode==='old'?'old-invoice':'new-invoice',invoice_no:state.mode==='old'?'INV-OLD-415':'INV-NEW-400',paid_status:state.mode==='unpaid'?'Belum Lunas':state.mode==='dp'?'DP':'Lunas',total:state.mode==='old'?415000:400000,subtotal:state.mode==='old'?415000:400000,discount:0,tax:0,dp_amount:state.mode==='dp'?100000:0,created_at:'2026-10-22T00:00:00Z',metode_bayar:'Tunai',correction_pending:false}):[];
 if(table==='invoice_payments'&&selected==='id,invoice_id,amount')data=[{id:'dp-payment',invoice_id:'dp-invoice',amount:50000}].filter(row=>!ids||ids.includes(row.invoice_id));
 if(table==='invoice_items')data=[{deskripsi:'Stored invoice item',qty:1,harga:state.mode==='old'?415000:400000,jenis:'jasa'}];
 if(table==='prescription_items')data=selected.includes('nama_obat')?[{id:'prescription-a',nama_obat:'Care',qty:1,harga:305000,jenis:'jasa',item_id:'service'},{id:'prescription-b',nama_obat:'Addition',qty:1,harga:95000,jenis:'jasa',item_id:'added-service'}]:[];
 if(table==='items')data=single?null:[];
 if(table==='clinic_demo_invoice_snapshots')data=null;
 const count=Array.isArray(data)?data.length:undefined;if(range&&Array.isArray(data))data=data.slice(range[0],range[1]+1);
 resolve({data:error?null:data,error,count});}};
 for(const method of ['select','eq','gt','is','in','order','limit','range','maybeSingle'])q[method]=(...args:unknown[])=>{state.calls.push([table,method,...args]);if(method==='select')selected=String(args[0]);if(method==='range')range=args as number[];if(method==='in')ids=args[1]as string[];if(method==='eq')filters[String(args[0])]=args[1];if(method==='maybeSingle')single=true;return q};return q;
}})}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('NOT_FOUND')},redirect:(url:string)=>{throw Error(url)}}));
vi.mock('@/lib/clinic-demo-policy-server',()=>({readDemoPolicy:async()=>null}));
vi.mock('@/lib/clinic-payment',()=>({loadClinicPaymentMaster:async()=>({obat:[],jasa:[],all:[]})}));
vi.mock('@/lib/penjual',()=>({daftarPenjual:async()=>[]}));
vi.mock('@/lib/master-guard',()=>({bolehTransaksiKas:async()=>false}));
vi.mock('@/components/PilihRekening',()=>({loadRekeningAktif:async()=>[],PilihRekening:()=>null}));
vi.mock('@/lib/shift',()=>({getOpenShift:async()=>({id:'shift'})}));
vi.mock('@/lib/pajak',()=>({getPajakSettings:async()=>({mode_pkp:false,ppn_rate:0})}));
vi.mock('@/lib/tindakan',()=>({bolehBayar:()=>true,kategoriBerisiko:()=>[]}));
vi.mock('@/lib/consent-server',()=>({bacaAturanConsent:async()=>[]}));
vi.mock('@/lib/rombongan-server',()=>({bacaRombongan:async()=>null}));
vi.mock('@/lib/tagihan-klinik',()=>({perkiraanTagihan:async()=>new Map(),bekalPotonganKlinik:async()=>({}),nilaiBaris:(r:{qty:number;harga:number})=>r.qty*r.harga}));
vi.mock('@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm',()=>({PembayaranForm:(props:{visitId:string;initialJasa:{qty:number;harga:number}[];sourceVersion?:string})=><div data-draft={props.visitId} data-source={props.sourceVersion}>DRAFT {props.initialJasa.reduce((s,r)=>s+r.qty*r.harga,0)}</div>}));
vi.mock('@/app/(app)/klinik/pembayaran/[visitId]/LunasiRombonganForm',()=>({LunasiRombonganForm:()=>null}));
vi.mock('@/app/(app)/klinik/pembayaran/[visitId]/VoidReissueForm',()=>({VoidReissueForm:()=>null}));
import Page from '@/app/(app)/klinik/pembayaran/[visitId]/page';
beforeEach(()=>{state.mode='draft';state.fail='';state.inpatientOpen=false;state.visitStatus='Pembayaran';state.calls=[]});
const render=(success?:string)=>Page({params:Promise.resolve({visitId:state.mode==='old'?'old-visit':'new-visit'}),searchParams:Promise.resolve({success})});
it('keeps old paid415000 and new unposted400000 bound to their own visit IDs',async()=>{
 state.mode='old';state.visitStatus='Selesai';const old=renderToStaticMarkup(await render());expect(old).toContain('INV-OLD-415');expect(old).toContain('Rp 415.000');expect(old).not.toContain('data-draft');
 state.mode='draft';state.visitStatus='Pembayaran';const draft=renderToStaticMarkup(await render());expect(draft).toContain('DRAFT 400000');expect(draft).not.toContain('INV-OLD-415');expect(draft).toContain('belum tercatat sebagai pembayaran');expect(state.calls).toContainEqual(['invoices','eq','visit_id','new-visit']);expect(state.calls).toContainEqual(['prescription_items','eq','medical_record_id','mr-new']);
});
it.each(['draft','unpaid','dp'])('does not claim successful payment just because a URL says success: %s',async mode=>{
 state.mode=mode;const html=renderToStaticMarkup(await render('bayar'));expect(html).not.toContain('Pembayaran berhasil.');if(mode!=='draft')expect(html).toContain('Invoice tersimpan');
});
it('shows completed payment only when the read confirms paid and finished visit',async()=>{
 state.mode='paid';state.visitStatus='Selesai';expect(renderToStaticMarkup(await render('bayar'))).toContain('Pembayaran berhasil.');
});
it('distinguishes committed money from incomplete visit checkout',async()=>{
 state.mode='paid';const html=renderToStaticMarkup(await render('bayar'));expect(html).toContain('status kunjungan belum selesai');expect(html).not.toContain('Pembayaran berhasil.');expect(html).not.toContain('data-draft');
});
it.each(['invoices','medical_records','inpatient_records','prescription_items'])('blocks unknown source state instead of manufacturing a new empty/unpaid invoice: %s',async table=>{
 state.fail=table;await expect(render()).rejects.toThrow('belum dapat diverifikasi');
});
it.each(['invoice_items','invoice_payments'])('does not allow an invoice correction from incomplete money/line reads: %s',async table=>{
 state.mode='dp';state.fail=table;await expect(render()).rejects.toThrow('belum dapat diverifikasi');
});

it('does not offer paid checkout recovery through an active inpatient stay',async()=>{
 state.mode='paid';state.inpatientOpen=true;const html=renderToStaticMarkup(await render());expect(html).not.toContain('Sinkronkan status kunjungan');
});

import FakturPage from '@/app/(app)/penjualan/faktur/page';
it('shows zero remaining for stored single paid clinic invoices without receipt rows while preserving partial payments',async()=>{
 const html=renderToStaticMarkup(await FakturPage({searchParams:Promise.resolve({})}));
 const row=html.split('<tr').find(r=>r.includes('INV-OLD-415'))!;expect(row).toContain('lunas');expect(row.match(/Rp 415.000/g)).toHaveLength(1);
 const partial=html.split('<tr').find(r=>r.includes('INV-DP'))!;expect(partial).toContain('Rp 250.000');expect(partial).toContain('DP');
});

it('retains the pre-performer billing source fingerprint when stored rows have no attribution',async()=>{
 const source=[{deskripsi:'Care',qty:1,harga:305000,jenis:'jasa',item_id:'service',satuan:null,prescription_item_id:'prescription-a',recipe_id:null},{deskripsi:'Addition',qty:1,harga:95000,jenis:'jasa',item_id:'added-service',satuan:null,prescription_item_id:'prescription-b',recipe_id:null}];
 const expected=createHash('sha256').update(JSON.stringify(source)).digest('hex');
 expect(renderToStaticMarkup(await render())).toContain(`data-source="${expected}"`);
});
