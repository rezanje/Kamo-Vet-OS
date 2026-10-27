// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Fictional fixtures only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixture = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, fail: new Set<string>(), filters: [] as unknown[][] }));
vi.mock("@/lib/master-guard", () => ({ bolehTransaksiKas: async () => false }));
vi.mock("@/components/PilihRekening", () => ({ loadRekeningAktif: async () => [], PilihRekening: () => null }));
vi.mock("@/app/(app)/pembelian/uang-muka/actions", () => ({ batalkanUangMuka: vi.fn() }));
vi.mock("@/app/(app)/penjualan/uang-muka/actions", () => ({ batalkanUangMukaJual: vi.fn(), terimaUangMukaJual: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: null } }) },
  from(table: string) {
    let start = 0, end = 999;
    const query = {
      select: () => query, order: () => query, eq: () => query, limit: () => query,
      in: (column: string, values: unknown) => { fixture.filters.push([table, column, values]); return query; },
      range: (from: number, to: number) => { start = from; end = to; return query; },
      then(resolve: (value: unknown) => unknown) {
        if (fixture.fail.has(table)) return Promise.resolve({ data: null, count: null, error: { message: "unavailable" } }).then(resolve);
        const rows = fixture.rows[table] ?? [];
        return Promise.resolve({ data: rows.slice(start, end + 1), count: rows.length, error: null }).then(resolve);
      },
    };
    return query;
  },
}) }));
import PurchaseAdvances from "@/app/(app)/pembelian/uang-muka/page";
import SalesAdvances from "@/app/(app)/penjualan/uang-muka/page";

const [po, dp, inv1, inv2, pay1, pay2, , so, sdp, sinv, rc1, rc2] = Array.from({ length: 12 }, (_, i) => id(i + 1));
beforeEach(() => {
  fixture.fail = new Set(); fixture.filters = [];
  fixture.rows = {
    purchase_advances: [{ id: dp, po_id: po, no_um: "UM-FICTION-1", tanggal: "2026-10-20", jumlah: 300, terpakai: 250, metode: "Transfer",
      catatan: null, status: "aktif", suppliers: { nama: "Fiction supplier" }, purchase_orders: { no_po: "PO-FICTION-1" } }],
    purchase_invoice_payments: [
      { id: pay1, invoice_id: inv1, advance_id: dp, tanggal: "2026-10-21", dari_uang_muka: 100, reversal_of: null, voided_at: null, purchase_invoices: { id: inv1, no_faktur: "FB-SAME" } },
      { id: pay2, invoice_id: inv2, advance_id: dp, tanggal: "2026-10-22", dari_uang_muka: 100, reversal_of: null, voided_at: null, purchase_invoices: { id: inv2, no_faktur: "FB-SAME" } },
    ],
    sales_advances: [{ id: sdp, order_id: so, no_um: "UJ-FICTION-1", tanggal: "2026-10-20", jumlah: 300, terpakai: 200, catatan: null,
      status: "aktif", customers: { name: "Fiction customer" }, sales_orders: { no_pesanan: "SO-FICTION-1" } }],
    sales_receipts: [
      { id: rc1, no_terima: "RC-FICTION-1", invoice_id: sinv, advance_id: sdp, tanggal: "2026-10-21", dari_uang_muka: 120, sales_invoices: { id: sinv, no_faktur: "FJ-FICTION-1" } },
      { id: rc2, no_terima: "RC-FICTION-2", invoice_id: sinv, advance_id: sdp, tanggal: "2026-10-22", dari_uang_muka: 80, sales_invoices: { id: sinv, no_faktur: "FJ-FICTION-1" } },
    ],
  };
});
async function render(page: typeof PurchaseAdvances) {
  document.body.innerHTML = renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) }));
  return document.getElementById(`advance-${page === PurchaseAdvances ? dp : sdp}`)!;
}

it("opens a purchase DP's PO and every invoice payment that used it", async () => {
  const row = await render(PurchaseAdvances);
  expect(row.querySelector(`a[href="/pembelian/${po}"]`)?.textContent).toBe("PO-FICTION-1");
  // Same invoice number on two distinct invoices: each payment keeps its own stored IDs.
  expect(row.querySelector(`a[href="/pembelian/faktur/${inv1}#payment-${pay1}"]`)?.textContent).toContain("FB-SAME");
  expect(row.querySelector(`a[href="/pembelian/faktur/${inv2}#payment-${pay2}"]`)?.textContent).toContain("FB-SAME");
  expect(fixture.filters.some(([table]) => table === "po_payments")).toBe(false);
  expect(fixture.filters).toContainEqual(["purchase_invoice_payments", "advance_id", [dp]]);
});

it("opens a sales DP's order and each split receipt that used it", async () => {
  const row = await render(SalesAdvances);
  expect(row.querySelector(`a[href="/penjualan/pesanan/${so}"]`)?.textContent).toBe("SO-FICTION-1");
  expect(row.querySelector(`a[href="/penjualan/faktur/${sinv}#receipt-${rc1}"]`)?.textContent).toContain("RC-FICTION-1");
  expect(row.querySelector(`a[href="/penjualan/faktur/${sinv}#receipt-${rc2}"]`)?.textContent).toContain("RC-FICTION-2");
});

it.each([
  ["purchase", "purchase_invoice_payments"], ["sales", "sales_receipts"],
] as const)("does not present a %s DP as unused when %s cannot be read", async (kind, table) => {
  fixture.fail.add(table);
  const row = await render(kind === "purchase" ? PurchaseAdvances : SalesAdvances);
  expect(row.querySelector('[role="alert"]')?.textContent).toContain("belum dapat diperiksa");
  expect(row.querySelector('a[href*="#payment-"], a[href*="#receipt-"]')).toBeNull();
});

it("does not link a usage whose document is not readable or mismatched, and says a used DP has no readable usage", async () => {
  fixture.rows.purchase_invoice_payments[0].purchase_invoices = null;
  fixture.rows.purchase_invoice_payments[1].purchase_invoices = { id: inv1, no_faktur: "FB-OTHER" };
  let row = await render(PurchaseAdvances);
  expect(row.querySelector('a[href*="/pembelian/faktur/"]')).toBeNull();
  expect(row.textContent).toContain("tidak tersedia untuk akses Anda");
  fixture.rows.purchase_invoice_payments = [];
  row = await render(PurchaseAdvances);
  expect(row.textContent).toContain("Pemakaian tercatat");
});

it("keeps an unreadable source order as plain text", async () => {
  fixture.rows.purchase_advances[0].purchase_orders = null;
  fixture.rows.sales_advances[0].sales_orders = null;
  expect((await render(PurchaseAdvances)).querySelector(`a[href="/pembelian/${po}"]`)).toBeNull();
  expect((await render(SalesAdvances)).querySelector(`a[href="/penjualan/pesanan/${so}"]`)).toBeNull();
});
