// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ filter: "" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    let filter = "";
    const receipt = { id: "receipt", no_terima: "RC-1", tanggal: "2026-10-21", jumlah: 30, dari_uang_muka: 0, metode: "Transfer", journal_id: "journal" };
    const invoice = { id: "invoice", no_faktur: "FJS-1", order_id: null, tanggal: "2026-10-21", jatuh_tempo: "2026-11-21", total: 100, carried_paid: 0, status: "berjalan", sales_receipts: [receipt] };
    const q = { select: () => q, eq: (key: string) => { filter = key; return q; }, order: () => q, in: () => q,
      maybeSingle: async () => ({ data: table === "profiles" ? { role: "OWNER", is_active: true } : table === "company_settings" ? { ppn_rate: 11 } : invoice }),
      then: (resolve: (value: unknown) => void) => { if (table === "sales_invoices") state.filter = filter; resolve({ data: table === "sales_invoices" ? [invoice] : [], error: null }); },
    };
    return q;
  },
}) }));
vi.mock("@/app/(app)/penjualan/faktur/[id]/WholesaleCorrectionForm", () => ({ WholesaleCorrectionForm: () => <span>owner correction</span> }));
import Detail from "@/app/(app)/penjualan/faktur/[id]/page";
it("shows receipt history and remaining amount for an orderless invoice without enabling wholesale correction", async () => {
  const html = renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: "invoice" }), searchParams: Promise.resolve({}) }));
  expect(state.filter).toBe("id");
  expect(html).toContain("Penerimaan faktur ini Rp 30");
  expect(html).toContain("Sisa piutang Rp 70");
  expect(html).toContain("RC-1");
  expect(html).not.toContain("owner correction");
});
