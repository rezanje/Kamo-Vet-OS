// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/kasir/checkout", () => ({ checkoutKasir: vi.fn() }));
vi.mock("@/app/kasir/actions", () => ({ tambahCustomerKasir: vi.fn() }));
import { KasirClient, type ItemRow } from "@/app/kasir/KasirClient";

// 2 Nov: a cashier screen opened before a price change kept the old price in the cart while
// the server charged the new one. A fresh catalog from the server now re-prices the cart.
let host: HTMLDivElement, root: Root;
const item = (harga: number, box = 120000): ItemRow => ({ id: "item", code: "SKU", name: "Pakan", itemType: "Persediaan", harga, kategori: "Pakan", stok: 50,
  satuan: [{ unit: "pcs", factor: 1, sell_price: harga, buy_price: 5000 }, { unit: "box", factor: 12, sell_price: box, buy_price: 60000 }] });
const render = (items: ItemRow[]) => act(async () => root.render(
  <KasirClient branchName="Cabang fiktif" items={items} customers={[]} vouchers={[]} hariIni="2026-11-02" draftContext="harga-test" />));
const cart = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="cart"]')!.value);
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render([item(10000)]);
  await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Tambah"]')!.click());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("re-prices an existing cart line when the server sends a newer catalog, and says so", async () => {
  expect(cart()[0]).toMatchObject({ harga: 10000, satuan: "pcs" });
  await render([item(12500)]);
  expect(cart()[0]).toMatchObject({ harga: 12500, satuan: "pcs", qty: 1 });
  expect(host.textContent).toContain("Harga diperbarui mengikuti master: Pakan Rp 10.000 → Rp 12.500");
});

it("keeps the cart untouched and silent when prices did not change", async () => {
  await render([item(10000)]);
  expect(cart()[0]).toMatchObject({ harga: 10000 });
  expect(host.textContent).not.toContain("Harga diperbarui");
});
