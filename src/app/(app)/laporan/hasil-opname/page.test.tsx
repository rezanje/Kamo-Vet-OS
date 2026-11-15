import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ heavy: 0, tables: [] as string[] }));
// Klien tiruan untuk jalur isian filter (A1): sesi OWNER, izin modul, satu cabang yang boleh diakses.
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
  rpc: async () => ({ data: true, error: null }),
  from: (table: string) => {
    gate.tables.push(table);
    const rows: Record<string, unknown[]> = {
      role_modules: [{ role: "OWNER", module_id: "laporan" }],
      branches: [{ id: "b1", name: "Cabang fiktif" }],
    };
    const query: Record<string, unknown> = {
      select: () => query, eq: () => query, order: () => query,
      maybeSingle: async () => ({ data: { role: "OWNER", is_active: true }, error: null }),
      range: async () => ({ data: rows[table] ?? [], error: null, count: (rows[table] ?? []).length }),
    };
    return query;
  },
}) }));
vi.mock("@/lib/opname-price-report", async original => {
  const actual = await original<typeof import("@/lib/opname-price-report")>();
  return { ...actual, loadOpnamePriceReport: async (_client: unknown, input: Parameters<typeof actual.opnameFilters>[0]) => {
    gate.heavy++;
    return { filters: actual.opnameFilters(input), branches: [{ id: "b1", name: "Cabang fiktif" }], entries: [], selected: null };
  } };
});
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ filter, children, siap }: { filter: React.ReactNode; children: React.ReactNode; siap: boolean }) => <main><form data-report-filters>{filter}</form>{siap ? children : <p>Laporan belum ditampilkan</p>}</main>,
  KartuAngka: () => null,
  TabelKosong: ({ pesan }: { pesan: string }) => <tr><td>{pesan}</td></tr>,
}));
import Page from "./page";

const form = (html: string) => html.slice(html.indexOf("<form"), html.indexOf("</form>"));

it("keeps the chosen valuation basis and direction when the period or branch is re-applied", async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({
    dari: "2026-10-01", sampai: "2026-10-31", cabang: "b1", dasar: "jual", arah: "kurang",
    order: "ec500000-0000-4000-8000-000000000001", tampil: "1",
  }) }));
  expect(form(html)).toContain('name="dasar" value="jual"');
  expect(form(html)).toContain('name="arah" value="kurang"');
  // The selected opname document is a drill-down for the old range, not a saved view setting.
  expect(form(html)).not.toContain('name="order"');
});

it("adds no hidden view inputs for the default basis and direction", async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31", tampil: "1" }) }));
  expect(form(html)).not.toContain('name="dasar"');
  expect(form(html)).not.toContain('name="arah"');
});

it("A1: tanpa tampil=1 hanya cek akses + daftar cabang, hasil opname tidak dibaca", async () => {
  gate.heavy = 0; gate.tables = [];
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31" }) }));
  expect(gate.heavy).toBe(0);
  expect(gate.tables).not.toContain("opname_results");
  expect(gate.tables).not.toContain("warehouses");
  expect(form(html)).toContain("Cabang fiktif");
  expect(html).toContain("Laporan belum ditampilkan");
});
