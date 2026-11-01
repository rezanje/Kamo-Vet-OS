import {beforeEach,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({calls:[] as {name:string;args:Record<string,unknown>}[],error:null as null|{message:string},errorFor:{} as Record<string,{code?:string;message:string}>}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('next/navigation',()=>({redirect:(p:string)=>{throw Error(p)}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:async(name:string,args:Record<string,unknown>)=>{s.calls.push({name,args});const error=s.errorFor[name]??s.error;return{data:error?null:'record',error}}})}));
import {koreksiRekamMedisLengkap} from '@/app/(app)/klinik/rekam-medis/[visitId]/actions';
import {revalidatePath} from 'next/cache';
beforeEach(()=>{s.calls=[];s.error=null;s.errorFor={};vi.mocked(revalidatePath).mockClear()});
function form(){
 const f=new FormData();for(const [k,v]of Object.entries({visitId:'visit',medical_record_id:'record',expected_revision:'2',request_key:'full',correction_reason:'Fiktif',anamnesis:'Saved',suhu:'38.25',resep:JSON.stringify([{prescription_item_id:'rx',nama_obat:'Tindakan',item_id:'sku',jenis:'obat',qty:2,harga:100,satuan:'pcs',service_performers:{doctor_id:'original-doctor',staff_id:null},bmhp:[{item_id:'mat',nama:'untrusted',qty:3,unit:'ml'}]}])}))f.set(k,v);
 return f;
}
it.each(['OWNER','DOCTOR'])('%s positive public RPC response saves IDs BMHP and original attribution without initial-save fallback',async(role)=>{
 const f=form();f.set('role',role); // Client role is deliberately ignored; DB session authorizes.
 expect(await koreksiRekamMedisLengkap(f)).toEqual({saved:true,href:'/klinik/rekam-medis/visit?success=correction'});
 expect(s.calls).toEqual([{name:'clinic_edit_queued_record',args:expect.objectContaining({p_record_id:'record',p_expected_revision:2,p_rows:[expect.objectContaining({prescription_item_id:'rx',service_performers:{doctor_id:'original-doctor',staff_id:null},bmhp_components:[{item_id:'mat',qty:3,unit:'ml'}]})]})}]);
 expect(s.calls[0].args).not.toHaveProperty('role');
});
it.each(['ACCESS_DENIED','RECORD_POSTED','COMPOUND_LOCKED'])('fails closed on %s without legacy or initial-save fallback',async(message)=>{
 s.error={message};const f=form();f.set('role','OWNER');
 await expect(koreksiRekamMedisLengkap(f)).rejects.toThrow(message);
 expect(s.calls.map(x=>x.name)).toEqual(['clinic_edit_queued_record']);
});

// Anisa 1 Nov: racikan baru dari layar "Ubah". The queued-record edit rejects new compounds
// (COMPOUND_LOCKED), so they are issued afterwards through the item-susulan RPC.
const saved={prescription_item_id:'rx',nama_obat:'Tindakan',item_id:'sku',jenis:'obat',qty:2,harga:100,satuan:'pcs'};
const resmi={key:'k-resmi',item_id:null,sale_item_id:'racik-sku',nama_obat:'Racik Resmi',qty:1,satuan:'racikan',faktor:1,harga:18000,jenis:'racikan',official_version_id:'v1',aturan_pakai:'2x sehari',ingredients:[],dosage_form:'puyer',service_performers:{doctor_id:'doc',staff_id:null}};
const khusus={key:'k-khusus',item_id:null,sale_item_id:'racik-sku',nama_obat:'Racik Khusus',qty:1,satuan:'racikan',faktor:1,harga:18000,jenis:'racikan',aturan_pakai:'3x sehari',dosage_form:'sirup',ingredients:[{item_id:'bahan',nama:'Bahan',qty:2,satuan:'pcs',harga:5000}]};
const withCart=(rows:unknown[])=>{const f=form();f.set('resep',JSON.stringify(rows));return f};

it('saves the record edit first, then issues new racikan through clinic_add_record_items',async()=>{
 expect(await koreksiRekamMedisLengkap(withCart([saved,resmi,khusus]))).toEqual({saved:true,href:'/klinik/rekam-medis/visit?success=correction'});
 expect(s.calls.map(x=>x.name)).toEqual(['clinic_edit_queued_record','clinic_add_record_items']);
 expect(s.calls[0].args.p_rows).toEqual([expect.objectContaining({prescription_item_id:'rx'})]);
 expect(s.calls[1].args).toEqual({p_visit_id:'visit',p_request_key:'full:racikan',p_items:[],p_compounds:[
  {official_version_id:'v1',sale_item_id:'racik-sku',request_key:'k-resmi',dosage_instruction:'2x sehari',service_performers:{doctor_id:'doc',staff_id:null}},
  {request_key:'k-khusus',sale_item_id:'racik-sku',recipe:expect.objectContaining({ingredients:[expect.objectContaining({item_id:'bahan',quantity:2})]})},
 ]});
});

it('keeps an already issued racikan in the edit rows and never re-issues it',async()=>{
 const issued={prescription_item_id:'rx-c',compound_recipe_id:'recipe',nama_obat:'Racik Lama',jenis:'racikan',qty:1,harga:18000,satuan:'racikan'};
 await koreksiRekamMedisLengkap(withCart([saved,issued]));
 expect(s.calls.map(x=>x.name)).toEqual(['clinic_edit_queued_record']);
 expect(s.calls[0].args.p_rows).toEqual([expect.objectContaining({prescription_item_id:'rx'}),expect.objectContaining({prescription_item_id:'rx-c',compound_recipe_id:'recipe'})]);
});

it('rejects a new custom racikan without ingredients before any database call',async()=>{
 await expect(koreksiRekamMedisLengkap(withCart([saved,{...khusus,ingredients:[]}]))).rejects.toThrow(encodeURIComponent('Setiap racikan harus memiliki minimal satu bahan'));
 expect(s.calls).toEqual([]);
});

it('does not issue racikan when the record edit itself fails',async()=>{
 s.errorFor.clinic_edit_queued_record={message:'RECORD_POSTED'};
 await expect(koreksiRekamMedisLengkap(withCart([saved,resmi]))).rejects.toThrow('RECORD_POSTED');
 expect(s.calls.map(x=>x.name)).toEqual(['clinic_edit_queued_record']);
});

it('reports a racikan failure after a saved edit on the detail page, not back in the editor',async()=>{
 s.errorFor.clinic_add_record_items={code:'P0001',message:'STOCK_SHORT: Bahan'};
 const thrown=await koreksiRekamMedisLengkap(withCart([saved,resmi])).then(()=>null,(error:Error)=>error.message);
 expect(thrown).toContain('/klinik/rekam-medis/visit?success=correction&error=');
 expect(thrown).not.toContain('edit=');
 expect(decodeURIComponent(thrown!.split('error=')[1])).toContain('Perubahan rekam medis sudah tersimpan, tetapi racikan baru belum tersimpan (Stok tidak cukup: Bahan)');
 expect(revalidatePath).toHaveBeenCalledWith('/klinik/rekam-medis/visit');
});

it('does not point to Tambah tindakan / obat when the visit is already locked for racikan',async()=>{
 s.errorFor.clinic_add_record_items={code:'P0001',message:'RECIPE_POSTED: kunjungan sudah ditagih atau selesai'};
 const thrown=await koreksiRekamMedisLengkap(withCart([saved,resmi])).then(()=>null,(error:Error)=>error.message);
 const text=decodeURIComponent(thrown!.split('error=')[1]);
 expect(text).toContain('Perubahan rekam medis sudah tersimpan, tetapi racikan baru belum tersimpan (Racikan baru hanya dapat ditambahkan sebelum invoice dibuat atau kunjungan selesai.)');
 expect(text).not.toContain('Tambah tindakan / obat');
});

it('says the racikan outcome is unconfirmed when the database answer is unknown',async()=>{
 s.errorFor.clinic_add_record_items={message:'fetch failed'};
 const thrown=await koreksiRekamMedisLengkap(withCart([saved,resmi])).then(()=>null,(error:Error)=>error.message);
 expect(decodeURIComponent(thrown!.split('error=')[1])).toContain('racikan baru belum dapat dipastikan tersimpan. Periksa daftar racikan dulu');
});

it('rejects invalid racikan attribution before the record edit is written',async()=>{
 await expect(koreksiRekamMedisLengkap(withCart([saved,{...resmi,service_performers:{doctor_id:'same',staff_id:'same'}}]))).rejects.toThrow('edit=record');
 expect(s.calls).toEqual([]);
});
