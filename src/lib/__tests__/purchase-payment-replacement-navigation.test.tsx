import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const original = "10000000-0000-4000-8000-000000000001";
const replacement = "10000000-0000-4000-8000-000000000002";
const invoiceId = "10000000-0000-4000-8000-000000000003";
const reversal = "10000000-0000-4000-8000-000000000004";
const state = vi.hoisted(() => ({ hasReplacement: true, role: "OWNER" }));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    const payments = [
      { id: original, invoice_id: invoiceId, tanggal: "2026-10-24", amount: 100, metode: "Tunai", catatan: null, dari_uang_muka: 0, advance_id: null, advance: null, payment_order_id: null, payment_order: null, replaces_payment_id: null, reversal_of: null, voided_at: "2026-10-24", revision: 1, journal_id: "journal" },
      { id: reversal, invoice_id: invoiceId, tanggal: "2026-10-24", amount: -100, metode: "Tunai", catatan: null, dari_uang_muka: 0, advance_id: null, advance: null, payment_order_id: null, payment_order: null, replaces_payment_id: null, reversal_of: original, voided_at: null, revision: 0, journal_id: "reversal-journal" },
      ...(state.hasReplacement ? [{ id: replacement, invoice_id: invoiceId, tanggal: "2026-10-24", amount: 100, metode: "Transfer", catatan: null, dari_uang_muka: 0, advance_id: null, advance: null, payment_order_id: null, payment_order: null, replaces_payment_id: original, reversal_of: null, voided_at: null, revision: 0, journal_id: "replacement-journal" }] : []),
    ];
    const single: Record<string, unknown> = {
      purchase_invoices: { id: invoiceId, revision: 0, voided_at: null, void_reason: null, replaces_invoice_id: null, no_faktur: "FP-TEST", no_faktur_pemasok: null, tanggal: "2026-10-24", jatuh_tempo: "2026-11-24", total: 100, po_id: null, keterangan: null, purchase_orders: null, purchase_invoice_items: [], purchase_invoice_payments: payments },
      profiles: { role: state.role, is_active: true },
    };
    let filter = "";
    let from = 0, to = 999;
    const query = { select: () => query, eq: (column: string) => { filter = column; return query; }, order: () => query,
      range: (start: number, end: number) => { from = start; to = end; return query; },
      maybeSingle: async () => ({ data: table === "purchase_invoices" && filter === "replaces_invoice_id" ? null : single[table] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => { const rows = table === "purchase_invoice_payments" ? payments : []; return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null }).then(resolve); } };
    return query;
  },
}) }));

import PurchaseInvoiceDetail from "@/app/(app)/pembelian/faktur/[id]/page";

async function render() {
  return renderToStaticMarkup(await PurchaseInvoiceDetail({ params: Promise.resolve({ id: invoiceId }), searchParams: Promise.resolve({}) }));
}

it("shows replacement entry only while a voided purchase payment has no saved replacement", async () => {
  state.role = "OWNER";
  state.hasReplacement = false;
  expect(await render()).toContain(`href="/keuangan/hutang?replace_payment=${original}"`);
  state.hasReplacement = true;
  const html = await render();
  expect(html).not.toContain(`href="/keuangan/hutang?replace_payment=${original}"`);
  expect(html).toContain("Buka pembayaran pengganti");
});

it.each(["STAFF", "ADMIN"])("shows %s how to request an invoice correction without edit controls", async (role) => {
  state.role = role;
  const html = await render();
  expect(html).toContain("Minta koreksi FP-TEST");
  expect(html).toContain("Kirim permintaan koreksi");
  expect(html).toContain('name="source_kind" value="purchase_invoice"');
  expect(html).not.toContain("belum dikirim atau dicatat");
  expect(html).not.toContain("Koreksi pembayaran</summary>");
});
