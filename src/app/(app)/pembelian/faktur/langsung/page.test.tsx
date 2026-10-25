import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  failLaterPage: false, invoiceItemReads: 0, sourceLineCount: 1001,
  sourceAttachmentCount: 1, missingItem: false, activeItem: true, unitAvailable: true,
  factorChanged: false, attachmentPath: "pembelian/nota.png", attachmentName: "Nota",
  attachmentMime: "image/png", attachmentSize: 10,
}));
const sourceId = "11111111-1111-4111-8111-111111111111";
const sourceItem = { item_id: "item", qty: 1, harga: 100, satuan: "pcs", faktor: 1, exp_date: null };
const source = {
  id: sourceId, supplier_id: "supplier", warehouse_id: "warehouse", tanggal: "2026-10-01",
  jatuh_tempo: "2026-10-31", no_faktur_pemasok: "SUP-1", surat_jalan: null,
  keterangan: null, purchase_invoice_items: Array.from({ length: 1000 }, () => sourceItem),
};

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/satuan", () => ({ loadUnitOptions: async () => new Map([["item", [{ unit: state.unitAvailable ? "pcs" : "box", factor: 1, buy_price: 100 }]]]) }));
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
          ? Array.from({ length: state.sourceLineCount }, (_, index) => ({ id: `line-${index}`, ...sourceItem,
            item_id: state.missingItem && index === 0 ? null : "item", faktor: state.factorChanged && index === 0 ? 2 : 1 }))
          : table === "document_attachments"
            ? Array.from({ length: state.sourceAttachmentCount }, (_, index) => ({ id: `attachment-${index}`,
              path: state.attachmentPath, nama: state.attachmentName, mime: state.attachmentMime, ukuran: state.attachmentSize }))
            : table === "items" && state.activeItem
              ? [{ id: "item", code: "SKU-1", name: "Barang", buy_price: 100, unit: "pcs", track_expiry: false }]
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

beforeEach(() => {
  state.failLaterPage = false; state.invoiceItemReads = 0;
  state.sourceLineCount = 1001; state.sourceAttachmentCount = 1;
  state.missingItem = false; state.activeItem = true; state.unitAvailable = true;
  state.factorChanged = false; state.attachmentPath = "pembelian/nota.png";
  state.attachmentName = "Nota"; state.attachmentMime = "image/png"; state.attachmentSize = 10;
});

it("reads all 1,001 source lines but blocks a replacement above the 500-line posting limit", async () => {
  const html = renderToStaticMarkup(await FakturLangsungPage({ searchParams: Promise.resolve({ replace_invoice: sourceId }) }));
  expect(html).toContain("batas 500 baris");
  expect(html).not.toContain("data-items=");
  expect(state.invoiceItemReads).toBe(3);
});

it("permits 500 source lines and blocks the 501st", async () => {
  state.sourceLineCount = 500;
  const allowed = renderToStaticMarkup(await FakturLangsungPage({ searchParams: Promise.resolve({ replace_invoice: sourceId }) }));
  expect(allowed).toContain('data-items="500"');
  expect(allowed).toContain('data-attachments="1"');
  state.sourceLineCount = 501;
  const blocked = renderToStaticMarkup(await FakturLangsungPage({ searchParams: Promise.resolve({ replace_invoice: sourceId }) }));
  expect(blocked).toContain("batas 500 baris");
  expect(blocked).not.toContain("data-items=");
});

it("blocks 101 source attachments but permits 100", async () => {
  state.sourceLineCount = 1;
  state.sourceAttachmentCount = 100;
  const allowed = renderToStaticMarkup(await FakturLangsungPage({ searchParams: Promise.resolve({ replace_invoice: sourceId }) }));
  expect(allowed).toContain('data-attachments="100"');
  state.sourceAttachmentCount = 101;
  const blocked = renderToStaticMarkup(await FakturLangsungPage({ searchParams: Promise.resolve({ replace_invoice: sourceId }) }));
  expect(blocked).toContain("batas 100 lampiran");
  expect(blocked).not.toContain("data-items=");
});

it("hides the replacement form if a later source page cannot be read", async () => {
  state.failLaterPage = true;
  const html = renderToStaticMarkup(await FakturLangsungPage({ searchParams: Promise.resolve({ replace_invoice: sourceId }) }));
  expect(html).toContain("Faktur sumber pembatalan belum dapat dibaca lengkap");
  expect(html).not.toContain("data-items=");
});

it.each([
  ["missing SKU", { missingItem: true }],
  ["inactive SKU", { activeItem: false }],
  ["removed unit", { unitAvailable: false }],
])("blocks a %s before prefill", async (_label, change) => {
  state.sourceLineCount = 1;
  Object.assign(state, change);
  const html = renderToStaticMarkup(await FakturLangsungPage({ searchParams: Promise.resolve({ replace_invoice: sourceId }) }));
  expect(html).toContain("tidak tersedia untuk faktur pengganti");
  expect(html).not.toContain("data-items=");
});

it("blocks a changed unit factor before stock quantity can drift", async () => {
  state.sourceLineCount = 1;
  state.factorChanged = true;
  const html = renderToStaticMarkup(await FakturLangsungPage({ searchParams: Promise.resolve({ replace_invoice: sourceId }) }));
  expect(html).toContain("faktor stok sumber tidak tersedia");
  expect(html).not.toContain("data-items=");
});

it.each([
  ["wrong folder", { attachmentPath: "private/nota.png" }],
  ["parent path", { attachmentPath: "pembelian/../nota.png" }],
  ["long path", { attachmentPath: `pembelian/${"x".repeat(491)}` }],
  ["blank name", { attachmentName: "" }],
  ["long name", { attachmentName: "x".repeat(201) }],
  ["long MIME", { attachmentMime: "x".repeat(121) }],
  ["zero size", { attachmentSize: 0 }],
  ["oversize", { attachmentSize: 10485761 }],
])("blocks %s attachment metadata rejected by the posting RPC", async (_label, change) => {
  state.sourceLineCount = 1;
  Object.assign(state, change);
  const html = renderToStaticMarkup(await FakturLangsungPage({ searchParams: Promise.resolve({ replace_invoice: sourceId }) }));
  expect(html).toContain("Referensi lampiran sumber tidak valid");
  expect(html).not.toContain("data-items=");
});
