// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ categories: [
 { id: "obat", name: "OBAT", parent_id: null, is_active: false },
 { id: "flu", name: "OBAT FLU", parent_id: "obat", is_active: true },
 { id: "food", name: "MAKANAN", parent_id: null, is_active: true },
 { id: "cat", name: "MAKANAN KUCING", parent_id: "food", is_active: true },
] }));
vi.mock("next/link", () => ({ default: ({children,...props}: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/satuan", () => ({ loadItemUnits: async () => new Map() }));
vi.mock("@/lib/hpp-reports-server", () => ({ loadSkuInventoryCosts: async () => [] }));
vi.mock("../../app/(app)/pos/sku/BarangMatrixTable", () => ({ BarangMatrixTable: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
 auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
 from(table: string) {
  const data = table === "item_categories" ? state.categories : table === "profiles" ? { role: "OWNER", is_active: false } : [];
  const q = { select: () => q, order: () => q, eq: () => q, in: () => q, range: () => q,
   maybeSingle: async () => ({ data }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count: 0 }).then(resolve) };
  return q;
 },
}) }));
import Page from "../../app/(app)/pos/sku/page";
let root: Root, container: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); container=document.createElement("div");document.body.append(container);root=createRoot(container); });
afterEach(async () => { await act(async () => root.unmount());container.remove(); });
async function render(params: Record<string,string> = {}) { const page=await Page({searchParams:Promise.resolve(params)});await act(async()=>root.render(page)); }
const select=(name:string)=>container.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
it("keeps an inactive parent in its place rather than promoting active children to parent options",async()=>{
 await render();
 expect(Array.from(select("induk").options).map(o=>o.value)).toEqual(expect.arrayContaining(["obat","food"]));
 expect(Array.from(select("induk").options).map(o=>o.value)).not.toContain("flu");
});
it("opens subcategory choices immediately when a parent is selected and clears stale children",async()=>{
 await render({induk:"food",kat:"cat"});
 await act(async()=>{select("induk").value="obat";select("induk").dispatchEvent(new Event("change",{bubbles:true}));});
 expect(select("kat").disabled).toBe(false);
 expect(Array.from(select("kat").options).map(o=>o.value)).toEqual(["","flu"]);
 expect(select("kat").value).toBe("");
});
