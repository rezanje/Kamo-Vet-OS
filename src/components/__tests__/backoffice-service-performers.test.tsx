// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POS_DRAFT_KEY } from "@/lib/pos-draft";
import { posCheckoutIdentity } from "@/lib/pos-checkout-identity";

vi.mock("@/app/(app)/pos/transaksi/actions", () => ({ checkoutSale: vi.fn() }));
import { PosClient } from "@/app/(app)/pos/transaksi/PosClient";

const staff = [{ id: "doctor", nama: "Dokter Uji", jabatan: "Dokter Hewan" }, { id: "staff", nama: "Groomer Uji", jabatan: "Groomer" }];
const units = [{ unit: "pcs", factor: 1, buy_price: 10, sell_price: 100 }];
const items = [
  { id: "service", name: "Grooming", item_type: "Jasa", sell_price: 100, target_species: "Universal", units },
  { id: "food", name: "Pakan", item_type: "Persediaan", sell_price: 100, target_species: "Universal", units },
];
const props = { items, customers: [], branches: [{ id: "branch", code: "BR", name: "Cabang Uji" }, { id: "other", code: "B2", name: "Cabang Lain" }], salespeople: staff,
  serviceStaffByBranch: { branch: staff, other: [{ id: "other-staff", nama: "Staf cabang lain", jabatan: "Groomer" }] } };
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); });
async function render() {
  await act(async () => root.render(<PosClient {...props} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}
async function select(control: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const cart = () => JSON.parse(host.querySelector<HTMLInputElement>('input[name="cart"]')!.value);
async function add(name: string) { await act(async () => [...host.querySelectorAll<HTMLElement>(".pos-p")].find(el => el.textContent?.includes(name))!.click()); }

it("keeps repeated service lines independent while physical products still merge", async () => {
  await render(); await select(host.querySelector("select")!, "branch");
  await add("Grooming"); await add("Grooming"); await add("Pakan"); await add("Pakan");
  expect(cart()).toHaveLength(3);
  expect(new Set(cart().map((row: { row_key: string }) => row.row_key)).size).toBe(3);
  expect(cart().filter((row: { item_id: string }) => row.item_id === "food")[0].qty).toBe(2);
  const serviceRows = host.querySelectorAll<HTMLElement>('[data-service-row]');
  expect(serviceRows).toHaveLength(2);
  await act(async () => serviceRows[1].querySelector<HTMLButtonElement>('[aria-label="Tambah jumlah Grooming"]')!.click());
  expect(cart().slice(0, 2).map((row: { qty: number }) => row.qty)).toEqual([1, 2]);
  await act(async () => serviceRows[0].querySelector<HTMLButtonElement>('[aria-label="Hapus Grooming"]')!.click());
  expect(cart().filter((row: { item_id: string }) => row.item_id === "service")).toHaveLength(1);
  expect(cart()[0].qty).toBe(2);
});

it("fills only empty service rows, preserves explicit overrides and restores exact rows after retry", async () => {
  await render(); await select(host.querySelector("select")!, "branch");
  await add("Grooming"); await add("Grooming"); await add("Pakan");
  const rows = host.querySelectorAll<HTMLElement>('[data-service-row]');
  expect(rows).toHaveLength(2);
  await select(rows[0].querySelectorAll("select")[1], "staff");
  const bulk = host.querySelector<HTMLElement>('[data-service-bulk]')!;
  expect(bulk).not.toBeNull();
  await select(bulk.querySelectorAll("select")[0], "doctor");
  await act(async () => bulk.querySelector<HTMLButtonElement>("button")!.click());
  expect(cart().slice(0, 2).map((row: { service_performers: unknown }) => row.service_performers)).toEqual([
    { doctor_id: null, staff_id: "staff" }, { doctor_id: "doctor", staff_id: null },
  ]);
  expect(cart()[2].service_performers).toBeNull();
  const expected = cart();
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(cart()).toEqual(expected);
  expect(host.querySelector<HTMLInputElement>('[name="salespersonId"]')?.value).toBe("");
  expect(host.textContent).toContain("Pilihan per baris yang sudah diisi tetap dipertahankan");
});

it("switches employee options with the branch and clears former branch attribution", async () => {
  await render(); await select(host.querySelector("select")!, "branch"); await add("Grooming");
  const row = host.querySelector<HTMLElement>('[data-service-row]')!;
  expect(row).not.toBeNull(); await select(row.querySelectorAll("select")[1], "staff");
  await select(host.querySelector("select")!, "other");
  expect(cart()[0].service_performers).toEqual({ doctor_id: null, staff_id: null });
  expect(host.querySelector('[data-service-row]')!.textContent).toContain("Staf cabang lain");
  expect(host.querySelector('[data-service-row]')!.textContent).not.toContain("Groomer Uji");
});

it("restores legacy service draft rows with unique identity and leaves cashier selection unnecessary", async () => {
  sessionStorage.setItem(POS_DRAFT_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), branchId: "branch", metode: "Transfer", cart: [1, 2].map(() => ({ item_id: "service", nama: "Grooming", qty: 1, harga: 100, target_species: "Universal", satuan: "pcs", faktor: 1 })) }));
  await render();
  expect(new Set(cart().map((row: { row_key: string }) => row.row_key)).size).toBe(2);
  expect(host.querySelector<HTMLButtonElement>(".pay-btn")!.disabled).toBe(false);
});

it("changes only the targeted service unit and keeps repeated services separate on changing back", async () => {
  const service = { ...items[0], units: [...units, { unit: "paket", factor: 2, buy_price: 20, sell_price: 180 }] };
  await act(async () => root.render(<PosClient {...props} items={[service]} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  await select(host.querySelector("select")!, "branch"); await add("Grooming"); await add("Grooming");
  const originalKeys = cart().map((row: { row_key: string }) => row.row_key);
  const second = host.querySelectorAll<HTMLElement>('[data-service-row]')[1];
  await select(second.querySelector('select[title="Satuan"]')!, "paket");
  expect(cart().map((row: { satuan: string; harga: number }) => [row.satuan, row.harga])).toEqual([["pcs", 100], ["paket", 180]]);
  await select(second.querySelector('select[title="Satuan"]')!, "pcs");
  expect(cart()).toHaveLength(2); expect(cart().map((row: { row_key: string }) => row.row_key)).toEqual(originalKeys);
});

it.each([
  { minQty: 2, maxQty: null, expected: "Rp 160" },
  { minQty: 1, maxQty: 1, expected: "Rp 180" },
])("preserves minimum/capped promo rules for repeated services: $minQty/$maxQty", async ({ minQty, maxQty, expected }) => {
  sessionStorage.setItem(POS_DRAFT_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), branchId: "branch", metode: "Transfer", cart: [1, 2].map(() => ({ item_id: "service", nama: "Grooming", qty: 1, harga: 100, target_species: "Universal", satuan: "pcs", faktor: 1 })) }));
  await act(async () => root.render(<PosClient {...props} promoPerCabang={{ branch: [{ id: "promo", name: "Promo jasa", itemIds: ["service"], minQty, maxQty, kelipatan: false, autoApply: true, discountType: "percent", discountValue: 20 }] }} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(cart()).toHaveLength(2); expect(host.querySelector(".pay-btn")!.textContent).toContain(expected);
});

it("preserves customer category discount rounding when identical services are separate", async () => {
  const service = { ...items[0], sell_price: 99, units: [{ ...units[0], sell_price: 99 }] };
  sessionStorage.setItem(POS_DRAFT_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), branchId: "branch", customerId: "customer", metode: "Transfer", cart: [1, 2].map(() => ({ item_id: "service", nama: "Grooming", qty: 1, harga: 99, target_species: "Universal", satuan: "pcs", faktor: 1 })) }));
  await act(async () => root.render(<PosClient {...props} items={[service]} customers={[{ id: "customer", name: "Member", phone: "", points: 0, pets: [], golonganId: "category", golongan: { nama: "Member", diskon_persen: 33 } }]} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(cart()).toHaveLength(2); expect(host.querySelector(".pay-btn")!.textContent).toContain("Rp 133");
});

it("retains the pre-deployment draft fingerprint without reintroducing a manual cashier selector", async () => {
  const oldCart = [{ item_id: "service", nama: "Grooming", qty: 1, harga: 100, target_species: "Universal", satuan: "pcs", faktor: 1 }];
  sessionStorage.setItem(POS_DRAFT_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), checkoutKey: "legacy-key", branchId: "branch", salespersonId: "legacy-seller", metode: "Transfer", discount: 0, bayar: 0, cart: oldCart }));
  const baseline = new FormData();
  for (const [key, value] of Object.entries({ checkout_key: "legacy-key", salespersonId: "legacy-seller", metode: "Transfer", split_payments: "[]", cart: JSON.stringify(oldCart) })) baseline.set(key, value);
  const identity = posCheckoutIdentity(baseline, "branch");
  await render();
  expect(posCheckoutIdentity(new FormData(host.querySelector("form")!), "branch")).toEqual(identity);
  expect(host.querySelector<HTMLInputElement>('[name="salespersonId"]')!.type).toBe("hidden");
  expect(JSON.parse(sessionStorage.getItem(POS_DRAFT_KEY)!).salespersonId).toBe("legacy-seller");
});
