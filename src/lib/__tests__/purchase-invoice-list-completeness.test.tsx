import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ failPaymentPage: false, invoiceRanges: [] as string[], paymentRanges: [] as string[] }));
const invoices = Array.from({ length: 201 }, (_, i) => ({
  id: `invoice-${String(i + 1).padStart(3, "0")}`, no_faktur: `INV-${String(i + 1).padStart(3, "0")}`,
  voided_at: null, no_faktur_pemasok: null, surat_jalan: null,
  tanggal: "2026-10-01", jatuh_tempo: "2026-10-31", total: 1000,
  suppliers: { nama: "Pemasok" }, purchase_orders: null,
}));
const payments = Array.from({ length: 501 }, (_, i) => ({ id: `payment-${i}`, invoice_id: "invoice-051", amount: 1 }));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/PurchaseRequestKey", () => ({ PurchaseRecoveryComplete: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    let selectedIds: string[] = [];
    const query = {
      select: () => query,
      order: () => query,
      in: (_column: string, ids: string[]) => { selectedIds = ids; return query; },
      range: (from: number, to: number) => {
        const key = `${from}-${to}`;
        if (table === "purchase_invoices") {
          state.invoiceRanges.push(key);
          return Promise.resolve({ data: invoices.slice(from, to + 1), count: invoices.length, error: null });
        }
        state.paymentRanges.push(key);
        const selectedPayments = payments.filter(p => selectedIds.includes(p.invoice_id));
        return Promise.resolve(state.failPaymentPage && from > 0
          ? { data: null, count: selectedPayments.length, error: { message: "page failed" } }
          : { data: selectedPayments.slice(from, to + 1), count: selectedPayments.length, error: null });
      },
      limit: (size: number) => Promise.resolve({ data: invoices.slice(0, size), error: null }),
    };
    return query;
  },
}) }));

import FakturBeliPage from "@/app/(app)/pembelian/faktur/page";

beforeEach(() => { state.failPaymentPage = false; state.invoiceRanges = []; state.paymentRanges = []; });

it("shows invoices after the former 200-row cutoff and sums every payment before showing outstanding debt", async () => {
  const html = renderToStaticMarkup(await FakturBeliPage({ searchParams: Promise.resolve({ hal: "2" }) }));
  expect(html).toContain("INV-051");
  expect(html).not.toContain("INV-001");
  expect(html).toContain("Rp 499");
  expect(html).toContain("201");
  expect(state.invoiceRanges).toEqual(["0-49", "50-99"]);
  expect(state.paymentRanges).toEqual(["0-499", "500-999"]);
  const lastPage = renderToStaticMarkup(await FakturBeliPage({ searchParams: Promise.resolve({ hal: "5" }) }));
  expect(lastPage).toContain("INV-201");
  expect(lastPage).not.toContain("INV-200");
});

it("does not show a possibly incorrect debt balance if a payment page fails", async () => {
  state.failPaymentPage = true;
  const html = renderToStaticMarkup(await FakturBeliPage({ searchParams: Promise.resolve({ hal: "2" }) }));
  expect(html).toContain("belum dapat dimuat lengkap");
  expect(html).not.toContain("INV-051");
});

it("keeps the confirmed request key while navigating pages", async () => {
  const html = renderToStaticMarkup(await FakturBeliPage({ searchParams: Promise.resolve({ request_done: "saved-key", request_scope: "invoice", hal: "2" }) }));
  expect(html).toContain("request_done=saved-key");
  expect(html).toContain("request_scope=invoice");
});
