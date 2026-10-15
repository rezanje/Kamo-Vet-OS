// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KASIR_DRAFT_KEY, type KasirDraft } from "@/lib/pos-draft";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/kasir/checkout", () => ({ checkoutKasir: vi.fn() }));
vi.mock("@/app/kasir/actions", () => ({ tambahCustomerKasir: vi.fn() }));
import { KasirClient } from "@/app/kasir/KasirClient";
import { ClearKasirDraft } from "@/components/ClearKasirDraft";

let host: HTMLDivElement;
let root: Root;
const context = "cashier:branch:shift";
const storageKey = `${KASIR_DRAFT_KEY}:${context}`;
const saved = () => ({
  version: 1, savedAt: Date.now(), checkoutKey: "completed-checkout", customerId: "customer", salespersonId: "seller",
  metode: "Debit", diskon: 1000, diskonPct: false, poin: 1, voucher: "PROMO", bayar: 50000,
  cart: [{ item_id: "item", nama: "Pakan", qty: 1, harga: 15000 }],
});
const props = {
  branchName: "Cabang Uji", draftContext: context, shiftId: "shift", hariIni: "2026-10-15", vouchers: [],
  items: [{ id: "item", code: "SKU", name: "Pakan", itemType: "Persediaan" as const, harga: 15000, kategori: "Pakan", stok: 10 }],
  customers: [{ id: "customer", name: "Alfi", phone: "08123456789", points: 15, tier: null, kategori: "Umum", trx: 1, belanja: 15000 }],
  salespeople: [{ id: "seller", nama: "Andri", jabatan: "Kasir" }],
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(element: React.ReactNode) {
  await act(async () => { root.render(element); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}
const hidden = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

it("clears the completed checkout's scoped draft and opens the next cashier transaction completely blank", async () => {
  sessionStorage.setItem(storageKey, JSON.stringify(saved()));
  await render(<ClearKasirDraft {...{ draftContext: context, checkoutKey: "completed-checkout" }} />);
  expect(sessionStorage.getItem(storageKey)).toBeNull();
  await render(<KasirClient {...props} />);
  for (const name of ["customerId", "salespersonId", "metode", "voucherCode"]) expect(hidden(name)).toBe("");
  for (const name of ["diskon", "poinDigunakan", "bayar"]) expect(hidden(name)).toBe("0");
  expect(JSON.parse(hidden("cart")!)).toEqual([]);
});

it("preserves an unfinished checkout including customer, discounts and payment after a failed save", async () => {
  sessionStorage.setItem(storageKey, JSON.stringify(saved()));
  await render(<KasirClient {...props} error="Pembayaran belum tersimpan" />);
  expect(hidden("customerId")).toBe("customer");
  expect(hidden("salespersonId")).toBe("seller");
  expect(hidden("metode")).toBe("Debit");
  expect(hidden("diskon")).toBe("1000");
  expect(JSON.parse(hidden("cart")!)).toHaveLength(1);
  expect(hidden("checkout_key")).toBe("completed-checkout");
});

it("does not discard a newer pending transaction when an old receipt is reopened", async () => {
  sessionStorage.setItem(storageKey, JSON.stringify({ ...saved(), checkoutKey: "new-pending-checkout" }));
  await render(<ClearKasirDraft {...{ draftContext: context, checkoutKey: "completed-checkout" }} />);
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toMatchObject({ checkoutKey: "new-pending-checkout" });
});

it("keeps other users and shifts intact when clearing the confirmed checkout", async () => {
  const otherKey = `${KASIR_DRAFT_KEY}:other-cashier:other-branch:other-shift`;
  sessionStorage.setItem(storageKey, JSON.stringify(saved()));
  sessionStorage.setItem(otherKey, JSON.stringify(saved()));
  await render(<ClearKasirDraft {...{ draftContext: context, checkoutKey: "completed-checkout" }} />);
  expect(sessionStorage.getItem(storageKey)).toBeNull();
  expect(sessionStorage.getItem(otherKey)).not.toBeNull();
});

it("preserves the draft when opening a receipt without a completed checkout acknowledgement", async () => {
  sessionStorage.setItem(storageKey, JSON.stringify(saved()));
  await render(<ClearKasirDraft {...{ draftContext: context }} />);
  expect(sessionStorage.getItem(storageKey)).not.toBeNull();
});

it("creates a fresh checkout identity for a new transaction and stores it with the cart", async () => {
  await render(<KasirClient {...props} />);
  const key = hidden("checkout_key");
  expect(key).toMatch(/^[0-9a-f-]{36}$/i);
  const add = host.querySelector<HTMLButtonElement>('button[title="Tambah"]') ?? host.querySelector<HTMLButtonElement>("button.kpos-addbtn");
  const row = [...host.querySelectorAll("tbody tr")].find(row => row.textContent?.includes("Pakan"))!;
  await act(async () => { (add ?? row.querySelector("button")!).click(); });
  expect(JSON.parse(sessionStorage.getItem(storageKey)!) as KasirDraft).toMatchObject({ checkoutKey: key });
});

it("keeps the active checkout identity when the server refreshes the catalogue or customer choices", async () => {
  await render(<KasirClient {...props} />);
  const key = hidden("checkout_key");
  await render(<KasirClient {...props} customers={[...props.customers]} items={[...props.items]} />);
  expect(hidden("checkout_key")).toBe(key);
});
