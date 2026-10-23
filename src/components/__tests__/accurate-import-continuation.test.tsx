// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AccurateImportState, InitialStockState } from "@/app/(app)/pos/sku/impor/actions";

const actions = vi.hoisted(() => ({
  previewImporAccurate: vi.fn(), konfirmasiImporAccurate: vi.fn(),
  preflightSaldoAwalSekali: vi.fn(), previewSaldoAwalAccurate: vi.fn(),
}));
vi.mock("@/app/(app)/pos/sku/impor/actions", () => actions);
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
import { AccurateImportForm } from "@/app/(app)/pos/sku/impor/AccurateImportForm";

const master: AccurateImportState = {
  ok: true, phase: "preview", message: "Master fiktif siap", run_id: "fiction-master",
  source_fingerprint: "fiction-hash", source_hash: "fiction-hash", rows: [], total_rows: 1, hierarchy_count: 0,
  summary: { Baru: 1, Update: 0, Sama: 0, Dilewati: 0, Ditolak: 0 },
  new_masters: { categories: [], brands: [], units: [], suppliers: [] },
};
const preflight: InitialStockState = {
  ok: true, phase: "preview", message: "Saldo fiktif siap", run_id: null,
  branch_id: null, warehouse_id: null, master_run_id: null, as_of: "2026-01-01",
  source_hash: null, rows: [], source_qty: 10, source_value: 125, checks: [], scope_clarification: null,
};
const prepared: InitialStockState = {
  ...preflight, run_id: "fiction-stock", master_run_id: master.run_id,
  branch_id: "fiction-branch", warehouse_id: "fiction-warehouse", source_hash: "fiction-stock-hash",
};
let root: Root, host: HTMLDivElement;
const button = (name: string) => [...host.querySelectorAll("button")].find(node => node.textContent?.trim() === name);
const reviewLinks = () => [...host.querySelectorAll("a")].filter(node => node.getAttribute("href") === "/keuangan/persediaan-awal?run_id=fiction-stock");
async function chooseFile() {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["fictional workbook"], "fiction.xlsx")] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function setDate(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="date"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function check() {
  await chooseFile(); await setDate("2026-01-01");
  await act(async () => button("Cek perubahan")!.click());
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callback(0); return 0; });
  actions.previewImporAccurate.mockReset().mockResolvedValue(master);
  actions.konfirmasiImporAccurate.mockReset().mockResolvedValue({ ...master, phase: "done" });
  actions.preflightSaldoAwalSekali.mockReset().mockResolvedValue(preflight);
  actions.previewSaldoAwalAccurate.mockReset().mockResolvedValue(prepared);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<AccurateImportForm />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("hands a prepared batch to accounting review instead of offering import preparation again", async () => {
  await check();
  expect(button("Import Sekali")?.disabled).toBe(false);
  expect(reviewLinks()).toHaveLength(0); // Preflight has no saved batch to review.
  await act(async () => button("Import Sekali")!.click());
  expect(reviewLinks().length).toBeGreaterThan(0);
  expect(host.textContent).toContain("Master tersimpan");
  expect(host.textContent).toContain("Stok dan jurnal belum diposting");
  expect(button("Import Sekali")).toBeUndefined();
  expect(button("Lanjutkan Import Sekali")).toBeUndefined();
  expect(button("Cek perubahan")?.disabled).toBe(true);
  expect(host.textContent).not.toContain("Import selesai");
  expect(actions.konfirmasiImporAccurate).toHaveBeenCalledTimes(1);
  expect(actions.previewSaldoAwalAccurate).toHaveBeenCalledTimes(1);
});

it("does not repeat stock preparation through the old continuation after a batch was saved", async () => {
  await check(); await act(async () => button("Import Sekali")!.click());
  await act(async () => button("Lanjutkan Import Sekali")?.click());
  expect(actions.previewSaldoAwalAccurate).toHaveBeenCalledTimes(1);
});

it.each(["date", "file"])("invalidates the prepared review target when the %s changes", async (input) => {
  await check(); await act(async () => button("Import Sekali")!.click());
  if (input === "date") await setDate("2026-01-02"); else await chooseFile();
  expect(reviewLinks()).toHaveLength(0);
  expect(button("Cek perubahan")?.disabled).toBe(false);
  expect(button("Import Sekali")?.disabled).toBe(true);
});

it("keeps a rejected stock preparation actionable without claiming review is ready", async () => {
  actions.previewSaldoAwalAccurate.mockResolvedValue({ ...preflight, ok: false, message: "Fixture: gudang belum cocok" });
  await check(); await act(async () => button("Import Sekali")!.click());
  expect(host.textContent).toContain("Fixture: gudang belum cocok");
  expect(reviewLinks()).toHaveLength(0);
  expect(button("Cek perubahan")?.disabled).toBe(false);
  expect(host.textContent).not.toContain("Stok dan jurnal belum diposting");
});

it("retains master-only completion without preparing or claiming an inventory batch", async () => {
  actions.previewImporAccurate.mockResolvedValue({ ...master, reapplying: true });
  await chooseFile(); await act(async () => button("Cek perubahan")!.click());
  await act(async () => button("Import Sekali")!.click());
  expect(host.textContent).toContain("Import selesai");
  expect(host.textContent).toContain("0 saldo stok masuk");
  expect(actions.previewSaldoAwalAccurate).not.toHaveBeenCalled();
  expect(reviewLinks()).toHaveLength(0);
});

function deferred<T>() { let resolve!: (v:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; }
it.each(["file","date"])("ignores a late master preview after %s changes",async input=>{
 const pending=deferred<AccurateImportState>();actions.previewImporAccurate.mockReturnValue(pending.promise);
 await chooseFile();await setDate("2026-01-01");
 await act(async()=>{button("Cek perubahan")!.click();});
 if(input==="file")await chooseFile();else await setDate("2026-01-02");
 await act(async()=>pending.resolve(master));
 expect(host.textContent).not.toContain('Master fiktif siap');
 expect(button("Import Sekali")?.disabled).toBe(true);
 expect(actions.preflightSaldoAwalSekali).not.toHaveBeenCalled();
});
it("does not start preparation from a late master confirmation after date changes",async()=>{
 await check();const pending=deferred<AccurateImportState>();actions.konfirmasiImporAccurate.mockReturnValue(pending.promise);
 await act(async()=>button("Import Sekali")!.click());await setDate("2026-01-02");
 await act(async()=>pending.resolve({...master,phase:'done'}));
 expect(actions.previewSaldoAwalAccurate).not.toHaveBeenCalled();expect(reviewLinks()).toHaveLength(0);
});
it('ignores a progress body that finishes parsing after a new file starts checking',async()=>{
 const body=deferred<unknown>();const confirm=deferred<AccurateImportState>();
 vi.mocked(fetch).mockResolvedValue({ok:true,json:()=>body.promise} as Response);
 await check();actions.konfirmasiImporAccurate.mockReturnValue(confirm.promise);
 await act(async()=>button('Import Sekali')!.click());await chooseFile();
 await act(async()=>confirm.resolve({...master,phase:'done'}));
 const next=deferred<AccurateImportState>();actions.previewImporAccurate.mockReturnValue(next.promise);
 await act(async()=>button('Cek perubahan')!.click());
 expect(host.textContent).toContain('Sedang diproses');
 await act(async()=>body.resolve({phase:'mengimpor',percentage:100,completed:100,total:100}));
 expect(host.textContent).toContain('Sedang diproses');expect(host.textContent).not.toContain('70%');
 await act(async()=>next.resolve(master));
});
