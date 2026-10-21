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
const accounts = [{ id: equityId, code: "3101", name: "Modal" }, { id: "other", code: "3102", name: "Ekuitas lain" }];
const report = {
  run_id: runId, status: "previewed", source_name: "initial.xlsx", source_hash: "sha256-source",
  branch_id: "branch", branch_name: "PDRY", warehouse_id: "warehouse", warehouse_name: "Gudang PDRY", as_of: "2026-09-01",
  selected_rows: 2, excluded_rows: 1, original_qty: 3, original_value: 150000, remaining_value: 50000,
  inventory_account: { id: "inventory", code: "1301", name: "Persediaan" }, equity_account: accounts[0],
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
