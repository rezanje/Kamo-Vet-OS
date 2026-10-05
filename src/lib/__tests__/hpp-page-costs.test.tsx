import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
const fixture = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fixture.client }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("../../app/(app)/pos/sku/actions", () => ({ toggleBarang: async () => {} }));
import SkuPage from "../../app/(app)/pos/sku/page";
import { HppReportPage } from "../../components/HppReportPage";
const item = { id: "i", code: "SKU", name: "Obat", unit: "ml", item_type: "Persediaan", sell_price: 100, buy_price: 25, min_stock: 0, min_buy: 1, default_discount: 0, is_active: true };

describe("financial cost UI boundary", () => {
  it.each(["OWNER", "FINANCE"])("shows the actual FIFO average to active %s", async role => {
    fixture.client = clientFixture({ role, modules: [{ role: "FINANCE", module_id: "pos" }], tables: { items: [item] } }).client;
    const html = renderToStaticMarkup(await SkuPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("HPP rata-rata FIFO");
    expect(html).toContain("Rp 50,00");
    expect(html).toContain('title="Lengkap"');
  });
  it.each(["DOCTOR", "ADMIN", "STAFF"])("does not serialize new FIFO costs for %s", async role => {
    const { client, records } = clientFixture({ role, tables: { items: [item] } });
    fixture.client = client;
    const html = renderToStaticMarkup(await SkuPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("HPP rata-rata FIFO");
    expect(records.some(row => row.table === "stock_layers")).toBe(false);
  });
  it("renders ingredient view and links complete protected exports preserving scope", async () => {
    fixture.client = clientFixture({ tables: {
      invoice_items: [{ id: "line", compound_recipe_id: "recipe", qty: 1, harga: 200, diskon_persen: 0, hpp: 50, deskripsi: "Racikan", invoices: {
        id: "invoice", visit_id: "visit", invoice_no: "INV", created_at: "2026-10-04T05:00:00Z", paid_status: "Lunas", voided_at: null, visits: { branch_id: "b1", dokter: "Dr A", doctor_id: "doctor" },
      } }],
      compounding_ingredients: [{ id: "ingredient", recipe_id: "recipe", item_id: "i", ingredient_name: "Obat historis", quantity: 3, unit: "ml" }],
    } }).client;
    const html = renderToStaticMarkup(await HppReportPage({ kind: "compound", params: { cabang: "b1", dari: "2026-10-04", sampai: "2026-10-04", rincian: "bahan" } }));
    expect(html).toContain("Obat historis");
    expect(html).toContain("Rincian HPP belum lengkap");
    expect(html).toContain("format=xlsx");
    expect(html).toContain("format=print");
    expect(html).toContain("rincian=bahan");
    expect(html).toContain("invoic");
  });
});
