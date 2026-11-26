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

const two = [{ item_id: "th4", name: "TH4 Disinfektan", qty: 1000, qty_sistem: 3, selisih: 997 }, { item_id: "pel", name: "Pelontar obat Vet", qty: 7, qty_sistem: 6, selisih: 1 }, { item_id: "sh", name: "Shampoo Grooming 3in1 20L", qty: 3000, qty_sistem: 15, selisih: 2985 }];
async function renderTwo(revision = 0) { await act(async () => root.render(<StockCorrectionForm userId="owner" kind="opname" documentId="opr9" revision={revision} rows={two} />)); }
const heldRow = { item_id: "pel", name: "Pelontar obat Vet", old_qty: 7, new_qty: 3, reason: "Stok sudah terpakai, terjual, diretur atau dipindahkan. Rekonsiliasi dokumen lanjutan terlebih dahulu" };
it("OPR.00009 shape: shows the held row with its reason, labels the save button with the applied count, and sends only the quantities the user typed", async () => {
  api.previewStockCorrection.mockResolvedValue({ data: { token: "t2", revision: 0, applied: 2, blocked: [heldRow], lines: [
    { item_id: "th4", name: "TH4 Disinfektan", old_qty: 1000, new_qty: 1, stock_before: 1000, stock_after: 1, delta: -999 },
    { item_id: "sh", name: "Shampoo Grooming 3in1 20L", old_qty: 3000, new_qty: 0, stock_before: 3000, stock_after: 0, delta: -3000 }], value_before: 0, value_after: -757797.67, value_delta: -757797.67 } });
  await renderTwo();
  await input('input[name="qty-th4"]', "1"); await input('input[name="qty-sh"]', "0"); await input('input[name="qty-pel"]', "3"); await input('input[name="reason"]', "Salah ketik jumlah");
  await click("Periksa dampak koreksi");
  expect(api.previewStockCorrection).toHaveBeenCalledWith("opname", "opr9", [{ item_id: "th4", qty: 1 }, { item_id: "pel", qty: 3 }, { item_id: "sh", qty: 0 }]);
  expect(host.textContent).toContain("2 baris akan dikoreksi, 1 baris tertahan dan dibiarkan seperti semula");
  const region = host.querySelector('[aria-label="Baris yang tidak bisa dikoreksi"]')!;
  expect(region.textContent).toContain("Pelontar obat Vet");
  expect(region.textContent).toContain("tercatat 7, diminta 3");
  expect(region.textContent).toContain("Stok sudah terpakai");
  expect(host.querySelector('[data-blocked-row="pel"]')!.textContent).toContain("Tertahan, jumlah tidak diubah");
  expect(host.querySelector('[data-blocked-row="th4"]')).toBeNull();
  const save = host.querySelector<HTMLButtonElement>("button[data-save]")!;
  expect(save.textContent).toBe("Simpan 2 baris yang bisa dikoreksi");
  expect(save.disabled).toBe(false);
});
it("keeps the plain labels and no held region when nothing is held (old server or clean correction)", async () => {
  await render(); await input('input[name="qty-item"]', "3"); await input('input[name="reason"]', "Wrong count"); await click("Periksa dampak koreksi");
  expect(host.querySelector('[aria-label="Baris yang tidak bisa dikoreksi"]')).toBeNull();
  expect(host.querySelector("button[data-save]")!.textContent).toBe("Simpan koreksi");
  api.previewStockCorrection.mockResolvedValue({ data: { token: "t3", revision: 0, applied: 1, blocked: [], lines: [{ item_id: "item", name: "Medicine", old_qty: 5, new_qty: 3, stock_before: 5, stock_after: 3, delta: -2 }], value_before: 1, value_after: 0, value_delta: -1 } });
  await input('input[name="qty-item"]', "2"); await click("Periksa dampak koreksi");
  expect(host.textContent).toContain("1 baris akan dikoreksi.");
  expect(host.textContent).not.toContain("tertahan");
  expect(host.querySelector("button[data-save]")!.textContent).toBe("Simpan koreksi");
});
it("after a mixed save the held rows stay readable across the router refresh remount, and editing a quantity clears them", async () => {
  api.previewStockCorrection.mockResolvedValue({ data: { token: "t2", revision: 0, applied: 1, blocked: [heldRow], lines: [{ item_id: "th4", name: "TH4 Disinfektan", old_qty: 1000, new_qty: 1, stock_before: 1000, stock_after: 1, delta: -999 }], value_before: 0, value_after: -1, value_delta: -1 } });
  api.saveStockCorrection.mockResolvedValue({ data: { correction_id: "audit", revision: 1, document_id: "opr9", applied: 1, blocked: [heldRow] } });
  await renderTwo();
  await input('input[name="qty-th4"]', "1"); await input('input[name="qty-pel"]', "3"); await input('input[name="reason"]', "Salah ketik jumlah");
  await click("Periksa dampak koreksi"); await click("Simpan 1 baris yang bisa dikoreksi");
  expect(host.textContent).toContain("Koreksi revisi 1 tersimpan untuk 1 baris. 1 baris TIDAK diubah");
  expect(host.querySelector('[aria-label="Baris yang tidak bisa dikoreksi"]')!.textContent).toContain("Pelontar obat Vet");
  // router.refresh() remounts the panel with the new revision
  await act(async () => root.unmount()); root = createRoot(host);
  await renderTwo(1);
  expect(host.textContent).toContain("1 baris TIDAK diubah");
  expect(host.querySelector('[aria-label="Baris yang tidak bisa dikoreksi"]')!.textContent).toContain("Stok sudah terpakai");
  await input('input[name="qty-th4"]', "2");
  expect(host.querySelector('[aria-label="Baris yang tidak bisa dikoreksi"]')).toBeNull();
});
it("a refusal that holds every changed row lists each row with its reason (structured details), without a stale save button", async () => {
  api.previewStockCorrection.mockResolvedValue({ error: "Koreksi tidak bisa disimpan: semua baris yang diubah tertahan. Pelontar obat Vet: Stok sudah terpakai", blocked: [heldRow] });
  await renderTwo();
  await input('input[name="qty-pel"]', "3"); await input('input[name="reason"]', "Coba");
  await click("Periksa dampak koreksi");
  expect(host.textContent).toContain("semua baris yang diubah tertahan");
  expect(host.querySelector('[aria-label="Baris yang tidak bisa dikoreksi"]')!.textContent).toContain("Pelontar obat Vet");
  expect(host.querySelector('[data-blocked-row="pel"]')).not.toBeNull();
  expect(host.querySelector<HTMLButtonElement>("button[data-save]")!.disabled).toBe(true);
});
