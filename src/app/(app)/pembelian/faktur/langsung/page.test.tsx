import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ failLaterPage: false, invoiceItemReads: 0 }));
const sourceId = "11111111-1111-4111-8111-111111111111";
const sourceItem = { item_id: "item", qty: 1, harga: 100, satuan: "pcs", exp_date: null };
const source = {
  id: sourceId, supplier_id: "supplier", warehouse_id: "warehouse", tanggal: "2026-10-01",
  jatuh_tempo: "2026-10-31", no_faktur_pemasok: "SUP-1", surat_jalan: null,
  keterangan: null, purchase_invoice_items: Array.from({ length: 1000 }, () => sourceItem),
};

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/satuan", () => ({ loadUnitOptions: async () => new Map() }));
vi.mock("@/app/(app)/pembelian/faktur/langsung/FakturLangsungForm", () => ({
  FakturLangsungForm: ({ initial }: { initial?: { purchase_invoice_items: unknown[]; lampiran: unknown[] } }) =>
    <div data-items={initial?.purchase_invoice_items.length} data-attachments={initial?.lampiran.length} />,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    let start = 0;
    let end = 999;
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      not: () => query,
      order: () => query,
      range: (from: number, to: number) => { start = from; end = to; return query; },
      maybeSingle: async () => ({ data: source, error: null }),
      then: (resolve: (result: unknown) => unknown) => {
        if (table === "purchase_invoice_items") state.invoiceItemReads++;
        const rows = table === "purchase_invoice_items"
          ? Array.from({ length: 1001 }, (_, index) => ({ id: `line-${index}`, ...sourceItem }))
          : table === "document_attachments"
            ? [{ id: "attachment", path: "private/path", nama: "Nota", mime: "image/png", ukuran: 10 }]
            : [];
        const failed = table === "purchase_invoice_items" && state.failLaterPage && start >= 500;
        return Promise.resolve({ data: failed ? null : rows.slice(start, end + 1), count: rows.length,
          error: failed ? { message: "source page unavailable" } : null }).then(resolve);
      },
    };
    return query;
  },
}) }));

import FakturLangsungPage from "./page";

beforeEach(() => { state.failLaterPage = false; state.invoiceItemReads = 0; });

it("prefills all 1,001 source lines and attachments before replacement", async () => {
  const html = renderToStaticMarkup(await FakturLangsungPage({ searchParams: Promise.resolve({ replace_invoice: sourceId }) }));
  expect(html).toContain('data-items="1001"');
  expect(html).toContain('data-attachments="1"');
  expect(state.invoiceItemReads).toBe(3);
});

it("hides the replacement form if a later source page cannot be read", async () => {
  state.failLaterPage = true;
  const html = renderToStaticMarkup(await FakturLangsungPage({ searchParams: Promise.resolve({ replace_invoice: sourceId }) }));
  expect(html).toContain("Faktur sumber pembatalan belum dapat dibaca");
  expect(html).not.toContain("data-items=");
});
