// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/pembelian/actions", () => ({ closeRemainingPO: vi.fn() }));
import { POShortCloseForm } from "@/app/(app)/pembelian/[id]/POShortCloseForm";
import { TransactionDraft, transactionDraftName } from "@/components/TransactionDraft";

const scope = "purchase-order-short-close:po";
const draftName = transactionDraftName("owner", "transaction", scope);
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(received = 5) {
  await act(async () => root.render(<POShortCloseForm userId="owner" poId="po" rows={[{ id: "line", qty: 10, qty_terima: received, qty_rusak: 0, satuan: "pcs", faktor: 1 }]} />));
}
const checkbox = () => host.querySelector<HTMLInputElement>('input[name="confirmed"]')!;
const closeButton = () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Tutup sisa penerimaan")!;

it("restores a legacy checked draft as visibly unconfirmed and requires a fresh confirmation against current rows", async () => {
  sessionStorage.setItem(draftName, JSON.stringify({ version: 1, savedAt: Date.now(), requestKey: "same-request", fields: { reason: "Supplier cannot supply remainder", "confirmed:1": "true" }, snapshot: { reason: "Supplier cannot supply remainder" } }));
  await render(6);
  expect(host.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!.value).toBe("Supplier cannot supply remainder");
  expect(checkbox().checked).toBe(false);
  expect(closeButton().disabled).toBe(true);
  expect(new FormData(host.querySelector("form")!).get("confirmed")).toBeNull();
  await act(async () => checkbox().click());
  expect(checkbox().checked).toBe(true);
  expect(closeButton().disabled).toBe(false);
  const payload = new FormData(host.querySelector("form")!);
  expect(payload.get("confirmed")).toBe("1");
  expect(payload.get("requestKey")).toBe("same-request");
  expect(JSON.parse(String(payload.get("expected_rows")))[0].qty_terima).toBe(6);
  await act(async () => checkbox().click());
  expect(checkbox().checked).toBe(false);
  expect(closeButton().disabled).toBe(true);
});

it("retains reason and retry identity across reload but never carries forward confirmation", async () => {
  await render();
  const reason = host.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Supplier unavailable");
    reason.dispatchEvent(new Event("input", { bubbles: true }));
    checkbox().click();
  });
  expect(closeButton().disabled).toBe(false);
  const key = new FormData(host.querySelector("form")!).get("requestKey");
  await act(async () => root.unmount()); root = createRoot(host);
  await render();
  expect(host.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!.value).toBe("Supplier unavailable");
  expect(new FormData(host.querySelector("form")!).get("requestKey")).toBe(key);
  expect(checkbox().checked).toBe(false);
  expect(closeButton().disabled).toBe(true);
  await act(async () => checkbox().click());
  expect(closeButton().disabled).toBe(false);
});

it("preserves ordinary checkbox draft restoration when the control has not opted out", async () => {
  sessionStorage.setItem(transactionDraftName("owner", "transaction", "ordinary"), JSON.stringify({ version: 1, savedAt: Date.now(), requestKey: "ordinary-key", fields: { "remember:on": "true" }, snapshot: {} }));
  await act(async () => root.render(<form><TransactionDraft userId="owner" domain="transaction" scope="ordinary" requestKey="ordinary-key" /><input type="checkbox" name="remember" /></form>));
  expect(host.querySelector<HTMLInputElement>('input[name="remember"]')!.checked).toBe(true);
});
