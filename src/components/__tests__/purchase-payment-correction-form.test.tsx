// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/pembelian/faktur/[id]/actions", () => ({ batalkanPembayaranFaktur: vi.fn() }));
vi.mock("@/app/(app)/pembelian/faktur/actions", () => ({ bayarFaktur: vi.fn() }));
import { PaymentCorrectionForm } from "@/app/(app)/pembelian/faktur/[id]/PaymentCorrectionForm";
import { PurchasePaymentForm } from "@/components/PurchasePaymentForm";
let root: Root; let host: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("retains cancellation identity after draft expiry and explains grouped reversal", async () => {
  const render = async () => act(async () => root.render(<PaymentCorrectionForm userId="owner" invoiceId="invoice" paymentId="payment" revision={0} grouped />));
  await render();
  const key = host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;
  sessionStorage.setItem("vetos:transaction-draft:v1:owner:transaction:purchase-payment-cancel:payment:0", JSON.stringify({ version: 1, savedAt: 1, requestKey: key, fields: {}, snapshot: {} }));
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value).toBe(key);
  expect(host.textContent).toContain("Seluruh pembayaran");
  expect(host.querySelectorAll("button")).toHaveLength(3);
  expect(host.querySelector<HTMLInputElement>('input[name="alasan"]')!.required).toBe(true);
});
it("revalidates replacement defaults against current debt and available advances", async () => {
  await act(async () => root.render(<PurchasePaymentForm userId="owner" invoiceId="invoice" remaining={75} today="2026-10-21" accounts={[]} advances={[{ id: "available", no_um: "UM-1", sisa: 20 }]} replacement={{ id: "cancelled-payment", amount: 100, metode: "Tunai", advance_id: "spent" }} />));
  expect(host.querySelector<HTMLInputElement>('input[name="amount"]')!.value).toBe("75");
  expect(host.querySelector<HTMLSelectElement>('select[name="advance_id"]')!.value).toBe("");
  expect(host.querySelector<HTMLSelectElement>('select[name="metode"]')!.value).toBe("Tunai");
  expect(host.querySelector<HTMLInputElement>('input[name="replaces_payment_id"]')!.value).toBe("cancelled-payment");
  expect(host.querySelector<HTMLInputElement>('input[name="draft_scope"]')!.value).toBe("payable-replacement:cancelled-payment");
});
