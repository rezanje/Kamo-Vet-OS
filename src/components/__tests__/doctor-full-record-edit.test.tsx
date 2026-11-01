// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({useRouter:()=>({push:vi.fn()})}));
vi.mock('@/app/(app)/klinik/rekam-medis/[visitId]/actions',()=>({simpanRekamMedis:vi.fn(),koreksiRekamMedis:vi.fn(),koreksiRekamMedisLengkap:vi.fn()}));
vi.mock('@/components/PetPhotoUpload',()=>({PetPhotoUpload:()=>null}));
vi.mock('@/components/PenunjangUpload',()=>({PenunjangUpload:()=>null}));
import { RekamForm } from '@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm';
it.each(['owner','doctor'])('full %s editor reopens saved products in actual main editable cart with same IDs and issued compound correction link', async(userId)=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
 await act(async()=>root.render(<RekamForm visitId="visit" petId="pet" requestKey="full" draftUserId={userId} items={[]} racikanItems={[]} bahanItems={[]} jasaItems={[]} tindakanItems={[]} katalogRacikan={[]} bolehManual currentWeight={3} dokterOpsi={[]} providerOpsi={[]}
 patient={{name:'Fiktif',species:'Kucing',breed:null,noRM:'F',tglPeriksa:'F',dokter:'F',dokterId:null,providerId:null,owner:'Fiktif',phone:'080',address:'',tier:'',keluhan:'F',photo:null}}
 correction={{fullEdit:true,recordId:'record',revision:1,anamnesis:'Saved',diagnosis:null,therapy:null,suhu:null,berat:3,gejala_klinis:null,hasil_penunjang:null,penunjang_urls:[],follow_up:null,catatan_resep:null,prescriptions:[{id:'rx',item_id:'sku',nama_obat:'Obat Fiktif',qty:2,harga:100,satuan:'pcs',jenis:'obat',aturan_pakai:null},{id:'compound-rx',nama_obat:'Racikan Fiktif',qty:1,harga:200,satuan:'racikan',jenis:'obat',compound_recipe_id:'recipe',aturan_pakai:null}],compounds:[{id:'recipe',recipe_name:'Racikan Fiktif',status:'pending'}]}}/>));
 expect(host.textContent).toContain('Edit owner / dokter sebelum tagihan terbit');
 expect(host.querySelector('[aria-label="Jumlah Obat Fiktif"]')).not.toBeNull();
 expect(host.querySelector('[placeholder="Cari nama obat / scan barcode…"]')).not.toBeNull();
 expect(host.querySelector('[aria-label="Ganti item Obat Fiktif"]')).not.toBeNull();
 expect(host.querySelector('a[href="/klinik/racik/recipe"]')).not.toBeNull();
 const rows=JSON.parse((host.querySelector('[name="resep"]') as HTMLInputElement).value);
 expect(rows).toMatchObject([{prescription_item_id:'rx',qty:2},{prescription_item_id:'compound-rx',compound_recipe_id:'recipe'}]);
 } finally {await act(async()=>root.unmount());host.remove()}
});

// Anisa 1 Nov: racikan tidak muncul saat "Ubah" pasien yang sudah tersimpan pagi hari.
it('full editor lists racikan SKUs and adds a new racikan row without saved IDs or item swap', async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 sessionStorage.clear();
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const sku={id:'racik-sku',code:null,upc:null,name:'Racik Fiktif',unit:'PCS',stok:0,sell_price:18000,item_type:'Persediaan'};
 const bahan={id:'bahan',code:null,upc:null,name:'Bahan Fiktif',unit:'pcs',stok:9,sell_price:5000,item_type:'Persediaan'};
 const formula={id:'formula',code:'RCP-F',active:true,sale_item_id:'racik-sku',version_id:'v1',version:1,name:'Puyer Fiktif',dosage_form:'puyer',dosage_instruction:'2x sehari',
  ingredients:[{item_id:'bahan',name:'Bahan Fiktif',quantity:1,unit:'pcs',unit_price:5000}]};
 const click=(selector:string)=>act(async()=>host.querySelector<HTMLButtonElement>(selector)!.click());
 try {
 await act(async()=>root.render(<RekamForm visitId="visit" petId="pet" requestKey="full" draftUserId="doctor" items={[]} racikanItems={[sku]} bahanItems={[bahan]} jasaItems={[]} tindakanItems={[]} katalogRacikan={[formula]} bolehManual currentWeight={3} dokterOpsi={[]} providerOpsi={[]} tabAwal="tindakan"
 patient={{name:'Fiktif',species:'Kucing',breed:null,noRM:'F',tglPeriksa:'F',dokter:'F',dokterId:null,providerId:null,owner:'Fiktif',phone:'080',address:'',tier:'',keluhan:'F',photo:null}}
 correction={{fullEdit:true,recordId:'record',revision:1,anamnesis:'Saved',diagnosis:null,therapy:null,suhu:null,berat:3,gejala_klinis:null,hasil_penunjang:null,penunjang_urls:[],follow_up:null,catatan_resep:null,prescriptions:[{id:'rx',item_id:'sku',nama_obat:'Obat Fiktif',qty:2,harga:100,satuan:'pcs',jenis:'obat',aturan_pakai:null}],compounds:[]}}/>));
 expect(host.querySelector('button[aria-label="Pilih Racik Fiktif"]')).not.toBeNull();
 await click('button[aria-label="Pilih Racik Fiktif"]');
 const picker=host.querySelector<HTMLInputElement>('input[aria-label="Komposisi racikan"]')!;
 await act(async()=>{picker.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(picker,'Puyer');picker.dispatchEvent(new Event('input',{bubbles:true}))});
 await act(async()=>picker.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
 await act(async()=>picker.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
 await click('button[aria-label="Tambah Racik Fiktif ke keranjang"]');
 const rows=JSON.parse((host.querySelector('[name="resep"]') as HTMLInputElement).value);
 expect(rows).toHaveLength(2);
 expect(rows[0]).toMatchObject({prescription_item_id:'rx'});
 expect(rows[1]).toMatchObject({jenis:'racikan',sale_item_id:'racik-sku',official_version_id:'v1',harga:18000});
 expect(rows[1]).not.toHaveProperty('prescription_item_id');
 expect(rows[1]).not.toHaveProperty('compound_recipe_id');
 // A new racikan row can be removed but never swapped into a plain item that keeps its ingredients.
 expect(host.querySelector('[aria-label="Ganti item Racik Fiktif"]')).toBeNull();
 expect(host.querySelector('[aria-label="Ganti item Obat Fiktif"]')).not.toBeNull();
 // Full edit never saves "Catatan resep", so the field is not offered.
 expect(host.textContent).not.toContain('Catatan resep (aturan pakai)');
 } finally {await act(async()=>root.unmount());host.remove()}
});
