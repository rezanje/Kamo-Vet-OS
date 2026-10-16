// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { kasirDraftKey, POS_DRAFT_KEY } from "@/lib/pos-draft";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/kasir/checkout", () => ({ checkoutKasir: vi.fn() }));
vi.mock("@/app/kasir/actions", () => ({ tambahCustomerKasir: vi.fn() }));
vi.mock("@/app/(app)/pos/transaksi/actions", () => ({ checkoutSale: vi.fn() }));
import { KasirClient } from "@/app/kasir/KasirClient";
import { PosClient } from "@/app/(app)/pos/transaksi/PosClient";
import { ClearKasirDraft } from "@/components/ClearKasirDraft";
import { ClearPosDraft } from "@/components/ClearPosDraft";

let host: HTMLDivElement;
let root: Root;
const context = "split-cashier:branch:shift";
const customer = { id: "customer", name: "Alfi", phone: "08123456789", points: 0 };
const kasirProps = {
  branchName: "Cabang Uji", draftContext: context, shiftId: "shift", hariIni: "2026-10-15", vouchers: [],
  items: [{ id: "item", code: "SKU", name: "Pakan", itemType: "Persediaan" as const, harga: 100_000, kategori: "Pakan", stok: 10 }],
  customers: [{ ...customer, tier: null, kategori: "Umum", trx: 1, belanja: 100_000 }],
  salespeople: [{ id: "seller", nama: "Andri", jabatan: "Kasir" }],
};
const posProps = {
  items: [{ id: "item", name: "Pakan", sell_price: 100_000, target_species: "Kucing", units: [{ unit: "pcs", factor: 1, sell_price: 100_000, buy_price: 50_000 }] }],
  customers: [{ ...customer, pets: [], golongan: null }],
  branches: [{ id: "branch", code: "BR", name: "Cabang Uji" }],
  salespeople: kasirProps.salespeople,
};
const parts = [{ method: "Tunai", amount: 20_000 }, { method: "Transfer", amount: 80_000 }];
function seed(kind: "cashier" | "backoffice", extras: Record<string, unknown> = {}) {
  const common = { version: 1, savedAt: Date.now(), customerId: "customer", salespersonId: "seller", metode: "Transfer", bayar: 0 };
  sessionStorage.setItem(kind === "cashier" ? kasirDraftKey(context) : POS_DRAFT_KEY, JSON.stringify(kind === "cashier"
    ? { ...common, checkoutKey: "pending-checkout", diskon: 0, diskonPct: false, poin: 0, voucher: "", cart: [{ item_id: "item", nama: "Pakan", qty: 1, harga: 100_000 }], ...extras }
    : { ...common, branchId: "branch", petId: "", discount: 0, cart: [{ item_id: "item", nama: "Pakan", qty: 1, harga: 100_000, target_species: "Kucing", satuan: "pcs", faktor: 1 }], ...extras }));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(kind: "cashier" | "backoffice", unitPrice?: number) {
  await act(async () => root.render(kind === "cashier"
    ? <KasirClient {...kasirProps} items={unitPrice === undefined ? kasirProps.items : kasirProps.items.map(item => ({ ...item, harga: unitPrice }))} error="Pembayaran belum tersimpan" />
    : <PosClient {...posProps} items={unitPrice === undefined ? posProps.items : posProps.items.map(item => ({ ...item, sell_price: unitPrice, units: item.units.map(unit => ({ ...unit, sell_price: unitPrice })) }))} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}
const hidden = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;
const pay = () => host.querySelector<HTMLButtonElement>("button.kpos-bayar, button.pay-btn")!;
async function toggleSplit() {
  const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Bayar Gabungan"]');
  expect(toggle, "the checkout offers combined payment").not.toBeNull();
  await act(async () => toggle!.click());
}
async function amount(label: string, value: number) {
  const control = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(control, label).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, String(value));
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it.each(["cashier", "backoffice"] as const)("%s submits the exact cash and transfer allocation and only returns cash change", async kind => {
  seed(kind); await render(kind);
  await toggleSplit();
  expect(host.querySelectorAll('select[aria-label^="Metode pembayaran "]')).toHaveLength(2);
  expect(pay().disabled).toBe(true);
  await amount("Nominal pembayaran 1", 20_000);
  await amount("Nominal pembayaran 2", 80_000);
  expect(hidden("metode")).toBe("Split");
  expect(JSON.parse(hidden("split_payments")!)).toEqual(parts);
  expect(hidden("bayar")).toBe("20000");
  expect(pay().disabled).toBe(false);
  await amount("Uang tunai diterima", 50_000);
  expect(hidden("bayar")).toBe("50000");
  expect(host.textContent).toContain("Kembalian tunai");
  expect(host.textContent).toContain("Rp 30.000");
  expect(pay().disabled).toBe(false);
  await amount("Nominal pembayaran 2", 90_000);
  expect(host.textContent).toContain("Kelebihan");
  expect(pay().disabled).toBe(true);
  await amount("Nominal pembayaran 2", 70_000);
  expect(host.textContent).toContain("Sisa");
  expect(pay().disabled).toBe(true);
  await amount("Nominal pembayaran 2", 80_000);
  await amount("Uang tunai diterima", 10_000);
  expect(pay().disabled).toBe(true);
});

it.each(["cashier", "backoffice"] as const)("%s restores pending combined payment including cash tender after failure", async kind => {
  seed(kind, { split: true, payments: parts, bayar: 50_000 });
  await render(kind);
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Bayar Gabungan"]')?.checked).toBe(true);
  expect(JSON.parse(hidden("split_payments")!)).toEqual(parts);
  expect(hidden("bayar")).toBe("50000");
  expect(pay().disabled).toBe(false);
  await amount("Nominal pembayaran 2", 75_000);
  await act(async () => root.unmount()); root = createRoot(host);
  await render(kind);
  expect(JSON.parse(hidden("split_payments")!)[1].amount).toBe(75_000);
  expect(hidden("bayar")).toBe("50000");
  expect(pay().disabled).toBe(true);
});

it.each(["cashier", "backoffice"] as const)("%s rounds fractional quantity and discount totals before validating payment cents", async kind => {
  const payments = [{ method: "Tunai", amount: 10 }, { method: "Transfer", amount: 23.32 }];
  seed(kind, { split: true, payments, bayar: 10, diskon: 0.01, discount: 0.01,
    cart: [{ item_id: "item", nama: "Pakan", qty: 0.3333, harga: 99.99, target_species: "Kucing", satuan: "pcs", faktor: 1 }] });
  await render(kind, 99.99);
  expect(JSON.parse(hidden("split_payments")!)).toEqual(payments);
  expect(host.textContent).toContain("Pembayaran pas");
  expect(pay().disabled).toBe(false);
  expect(pay().textContent).toContain("Rp 33,32");
  expect(host.querySelector<HTMLFormElement>("form")!.checkValidity()).toBe(true);
  await amount("Nominal pembayaran 2", 23.31);
  expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain("Rp 0,01");
  expect(pay().disabled).toBe(true);
});

it.each(["cashier", "backoffice"] as const)("%s rounds a half-cent line like the database before validating the split", async kind => {
  const payments = [{ method: "Tunai", amount: 5_000 }, { method: "Transfer", amount: 5_000.01 }];
  seed(kind, { split: true, payments, bayar: 5_000,
    cart: [{ item_id: "item", nama: "Pakan", qty: 0.5, harga: 20_000.01, target_species: "Kucing", satuan: "pcs", faktor: 1 }] });
  await render(kind, 20_000.01);
  expect(pay().textContent).toContain("Rp 10.000,01");
  expect(pay().disabled).toBe(false);
});

it.each([
  { price: 0.56, requested: 1, used: 0, remaining: "0,56", transfer: 0.46 },
  { price: 1.50, requested: 2, used: 1, remaining: "0,5", transfer: 0.4 },
])("cashier redeems only whole loyalty points from a $price sale", async ({ price, requested, used, remaining, transfer }) => {
  seed("cashier", { split: true, payments: [{ method: "Tunai", amount: 0.1 }, { method: "Transfer", amount: transfer }], bayar: 0.1, poin: requested,
    cart: [{ item_id: "item", nama: "Pakan", qty: 1, harga: price }] });
  await act(async () => root.render(<KasirClient {...kasirProps}
    items={kasirProps.items.map(item => ({ ...item, harga: price }))}
    customers={kasirProps.customers.map(customer => ({ ...customer, points: 10 }))}
  />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(hidden("poinDigunakan")).toBe(String(used));
  expect(pay().textContent).toContain(`Rp ${remaining}`);
  expect(pay().disabled).toBe(false);
  expect(host.querySelector<HTMLFormElement>("form")!.checkValidity()).toBe(true);
});

it("cashier keeps raw point and percentage discount intent stable when loyalty balance changes after a saved payment", async () => {
  seed("cashier", { diskon: 10, diskonPct: true, poin: 50 });
  const renderWithPoints = async (points: number) => {
    await act(async () => root.render(<KasirClient {...kasirProps}
      customers={kasirProps.customers.map(customer => ({ ...customer, points }))} />));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  };
  await renderWithPoints(100);
  expect(hidden("poinDigunakan")).toBe("50");
  expect(hidden("checkout_poin_requested")).toBe("50");
  expect(hidden("checkout_diskon_requested")).toBe("10");
  expect(hidden("checkout_diskon_pct")).toBe("1");
  const checkoutKey = hidden("checkout_key");
  await act(async () => root.unmount()); root = createRoot(host);
  await renderWithPoints(0);
  expect(hidden("poinDigunakan")).toBe("0");
  expect(hidden("checkout_poin_requested")).toBe("50");
  expect(hidden("checkout_diskon_requested")).toBe("10");
  expect(hidden("checkout_diskon_pct")).toBe("1");
  expect(hidden("checkout_key")).toBe(checkoutKey);
});

it.each(["cashier", "backoffice"] as const)("%s adds distinct payment methods and removes cash tender when its row is removed", async kind => {
  seed(kind, { split: true, payments: parts, bayar: 50_000 }); await render(kind);
  const add = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Tambah metode");
  expect(add).toBeDefined();
  await act(async () => add!.click());
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="Metode pembayaran 3"]')?.value).toBe("Debit");
  expect(host.querySelector<HTMLOptionElement>('select[aria-label="Metode pembayaran 3"] option[value="Transfer"]')?.disabled).toBe(true);
  await amount("Nominal pembayaran 2", 70_000); await amount("Nominal pembayaran 3", 10_000);
  expect(pay().disabled).toBe(false);
  const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Hapus pembayaran 1"]')!;
  await act(async () => remove.click());
  expect(host.querySelector('input[aria-label="Uang tunai diterima"]')).toBeNull();
  expect(hidden("bayar")).toBe("0");
  await amount("Nominal pembayaran 1", 90_000);
  expect(pay().disabled).toBe(false);
});

it("backoffice allocates the net total after branch promo and product-specific customer discount", async () => {
  seed("backoffice", { split: true, payments: [{ method: "Tunai", amount: 20_000 }, { method: "Transfer", amount: 45_000 }], bayar: 20_000 });
  await act(async () => root.render(<PosClient {...posProps}
    branches={[...posProps.branches, { id: "other-branch", code: "OTHER", name: "Cabang Lain" }]}
    customers={[{ ...posProps.customers[0], golonganId: "member", golongan: { nama: "Member", diskon_persen: 10, rupiah_per_poin: 500 } }]}
    promoPerCabang={{ branch: [{ id: "promo", name: "Promo Pakan", itemIds: ["item"], minQty: 1, maxQty: null, kelipatan: false, autoApply: true, discountType: "nominal", discountValue: 10_000 }] }}
    aturanDiskon={{ member: [{ item_id: "item", item_category_id: null, diskon_persen: 25 }] }}
    infoBarang={{ item: { item_id: "item", category_id: "food", parent_category_id: null } }}
  />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(host.textContent).toContain("Promo otomatis");
  expect(pay().textContent).toContain("Rp 65.000");
  expect(pay().disabled).toBe(false);
  expect(host.textContent).toContain("+130 poin");
  const branch = host.querySelector<HTMLSelectElement>("select")!;
  await act(async () => { branch.value = "other-branch"; branch.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.textContent).not.toContain("Promo otomatis");
  expect(pay().textContent).toContain("Rp 75.000");
  expect(pay().disabled).toBe(true);
  await amount("Nominal pembayaran 2", 55_000);
  expect(pay().disabled).toBe(false);
});

it("backoffice retains its posting identity across pending draft reload and catalogue refresh", async () => {
  seed("backoffice", { checkoutKey: "stable-backoffice-checkout", split: true, payments: parts, bayar: 20_000 });
  await render("backoffice");
  expect(hidden("checkout_key")).toBe("stable-backoffice-checkout");
  await amount("Uang tunai diterima", 50_000);
  expect(JSON.parse(sessionStorage.getItem(POS_DRAFT_KEY)!)).toMatchObject({ checkoutKey: "stable-backoffice-checkout", bayar: 50_000 });
  await act(async () => root.unmount()); root = createRoot(host); await render("backoffice");
  expect(hidden("checkout_key")).toBe("stable-backoffice-checkout");
  await act(async () => root.render(<PosClient {...posProps} items={[...posProps.items]} customers={[...posProps.customers]} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(hidden("checkout_key")).toBe("stable-backoffice-checkout");
});

it("backoffice gives a legacy pending draft a posting identity and stores it before checkout", async () => {
  seed("backoffice"); await render("backoffice");
  expect(hidden("checkout_key")).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/i));
  expect(JSON.parse(sessionStorage.getItem(POS_DRAFT_KEY)!)).toMatchObject({ checkoutKey: hidden("checkout_key") });
});

it("offers transfer for a single cashier payment and removes split fields when the toggle is off", async () => {
  seed("cashier"); await render("cashier");
  const transfer = [...host.querySelectorAll("button.kpos-pay")].find(button => button.textContent?.trim() === "Transfer");
  expect(transfer).toBeDefined();
  await toggleSplit();
  await amount("Nominal pembayaran 1", 20_000); await amount("Nominal pembayaran 2", 80_000);
  await toggleSplit();
  expect(hidden("metode")).toBe("Transfer");
  expect(JSON.parse(hidden("split_payments")!)).toEqual([]);
  expect(pay().disabled).toBe(false);
});

it("clears combined payment only with the matching completed cashier receipt", async () => {
  seed("cashier", { split: true, payments: parts, bayar: 50_000 });
  await act(async () => root.render(<ClearKasirDraft draftContext={context} checkoutKey="older-checkout" />));
  expect(sessionStorage.getItem(kasirDraftKey(context))).not.toBeNull();
  await act(async () => root.render(<ClearKasirDraft draftContext={context} checkoutKey="pending-checkout" />));
  expect(sessionStorage.getItem(kasirDraftKey(context))).toBeNull();
  await render("cashier");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Bayar Gabungan"]')?.checked).toBe(false);
  expect(JSON.parse(hidden("split_payments")!)).toEqual([]);
  expect(hidden("bayar")).toBe("0");
});

it.each(["cashier", "backoffice"] as const)("%s adds the non-cash fee to the final bill without changing the base allocation or cash change", async kind => {
  seed(kind, { split: true, payments: [{ method: "Tunai", amount: 20_000 }, { method: "Debit", amount: 80_000, feePercent: 2 }], bayar: 50_000 });
  await render(kind);
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Fee merchant Debit (%)"]')?.value).toBe("2");
  expect(host.querySelector('input[aria-label="Fee merchant Tunai (%)"]')).toBeNull();
  expect(host.textContent).toContain("Fee merchant");
  expect(host.textContent).toContain("Rp 1.600");
  expect(host.textContent).toContain("Diterima Debit");
  expect(host.textContent).toContain("Rp 81.600");
  expect(host.textContent).toContain("Rp 30.000");
  expect(pay().textContent).toContain("Rp 101.600");
  expect(pay().disabled).toBe(false);
  expect(JSON.parse(hidden("split_payments")!)[1]).toEqual({ method: "Debit", amount: 80_000, feePercent: 2 });
  await act(async () => root.unmount()); root = createRoot(host); await render(kind);
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Fee merchant Debit (%)"]')?.value).toBe("2");
  expect(pay().textContent).toContain("Rp 101.600");
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Metode pembayaran 2"]')!;
  await act(async () => { select.value = "QRIS"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Fee merchant QRIS (%)"]')?.value).toBe("0");
  expect(JSON.parse(hidden("split_payments")!)[1]).toEqual({ method: "QRIS", amount: 80_000 });
  expect(pay().textContent).toContain("Rp 100.000");
});

it.each(["cashier", "backoffice"] as const)("%s restores and validates single merchant rates, resets them on method changes and retains failed draft identity", async kind => {
  seed(kind, { metode: "Transfer", merchantFeePercent: 2, checkoutKey: "fee-draft" }); await render(kind);
  expect(hidden("merchant_fee_percent")).toBe("2");
  expect(pay().textContent).toContain("Rp 102.000");
  expect(pay().disabled).toBe(false);
  await amount("Fee merchant Transfer (%)", 1.25);
  expect(pay().textContent).toContain("Rp 101.250");
  await act(async () => root.unmount()); root = createRoot(host); await render(kind);
  expect(hidden("merchant_fee_percent")).toBe("1.25");
  expect(hidden("checkout_key")).toBe("fee-draft");
  await amount("Fee merchant Transfer (%)", 1.234);
  expect(pay().disabled).toBe(true);
  await amount("Fee merchant Transfer (%)", 101);
  expect(pay().disabled).toBe(true);
  const cash = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Tunai")!;
  await act(async () => cash.click());
  expect(hidden("merchant_fee_percent")).toBe("0");
  expect(host.querySelector('input[aria-label="Fee merchant Tunai (%)"]')).toBeNull();
  const transfer = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Transfer")!;
  await act(async () => transfer.click());
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Fee merchant Transfer (%)"]')?.value).toBe("0");
  expect(pay().textContent).toContain("Rp 100.000");
});


it.each(["cashier", "backoffice"] as const)("%s preserves pending fee rates for old receipts and clears them for the exact successful checkout", async kind => {
  const feeParts = [{ method: "Tunai", amount: 20_000 }, { method: "Debit", amount: 80_000, feePercent: 2 }];
  seed(kind, { split: true, payments: feeParts, merchantFeePercent: 1.25, checkoutKey: "pending-fee", bayar: 50_000 });
  const key = kind === "cashier" ? kasirDraftKey(context) : POS_DRAFT_KEY;
  await act(async () => root.render(kind === "cashier"
    ? <ClearKasirDraft draftContext={context} checkoutKey="older" /> : <ClearPosDraft checkoutKey="older" />));
  expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ merchantFeePercent: 1.25, payments: feeParts });
  await act(async () => root.render(kind === "cashier"
    ? <ClearKasirDraft draftContext={context} checkoutKey="pending-fee" /> : <ClearPosDraft checkoutKey="pending-fee" />));
  expect(sessionStorage.getItem(key)).toBeNull();
  await render(kind);
  expect(hidden("merchant_fee_percent")).toBe("0");
  expect(JSON.parse(hidden("split_payments")!)).toEqual([]);
});

it.each(["cashier", "backoffice"] as const)("%s clears hidden single and split rates when changing payment mode", async kind => {
  seed(kind, { merchantFeePercent: 2, metode: "Transfer" }); await render(kind);
  await toggleSplit();
  expect(hidden("merchant_fee_percent")).toBe("0");
  await amount("Nominal pembayaran 1", 20_000); await amount("Nominal pembayaran 2", 80_000);
  await amount("Fee merchant Transfer (%)", 2);
  expect(pay().textContent).toContain("Rp 101.600");
  await toggleSplit();
  expect(hidden("merchant_fee_percent")).toBe("0");
  expect(pay().textContent).toContain("Rp 100.000");
  await toggleSplit();
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Fee merchant Transfer (%)"]')?.value).toBe("0");
});
