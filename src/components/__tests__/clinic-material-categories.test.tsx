// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const actions=vi.hoisted(()=>({single:vi.fn(),bulk:vi.fn()}));
vi.mock('@/app/(app)/klinik/bahan-baku/actions',()=>({setBahanBaku:actions.single,setBahanBakuBanyak:actions.bulk}));
import {BahanBakuClient,type ItemRow} from '@/app/(app)/klinik/bahan-baku/BahanBakuClient';
import type {KategoriRow} from '@/lib/kategori';
const categories:KategoriRow[]=[
 {id:'p1',name:'Obat Klinik',parent_id:null,is_active:true},{id:'an',name:'Anestesi / Sedasi',parent_id:'p1',is_active:true},{id:'c1',name:'Umum',parent_id:'p1',is_active:true},
 {id:'p2',name:'Nutrisi',parent_id:null,is_active:true},{id:'c2',name:'Umum',parent_id:'p2',is_active:true},{id:'empty',name:'Tanpa Kandidat',parent_id:null,is_active:true},
 {id:'old-parent',name:'Induk Nonaktif',parent_id:null,is_active:false},{id:'old-child',name:'Anak Induk Nonaktif',parent_id:'old-parent',is_active:true},
 {id:'off',name:'Subkategori Nonaktif',parent_id:'p1',is_active:false},{id:'orphan',name:'Induk Dihapus',parent_id:'deleted-parent',is_active:true},
];
const row=(id:string,category_id:string|null,selected=false):ItemRow=>({id,code:`QA-${id}`,name:`Fiction ${id}`,category_id,kategori:category_id??'Tanpa kategori',sell_price:1250,is_compound_material:selected});
const items=[row('sedasi','an'),row('umum-obat','c1'),row('umum-nutrisi','c2'),row('history','off',true),row('history-parent','old-child',true),row('deleted-history','deleted',true),row('uncategorized',null)];
let root:Root,host:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});actions.single.mockReset().mockResolvedValue({ok:true});actions.bulk.mockReset().mockImplementation(async(ids:string[])=>({ok:true,updated:ids.length}));host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(async()=>{await act(async()=>root.unmount());host.remove()});
const render=async(rows=items,cats=categories)=>{await act(async()=>root.render(<BahanBakuClient items={rows} categories={cats}/>))};
const parent=()=>host.querySelector<HTMLSelectElement>('select[aria-label="Kategori induk"]')!;
const child=()=>host.querySelector<HTMLSelectElement>('select[aria-label="Subkategori"]')!;
async function choose(select:HTMLSelectElement,value:string){expect(select).not.toBeNull();await act(async()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}))})}
const shown=()=>[...host.querySelectorAll('tbody tr')].map(r=>r.textContent).join('|');
it('uses master hierarchy IDs, hides unavailable category choices and preserves saved historical materials',async()=>{
 await render();expect(parent()).not.toBeNull();expect(shown()).toContain('QA-history');expect(shown()).toContain('QA-deleted-history');
 expect([...parent().options].map(o=>o.value)).toEqual(['__selected__','','p2','p1','empty']);
 await choose(parent(),'p1');expect([...child().options].map(o=>o.value)).toEqual(['','an','c1']);
 await choose(child(),'an');expect(shown()).toContain('QA-sedasi');expect(shown()).not.toContain('QA-umum');
 expect(shown()).not.toContain('QA-history');
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('Pilih semua hasil'))!.click());
 expect(actions.bulk).toHaveBeenCalledWith(['sedasi'],true);
 await choose(parent(),'__selected__');expect(shown()).toContain('QA-history');expect(shown()).toContain('QA-sedasi');
});
it('resets child selection when switching parents and distinguishes identical child labels by ID',async()=>{
 await render();await choose(parent(),'p1');await choose(child(),'an');await choose(parent(),'p2');expect(child().value).toBe('');
 expect([...child().options].map(o=>o.value)).toEqual(['','c2']);expect(shown()).toContain('QA-umum-nutrisi');expect(shown()).not.toContain('QA-sedasi');
 await choose(child(),'c2');expect(shown()).not.toContain('QA-umum-obat');
});
it('uses refreshed category and item props without retaining deleted labels or historical reassignment',async()=>{
 await render([row('saved','an',true)]);expect(shown()).toContain('QA-saved');
 await render([{...row('saved','c2',true),name:'Fiction refreshed',kategori:'Nutrisi › Umum'}],categories.filter(c=>c.id!=='an'));
 expect(shown()).toContain('Fiction refreshed');expect(shown()).toContain('Nutrisi');expect(child().textContent).not.toContain('Anestesi');
});
it('keeps uncategorized and legacy active inventory reachable without adding unavailable category choices',async()=>{
 await render();await choose(parent(),'');expect(shown()).toContain('QA-uncategorized');expect(shown()).toContain('QA-history');
 expect([...host.querySelectorAll('button')].some(b=>b.textContent?.includes('Pilih semua hasil'))).toBe(false);
});
it('rolls back only a failed optimistic flag change and displays the error',async()=>{
 actions.bulk.mockResolvedValue({ok:false,error:'fixture denied'});await render();await choose(parent(),'p1');await choose(child(),'an');
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('Pilih semua hasil'))!.click());
 expect(host.querySelector<HTMLInputElement>('tbody input[type=checkbox]')!.checked).toBe(false);expect(host.textContent).toContain('fixture denied');
});
it('keeps empty master results usable without inventing categories or candidates',async()=>{
 await render([],[]);expect(parent()).not.toBeNull();expect(parent().options).toHaveLength(2);expect(child().disabled).toBe(true);expect(host.querySelector('tbody input')).toBeNull();
});
it('ignores a late failed action from an obsolete server snapshot',async()=>{
 let finish!:(value:{ok:false;error:string})=>void;
 actions.single.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));await render([row('sedasi','an',true)]);
 await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
 const refreshed=[{...row('sedasi','c2',false),name:'Fiction new snapshot',kategori:'Nutrisi › Umum'}];await render(refreshed);
 await act(async()=>finish({ok:false,error:'obsolete request'}));
 await choose(parent(),'p2');expect(shown()).toContain('Fiction new snapshot');
 expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);expect(host.textContent).not.toContain('obsolete request');
});
it('falls back to saved materials if the chosen parent is removed on refresh',async()=>{
 await render();await choose(parent(),'p1');await choose(child(),'an');
 await render(items,categories.filter(c=>!['p1','an','c1'].includes(c.id)));
 expect(parent().value).toBe('__selected__');expect(child().disabled).toBe(true);expect(shown()).toContain('QA-history');expect(shown()).not.toContain('QA-sedasi');
});
