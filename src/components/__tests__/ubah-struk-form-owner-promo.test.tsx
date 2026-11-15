// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Jalur Owner (migrasi 20261119100000): potongan promo baris tidak bisa diketik; dihitung sebanding nilai baris seperti database.
const fixture = vi.hoisted(() => ({ action: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/penjualan/[id]/actions", () => ({ ubahTransaksi: fixture.action }));
import { UbahStrukForm } from "@/app/(app)/penjualan/[id]/ubah/UbahStrukForm";

let root: Root; let host: HTMLDivElement;
const GOOD = "a0000000-0000-4000-8000-000000000001";
const line = { asal: "l1", item_id: GOOD, nama: "Pakan", qty: 2, harga: 50000, satuan: "pcs", diskon_tipe: null, diskon_nilai: 0, promo: true, promo_diskon: 10000, grup: false,
  asal_data: { qty: 2, harga: 50000, satuan: "pcs", faktor: 1, item_discount_type: null, item_discount_value: 0, promo_discount: 10000 } };
const render = async (jalur: boolean) => act(async () => root.render(
  <UbahStrukForm userId="owner" saleId="11111111-1111-1111-1111-111111111111" revision={0} jalurOwnerBelumDibayar={jalur}
    lines={[line]}
    katalog={[{ id: GOOD, code: "P1", nama: "Pakan", item_type: "Persediaan", is_active: true, units: [{ unit: "pcs", factor: 1 }], unitHarga: { pcs: 50000 } }]}
    diskonKategori={0} potonganLain={7000} poinDigunakan={0} payments={[{ method: "Tunai", amount: 83000, fee_percent: 0 }]} punyaPelanggan={false} />));
const input = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
const setValue = async (el: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); fixture.action.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("jalur Owner: promo baris read-only dan ikut sebanding saat qty berubah", async () => {
  await render(true);
  expect(input("Diskon promo Pakan")).toBeNull();
  expect(host.textContent).toContain("Total Rp 83.000");
  expect(host.textContent).toContain("Promo Rp 10.000 (dihitung otomatis)");
  await setValue(input("Qty Pakan")!, "3");
  expect(host.textContent).toContain("Promo Rp 15.000 (dihitung otomatis)");
  expect(host.textContent).toContain("Total Rp 128.000");
  const isian = JSON.parse(host.querySelector<HTMLInputElement>('input[name="isian"]')!.value);
  expect(isian.lines[0]).toMatchObject({ asal: "l1", qty: 3, promo_diskon: 15000 });
});
it("jalur lama: promo tetap bisa diketik seperti dulu", async () => {
  await render(false);
  expect(input("Diskon promo Pakan")).not.toBeNull();
  expect(host.textContent).not.toContain("dihitung otomatis");
});
