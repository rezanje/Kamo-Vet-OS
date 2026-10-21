// @vitest-environment jsdom
import React, {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
vi.mock("@/app/(app)/pos/sku/impor/actions",()=>({previewSaldoAwalAccurate:vi.fn()}));
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
import {InitialStockImport} from "@/app/(app)/pos/sku/impor/InitialStockImport";
it("links a prepared import to explicit GL review before any posting",async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const host=document.createElement("div");const root=createRoot(host);
 await act(async()=>root.render(<InitialStockImport sourceFile={null} masterRunId="master" presetState={{ok:true,phase:"preview",run_id:"fiction-batch",branch_id:"branch",warehouse_id:"wh",as_of:"2026-01-01",master_run_id:"master",source_hash:"hash",message:"Ready",rows:[],source_qty:10,source_value:125,checks:[],scope_clarification:null}}/>));
 expect(host.querySelector('a')?.getAttribute('href')).toBe('/keuangan/persediaan-awal?run_id=fiction-batch');
 expect(host.textContent).toContain('belum masuk stok atau buku besar');
 expect([...host.querySelectorAll('button')].some(button=>button.textContent?.includes('Posting saldo'))).toBe(false);
 await act(async()=>root.unmount());
});
