import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ heavy: 0, tables: [] as string[], report: null as Record<string, unknown> | null }));
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
const summary = (plus: string | null, minus: string | null, net: string | null, unavailable = 0) => ({ plus, minus, net, unavailable });
const group = { key: "b1:w1", branchId: "b1", branch: "Cabang fiktif", warehouseId: "w1", warehouse: "Gudang VET", documents: 2, withoutSnapshot: 0, corrected: 1,
  plusCount: 1, minusCount: 3, modal: summary("100", "-250.5", "-150.5"), jual: summary("140", "-80", "60"), gap: "210.5" };
const emptyRecap = { groups: [], total: { ...group, key: "total", documents: 0, plusCount: 0, minusCount: 0, corrected: 0,
  modal: summary("0", "0", "0"), jual: summary("0", "0", "0"), gap: "0" }, methods: [] };
vi.mock("@/lib/opname-price-report", async original => {
  const actual = await original<typeof import("@/lib/opname-price-report")>();
  return { ...actual, loadOpnamePriceReport: async (_client: unknown, input: Parameters<typeof actual.opnameFilters>[0]) => {
    gate.heavy++;
    return { filters: actual.opnameFilters(input), branches: [{ id: "b1", name: "Cabang fiktif" }], entries: [], selected: null, recap: emptyRecap,
      modal: summary("0", "0", "0"), jual: summary("0", "0", "0"), ...(gate.report ?? {}) };
  } };
});
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ filter, children, siap, ringkasan }: { filter: React.ReactNode; children: React.ReactNode; siap: boolean; ringkasan?: React.ReactNode }) =>
    <main><form data-report-filters>{filter}</form>{ringkasan}{siap ? children : <p>Laporan belum ditampilkan</p>}</main>,
  KartuAngka: ({ items }: { items: { label: string; nilai: string }[] }) => <dl>{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.nilai}</dd></div>)}</dl>,
  TabelKosong: ({ pesan }: { pesan: string }) => <tr><td>{pesan}</td></tr>,
}));
import Page from "./page";

const form = (html: string) => html.slice(html.indexOf("<form"), html.indexOf("</form>"));
const ORDER = "ec500000-0000-4000-8000-000000000001";

it("keeps the chosen direction when the period or branch is re-applied; the old valuation toggle is gone", async () => {
  gate.report = null;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({
    dari: "2026-10-01", sampai: "2026-10-31", cabang: "b1", dasar: "jual", arah: "kurang", order: ORDER, tampil: "1",
  }) }));
  expect(form(html)).toContain('name="arah" value="kurang"');
  // F1-a: HPP and sale value are side by side, so no basis is carried any more.
  expect(form(html)).not.toContain('name="dasar"');
  // The selected opname document is a drill-down for the old range, not a saved view setting.
  expect(form(html)).not.toContain('name="order"');
});

it("adds no hidden view inputs for the default direction", async () => {
  gate.report = null;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31", tampil: "1" }) }));
  expect(form(html)).not.toContain('name="dasar"');
  expect(form(html)).not.toContain('name="arah"');
});

it("A1: tanpa tampil=1 hanya cek akses + daftar cabang, hasil opname tidak dibaca", async () => {
  gate.heavy = 0; gate.tables = []; gate.report = null;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31" }) }));
  expect(gate.heavy).toBe(0);
  expect(gate.tables).not.toContain("opname_results");
  expect(gate.tables).not.toContain("warehouses");
  expect(form(html)).toContain("Cabang fiktif");
  expect(html).toContain("Laporan belum ditampilkan");
  expect(html).not.toContain("Rekap periode");
});

it("F1-a: period recap per branch/warehouse with HPP and sale values side by side, method-aware label, server download", async () => {
  gate.report = { recap: { groups: [group], total: { ...group, key: "total" }, methods: ["moving_average"] } };
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31", tampil: "1" }) }));
  expect(html).toContain("Rekap periode per cabang");
  expect(html).toContain("Gudang VET");
  expect(html).toContain("Lebih (HPP average)");
  expect(html).toContain("Kurang (harga jual)");
  expect(html).toContain("Selisih jual − HPP");
  expect(html).toContain("−Rp 150,50");
  expect(html).toContain("Rp 210,50");
  expect(html).toContain("1 dokumen pernah dikoreksi");
  expect(html).not.toContain("Modal FIFO");
  expect(html).toContain("/laporan/hasil-opname/unduh?dari=2026-10-01&amp;sampai=2026-10-31&amp;cabang=&amp;order=&amp;arah=semua&amp;format=xlsx");
});

it("F1-a: document drill-down shows HPP, sale value and their difference in one table", async () => {
  const row = { itemId: "i1", code: "SKU-1", name: "Barang fiktif", unit: "PCS", systemQty: 10, physicalQty: 8, difference: -2, unitCost: "100", costSource: "",
    branchPrice: "150", modalDifference: "-200", saleDifference: "-300", modalDifferenceSource: "HPP FIFO keluar yang dijurnal", stockAfter: 8, stockValueAfter: "800" };
  gate.report = { selected: { resultId: "r1", orderId: ORDER, resultNo: "OPR.1", orderNo: "OPO.1", date: "2026-10-25", warehouseId: "w1", warehouse: "Gudang VET", branchId: "b1", branch: "Cabang fiktif" },
    method: "fifo", scope: "Seluruh", revision: null, legacy: false, rows: [row], shown: [row], journalReview: null,
    modal: summary("0", "-200", "-200"), jual: summary("0", "-300", "-300") };
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31", order: ORDER, tampil: "1" }) }));
  for (const text of ["HPP FIFO satuan", "Nilai selisih HPP FIFO", "Harga jual cabang", "Nilai selisih harga jual", "−Rp 200,00", "−Rp 300,00", "−Rp 100,00"]) expect(html).toContain(text);
  expect(html).toContain("Selisih kurang (harga jual)");
  expect(html).toContain(`order=${ORDER}&amp;arah=semua&amp;format=csv`);
  expect(html).not.toContain("Dasar aktif");
});
