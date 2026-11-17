// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Fictional fixtures only.
const state = vi.hoisted(() => ({ role: "OWNER", journalError: false, access: {} as Record<string, boolean> }));
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: id(1) } } }) },
  rpc: async () => ({ data: state.access, error: null }),
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, order: () => query, in: () => query, gt: () => query, range: () => query,
      maybeSingle: async () => ({ data: table === "purchase_invoices" ? {
        id: id(2), revision: 0, voided_at: null, void_reason: null, replaces_invoice_id: null, no_faktur: "FB.FICTION",
        no_faktur_pemasok: null, tanggal: "2026-11-11", jatuh_tempo: "2026-12-11", total: 1000.98, po_id: null, keterangan: null,
        purchase_orders: null, opening_batch_id: null,
      } : table === "profiles" ? { role: state.role, is_active: true } : null, error: null }),
      then: (resolve: (result: unknown) => unknown) => {
        if (table === "purchase_invoice_payments") return resolve({ data: [{ id: id(10), invoice_id: id(2), tanggal: "2026-11-11", amount: 1000,
          metode: "Transfer", catatan: null, dari_uang_muka: 0, advance_id: null, advance: null, payment_order_id: null, payment_order: null,
          replaces_payment_id: null, reversal_of: null, voided_at: null, revision: 0, journal_id: id(20) }], count: 1, error: null });
        if (table === "journal_lines") return resolve(state.journalError ? { data: null, error: { message: "denied" } }
          : { data: [{ entry_id: id(20), credit: 1000, coa_accounts: { code: "110209" } }], error: null });
        if (table === "cash_accounts") return resolve({ data: [{ coa_code: "110209", nama: "Bank Fiksi" }], error: null });
        return resolve({ data: [], count: 0, error: null });
      },
    };
    return query;
  },
}) }));
vi.mock("@/app/(app)/pembelian/faktur/[id]/InvoiceCorrectionForm", () => ({ InvoiceCorrectionForm: () => null }));
vi.mock("@/app/(app)/pembelian/faktur/[id]/PaymentCorrectionForm", () => ({ PaymentCorrectionForm: () => <form data-correction /> }));
vi.mock("@/lib/purchase-correction-requests", () => ({ loadRequestsForSource: async () => [] }));
vi.mock("@/lib/purchase-backdate", () => ({ loadPurchaseBackdateAccess: async () => false }));
import Detail from "@/app/(app)/pembelian/faktur/[id]/page";

const render = async () => {
  document.body.innerHTML = renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: id(2) }), searchParams: Promise.resolve({}) }));
  return document.body;
};
beforeEach(() => { state.role = "OWNER"; state.journalError = false; state.access = {}; });

it("shows which cash/bank account a payment used and links to its journal instead of a self-link that does nothing", async () => {
  const body = await render();
  const payment = body.querySelector(`#payment-${id(10)}`)!;
  expect(payment.textContent).toContain("Rekening: 110209 · Bank Fiksi");
  expect(payment.querySelector(`a[href="/keuangan/jurnal?entry=${id(20)}#journal-${id(20)}"]`)?.textContent).toBe("Lihat jurnal pembayaran");
  expect(payment.textContent).not.toContain("Buka pembayaran ini");
  expect(payment.querySelector("form[data-correction]")).not.toBeNull();
  expect(payment.textContent).not.toContain("belum diberi izin");
});

it("tells a user without cancel permission how a wrong payment gets corrected", async () => {
  state.role = "FINANCE";
  const body = await render();
  const payment = body.querySelector(`#payment-${id(10)}`)!;
  expect(payment.querySelector("form[data-correction]")).toBeNull();
  expect(payment.textContent).toContain("belum diberi izin");
  expect(payment.textContent).toContain("Batalkan pembayaran faktur pembelian");
});

it("still shows the payment when its journal cannot be read", async () => {
  state.journalError = true;
  const body = await render();
  expect(body.querySelector(`#payment-${id(10)}`)!.textContent).toContain("Rekening: lihat di jurnal");
});
