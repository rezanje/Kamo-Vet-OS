import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const invoiceId = "10000000-0000-4000-8000-000000000003";
const originalId = "10000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ hasReplacement: true }));

vi.mock("@/components/PilihRekening", async importOriginal => ({ ...await importOriginal<typeof import("@/components/PilihRekening")>(), loadRekeningAktif: async () => [] }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters[column] = value; return query; },
      is: () => query,
      order: () => query,
      maybeSingle: async () => ({ data: table === "profiles" ? { role: "OWNER", is_active: true } : table === "purchase_invoice_payments" && filters.id === originalId ? { id: originalId, invoice_id: invoiceId, amount: 100, metode: "Tunai", advance_id: null, voided_at: "2026-10-24", reversal_of: null, payment_order_id: null } : table === "purchase_invoice_payments" && filters.replaces_payment_id === originalId && state.hasReplacement ? { id: "replacement" } : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "purchase_invoices" ? [{ id: invoiceId, no_faktur: "FP-TEST", no_faktur_pemasok: null, tanggal: "2026-10-24", jatuh_tempo: "2026-11-24", total: 100, po_id: null, supplier_id: "supplier", suppliers: { nama: "Pemasok" }, purchase_orders: null, purchase_invoice_payments: state.hasReplacement ? [{ amount: 100 }, { amount: -100 }, { amount: 50 }] : [{ amount: 100 }, { amount: -100 }] }] : [], error: null }).then(resolve),
    };
    return query;
  },
}) }));

import HutangPage from "@/app/(app)/keuangan/hutang/page";

async function render() {
  return renderToStaticMarkup(await HutangPage({ searchParams: Promise.resolve({ replace_payment: originalId }) }));
}

it("does not reopen a saved purchase payment replacement from a stale URL", async () => {
  state.hasReplacement = false;
  expect(await render()).toContain(`payable-replacement:${originalId}`);
  state.hasReplacement = true;
  const html = await render();
  expect(html).not.toContain(`payable-replacement:${originalId}`);
  expect(html).toContain("Pembayaran pengganti tidak tersedia");
});
