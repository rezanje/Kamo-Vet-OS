// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/kasir/checkout", () => ({ checkoutKasir: vi.fn() }));
vi.mock("@/app/kasir/actions", () => ({ tambahCustomerKasir: vi.fn() }));
import { KasirClient, type CustRow } from "@/app/kasir/KasirClient";
import { pasangApiPelangganPalsu } from "./pelanggan-fake-api";

// Pelanggan dicari di server (/api/pelanggan) — bukan dari daftar lengkap di layar.
// fetch palsu menjalankan filter yang sama dengan yang dikirim ke database.

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
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(rows: CustRow[] = customers) {
  pasangApiPelangganPalsu(rows);
  await act(async () => root.render(<KasirClient branchName="Cabang Uji" items={[]} vouchers={[]} hariIni="2026-10-13" />));
}
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  await act(async () => { await Promise.resolve(); });
}
async function search(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[placeholder="Masukkan nomor HP / nama..."]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
function hits() {
  return [...host.querySelectorAll<HTMLDivElement>('div[style*="z-index: 20"] > div')];
}

it.each(["0858", "+62 858", "62858", "0858-", "  +62 858  "])("finds both local and international stored numbers for %s", async query => {
  await render(); await search(query);
  // Hasil server diurutkan menurut nama.
  expect(hits().map(hit => hit.textContent?.split(" ·")[0])).toEqual(["Pelanggan Internasional", "Pelanggan Lokal"]);
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
  await settle();
  expect(hits()).toHaveLength(0);
  expect(host.textContent).toContain("Total transaksi");
  expect(host.querySelector('[role="status"]')).toBeNull();
  await search("INTERNASIONAL");
  expect(hits()).toHaveLength(1);
  expect(hits()[0].textContent).toContain("Pelanggan Internasional");
});

it("preserves partial number searches that happen to begin with 62", async () => {
  await render([{ ...base, id: "suffix", name: "Pelanggan Akhiran", phone: "081234562789" }]);
  await search("62789");
  expect(hits()).toHaveLength(1);
  expect(hits()[0].textContent).toContain("Pelanggan Akhiran");
});

it("does not let international-prefix normalization hide a name containing 62", async () => {
  const rows: CustRow[] = [
    ...Array.from({ length: 5 }, (_, i) => ({ ...base, id: `other-${i}`, name: `Nama lain ${i}`, phone: `08580000000${i}` })),
    { ...base, id: "name-number", name: "Pelanggan 62", phone: "081111234567" },
  ];
  await render(rows);
  await search("Pelanggan 62");
  expect(hits()).toHaveLength(1);
  expect(hits()[0].textContent).toContain("Pelanggan 62");
});

it("finds numbers stored with dashes and customers beyond the old 10,000-row screen list", async () => {
  const rows: CustRow[] = Array.from({ length: 10_430 }, (_, i) => ({ ...base, id: `c-${i}`, name: `Pelanggan ${String(i).padStart(5, "0")}`, phone: `0811${String(i).padStart(8, "0")}` }));
  rows.push({ ...base, id: "dash", name: "Yayan", phone: "0812-1002-7879" });
  await render(rows);
  await search("081210027879");
  expect(hits().map(hit => hit.textContent?.split(" ·")[0])).toEqual(["Yayan"]);
  await search("Pelanggan 10429");
  expect(hits()).toHaveLength(1);
});

it("needs at least two characters before asking the server", async () => {
  const api = pasangApiPelangganPalsu(customers);
  await act(async () => root.render(<KasirClient branchName="Cabang Uji" items={[]} vouchers={[]} hariIni="2026-10-13" />));
  await search("p");
  expect(api).not.toHaveBeenCalled();
  expect(host.querySelector('[role="status"]')?.textContent).toContain("minimal 2");
});

it("restores a drafted customer that is no longer shipped with the page by loading it from the server", async () => {
  const api = pasangApiPelangganPalsu([{ ...base, id: "draft-cust", name: "Pelanggan Draf", phone: "0811", trx: 3, belanja: 450_000 }]);
  const replacementDraft = { version: 1 as const, savedAt: Date.now(), checkoutKey: "k", customerId: "draft-cust", salespersonId: "",
    metode: "", diskon: 0, diskonPct: false, poin: 0, voucher: "", bayar: 0, cart: [] };
  await act(async () => root.render(<KasirClient branchName="Cabang Uji" items={[]} vouchers={[]} hariIni="2026-10-13" replacementDraft={replacementDraft} replacementId="sale" draftContext="ctx" />));
  await settle();
  expect(api).toHaveBeenCalledWith(expect.stringContaining("id=draft-cust&untuk=kasir"), expect.anything());
  expect(host.querySelector<HTMLInputElement>('input[placeholder="Masukkan nomor HP / nama..."]')!.value).toBe("Pelanggan Draf");
  expect(host.textContent).toContain("3x · Rp 450.000");
});
