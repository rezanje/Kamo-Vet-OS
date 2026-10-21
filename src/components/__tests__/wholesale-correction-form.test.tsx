// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/penjualan/faktur/[id]/actions", () => ({ koreksiFakturGrosir: vi.fn() }));
import { WholesaleCorrectionForm } from "@/app/(app)/penjualan/faktur/[id]/WholesaleCorrectionForm";
let root: Root; let host: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("shows preserved receipts, zero physical stock change and live customer credit before correction", async () => {
  await act(async () => root.render(<WholesaleCorrectionForm userId="owner" invoiceId="invoice" revision={4} today="2026-10-21" due="2026-11-21" note="" paid={150} total={200} taxRate={0} items={[{ id: "line", nama: "Box delivered", qty: 2, harga: 100, satuan: "box" }]} />));
  const input = host.querySelector<HTMLInputElement>('input[name="harga_line"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "50"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(host.querySelector('[data-testid="credit-preview"]')?.textContent).toContain("50");
  expect(host.textContent).toContain("Perubahan stok: 0");
  expect(host.textContent).toContain("Pembayaran tetap tersimpan");
  expect(host.querySelector<HTMLInputElement>('input[name="alasan"]')!.required).toBe(true);
  expect(host.querySelector('input[name="qty_line"]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value).toBeTruthy();
});
it("restores prices and action with the same preview after reload or a rejected redirect", async () => {
  const render = async () => act(async () => root.render(<WholesaleCorrectionForm userId="owner" invoiceId="invoice" revision={4} today="2026-10-21" due="2026-11-21" note="" paid={150} total={200} taxRate={0} items={[{ id: "line", nama: "Box delivered", qty: 2, harga: 100, satuan: "box" }]} />));
  await render();
  const input = host.querySelector<HTMLInputElement>('input[name="harga_line"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "50"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  const key = host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value;
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(host.querySelector<HTMLInputElement>('input[name="harga_line"]')!.value).toBe("50");
  expect(host.querySelector('[data-testid="credit-preview"]')?.textContent).toContain("Rp 50");
  expect(host.querySelector<HTMLInputElement>('input[name="draft_key"]')!.value).toBe(key);
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Tindakan koreksi"]')!;
  await act(async () => { select.value = "cancel"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="Tindakan koreksi"]')!.value).toBe("cancel");
  expect(host.querySelector('[data-testid="credit-preview"]')?.textContent).toContain("Rp 150");
});
