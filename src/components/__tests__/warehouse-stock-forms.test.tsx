// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/pembelian/actions", () => ({ buatPO: vi.fn(), recoverPurchaseSubmission: vi.fn() }));
vi.mock("@/app/(app)/pos/pemindahan/actions", () => ({ buatKirim: vi.fn() }));
import { POForm } from "@/app/(app)/pembelian/baru/POForm";
import { PemindahanForm } from "@/app/(app)/pos/pemindahan/baru/PemindahanForm";
const warehouses = [{ id: "a", name: "Gudang A" }, { id: "b", name: "Gudang B" }];
const units = [{ unit: "pcs", factor: 1, buy_price: 100, sell_price: 200 }, { unit: "box", factor: 10, buy_price: 1000, sell_price: 2000 }];
const items = [{ id: "item", code: "OBAT", name: "Obat", unit: "pcs", buy_price: 100, units }];
const stock = [{ id: "s1", warehouse_id: "a", item_id: "item", qty: 25 }, { id: "s2", warehouse_id: "b", item_id: "item", qty: 4 }];
let root: Root; let host: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function change(control: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
it.each(["po", "transfer"])("shows %s stock in selected warehouse and chosen unit, including zero stock", async kind => {
  await act(async () => root.render(kind === "po"
    ? <POForm userId="owner" suppliers={[]} warehouses={warehouses} branches={[]} items={items} stock={stock} />
    : <PemindahanForm userId="owner" warehouses={warehouses} items={items} stock={stock} />));
  await change(host.querySelector<HTMLInputElement>(kind === "po" ? '[aria-label="Barang PO 1"]' : '[aria-label="Barang pemindahan 1"]')!, "OBAT — Obat");
  expect(host.textContent).toContain("Pilih gudang untuk melihat stok");
  const warehouse = host.querySelector<HTMLSelectElement>(`select[name="${kind === "po" ? "to" : "from"}_warehouse_id"]`)!;
  await change(warehouse, "a");
  expect(host.textContent).toContain("Stok tersedia: 25 pcs");
  const unit = host.querySelector<HTMLSelectElement>(kind === "po" ? 'select[title="Satuan beli"]' : 'select[aria-label="Satuan barang"]')!;
  await change(unit, "box");
  expect(host.textContent).toContain("2,5 box");
  expect(host.textContent).toContain("25 pcs");
  await change(warehouse, "b");
  expect(host.textContent).toContain("0,4 box");
  expect(host.textContent).not.toContain("25 pcs");
  await act(async () => root.render(kind === "po"
    ? <POForm userId="owner" suppliers={[]} warehouses={warehouses} branches={[]} items={items} stock={[]} />
    : <PemindahanForm userId="owner" warehouses={warehouses} items={items} stock={[]} />));
  expect(host.textContent).toContain("Stok tersedia: 0 box");
});
it.each(["po", "transfer"])("restores selected warehouse stock for an existing %s draft", async kind => {
  const requestKey = "existing-key";
  const domain = kind === "po" ? "purchase" : "transaction";
  const scope = kind === "po" ? "po-create" : "pos:pemindahan:baru";
  const fieldName = kind === "po" ? "to_warehouse_id" : "from_warehouse_id";
  const rows = kind === "po" ? [{ nama: "OBAT — Obat", item_id: "item", qty: 1, harga_beli: 100, satuan: "pcs", faktor: 1 }] : [{ display: "OBAT — Obat", item_id: "item", qty: 1, satuan: "pcs" }];
  if (kind === "po") sessionStorage.setItem("vetos:purchase-request:po-create", requestKey);
  sessionStorage.setItem(`vetos:transaction-draft:v1:owner:${domain}:${scope}`, JSON.stringify({ version: 1, savedAt: Date.now(), requestKey, fields: { [fieldName]: "a" }, snapshot: { rows, requestKey } }));
  await act(async () => root.render(kind === "po"
    ? <POForm userId="owner" suppliers={[]} warehouses={warehouses} branches={[]} items={items} stock={stock} />
    : <PemindahanForm userId="owner" warehouses={warehouses} items={items} stock={stock} />));
  expect(host.querySelector<HTMLSelectElement>(`select[name="${fieldName}"]`)!.value).toBe("a");
  expect(host.textContent).toContain("Stok tersedia: 25 pcs");
});
it("does not show warehouse stock for a non-stock purchase item", async () => {
  await act(async () => root.render(<POForm userId="owner" suppliers={[]} warehouses={warehouses} branches={[]} items={[{ ...items[0], item_type: "Grup" }]} stock={stock} />));
  await change(host.querySelector<HTMLInputElement>('[aria-label="Barang PO 1"]')!, "OBAT — Obat");
  await change(host.querySelector<HTMLSelectElement>('select[name="to_warehouse_id"]')!, "a");
  expect(host.textContent).not.toContain("Stok tersedia");
});
