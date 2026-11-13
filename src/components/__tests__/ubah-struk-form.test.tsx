// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ action: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/penjualan/[id]/actions", () => ({ ubahTransaksi: fixture.action }));
import { UbahStrukForm } from "@/app/(app)/penjualan/[id]/ubah/UbahStrukForm";

let root: Root; let host: HTMLDivElement;
const GOOD = "a0000000-0000-4000-8000-000000000001";
const render = async () => act(async () => root.render(
  <UbahStrukForm userId="owner" saleId="11111111-1111-1111-1111-111111111111" revision={0}
    lines={[{ asal: "l1", item_id: GOOD, nama: "Pakan", qty: 2, harga: 50000, satuan: "pcs", diskon_tipe: null, diskon_nilai: 0, promo: false, promo_diskon: 0, grup: false }]}
    katalog={[{ id: GOOD, code: "P1", nama: "Pakan", item_type: "Persediaan", is_active: true, units: [{ unit: "pcs", factor: 1 }], unitHarga: { pcs: 50000 } }]}
    diskonKategori={0} potonganLain={0} poinDigunakan={0} payments={[{ method: "Tunai", amount: 100000, fee_percent: 0 }]} punyaPelanggan={false} />));
const input = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const button = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const setValue = async (el: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); fixture.action.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("prefills the receipt and blocks saving until payments match the new total", async () => {
  await render();
  expect(host.textContent).toContain("Total Rp 100.000");
  expect(host.textContent).toContain("Pembayaran sudah sama dengan total.");
  await setValue(input("Qty Pakan"), "3");
  expect(host.textContent).toContain("Total Rp 150.000");
  expect(host.textContent).toContain("Pembayaran kurang Rp 50.000");
  expect(button().disabled).toBe(true);
  const fill = [...host.querySelectorAll("button")].find(b => b.textContent?.includes("ke Transfer"))!;
  await act(async () => fill.click());
  expect(host.textContent).toContain("Pembayaran sudah sama dengan total.");
  const isian = JSON.parse(host.querySelector<HTMLInputElement>('input[name="isian"]')!.value);
  expect(isian.lines).toEqual([expect.objectContaining({ asal: "l1", item_id: GOOD, qty: 3, harga: 50000, satuan: "pcs" })]);
  expect(isian.payments).toEqual([{ method: "Tunai", amount: 100000, fee_percent: 0 }, { method: "Transfer", amount: 50000, fee_percent: 0 }]);
});
