import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/opname-price-report", async original => {
  const actual = await original<typeof import("@/lib/opname-price-report")>();
  return { ...actual, loadOpnamePriceReport: async (_client: unknown, input: Parameters<typeof actual.opnameFilters>[0]) =>
    ({ filters: actual.opnameFilters(input), branches: [{ id: "b1", name: "Cabang fiktif" }], entries: [], selected: null }) };
});
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ filter, children }: { filter: React.ReactNode; children: React.ReactNode }) => <main><form data-report-filters>{filter}</form>{children}</main>,
  KartuAngka: () => null,
  TabelKosong: ({ pesan }: { pesan: string }) => <tr><td>{pesan}</td></tr>,
}));
import Page from "./page";

const form = (html: string) => html.slice(html.indexOf("<form"), html.indexOf("</form>"));

it("keeps the chosen valuation basis and direction when the period or branch is re-applied", async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({
    dari: "2026-10-01", sampai: "2026-10-31", cabang: "b1", dasar: "jual", arah: "kurang",
    order: "ec500000-0000-4000-8000-000000000001",
  }) }));
  expect(form(html)).toContain('name="dasar" value="jual"');
  expect(form(html)).toContain('name="arah" value="kurang"');
  // The selected opname document is a drill-down for the old range, not a saved view setting.
  expect(form(html)).not.toContain('name="order"');
});

it("adds no hidden view inputs for the default basis and direction", async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31" }) }));
  expect(form(html)).not.toContain('name="dasar"');
  expect(form(html)).not.toContain('name="arah"');
});
