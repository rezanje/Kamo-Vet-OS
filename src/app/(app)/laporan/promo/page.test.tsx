import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ responses: [] as Array<{ data: unknown[] }> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: () => {
    // The query is consumed by the mocked completeReportQuery after all builder methods.
    const query = new Proxy({}, { get: () => () => query });
    return query;
  },
}) }));
vi.mock("@/lib/report-query", () => ({ completeReportQuery: async () => fixture.responses.shift() }));
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ filter, ringkasan, children }: { filter: React.ReactNode; ringkasan: React.ReactNode; children: React.ReactNode }) => <main><form>{filter}</form>{ringkasan}{children}</main>,
  KartuAngka: ({ items }: { items: Array<{ label: string; nilai: string }> }) => <div>{items.map(item => <span key={item.label}>{item.label}: {item.nilai}</span>)}</div>,
  TabelKosong: ({ pesan }: { pesan: string }) => <tr><td>{pesan}</td></tr>,
}));
import Page from "./page";

it("reopens a monthly named-promo view without changing overall transaction totals", async () => {
  const alpha = "fa100000-0000-4000-8000-000000000011";
  const beta = "fa100000-0000-4000-8000-000000000012";
  const sale = (id: string, promoId: string) => ({
    id, total: 90, subtotal: 100, discount: 10, diskon_kategori: 0, poin_digunakan: 0,
    voucher_code: null, created_at: "2026-10-10T08:00:00Z", branch_id: null, branches: null,
    payment_plan: null, voided_at: null,
    sale_items: [{ qty: 1, harga: 100, item_discount_type: null, item_discount_value: null, promo_id: promoId, promo_discount: 10 }],
  });
  fixture.responses = [
    { data: [sale("sale-a", alpha), sale("sale-b", beta)] },
    { data: [] }, { data: [] },
    { data: [{ id: alpha, name: "Vaksin A", promo_type: "barang" }, { id: beta, name: "Makanan B", promo_type: "barang" }] },
    { data: [] },
  ];
  const page = await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31", promo_id: alpha }) });
  const html = renderToStaticMarkup(page);
  expect(html).toContain(`name="promo_id"`);
  expect(html).toContain(`value="${alpha}" selected=""`);
  const promoTable = html.split("02 · PROMO OTOMATIS")[1].split("03 · DISKON PER CABANG")[0];
  expect(promoTable).toContain("Vaksin A");
  expect(promoTable).not.toContain("Makanan B");
  expect(html).toContain("seluruh transaksi pada periode terpilih");
  expect(html).toContain("Omzet bersih: Rp 180");
});
