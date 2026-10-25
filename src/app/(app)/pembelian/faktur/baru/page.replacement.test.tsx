import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  lineCount: 1001, failLaterSource: false, missingSku: false, duplicatePoLine: false,
  changedFactor: false, removedUnit: false, unavailableSku: false, excessQty: false,
  sourceRanges: [] as string[],
}));
const sourceId = "11111111-1111-4111-8111-111111111111";
const poId = "22222222-2222-4222-8222-222222222222";
const poItem = (index: number) => ({
  id: `po-line-${index}`, po_id: poId, item_id: `sku-${index}`, qty: 1, qty_terima: 1,
  harga_beli: 10, nama: `Barang ${index}`, satuan: "pcs", faktor: 1, items: { unit: "pcs" },
});
const sourceLine = (index: number) => ({
  id: `invoice-line-${index}`, invoice_id: sourceId,
  po_item_id: state.duplicatePoLine && index === 1 ? "po-line-0" : `po-line-${index}`,
  item_id: state.missingSku && index === 0 ? null : `sku-${index}`,
  qty: state.excessQty && index === 0 ? 2 : 1, harga: 10,
  satuan: "pcs", faktor: state.changedFactor && index === 0 ? 2 : 1,
});
const source = {
  id: sourceId, po_id: poId, tanggal: "2026-10-01", jatuh_tempo: "2026-10-31",
  no_faktur_pemasok: "SUP-1", keterangan: null,
  purchase_invoice_items: Array.from({ length: 1000 }, (_, index) => sourceLine(index)),
};

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/app/(app)/pembelian/faktur/baru/FakturForm", () => ({
  FakturForm: ({ initial, options }: { initial?: { purchase_invoice_items: unknown[] }; options: { items: unknown[] }[] }) =>
    <div data-source-count={initial?.purchase_invoice_items.length} data-option-count={options[0]?.items.length} />,
}));
vi.mock("@/lib/satuan", () => ({ loadUnitOptions: async (_client: unknown, ids: string[]) => new Map(
  ids.filter(id => !state.unavailableSku || id !== "sku-0")
    .map(id => [id, [{ unit: state.removedUnit && id === "sku-0" ? "box" : "pcs", factor: 1 }]]),
) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    const equals = new Map<string, string>();
    const included = new Map<string, string[]>();
    let first = 0, last = 999;
    const query = {
      select: () => query,
      eq: (field: string, value: string) => { equals.set(field, value); return query; },
      in: (field: string, values: string[]) => { included.set(field, values); return query; },
      is: () => query,
      not: () => query,
      order: () => query,
      range: (from: number, to: number) => { first = from; last = to; return query; },
      maybeSingle: async () => ({ data: source, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        const rows = table === "purchase_orders" ? [{ id: poId, no_po: "PO-1", tanggal: "2026-10-01",
          status: "Diterima", suppliers: { nama: "Pemasok", termin_hari: 30 }, purchase_order_receipt_closures: [] }]
          : table === "purchase_order_items" ? Array.from({ length: state.lineCount }, (_, index) => poItem(index))
            : table === "purchase_invoice_items" ? Array.from({ length: state.lineCount }, (_, index) => sourceLine(index)) : [];
        const selected = rows.filter(row => [...equals].every(([field, value]) => String(row[field as keyof typeof row]) === value)
          && [...included].every(([field, values]) => values.includes(String(row[field as keyof typeof row]))));
        if (table === "purchase_invoice_items") state.sourceRanges.push(`${first}-${last}`);
        const failed = table === "purchase_invoice_items" && state.failLaterSource && first >= 500;
        return Promise.resolve({ data: failed ? null : selected.slice(first, last + 1), count: selected.length,
          error: failed ? { message: "source read failed" } : null }).then(resolve);
      },
    };
    return query;
  },
}) }));

import FakturBaruPage from "./page";

beforeEach(() => {
  state.lineCount = 1001; state.failLaterSource = false; state.missingSku = false;
  state.duplicatePoLine = false; state.changedFactor = false; state.removedUnit = false;
  state.unavailableSku = false; state.excessQty = false; state.sourceRanges = [];
});

const render = async () => renderToStaticMarkup(await FakturBaruPage({ searchParams: Promise.resolve({ replace_invoice: sourceId }) }));

it("prefills all 1,001 canonical source lines instead of a truncated embed", async () => {
  const html = await render();
  expect(html).toContain('data-source-count="1001"');
  expect(html).toContain('data-option-count="1001"');
  expect(state.sourceRanges).toEqual(["0-499", "500-999", "1000-1499"]);
});

it("hides replacement when a later source page fails", async () => {
  state.failLaterSource = true;
  const html = await render();
  expect(html).toContain("Faktur sumber pembatalan belum dapat dibaca lengkap");
  expect(html).not.toContain("data-source-count=");
});

it.each([
  ["missing SKU", { missingSku: true }],
  ["duplicate PO line", { duplicatePoLine: true }],
  ["changed factor", { changedFactor: true }],
  ["removed unit", { removedUnit: true }],
  ["unavailable SKU", { unavailableSku: true }],
  ["qty beyond remaining", { excessQty: true }],
])("blocks %s before prefill", async (_label, change) => {
  state.lineCount = 2;
  Object.assign(state, change);
  const html = await render();
  expect(html).toContain("tidak dapat disiapkan otomatis");
  expect(html).not.toContain("data-source-count=");
});
