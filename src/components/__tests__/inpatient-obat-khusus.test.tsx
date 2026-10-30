// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock('@/app/(app)/klinik/rawat-inap/actions',()=>({addDailyLogPos:vi.fn(),addInpatientBillables:vi.fn(),tambahObatInap:vi.fn(),catatPemberianObat:vi.fn(),batalkanPemberianObat:vi.fn(),hentikanObatInap:vi.fn()}));
import { CatatanForm } from '@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm';
import { ObatKhusus } from '@/app/(app)/klinik/rawat-inap/[id]/ObatKhusus';
import { addDailyLogPos,addInpatientBillables } from '@/app/(app)/klinik/rawat-inap/actions';
let host:HTMLDivElement;let root:Root;
const base={requestKey:'entry',draftUserId:'doctor',recordId:'stay',backHref:'/klinik/rawat-inap/stay',
 patient:{name:'Fiktif',species:'Kucing',breed:null,noRM:'FIKTIF',owner:'Fiktif',phone:'',address:'',tglMasuk:'1 Nov',dokter:'Fiktif',kondisi:'Stabil',photo:null},
 items:[{id:'medicine',name:'Obat Fiktif',unit:'pcs',sell_price:10000,stok:10,item_type:'Persediaan'}],jasaItems:[],tindakanItems:[],bahanItems:[],racikanItems:[],katalogRacikan:[],bolehManual:false};
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();vi.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('OBAT KHUSUS keeps billable entry but removes the old add-protocol form',async()=>{
 await act(async()=>root.render(await ObatKhusus({recordId:'stay',aktif:true,userId:'doctor',history:{medications:[],doses:[]}})));
 expect(host.querySelector('a[href="/klinik/rawat-inap/stay/obat-khusus"]')?.textContent).toContain('Tambah obat / BMHP');
 expect(host.textContent).not.toContain('TAMBAH OBAT BERPROTOKOL');
 expect(host.querySelector('[name="nama_obat"]')).toBeNull();
 expect(host.querySelector('[name="frekuensi_per_hari"]')).toBeNull();
 expect(host.textContent).not.toContain('Tambahkan di bawah');
});
it.each([true,false])('keeps existing protocol and dose history after removing creation form; active=%s',async aktif=>{
 const history={medications:[{id:'protocol',nama_obat:'Obat historis fiktif',dosis:'1 ml',rute:'IV',frekuensi_per_hari:2,durasi_hari:3,mulai_tanggal:'2026-10-30',dihentikan_at:null,catatan:'Catatan historis fiktif'}],doses:[{id:'dose',medication_id:'protocol',diberikan_at:'2026-10-30T06:00:00Z',nama_pemberi:'Pemberi fiktif',catatan:'Dosis historis',dibatalkan_at:null}]};
 await act(async()=>root.render(await ObatKhusus({recordId:'stay',aktif,userId:'doctor',history})));
 expect(host.textContent).toContain('Obat historis fiktif');expect(host.textContent).toContain('JEJAK PEMBERIAN');expect(host.textContent).toContain('Pemberi fiktif');expect(host.textContent).toContain('Dosis historis');
 expect(host.textContent).not.toContain('TAMBAH OBAT BERPROTOKOL');expect(host.querySelector('[name="frekuensi_per_hari"]')).toBeNull();
 expect(Boolean(host.querySelector('a[href="/klinik/rawat-inap/stay/obat-khusus"]'))).toBe(aktif);
});
it('keeps unreadable history closed rather than inventing an empty list',async()=>{
 await act(async()=>root.render(await ObatKhusus({recordId:'stay',aktif:true,userId:'doctor',history:null})));
 expect(host.textContent).toContain('belum dapat dimuat lengkap');expect(host.querySelector('form')).toBeNull();
});
it('standalone cart saves medicine without required clinical log fields and uses billable action',async()=>{
 vi.mocked(addInpatientBillables).mockResolvedValue({saved:true,href:'/klinik/rawat-inap/stay#obat-khusus'});
 await act(async()=>root.render(<CatatanForm {...{...base,mode:'billables' as const}} />));
 expect(host.querySelector('[name="condition_note"]')).toBeNull();
 expect(host.querySelector('[name="new_status"]')).toBeNull();
 expect(host.querySelector('[name="paramedic_id"]')).toBeNull();
 await act(async()=>host.querySelector<HTMLButtonElement>('button[title="Tambah"]')!.click());
 await act(async()=>host.querySelector('form')!.requestSubmit());
 expect(addInpatientBillables).toHaveBeenCalledOnce();
 expect(addDailyLogPos).not.toHaveBeenCalled();
 const data=vi.mocked(addInpatientBillables).mock.calls[0][0];
 expect(JSON.parse(String(data.get('resep')))[0]).toMatchObject({item_id:'medicine',qty:1});
 expect(data.get('condition_note')).toBeNull();
});
it('clinical mode keeps only the clinical report in a single full-width column',async()=>{
 await act(async()=>root.render(<CatatanForm {...base} mode="clinical" />));
 for(const name of ['condition_note','berat','suhu','tindakan','keterangan','komunikasi_owner','komunikasi_via','paramedic_id','new_status']) expect(host.querySelector(`[name="${name}"]`)).not.toBeNull();
 expect(host.querySelector('input[type="file"]')).not.toBeNull();
 for(const label of ['Obat','Jasa','Tindakan & Racikan']) expect([...host.querySelectorAll('button')].some(b=>b.textContent?.trim()===label)).toBe(false);
 for(const text of ['JASA VISIT','KERANJANG','Subtotal','Diskon','PPN','TOTAL','Rp ','Catatan resep']) expect(host.textContent).not.toContain(text);
 expect(host.querySelector('.grid2')).toBeNull();
 expect(host.querySelector('a[href="/klinik/rawat-inap/stay/obat-khusus"]')).not.toBeNull();
});
it('billables keeps Jasa entry and saves it on the same standalone billing action',async()=>{
 vi.mocked(addInpatientBillables).mockResolvedValue({saved:true,href:'/klinik/rawat-inap/stay#obat-khusus'});
 await act(async()=>root.render(<CatatanForm {...base} mode="billables" jasaItems={[{id:'service',name:'Jasa fiktif',unit:'kali',sell_price:20000,stok:0,item_type:'Jasa'}]} />));
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Jasa')!.click());
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Tambah Jasa fiktif"]')!.click());
 await act(async()=>host.querySelector('form')!.requestSubmit());
 expect(addDailyLogPos).not.toHaveBeenCalled();expect(addInpatientBillables).toHaveBeenCalledOnce();
 expect(JSON.parse(String(vi.mocked(addInpatientBillables).mock.calls[0][0].get('resep')))[0]).toMatchObject({item_id:'service',jenis:'jasa',harga:20000});
});
async function submitClinical(){
 const form=host.querySelector('form')!;
 form.querySelector<HTMLTextAreaElement>('[name="condition_note"]')!.value='Stabil fiktif';
 const paramedic=form.querySelector<HTMLSelectElement>('[name="paramedic_id"]')!;
 await act(async()=>{paramedic.value='paramedic';paramedic.dispatchEvent(new Event('change',{bubbles:true}));});
 await act(async()=>form.requestSubmit());
}
const clinicalProps={...base,mode:'clinical' as const,paramedics:[{id:'paramedic',nama:'Paramedis fiktif',jabatan:null}]};
it('clinical save sends an empty prescription without billing notes or prices',async()=>{
 vi.mocked(addDailyLogPos).mockResolvedValue({saved:true,href:base.backHref});
 await act(async()=>root.render(<CatatanForm {...clinicalProps} />));
 await submitClinical();
 expect(addDailyLogPos).toHaveBeenCalledOnce();expect(addInpatientBillables).not.toHaveBeenCalled();
 const data=vi.mocked(addDailyLogPos).mock.calls[0][0];
 expect(data.get('resep')).toBe('[]');expect(data.get('catatan_resep')).toBeNull();
 for(const name of ['discountPct','discount','harga','subtotal','total']) expect(data.get(name)).toBeNull();
 expect(data.get('condition_note')).toBe('Stabil fiktif');expect(data.get('paramedic_id')).toBe('paramedic');
});
it.each(['cart','procedure','compound','legacy-service'])('clinical recovery blocks an old %s draft without losing it until explicitly discarded',async kind=>{
 await act(async()=>root.render(<CatatanForm {...base} />));
 await act(async()=>host.querySelector<HTMLButtonElement>('button[title="Tambah"]')!.click());
 const key='vetos:clinic-draft:v1:doctor:inpatient:stay';
 const saved=JSON.parse(sessionStorage.getItem(key)!);
 saved.fields.condition_note='Kondisi draf fiktif';
 saved.snapshot.catatan='Catatan tagihan lama';saved.snapshot.discountPct=10;
 if(kind!=='cart')saved.snapshot.cart=[];
 if(kind==='procedure')saved.snapshot.procedureDraft={item:base.items[0],bmhp:[{item_id:'medicine',nama:'Bahan fiktif',qty:2,unit:'pcs'}],editKey:null};
 if(kind==='compound'){saved.snapshot.racikNama='Racikan lama';saved.snapshot.racikBahan=[{item_id:'medicine',nama:'Bahan fiktif',qty:1,satuan:'pcs'}];}
 if(kind==='legacy-service'){saved.snapshot.jasaNama='Jasa lama';saved.snapshot.jasaHarga=25000;}
 sessionStorage.setItem(key,JSON.stringify(saved));
 await act(async()=>root.unmount());root=createRoot(host);
 await act(async()=>root.render(<CatatanForm {...clinicalProps} />));
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('Draf tagihan lama');
 expect(host.textContent).toContain('belum dipindahkan');
 await submitClinical();
 expect(addDailyLogPos).not.toHaveBeenCalled();expect(addInpatientBillables).not.toHaveBeenCalled();
 expect(JSON.parse(sessionStorage.getItem(key)!).snapshot).toEqual({...saved.snapshot,staff:{...saved.snapshot.staff,paramedic_id:'paramedic'}});
 expect(host.querySelector<HTMLTextAreaElement>('[name="condition_note"]')!.value).toBe('Stabil fiktif');
 await act(async()=>root.unmount());root=createRoot(host);
 await act(async()=>root.render(<CatatanForm {...clinicalProps} />));
 expect(JSON.parse(sessionStorage.getItem(key)!).snapshot).toEqual({...saved.snapshot,staff:{...saved.snapshot.staff,paramedic_id:'paramedic'}});
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('Draf tagihan lama');
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Buang item tagihan dari draf"]')!.click());
 expect(host.querySelector<HTMLTextAreaElement>('[name="condition_note"]')!.value).toBe('Stabil fiktif');
 expect(JSON.parse(sessionStorage.getItem(key)!).snapshot.cart).toEqual([]);
 vi.mocked(addDailyLogPos).mockResolvedValue({saved:true,href:base.backHref});
 await submitClinical();
 expect(addDailyLogPos).toHaveBeenCalledOnce();expect(vi.mocked(addDailyLogPos).mock.calls[0][0].get('resep')).toBe('[]');
});
