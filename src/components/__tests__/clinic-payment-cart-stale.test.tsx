// @vitest-environment jsdom
// Dokter menambah item SESUDAH kasir membuka keranjang. Layar harus: (1) mengirim versi
// keranjang yang benar-benar menjadi dasar isian kasir, (2) setelah server menolak
// (CART_STALE) dan halaman dirender ulang dengan versi baru, memblokir draf lama dan
// memuat tagihan terbaru — termasuk item dokter — hanya lewat tindakan eksplisit kasir.
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({push:vi.fn(),save:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:m.push})}));
vi.mock('@/app/(app)/klinik/pembayaran/[visitId]/actions',()=>({bayarVisit:m.save}));
import {PembayaranForm} from '@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm';
const V1='v1:11111111111111111111111111111111';
const V2='v1:22222222222222222222222222222222';
const periksa={deskripsi:'Jasa periksa',qty:1,harga:100000,jenis:'jasa',item_id:'svc',prescription_item_id:'rx-a'};
const susulan={deskripsi:'Obat susulan dokter',qty:1,harga:25000,jenis:'obat',item_id:'med',prescription_item_id:'rx-b'};
const base={visitId:'visit',draftUserId:'cashier',patient:{photo:null,name:'Pasien Fiktif',species:'Kucing',owner:'Pemilik Fiktif',phone:'',address:'',dokter:'Dokter',jenisLayanan:'Klinik',noInvoice:'(baru)',tanggal:'2026-10-31'},catatanResep:null,bekal:{promos:[],aturanDiskon:[],golonganPersen:0,infoBarang:{},vouchers:[],hariIni:'2026-10-31',customerId:null,categoryId:null,poinSaldo:0,rupiahPerPoin:1}};
let container:HTMLDivElement;let root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();m.push.mockReset();m.save.mockReset();container=document.createElement('div');document.body.append(container);root=createRoot(container)});
afterEach(async()=>{await act(async()=>root.unmount());container.remove()});
// The page keys the form with a fresh request key on every server render (remount).
const render=async(key:string,props:Record<string,unknown>)=>{await act(async()=>root.render(React.createElement(PembayaranForm,{key,...base,...props} as never)));await act(async()=>{await Promise.resolve();});};
const hidden=(name:string)=>container.querySelector<HTMLInputElement>(`input[type=hidden][name=${name}]`)?.value;
const names=()=>(JSON.parse(hidden('items') ?? '[]') as {deskripsi:string}[]).map(r=>r.deskripsi);
const submits=()=>[...container.querySelectorAll<HTMLButtonElement>('button[type=submit]')];

it('mengirim versi keranjang yang menjadi dasar isian kasir',async()=>{
 await render('r1',{requestKey:'req-1',sourceVersion:V1,initialObat:[],initialJasa:[periksa]});
 expect(hidden('source_version')).toBe(V1);
});
it('sesudah dokter menambah item: draf lama diblokir, Muat tagihan terbaru membawa item dokter dan versi baru',async()=>{
 await render('r1',{requestKey:'req-1',sourceVersion:V1,initialObat:[],initialJasa:[periksa]});
 // Kasir mengetik sesuatu: draf sesi tersimpan dengan versi V1.
 const diskon=container.querySelector<HTMLInputElement>('input[name=discount_display], input[inputmode=numeric]');
 if(diskon){await act(async()=>{diskon.dispatchEvent(new Event('input',{bubbles:true}));});}
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(sessionStorage.length).toBeGreaterThan(0);
 // Server menolak CART_STALE, halaman dirender ulang dengan versi baru (form dipasang ulang).
 await render('r2',{requestKey:'req-2',sourceVersion:V2,initialObat:[susulan],initialJasa:[periksa]});
 expect(container.textContent).toContain('tagihan sumber berubah');
 expect(submits().every(b=>b.disabled)).toBe(true);
 expect(hidden('source_version')).toBe(V1);
 const muat=[...container.querySelectorAll('button')].find(b=>b.textContent?.includes('Muat tagihan terbaru'))!;
 await act(async()=>muat.click());
 expect(container.textContent).not.toContain('tagihan sumber berubah');
 expect(names()).toEqual(expect.arrayContaining(['Jasa periksa','Obat susulan dokter']));
 expect(hidden('source_version')).toBe(V2);
 expect(submits().some(b=>!b.disabled)).toBe(true);
});
it('mode koreksi tagihan terbit tidak mengirim versi keranjang',async()=>{
 await render('r1',{requestKey:'req-1',sourceVersion:'f'.repeat(64),editMode:true,targetInvoiceId:'inv',initialObat:[],initialJasa:[periksa]});
 expect(hidden('source_version')).toBeUndefined();
});
