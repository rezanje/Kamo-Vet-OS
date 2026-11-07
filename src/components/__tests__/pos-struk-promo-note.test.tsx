import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// POS back-office receipt: a promo the cashier cancelled / picked is stated on the receipt (the sale's own columns, not the URL).
const state = vi.hoisted(() => ({ queries: [] as { table: string; select: string }[], sale: {} as Record<string, unknown>, missingColumn: false, notFound: false, errorCode: "" }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/components/PrintButton", () => ({ PrintButton: () => null }));
vi.mock("@/components/ClearPosDraft", () => ({ ClearPosDraft: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  let select = "";
  const query = { select: (f: string) => { select = f; state.queries.push({ table, select: f }); return query; }, eq: () => query, is: () => query, order: () => query,
    maybeSingle: async () => (state.errorCode ? { data: null, error: { code: state.errorCode, message: "boom" } } : state.notFound ? { data: null, error: null } : state.missingColumn && select.includes("promo_pick_mode")
      ? { data: null, error: { code: "42703", message: "column sales.promo_pick_mode does not exist" } }
      : { data: { id: "sale", no_struk: "POS", cashier_name: "Kasir", total: 200, subtotal: 200, discount: 0, metode_bayar: "Tunai", bayar: 200, sale_payments: [{ method: "Tunai", amount: 200 }], payments_finalized_at: "2026-11-04", created_at: "2026-11-04", ...(state.missingColumn ? {} : state.sale) }, error: null }),
    then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: [{ nama: "Pakan", qty: 1, harga: 200, satuan: "pcs" }] }).then(resolve),
  }; return query;
} }) }));
import Receipt from "@/app/(app)/pos/struk/[saleId]/page";
const render = async () => renderToStaticMarkup(await Receipt({ params: Promise.resolve({ saleId: "sale" }) }));
beforeEach(() => { state.queries = []; state.sale = {}; state.missingColumn = false; state.notFound = false; state.errorCode = ""; });

it("promo_pick_mode 'tanpa': the receipt says 'Promo dibatalkan oleh kasir'", async () => {
  state.sale = { promo_pick_mode: "tanpa", promo_selection: { mode: "tanpa", applied: [] } };
  expect(await render()).toContain("Promo dibatalkan oleh kasir");
});
it("promo_pick_mode 'pilih': the receipt names the promo the cashier picked", async () => {
  state.sale = { promo_pick_mode: "pilih", promo_selection: { mode: "pilih", applied: [{ promo_id: "sh1", name: "Beli 2 Bolt, ANC", discount: 1000 }] } };
  const markup = await render();
  expect(markup).toContain("Promo dipilih kasir: Beli 2 Bolt, ANC (hanya promo ini)");
  expect(markup).not.toContain("dibatalkan oleh kasir");
});
it("automatic / old sales (null or 'auto'): no promo note at all - the receipt is as before", async () => {
  for (const sale of [{}, { promo_pick_mode: null, promo_selection: null }, { promo_pick_mode: "auto", promo_selection: { mode: "auto", applied: [] } }]) {
    state.sale = sale;
    const markup = await render();
    expect(markup).not.toContain("Promo dibatalkan"); expect(markup).not.toContain("Promo dipilih");
  }
});
it("one sales query (plus the lines) when the columns exist: same query count as before", async () => {
  await render();
  expect(state.queries.map((q) => q.table)).toEqual(["sales", "sale_items"]);
  expect(state.queries[0].select).toContain("promo_pick_mode");
});
it("a database without the pick columns (schema not migrated yet) still prints the receipt: re-read without them, no note, never a 404", async () => {
  state.missingColumn = true;
  const markup = await render();
  expect(markup).toContain("Pakan");
  expect(markup).not.toContain("Promo dibatalkan");
  expect(state.queries.map((q) => q.table)).toEqual(["sales", "sales", "sale_items"]);
  expect(state.queries[1].select).not.toContain("promo_pick_mode");
});
it("a sale that really does not exist is still a 404 (no retry loop, no note)", async () => {
  state.notFound = true;
  await expect(render()).rejects.toThrow();
  expect(state.queries.map((q) => q.table)).toEqual(["sales"]);
});
it("a real database error on the first read (not a missing column) is not retried into a half receipt", async () => {
  state.errorCode = "XX000";
  await expect(render()).rejects.toThrow();
  expect(state.queries.map((q) => q.table)).toEqual(["sales"]);
});
