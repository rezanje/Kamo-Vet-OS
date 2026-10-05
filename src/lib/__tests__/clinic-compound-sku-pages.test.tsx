import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, failed: "" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let from = 0; let to = 999; let counted = false;
    const q = {
      select(_fields: string, opts?: { count: string }) { counted = opts?.count === "exact"; return q; },
      eq(k: string, v: unknown) { filters.push(r => r[k] === v); return q; },
      neq(k: string, v: unknown) { filters.push(r => r[k] !== v); return q; },
      in(k: string, values: unknown[]) { filters.push(r => values.includes(r[k])); return q; },
      or(expression: string) {
        const alternatives = expression.match(/category_id\.in\.\([^)]+\)|name\.ilike\.[^,]+/g) ?? [];
        filters.push(row => alternatives.some(filter => filter.startsWith("category_id.in.")
          ? filter.slice("category_id.in.(".length, -1).split(",").includes(String(row.category_id))
          : String(row.name).toLowerCase().startsWith(filter.slice("name.ilike.".length).replace(/\*$/, "").toLowerCase())));
        return q;
      },
      order() { return q; },
      limit(n: number) { to = n - 1; return q; },
      range(a: number, b: number) { from = a; to = b; return q; },
      maybeSingle: async () => ({ data: fixture.failed === table ? null : (fixture.tables[table] ?? []).find(r => filters.every(f => f(r))) ?? null, error: fixture.failed === table ? { message: "secret detail" } : null }),
      single: async () => ({ data: (fixture.tables[table] ?? [])[0] ?? null, error: null }),
      then(resolve: (v: unknown) => void) {
        const rows = (fixture.tables[table] ?? []).filter(r => filters.every(f => f(r)));
        return Promise.resolve({ data: fixture.failed === table ? null : rows.slice(from, to + 1), count: counted ? rows.length : null, error: fixture.failed === table ? { message: "secret detail" } : null }).then(resolve);
      },
    };
    return q;
  },
}) }));
vi.mock("@/lib/dokter", () => ({ daftarDokter: async () => [] }));
vi.mock("@/lib/rombongan-server", () => ({ bacaSaudaraKunjungan: async () => [] }));
vi.mock("@/lib/consent", () => ({ templatesForBranch: () => [] }));
vi.mock("../../app/(app)/klinik/rekam-medis/[visitId]/RekamForm", () => ({ RekamForm: () => null }));
vi.mock("../../app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm", () => ({ CatatanForm: () => null }));
vi.mock("../../app/(app)/klinik/rekam-medis/[visitId]/RacikanInline", () => ({ RacikanInline: () => null }));
vi.mock("../../app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: vi.fn() }));
import ExamPage from "../../app/(app)/klinik/rekam-medis/[visitId]/page";
import InpatientPage from "../../app/(app)/klinik/rawat-inap/[id]/catatan/page";

function formProps(node: React.ReactNode): Record<string, unknown> | undefined {
  if (!React.isValidElement<Record<string, unknown>>(node)) return;
  if ("katalogRacikan" in node.props) return node.props;
  for (const child of React.Children.toArray(node.props.children as React.ReactNode)) {
    const result = formProps(child); if (result) return result;
  }
}
beforeEach(() => {
  fixture.failed = "";
  const visit = { id: "visit", pet_id: "pet", branch_id: "branch", status: "Diperiksa", created_at: "2026-10-05T00:00:00Z", pets: { name: "Fictional", species: "Kucing" }, customers: { name: "Fictional owner" } };
  fixture.tables = {
    profiles: [{ id: "owner", role: "OWNER" }], visits: [visit],
    inpatient_records: [{ id: "inpatient", visit_id: "visit", condition_status: "stable", admitted_at: visit.created_at, visits: visit }],
    warehouses: [{ id: "retail", branch_id: "branch", type: "RETAIL", is_active: true }, { id: "warehouse", branch_id: "branch", type: "VET", is_active: true }],
    item_categories: [{ id: "cat", name: "OBAT RACIK" }],
    items: [
      ...Array.from({ length: 550 }, (_, i) => ({ id: `ordinary-${i}`, name: `A ordinary ${i}`, is_active: true, is_compound_material: false, item_type: "Persediaan", category_id: "ordinary", unit: "PCS", sell_price: 1000 })),
      { id: "racik", name: "Obat Racik Sirup Flu", is_active: true, is_compound_material: false, item_type: "Persediaan", category_id: "cat", unit: "PCS", sell_price: 20000 },
      { id: "inactive", name: "Nonaktif", is_active: false, is_compound_material: false, item_type: "Persediaan", category_id: "cat" },
      { id: "material", name: "Bahan", is_active: true, is_compound_material: true, item_type: "Persediaan", category_id: "cat" },
      { id: "service", name: "Jasa", is_active: true, is_compound_material: false, item_type: "Jasa", category_id: "cat" },
    ],
    stock: [{ id: "stock", warehouse_id: "warehouse", item_id: "racik", qty: 8 }, { id: "foreign", warehouse_id: "other-branch", item_id: "racik", qty: 99 }],
    item_branch_prices: [{ id: "price", item_id: "racik", branch_id: "branch", unit: "PCS", sell_price: 25000 }],
  };
});
const exam = () => ExamPage({ params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve({}) });
const inpatient = () => InpatientPage({ params: Promise.resolve({ id: "inpatient" }) });
describe("compound master SKUs reach clinic POS", () => {
  it.each([["exam", exam], ["inpatient", inpatient]] as const)("%s exposes an active compound SKU beyond the old master limit with branch price and stock", async (_name, page) => {
    const props = formProps(await page());
    expect(props?.racikanItems).toEqual([expect.objectContaining({ id: "racik", sell_price: 25000, stok: 8, unit: "PCS" })]);
    expect((props?.items as { id: string }[]).some(i => i.id === "racik")).toBe(false);
    expect(props?.katalogRacikan).toEqual([]);
  });
  it("keeps stock, branch price and extra units for SKUs beyond 1000 enrichment rows", async () => {
    const compounds = Array.from({ length: 1010 }, (_, i) => ({ id: `compound-${i}`, name: `ZZ ${i}`, is_active: true, is_compound_material: false, item_type: "Persediaan", category_id: "cat", unit: "PCS", sell_price: 1000 }));
    fixture.tables.items.push(...compounds);
    for (const item of compounds) {
      fixture.tables.stock.push({ id: `stock-${item.id}`, item_id: item.id, warehouse_id: "warehouse", qty: 9 });
      fixture.tables.item_branch_prices.push({ id: `price-${item.id}`, item_id: item.id, branch_id: "branch", unit: "PCS", sell_price: 2000 });
    }
    fixture.tables.item_units = compounds.map(item => ({ id: `unit-${item.id}`, item_id: item.id, unit: "box", factor: 10, sell_price: 15000, buy_price: 10000 }));
    const props = formProps(await exam());
    const last = (props?.racikanItems as { id: string; stok: number; sell_price: number; units: unknown[] }[]).find(item => item.id === "compound-1009");
    expect(last).toMatchObject({ stok: 9, sell_price: 2000, units: expect.arrayContaining([expect.objectContaining({ unit: "box", factor: 10 })]) });
  });
  it("includes legacy Obat Racik names stored in other master categories", async () => {
    fixture.tables.items.push({ id: "legacy", name: "Obat Racik Salep Jamur", is_active: true, is_compound_material: false, item_type: "Persediaan", category_id: "other", unit: "PCS", sell_price: 10000 });
    const props = formProps(await exam());
    expect(props?.racikanItems).toEqual(expect.arrayContaining([expect.objectContaining({ id: "legacy" })]));
  });
  it("finds legacy named compound SKUs even without a compound category", async () => {
    fixture.tables.item_categories = [];
    expect(formProps(await exam())?.racikanItems).toEqual([expect.objectContaining({ id: "racik" })]);
  });
  it.each([["category", "item_categories"], ["SKU", "items"], ["warehouse", "warehouses"], ["stock", "stock"], ["unit", "item_units"], ["branch price", "item_branch_prices"]])("fails visibly when the %s source cannot be read", async (_name, table) => {
    fixture.failed = table;
    const result = await exam().then(() => null, error => error as Error);
    expect(result).toBeInstanceOf(Error);
    expect(result?.message).toMatch(/belum.*dimuat/i);
    expect(result?.message).not.toContain("secret detail");
  });
});
