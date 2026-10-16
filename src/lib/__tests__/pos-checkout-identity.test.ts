import { expect, it } from "vitest";
import { posCheckoutIdentity } from "../pos-checkout-identity";

function form(itemId: string | null = "item") {
  const value = new FormData();
  value.set("checkout_key", "stable-posting-key");
  value.set("cart", JSON.stringify([{ item_id: itemId, nama: "Pakan", harga: 100000, qty: 1, satuan: "pcs" }]));
  value.set("metode", "Split"); value.set("bayar", "20000");
  value.set("split_payments", '[{"method":"Tunai","amount":20000},{"method":"Transfer","amount":80000}]');
  return value;
}

it("keeps the same posting intent when catalog descriptions/prices refresh", () => {
  const before = form(); const after = form();
  after.set("cart", JSON.stringify([{ satuan: "pcs", qty: 1, item_id: "item", nama: "Pakan baru", harga: 120000, target_species: "Kucing" }]));
  expect(posCheckoutIdentity(after, "branch")).toEqual(posCheckoutIdentity(before, "branch"));
});

it("distinguishes changed manual prices, quantities, buyers and payment allocations", () => {
  const before = form(null); const fingerprint = posCheckoutIdentity(before, "branch").fingerprint;
  const manual = form(null); manual.set("cart", '[{"item_id":null,"nama":"Pakan","harga":120000,"qty":1,"satuan":"pcs"}]');
  expect(posCheckoutIdentity(manual, "branch").fingerprint).not.toBe(fingerprint);
  const buyer = form(null); buyer.set("customerId", "other");
  expect(posCheckoutIdentity(buyer, "branch").fingerprint).not.toBe(fingerprint);
  const pay = form(null); pay.set("split_payments", '[{"method":"Tunai","amount":30000},{"method":"Transfer","amount":70000}]');
  expect(posCheckoutIdentity(pay, "branch").fingerprint).not.toBe(fingerprint);
});

it("requires a persistent, bounded checkout key", () => {
  const input = form(); input.delete("checkout_key");
  expect(() => posCheckoutIdentity(input, "branch")).toThrow(/Identitas/);
  input.set("checkout_key", "x".repeat(121));
  expect(() => posCheckoutIdentity(input, "branch")).toThrow(/Identitas/);
});

it("preserves raw points and percentage-discount intent when committed balances/catalog totals refresh", () => {
  const before = form(); before.set("checkout_poin_requested", "100"); before.set("poinDigunakan", "100");
  before.set("checkout_diskon_requested", "10"); before.set("checkout_diskon_pct", "1"); before.set("diskon", "10000");
  const after = form(); after.set("checkout_poin_requested", "100"); after.set("poinDigunakan", "0");
  after.set("checkout_diskon_requested", "10"); after.set("checkout_diskon_pct", "1"); after.set("diskon", "12000");
  expect(posCheckoutIdentity(after, "branch")).toEqual(posCheckoutIdentity(before, "branch"));
});

it("includes merchant rate in intent without changing historical zero-fee identity", () => {
  const input = form(); input.set("metode", "Debit"); input.set("split_payments", "[]");
  const old = posCheckoutIdentity(input, "branch");
  input.set("merchant_fee_percent", "0");
  expect(posCheckoutIdentity(input, "branch")).toEqual(old);
  input.set("merchant_fee_percent", "2");
  expect(posCheckoutIdentity(input, "branch").fingerprint).not.toBe(old.fingerprint);
});
