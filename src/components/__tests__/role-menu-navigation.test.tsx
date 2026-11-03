import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,it,vi} from "vitest";
vi.mock("next/navigation",()=>({usePathname:()=>"/pos"}));
vi.mock("next/link",()=>({default:({prefetch,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>&{prefetch?:boolean})=><a {...props} data-prefetch={String(prefetch)}/> }));
vi.mock("@/app/login/actions",()=>({logout:vi.fn()}));
import {Sidebar} from "../Sidebar";
import {cariMenu} from "@/lib/cari-global";
it("existing Sidebar and global search obey v2 explicit groups for all five roles",()=>{
 for(const role of ["OWNER","ADMIN","FINANCE","STAFF","DOCTOR"]){
 const rules=["__role_v2__","pos"].map(module_id=>({role,module_id}));
 const html=renderToStaticMarkup(<Sidebar branches={[]} fullName="Test" role={role} aksesModul={rules}/>);
 expect(html.includes('href="/pos"')).toBe(true);expect(html.includes('href="/pos/quest"')).toBe(role==="OWNER");expect(html.includes('href="/kasir"')).toBe(role==="OWNER");
 expect(cariMenu("Quest",role,rules).some(m=>m.href==="/pos/quest")).toBe(role==="OWNER");
 }
});
it("global menu search accepts query-bearing root href; tax settings follow the ORIGINAL rule (pengaturan opens /pengaturan/pajak)",()=>{
 const rules=["__role_v2__","penjualan","pengaturan"].map(module_id=>({role:"STAFF",module_id}));
 expect(cariMenu("Penerimaan Penjualan","STAFF",rules).some(m=>m.href==="/penjualan/faktur?status=belum")).toBe(true);
 // Reach parity with the original matcher: `pengaturan` always opened /pengaturan/pajak, so saving the displayed list keeps it.
 expect(cariMenu("Mode PKP","STAFF",rules).some(m=>m.href==="/pengaturan/pajak")).toBe(true);
 // Without pengaturan or pajak the tax settings stay hidden.
 expect(cariMenu("Mode PKP","STAFF",["__role_v2__","penjualan"].map(module_id=>({role:"STAFF",module_id})))).toEqual([]);
});
