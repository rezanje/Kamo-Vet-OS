// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/kasir/checkout", () => ({ checkoutKasir: vi.fn() }));
vi.mock("@/app/kasir/actions", () => ({ tambahCustomerKasir: vi.fn() }));
import { KasirClient, type CustRow } from "@/app/kasir/KasirClient";

let host: HTMLDivElement;
let root: Root;
const base = { points: 0, tier: null, kategori: "Umum", trx: 0, belanja: 0 };
const customers: CustRow[] = [
  { ...base, id: "local", name: "Pelanggan Lokal", phone: "085812345678" },
  { ...base, id: "intl", name: "Pelanggan Internasional", phone: "+62 858-9876-5432" },
];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() {
  await act(async () => root.render(<KasirClient branchName="Cabang Uji" items={[]} customers={customers} vouchers={[]} hariIni="2026-10-13" />));
}
async function search(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[placeholder="Masukkan nomor HP / nama..."]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function hits() {
  return [...host.querySelectorAll<HTMLDivElement>('div[style*="z-index: 20"] > div')];
}

it.each(["0858", "+62 858", "62858", "0858-", "  +62 858  "])("finds both local and international stored numbers for %s", async query => {
  await render(); await search(query);
  expect(hits().map(hit => hit.textContent?.split(" ·")[0])).toEqual(["Pelanggan Lokal", "Pelanggan Internasional"]);
});

it("shows an explicit empty result and recovers when the query is corrected", async () => {
  await render(); await search("nomor-tidak-ada");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Customer tidak ditemukan");
  await search("0858");
  expect(hits()).toHaveLength(2);
  expect(host.querySelector('[role="status"]')).toBeNull();
});

it("keeps name search case-insensitive and clears selection when searching for another customer", async () => {
  await render(); await search("lokal");
  expect(hits()).toHaveLength(1);
  await act(async () => hits()[0].click());
  expect(hits()).toHaveLength(0);
  expect(host.querySelector('[role="status"]')).toBeNull();
  await search("INTERNASIONAL");
  expect(hits()).toHaveLength(1);
  expect(hits()[0].textContent).toContain("Pelanggan Internasional");
});

it("preserves partial number searches that happen to begin with 62", async () => {
  await act(async () => root.render(<KasirClient branchName="Cabang Uji" items={[]}
    customers={[{ ...base, id: "suffix", name: "Pelanggan Akhiran", phone: "081234562789" }]}
    vouchers={[]} hariIni="2026-10-13" />));
  await search("62789");
  expect(hits()).toHaveLength(1);
  expect(hits()[0].textContent).toContain("Pelanggan Akhiran");
});

it("does not let international-prefix normalization hide a name containing 62", async () => {
  const rows: CustRow[] = [
    ...Array.from({ length: 5 }, (_, i) => ({ ...base, id: `other-${i}`, name: `Nama lain ${i}`, phone: `08580000000${i}` })),
    { ...base, id: "name-number", name: "Pelanggan 62", phone: "081111234567" },
  ];
  await act(async () => root.render(<KasirClient branchName="Cabang Uji" items={[]} customers={rows} vouchers={[]} hariIni="2026-10-13" />));
  await search("Pelanggan 62");
  expect(hits()).toHaveLength(1);
  expect(hits()[0].textContent).toContain("Pelanggan 62");
});
