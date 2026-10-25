import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  options: [] as { id: string; items: { po_item_id: string; sisa: number }[] }[],
  failInvoiceItems: false,
  invoiceItemRanges: [] as string[],
}));
const pos = Array.from({ length: 101 }, (_, index) => ({
  id: `po-${String(index + 1).padStart(3, "0")}`,
  no_po: `PO-${String(index + 1).padStart(3, "0")}`,
  tanggal: "2026-10-01", status: "Diterima",
  suppliers: { nama: "Pemasok", termin_hari: 30 },
  purchase_order_receipt_closures: [],
  purchase_order_items: index === 100 ? [{ id: "line-101", item_id: "item-101", qty: 600, qty_terima: 600,
    harga_beli: 10, nama: "Barang", satuan: "pcs", faktor: 1, items: { unit: "pcs" } }] : [],
}));
const invoice = { id: "invoice-101", po_id: "po-101", voided_at: null };
const invoiceItems = Array.from({ length: 501 }, (_, index) => ({
  id: `invoice-line-${index}`, invoice_id: invoice.id, po_item_id: "line-101",
  item_id: "item-101", qty: 1, faktor: 1,
}));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/app/(app)/pembelian/faktur/baru/FakturForm", () => ({ FakturForm: ({ options }: { options: typeof state.options }) => { state.options = options; return null; } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    const equals = new Map<string, string>();
    const included = new Map<string, string[]>();
    let first = 0, last = Infinity;
    const query = {
      select: () => query,
      eq: (column: string, value: string) => { equals.set(column, value); return query; },
      in: (column: string, values: string[]) => { included.set(column, values); return query; },
      is: () => query,
      not: () => query,
      order: () => query,
      limit: (size: number) => { last = size - 1; return query; },
      range: (from: number, to: number) => { first = from; last = to; return query; },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        const rows = table === "purchase_orders" ? pos
          : table === "purchase_order_items" ? pos.flatMap(po => po.purchase_order_items.map(row => ({ ...row, po_id: po.id })))
          : table === "purchase_invoices" ? [invoice]
          : table === "purchase_invoice_items" ? invoiceItems : [];
        const selected = rows.filter(row => [...equals].every(([column, value]) => String(row[column as keyof typeof row]) === value)
          && [...included].every(([column, values]) => values.includes(String(row[column as keyof typeof row]))));
        if (table === "purchase_invoice_items") state.invoiceItemRanges.push(`${first}-${last}`);
        return Promise.resolve(state.failInvoiceItems && table === "purchase_invoice_items" && first > 0
          ? { data: null, count: selected.length, error: { message: "later page failed" } }
          : { data: selected.slice(first, last + 1), count: selected.length, error: null }).then(resolve);
      },
    };
    return query;
  },
}) }));

import FakturBaruPage from "@/app/(app)/pembelian/faktur/baru/page";

beforeEach(() => { state.options = []; state.failInvoiceItems = false; state.invoiceItemRanges = []; });

it("finds an exact older received PO and uses every billed line before offering remaining quantity", async () => {
  const html = renderToStaticMarkup(await FakturBaruPage({ searchParams: Promise.resolve({ po_no: "PO-101" }) }));
  expect(html).toContain('name="po_no"');
  expect(state.options.map(option => option.id)).toEqual(["po-101"]);
  expect(state.options[0].items.map(item => [item.po_item_id, item.sisa])).toEqual([["line-101", 99]]);
  expect(state.invoiceItemRanges).toEqual(["0-499", "500-999"]);
});

it("can reach an older PO on page 3 without a search", async () => {
  const html = renderToStaticMarkup(await FakturBaruPage({ searchParams: Promise.resolve({ hal: "3" }) }));
  expect(html).toContain("Halaman 3/3");
  expect(state.options.map(option => option.id)).toEqual(["po-101"]);
});

it("does not offer a PO when a later billed-line page fails", async () => {
  state.failInvoiceItems = true;
  const html = renderToStaticMarkup(await FakturBaruPage({ searchParams: Promise.resolve({ po_no: "PO-101" }) }));
  expect(html).toContain("belum dapat dimuat lengkap");
  expect(state.options).toEqual([]);
});
