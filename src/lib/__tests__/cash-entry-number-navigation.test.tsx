import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const id='10000000-0000-4000-8000-000000000001';
const state=vi.hoisted(()=>({lookups:0,jenis:'Masuk'}));
vi.mock('@/lib/master-guard',()=>({bolehTransaksiKas:async()=>false}));
vi.mock('@/lib/ledger',()=>({getAccountBalances:async()=>[]}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:null}})},from:()=>{
 let jenis='';const row={id:'10000000-0000-4000-8000-000000000001',no_bukti:'KM.2026.10.00001',tanggal:'2026-10-24',jumlah:100,lawan_code:'4101',account_id:'20000000-0000-4000-8000-000000000002',revision:0,keterangan:null,voided_at:null,rekening:null,branches:null};
 const q={select:()=>q,eq:(field:string,value:string)=>{if(field==='jenis')jenis=value;if(field==='id')state.lookups++;return q;},order:()=>q,limit:()=>q,maybeSingle:async()=>({data:jenis===state.jenis?row:null,error:null}),then:(resolve:(v:unknown)=>void)=>resolve({data:[],error:null})};return q;
}})}));
import { KasEntryScreen } from '@/app/(app)/kas-bank/kas/KasEntryScreen';
it.each(['Masuk','Keluar'] as const)('loads an older %s cash entry by its saved id',async(jenis)=>{
 state.jenis=jenis;state.lookups=0;
 const html=renderToStaticMarkup(await KasEntryScreen({jenis,searchParams:Promise.resolve({entry:id})}));
 expect(html).toContain(`id="cash-entry-${id}"`);
 expect(html).toContain('KM.2026.10.00001');
 expect(state.lookups).toBe(1);
});
it('ignores malformed entry parameters without an id lookup',async()=>{
 state.lookups=0;
 await KasEntryScreen({jenis:'Masuk',searchParams:Promise.resolve({entry:'../bad'})});
 expect(state.lookups).toBe(0);
});
