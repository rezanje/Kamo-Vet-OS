// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

// Synthetic fixture only: no real branch, customer or receipt data.
vi.mock("next/headers", () => ({ headers: async () => new Headers({
  "x-kamo-operational-branch": "branch-synthetic", "x-kamo-operational-mode": "petshop" }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/kasir/struk/receipt", useSearchParams: () => new URLSearchParams(),
  redirect: () => { throw Error("redirect"); }, notFound: () => { throw Error("not found"); } }));
vi.mock("@/app/login/actions", () => ({ logout: async () => {} }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ branch_id: "branch-synthetic", branchName: "Cabang Sintetis" }) }));
vi.mock("@/components/PrintButton", () => ({ PrintButton: () => <button className="no-print">Cetak Struk</button>, AutoPrint: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor", email: "operator@example.test" } } }) },
  from(table: string) {
    const sale = { id: "receipt", no_struk: "POS-SINTETIS-0001", subtotal: 125000, discount: 5000, total: 120000, metode_bayar: "Tunai",
      bayar: 150000, kembali: 30000, sale_payments: [], payment_plan: null, payments_finalized_at: null, poin_earned: 0, poin_digunakan: 0,
      voucher_code: null, cashier_name: "Kasir Sintetis", created_at: "2026-10-27T04:17:00Z",
      customers: { name: "Pelanggan Sintetis" }, branches: { name: "Kamo Petshop Sintetis" } };
    const item = { nama: "Grooming Sintetis", qty: 5, satuan: "pcs", harga: 25000, item_discount_type: null, item_discount_value: 0, promos: null,
      service_performers: { version: 1, doctor_id: null, staff_id: "staff", doctor_name: null, staff_name: "Groomer Sintetis" },
      sale_item_group_components: [] };
    const data = table === "sales" ? sale : table === "sale_items" ? [item]
      : table === "branches" ? { code: "SINT", name: "Kamo Petshop Sintetis", type: "petshop" }
      : table === "profiles" ? { full_name: "Operator Uji", is_active: true } : [];
    const q = { select: () => q, eq: () => q, is: () => q, order: () => q,
      maybeSingle: async () => ({ data, error: null }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
    return q;
  },
}) }));
import ReceiptPage from "@/app/kasir/struk/[saleId]/page";
import BackofficeReceiptPage from "@/app/(app)/pos/struk/[saleId]/page";
import KasirLayout from "@/app/kasir/layout";
import { ActiveBranch } from "@/components/ActiveBranch";
import { KlinikTopbar } from "@/components/KlinikTopbar";

// Selectors that the app's own print stylesheets hide (globals.css + the page's inline <style>).
function printHiddenSelectors(css: string) {
  const selectors: string[] = [];
  for (const block of css.split("@media print").slice(1)) {
    for (const [, sel, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/display:\s*none/.test(body)) selectors.push(...sel.split(",").map(s => s.trim()).filter(Boolean));
    }
  }
  return selectors;
}
function printed(markup: string) {
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const css = readFileSync("src/app/globals.css", "utf8") + [...doc.querySelectorAll("style")].map(s => s.textContent).join("\n");
  for (const sel of printHiddenSelectors(css)) doc.querySelectorAll(sel).forEach(el => el.remove());
  doc.querySelectorAll("style, script").forEach(el => el.remove());
  return doc.body.textContent ?? "";
}
async function cashierMarkup() {
  const page = await ReceiptPage({ params: Promise.resolve({ saleId: "receipt" }), searchParams: Promise.resolve({}) });
  const markup = renderToStaticMarkup(await KasirLayout({ children: page }));
  const output = process.env.RECEIPT_PRINT_RENDER_DIR;
  if (output) {
    mkdirSync(output, { recursive: true });
    const css = readFileSync("src/app/globals.css", "utf8").replace('@import "tailwindcss";', "");
    writeFileSync(join(output, "kasir-receipt.html"), `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${markup}</body></html>`);
  }
  return markup;
}

it("keeps the branch selector on screen but out of the printed cashier receipt", async () => {
  const markup = await cashierMarkup();
  const screen = new DOMParser().parseFromString(markup, "text/html").body.textContent ?? "";
  expect(screen).toContain("Cabang aktif: SINT · Kamo Petshop Sintetis");
  expect(screen).toContain("Ganti cabang");

  const paper = printed(markup);
  expect(paper).not.toContain("Cabang aktif");
  expect(paper).not.toContain("Ganti cabang");
  expect(paper).not.toContain("Cetak Struk");
  // Nama tenaga penjual per baris tidak pernah tercetak lagi (permintaan Andri 29 Okt 2026).
  expect(paper).not.toContain("Groomer Sintetis");
  expect(paper).not.toContain("Pelaksana");
  expect(paper.trimStart().startsWith("KAMO PETSHOP")).toBe(true);
  for (const text of ["Kamo Petshop Sintetis", "POS-SINTETIS-0001", "Kasir Sintetis", "Pelanggan Sintetis", "Grooming Sintetis",
    "5 pcs x Rp 25.000", "Rp 125.000", "TOTALRp 120.000", "KembaliRp 30.000"]) expect(paper).toContain(text);
});

it("keeps the backoffice receipt free of per-line seller names", async () => {
  const markup = renderToStaticMarkup(await BackofficeReceiptPage({ params: Promise.resolve({ saleId: "receipt" }) }));
  expect(markup).not.toContain("Pelaksana");
  const paper = printed(markup);
  expect(paper).not.toContain("Groomer Sintetis");
  for (const text of ["KAMO PET CARE", "Kamo Petshop Sintetis", "Grooming Sintetis", "Rp 120.000"]) expect(paper).toContain(text);
});

it("hides shared app chrome from every printed document", async () => {
  const branch = renderToStaticMarkup((await ActiveBranch())!);
  expect(branch).toContain("Ganti cabang");
  expect(printed(branch).trim()).toBe("");
  expect(printed(renderToStaticMarkup(<KlinikTopbar fullName="Staf Sintetis" branchName="Cabang Sintetis" />)).trim()).toBe("");
});
