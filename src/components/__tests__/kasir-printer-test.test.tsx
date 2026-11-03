// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Synthetic fixture only: no real branch, customer or receipt data.
const fixture = vi.hoisted(() => ({ sales: [] as unknown[], filters: [] as [string, string, unknown][] }));
vi.mock("next/navigation", () => ({ usePathname: () => "/kasir/printer", useSearchParams: () => new URLSearchParams(),
  redirect: () => { throw Error("redirect"); }, notFound: () => { throw Error("not found"); } }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ branch_id: "branch-synthetic", branchName: "Kamo Petshop Sintetis" }) }));
vi.mock("@/components/PrintButton", () => ({ PrintButton: ({ label }: { label: string }) => <button className="no-print">{label}</button>,
  AutoPrint: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "kasir-sintetis" } } }) },
  from(table: string) {
    const q = {
      select: () => q, order: () => q, limit: () => q,
      eq: (col: string, val: unknown) => { fixture.filters.push([table, `eq:${col}`, val]); return q; },
      is: (col: string, val: unknown) => { fixture.filters.push([table, `is:${col}`, val]); return q; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: fixture.sales, error: null }).then(resolve),
    };
    return q;
  },
}) }));
import PrinterPage from "@/app/kasir/printer/page";
import { KASIR_RECEIPT_PRINT_CSS } from "@/components/KasirReceiptPaper";

beforeEach(() => { fixture.sales = []; fixture.filters = []; });
async function render() {
  return new DOMParser().parseFromString(renderToStaticMarkup(await PrinterPage()), "text/html");
}

it("prints a sample receipt on the same 58 mm paper as a real sale, without creating a sale", async () => {
  const doc = await render();
  const receipt = doc.querySelector<HTMLDivElement>(".kasir-receipt")!;
  expect(receipt).not.toBeNull();
  expect(parseFloat(receipt.style.width)).toBeLessThanOrEqual(48);
  expect(receipt.textContent).toContain("TES PRINTER");
  expect(receipt.textContent).toContain("Bukan transaksi");
  expect(receipt.textContent).toContain("Kamo Petshop Sintetis");
  expect(receipt.textContent).toContain("KANAN");
  expect(doc.body.textContent).toContain("Cetak struk contoh");
  // Only reads the cashier's own POS sales; nothing is written.
  expect(fixture.filters).toContainEqual(["sales", "eq:cashier_id", "kasir-sintetis"]);
  expect(fixture.filters).toContainEqual(["sales", "is:channel", null]);
});

it("offers a reprint of the cashier's recent receipts outside the printed area", async () => {
  fixture.sales = [{ id: "sale-1", no_struk: "POS-SINTETIS-0002", total: 29000, created_at: "2026-11-03T02:00:00Z", voided_at: null }];
  const doc = await render();
  const link = doc.querySelector<HTMLAnchorElement>('a[href="/kasir/struk/sale-1?print=1"]');
  expect(link?.textContent).toContain("Cetak ulang");
  expect(link?.closest(".no-print")).not.toBeNull();
  expect(doc.querySelector(".kasir-receipt")?.textContent).not.toContain("POS-SINTETIS-0002");
});

it("explains when the cashier has no receipt to reprint yet", async () => {
  const doc = await render();
  expect(doc.body.textContent).toContain("Belum ada struk penjualan");
});

it("pins the printed receipt to the left edge so a wider driver paper cannot cut off the amounts", () => {
  const rule = KASIR_RECEIPT_PRINT_CSS.match(/\.kasir-receipt\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(rule).toMatch(/margin:\s*0\s*!important/);
});
