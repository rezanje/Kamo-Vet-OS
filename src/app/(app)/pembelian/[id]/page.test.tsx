import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ failSecondPage: false, receiptRanges: [] as [number, number][] }));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/dokumen/DokumenPanel", () => ({ DokumenPanel: () => null }));
vi.mock("@/components/ActivityHistoryLink", () => ({ ActivityHistoryLink: () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
    from: (table: string) => {
      const receipts = Array.from({ length: 1201 }, (_, i) => ({
        id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        no_terima: `GR-${i}`,
        tanggal: "2026-10-25",
      }));
      const single = table === "purchase_orders" ? {
        id: "20000000-0000-4000-8000-000000000001", no_po: "PO-TEST", tanggal: "2026-10-25",
        status: "Diterima", total: 0, revision: 0, supplier_id: null, to_warehouse_id: "warehouse",
        branch_id: "branch", suppliers: null, warehouses: null, branches: null, purchase_order_items: [],
      } : table === "profiles" ? { role: "STAFF", is_active: true } : null;
      const query = {
        select: () => query, eq: () => query, order: () => query,
        maybeSingle: async () => ({ data: single, error: null }),
        range: async (from: number, to: number) => {
          if (table === "goods_receipts") state.receiptRanges.push([from, to]);
          const all = table === "goods_receipts" ? receipts : [];
          const data = all.slice(from, state.failSecondPage && from === 500 ? to : to + 1);
          return { data, count: all.length, error: null };
        },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return query;
    },
  }),
}));

import PODetailPage from "./page";

it("shows linked receipts after the default 1,000-row limit", async () => {
  state.failSecondPage = false;
  state.receiptRanges = [];
  const page = await PODetailPage({
    params: Promise.resolve({ id: "20000000-0000-4000-8000-000000000001" }),
    searchParams: Promise.resolve({}),
  });
  const html = renderToStaticMarkup(page);
  expect(html).toContain("Penerimaan GR-1200");
  expect(state.receiptRanges).toEqual([[0, 499], [500, 999], [1000, 1499]]);
});

it("fails closed instead of showing partial linked documents", async () => {
  state.failSecondPage = true;
  await expect(PODetailPage({
    params: Promise.resolve({ id: "20000000-0000-4000-8000-000000000001" }),
    searchParams: Promise.resolve({}),
  })).rejects.toThrow(/Penerimaan PO belum dimuat lengkap/);
});
