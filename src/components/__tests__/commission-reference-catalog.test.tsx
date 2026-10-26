import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ edit: true, failed: "", truncated: "", report: false, reads: [] as { table: string; orders: string[]; from: number }[] }));
vi.mock("@/lib/master-guard", () => ({ bolehKelolaMaster: async () => state.edit }));
vi.mock("@/lib/komisi-data", () => ({ komisiPeriode: async () => ({
  hasil: state.report ? [{ employeeId: "employees-0", omzet: 75_000, laba: 50_000, komisi: 8_125, barisTanpaHpp: 0, rincian: [
    { aturanId: "sku", nama: "Tindakan", dasar: 0.5, komisi: 2_500, cair: true },
    { aturanId: "sales", nama: "Omzet", dasar: 75_000, komisi: 5_625, cair: true },
  ] }] : [], omzetTanpaPenjual: 0, baris: [],
}) }));
vi.mock("@/app/(app)/penjualan/komisi/actions", () => ({ hapusAturanKomisi: vi.fn(), simpanAturanKomisi: vi.fn(), simpanKelompokKomisi: vi.fn(), toggleAturanKomisi: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  const read = { table, orders: [], from: 0 } as { table: string; orders: string[]; from: number }; state.reads.push(read);
  let to = 999, counted = false;
  const filters: ((row: Row) => boolean)[] = [];
  const query = {
    select(_fields: string, options?: { count: string }) { counted = options?.count === "exact"; return query; },
    eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
    order(key: string) { read.orders.push(key); return query; }, range(from: number, end: number) { read.from = from; to = end; return query; },
    then(resolve: (value: unknown) => unknown) {
      const rows = table === "commission_rules" ? state.report ? [
        { id: "sku", nama: "Tindakan", tipe: "nominal", basis: "omzet", sumber: "klinik", nominal: 5_000, persen: 0, is_active: true },
        { id: "sales", nama: "Omzet", tipe: "persen", basis: "omzet", sumber: "klinik", nominal: 0, persen: 7.5, is_active: true },
      ] : [] : [
        ...Array.from({ length: 1205 }, (_, i) => ({ id: `${table}-${i}`, name: i > 1202 ? "Duplicate name" : `Name ${i}`, nama: `Name ${i}`, code: `CODE-${i}`, is_active: true, status: "Aktif", parent_id: null, commission_group: table === "employees" && i === 0 ? "doctor_new" : null })),
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
beforeEach(() => { state.edit = true; state.failed = ""; state.truncated = ""; state.report = false; state.reads = []; });
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
it("shows quantity, configured rate and net-sales basis in the employee readout", async () => {
  state.report = true;
  const html = renderToStaticMarkup(await page());
  expect(html).toContain("0,5 unit × Rp 5.000/unit");
  expect(html).toContain("omzet neto Rp 75.000 × 7,5%");
  expect(html).toContain("(doctor_new)");
  expect(html).not.toContain("dasar Rp 1");
});
