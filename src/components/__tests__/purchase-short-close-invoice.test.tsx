import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ options: [] as { id: string; label: string; items: { po_item_id: string; sisa: number }[] }[] }));
vi.mock("@/app/(app)/pembelian/faktur/baru/FakturForm", () => ({ FakturForm: ({ options }: { options: typeof state.options }) => { state.options = options; return null; } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) }, from(table: string) {
  const filters: Record<string, string> = {};
  const rows = [
    { id: "temporary", status: "Dipesan" },
    { id: "closed", status: "Diterima", purchase_order_receipt_closures: [{ po_id: "closed" }] },
  ];
  let first = 0, last = Infinity;
  const q = { select: () => q, eq: (key: string, value: string) => { filters[key] = value; return q; },
    in: () => q, is: () => q, order: () => q, range: (from: number, to: number) => { first = from; last = to; return q; }, then(resolve: (value: unknown) => void) {
    const data = table === "purchase_orders" ? rows.filter(row => !filters.status || row.status === filters.status)
      : table === "purchase_order_items" ? [
        { id: "accepted", po_id: "closed", item_id: "item", qty: 10, qty_terima: 5, harga_beli: 100, nama: "Fiction received", satuan: "pcs", faktor: 1 },
        { id: "undelivered", po_id: "closed", item_id: "other", qty: 3, qty_terima: 0, harga_beli: 100, nama: "Fiction unreceived", satuan: "pcs", faktor: 1 },
      ] : table === "purchase_invoices" ? [{ id: "invoice", po_id: "closed" }]
        : table === "purchase_invoice_items" ? [{ id: "billed", invoice_id: "invoice", po_item_id: "accepted", item_id: "item", qty: 2, faktor: 1 }] : [];
    resolve({ data: data.slice(first, last + 1), count: data.length, error: null });
  } }; return q;
} }) }));
import InvoicePage from "@/app/(app)/pembelian/faktur/baru/page";
it("lists explicitly finished partial PO, excludes temporary partial, and bills only received/uninvoiced quantities", async () => {
  renderToStaticMarkup(await InvoicePage({ searchParams: Promise.resolve({}) }));
  expect(state.options.map(row => row.id)).toEqual(["closed"]);
  expect(state.options[0].items.map(row => [row.po_item_id, row.sisa])).toEqual([["accepted", 3]]);
  expect(state.options[0].label).toContain("Selesai parsial");
});
