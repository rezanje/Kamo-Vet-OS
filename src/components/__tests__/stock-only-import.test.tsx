// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const action=vi.hoisted(()=>vi.fn());
vi.mock('@/app/(app)/pos/sku/impor/actions',()=>({previewSaldoAwalAccurate:action}));
vi.mock('next/link',()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
import {StockOnlyImport} from '@/app/(app)/pos/sku/impor/StockOnlyImport';
const prepared={ok:true,phase:'preview',run_id:'fiction-run',branch_id:'b',warehouse_id:'w',as_of:'2026-01-01',rows:[],source_qty:1,source_value:0.33,message:'Batch tersimpan',checks:[],scope_clarification:null,master_run_id:null,source_hash:'h',valuation:{policy:'HALF_UP_BATCH_V1',source_value:'0.333333',posted_value:'0.33',residual:'-0.003333',allocated_source_row:2,rate_adjustment:'-0.003333',control:'computed_from_source_not_authoritative'}};
let root:Root,host:HTMLDivElement;
const button=()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Siapkan batch saldo')!;
async function file(){await act(async()=>{const i=host.querySelector<HTMLInputElement>('input[type=file]')!;Object.defineProperty(i,'files',{configurable:true,value:[new File(['fiction'],'fiction.xlsx')]});i.dispatchEvent(new Event('change',{bubbles:true}));});}
async function date(v:string){await act(async()=>{const i=host.querySelector<HTMLInputElement>('input[type=date]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}));});}
beforeEach(async()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});action.mockReset().mockResolvedValue(prepared);host=document.createElement('div');root=createRoot(host);await act(async()=>root.render(<StockOnlyImport/>));});
afterEach(async()=>{await act(async()=>root.unmount());});
it('requires a file/date and sends explicit stock-only strict mode without inventing master metadata',async()=>{
 expect(button().disabled).toBe(true);await file();expect(button().disabled).toBe(true);await date('2026-01-01');await act(async()=>button().click());
 const data=action.mock.calls[0][0] as FormData;expect(data.get('import_mode')).toBe('stock_only');expect(data.get('valuation_policy')).toBe('STRICT');expect(data.get('master_run_id')).toBeNull();
 expect(host.textContent).toContain('0.333333');expect(host.textContent).toContain('-0.003333');expect(host.textContent).toContain('belum diposting');expect(host.querySelector('a')?.getAttribute('href')).toContain('run_id=fiction-run');
});
it('requires explicit monetary normalization selection',async()=>{await file();await date('2026-01-01');await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());await act(async()=>button().click());expect(action.mock.calls[0][0].get('valuation_policy')).toBe('HALF_UP_BATCH_V1');});
it('shows the full quantity and monetary delta even when strict preparation requires a choice',async()=>{
 action.mockResolvedValue({...prepared,ok:false,run_id:null,valuation:undefined,message:'Pilih pembulatan nilai uang',decimal_preview:{quantity:'0.1000000000000000001',source_value:'1.005',rounded_value:'1.01',rounding_delta:'0.005'}});
 await file();await date('2026-01-01');await act(async()=>button().click());
 expect(host.textContent).toContain('0,1000000000000000001');expect(host.textContent).toContain('1,005');expect(host.textContent).toContain('+0,005');expect(host.querySelector('a')).toBeNull();
});
it('latches two immediate preparation clicks into one request',async()=>{await file();await date('2026-01-01');await act(async()=>{button().click();button().click();});expect(action).toHaveBeenCalledTimes(1);});
it('ignores a saved response belonging to an old date',async()=>{let resolve!:(v:unknown)=>void;action.mockReturnValue(new Promise(r=>resolve=r));await file();await date('2026-01-01');await act(async()=>button().click());await date('2026-01-02');await act(async()=>resolve(prepared));expect(host.querySelector('a')).toBeNull();});
it('never calls a lost response success and tells users how to recover',async()=>{action.mockRejectedValue(new Error('response lost'));await file();await date('2026-01-01');await act(async()=>button().click());expect(host.textContent).toContain('belum dapat dipastikan');expect(host.textContent).toContain('muat ulang');expect(host.querySelector('a')).toBeNull();});
it('submits an explicitly chosen destination when source aliases need clarification',async()=>{
 action.mockResolvedValueOnce({...prepared,ok:false,run_id:null,scope_clarification:{sourceBranch:'Fiction source',sourceWarehouse:'Fiction old store',candidates:[{branch:{id:'explicit-b',code:'B',name:'Fiction branch'},warehouse:{id:'explicit-w',branch_id:'explicit-b',code:'W',name:'Fiction warehouse'}}]}});
 await file();await date('2026-01-01');await act(async()=>button().click());
 const choice=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('Fiction warehouse'));
 expect(choice).toBeDefined();await act(async()=>choice!.click());
 const d=action.mock.calls[1][0] as FormData;expect(d.get('scope_branch_id')).toBe('explicit-b');expect(d.get('scope_warehouse_id')).toBe('explicit-w');
});
it('keeps a saved but unreadable batch reachable by URL and never offers it for posting review',async()=>{
 window.history.replaceState(null,'','/pos/sku/impor');
 action.mockResolvedValue({...prepared,ok:false,valuation:undefined,message:'Batch tersimpan, tetapi rinciannya belum dapat dibaca (fiction). Muat ulang halaman untuk membuka batch yang sama; stok dan jurnal belum diposting.'});
 await file();await date('2026-01-01');await act(async()=>button().click());
 expect(window.location.search).toBe('?run_id=fiction-run');
 expect(host.querySelector('[role=alert]')?.textContent).toContain('belum diposting');
 expect(host.querySelector('a[href="/pos/sku/impor?run_id=fiction-run"]')).not.toBeNull();
 expect(host.querySelector('a[href*="persediaan-awal"]')).toBeNull();
});
