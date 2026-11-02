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
type Props = Partial<React.ComponentProps<typeof SalePaymentCorrectionForm>>;
const render = async (props: Props = {}) => act(async () => root.render(
  <SalePaymentCorrectionForm userId="kasir" saleId={saleId} revision={0} movable={[{ method: "Tunai", amount: 11000 }]} fixed={[]} {...props} />));
const field = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
const button = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const click = async (label: string) => act(async () => {
  [...host.querySelectorAll("button")].find(b => b.textContent === label)!.click();
});
const type = async (name: string, value: string) => act(async () => {
  const input = field(name)!; input.value = value; input.dispatchEvent(new Event("input", { bubbles: true }));
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); fixture.action.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("offers every cashier method, not only Tunai and Transfer", async () => {
  await render();
  for (const m of ["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"]) expect(field(`bayar_${m}`)).not.toBeNull();
  expect(field("bayar_Tunai")!.value).toBe("11000");
});

it("moves the whole bill to QRIS with one tap", async () => {
  await render();
  expect(button().disabled).toBe(true);
  await click("Semua ke QRIS");
  expect(field("bayar_QRIS")!.value).toBe("11000");
  expect(field("bayar_Tunai")!.value).toBe("");
  expect(button().disabled).toBe(false);
});

it("explains why save stays disabled", async () => {
  await render();
  expect(host.textContent).toContain("masih sama dengan semula");
  await type("bayar_Tunai", "5000");
  expect(host.textContent).toContain("Masih kurang Rp 6.000");
  await type("bayar_Debit", "8000");
  expect(host.textContent).toContain("Kelebihan Rp 2.000");
  expect(button().disabled).toBe(true);
  await type("bayar_Debit", "6000");
  expect(button().disabled).toBe(false);
});

it("keeps fee-bearing parts fixed and hides their method", async () => {
  await render({ movable: [{ method: "Tunai", amount: 45000 }], fixed: [{ method: "Kredit", amount: 55000 }] });
  expect(field("bayar_Kredit")).toBeNull();
  expect(host.textContent).toContain("Kredit Rp 55.000");
  expect(host.textContent).toContain("Total yang dibagi: Rp 45.000");
});

it("validates the numbers shown after a restored draft", async () => {
  await render();
  const key = field("draft_key")!.value;
  sessionStorage.setItem(`vetos:transaction-draft:v1:kasir:transaction:sale-payment:${saleId}:0`, JSON.stringify({
    version: 1, savedAt: Date.now(), requestKey: key,
    fields: { bayar_Tunai: "", bayar_QRIS: "11000", alasan: "salah payment" }, snapshot: {},
  }));
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(host.textContent).toContain("Draf dipulihkan");
  expect(field("bayar_QRIS")!.value).toBe("11000");
  expect(button().disabled).toBe(false);
});

it("explains what happens to recorded change", async () => {
  await render({ movable: [{ method: "Tunai", amount: 19000 }], change: 31000 });
  expect(host.textContent).toContain("Kembalian tercatat Rp 31.000");
  await click("Semua ke Debit");
  expect(host.textContent).toContain("kembalian dihapus");
  expect(button().disabled).toBe(false);
});
