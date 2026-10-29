import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  failReceiptSecondPage: false, omitInvoiceList: false, ancestorCount: 1,
  correctionsEnabled: false, failCorrectionBatch: false, returnsEnabled: false,
  receiptPages: [] as number[], correctionBatches: [] as number[],
}));
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fictional-actor" } } }) },
  from: (table: string) => {
    let from = 0;
    let to = 999;
    let selectedIds: string[] = [];
    const invoice = { id: id(1), no_faktur: "FJ.FICTION", order_id: state.ancestorCount > 1 ? id(9000) : null,
      tanggal: "2026-10-24", jatuh_tempo: "2026-11-24", total: 1000, carried_paid: 0, returned_ar: state.returnsEnabled ? 300 : 0,
      revision: 0, status: "aktif", customers: null };
    const q = {
      select: () => q, eq: () => q, order: () => q,
      in: (_field: string, ids: string[]) => { selectedIds = ids; if (table === "wholesale_invoice_corrections") state.correctionBatches.push(ids.length); return q; },
      range: (start: number, end: number) => { from = start; to = end; if (table === "sales_receipts" && selectedIds.includes(id(1))) state.receiptPages.push(start); return q; },
      maybeSingle: async () => ({ data: table === "sales_invoices" ? invoice : table === "company_settings" ? { ppn_rate: 11 } : null, error: null }),
      then: (resolve: (result: unknown) => void) => {
        if (table === "sales_receipts") {
          if (state.failReceiptSecondPage && from > 0 && selectedIds.includes(id(1))) return resolve({ data: null, count: 501, error: { message: "fictional private error" } });
          const rows = selectedIds.includes(id(1)) ? Array.from({ length: 501 }, (_, n) => ({
            id: id(n + 100), invoice_id: id(1), no_terima: `RC.FICTION.${n}`, tanggal: "2026-10-24",
            jumlah: 1, dari_uang_muka: 0, advance_id: null, advance: null, metode: "Transfer", journal_id: null,
          })) : [];
          return resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null });
        }
        if (table === "wholesale_returns") {
          const rows = state.returnsEnabled ? [{ id: id(7000), no_retur: "RJG.FICTION", tanggal: "2026-10-25", total: 300, ar_reduction: 300, customer_credit: 0, status: "posted", voided_on: null }] : [];
          return resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null });
        }
        if (table === "wholesale_invoice_corrections") {
          if (state.failCorrectionBatch && selectedIds.includes(id(51))) return resolve({ data: null, count: 1, error: { message: "fictional private error" } });
          const rows = state.correctionsEnabled ? selectedIds.map((invoiceId) => ({
            id: id(Number(invoiceId.slice(-12)) + 10_000), invoice_id: invoiceId,
            tanggal: "2026-10-24", reason: "Fictional correction", customer_credit: 1, paid_preserved: 0,
            created_at: "2026-10-24T00:00:00Z", created_by: "fictional-actor",
          })) : [];
          return resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null });
        }
        const rows = table === "sales_invoices" && !state.omitInvoiceList
          ? Array.from({ length: state.ancestorCount }, (_, n) => ({ ...invoice, id: id(n + 1),
            no_faktur: `FJ.FICTION.${n + 1}`, status: n ? "batal" : "aktif",
            replaces_invoice_id: n + 1 < state.ancestorCount ? id(n + 2) : null })) : [];
        return resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null });
      },
    };
    return q;
  },
}) }));
vi.mock("@/app/(app)/penjualan/faktur/[id]/WholesaleCorrectionForm", () => ({ WholesaleCorrectionForm: () => null }));
import Detail from "@/app/(app)/penjualan/faktur/[id]/page";

beforeEach(() => {
  state.failReceiptSecondPage = false; state.omitInvoiceList = false; state.ancestorCount = 1;
  state.correctionsEnabled = false; state.failCorrectionBatch = false; state.returnsEnabled = false;
  state.receiptPages = []; state.correctionBatches = [];
});

it("shows the oldest split receipt and an exact paid balance beyond one source page", async () => {
  const html = renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: id(1) }), searchParams: Promise.resolve({}) }));
  expect(html.includes(`id="receipt-${id(600)}"`)).toBe(true);
  expect(html.includes("Penerimaan faktur ini Rp 501")).toBe(true);
  expect(html.includes("Sisa piutang Rp 499")).toBe(true);
  expect(state.receiptPages).toEqual([0, 500]);
});

it("refuses a partial paid balance if the later receipt page fails", async () => {
  state.failReceiptSecondPage = true;
  await expect(Detail({ params: Promise.resolve({ id: id(1) }), searchParams: Promise.resolve({}) })).rejects.toThrow(/belum|tidak dapat/);
});

it("refuses to calculate a zero payment balance when the root invoice disappears from the verified list", async () => {
  state.omitInvoiceList = true;
  await expect(Detail({ params: Promise.resolve({ id: id(1) }), searchParams: Promise.resolve({}) })).rejects.toThrow(/belum dapat diverifikasi/);
  expect(state.receiptPages).toEqual([]);
});

it("includes a unique correction per predecessor across more than 1,000 invoices", async () => {
  state.ancestorCount = 1001; state.correctionsEnabled = true;
  const html = renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: id(1) }), searchParams: Promise.resolve({}) }));
  expect(html.includes("Kredit pelanggan dari rangkaian ini: <strong>Rp 1.001</strong>")).toBe(true);
  expect(state.correctionBatches.length).toBe(21);
  expect(state.correctionBatches.every((size) => size <= 50)).toBe(true);
});

it("refuses a partial customer credit amount when a later correction batch fails", async () => {
  state.ancestorCount = 51; state.correctionsEnabled = true; state.failCorrectionBatch = true;
  await expect(Detail({ params: Promise.resolve({ id: id(1) }), searchParams: Promise.resolve({}) })).rejects.toThrow(/belum|tidak dapat/);
});

it("links its wholesale returns by stored ID and nets their receivable reduction", async () => {
  state.returnsEnabled = true;
  const html = renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: id(1) }), searchParams: Promise.resolve({}) }));
  expect(html).toContain(`href="/penjualan/retur-grosir/${id(7000)}?from=%2Fpenjualan%2Ffaktur%2F${id(1)}"`);
  expect(html).toContain("RJG.FICTION");
  expect(html).toContain("Dikurangi retur Rp 300");
  expect(html).toContain("Sisa piutang Rp 199");
});
