import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const { client, state }=vi.hoisted(()=>({client:{from:vi.fn(),auth:{getUser:vi.fn(async()=>({data:{user:{id:'owner'}}}))}},state:{role:'OWNER',active:true,error:false,calls:[] as unknown[][]}}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>client}));
import ActivityLogPage from '@/app/(app)/perusahaan/log-aktifitas/page';
const row={id:41,occurred_at:'2026-10-22T00:00:00Z',actor_name:'Audit Owner',actor_id:'server-user',actor_kind:'user',module_id:'penjualan',entity:'sales_orders',entity_id:'gone',row_entity:'sales_orders',row_id:'gone',object_label:'SO-DELETED',action:'delete',changed_fields:['total','catatan'],before_state:{total:12},after_state:{}};
beforeEach(()=>{
 state.role='OWNER';state.active=true;state.error=false;state.calls=[];
 client.from.mockImplementation((table:string)=>{
  const q:Record<string,unknown>={then:(resolve:(v:unknown)=>void)=>resolve(table==='profiles'?{data:{role:state.role,is_active:state.active}}:{data:state.error?null:Array.from({length:41},(_,i)=>({...row,id:81-i})),error:state.error?{message:'internal secret'}:null})};
  for(const method of ['select','eq','order','limit','lt','gt','gte','lte','ilike','maybeSingle','contains'])q[method]=(...args:unknown[])=>{state.calls.push([table,method,...args]);return q;};
  return q;
 });
});
it('renders server actor/time, retained deletion, safe values, redacted fields and next page',async()=>{
 const html=renderToStaticMarkup(await ActivityLogPage({searchParams:Promise.resolve({entity:'sales_orders',object:'gone',action:'delete'})}));
 expect(html).toContain('SO-DELETED');expect(html).toContain('Audit Owner');expect(html).toContain('07.00');expect(html).toContain('WIB');expect(html).toContain('Dihapus');expect(html).toContain('catatan');expect(html).toContain('disamarkan');expect(html).toContain('Lebih lama');expect(html).toContain('before=42');expect(html).toContain('object=gone');
 expect(html).toContain('Tidak merekonstruksi riwayat lama');
 expect(state.calls).toContainEqual(['activity_log','contains','entity_ids',['gone']]);
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
