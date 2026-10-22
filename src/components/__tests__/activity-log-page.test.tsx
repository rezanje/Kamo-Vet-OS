import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const { client, state }=vi.hoisted(()=>({client:{from:vi.fn(),auth:{getUser:vi.fn(async()=>({data:{user:{id:'owner'}}}))}},state:{role:'OWNER',active:true,error:false,source:'sales_orders',sourceId:'gone',fields:['total','catatan'] as string[],calls:[] as unknown[][]}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>client}));
import ActivityLogPage from '@/app/(app)/perusahaan/log-aktifitas/page';
const row={id:41,occurred_at:'2026-10-22T00:00:00Z',actor_name:'Audit Owner',actor_id:'server-user',actor_kind:'user',module_id:'penjualan',entity:'sales_orders',entity_id:'gone',row_entity:'sales_orders',row_id:'gone',object_label:'SO-DELETED',action:'delete',changed_fields:['total','catatan'],before_state:{total:12},after_state:{}};
beforeEach(()=>{
 state.role='OWNER';state.active=true;state.error=false;state.source='sales_orders';state.sourceId='gone';state.fields=['total','catatan'];state.calls=[];
 client.from.mockImplementation((table:string)=>{
  const q:Record<string,unknown>={then:(resolve:(v:unknown)=>void)=>resolve(table==='profiles'?{data:{role:state.role,is_active:state.active}}:{data:state.error?null:Array.from({length:41},(_,i)=>({...row,id:81-i,row_entity:state.source,row_id:state.sourceId,changed_fields:state.fields})),error:state.error?{message:'internal secret'}:null})};
  for(const method of ['select','eq','order','limit','lt','gt','gte','lte','ilike','maybeSingle','contains'])q[method]=(...args:unknown[])=>{state.calls.push([table,method,...args]);return q;};
  return q;
 });
});
it('renders server actor/time, retained deletion, safe values, redacted fields and next page',async()=>{
 const html=renderToStaticMarkup(await ActivityLogPage({searchParams:Promise.resolve({entity:'sales_orders',object:'gone',action:'delete'})}));
 expect(html).toContain('SO-DELETED');expect(html).toContain('Audit Owner');expect(html).toContain('07.00');expect(html).toContain('WIB');expect(html).toContain('Dihapus');expect(html).toContain('catatan');expect(html).toContain('disamarkan');expect(html).toContain('Lebih lama');expect(html).toContain('before=42');expect(html).toContain('object=gone');
 expect(html).toContain('Tidak merekonstruksi riwayat lama');
 expect(state.calls).toContainEqual(['activity_log','contains','object_refs',[{entity:'sales_orders',id:'gone'}]]);
 expect(state.calls).not.toContainEqual(['activity_log','eq','entity','sales_orders']);
});
it('finds source/related object histories without restricting them to the root entity',async()=>{
 const object=JSON.stringify({family_id:'a'.repeat(36),item_id:'b'.repeat(36)});
 await ActivityLogPage({searchParams:Promise.resolve({entity:'item_variant_members',object})});
 expect(state.calls).toContainEqual(['activity_log','contains','object_refs',[{entity:'item_variant_members',id:object}]]);
 expect(state.calls).not.toContainEqual(['activity_log','eq','entity','item_variant_members']);
 state.calls=[];
 await ActivityLogPage({searchParams:Promise.resolve({entity:'journal_lines'})});
 expect(state.calls).toContainEqual(['activity_log','contains','object_entities',['journal_lines']]);
});
it('shows the localized source identity and links its own retained history',async()=>{
 state.source='sales_receipts';state.sourceId='receipt-id';
 const html=renderToStaticMarkup(await ActivityLogPage({searchParams:Promise.resolve({})}));
 expect(html).toContain('Sumber:');expect(html).toContain('Penerimaan Penjualan');expect(html).toContain('entity=sales_receipts&amp;object=receipt-id');
 expect(html).not.toContain('HRIS, rekam medis, pajak, dan konfigurasi belum dicakup');
});
it('describes metadata-only clinical activity without implying its contents were captured',async()=>{
 state.source='medical_records';state.fields=['metadata'];
 const html=renderToStaticMarkup(await ActivityLogPage({searchParams:Promise.resolve({})}));
 expect(html).toContain('Aktivitas tercatat; rincian isi disamarkan.');expect(html).toContain('Sumber: Rekam Medis');
 expect(html).not.toContain('<summary>1 bagian berubah');expect(html).not.toContain('<code>metadata</code>');
});
it('uses stable cursor pagination and a bounded query',async()=>{
 await ActivityLogPage({searchParams:Promise.resolve({before:'41',module:'penjualan',q:'SO%_1'})});
 expect(state.calls).toContainEqual(['activity_log','lt','id','41']);
 expect(state.calls).toContainEqual(['activity_log','limit',41]);
 expect(state.calls).toContainEqual(['activity_log','ilike','object_label','%SO\\%\\_1%']);
});
it.each(['STAFF','DOCTOR','FINANCE'])('does not query audit for a %s reader',async role=>{
 state.role=role;
 const html=renderToStaticMarkup(await ActivityLogPage({searchParams:Promise.resolve({})}));
 expect(html).toContain('OWNER/ADMIN aktif');expect(state.calls.some(c=>c[0]==='activity_log')).toBe(false);
});
it('reports load failure without presenting empty history or leaking server details',async()=>{
 state.error=true;
 const html=renderToStaticMarkup(await ActivityLogPage({searchParams:Promise.resolve({})}));
 expect(html).toContain('Riwayat belum dapat dimuat');expect(html).not.toContain('Belum ada aktivitas');expect(html).not.toContain('internal secret');
});
it('denies a disabled owner',async()=>{state.active=false;const html=renderToStaticMarkup(await ActivityLogPage({searchParams:Promise.resolve({})}));expect(html).toContain('OWNER/ADMIN aktif');});

it('provides concise accessible names for each filter control',async()=>{
 const html=renderToStaticMarkup(await ActivityLogPage({searchParams:Promise.resolve({})}));
 for(const name of ['Modul','Objek','Aksi','Nomor / kode','Dari (WIB)','Sampai (WIB)'])expect(html).toContain('aria-label="'+name+'"');
});
