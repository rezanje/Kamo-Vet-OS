import { describe, expect, it, vi } from "vitest";
import { getDashboard } from "../dashboard";

vi.mock("../ledger", () => ({ getAccountBalances: vi.fn(async () => []), nilaiSeksi: vi.fn() }));
vi.mock("../kas-akun", () => ({ kodeSemuaRekening: vi.fn(async () => []) }));

const po = { id: "po", purchase_order_items: [{ id: "line", item_id: "sku", qty: 4, qty_terima: 4, harga_beli: 100, faktor: 10 }] };
const invoice = (qty: number, total: number, voided_at: string | null = null) => ({
  po_id: "po", total, voided_at,
  purchase_invoice_items: [{ po_item_id: "line", item_id: "sku", qty, faktor: 10 }],
  purchase_invoice_payments: [] as { amount: number }[],
});
async function purchase(rows: object[], returns: object[] = []) {
  const tables: Record<string, object[]> = { purchase_orders: [po], purchase_invoices: rows, purchase_returns: returns };
  const client = { from: (table: string) => {
    let data = tables[table] ?? [];
    const query = {
      select: () => query, order: () => query, range: async () => ({ data, count: data.length, error: null }), eq: () => query, neq: () => query, in: () => query, gte: () => query, lte: () => query,
      is: (column: string, value: unknown) => { data = data.filter(row => (row as Record<string, unknown>)[column] === value); return query; },
      then: (resolve: (result: { data: object[] }) => unknown) => Promise.resolve(resolve({ data })),
    };
    return query;
  } };
  return (await getDashboard(client, "2026-10-21")).pembelian;
}

describe("purchase dashboard keeps received but unbilled liability", () => {
  it("counts a receipt before any invoice", async () => {
    expect(await purchase([])).toEqual({ total: 400, lunas: 0, belumLunas: 400 });
  });
  it("adds only the unbilled PO portion to repriced partial and direct invoices", async () => {
    const partial = { ...invoice(1, 120), purchase_invoice_payments: [{ amount: 20 }] };
    const direct = { po_id: null, total: 50, voided_at: null, purchase_invoice_items: [], purchase_invoice_payments: [{ amount: 10 }] };
    expect(await purchase([partial, direct])).toEqual({ total: 470, lunas: 30, belumLunas: 440 });
  });
  it("reopens the received obligation after the only invoice is cancelled", async () => {
    expect(await purchase([invoice(4, 480, "2026-10-21")])).toEqual({ total: 400, lunas: 0, belumLunas: 400 });
  });
  it("counts a replacement once while preserving the cancelled original", async () => {
    expect(await purchase([invoice(4, 480, "2026-10-21"), invoice(4, 500)])).toEqual({ total: 500, lunas: 0, belumLunas: 500 });
  });
  it("applies a pre-invoice return once before and after the gross invoice", async () => {
    const returns = [{ po_id: "po", total: 100, voided_at: null }];
    const expected = { total: 400, lunas: 100, belumLunas: 300 };
    expect(await purchase([], returns)).toEqual(expected);
    expect(await purchase([invoice(4, 400)], returns)).toEqual(expected);
  });
  it("counts the active return replacement once", async () => {
    expect(await purchase([invoice(4, 400)], [
      { po_id: "po", total: 100, voided_at: "2026-10-21" },
      { po_id: "po", total: 60, voided_at: null },
    ])).toEqual({ total: 400, lunas: 60, belumLunas: 340 });
  });
});
