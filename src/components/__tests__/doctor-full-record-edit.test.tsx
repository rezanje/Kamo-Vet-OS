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
