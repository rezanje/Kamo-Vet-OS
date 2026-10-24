import React from "react";
import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ failed: "", truncated: "", empty: false }));
vi.mock("@/app/(app)/pos/quest/actions", () => ({ createQuestDef: vi.fn(), createReward: vi.fn(), fulfillRedemption: vi.fn(), toggleQuestDef: vi.fn(), toggleReward: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  let from = 0, to = 999, counted = false;
  const filters: ((row: Row) => boolean)[] = [];
  const query = {
    select(_fields: string, options?: { count: string }) { counted = options?.count === "exact"; return query; },
    eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; }, order() { return query; },
    range(a: number, b: number) { from = a; to = b; return query; }, limit(size: number) { to = size - 1; return query; },
    then(resolve: (value: unknown) => unknown) {
      const rows = state.empty || !["items", "branches"].includes(table) ? [] : [
        ...Array.from({ length: 1205 }, (_, i) => ({ id: `${table}-${i}`, code: `CODE-${i}`, name: i > 1202 ? "Duplicate name" : `Fiction ${i}`, is_active: true })),
        { id: "inactive", name: "Inactive", is_active: false },
      ].filter(row => filters.every(filter => filter(row)));
      const data = rows.slice(from, to + 1);
      if (table === state.truncated && from === 500) data.pop();
      return Promise.resolve({ data, count: counted ? rows.length : null, error: table === state.failed && from === 500 ? { message: "Private quest fixture" } : null }).then(resolve);
    },
  };
  return query;
} }) }));
import Page from "@/app/(app)/pos/quest/page";
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}
const page = () => Page({ searchParams: Promise.resolve({}) });
beforeEach(() => { state.failed = ""; state.truncated = ""; state.empty = false; });
it("provides all active product targets with separate codes/exact IDs and all permitted active branches", async () => {
  const nodes = elements(await page());
  const productField = nodes.find(node => node.props.name === "target_ref_id");
  const items = productField?.props.items as { id: string; code: string; name: string }[];
  expect(items).toHaveLength(1205);
  expect(items.at(-1)).toMatchObject({ id: "items-1204", name: "Duplicate name", code: "CODE-1204" });
  expect(items.at(-2)?.id).toBe("items-1203");
  const branchField = nodes.find(node => node.type === "select" && node.props.name === "branch_id");
  const branchIds = elements(branchField).filter(node => node.type === "option").map(node => node.props.value).filter(Boolean);
  expect(branchIds).toHaveLength(1205); expect(branchIds).toContain("branches-1204"); expect(branchIds).not.toContain("inactive");
});
it.each(["items", "branches"])("rejects failed or truncated %s reference reads instead of presenting partial setup", async table => {
  state.failed = table;
  const error = await page().then(() => null, result => result as Error);
  expect(error?.message).toMatch(/belum.*dimuat/i); expect(error?.message).not.toContain("Private quest");
  state.failed = ""; state.truncated = table;
  await expect(page()).rejects.toThrow(/belum.*dimuat/i);
});
it("retains an optional empty exact-reference field when the permitted product catalogue is verified empty", async () => {
  state.empty = true;
  const field = elements(await page()).find(node => node.props.name === "target_ref_id");
  expect(field?.props.items).toEqual([]); expect(field?.props.required).not.toBe(true);
});
