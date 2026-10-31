import { describe, expect, it } from "vitest";
import { HPP_CONFIRM_FIELD, hppWarningConfirmed, hppWarningQuery, hppWarningSignature, hppWarningText, hppWarningsFrom } from "../hpp-warning";
import { grosirHppWarnings } from "../hpp-warning-server";

const below = { nama: "Kibble 1kg", net: 90000, hpp: 100000, paket: false };

describe("P03 back-office / wholesale below-HPP warning", () => {
  it("keeps zero and below-HPP findings, ignores unknown cost", () => {
    expect(hppWarningsFrom([
      { index: 0, nama: "A", paket: false, kind: "below", net: 5, hpp: 8 },
      { index: 1, nama: "B", paket: true, kind: "zero", net: 0, hpp: 3 },
      { index: 2, nama: "C", paket: false, kind: "unknown", net: 5, hpp: null },
    ])).toEqual([{ nama: "A", net: 5, hpp: 8, paket: false }, { nama: "B", net: 0, hpp: 3, paket: true }]);
  });
  it("names each line with its net price and HPP", () => {
    expect(hppWarningText([below])).toContain("Kibble 1kg (neto Rp90.000, HPP Rp100.000)");
  });
  it("requires a confirmation bound to the exact warning", () => {
    const form = new FormData();
    expect(hppWarningConfirmed(form, [])).toBe(true);
    expect(hppWarningConfirmed(form, [below])).toBe(false);
    form.set(HPP_CONFIRM_FIELD, hppWarningSignature([below]));
    expect(hppWarningConfirmed(form, [below])).toBe(true);
    // A changed cart (different price) needs a fresh confirmation.
    expect(hppWarningConfirmed(form, [{ ...below, net: 80000 }])).toBe(false);
    expect(hppWarningQuery([below])).toMatch(/^hpp_warning=.+&hpp_sig=1-/);
  });
});

describe("grosirHppWarnings", () => {
  const client = (layers: Record<string, unknown>[], itemType = "Persediaan") => ({
    from(table: string) {
      let rows: Record<string, unknown>[] = table === "items" ? [{ id: "sku", item_type: itemType }, { id: "svc", item_type: "Jasa" }]
        : table === "stock_layers" ? layers : [];
      let from = 0; let to = 999; let count = false;
      const query = {
        select: (_fields: string, options?: { count?: string }) => { count = options?.count === "exact"; return query; },
        eq: () => query, gt: () => query, lte: () => query, not: () => query, order: () => query, limit: () => query,
        in: (column: string, ids: string[]) => { rows = rows.filter(row => ids.includes(row[column] as string)); return query; },
        range: (start: number, end: number) => { from = start; to = end; return query; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows.slice(from, to + 1), count: count ? rows.length : null, error: null }).then(resolve),
      };
      return query;
    },
  });
  const layer = { id: "l1", item_id: "sku", qty_left: 10, unit_cost: 1000, exp_date: null, tanggal: "2026-10-01", created_at: "2026-10-01T00:00:00Z" };

  it("warns for a wholesale line below the warehouse FIFO cost, in base units", async () => {
    const warnings = await grosirHppWarnings(client([layer]), "wh", [
      { nama: "Kibble dus", item_id: "sku", qty: 1, harga: 10000, faktor: 12 },
      { nama: "Ongkir", item_id: "svc", qty: 1, harga: 0 },
    ]);
    expect(warnings).toEqual([{ nama: "Kibble dus", net: 10000, hpp: 12000, paket: false }]);
  });
  it("stays silent at or above cost, for services, or without a warehouse", async () => {
    expect(await grosirHppWarnings(client([layer]), "wh", [{ nama: "Kibble", item_id: "sku", qty: 2, harga: 1000 }])).toEqual([]);
    expect(await grosirHppWarnings(client([layer], "Jasa"), "wh", [{ nama: "Jasa", item_id: "sku", qty: 1, harga: 0 }])).toEqual([]);
    expect(await grosirHppWarnings(client([layer]), null, [{ nama: "Kibble", item_id: "sku", qty: 1, harga: 1 }])).toEqual([]);
  });
});
