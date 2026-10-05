import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({createClient:async()=>({from(table:string){
 const query={select(){return query},eq(){return query},order(){return query},limit(){return query},
 maybeSingle:async()=>({data:table==='visits'?{id:'visit',created_at:'2026-10-05T00:00:00Z',pets:{name:'Fictional',species:'Kucing'},customers:{name:'Fictional'}}:{id:'record'},error:null}),
 then(resolve:(value:unknown)=>void){return Promise.resolve({data:[{nama_obat:'Fictional medicine',qty:2,satuan:'btl',aturan_pakai:'2x sehari'}],error:null}).then(resolve)}};return query;
}})}));
vi.mock('next/link',()=>({default:({children,href}:React.PropsWithChildren<{href:string}>)=><a href={href}>{children}</a>}));
import Page from '../../app/(app)/klinik/rekam-medis/[visitId]/resep/page';
it('prints the prescribed quantity with its chosen unit',async()=>{
 const html=renderToStaticMarkup(await Page({params:Promise.resolve({visitId:'visit'})}));
 expect(html).toContain('2 btl');
});
