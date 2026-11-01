import { describe, expect, it } from "vitest";
import { hitungGroomingKasir } from "../grooming-kasir";

type Row = { id: string; qty: number | string | null; sales: unknown };

function fakeSupabase(rows: Row[]) {
  const calls: { table?: string; select?: string; filters: string[] } = { filters: [] };
  const builder = {
    select(columns: string) { calls.select = columns; return builder; },
    eq(column: string, value: unknown) { calls.filters.push(`eq ${column} ${value}`); return builder; },
    is(column: string, value: unknown) { calls.filters.push(`is ${column} ${value}`); return builder; },
    gte(column: string, value: unknown) { calls.filters.push(`gte ${column} ${value}`); return builder; },
    lt(column: string, value: unknown) { calls.filters.push(`lt ${column} ${value}`); return builder; },
    order() {
      return { range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null, count: rows.length }) };
    },
  };
  return { calls, client: { from(table: string) { calls.table = table; return builder; } } };
}

const FROM = "2026-11-01T00:00:00+07:00";
const UNTIL = "2026-11-02T00:00:00+07:00";
const legacy = { created_at: FROM, payment_plan: null, payments_finalized_at: null, voided_at: null };
const finalized = { created_at: FROM, payment_plan: [{ method: "Tunai" }], payments_finalized_at: "2026-11-01T09:00:00+07:00", voided_at: null };
const pending = { created_at: FROM, payment_plan: [{ method: "Tunai" }], payments_finalized_at: null, voided_at: null };

describe("hitungGroomingKasir", () => {
  it("counts finalized and legacy sales but skips a planned sale that never finalized", async () => {
    const { client, calls } = fakeSupabase([
      { id: "a", qty: 2, sales: legacy },
      { id: "b", qty: "1", sales: [finalized] },
      { id: "c", qty: 5, sales: pending },
      { id: "d", qty: 3, sales: [pending] },
    ]);
    expect(await hitungGroomingKasir(client, FROM, UNTIL)).toBe(3);
    expect(calls.table).toBe("sale_items");
    expect(calls.select).toContain("sales!inner(created_at, payment_plan, payments_finalized_at, voided_at)");
    expect(calls.filters).toContain("is sales.voided_at null");
  });

  it("skips rows without an embedded sale and treats a missing qty as zero", async () => {
    const { client } = fakeSupabase([
      { id: "a", qty: null, sales: legacy },
      { id: "b", qty: 4, sales: null },
      { id: "c", qty: 4, sales: [] },
      { id: "d", qty: 1.5, sales: finalized },
    ]);
    expect(await hitungGroomingKasir(client, FROM, UNTIL)).toBe(1.5);
  });
});
