// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({push:vi.fn(),save:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:m.push})}));
vi.mock('@/app/(app)/klinik/pembayaran/[visitId]/actions',()=>({bayarVisit:m.save}));
import {useClinicDraft} from '@/components/useClinicDraft';
import {PembayaranForm} from '@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm';
const service={deskripsi:'Fictional service',qty:1,harga:305000,jenis:'jasa',item_id:'service',prescription_item_id:'prescription-a'};
const addition={deskripsi:'Additional care',qty:1,harga:95000,jenis:'jasa',item_id:'care',prescription_item_id:'prescription-b'};
const props={visitId:'new-visit',requestKey:'new-request',draftUserId:'cashier',sourceVersion:'source-b',patient:{photo:null,name:'Fictional new patient',species:'Kucing',owner:'Fictional owner',phone:'',address:'',dokter:'Doctor',jenisLayanan:'Klinik',noInvoice:'(baru)',tanggal:'2026-10-22'},initialObat:[],initialJasa:[service,addition],catatanResep:null,bekal:{promos:[],aturanDiskon:[],golonganPersen:0,infoBarang:{},vouchers:[],hariIni:'2026-10-22',customerId:null,categoryId:null,poinSaldo:0,rupiahPerPoin:1}};
const key='vetos:clinic-draft:v1:cashier:payment:new-visit:new';
function seed(version: string | null='source-a'){
 sessionStorage.setItem(key,JSON.stringify({version:1,savedAt:Date.now(),requestKey:'same-original-request',fields:{},snapshot:{obat:[],jasa:[service],discount:0,metode:'Tunai',reason:'',voucher:'',poinPakai:0,bayar:0,salesperson:'',mixed:false,splitPayments:[{method:'Tunai',amount:0},{method:'Transfer',amount:0}],demoEnabled:false,demoPolicyId:'',demoEmployees:[],sourceVersion:version??undefined}}));
}
let container:HTMLDivElement;let root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();m.push.mockReset();m.save.mockReset();container=document.createElement('div');document.body.append(container);root=createRoot(container)});
afterEach(async()=>{await act(async()=>root.unmount());container.remove()});
const render=async(p=props)=>{await act(async()=>root.render(React.createElement(PembayaranForm,p)))};
const items=()=>JSON.parse(container.querySelector<HTMLInputElement>('[name=items]')!.value) as {harga:number;qty:number}[];
it('fresh clinical additions total400000 without inheriting an unrelated paid invoice415000',async()=>{
 await render();expect(items().reduce((s,r)=>s+r.harga*r.qty,0)).toBe(400000);expect(container.textContent).toContain('Rp 400.000');expect(container.textContent).not.toContain('415.000');
});
it('retains the original retry payload/key and blocks stale305000 recovery until explicit source review',async()=>{
 seed();await render();expect(container.textContent).toContain('tagihan sumber berubah');
 expect(container.querySelector<HTMLInputElement>('[name=requestKey]')!.value).toBe('same-original-request');expect(items().reduce((s,r)=>s+r.harga*r.qty,0)).toBe(305000);
 expect([...container.querySelectorAll<HTMLButtonElement>('button[type=submit]')].every(b=>b.disabled)).toBe(true);
 const update=[...container.querySelectorAll('button')].find(b=>b.textContent?.includes('Muat tagihan terbaru'))!;
 await act(async()=>update.click());expect(items().reduce((s,r)=>s+r.harga*r.qty,0)).toBe(400000);expect(container.querySelector<HTMLInputElement>('[name=requestKey]')!.value).not.toBe('same-original-request');expect(container.textContent).not.toContain('tagihan sumber berubah');
});
it('does not silently bless stale rows after a second reload',async()=>{
 seed();await render();await act(async()=>root.unmount());root=createRoot(container);await render();expect(container.textContent).toContain('tagihan sumber berubah');expect(container.querySelector<HTMLInputElement>('[name=requestKey]')!.value).toBe('same-original-request');
});
it('same-source recovery preserves a manual price and the exact retry identity',async()=>{
 seed('source-b');await render();expect(container.textContent).not.toContain('tagihan sumber berubah');expect(container.querySelector<HTMLInputElement>('[name=requestKey]')!.value).toBe('same-original-request');
});
it('a legacy draft lacking source context requires review, never automatic addition/retry payload changes',async()=>{
 seed(null);await render();expect(container.textContent).toContain('tagihan sumber berubah');expect(container.querySelector<HTMLInputElement>('[name=requestKey]')!.value).toBe('same-original-request');
});

it('labels entered payment as preview until the atomic save is acknowledged',async()=>{
 await render();expect(container.textContent).toContain('PRATINJAU PEMBAYARAN');expect(container.textContent).toContain('setelah penyimpanan berhasil');
});

it('describes transport failure as uncertain and retains retry key and draft',async()=>{
 function Harness(){const d=useClinicDraft({userId:'cashier',scope:'uncertain-payment',requestKey:'stable-request',snapshot:{note:'retained'},restore:()=>{},uncertainMessage:'Hasil pembayaran belum dapat dipastikan. Periksa invoice tanpa membayar ulang.'});return <form ref={d.attachForm}><button type="button" onClick={()=>d.submit(new FormData(),async()=>{throw Error('Lost response')})}>Submit</button><input name="key" value={d.submissionKey} readOnly/><p role="alert">{d.saveError}</p></form>}
 await act(async()=>root.render(<Harness/>));await act(async()=>container.querySelector('button')!.click());expect(container.textContent).toContain('Hasil pembayaran belum dapat dipastikan');expect(container.querySelector<HTMLInputElement>('[name=key]')!.value).toBe('stable-request');expect(sessionStorage.getItem('vetos:clinic-draft:v1:cashier:uncertain-payment')).not.toBeNull();
});
