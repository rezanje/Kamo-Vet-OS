import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ failSecondItemPage: false, returnRanges: [] as string[], itemRanges: [] as string[] }));
const returns = Array.from({ length: 201 }, (_, i) => ({
  id: `return-${String(i + 1).padStart(3, "0")}`,
  no_retur: `RB-${String(i + 1).padStart(3, "0")}`,
  tanggal: "2026-10-01", keterangan: null, total: 100,
  voided_at: null, purchase_orders: { no_po: "PO-1", suppliers: { nama: "Pemasok" } },
}));
const items = Array.from({ length: 501 }, (_, i) => ({ id: `item-${i}`, return_id: "return-051" }));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    let selectedIds: string[] = [];
    const query = {
      select: () => query,
      in: (_column: string, ids: string[]) => { selectedIds = ids; return query; },
      order: () => query,
      range: (from: number, to: number) => {
        const key = `${from}-${to}`;
        if (table === "purchase_returns") {
          state.returnRanges.push(key);
          return Promise.resolve({ data: returns.slice(from, to + 1), count: returns.length, error: null });
        }
        state.itemRanges.push(key);
        const selected = items.filter(item => selectedIds.includes(item.return_id));
        return Promise.resolve(state.failSecondItemPage && from > 0
          ? { data: null, count: selected.length, error: { message: "read failed" } }
          : { data: selected.slice(from, to + 1), count: selected.length, error: null });
      },
      limit: (size: number) => Promise.resolve({ data: returns.slice(0, size), error: null }),
    };
    return query;
  },
}) }));

import ReturBeliPage from "@/app/(app)/pembelian/retur/page";

beforeEach(() => { state.failSecondItemPage = false; state.returnRanges = []; state.itemRanges = []; });

it("finds return 201 and counts every item on its selected page", async () => {
  const html = renderToStaticMarkup(await ReturBeliPage({ searchParams: Promise.resolve({ hal: "2" }) }));
  expect(html).toContain("RB-051");
  expect(html).not.toContain("RB-001");
  expect(html).toMatch(/RB-051[\s\S]*?<td[^>]*>501<\/td>/);
  expect(state.returnRanges).toEqual(["0-49", "50-99"]);
  expect(state.itemRanges).toEqual(["0-499", "500-999"]);
  const lastPage = renderToStaticMarkup(await ReturBeliPage({ searchParams: Promise.resolve({ hal: "5" }) }));
  expect(lastPage).toContain("RB-201");
  expect(lastPage).not.toContain("RB-200");
});

it("hides return counts when a later item page cannot be read", async () => {
  state.failSecondItemPage = true;
  const html = renderToStaticMarkup(await ReturBeliPage({ searchParams: Promise.resolve({ hal: "2" }) }));
  expect(html).toContain("belum dapat dimuat lengkap");
  expect(html).not.toContain("RB-051");
});
