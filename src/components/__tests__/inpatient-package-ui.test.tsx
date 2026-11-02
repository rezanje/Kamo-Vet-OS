// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
import { InpatientCashier } from "@/app/(app)/klinik/pembayaran/[visitId]/InpatientCashier";
import type { InpatientCashierData, InpatientCashierRow } from "@/lib/inpatient-cashier";
import type { PackageOption } from "@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";
import { pecahPaket, type ResepPaket } from "@/lib/paket-klinik";
const group = "10000000-0000-4000-8000-000000000001";
const material = "10000000-0000-4000-8000-000000000002";
const service = "10000000-0000-4000-8000-000000000003";
const recipe: ResepPaket = { id: group, name: "Paket Fiktif", komponen: [
  { item_id: material, name: "Bahan Tersembunyi", item_type: "Persediaan", base_unit: "pcs", qty: 1, unit: "box", factor: 10 },
  { item_id: service, name: "Jasa Isi", item_type: "Jasa", base_unit: "x", qty: 1, unit: "x", factor: 1 },
] };
const packages: PackageOption[] = [{ id: group, name: recipe.name, componentIds: [material, service], perPaket: { [material]: 10, [service]: 1 }, resep: recipe }];
const masterObat = [{ id: group, name: recipe.name, code: "PK", unit: "paket", harga: 123000, paket: true },
  { id: material, name: "Bahan Tersembunyi", code: "BH", unit: "pcs", harga: 1000, units: [{ unit: "pcs", factor: 1, sell_price: 1000, buy_price: 0 }, { unit: "box", factor: 10, sell_price: 10000, buy_price: 0 }] }];
const masterJasa = [{ id: service, name: "Jasa Isi", code: "JS", unit: "x", harga: 90000 }];
const patient = { photo: null, name: "Pasien Fiktif", species: "Kucing", owner: "Pemilik Fiktif", phone: "", address: "", dokter: "Dokter Fiktif", jenisLayanan: "Rawat Inap", noInvoice: "(baru)", tanggal: "01/11/2026" };
const data: InpatientCashierData = { tax_settings: { mode_pkp: false, ppn_rate: 0 }, snapshot: "trusted-snapshot", rows: [], history: [], receipts: [], applications: [], quote: { token: "quote", remaining: 0, pending: 0, debt: 0, credit: 0, subtotal: 0, tax: 0, amount: 0, excess: 0, accounts: [] } };
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(rows: InpatientCashierRow[] = [], options = packages) { await act(async () => root.render(<InpatientCashier {...{ packages: options }} data={{ ...data, rows }} patient={patient} visitId="visit" recordId="stay" requestKey="key" masterObat={masterObat} masterJasa={masterJasa} ppnRate={0} minDpPercent={50} bolehTerobos={false} />)); }
const payload = (): InpatientCashierRow[] => JSON.parse(host.querySelector<HTMLInputElement>('input[name="pending_rows"]')!.value);
async function pick(name = "Paket · Paket Fiktif", table = 0) {
  await act(async () => ([...host.querySelectorAll("button")].filter(el => el.textContent?.trim() === "Tambah")[table]).click());
  const inputs = host.querySelectorAll<HTMLInputElement>(`[role="combobox"][id^="${table === 0 ? "ranap-obat" : "ranap-jasa"}"]`);
  await act(async () => inputs[inputs.length - 1].focus());
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(el => el.textContent?.includes(name))!;
  expect(option).toBeDefined();
  await act(async () => option.click());
}
it("explicit Grup pick expands real mixed recipe into all pending rows, one card, hidden materials and UUID identities", async () => {
  await render(); await pick();
  const rows = payload();
  const expected = pecahPaket(recipe, 123000, 1, (id, _unit, factor) => id === material ? 1000 * factor : 90000);
  expect(rows.map(row => [row.item_id, row.jenis, row.qty, row.satuan, row.harga])).toEqual(expected.baris.map(row => [row.item_id, row.jenis, row.qty, row.satuan, row.harga]));
  expect(rows.every(row => row.package_item_id === group && row.package_qty === 1)).toBe(true);
  expect(new Set(rows.map(row => row.id)).size).toBe(2);
  for (const row of rows) expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(host.querySelectorAll(`tr[data-paket="${group}"]`)).toHaveLength(1);
  expect(host.querySelector(`tr[data-paket="${group}"]`)!.textContent).toContain("Rp 123.000");
  expect(host.textContent).not.toContain("Bahan Tersembunyi");
  expect(host.textContent).not.toContain("Jasa Isi");
});
it("repeat pick preserves selected price, conversion and UUIDs; remove clears every package component but not standalone jasa/racikan", async () => {
  const old: InpatientCashierRow[] = [
    { id: "old-jasa", item_id: service, nama_obat: "Jasa terpisah", qty: 1, harga: 90000, satuan: "x", jenis: "jasa", service_performers: { doctor_id: "doctor", doctor_name: "Dokter lama", staff_id: null, staff_name: null } },
    { id: "old-racik", item_id: null, nama_obat: "Racikan lama", qty: 1, harga: 5000, satuan: "racikan", jenis: "racikan", compound_recipe_id: "recipe-old" },
  ];
  await render(old); await pick();
  const once = payload().filter(row => row.package_item_id);
  await pick();
  const twice = payload().filter(row => row.package_item_id);
  expect(twice.map(row => [row.id, row.item_id, row.qty, row.harga, row.satuan, row.package_qty, row.jenis])).toEqual(once.map(row => [row.id, row.item_id, row.qty * 2, row.harga, row.satuan, 2, row.jenis]));
  expect(host.querySelectorAll(`tr[data-paket="${group}"]`)).toHaveLength(1);
  await act(async () => host.querySelector<HTMLElement>('[aria-label="Hapus paket Paket Fiktif"]')!.click());
  expect(payload()).toHaveLength(2);
  expect(payload().map(row => row.id).sort()).toEqual(["old-jasa", "old-racik"]);
  expect(payload().find(row => row.id === "old-jasa")?.service_performers).toEqual(old[0].service_performers);
  expect(payload().find(row => row.id === "old-racik")?.compound_recipe_id).toBe("recipe-old");
});
it("canonical durable rows reload as one card without changing amounts, units, source IDs or service kind", async () => {
  await render(); await pick(); const saved = payload();
  await act(async () => root.render(null)); await render(saved);
  expect(payload()).toEqual(saved);
  expect(host.querySelectorAll(`tr[data-paket="${group}"]`)).toHaveLength(1);
  expect(host.textContent).not.toContain("Bahan Tersembunyi");
  expect(payload().find(row => row.item_id === service)?.jenis).toBe("jasa");
});
it("normal separately selected SKU stays ordinary even when it belongs to a recipe", async () => {
  await render(); await pick("Bahan Tersembunyi");
  expect(payload()).toEqual([expect.objectContaining({ item_id: material, qty: 1, harga: 1000, satuan: "pcs", jenis: "obat", package_item_id: null, package_qty: null })]);
  expect(host.querySelector('[data-paket]')).toBeNull();
});
it("legacy rows identical to a recipe and its price are never inferred to be a package", async () => {
  const expanded = pecahPaket(recipe, 123000, 1, (id, _unit, factor) => id === material ? 1000 * factor : 90000).baris;
  await render(expanded.map((row, i) => ({ id: `legacy-${i}`, item_id: row.item_id, nama_obat: row.nama, qty: row.qty, harga: row.harga, satuan: row.satuan, jenis: row.jenis })));
  expect(payload().every(row => row.package_item_id == null && row.package_qty == null)).toBe(true);
  expect(host.querySelector('[data-paket]')).toBeNull();
});
it.each([
  { ...packages[0], resep: undefined },
  { ...packages[0], componentIds: [material] },
  { ...packages[0], perPaket: { [material]: 9, [service]: 1 } },
  { ...packages[0], resep: { ...recipe, komponen: [{ ...recipe.komponen[0], factor: Number.NaN }, recipe.komponen[1]] } },
  { ...packages[0], resep: { ...recipe, komponen: [{ ...recipe.komponen[0], factor: 7 }, recipe.komponen[1]] } },
  { ...packages[0], resep: { ...recipe, komponen: [{ ...recipe.komponen[0], item_type: "Grup" }, recipe.komponen[1]] } },
])("bad/incomplete Group metadata fails closed rather than becoming a regular SKU: %j", async option => {
  await render([], [option]); await pick();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('input[name="pending_rows"]')).toBeNull();
});
it.each([
  [{ id: "raw-group", item_id: group, nama_obat: "Paket Fiktif", qty: 1, harga: 123000, satuan: "paket", jenis: "obat" }],
  [{ id: "partial", item_id: material, nama_obat: "Bahan Tersembunyi", qty: 1, harga: 12300, satuan: "box", jenis: "obat", package_item_id: group, package_qty: 1 }],
  [
    { id: "material", item_id: material, nama_obat: "Bahan Tersembunyi", qty: 1, harga: 12300, satuan: "box", jenis: "obat", package_item_id: group, package_qty: 1 },
    { id: "service", item_id: service, nama_obat: "Jasa Isi", qty: 1, harga: 110700, satuan: "x", jenis: "obat", package_item_id: group, package_qty: 1 },
  ],
] as InpatientCashierRow[][])("rejects raw Group, partial component set or forged source kind: %j", async (...source) => {
  await render(source);
  expect(host.querySelector('input[name="pending_rows"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
// Parent's independent quantity lock keeps source performers and detach sealed.
it("direct package quantity interaction resizes every hidden source row without changing its ID or unit price", async () => {
  await render(); await pick(); const before = payload();
  const input = host.querySelector<HTMLInputElement>('[aria-label="Jumlah paket Paket Fiktif"]');
  expect(input).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "3"); input!.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(payload()).toEqual(before.map(row => ({ ...row, qty: row.qty * 3, package_qty: 3 })));
  expect(host.querySelector('[aria-label="Lepas paket Paket Fiktif"]')).toBeNull();
});
it("incomplete canonical durable origin fails closed instead of revealing a material row", async () => {
  await render([{ id: "tagged-source", item_id: material, nama_obat: "Bahan Tersembunyi", qty: 1, harga: 1000, satuan: "pcs", jenis: "obat", package_item_id: group }]);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('input[name="pending_rows"]')).toBeNull();
  expect(host.textContent).not.toContain("Bahan Tersembunyi");
});
