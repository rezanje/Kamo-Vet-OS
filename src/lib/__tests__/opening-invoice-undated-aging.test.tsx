import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

// M05: faktur saldo awal tanpa tanggal tetap masuk total hutang/piutang, tetapi tidak
// dikelompokkan ke umur mana pun (tidak jatuh ke "> 90 hari" dan tidak ke "Berjalan").
const tables = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]> }));

vi.mock("@/lib/tanggal", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/tanggal")>(), hariIniWIB: () => "2026-11-15" }));
vi.mock("@/components/PilihRekening", async importOriginal => ({ ...await importOriginal<typeof import("@/components/PilihRekening")>(), loadRekeningAktif: async () => [] }));
vi.mock("@/components/LocalTransactionDraft", async importOriginal => ({ ...await importOriginal<typeof import("@/components/LocalTransactionDraft")>(), TransactionForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, is: () => query, neq: () => query, in: () => query, order: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: tables.rows[table] ?? [], error: null }).then(resolve),
    };
    return query;
  },
}) }));

import HutangPage from "@/app/(app)/keuangan/hutang/page";
import PiutangPage from "@/app/(app)/keuangan/piutang/page";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

it("keeps an opening payable without due date in the total but outside every aging bucket", async () => {
  tables.rows = { purchase_invoices: [
    { id: "dated", no_faktur: "FB.1", no_faktur_pemasok: "A-1", tanggal: "2026-08-01", jatuh_tempo: "2026-08-31", total: 100000, po_id: null, supplier_id: "s", opening_batch_id: "b", suppliers: { nama: "PT Fiksi" }, purchase_orders: null, purchase_invoice_payments: [] },
    { id: "undated", no_faktur: "FB.2", no_faktur_pemasok: "B-1", tanggal: null, jatuh_tempo: null, total: 400000, po_id: null, supplier_id: "s", opening_batch_id: "b", suppliers: { nama: "PT Fiksi" }, purchase_orders: null, purchase_invoice_payments: [] },
  ] };
  const html = text(renderToStaticMarkup(await HutangPage({ searchParams: Promise.resolve({}) })));
  expect(html).toContain("Tanpa jatuh tempo · 1 faktur Rp 400.000");
  expect(html).toContain("&gt; 90 hari Rp 0");
  expect(html).toContain("61–90 hari Rp 100.000");
  expect(html).toContain("TOTAL HUTANG Rp 500.000");
  expect(html).not.toContain("Invalid Date");
});

it("lists an opening receivable without invoice date last, without crashing or ageing it", async () => {
  tables.rows = { sales_invoices: [
    { id: "undated", no_faktur: "FJ.9", tanggal: null, total: 120000, carried_paid: 0, opening_batch_id: "b", catatan: "Saldo awal Accurate · No. N-0", customers: { name: "Toko Fiksi" } },
    { id: "dated", no_faktur: "FJ.8", tanggal: "2026-11-10", total: 80000, carried_paid: 0, opening_batch_id: "b", catatan: "Saldo awal Accurate · No. N-1", customers: { name: "Toko Fiksi" } },
  ] };
  const html = text(renderToStaticMarkup(await PiutangPage({ searchParams: Promise.resolve({}) })));
  expect(html).toContain("Tanpa tanggal faktur · 1 Rp 120.000");
  expect(html).toContain("&gt; 90 hari Rp 0");
  expect(html).toContain("TOTAL PIUTANG Rp 200.000");
  expect(html.indexOf("FJ.8")).toBeLessThan(html.indexOf("FJ.9"));
  expect(html).toContain("Tidak ada");
  expect(html).not.toContain("Invalid Date");
  expect(html).not.toContain("NaN");
});
