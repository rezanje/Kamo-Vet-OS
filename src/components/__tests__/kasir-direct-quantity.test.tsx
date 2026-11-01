// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KASIR_DRAFT_KEY } from "@/lib/pos-draft";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/kasir/checkout", () => ({ checkoutKasir: vi.fn() }));
vi.mock("@/app/kasir/actions", async () => (await import("./helpers/kasir-actions-mock")).kasirActionsMock);
import { KasirClient, type ItemRow } from "@/app/kasir/KasirClient";

let host: HTMLDivElement, root: Root;
const item: ItemRow = { id: "item", code: "SKU", name: "Pakan", itemType: "Persediaan", harga: 10000, kategori: "Pakan", stok: 5, minJual: 2,
  satuan: [{ unit: "pcs", factor: 1, sell_price: 10000, buy_price: 5000 }, { unit: "box", factor: 12, sell_price: 120000, buy_price: 60000 }],
  tiers: [{ min_qty: 10, harga: 9000 }], diskonDefault: 10 };
const cart = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="cart"]')!.value);
const qty = () => {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Jumlah Pakan (pcs)"]');
  expect(input, "cart quantity should be directly editable").not.toBeNull();
  return input!;
};
async function edit(value: string) {
  const input = qty();
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<KasirClient branchName="PDRY fiktif" items={[item]} vouchers={[]} hariIni="2026-10-21" draftContext="qty-test" />));
  await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Tambah"]')!.click());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("types an absolute quantity and recalculates tier pricing, item discount and stored cart", async () => {
  await edit("12");
  expect(cart()[0]).toMatchObject({ qty: 12, harga: 9000, item_discount_type: "percent", item_discount_value: 10 });
  expect(qty().closest("tr")!.textContent).toContain("97.200");
  expect(JSON.parse(sessionStorage.getItem(`${KASIR_DRAFT_KEY}:qty-test`)!).cart[0].qty).toBe(12);
  await edit("2");
  expect(cart()[0]).toMatchObject({ qty: 2, harga: 10000 });
  expect(qty().closest("tr")!.textContent).toContain("18.000");
});

it("keeps fractional quantity precision and existing nonblocking stock warning", async () => {
  await edit("0.3333");
  expect(qty().step).toBe("any");
  expect(cart()[0].qty).toBe(0.3333);
  await edit("6.25");
  expect(cart()[0].qty).toBe(6.25);
  expect(host.textContent).toContain("Stok sistem tidak cukup");
});

it.each(["", "0", "-2", "abc", "1e309", "1e20"])("keeps last valid cart quantity for invalid input %j and restores it on blur", async value => {
  await edit("2"); await edit(value);
  expect(cart()[0].qty).toBe(2);
  expect(JSON.parse(sessionStorage.getItem(`${KASIR_DRAFT_KEY}:qty-test`)!).cart[0].qty).toBe(2);
  expect(qty().checkValidity()).toBe(false);
  await act(async () => qty().blur());
  expect(qty().value).toBe("2");
  expect(qty().checkValidity()).toBe(true);
});

it("retains plus/minus behavior and prevents Enter from checking out", async () => {
  await edit("2.5");
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => qty().dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  const buttons = qty().closest("td")!.querySelectorAll<HTMLButtonElement>("button");
  await act(async () => buttons[1].click()); expect(cart()[0].qty).toBe(3.5); expect(qty().value).toBe("3.5");
  await act(async () => buttons[0].click()); expect(cart()[0].qty).toBe(2.5);
});

it("retains minimum-sale feedback and minus-to-remove behavior", async () => {
  await edit("0.5");
  expect(host.textContent).toContain("Pakan (min 2)");
  const minus = qty().closest("td")!.querySelector<HTMLButtonElement>("button")!;
  await act(async () => minus.click());
  expect(cart()).toEqual([]);
});

it("keeps selected unit factors and isolates item-unit row identity", async () => {
  await edit("2");
  const unit = qty().closest("tr")!.querySelector<HTMLSelectElement>("select")!;
  await act(async () => { unit.value = "box"; unit.dispatchEvent(new Event("change", { bubbles: true })); });
  const box = host.querySelector<HTMLInputElement>('input[aria-label="Jumlah Pakan (box)"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, "0.5"); box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(cart()[0]).toMatchObject({ qty: 0.5, satuan: "box", faktor: 12, harga: 120000 });
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Tambah"]')!.click());
  await edit("3");
  expect(cart()).toEqual(expect.arrayContaining([
    expect.objectContaining({ qty: 0.5, satuan: "box", faktor: 12 }),
    expect.objectContaining({ qty: 3, satuan: "pcs", faktor: 1 }),
  ]));
});
