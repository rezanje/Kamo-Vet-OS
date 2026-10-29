// @vitest-environment jsdom
import React, {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
vi.mock("@/app/(app)/pos/sku/impor/actions",()=>({previewSaldoAwalAccurate:vi.fn()}));
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
import {InitialStockImport} from "@/app/(app)/pos/sku/impor/InitialStockImport";
import type {InitialStockState} from '@/app/(app)/pos/sku/impor/actions';
import {previewSaldoAwalAccurate} from '@/app/(app)/pos/sku/impor/actions';
it("links a prepared import to explicit GL review before any posting",async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const host=document.createElement("div");const root=createRoot(host);
 await act(async()=>root.render(<InitialStockImport sourceFile={null} masterRunId="master" presetState={{ok:true,phase:"preview",run_id:"fiction-batch",branch_id:"branch",warehouse_id:"wh",as_of:"2026-01-01",master_run_id:"master",source_hash:"hash",message:"Ready",rows:[],source_qty:10,source_value:125,checks:[],scope_clarification:null}}/>));
 expect(host.querySelector('a')?.getAttribute('href')).toBe('/keuangan/persediaan-awal?run_id=fiction-batch');
 expect(host.textContent).toContain('belum masuk stok atau buku besar');
 expect([...host.querySelectorAll('button')].some(button=>button.textContent?.includes('Posting saldo'))).toBe(false);
 await act(async()=>root.unmount());
});
it('ignores a late manual preparation after changing the rounding choice',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.createElement('div');const root=createRoot(host);let resolve!:(v:InitialStockState)=>void;
 vi.mocked(previewSaldoAwalAccurate).mockReset().mockReturnValue(new Promise(r=>{resolve=r;}));
 await act(async()=>root.render(<InitialStockImport sourceFile={new File(['fiction'],'fiction.xlsx')} masterRunId="fiction-master"/>));
 const input=host.querySelector<HTMLInputElement>('input[type=date]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'2026-01-01');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('Cek saldo'))!.click());
 await act(async()=>host.querySelector<HTMLInputElement>('input[type=radio][value=STRICT]')!.click());
 await act(async()=>resolve({ok:true,phase:'preview',run_id:'old-batch',rows:[],source_qty:1,source_value:1,checks:[]} as unknown as InitialStockState));
 expect(host.querySelector('a')).toBeNull();await act(async()=>root.unmount());
});
it('shows exact quantity and proposed monetary rounding delta before posting',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.createElement('div');const root=createRoot(host);
 const state={ok:true,phase:'preview',run_id:null,branch_id:null,warehouse_id:null,as_of:'2026-01-01',master_run_id:null,source_hash:null,message:'Preview',rows:[{row:2,itemCode:'FICTION',unit:'PCS',status:'valid',reason:null,baseQty:0.1,baseQtyExact:'0.1000000000000000001'}],source_qty:0.1,source_value:1.005,checks:[],scope_clarification:null,decimal_preview:{quantity:'0.1000000000000000001',source_value:'1.005',rounded_value:'1.01',rounding_delta:'0.005'}} as unknown as InitialStockState;
 await act(async()=>root.render(<InitialStockImport sourceFile={null} masterRunId={null} presetState={state}/>));
 expect(host.textContent).toContain('0,1000000000000000001');expect(host.textContent).toContain('1,005');expect(host.textContent).toContain('1,01');expect(host.textContent).toContain('+0,005');
 expect(host.textContent).toContain('Selisih pembulatan');expect(host.querySelector('a')).toBeNull();await act(async()=>root.unmount());
});
