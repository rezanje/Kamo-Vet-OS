// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ ranges: [] as number[][], reads: [] as { table: string; filters: unknown[][] }[] }));
const items = Array.from({ length: 1205 }, (_, i) => ({ id: `item-${i}`, code: `SKU-${i}`, name: i >= 1203 ? "Zebra Tuna" : `Pakan ${i}`, unit: "pcs" }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadItemUnits: async () => new Map() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from(table: string) {
    const read = { table, filters: [] as unknown[][] }; fixture.reads.push(read);
    let start = 0, end = 999;
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { read.filters.push(["eq", column, value]); return query; },
      lt: (column: string, value: unknown) => { read.filters.push(["lt", column, value]); return query; },
      gte: (column: string, value: unknown) => { read.filters.push(["gte", column, value]); return query; },
      lte: (column: string, value: unknown) => { read.filters.push(["lte", column, value]); return query; },
      order: () => query,
      range: (from: number, to: number) => { start = from; end = to; fixture.ranges.push([from, to]); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "items" ? items.slice(start, end + 1) : table === "warehouses" ? [{ id: "wh-1", code: "WH1", name: "Gudang Uji" }] : [], error: null }).then(resolve),
    };
    return query;
  },
}) }));
import KartuStokPage from "@/app/(app)/pos/kartu-stok/page";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.ranges = []; fixture.reads = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(params = {}) {
  const page = await KartuStokPage({ searchParams: Promise.resolve(params) });
  await act(async () => root.render(page));
}
const nameInput = () => host.querySelector<HTMLInputElement>('[role="combobox"]')!;
const codeInput = () => host.querySelector<HTMLInputElement>('[aria-label="Kode Barang"]')!;
const itemId = () => new FormData(host.querySelector("form")!).get("item");
async function type(text: string) {
  await act(async () => {
    nameInput().focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(nameInput(), text);
    nameInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => nameInput().dispatchEvent(event));
  return event;
}

it("searches names after row 1000, distinguishes duplicates by code and selects by keyboard without submitting", async () => {
  await render();
  expect(fixture.ranges).toEqual([[0, 999], [1000, 1999]]);
  await type("zEbRa TuNa");
  const options = host.querySelectorAll('[role="option"]');
  expect(Array.from(options, o => o.textContent)).toEqual(["SKU-1203 · Zebra Tuna", "SKU-1204 · Zebra Tuna"]);
  await key("ArrowDown"); await key("ArrowDown");
  expect((await key("Enter")).defaultPrevented).toBe(true);
  expect(itemId()).toBe("item-1204");
  expect(nameInput().value).toBe("Zebra Tuna");
  expect(codeInput().value).toBe("SKU-1204");
  expect(codeInput().readOnly).toBe(true);
});

it("keeps only item ID and warehouse/date filters in GET and clears name/code/ID together", async () => {
  await render({ item: "item-1204", gudang: "wh-1", dari: "2026-10-01", sampai: "2026-10-20" });
  expect(nameInput().value).toBe("Zebra Tuna"); expect(codeInput().value).toBe("SKU-1204");
  const form = host.querySelector("form")!;
  expect(form.method).toBe("get");
  expect(Object.fromEntries(new FormData(form))).toEqual({ item: "item-1204", gudang: "wh-1", dari: "2026-10-01", sampai: "2026-10-20" });
  expect(host.querySelector('button[type="submit"]')?.textContent).toContain("Tampilkan");
  await type("");
  expect(itemId()).toBe(""); expect(codeInput().value).toBe(""); expect(nameInput().value).toBe("");
  expect(new FormData(form).get("gudang")).toBe("wh-1");
});

it("syncs a new selection and restores the server query after navigation", async () => {
  await render({ item: "item-1204" });
  await type("Pakan 12");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  expect(itemId()).toBe("item-12"); expect(codeInput().value).toBe("SKU-12"); expect(nameInput().value).toBe("Pakan 12");
  await render({ item: "item-1001" });
  expect(itemId()).toBe("item-1001"); expect(codeInput().value).toBe("SKU-1001"); expect(nameInput().value).toBe("Pakan 1001");
});

it("restores the selected label on Escape or blur without submitting unselected typed text", async () => {
  await render({ item: "item-1204" });
  await type("not selected"); await key("Escape");
  expect(nameInput().value).toBe("Zebra Tuna"); expect(itemId()).toBe("item-1204");
  await type("no match");
  expect((await key("Enter")).defaultPrevented).toBe(true);
  await act(async () => nameInput().blur());
  expect(nameInput().value).toBe("Zebra Tuna"); expect(codeInput().value).toBe("SKU-1204");
});

it("preserves stock history reads and warehouse/date predicates", async () => {
  await render({ item: "item-1204", gudang: "wh-1", dari: "2026-10-01", sampai: "2026-10-20" });
  const reads = fixture.reads.filter(r => r.table === "stock_moves");
  expect(reads.map(r => r.filters)).toEqual([
    [["eq", "item_id", "item-1204"], ["lt", "tanggal", "2026-10-01"], ["eq", "warehouse_id", "wh-1"]],
    [["eq", "item_id", "item-1204"], ["gte", "tanggal", "2026-10-01"], ["lte", "tanggal", "2026-10-20"], ["eq", "warehouse_id", "wh-1"]],
    [["eq", "item_id", "item-1204"], ["lte", "tanggal", "2026-10-20"]],
  ]);
  expect(host.textContent).toContain("Mutasi 2026-10-01 s/d 2026-10-20");
});

it("rejects unknown item/warehouse query IDs on the server", async () => {
  await render({ item: "forged", gudang: "forged" });
  expect(itemId()).toBe(""); expect(nameInput().value).toBe(""); expect(codeInput().value).toBe("");
  expect(new FormData(host.querySelector("form")!).get("gudang")).toBe("");
  expect(fixture.reads.some(r => r.table === "stock_moves")).toBe(false);
});
