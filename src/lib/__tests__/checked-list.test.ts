import { describe, expect, it } from "vitest";
import { readCompleteList, readListPage } from "../checked-list";

type Row = { id: string; name: string };
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `row-${i}`, name: `name-${i}` }));
const fetchRows = (all: Row[]) => async (from: number, to: number) => ({ data: all.slice(from, to + 1), count: all.length, error: null });

describe("checked complete list", () => {
  it("includes a searchable row beyond the old 1000-row API cap", async () => {
    const result = await readCompleteList(fetchRows(rows(1200)), "Pelanggan");
    expect(result).toHaveLength(1200);
    expect(result.find((row) => row.name === "name-1199")?.id).toBe("row-1199");
  });
  it("accepts empty and exact-page-size results without an unchecked extra page", async () => {
    expect(await readCompleteList(fetchRows([]), "Pelanggan")).toEqual([]);
    expect(await readCompleteList(fetchRows(rows(1000)), "Pelanggan")).toHaveLength(1000);
  });
  it.each([null, undefined, -1, 1.5])("rejects invalid exact count %s", async (count) => {
    await expect(readCompleteList(async () => ({ data: [], count, error: null }), "Pelanggan")).rejects.toThrow(/Pelanggan/);
  });
  it("rejects changing counts instead of displaying partial totals", async () => {
    await expect(readCompleteList(async (from, to) => ({ data: rows(1200).slice(from, to + 1), count: from ? 1201 : 1200, error: null }), "Pelanggan")).rejects.toThrow(/berubah/);
  });
  it("rejects partial pages, source errors, missing data and duplicate IDs", async () => {
    for (const response of [
      { data: rows(499), count: 600, error: null },
      { data: rows(500), count: 600, error: { message: "private error" } },
      { data: null, count: 0, error: null },
      { data: [{ id: "", name: "bad" }], count: 1, error: null },
    ]) await expect(readCompleteList(async () => response, "Pelanggan")).rejects.toThrow(/Pelanggan/);
    await expect(readCompleteList(async (from, to) => ({ data: rows(600).slice(from, to + 1).map((r) => from ? { ...r, id: "row-0" } : r), count: 600, error: null }), "Pelanggan")).rejects.toThrow(/duplikat/);
  });
  it("rejects a second-page thrown transport failure without exposing its details", async () => {
    await expect(readCompleteList(async (from, to) => {
      if (from) throw new Error("private transport token");
      return { data: rows(1200).slice(from, to + 1), count: 1200, error: null };
    }, "Pelanggan")).rejects.toThrow("Pelanggan belum dapat dimuat lengkap. Coba muat ulang.");
  });
  it("rejects above the explicit 10000-source cap", async () => {
    await expect(readCompleteList(async () => ({ data: rows(500), count: 10001, error: null }), "Pelanggan")).rejects.toThrow(/10.000/);
  });
});

describe("checked server table page", () => {
  it("returns only requested 50 rows and truthful complete count", async () => {
    const result = await readListPage(fetchRows(rows(1200)), "Stok", "24");
    expect(result.rows).toHaveLength(50);
    expect(result.rows[0].id).toBe("row-1150");
    expect(result.count).toBe(1200);
    expect(result.pageInfo.page).toBe(24);
  });
  it.each(["25", "-1", "wat", "Infinity"])("resets invalid/out-of-range page %s to 1", async (page) => {
    const result = await readListPage(fetchRows(rows(1200)), "Stok", page);
    expect(result.pageInfo.page).toBe(1);
    expect(result.rows[0].id).toBe("row-0");
  });
  it("does not accept a partial requested page or changed count", async () => {
    await expect(readListPage(async (from, to) => ({ data: rows(1200).slice(from, to + (from ? 0 : 1)), count: 1200, error: null }), "Stok", "2")).rejects.toThrow(/Stok/);
    await expect(readListPage(async (from, to) => ({ data: rows(1200).slice(from, to + 1), count: from ? 1199 : 1200, error: null }), "Stok", "2")).rejects.toThrow(/berubah/);
  });
});
