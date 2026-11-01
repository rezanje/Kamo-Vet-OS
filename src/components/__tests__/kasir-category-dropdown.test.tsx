// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/kasir/checkout", () => ({ checkoutKasir: vi.fn() }));
vi.mock("@/app/kasir/actions", async () => (await import("./helpers/kasir-actions-mock")).kasirActionsMock);
import { KasirClient, type ItemRow } from "@/app/kasir/KasirClient";
let host: HTMLDivElement;
let root: Root;
const item = (id: string, name: string, kategori: string): ItemRow => ({
  id, code: id.toUpperCase(), name, kategori, itemType: "Persediaan", harga: 15000, stok: 12,
});
const rows = [
  ...Array.from({ length: 12 }, (_, index) => item(`adult-${index}`, `Aatas Tuna ${index}`, "WCC ADULT")),
  item("bentonit-10", "Pasir Bentonite 10L", "BENTONIT 10L"),
  item("bentonit-25", "Pasir Bentonite 25L", "BENTONIT 25L+"),
  item("cream", "Snack Tuna Creamy", "SC CREAMY / STICK"),
  ...Array.from({ length: 70 }, (_, index) => item(`catalog-${index}`, `Produk contoh ${index}`, `Kategori ${index}`)),
];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(items = rows) {
  await act(async () => root.render(<KasirClient branchName="Kamo Petshop Bantarkemang — data contoh" items={items} vouchers={[]} hariIni="2026-10-14" />));
}
const category = () => host.querySelector<HTMLSelectElement>("#kasir-category-filter")!;
const productRows = () => [...host.querySelectorAll<HTMLTableRowElement>(".kpos-workspace > .card:first-child tbody tr")];
async function choose(value: string) { await act(async () => { category().value = value; category().dispatchEvent(new Event("change", { bubbles: true })); }); }
async function search(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[placeholder="Cari nama / kode barang..."]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
it("uses one labelled dropdown with Semua and every actual category, without expansion buttons", async () => {
  await render();
  expect(host.querySelector('label[for="kasir-category-filter"]')?.textContent).toBe("Kategori produk");
  expect([...category().options].map(option => option.value)).toEqual(["Semua", ...new Set(rows.map(row => row.kategori))]);
  expect(category().options).toHaveLength(75);
  expect(category().value).toBe("Semua");
  expect(host.querySelectorAll(".kpos-catTab")).toHaveLength(0);
  expect(host.textContent).not.toContain("kategori lagi");
  const output = process.env.CATEGORY_RENDER_DIR;
  if (output) {
    mkdirSync(output, { recursive: true });
    const css = readFileSync("src/app/globals.css", "utf8").replace('@import "tailwindcss";', "");
    writeFileSync(join(output, "category-dropdown.html"), `<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><style>*,::before,::after{box-sizing:border-box}${css}</style></head><body style="height:auto;padding:16px;margin:0"><div style="padding:8px 0;font-size:12px">Cabang aktif: Kamo Petshop Bantarkemang · Data contoh untuk review lokal</div>${host.innerHTML}</body></html>`);
  }
});
it("filters a category beyond the previous collapsed list", async () => {
  await render(); await choose("Kategori 69");
  expect(productRows()).toHaveLength(1); expect(productRows()[0].textContent).toContain("Produk contoh 69");
});
it("combines category selection with case-insensitive name and code search", async () => {
  await render(); await search("  TUNA  "); await choose("SC CREAMY / STICK");
  expect(productRows()).toHaveLength(1); expect(productRows()[0].textContent).toContain("Snack Tuna Creamy");
  await choose("BENTONIT 10L"); expect(productRows()[0].textContent).toContain("Produk tidak ditemukan");
  await search("bEnToNiT-10"); expect(productRows()[0].textContent).toContain("Pasir Bentonite 10L");
});
it("Semua removes only the category filter and clearing search restores the catalog", async () => {
  await render(); await search("tuna"); await choose("SC CREAMY / STICK"); await choose("Semua");
  expect(productRows()).toHaveLength(8); expect(productRows().every(row => row.textContent?.includes("Aatas Tuna"))).toBe(true);
  await search(""); await choose("BENTONIT 25L+"); expect(productRows()[0].textContent).toContain("Pasir Bentonite 25L");
  await choose("Semua"); expect(productRows()[0].textContent).toContain("ADULT-0");
});
it("resets pagination on category changes and Semua", async () => {
  await render(); await act(async () => ([...host.querySelectorAll<HTMLButtonElement>(".kpos-pagebtn")].find(button => button.textContent === "2")!).click());
  expect(productRows()[0].textContent).toContain("ADULT-8");
  await choose("WCC ADULT"); expect(productRows()[0].textContent).toContain("ADULT-0");
  await choose("Semua"); expect(productRows()[0].textContent).toContain("ADULT-0");
});
it("keeps existing cart quantities and totals when filtering products", async () => {
  await render(); await act(async () => productRows()[0].click());
  const cart = host.querySelector(".kpos-workspace > .card:last-child")!;
  const before = cart.textContent;
  await choose("Kategori 69"); await search("contoh");
  expect(cart.textContent).toBe(before); expect(cart.textContent).toContain("Aatas Tuna 0");
  expect(category().closest("form")).toBeNull();
});
it("keeps Semua available for an empty catalog", async () => {
  await render([]); expect([...category().options].map(option => option.value)).toEqual(["Semua"]);
  expect(productRows()[0].textContent).toContain("Produk tidak ditemukan");
});
