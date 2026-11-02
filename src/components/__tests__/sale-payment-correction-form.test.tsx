// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ action: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/penjualan/[id]/actions", () => ({ koreksiMetodePembayaran: fixture.action }));
import { SalePaymentCorrectionForm } from "@/app/(app)/penjualan/[id]/SalePaymentCorrectionForm";

let root: Root; let host: HTMLDivElement;
const saleId = "11111111-1111-1111-1111-111111111111";
const render = async () => act(async () => root.render(
  <SalePaymentCorrectionForm userId="kasir" saleId={saleId} revision={0} cash={11000} transfer={0} fixed={[]} />));
const field = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const button = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const type = async (name: string, value: string) => act(async () => {
  const input = field(name); input.value = value; input.dispatchEvent(new Event("input", { bubbles: true }));
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); fixture.action.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("fills the other side when the cashier moves the whole bill to Transfer", async () => {
  await render();
  expect(button().disabled).toBe(true);
  await type("transfer", "11000");
  expect(field("tunai").value).toBe("0");
  expect(button().disabled).toBe(false);
});

it("treats a cleared Tunai box as zero instead of silently blocking save", async () => {
  await render();
  await type("tunai", "");
  expect(field("transfer").value).toBe("11000");
  expect(button().disabled).toBe(false);
  await type("transfer", "11000");
  expect(button().disabled).toBe(false);
});

it("explains why save stays disabled", async () => {
  await render();
  expect(host.textContent).toContain("masih sama dengan semula");
  await type("tunai", "20000");
  expect(host.textContent).toContain("harus Rp 11.000");
  expect(button().disabled).toBe(true);
});

it("validates the numbers shown after a restored draft", async () => {
  await render();
  const key = field("draft_key").value;
  sessionStorage.setItem(`vetos:transaction-draft:v1:kasir:transaction:sale-payment:${saleId}:0`, JSON.stringify({
    version: 1, savedAt: Date.now(), requestKey: key,
    fields: { tunai: "", transfer: "11000", alasan: "salah payment" }, snapshot: {},
  }));
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(host.textContent).toContain("Draf dipulihkan");
  expect(field("transfer").value).toBe("11000");
  expect(button().disabled).toBe(false);
});
