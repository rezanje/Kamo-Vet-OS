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
it('clinical-only mode keeps daily clinical report and Jasa but moves medicine and BMHP entry out',async()=>{
 await act(async()=>root.render(<CatatanForm {...{...base,mode:'clinical' as const}} />));
 expect(host.querySelector('[name="condition_note"]')).not.toBeNull();
 expect([...host.querySelectorAll('button')].some(b=>b.textContent?.trim()==='Obat')).toBe(false);
 expect([...host.querySelectorAll('button')].some(b=>b.textContent?.trim()==='Tindakan & Racikan')).toBe(false);
 expect(host.textContent).toContain('Jasa');
 expect(host.querySelector('a[href="/klinik/rawat-inap/stay/obat-khusus"]')).not.toBeNull();
});
