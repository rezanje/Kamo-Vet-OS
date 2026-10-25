import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ failedPaymentPage: false, paymentPages: [] as number[] }));
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: id(1) } } }) },
  from: (table: string) => {
    let from = 0, to = 999;
    const query = {
      select: () => query, eq: () => query, order: () => query,
      range: (start: number, end: number) => { from = start; to = end; if (table === "purchase_invoice_payments") state.paymentPages.push(start); return query; },
      maybeSingle: async () => ({ data: table === "purchase_invoices" ? {
        id: id(2), revision: 0, voided_at: null, void_reason: null, replaces_invoice_id: null,
        no_faktur: "FI.FICTION", no_faktur_pemasok: null, tanggal: "2026-10-24", jatuh_tempo: "2026-11-24",
        total: 501, po_id: null, keterangan: null, purchase_orders: null,
        purchase_invoice_items: [], purchase_invoice_payments: [],
      } : table === "profiles" ? { role: "OWNER", is_active: true } : null, error: null }),
      then: (resolve: (result: unknown) => unknown) => {
        if (table === "purchase_invoice_payments") {
          if (state.failedPaymentPage && from === 500) return resolve({ data: null, count: 501, error: { message: "private fixture error" } });
          const rows = Array.from({ length: 501 }, (_, n) => ({ id: id(n + 100), invoice_id: id(2),
            tanggal: "2026-10-24", amount: 1, metode: "Transfer", catatan: null, dari_uang_muka: 0,
            advance_id: null, advance: null, payment_order_id: null, payment_order: null,
            replaces_payment_id: null, reversal_of: null, voided_at: null, revision: 0, journal_id: null }));
          return resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null });
        }
        return resolve({ data: [], count: 0, error: null });
      },
    };
    return query;
  },
}) }));
vi.mock("@/app/(app)/pembelian/faktur/[id]/InvoiceCorrectionForm", () => ({ InvoiceCorrectionForm: () => null }));
vi.mock("@/app/(app)/pembelian/faktur/[id]/PaymentCorrectionForm", () => ({ PaymentCorrectionForm: () => null }));
import Detail from "@/app/(app)/pembelian/faktur/[id]/page";

beforeEach(() => { state.failedPaymentPage = false; state.paymentPages = []; });

it("shows the complete saved payment total and the oldest payment after a second page", async () => {
  const html = renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: id(2) }), searchParams: Promise.resolve({}) }));
  expect(html).toContain("Pembayaran bersih Rp 501");
  expect(html).toContain(`id="payment-${id(600)}"`);
  expect(state.paymentPages).toEqual([0, 500]);
});

it("does not show a partial payment total when the second page fails", async () => {
  state.failedPaymentPage = true;
  await expect(Detail({ params: Promise.resolve({ id: id(2) }), searchParams: Promise.resolve({}) })).rejects.toThrow(/belum|tidak dapat/);
});
