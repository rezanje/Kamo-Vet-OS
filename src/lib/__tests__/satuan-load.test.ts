import { describe, expect, it } from "vitest";
import { loadItemUnits, loadUnitOptions, resolveSubmittedUnit } from "../satuan";

type Row = Record<string, unknown>;
// Simulates the API row cap, filtering and stable range ordering.
function database(tables: Record<string, Row[]>, errors: Record<string, string> = {}) {
  return { from(table: string) {
    let ids: string[] | undefined;
    let from = 0, to = 999;
    let activeOnly = false;
    const ordering: string[] = [];
    const query = {
      select: () => query,
      in: (_column: string, value: string[]) => { ids = value; return query; },
      eq: (column: string, value: unknown) => { if (column === "is_active" && value === true) activeOnly = true; return query; },
      order: (column: string) => { ordering.push(column); return query; },
      range: (start: number, end: number) => { from = start; to = end; return query; },
      then(resolve: (value: unknown) => unknown) {
        const filtered = (tables[table] ?? []).filter(row => (!ids || ids.includes(String(row[table === "items" ? "id" : "item_id"]))) && (!activeOnly || row.is_active === true));
        const rows = [...filtered].sort((a, b) => {
          for (const column of ordering) { const diff = String(a[column]).localeCompare(String(b[column])); if (diff) return diff; }
          return 0;
        }).slice(from, Math.min(to + 1, from + 1000));
        return Promise.resolve({ data: errors[table] ? null : rows, error: errors[table] ? { message: errors[table] } : null }).then(resolve);
      },
    };
    return query;
  } };
}
const base = { unit: "pcs", factor: 1, sell_price: 100, buy_price: 50 };
const extra = { unit: "box", factor: 12, sell_price: 1000, buy_price: 500 };
const item = { id: "a", unit: "pcs", sell_price: 100, buy_price: 50, is_active: true };

describe("submitted units", () => {
  it("rejects an explicit removed unit rather than silently changing stock quantity", () => {
    expect(() => resolveSubmittedUnit([base, extra], "removed")).toThrow(/satuan/i);
  });
  it("allows an omitted legacy unit but rejects an empty master", () => {
    expect(resolveSubmittedUnit([base, extra], undefined)).toEqual(base);
    expect(() => resolveSubmittedUnit([], "box")).toThrow(/satuan|barang/i);
  });
  it("uses the authoritative selected factor", () => {
    expect(resolveSubmittedUnit([base, extra], "box")).toEqual(extra);
  });
});
describe("unit master reads", () => {
  it("loads units beyond the API cap with equal factors", async () => {
    const units = Array.from({ length: 1205 }, (_, index) => ({ item_id: `item-${String(index).padStart(4, "0")}`, ...extra }));
    const loaded = await loadItemUnits(database({ item_units: units }));
    expect(loaded.size).toBe(1205);
    expect(loaded.get("item-1204")).toEqual([extra]);
  });
  it("loads requested item masters beyond the API cap", async () => {
    const items = Array.from({ length: 1205 }, (_, index) => ({ ...item, id: `item-${String(index).padStart(4, "0")}` }));
    const loaded = await loadUnitOptions(database({ items }), items.map(row => row.id));
    expect(loaded.size).toBe(1205);
    expect(loaded.get("item-1204")).toEqual([base]);
  });
  it.each(["items", "item_units"])("propagates the actual %s read failure", async table => {
    await expect(loadUnitOptions(database({ items: [item] }, { [table]: "read unavailable" }), ["a"])).rejects.toThrow("read unavailable");
  });
  it("rejects a missing item instead of returning a partial master", async () => {
    await expect(loadUnitOptions(database({ items: [item] }), ["a", "missing"])).rejects.toThrow(/barang/i);
  });
  it("allows inactive masters only for explicit source-verified historical use", async () => {
    const db = database({ items: [{ ...item, is_active: false }] });
    const loaded = await loadUnitOptions(db, ["a"], { includeInactive: true });
    expect(loaded.get("a")).toEqual([base]);
    await expect(loadUnitOptions(db, ["missing"], { includeInactive: true })).rejects.toThrow(/barang/i);
  });
  it("rejects inactive item masters", async () => {
    await expect(loadUnitOptions(database({ items: [{ ...item, is_active: false }] }), ["a"])).rejects.toThrow(/aktif/i);
  });
});
