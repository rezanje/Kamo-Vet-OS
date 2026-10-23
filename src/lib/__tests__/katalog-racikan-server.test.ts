import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Read = { table: string; orders: string[]; ids?: string[]; range?: number[]; counted: boolean };
const fixture = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>, reads: [] as Read[], failed: "", truncated: "", denied: false,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from(table: string) {
    const read: Read = { table, orders: [], counted: false };
    fixture.reads.push(read);
    const filters: ((row: Row) => boolean)[] = [];
    const query = {
      select(_fields: string, options?: { count: string }) { read.counted = options?.count === "exact"; return query; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
      in(key: string, ids: string[]) { read.ids = ids; filters.push(row => ids.includes(String(row[key]))); return query; },
      order(key: string) { read.orders.push(key); return query; },
      range(from: number, to: number) { read.range = [from, to]; return query; },
      then(resolve: (value: unknown) => unknown) {
        const rows = fixture.denied ? [] : (fixture.tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
        const [from, to] = read.range ?? [0, 999];
        const data = rows.slice(from, to + 1);
        if (fixture.truncated === table) data.pop();
        return Promise.resolve({ data, count: read.counted ? rows.length : null,
          error: fixture.failed === table ? { message: "private fixture detail" } : null }).then(resolve);
      },
    };
    return query;
  },
}) }));
import { loadKatalogRacikan } from "../katalog-racikan-server";

function formulas(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `formula-${i}`, code: `F-${String(i).padStart(4, "0")}`, active: true,
    current_version_id: `version-${i}`, sale_item_id: `sku-${i}`,
  }));
}
beforeEach(() => {
  fixture.reads = []; fixture.failed = ""; fixture.truncated = ""; fixture.denied = false;
  const rows = formulas(1205);
  fixture.tables = {
    compound_formulas: rows,
    compound_formula_versions: rows.map((row, i) => ({ id: row.current_version_id, version: 2,
      name: `Formula ${i}`, dosage_form: "sirup", dosage_instruction: "Fictional instructions",
      ingredients: [{ item_id: `material-${i}`, name: "Fictional material", quantity: 2, unit: "ml", unit_price: 100 }],
    })),
  };
});

describe("complete permitted official compound catalogue", () => {
  it("loads every formula beyond1000 with stable checked pages and bounded exact-version batches", async () => {
    const rows = await loadKatalogRacikan();
    expect(rows).toHaveLength(1205);
    expect(rows.at(-1)).toMatchObject({ id: "formula-1204", code: "F-1204", version_id: "version-1204",
      version: 2, sale_item_id: "sku-1204", name: "Formula 1204", ingredients: [{ item_id: "material-1204", name: "Fictional material", quantity: 2, unit: "ml", unit_price: 100 }] });
    const formulaReads = fixture.reads.filter(read => read.table === "compound_formulas");
    expect(formulaReads.map(read => read.range)).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(formulaReads.every(read => read.counted && read.orders.join(",") === "code,id")).toBe(true);
    const versionReads = fixture.reads.filter(read => read.table === "compound_formula_versions");
    expect(versionReads).toHaveLength(7);
    expect(versionReads.every(read => read.counted && read.ids!.length <= 200 && read.orders.at(-1) === "id")).toBe(true);
    expect(versionReads.flatMap(read => read.ids!)).toEqual(formulas(1205).map(row => row.current_version_id));
  });
  it("keeps the existing active filter, explicit version binding and unpublished-formula semantics", async () => {
    fixture.tables.compound_formulas[0].active = false;
    fixture.tables.compound_formulas[1].current_version_id = null;
    fixture.tables.compound_formula_versions.push({ id: "unrelated-version", name: "Must not appear" });
    const active = await loadKatalogRacikan();
    expect(active).toHaveLength(1203);
    expect(active.some(row => row.id === "formula-0" || row.id === "formula-1" || row.name === "Must not appear")).toBe(false);
    const all = await loadKatalogRacikan(true);
    expect(all).toHaveLength(1204);
    expect(all[0]).toMatchObject({ id: "formula-0", active: false });
  });
  it.each(["compound_formulas", "compound_formula_versions"])("rejects errors and partial %s without leaking raw details", async table => {
    fixture.failed = table;
    await expect(loadKatalogRacikan()).rejects.toThrow(/belum.*dimuat/i);
    await expect(loadKatalogRacikan()).rejects.not.toThrow("private fixture detail");
    fixture.failed = ""; fixture.truncated = table;
    await expect(loadKatalogRacikan()).rejects.toThrow(/belum.*dimuat/i);
  });
  it("rejects a missing or inaccessible referenced version instead of silently omitting a formula", async () => {
    fixture.tables.compound_formula_versions.pop();
    await expect(loadKatalogRacikan()).rejects.toThrow(/versi.*belum.*dimuat/i);
  });
  it("does not fetch versions when the session cannot read any formula", async () => {
    fixture.denied = true;
    expect(await loadKatalogRacikan()).toEqual([]);
    expect(fixture.reads.map(read => read.table)).toEqual(["compound_formulas"]);
  });
});
