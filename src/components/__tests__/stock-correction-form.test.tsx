// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ previewStockCorrection: vi.fn(), saveStockCorrection: vi.fn(), recoverStockCorrection: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/pos/koreksi-stok/actions", () => api);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: api.refresh }) }));
import { StockCorrectionForm } from "@/app/(app)/pos/koreksi-stok/StockCorrectionForm";
let host: HTMLDivElement;let root: Root;
const rows = [{ item_id: "item", name: "Medicine", qty: 5, qty_sistem: 0, selisih: 5 }];
async function render(revision = 0) { await act(async () => root.render(<StockCorrectionForm userId="owner" kind="adjustment" documentId="doc" revision={revision} rows={rows} />)); }
async function input(selector: string, value: string) {
  await act(async () => { const el=host.querySelector<HTMLInputElement>(selector)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true})); });
}
async function click(text: string) { await act(async () => Array.from(host.querySelectorAll("button")).find(b=>b.textContent===text)!.click()); }
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement("div");document.body.append(host);root=createRoot(host);api.previewStockCorrection.mockResolvedValue({data:{token:"token",lines:[{item_id:"item",name:"Medicine",old_qty:5,new_qty:3,stock_before:5,stock_after:3,delta:-2}],value_before:500,value_after:300,value_delta:-200}});api.saveStockCorrection.mockResolvedValue({data:{correction_id:"audit",revision:1,document_id:"doc"}});api.recoverStockCorrection.mockResolvedValue({data:null}); });
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it("requires preview and reason, invalidates preview when quantity changes",async()=>{
 await render();await input('input[name="qty-item"]',"3");await input('input[name="reason"]',"Wrong count");
 expect(host.querySelector<HTMLButtonElement>('button[data-save]')!.disabled).toBe(true);
 await click("Periksa dampak koreksi");expect(host.textContent).toContain("5 → 3");expect(host.textContent).toContain("-200");
 expect(host.querySelector<HTMLButtonElement>('button[data-save]')!.disabled).toBe(false);
 await input('input[name="qty-item"]',"2");expect(host.querySelector<HTMLButtonElement>('button[data-save]')!.disabled).toBe(true);
});
it("retains the exact request across a lost response and remount",async()=>{
 api.saveStockCorrection.mockRejectedValue(new Error("Connection lost"));await render();await input('input[name="qty-item"]',"3");await input('input[name="reason"]',"Wrong count");await click("Periksa dampak koreksi");await click("Simpan koreksi");
 const submitted=api.saveStockCorrection.mock.calls[0];expect(host.textContent).toContain("Periksa hasil terakhir");
 await act(async()=>root.unmount());root=createRoot(host);await render(1);
 await click("Coba simpan ulang");expect(api.saveStockCorrection.mock.calls[1]).toEqual(submitted);
});
