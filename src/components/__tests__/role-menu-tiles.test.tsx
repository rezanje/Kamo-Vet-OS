import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/link",()=>({default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
import { TileGrid } from "../ModuleHome";
import { RoleMenuProvider } from "../RoleMenuContext";
it("v2 tiles use canonical alias permission while legacy tiles remain unchanged",()=>{
 const rules=[{role:"STAFF",module_id:"__role_v2__"},{role:"STAFF",module_id:"pos"}];
 const html=renderToStaticMarkup(<RoleMenuProvider role="STAFF" rules={rules}><TileGrid moduleId="pos" /></RoleMenuProvider>);
 expect(html).toContain('href="/pos/sku"');expect(html).not.toContain('href="/pos/quest"');expect(html).not.toContain('href="/pos/shift"');expect(html).not.toContain('href="/pengaturan/cabang"');
 const legacy=renderToStaticMarkup(<RoleMenuProvider role="STAFF" rules={[]}><TileGrid moduleId="pos" /></RoleMenuProvider>);expect(legacy).toContain('href="/pos/quest"');
});
