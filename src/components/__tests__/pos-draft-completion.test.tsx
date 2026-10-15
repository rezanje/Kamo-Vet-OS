// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POS_DRAFT_KEY } from "@/lib/pos-draft";
import { ClearPosDraft } from "@/components/ClearPosDraft";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("@/components/PrintButton", () => ({ PrintButton: () => null }));
vi.mock("@/lib/sale-payment-reporting", () => ({ receiptPaymentRows: () => [{ label: "Tunai", amount: 100 }] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from(table: string) {
    const data = table === "sales" ? { id: "sale", created_at: "2026-10-15T08:00:00Z", total: 100, customers: null, branches: { name: "Cabang" } } : [];
    const query = { select: () => query, eq: () => query, is: () => query, order: () => query,
      maybeSingle: async () => ({ data }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data }).then(resolve) };
    return query;
  },
}) }));
import PosReceiptPage from "@/app/(app)/pos/struk/[saleId]/page";

let host: HTMLDivElement;
let root: Root;
const pending = () => ({ version: 1, savedAt: Date.now(), checkoutKey: "pending-checkout", branchId: "branch", customerId: "customer", petId: "", salespersonId: "seller",
  metode: "Transfer", split: true, payments: [{ method: "Tunai", amount: 20 }, { method: "Transfer", amount: 80 }], bayar: 50, discount: 0,
  cart: [{ item_id: "item", nama: "Pakan", qty: 1, harga: 100, target_species: "Kucing", satuan: "pcs", faktor: 1 }] });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear(); sessionStorage.setItem(POS_DRAFT_KEY, JSON.stringify(pending()));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it.each([undefined, "older-checkout"])("preserves a newer backoffice draft when receipt acknowledgement is %s", async checkoutKey => {
  await act(async () => root.render(<ClearPosDraft checkoutKey={checkoutKey} />));
  expect(JSON.parse(sessionStorage.getItem(POS_DRAFT_KEY)!)).toMatchObject({ checkoutKey: "pending-checkout" });
});

it("clears only the matching successful backoffice checkout", async () => {
  await act(async () => root.render(<ClearPosDraft checkoutKey="pending-checkout" />));
  expect(sessionStorage.getItem(POS_DRAFT_KEY)).toBeNull();
});

it("keeps the successful receipt usable if browser storage becomes unavailable", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  await expect(act(async () => root.render(<ClearPosDraft checkoutKey="pending-checkout" />))).resolves.toBeUndefined();
});

it("passes the exact success acknowledgement from the backoffice receipt URL to cleanup", async () => {
  const page = await PosReceiptPage({ params: Promise.resolve({ saleId: "sale" }), searchParams: Promise.resolve({ draft_done: "pending-checkout" }) });
  const clear = React.Children.toArray(page.props.children).find(child => React.isValidElement(child) && child.type === ClearPosDraft) as React.ReactElement<{ checkoutKey?: string }>;
  expect(clear.props.checkoutKey).toBe("pending-checkout");
});
