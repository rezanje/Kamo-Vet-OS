import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ responses: [] as Array<{ data: unknown[] }>, failCampaign: false, calls: 0 }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: () => {
    // The query is consumed by the mocked completeReportQuery after all builder methods.
    const query = new Proxy({}, { get: () => () => query });
    return query;
  },
}) }));
vi.mock("@/lib/report-query", () => ({ completeReportQuery: async () => {
  fixture.calls++;
  // Panggilan ke-6..8 adalah baca kampanye; simulasi tabel/kolom belum ada.
  if (fixture.failCampaign && fixture.responses.length === 0) throw Object.assign(new Error("kolom tidak ada"), { code: "42703" });
  return fixture.responses.shift();
} }));
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
    { data: [] }, { data: [] }, { data: [] }, // kampanye: kode, struk, invoice
  ];
  const page = await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31", promo_id: alpha, tampil: "1" }) });
  const html = renderToStaticMarkup(page);
  expect(html).toContain(`name="promo_id"`);
  expect(html).toContain(`value="${alpha}" selected=""`);
  const promoTable = html.split("02 · PROMO OTOMATIS")[1].split("03 · DISKON PER CABANG")[0];
  expect(promoTable).toContain("Vaksin A");
  expect(promoTable).not.toContain("Makanan B");
  expect(html).toContain("seluruh transaksi pada periode terpilih");
  expect(html).toContain("Omzet bersih: Rp 180");
});

const kampanyeFixture = () => {
  const baris = (over: Record<string, unknown>) => ({
    id: "s", total: 90, subtotal: 100, discount: 10, diskon_kategori: 0, poin_digunakan: 0, voucher_code: null,
    created_at: "2026-10-10T08:00:00Z", branch_id: "b1", branches: { name: "Bogor" }, payment_plan: [{ method: "Tunai", amount: 90 }],
    payments_finalized_at: "2026-10-10T08:01:00Z", voided_at: null, campaign_code: null, sale_items: [], ...over,
  });
  return [
    { data: [] }, { data: [] }, // struk & invoice laporan utama
    { data: [{ id: "v1", code: "GAJIAN", tipe: "persen", nilai: 10, is_active: true, valid_from: null, valid_until: null, max_potongan: null, min_belanja: null, boleh_gabung_promo: true, customer_id: null, category_id: null }] },
    { data: [{ id: "p1", name: "Vaksin Kitten", promo_type: "barang", valid_until: null }] },
    { data: [] },
    // kampanye: kode, struk, invoice
    { data: [
      { id: "k1", code: "KAMOGAJIAN", voucher_id: "v1", promo_id: null, max_uses: 5, is_active: true, note: null },
      { id: "k2", code: "KITTEN", voucher_id: null, promo_id: "p1", max_uses: null, is_active: false, note: null },
      { id: "k3", code: "SEPI", voucher_id: "v1", promo_id: null, max_uses: null, is_active: true, note: null },
    ] },
    { data: [
      baris({ id: "a", campaign_code: "KAMOGAJIAN" }),
      baris({ id: "batal", campaign_code: "KAMOGAJIAN", voided_at: "2026-10-11T00:00:00Z", total: 9999 }),
      baris({ id: "b", campaign_code: "KITTEN", sale_items: [{ qty: 1, harga: 100, item_discount_type: null, item_discount_value: null, promo_id: "p1", promo_discount: 10 }] }),
    ] },
    { data: [{ id: "i1", total: 200, subtotal: 250, discount: 50, created_at: "2026-10-12T08:00:00Z", voided_at: null, campaign_code: "KAMOGAJIAN", visits: { branch_id: "b2", branches: { name: "Depok" } } }] },
  ];
};
const sp = (over: Record<string, string> = {}) => Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31", tampil: "1", ...over });
const bagianKampanye = (html: string) => html.split("04 · KAMPANYE / KODE KAMPANYE")[1] ?? "";

it("menampilkan tabel kampanye: kode, tujuan, status, pemakaian POS/klinik, sisa kuota, termasuk kode tanpa pemakaian", async () => {
  fixture.responses = kampanyeFixture();
  const html = renderToStaticMarkup(await Page({ searchParams: sp() }));
  const t = bagianKampanye(html);
  expect(t).toContain("KAMOGAJIAN");
  expect(t).toContain("Voucher GAJIAN");
  expect(t).toContain("Promo Vaksin Kitten");
  expect(t).toContain("SEPI"); // nol pemakaian tetap tampil
  expect(t).toContain("nonaktif");
  // KAMOGAJIAN: 1 POS (batal tidak dihitung) + 1 klinik = 2 dari maks 5 → sisa 3
  expect(t).toMatch(/POS 1[^<]*·[^<]*Klinik 1/);
  expect(t).toContain("sisa 3");
  expect(t).toContain("Rp 290"); // 90 + 200, struk batal 9999 tidak ikut
  expect(t).not.toContain("9.999");
  // kode terikat promo: potongan POS eksak (Rp 10) tampil
  expect(t).toMatch(/Rp 10(?!\d)/);
  // urut menurut pemakaian: KAMOGAJIAN (2) sebelum KITTEN (1) sebelum SEPI (0)
  expect(t.indexOf("KAMOGAJIAN")).toBeLessThan(t.indexOf("KITTEN"));
  expect(t.indexOf("KITTEN")).toBeLessThan(t.indexOf("SEPI"));
  expect(t).toContain("hanya dokumen yang sudah final dan tidak dibatalkan");
  // tabel lama tidak berubah
  expect(html).toContain("01 · VOUCHER");
  expect(html).toContain("03 · DISKON PER CABANG");
});

it("kode voucher: potongan tidak ditebak, diberi tahu tidak terpisah", async () => {
  fixture.responses = kampanyeFixture();
  const t = bagianKampanye(renderToStaticMarkup(await Page({ searchParams: sp() })));
  expect(t).toContain("tidak terpisah");
});

it("kampanye kosong: pesan jujur, bukan tabel kosong tanpa penjelasan", async () => {
  fixture.responses = Array.from({ length: 8 }, () => ({ data: [] }));
  const t = bagianKampanye(renderToStaticMarkup(await Page({ searchParams: sp() })));
  expect(t).toContain("Belum ada kode kampanye");
  expect(t).toContain("CRM");
});

it("data kampanye belum tersedia di database: sisanya tetap tampil dan bagian kampanye bilang terus terang", async () => {
  fixture.responses = Array.from({ length: 5 }, () => ({ data: [] }));
  fixture.failCampaign = true;
  const html = renderToStaticMarkup(await Page({ searchParams: sp() }));
  fixture.failCampaign = false;
  expect(html).toContain("01 · VOUCHER");
  expect(bagianKampanye(html)).toContain("belum dapat dibaca");
});

it("A1: tanpa tampil=1 hanya daftar promo (isian filter) yang dibaca, laporan berat tidak ditarik", async () => {
  fixture.calls = 0;
  fixture.responses = [{ data: [{ id: "p1", name: "Vaksin Kitten", promo_type: "barang", valid_until: null }] }];
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31" }) }));
  expect(fixture.calls).toBe(1);
  expect(html).toContain("Vaksin Kitten");
});
