// Item susulan rawat jalan: dokter menambah item SESUDAH kasir membuka keranjang.
// Halaman Pembayaran memakai versi keranjang dari database sebagai pembanding draf,
// sehingga perubahan dokter terdeteksi (draf lama diblokir, muat ulang) dan versi yang
// sama dikirim ke pembungkus posting yang menolaknya bila basi (CART_STALE).
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({mode:'draft' as 'draft'|'unpaid',version:'v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as string|null,versionError:null as {code?:string;message:string}|null,rpcs:[] as string[]}));
vi.mock("@/lib/service-performers-server",()=>({loadServiceStaff:async()=>[],loadBranchGroomingPolicy:async()=>({applies:true,doctorRequired:false}),loggedInCashier:async()=>({employeeId:null,name:"Kasir Login"})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'cashier'}}})},rpc:async(name:string)=>{state.rpcs.push(name);
 if(name==='clinic_outpatient_cart_version')return state.versionError?{data:null,error:state.versionError}:{data:state.version,error:null};
 return {data:false,error:null};},from(table:string){
 let single=false;let selected='';const q:Record<string,unknown>={then:(resolve:(v:unknown)=>void)=>{
 let data:unknown=[];
 if(table==='visits')data={id:'visit',status:'Pembayaran',poli:'Umum',created_at:'2026-10-31T00:00:00Z',branch_id:'branch',pets:{name:'Pasien Fiktif',species:'Kucing',photo_url:null},customers:{name:'Pemilik Fiktif',phone:'080000000000',address:'Alamat'}};
 if(table==='medical_records')data={id:'mr'};
 if(table==='inpatient_records')data=null;
 const inv={id:'inv',invoice_no:'INV-FIK',paid_status:'Belum Lunas',total:100,subtotal:100,discount:0,tax:0,dp_amount:0,created_at:'2026-10-31T00:00:00Z',metode_bayar:'Tunai',correction_pending:false};
 if(table==='invoices')data=single?(state.mode==='unpaid'?inv:null):selected.includes('reissued_from')?(state.mode==='unpaid'?[inv]:[]):[];
 if(table==='invoice_items')data=[{deskripsi:'Tersimpan',qty:1,harga:100,jenis:'jasa'}];
 if(table==='prescription_items')data=selected.includes('nama_obat')?[{id:'rx-a',nama_obat:'Jasa periksa',qty:1,harga:100000,jenis:'jasa',item_id:'svc'},{id:'rx-b',nama_obat:'Obat susulan dokter',qty:1,harga:25000,jenis:'obat',item_id:'med'}]:[];
 if(table==='items')data=single?null:[];
 if(table==='clinic_demo_invoice_snapshots')data=null;
 resolve({data,error:null,count:Array.isArray(data)?data.length:undefined});}};
 for(const method of ['select','eq','gt','is','in','order','limit','range','maybeSingle'])q[method]=(...args:unknown[])=>{if(method==='select')selected=String(args[0]);if(method==='maybeSingle')single=true;return q};return q;
}})}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()}),notFound:()=>{throw Error('NOT_FOUND')},redirect:(url:string)=>{throw Error(url)}}));
vi.mock('@/lib/clinic-demo-policy-server',()=>({readDemoPolicy:async()=>null}));
vi.mock('@/lib/clinic-payment',()=>({loadClinicPaymentMaster:async()=>({obat:[],jasa:[],all:[]}),loadClinicPackages:async()=>[]}));
vi.mock('@/lib/penjual',()=>({daftarPenjual:async()=>[]}));
vi.mock('@/lib/master-guard',()=>({bolehTransaksiKas:async()=>false}));
vi.mock('@/components/PilihRekening',()=>({loadRekeningAktif:async()=>[],PilihRekening:()=>null}));
vi.mock('@/lib/shift',()=>({getOpenShift:async()=>({id:'shift'})}));
vi.mock('@/lib/pajak',()=>({getPajakSettings:async()=>({mode_pkp:false,ppn_rate:0})}));
vi.mock('@/lib/tindakan',()=>({bolehBayar:()=>true,kategoriBerisiko:()=>[]}));
vi.mock('@/lib/consent-server',()=>({bacaAturanConsent:async()=>[]}));
vi.mock('@/lib/rombongan-server',()=>({bacaRombongan:async()=>null}));
vi.mock('@/lib/tagihan-klinik',()=>({perkiraanTagihan:async()=>new Map(),bekalPotonganKlinik:async()=>({}),nilaiBaris:(r:{qty:number;harga:number})=>r.qty*r.harga}));
vi.mock('@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm',()=>({ItemTable:()=>null,PembayaranForm:(props:{sourceVersion?:string;initialObat:{deskripsi:string}[];editMode?:boolean})=><div data-source={props.sourceVersion} data-edit={String(!!props.editMode)}>{props.initialObat.map(r=>r.deskripsi).join(',')}</div>}));
vi.mock('@/app/(app)/klinik/pembayaran/[visitId]/LunasiRombonganForm',()=>({LunasiRombonganForm:()=>null}));
vi.mock('@/app/(app)/klinik/pembayaran/[visitId]/VoidReissueForm',()=>({VoidReissueForm:()=>null}));
import Page from '@/app/(app)/klinik/pembayaran/[visitId]/page';
beforeEach(()=>{state.mode='draft';state.version='v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';state.versionError=null;state.rpcs=[]});
const render=async()=>renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit'}),searchParams:Promise.resolve({})}));

it('keranjang baru memakai versi keranjang database sebagai pembanding draf (termasuk item susulan dokter)',async()=>{
 const html=await render();
 expect(state.rpcs).toContain('clinic_outpatient_cart_version');
 expect(html).toContain('data-source="v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
 expect(html).toContain('Obat susulan dokter');
});
it('versi berubah (dokter menambah item) mengubah pembanding sehingga draf lama terdeteksi basi',async()=>{
 const before=await render();state.version='v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';const after=await render();
 expect(before).not.toBe(after);expect(after).toContain('data-source="v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"');
});
it('versi gagal dibaca: layar tidak menawarkan keranjang yang tidak dapat diverifikasi',async()=>{
 state.versionError={code:'57014',message:'canceling statement due to statement timeout'};
 await expect(render()).rejects.toThrow('belum dapat diverifikasi');
});
it('jawaban versi yang tidak dikenal juga gagal tertutup',async()=>{
 state.version=null;await expect(render()).rejects.toThrow('belum dapat diverifikasi');
});
it('database lama tanpa fungsi versi tetap memakai sidik layar (kompatibel sebelum migrasi)',async()=>{
 state.versionError={code:'PGRST202',message:'Could not find the function public.clinic_outpatient_cart_version(p_visit_id) in the schema cache'};
 const html=await render();expect(html).toMatch(/data-source="[0-9a-f]{64}"/);
});
it('koreksi tagihan yang sudah terbit tidak membaca versi keranjang',async()=>{
 state.mode='unpaid';await render();expect(state.rpcs).not.toContain('clinic_outpatient_cart_version');
});
