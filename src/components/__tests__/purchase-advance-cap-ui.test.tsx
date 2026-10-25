// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {it,expect,vi,afterEach,beforeEach} from 'vitest';
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams()}));vi.mock('next/link',()=>({default:({children,...p}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...p}>{children}</a>}));
const fixture=vi.hoisted(()=>({mode:'normal'}));
vi.mock('@/lib/master-guard',()=>({bolehTransaksiKas:async()=>true}));
vi.mock('@/components/PilihRekening',()=>({PilihRekening:()=>null,loadRekeningAktif:async()=>[]}));
vi.mock('@/app/(app)/pembelian/uang-muka/actions',()=>({bayarUangMuka:async()=>{throw Error('fixture offline')},batalkanUangMuka:vi.fn(),periksaUangMuka:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'fixture-owner'}}})},from(table:string){let from=0,to=999;const q={select(){return q},eq(){return q},in(){return q},order(){return q},range(a:number,b:number){from=a;to=b;return q},then(resolve:(x:unknown)=>unknown){const rows=table==='purchase_orders'?[{id:'po',no_po:'PO-FICTION',supplier_id:'supplier',status:fixture.mode==='received'?'Diterima':fixture.mode==='partial'?'Dipesan':'Draft',total:fixture.mode==='invalid'?NaN:fixture.mode==='fractional'?600000.55:fixture.mode==='fractional-rest'?400000.55:600000}]:table==='suppliers'?[{id:'supplier',nama:'Fiction supplier'},{id:'other',nama:'Other fiction supplier'}]:table==='purchase_advances'?[{id:'a',no_um:'UM-FICTION',po_id:'po',tanggal:'2026-10-22',jumlah:fixture.mode.startsWith('fractional')?400000.25:400000,terpakai:100000,status:'aktif',metode:'Transfer',catatan:null,suppliers:{nama:'Fiction supplier'},purchase_orders:{no_po:'PO-FICTION'}}]:table==='goods_receipts'&&fixture.mode==='partial'?[{id:'receipt',po_id:'po'}]:[];return Promise.resolve({data:fixture.mode==='load-error'&&table==='purchase_advances'?null:rows.slice(from,to+1),count:rows.length,error:fixture.mode==='load-error'&&table==='purchase_advances'?{message:'fixture load failure'}:null}).then(resolve)}};return q;}})}));
import Page from '@/app/(app)/pembelian/uang-muka/page';
let root:Root|undefined,host:HTMLDivElement;
beforeEach(()=>{fixture.mode='normal';sessionStorage.clear()});
async function render(){Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);const page=await Page({searchParams:Promise.resolve({})});await act(async()=>root!.render(page))}
async function choose(name:string,value:string){await act(async()=>{const s=host.querySelector<HTMLSelectElement>(`select[name=${name}]`)!;s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}))})}
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();sessionStorage.clear()});
it('shows PO value, total active advances (not unspent balance) and remaining cap, limiting whole-rupiah input',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);const page=await Page({searchParams:Promise.resolve({})});await act(async()=>root!.render(page));
 const choose=async(name:string,value:string)=>{await act(async()=>{const s=host.querySelector<HTMLSelectElement>(`select[name=${name}]`)!;s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}))})};
 await choose('supplier_id','supplier');await choose('po_id','po');expect(host.textContent).toContain('Nilai PO');expect(host.textContent).toContain('600.000');expect(host.textContent).toContain('DP aktif');expect(host.textContent).toContain('400.000');expect(host.textContent).toContain('Sisa batas');
 const amount=host.querySelector<HTMLInputElement>('input[name=jumlah]')!;expect(amount.max).toBe('200000');expect(amount.step).toBe('0.01');
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(amount,'200001');amount.dispatchEvent(new Event('input',{bubbles:true}))});expect(amount.checkValidity()).toBe(false);
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(amount,'200000');amount.dispatchEvent(new Event('input',{bubbles:true}))});expect(amount.checkValidity()).toBe(true);
});

it('retains the chosen PO when supplier changes and blocks a mismatched supplier',async()=>{
 await render();await choose('supplier_id','supplier');await choose('po_id','po');await choose('supplier_id','other');expect(host.querySelector<HTMLSelectElement>('select[name=po_id]')!.value).toBe('po');expect(host.querySelector<HTMLInputElement>('input[name=jumlah]')!.checkValidity()).toBe(false);expect(host.textContent).toContain('Pemasok harus sesuai');
});
it('restores legacy draft fields and blocks a now-received PO rather than detaching it silently',async()=>{
 fixture.mode='received';sessionStorage.setItem('vetos:transaction-draft:v1:fixture-owner:transaction:purchase-advance',JSON.stringify({version:1,savedAt:Date.now(),requestKey:'saved',fields:{supplier_id:'supplier',po_id:'po',jumlah:'10'},snapshot:{}}));await render();expect(host.querySelector<HTMLSelectElement>('select[name=po_id]')!.value).toBe('po');expect(host.textContent).toContain('PO sudah diterima');expect(host.querySelector<HTMLInputElement>('input[name=jumlah]')!.checkValidity()).toBe(false);
});
it('blocks a partially received PO even while its status remains Dipesan',async()=>{
 fixture.mode='partial';sessionStorage.setItem('vetos:transaction-draft:v1:fixture-owner:transaction:purchase-advance',JSON.stringify({version:1,savedAt:Date.now(),requestKey:'partial-draft',fields:{supplier_id:'supplier',po_id:'po',jumlah:'10'},snapshot:{}}));await render();
 expect(host.querySelector<HTMLSelectElement>('select[name=po_id]')!.value).toBe('po');
 expect(host.textContent).toContain('penerimaan pertama');
 expect(host.querySelector<HTMLAnchorElement>('a[href="/pembelian/faktur"]')).not.toBeNull();
 expect(host.querySelector<HTMLInputElement>('input[name=jumlah]')!.checkValidity()).toBe(false);
 expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
});
it('fails closed without displaying NaN valuation when the source total is invalid',async()=>{
 fixture.mode='invalid';await render();await choose('supplier_id','supplier');await choose('po_id','po');expect(host.textContent).toContain('tidak dapat diverifikasi');expect(host.textContent).not.toContain('NaN');expect(host.querySelector<HTMLInputElement>('input[name=jumlah]')!.checkValidity()).toBe(false);
});
it('keeps the exact draft identity and fields through a failed submission and reload',async()=>{
 await render();await choose('supplier_id','supplier');await choose('po_id','po');const amount=host.querySelector<HTMLInputElement>('input[name=jumlah]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(amount,'200000');amount.dispatchEvent(new Event('input',{bubbles:true}))});const key=host.querySelector<HTMLInputElement>('input[name=draft_key]')!.value;
 await act(async()=>host.querySelector('form')!.requestSubmit());expect(host.textContent).toContain('fixture offline');await act(async()=>window.dispatchEvent(new Event('pagehide')));await act(async()=>root!.unmount());host.remove();root=undefined;await render();expect(host.querySelector<HTMLSelectElement>('select[name=po_id]')!.value).toBe('po');expect(host.querySelector<HTMLInputElement>('input[name=jumlah]')!.value).toBe('200000');expect(host.querySelector<HTMLInputElement>('input[name=draft_key]')!.value).toBe(key);
});

it('does not present a failed source read as zero balance or an empty history',async()=>{
 fixture.mode='load-error';await render();expect(host.querySelector('[role=alert]')).not.toBeNull();expect(host.querySelector('input[name=jumlah]')).toBeNull();expect(host.textContent).not.toContain('Belum ada uang muka');expect(host.textContent).not.toContain('Sisa yang belum terpakai: Rp 0');
});

it.each([['fractional','200000.3','200000.30','200000.31'],['fractional-rest','0.3','0.30','0.31']])('accepts the exact cent cap for %s and rejects one cent over it',async(mode,max,valid,over)=>{
 fixture.mode=mode;await render();await choose('supplier_id','supplier');await choose('po_id','po');const amount=host.querySelector<HTMLInputElement>('input[name=jumlah]')!;expect(amount.max).toBe(max);expect(amount.min).toBe('0.01');expect(amount.step).toBe('0.01');
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(amount,valid);amount.dispatchEvent(new Event('input',{bubbles:true}))});expect(amount.checkValidity()).toBe(true);
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(amount,over);amount.dispatchEvent(new Event('input',{bubbles:true}))});expect(amount.checkValidity()).toBe(false);
});
