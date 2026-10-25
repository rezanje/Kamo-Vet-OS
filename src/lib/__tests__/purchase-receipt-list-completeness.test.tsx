import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ failItemPage: false, receiptRanges: [] as string[], itemRanges: [] as string[] }));
const items = Array.from({ length: 501 }, (_, index) => ({
  id: `item-${index}`, receipt_id: "receipt-051", qty_terima: 1, qty_rusak: 1, harga: 2,
}));
const receipts = Array.from({ length: 201 }, (_, index) => ({
  id: `receipt-${String(index + 1).padStart(3, "0")}`,
  no_terima: `TB-${String(index + 1).padStart(3, "0")}`,
  tanggal: "2026-10-25", surat_jalan: null,
  purchase_orders: { no_po: "PO-FIKTIF", suppliers: { nama: "Pemasok Fiktif" } },
  goods_receipt_items: index === 50 ? items.slice(0, 500) : [],
}));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    let selectedIds: string[] = [];
    const query = {
      select: () => query,
      order: () => query,
      in: (_field: string, ids: string[]) => { selectedIds = ids; return query; },
      range: (from: number, to: number) => {
        const range = `${from}-${to}`;
        if (table === "goods_receipts") {
          state.receiptRanges.push(range);
          return Promise.resolve({ data: receipts.slice(from, to + 1), count: receipts.length, error: null });
        }
        state.itemRanges.push(range);
        const selected = items.filter(item => selectedIds.includes(item.receipt_id));
        return Promise.resolve(state.failItemPage && from > 0
          ? { data: null, count: selected.length, error: { message: "page failed" } }
          : { data: selected.slice(from, to + 1), count: selected.length, error: null });
      },
      limit: (size: number) => Promise.resolve({ data: receipts.slice(0, size), error: null }),
    };
    return query;
  },
}) }));

import PenerimaanPage from "@/app/(app)/pembelian/penerimaan/page";

beforeEach(() => { state.failItemPage = false; state.receiptRanges = []; state.itemRanges = []; });

it("paginates beyond 200 receipts and sums every item on the selected page", async () => {
  const html = renderToStaticMarkup(await PenerimaanPage({ searchParams: Promise.resolve({ hal: "2" }) }));
  expect(html).toContain("TB-051");
  expect(html).not.toContain("TB-001");
  expect(html).toContain("Rp 1.002");
  expect(html).toContain("501 unit");
  expect(state.receiptRanges).toEqual(["0-49", "50-99"]);
  expect(state.itemRanges).toEqual(["0-499", "500-999"]);
  const last = renderToStaticMarkup(await PenerimaanPage({ searchParams: Promise.resolve({ hal: "5" }) }));
  expect(last).toContain("TB-201");
  expect(last).not.toContain("TB-200");
});

it("hides receipt totals if a later item page fails", async () => {
  state.failItemPage = true;
  const html = renderToStaticMarkup(await PenerimaanPage({ searchParams: Promise.resolve({ hal: "2" }) }));
  expect(html).toContain("belum dapat dimuat lengkap");
  expect(html).not.toContain("TB-051");
});
