// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/pembelian/actions", () => ({ buatPO: vi.fn(), recoverPurchaseSubmission: vi.fn() }));
import { POForm } from "@/app/(app)/pembelian/baru/POForm";
const units = [{ unit: "pcs", factor: 1, buy_price: 2.75, sell_price: 5 }, { unit: "box", factor: 12, buy_price: 33, sell_price: 60 }];
const items = [{ id: "item-a", code: "AA", name: "Same medicine", unit: "pcs", buy_price: 2.75, units }, { id: "item-b", code: "BB", name: "Same medicine", unit: "pcs", buy_price: 2.75, units }];
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = () => act(async () => root.render(<POForm userId="owner" suppliers={[]} warehouses={[]} branches={[]} items={items} />));
const payload = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="items"]')!.value)[0];
async function input(control: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value); control.dispatchEvent(new Event("input", { bubbles: true })); });
}
it("chooses a duplicate-name SKU by explicit code/ID, with separate visible name, same quantity/unit/factor and draft key", async () => {
  await render();
  const picker = host.querySelector<HTMLInputElement>('[aria-label="Barang PO 1"]');
  expect(picker).not.toBeNull();
  await input(host.querySelector<HTMLInputElement>('input[title="Qty"]')!, "3");
  const key = host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value;
  await input(picker!, "BB");
  const option = document.querySelector<HTMLButtonElement>('[role="option"]')!;
  expect(option.textContent).toContain("Same medicine"); expect(option.textContent).toContain("BB");
  await act(async () => option.click());
  expect(picker!.value).toBe("Same medicine");
  expect(payload()).toMatchObject({ item_id: "item-b", nama: "Same medicine", qty: 3, harga_beli: 2.75, satuan: "pcs", faktor: 1 });
  const unit = host.querySelector<HTMLSelectElement>('select[title="Satuan beli"]')!;
  await act(async () => { unit.value = "box"; unit.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(payload()).toMatchObject({ item_id: "item-b", qty: 3, harga_beli: 33, satuan: "box", faktor: 12 });
  expect(host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value).toBe(key);
  await input(picker!, "Same");
  await input(picker!, "Same medicine");
  expect(payload()).toMatchObject({ item_id: null, nama: "Same medicine", qty: 3 });
});
it("renders a recognized legacy draft label as a name without rewriting its stored snapshot or retry identity", async () => {
  const row = { nama: "AA — Same medicine", item_id: "item-a", qty: 3, harga_beli: 12.75, satuan: "box", faktor: 12 };
  sessionStorage.setItem("vetos:purchase-request:po-create", "legacy-key");
  sessionStorage.setItem("vetos:transaction-draft:v1:owner:purchase:po-create", JSON.stringify({ version: 1, savedAt: Date.now(), requestKey: "legacy-key", fields: {}, snapshot: { rows: [row] } }));
  await render();
  expect(host.querySelector<HTMLInputElement>('[aria-label="Barang PO 1"]')?.value).toBe("Same medicine");
  expect(payload()).toEqual(row); expect(host.querySelector<HTMLInputElement>('input[name="request_key"]')!.value).toBe("legacy-key");
});
