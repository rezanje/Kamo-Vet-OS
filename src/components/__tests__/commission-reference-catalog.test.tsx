import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ edit: true, policyInstalled: true, failed: "", truncated: "", reads: [] as { table: string; orders: string[]; from: number }[] }));
vi.mock("@/lib/master-guard", () => ({ bolehKelolaMaster: async () => state.edit }));
vi.mock("@/lib/komisi-data", () => ({ komisiPeriode: async () => ({ hasil: [], baris: [], omzetTanpaPenjual: 0 }),
  muatKebijakanKomisiJasa: async () => ({ policies: [], installed: state.policyInstalled }) }));
vi.mock("@/app/(app)/penjualan/komisi/actions", () => ({ hapusAturanKomisi: vi.fn(), simpanAturanKomisi: vi.fn(), toggleAturanKomisi: vi.fn(), simpanKebijakanKomisiJasa: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  const read = { table, orders: [], from: 0 } as { table: string; orders: string[]; from: number }; state.reads.push(read);
  let to = 999, counted = false;
  const filters: ((row: Row) => boolean)[] = [];
  const query = {
    select(_fields: string, options?: { count: string }) { counted = options?.count === "exact"; return query; },
    eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
    order(key: string) { read.orders.push(key); return query; }, range(from: number, end: number) { read.from = from; to = end; return query; },
    then(resolve: (value: unknown) => unknown) {
      const rows = table === "commission_rules" ? [] : [
        ...Array.from({ length: 1205 }, (_, i) => ({ id: `${table}-${i}`, name: i > 1202 ? "Duplicate name" : `Name ${i}`, nama: `Name ${i}`, code: `CODE-${i}`, is_active: true, status: "Aktif", parent_id: null })),
        { id: "inactive", name: "Inactive", nama: "Inactive", is_active: false, status: "Nonaktif", parent_id: null },
      ].filter(row => filters.every(filter => filter(row)));
      const data = rows.slice(read.from, to + 1);
      if (state.truncated === table && read.from === 500) data.pop();
      return Promise.resolve({ data, count: counted ? rows.length : null,
        error: state.failed === table && read.from === 500 ? { message: "private commission fixture" } : null }).then(resolve);
    },
  };
  return query;
} }) }));
import Page from "@/app/(app)/penjualan/komisi/page";
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}
const page = () => Page({ searchParams: Promise.resolve({ periode: "2026-10" }) });
beforeEach(() => { state.edit = true; state.policyInstalled = true; state.failed = ""; state.truncated = ""; state.reads = []; });
it("offers every active exact product target with separate code and complete existing branch/category/employee references", async () => {
  const nodes = elements(await page());
  const products = nodes.find(node => node.props.name === "item_id")?.props.items as { id: string; name: string; code: string }[];
  expect(products).toHaveLength(1205); expect(products.at(-1)).toMatchObject({ id: "items-1204", name: "Duplicate name", code: "CODE-1204" });
  for (const name of ["branch_id", "employee_id", "category_id"]) {
    const field = nodes.find(node => node.type === "select" && node.props.name === name);
    const choices = elements(field).filter(node => node.type === "option" && node.props.value);
    expect(choices).toHaveLength(name === "category_id" ? 1206 : 1205);
  }
  expect(state.reads.filter(read => read.table === "items").map(read => read.from)).toEqual([0, 500, 1000]);
});
it.each(["items", "item_categories", "employees", "branches"])("does not offer commission setup against partial or failed %s", async table => {
  state.failed = table;
  let html = renderToStaticMarkup(await page());
  expect(html).toContain('role="alert"'); expect(html).not.toContain('name="nama"'); expect(html).not.toContain("private commission");
  state.failed = ""; state.truncated = table;
  html = renderToStaticMarkup(await page());
  expect(html).toContain('role="alert"'); expect(html).not.toContain('name="nama"');
});
it("retains readonly visibility without exposing mutation controls", async () => {
  state.edit = false;
  const html = renderToStaticMarkup(await page());
  expect(html).toContain("Hanya OWNER/ADMIN"); expect(html).not.toContain('name="item_id"'); expect(html).not.toContain('name="nama"');
});

it("before the S04 migration explains that two-performer rows stay pending and offers no policy form", async () => {
  const installed = renderToStaticMarkup(await page());
  expect(installed).toContain("Simpan kebijakan");
  state.policyInstalled = false;
  const html = renderToStaticMarkup(await page());
  expect(html).toContain("Penyimpanan kebijakan belum terpasang di database");
  expect(html).not.toContain("Simpan kebijakan");
});
