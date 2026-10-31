// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ previewInventoryAccounting: vi.fn(), postInventoryAccounting: vi.fn() }));
vi.mock("@/app/(app)/keuangan/persediaan-awal/actions", () => actions);
import { InventoryAccountingForm } from "@/app/(app)/keuangan/persediaan-awal/InventoryAccountingForm";

const runId = "11111111-1111-4111-8111-111111111111";
const equityId = "22222222-2222-4222-8222-222222222222";
const batches = [{ id: runId, source_name: "initial.xlsx", status: "previewed", as_of_date: "2026-09-01", branch_id: "branch", created_at: "2026-09-01" }];
const accounts = [{ id: equityId, code: "410001", name: "Modal" }, { id: "other", code: "3102", name: "Ekuitas lain" }];
const report = {
  run_id: runId, status: "previewed", source_name: "initial.xlsx", source_hash: "sha256-source",
  branch_id: "branch", branch_name: "PDRY", warehouse_id: "warehouse", warehouse_name: "Gudang PDRY", as_of: "2026-09-01",
  selected_rows: 2, excluded_rows: 1, original_qty: 3, original_value: 150000, remaining_value: 50000,
  inventory_account: { id: "inventory", code: "170001", name: "Persediaan" }, equity_account: accounts[0],
  blockers: [] as string[], can_post: true, receipt: null, evidence: { rows: ["original evidence"] },
};
let root: Root, container: HTMLDivElement;
const button = (label: string) => Array.from(container.querySelectorAll("button")).find(item => item.textContent === label)!;
async function select(label: string, value: string) {
  const input = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function preview() {
  await select("Akun ekuitas", equityId);
  await act(async () => button("Preview / laporan tanpa posting").click());
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  actions.previewInventoryAccounting.mockReset().mockResolvedValue({ ok: true, report });
  actions.postInventoryAccounting.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<InventoryAccountingForm batches={batches} accounts={accounts} initialRunId={runId} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("requires an explicit equity selection and renders exact branch/source evidence", async () => {
  expect((button("Preview / laporan tanpa posting") as HTMLButtonElement).disabled).toBe(true);
  expect(container.querySelector<HTMLSelectElement>('select[aria-label="Akun ekuitas"]')!.value).toBe("");
  await preview();
  expect(container.textContent).toContain("PDRY / Gudang PDRY");
  expect(container.textContent).toContain("sha256-source");
  expect(container.textContent).toContain("2 / 1");
  expect(container.textContent).toContain("original evidence");
  expect((button("Posting stok + jurnal cabang") as HTMLButtonElement).disabled).toBe(true);
  expect(actions.postInventoryAccounting).not.toHaveBeenCalled();
});

it("invalidates the reviewed report when the equity selection changes", async () => {
  await preview();
  await select("Akun ekuitas", "other");
  expect(container.querySelector('[aria-label="Laporan rekonsiliasi"]')).toBeNull();
  expect(actions.postInventoryAccounting).not.toHaveBeenCalled();
});

it("shows consumed-stock historical data as a report with no posting control", async () => {
  actions.previewInventoryAccounting.mockResolvedValue({ ok: true, report: { ...report, status: "posted", can_post: false, blockers: ["GL global perlu ditinjau"] } });
  await preview();
  expect(container.textContent).toContain("Laporan batch historis");
  expect(container.textContent).toContain("GL global perlu ditinjau");
  expect(container.textContent).toContain("bukan dasar jurnal historis");
  expect(button("Posting stok + jurnal cabang")).toBeUndefined();
  expect(actions.postInventoryAccounting).not.toHaveBeenCalled();
});

it("explains database blockers in operational language", async () => {
  actions.previewInventoryAccounting.mockResolvedValue({ ok: true, report: { ...report, can_post: false,
    blockers: ["Barang sudah memiliki stok/layer/riwayat; impor awal baru diblokir", "Gudang ini sudah punya saldo awal; koreksi jumlahnya lewat Stok Opname"] } });
  await preview();
  expect(container.textContent).toContain("Belum bisa diposting karena:");
  expect(container.textContent).toContain("Impor ulang file yang sama: barang itu otomatis dilewati");
  expect(container.textContent).toContain("Koreksi jumlah stoknya lewat Stok Opname, bukan impor ulang.");
  expect(button("Posting stok + jurnal cabang")).toBeUndefined();
});

it("keeps reviewed choices and reason after response loss and permits exact retry", async () => {
  await preview();
  const reason = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Alasan audit"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Dasar ekuitas dikonfirmasi");
    reason.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  actions.postInventoryAccounting.mockRejectedValueOnce(new Error("Lost response"));
  await act(async () => button("Posting stok + jurnal cabang").click());
  expect(container.textContent).toContain("Respons posting tidak diterima");
  expect(container.querySelector<HTMLSelectElement>('select[aria-label="Akun ekuitas"]')!.disabled).toBe(true);
  expect(reason.value).toBe("Dasar ekuitas dikonfirmasi");
  actions.postInventoryAccounting.mockResolvedValueOnce({ ok: true, receipt: { entry_id: "journal" } });
  await act(async () => button("Kirim ulang permintaan yang sama").click());
  expect(actions.postInventoryAccounting).toHaveBeenCalledTimes(2);
  expect(actions.postInventoryAccounting.mock.calls[0][0]).toEqual(actions.postInventoryAccounting.mock.calls[1][0]);
  expect(container.textContent).toContain("Bukti posting batch tersimpan");
});

it("shows full source value and deterministic residual before posting confirmation",async()=>{
 actions.previewInventoryAccounting.mockResolvedValue({ok:true,report:{...report,evidence:{summary:{valuation:{policy:'HALF_UP_BATCH_V1',source_value:'150000.003333',posted_value:'150000.00',residual:'-0.003333',allocated_source_row:2}}}}});
 await preview();expect(container.querySelector('[aria-label="Bukti normalisasi"]')?.textContent).toContain('150000.003333');expect(container.querySelector('[aria-label="Bukti normalisasi"]')?.textContent).toContain('-0.003333');
});
it("reconciles source total, posted total and per-line rupiah rounding difference",async()=>{
 actions.previewInventoryAccounting.mockResolvedValue({ok:true,report:{...report,status:'posted',evidence:{summary:{valuation:{policy:'ROUND_LINE_RUPIAH_V1',source_value:'150000.4523',posted_value:'150000',residual:'-0.4523',rounding_difference:'-0.4523',source_lines:40,line_rounding:{unit:'1',mode:'HALF_UP',split_lines:7},allocated_source_row:null}}}}});
 await preview();const text=container.querySelector('[aria-label="Rekonsiliasi total sumber dan posting"]')?.textContent??'';
 expect(text).toContain('Total sumber (file Accurate)Rp 150000.4523');expect(text).toContain('Total dipostingRp 150000');expect(text).toContain('Selisih pembulatanRp -0.4523');expect(text).toContain('7 dari 40 baris sumber');
 expect(container.querySelector('[aria-label="Bukti normalisasi"]')?.textContent).toContain('Bulatkan nilai tiap baris ke rupiah penuh');
});
it("shows source quantity and value by item and warehouse without claiming unposted stock matches", async () => {
  actions.previewInventoryAccounting.mockResolvedValue({ ok: true, report: { ...report, evidence: {
    rows: [{ status: "valid", code: "SKU-FIKTIF", payload: { item_id: "item-a", warehouse_id: "warehouse-a", base_qty: "2", base_unit_cost: "100" } }],
    source_layers: [], source_moves: [],
  }, selected_rows: 1 } });
  await preview();
  const section = container.querySelector('[aria-label="Rekonsiliasi per barang dan gudang"]')!;
  expect(section.textContent).toContain("SKU-FIKTIF");
  expect(section.textContent).toContain("warehouse-a");
  expect(section.textContent).toContain("Menunggu posting");
  expect(section.textContent).not.toContain("Cocok");
});
it("makes a posted per-item difference visible without offering a second posting", async () => {
  actions.previewInventoryAccounting.mockResolvedValue({ ok: true, report: { ...report, status: "posted", can_post: false, selected_rows: 1, evidence: {
    rows: [{ status: "posted", code: "SKU-FIKTIF", payload: { item_id: "item-a", warehouse_id: "warehouse-a", base_qty: "2", base_unit_cost: "100" } }],
    source_layers: [{ item_id: "item-a", warehouse_id: "warehouse-a", qty_in: "1", unit_cost: "100" }],
    source_moves: [{ item_id: "item-a", warehouse_id: "warehouse-a", qty: "2", unit_cost: "100" }],
  } } });
  await preview();
  expect(container.querySelector('[aria-label="Rekonsiliasi per barang dan gudang"]')?.textContent).toContain("Selisih");
  expect(button("Posting stok + jurnal cabang")).toBeUndefined();
});
it("ignores a report response after its equity selection changes",async()=>{
 let resolve!:(v:unknown)=>void;actions.previewInventoryAccounting.mockReturnValue(new Promise(r=>resolve=r));
 await select('Akun ekuitas',equityId);await act(async()=>button('Preview / laporan tanpa posting').click());
 await select('Akun ekuitas','other');await act(async()=>resolve({ok:true,report}));
 expect(container.querySelector('[aria-label="Laporan rekonsiliasi"]')).toBeNull();
});

async function confirmReason() {
  const reason = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Alasan audit"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Dasar ekuitas dikonfirmasi");
    reason.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
}

it("latches a double click on posting into one stock + journal request", async () => {
  await preview(); await confirmReason();
  let resolve!: (value: unknown) => void;
  actions.postInventoryAccounting.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await act(async () => { const post = button("Posting stok + jurnal cabang"); post.click(); post.click(); });
  await act(async () => resolve({ ok: true, receipt: { entry_id: "journal" } }));
  expect(actions.postInventoryAccounting).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Bukti posting batch tersimpan");
});

it("resolves an ambiguous posting by reading the saved receipt instead of posting again", async () => {
  await preview(); await confirmReason();
  actions.postInventoryAccounting.mockRejectedValueOnce(new Error("Lost response"));
  await act(async () => button("Posting stok + jurnal cabang").click());
  expect(container.textContent).not.toContain("Bukti posting batch tersimpan");
  actions.previewInventoryAccounting.mockResolvedValueOnce({ ok: true, report: { ...report, status: "posted", can_post: false, receipt: { entry_id: "journal-saved" } } });
  await act(async () => button("Periksa hasil batch").click());
  expect(actions.postInventoryAccounting).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("journal-saved");
  expect(container.textContent).toContain("Bukti posting batch tersimpan");
  expect(Array.from(container.querySelectorAll("button")).some(item => item.textContent?.includes("Posting stok + jurnal"))).toBe(false);
});

it("labels saved batches by stage instead of a raw database status", () => {
  const option = container.querySelector<HTMLSelectElement>('select[aria-label="Batch Accurate"]')!.options[1];
  expect(option.textContent).toContain("menunggu review OWNER");
  expect(option.textContent).not.toContain("previewed");
});
